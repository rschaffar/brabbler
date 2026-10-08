import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { executeGitOperation } = await jiti.import("./server.ts");
const { cleanupPathWithin } = await jiti.import("./cleanup.ts");
const { gitWorkflowManifest: manifest } = await jiti.import("./manifest.ts");
const { updatePluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-cleanup-test-"));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, "repo"), path = join(root, "feature");
  git(root, "init", "-qb", "main", repo); git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n.codegraph/\n.next/\nunknown/\n");
  writeFileSync(join(repo, "source"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "Base");
  git(repo, "worktree", "add", "-b", "feature", path);
  writeFileSync(join(path, "source"), "feature\n"); git(path, "add", "."); git(path, "commit", "-qm", "Feature");
  const featureTip = git(path, "rev-parse", "HEAD");
  git(repo, "merge", "--no-ff", "--no-edit", "feature");
  const integrationCommit = git(repo, "rev-parse", "HEAD");
  const set = (values) => updatePluginSettings(manifest, "project", repo, values, []);
  updatePluginSettings(manifest, "global", repo, { enabled: true }, []);
  set({ targetBranch: "main", targetSelection: "configured", cleanupFeature: "ask", approvedArtifactRoots: "node_modules, .codegraph, .next" });
  const receipts = []; let approvals = 0;
  const ui = { isDirectoryInUse: () => false, reserveDirectory: () => () => {}, operationReceipt: (_id, value) => receipts.push(structuredClone(value)), pluginCard: async () => { approvals++; return "approve"; } };
  const op = { action: "cleanupFeature", checkout: repo, featureBranch: "feature", featureTip, integrationCommit, worktreePath: path, removeWorktree: true, deleteBranch: true, artifactRoots: [] };
  const artifact = (name, content = "generated") => { mkdirSync(join(path, name), { recursive: true }); writeFileSync(join(path, name, "cache"), content); };
  const call = (extra = {}, custom = {}) => executeGitOperation(repo, { ...op, ...extra }, { ...ui, ...custom }, undefined, undefined, "cleanup-call");
  return { root, repo, path, op, ui, receipts, set, artifact, call, approvals: () => approvals };
}
const failed = (result, pattern) => { assert.equal(result.isError, true, result.content[0].text); assert.match(result.content[0].text, pattern); };
const passed = (result) => assert.notEqual(result.isError, true, result.content[0].text);

test("one approval removes explicit generated roots, worktree and exact integrated branch with durable outcome", async (t) => {
  const f = fixture(t); f.artifact("node_modules"); f.artifact(".codegraph");
  const result = await f.call({ artifactRoots: ["node_modules", ".codegraph"] }); passed(result);
  assert.equal(f.approvals(), 1); assert.equal(existsSync(f.path), false);
  assert.equal(git(f.repo, "branch", "--list", "feature"), "");
  assert.equal(f.receipts.at(-1).phase, "succeeded");
  assert.equal(f.receipts.at(-1).authorization.decision, "user-approved");
  assert.equal(f.receipts.at(-1).toolCallId, "cleanup-call");
  assert.equal(new Set(f.receipts.map((receipt) => receipt.operationId)).size, 1);
  assert.equal(result.details.effects.length, 4);
});
test("Allow has durable policy authorization, checks/effect stages and no interactive approval", async (t) => {
  const f = fixture(t); f.set({ cleanupFeature: "allow" });
  passed(await f.call({}, { pluginCard: () => assert.fail("Allow must not ask") }));
  assert.equal(f.receipts[0].authorization.mode, "allow");
  assert.equal(f.receipts.at(-1).authorization.decision, "policy-authorized");
  assert.equal(f.receipts.at(-1).authorization.source, "project");
  assert.ok(f.receipts.some((receipt) => receipt.phase === "executing"));
});
test("target advancement alone retains cleanup approval when integration remains reachable", async (t) => {
  const f = fixture(t);
  passed(await f.call({}, { pluginCard: async () => { git(f.repo, "commit", "--allow-empty", "-qm", "Later unrelated work"); return "approve"; } }));
});
test("unknown artifacts, tracked changes, locks, active use and unpermitted roots block before approval", async (t) => {
  for (const kind of ["unknown", "source", "locked", "active", "unpermitted", "nested", "symlink", "keep", "feature-tip", "integration"]) await t.test(kind, async (st) => {
    const f = fixture(st); let extra = {}; let custom = { pluginCard: () => assert.fail("Unsafe preview must not ask") }; let pattern;
    if (kind === "unknown") { f.artifact("unknown"); pattern = /Unknown cleanup/; }
    if (kind === "source") { writeFileSync(join(f.path, "source"), "local work"); pattern = /source changes/; }
    if (kind === "locked") { git(f.repo, "worktree", "lock", f.path); pattern = /locked/; }
    if (kind === "active") { custom.isDirectoryInUse = () => true; pattern = /active use/; }
    if (kind === "unpermitted") { f.artifact("node_modules"); f.set({ approvedArtifactRoots: null }); extra.artifactRoots = ["node_modules"]; pattern = /explicit permission/; }
    if (kind === "nested") { f.artifact("node_modules"); mkdirSync(join(f.path, "node_modules", ".git")); extra.artifactRoots = ["node_modules"]; pattern = /Nested repository/; }
    if (kind === "symlink") { symlinkSync(f.root, join(f.path, "node_modules")); extra.artifactRoots = ["node_modules"]; pattern = /unapproved untracked files|existing generated directories/; }
    if (kind === "keep") { f.set({ cleanupWorktree: "keep" }); pattern = /Keep choice/; }
    if (kind === "feature-tip") { git(f.path, "commit", "--allow-empty", "-qm", "New feature work"); pattern = /Feature branch changed/; }
    if (kind === "integration") { extra.integrationCommit = "a".repeat(40); pattern = /bad object|Not a valid|Command failed/; }
    failed(await f.call(extra, custom), pattern); assert.equal(existsSync(f.path), true);
  });
});
test("content changed during approval invalidates bounded cleanup, not just porcelain status", async (t) => {
  const f = fixture(t); f.artifact("node_modules", "before");
  failed(await f.call({ artifactRoots: ["node_modules"] }, { pluginCard: async () => { writeFileSync(join(f.path, "node_modules", "cache"), "after!"); return "approve"; } }), /resources changed/);
  assert.equal(existsSync(f.path), true); assert.equal(f.receipts.at(-1).phase, "failed"); assert.equal(f.receipts.at(-1).effectStarted, false);
});
test("partial cleanup preserves changed remaining roots and records completed steps", async (t) => {
  const f = fixture(t); f.artifact("node_modules"); f.artifact(".codegraph");
  const result = await f.call({ artifactRoots: ["node_modules", ".codegraph"] }, { isDirectoryInUse: () => {
    if (!existsSync(join(f.path, "node_modules"))) writeFileSync(join(f.path, ".codegraph", "cache"), "changed after first deletion");
    return false;
  } });
  failed(result, /resources changed/); assert.equal(result.details.effects.length, 1);
  assert.equal(existsSync(join(f.path, "node_modules")), false); assert.equal(existsSync(join(f.path, ".codegraph")), true);
  assert.equal(f.receipts.at(-1).effectStarted, true); assert.equal(f.receipts.at(-1).phase, "failed");
});
test("README workflow replay uses one merge approval with policy-authorized isolation, commit and cleanup", async (t) => {
  const f = fixture(t); const path = join(`${f.repo}-worktrees`, "automatic");
  f.set({ workspace: "worktree", completion: "integrate", targetSelection: "configured", methodSelection: "configured",
    cleanupWorktree: "remove-integrated", cleanupBranch: "delete-integrated", cleanupArtifacts: "remove-approved",
    createWorktree: "allow", commit: "allow", merge: "ask", cleanupFeature: "allow" });
  let approvals = 0;
  const ui = { ...f.ui, pluginCard: async (_id, card) => { assert.equal(card.title, "Git merge"); approvals++; return "approve"; } };
  const execute = (operation) => executeGitOperation(f.repo, operation, ui);
  passed(await execute({ action: "createWorktree", checkout: f.repo, branch: "automatic", baseBranch: "main", path }));
  writeFileSync(join(path, "README.md"), "Small documentation change\n");
  passed(await execute({ action: "commit", checkout: path, mode: "files", files: ["README.md"], message: "Document the feature" }));
  mkdirSync(join(path, "node_modules")); writeFileSync(join(path, "node_modules", "fixture"), "generated dependency");
  const featureTip = git(path, "rev-parse", "HEAD");
  passed(await execute({ action: "merge", checkout: f.repo, featureBranch: "automatic" }));
  passed(await execute({ action: "cleanupFeature", checkout: f.repo, featureBranch: "automatic", featureTip,
    integrationCommit: git(f.repo, "rev-parse", "HEAD"), worktreePath: path, removeWorktree: true, deleteBranch: true, artifactRoots: ["node_modules"] }));
  assert.equal(approvals, 1); assert.equal(existsSync(path), false);
  assert.equal(f.receipts.filter((receipt) => receipt.phase === "succeeded").length, 4);
  assert.equal(f.receipts.filter((receipt) => receipt.phase === "succeeded" && receipt.authorization.decision === "policy-authorized").length, 3);
});
test("containment includes dot-dot-prefixed descendants but excludes actual parent components", () => {
  assert.equal(cleanupPathWithin("/tmp/feature", "/tmp/feature/..cache"), true);
  assert.equal(cleanupPathWithin("/tmp/feature", "/tmp/feature/../outside"), false);
  assert.equal(cleanupPathWithin("/tmp/feature", "/tmp/feature-other"), false);
});
test("symbolic feature refs cannot delete main or remote-tracking refs", async (t) => {
  for (const ref of ["refs/heads/main", "refs/remotes/fixture/protected"]) await t.test(ref, async (st) => {
    const f = fixture(st); git(f.repo, "update-ref", ref, f.op.integrationCommit);
    git(f.repo, "symbolic-ref", "refs/heads/alias", ref);
    failed(await f.call({ featureBranch: "alias", featureTip: f.op.integrationCommit, worktreePath: undefined, removeWorktree: false }), /symbolic branch refs/);
    assert.equal(git(f.repo, "rev-parse", ref), f.op.integrationCommit);
  });
});
test("symbolic rebinding and integration reachability changes invalidate approval", async (t) => {
  for (const kind of ["alias", "unreachable"]) await t.test(kind, async (st) => {
    const f = fixture(st);
    failed(await f.call({}, { pluginCard: async () => {
      if (kind === "alias") git(f.repo, "symbolic-ref", "refs/heads/feature", "refs/heads/main");
      else git(f.repo, "update-ref", "refs/heads/main", git(f.repo, "rev-parse", "feature^"));
      return "approve";
    } }), /symbolic branch refs|Command failed/);
    assert.equal(existsSync(f.path), true); assert.equal(f.receipts.at(-1).effectStarted, false);
  });
});
test("caller descendants named ..cache and aliased selected checkouts remain protected", async (t) => {
  const f = fixture(t); const caller = join(f.path, "..cache"); mkdirSync(caller);
  failed(await executeGitOperation(caller, f.op, f.ui), /main\/caller/);
  const alias = join(f.root, "alias"); symlinkSync(f.repo, alias);
  failed(await f.call({ checkout: alias }), /without symlink aliases/);
});
test("final validation failure records no dispatched effect and releases reservation", async (t) => {
  const f = fixture(t); f.artifact("node_modules"); let released = false;
  failed(await f.call({ artifactRoots: ["node_modules"] }, {
    reserveDirectory: () => () => { released = true; },
    operationReceipt: (id, receipt) => {
      f.ui.operationReceipt(id, receipt);
      if (receipt.phase === "executing") writeFileSync(join(f.path, "node_modules", "cache"), "changed at dispatch boundary");
    },
  }), /resources changed/);
  assert.equal(f.receipts.at(-1).effectStarted, false); assert.equal(released, true); assert.equal(existsSync(f.path), true);
});
test("root additions during asynchronous final inventory are not silently removed", async (t) => {
  const f = fixture(t);
  failed(await f.call({}, { operationReceipt: (id, receipt) => {
    f.ui.operationReceipt(id, receipt);
    if (receipt.phase === "executing") setImmediate(() => f.artifact("unknown"));
  } }), /root changed|Unknown cleanup resource/);
  assert.equal(existsSync(join(f.path, "unknown")), true); assert.equal(f.receipts.at(-1).effectStarted, false);
});
test("receipt persistence failure blocks effects; branch-only cleanup needs no removed worktree", async (t) => {
  const f = fixture(t); f.set({ cleanupFeature: "allow" });
  failed(await f.call({}, { operationReceipt: () => { throw new Error("storage unavailable"); } }), /storage unavailable/);
  assert.equal(existsSync(f.path), true);
  git(f.repo, "worktree", "remove", f.path);
  passed(await f.call({ worktreePath: undefined, removeWorktree: false }));
  assert.equal(git(f.repo, "branch", "--list", "feature"), "");
});
