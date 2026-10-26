import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { nativeCleanupAccess } from "./cleanup-access.fixture.mjs";
import { setupCleanupRepository } from "./cleanup-setup.fixture.mjs";
import { createIdentityGate } from "../../lib/plugins/identity-gate.fixture.mjs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { executeGitOperation } = await jiti.import("./server.ts");
const { cleanupPathWithin, captureCleanup, performCleanup, createCleanupBudget } = await jiti.import("./cleanup.ts");
const { preparePluginReview } = await jiti.import("../../lib/plugins/review-store.ts");
const { snapshotOperationReceipt } = await jiti.import("../../lib/operation-receipts.ts");
const { validatePluginCard } = await jiti.import("../../lib/plugins/ui.ts");
const { gitWorkflowManifest: manifest } = await jiti.import("./manifest.ts");
const { pluginSettingsPath, updatePluginSettings, readPluginSettings, pluginProjectIdentityAsync } = await jiti.import("../../lib/plugins/settings.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-cleanup-test-"));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, "repo"), path = join(root, "feature");
  const { featureTip, integrationCommit } = setupCleanupRepository(root, repo, path);
  const set = (values) => updatePluginSettings(manifest, "project", repo, values, []);
  updatePluginSettings(manifest, "global", repo, { enabled: true }, []);
  set({ targetBranch: "main", targetSelection: "configured", cleanupFeature: "ask", approvedArtifactRoots: "node_modules, .codegraph, .next" });
  const receipts = [], cards = []; let approvals = 0;
  const ui = { prepareReview: preparePluginReview, isDirectoryInUse: () => false, reserveDirectory: () => () => {}, operationReceipt: (id, value) => { snapshotOperationReceipt(id, value, receipts.length + 1); receipts.push(structuredClone(value)); }, pluginCard: async (_id, card) => { validatePluginCard(card); approvals++; cards.push(structuredClone(card)); return "approve"; } };
  const op = { action: "cleanupFeature", checkout: repo, featureBranch: "feature", featureTip, integrationCommit, worktreePath: path, removeWorktree: true, deleteBranch: true, artifactRoots: [] };
  const artifact = (name, content = "generated") => { mkdirSync(join(path, name), { recursive: true }); writeFileSync(join(path, name, "cache"), content); };
  const call = (extra = {}, custom = {}, options) => executeGitOperation(repo, { ...op, ...extra }, { ...ui, ...custom }, undefined, undefined, "cleanup-call", undefined, options);
  const settingsBytes = () => readFileSync(pluginSettingsPath(manifest), "utf8");
  return { root, repo, path, op, ui, receipts, cards, set, artifact, call, settingsBytes, approvals: () => approvals };
}
const failed = (result, pattern) => { assert.equal(result.isError, true, result.content[0].text); assert.match(result.content[0].text, pattern); };
const passed = (result) => assert.notEqual(result.isError, true, result.content[0].text);
const nestedTest = (name, fn) => test(name, { skip: process.platform !== "linux" }, fn);
function nestedFixture(t) {
  const f = fixture(t);
  mkdirSync(join(f.path, "src/meetings"), { recursive: true });
  writeFileSync(join(f.path, "src/meetings/main.py"), "# tracked source\n");
  writeFileSync(join(f.path, ".gitignore"), readFileSync(join(f.path, ".gitignore"), "utf8") + "__pycache__/\n*.pyc\n");
  git(f.path, "add", "."); git(f.path, "commit", "-qm", "Nested tracked source and ignores");
  git(f.repo, "merge", "--no-ff", "--no-edit", "feature");
  f.op.featureTip = git(f.path, "rev-parse", "HEAD"); f.op.integrationCommit = git(f.repo, "rev-parse", "HEAD");
  return f;
}

nestedTest("nested ignored files/directories reach one approval beside tracked source, without settings writes", async (t) => {
  // Native ownership: both shapes and both discovery paths. Permission cross-product lives in resource-rules.test.mjs.
  for (const selection of ["discovered", "explicit"]) for (const kind of ["file", "directory"]) await t.test(`${selection}: ${kind}`, async (st) => {
    const mode = selection === "explicit" ? "allow" : "ask";
    const f = nestedFixture(st); f.set({ cleanupFeature: mode, approvedArtifactRoots: null });
    const root = kind === "directory" ? "src/meetings/__pycache__" : "src/meetings/main.pyc";
    if (kind === "directory") f.artifact(root); else writeFileSync(join(f.path, root), "generated bytecode\n");
    const beforeSettings = f.settingsBytes();
    passed(await f.call({ artifactRoots: selection === "explicit" ? [root] : [] }));
    assert.equal(f.approvals(), 1); assert.equal(existsSync(f.path), false);
    const fields = f.cards[0].sections.flatMap((section) => section.fields ?? []).filter((field) => /SHA256/.test(field.value));
    assert.deepEqual(fields.map((field) => field.label), [root]); assert.match(fields[0].value, /Needs one-time approval/);
    assert.equal(readFileSync(join(f.repo, "src/meetings/main.py"), "utf8"), "# tracked source\n");
    assert.equal(f.receipts.at(-1).phase, "succeeded"); assert.equal(f.receipts.at(-1).authorization.decision, "user-approved");
    assert.equal(f.settingsBytes(), beforeSettings);
  });
});
nestedTest("multiple nested deletions retain tracked siblings and allow empty artifact-only ancestor directories", async (t) => {
  const f = nestedFixture(t); f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
  const roots = ["src/meetings/__pycache__", "src/meetings/main.pyc", "scratch/generated/cache.pyc"];
  f.artifact(roots[0]); writeFileSync(join(f.path, roots[1]), "bytecode");
  mkdirSync(join(f.path, "scratch/generated"), { recursive: true }); writeFileSync(join(f.path, roots[2]), "bytecode");
  const result = await f.call({ artifactRoots: roots, removeWorktree: false, deleteBranch: false }); passed(result);
  assert.equal(f.approvals(), 1); assert.equal(result.details.effects.length, roots.length);
  for (const root of roots) assert.equal(existsSync(join(f.path, root)), false);
  assert.equal(existsSync(join(f.path, "scratch/generated")), true);
  assert.equal(readFileSync(join(f.path, "src/meetings/main.py"), "utf8"), "# tracked source\n");
  assert.equal(git(f.path, "status", "--porcelain"), ""); assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
});
nestedTest("mixed discovered top-level artifacts and nested files/directories complete in Git enumeration order", async (t) => {
  const f = nestedFixture(t);
  mkdirSync(join(f.path, "src/other")); writeFileSync(join(f.path, "src/other/main.py"), "# tracked sibling\n");
  git(f.path, "add", "."); git(f.path, "commit", "-qm", "Second tracked sibling"); git(f.repo, "merge", "--no-ff", "--no-edit", "feature");
  f.op.featureTip = git(f.path, "rev-parse", "HEAD"); f.op.integrationCommit = git(f.repo, "rev-parse", "HEAD");
  const directories = ["node_modules", ".codegraph", ".next", "test-results", "src/meetings/__pycache__", "src/other/__pycache__"];
  for (const root of directories) f.artifact(root);
  writeFileSync(join(f.path, "next-env.d.ts"), "types"); writeFileSync(join(f.path, "src/meetings/main.pyc"), "bytecode");
  f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
  const result = await f.call(); passed(result);
  assert.equal(result.details.effects.length, 10); assert.equal(f.receipts.at(-1).phase, "succeeded");
  assert.equal(existsSync(f.path), false); assert.equal(git(f.repo, "branch", "--list", "feature"), "");
});
nestedTest("an exactly permitted nested root executes under Allow without a card", async (t) => {
  // Parent/child/case authority is exhaustive in the pure rule owner; keep exact nested Allow wiring here.
  for (const permitted of ["src/meetings/__pycache__"]) await t.test(permitted, async (st) => {
    const f = nestedFixture(st); f.artifact("src/meetings/__pycache__");
    f.set({ cleanupFeature: "allow", approvedArtifactRoots: permitted });
    passed(await f.call());
    assert.equal(f.approvals(), permitted.endsWith("__pycache__") ? 0 : 1);
    assert.equal(f.receipts.at(-1).authorization.decision, permitted.endsWith("__pycache__") ? "policy-authorized" : "user-approved");
  });
});
nestedTest("reject/cancel nested cleanup preserves artifacts, tracked source, worktree and branch", async (t) => {
  for (const answer of ["reject", null]) await t.test(String(answer), async (st) => {
    const f = nestedFixture(st); f.artifact("src/meetings/__pycache__"); f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
    let cards = 0;
    failed(await f.call({}, { pluginCard: async (_id, card) => {
      cards++; assert.ok(JSON.stringify(card).includes("src/meetings/__pycache__")); return answer;
    } }), /not approved/);
    assert.equal(cards, 1); assert.equal(existsSync(join(f.path, "src/meetings/__pycache__/cache")), true);
    assert.equal(readFileSync(join(f.path, "src/meetings/main.py"), "utf8"), "# tracked source\n");
    assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip); assert.equal(f.receipts.at(-1).effectStarted, false);
  });
});
nestedTest("nested selections cannot overlap, traverse, use metadata aliases or alias tracked paths", async (t) => {
  // Grammar bridge still proves refusal before receipts/UI; physical tracked aliases below stay native.
  for (const roots of [["src/.git./cache"]]) await t.test(JSON.stringify(roots), async (st) => {
    const f = nestedFixture(st); f.artifact("src/meetings/__pycache__");
    failed(await f.call({ artifactRoots: roots }, { pluginCard: () => assert.fail("Invalid roots must not ask") }), /literal relative|overlap or alias/);
    assert.equal(f.receipts.length, 0); assert.equal(existsSync(join(f.path, "src/meetings/__pycache__")), true);
  });
  for (const root of ["src/meetings", "src/meetings/main.py", "src/MEETINGS/__pycache__", "src/meetings./__pycache__"]) await t.test(root, async (st) => {
    const f = nestedFixture(st);
    if (root.endsWith("__pycache__")) {
      if (existsSync(join(f.path, root.split("/__pycache__")[0]))) { st.skip("Requires distinct aliased entries"); return; }
      f.artifact(root);
    }
    failed(await f.call({ artifactRoots: [root], removeWorktree: false, deleteBranch: false }, { pluginCard: () => assert.fail("Tracked aliases must not ask") }), /include or alias tracked source/);
    assert.equal(readFileSync(join(f.path, "src/meetings/main.py"), "utf8"), "# tracked source\n");
  });
});
nestedTest("nested root ancestors cannot be symlinks and each segment must match its exact spelling", async (t) => {
  const f = nestedFixture(t); const outside = join(f.root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "cache.pyc"), "external data");
  symlinkSync(outside, join(f.path, "link"));
  failed(await f.call({ artifactRoots: ["link/cache.pyc"], removeWorktree: false, deleteBranch: false }, { pluginCard: () => assert.fail("Unsafe ancestor must not ask") }), /symlink|untracked files/);
  assert.equal(readFileSync(join(outside, "cache.pyc"), "utf8"), "external data");
  rmSync(join(f.path, "link")); f.artifact("src/meetings/__pycache__");
  failed(await f.call({ artifactRoots: ["SRC/meetings/__pycache__"], removeWorktree: false, deleteBranch: false }), /exact directory entry|alias tracked source/);
});
nestedTest("nested resource or source changes during approval are stale; no new sibling is swept in", async (t) => {
  for (const kind of ["content", "ignored-sibling", "untracked-sibling", "source", "ancestor-link"]) await t.test(kind, async (st) => {
    const f = nestedFixture(st); f.artifact("src/meetings/__pycache__");
    failed(await f.call({}, { pluginCard: async () => {
      if (kind === "content") writeFileSync(join(f.path, "src/meetings/__pycache__/cache"), "changed");
      if (kind === "ignored-sibling") writeFileSync(join(f.path, "src/meetings/other.pyc"), "not approved");
      if (kind === "untracked-sibling") writeFileSync(join(f.path, "src/meetings/notes.txt"), "not approved");
      if (kind === "source") writeFileSync(join(f.path, "src/meetings/main.py"), "source work");
      if (kind === "ancestor-link") { renameSync(join(f.path, "src/meetings"), join(f.root, "moved")); symlinkSync(join(f.root, "moved"), join(f.path, "src/meetings")); }
      return "approve";
    } }), /resources changed|Stale operation|Unknown cleanup resource|source changes|untracked files|symlink|exact directory entry/);
    assert.equal(existsSync(join(f.path, "src/meetings/__pycache__")), true); assert.equal(f.receipts.at(-1).effectStarted, false);
    assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
  });
});
nestedTest("nested parent metadata remains strict before approval and for parents without completed deletions", async (t) => {
  for (const stage of ["approval", "partial-direct-parent", "partial-ancestor"]) await t.test(stage, async (st) => {
    const f = nestedFixture(st); f.artifact("src/meetings/__pycache__"); f.artifact("src/other/__pycache__");
    const roots = ["src/meetings/__pycache__", "src/other/__pycache__"];
    f.set({ cleanupFeature: "ask", approvedArtifactRoots: roots.join(",") });
    let changed = false;
    const change = () => {
      changed = true;
      const path = stage === "partial-ancestor" ? "src" : "src/other";
      utimesSync(join(f.path, path), new Date(1), new Date(1));
    };
    const result = await f.call({}, {
      pluginCard: async () => { if (stage === "approval") change(); return "approve"; },
      isDirectoryInUse: () => { if (stage !== "approval" && !changed && !existsSync(join(f.path, roots[0]))) change(); return false; },
    });
    failed(result, /resources changed|Stale operation/); assert.equal(changed, true);
    assert.equal(result.details.effects.length, stage === "approval" ? 0 : 1);
    assert.equal(existsSync(join(f.path, roots[1])), true); assert.equal(readFileSync(join(f.path, "src/meetings/main.py"), "utf8"), "# tracked source\n");
  });
});
nestedTest("nested partial cleanup records one deletion and retains a newly appearing unapproved sibling", async (t) => {
  const f = nestedFixture(t); const roots = ["src/meetings/__pycache__", "src/meetings/main.pyc"];
  f.artifact(roots[0]); writeFileSync(join(f.path, roots[1]), "generated"); f.set({ cleanupFeature: "allow", approvedArtifactRoots: roots.join(",") });
  let injected = false;
  const result = await f.call({}, { isDirectoryInUse: () => {
    if (!injected && !existsSync(join(f.path, roots[0]))) { injected = true; writeFileSync(join(f.path, "src/meetings/new.pyc"), "not reviewed"); }
    return false;
  } });
  failed(result, /Unknown cleanup resource|resources changed/); assert.equal(result.details.effects.length, 1);
  assert.equal(existsSync(join(f.path, roots[1])), true); assert.equal(readFileSync(join(f.path, "src/meetings/new.pyc"), "utf8"), "not reviewed");
  assert.equal(f.receipts.at(-1).effectStarted, true); assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
});
nestedTest("discovery coalesces an explicit child with Git's wholly ignored directory, displaying the exact parent once", async (t) => {
  const f = nestedFixture(t); f.artifact("src/meetings/__pycache__");
  const result = await f.call({ artifactRoots: ["src/meetings/__pycache__/cache"] }); passed(result);
  const fields = f.cards[0].sections.flatMap((section) => section.fields ?? []).filter((field) => /SHA256/.test(field.value));
  assert.deepEqual(fields.map((field) => field.label), ["src/meetings/__pycache__"]); assert.equal(result.details.effects.length, 3);
});

nestedTest("discovery cannot hide a missing, aliased or symlink explicit child", async (t) => {
  for (const leaf of ["missing", "CACHE", "link"]) await t.test(leaf, async (st) => {
    const f = nestedFixture(st); f.artifact("src/meetings/__pycache__");
    if (leaf === "link") symlinkSync(join(f.repo, "source"), join(f.path, "src/meetings/__pycache__/link"));
    failed(await f.call({ artifactRoots: [`src/meetings/__pycache__/${leaf}`] }, { pluginCard: () => assert.fail("Invalid explicit roots must not ask") }), /exact directory entry|symlink/);
    assert.equal(existsSync(join(f.path, "src/meetings/__pycache__/cache")), true);
    assert.equal(f.receipts.length, 0); assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
  });
});
nestedTest("nested deletion holds the original physical parent if an ancestor is swapped at the rm boundary", async (t) => {
  const f = nestedFixture(t); const root = "scratch/generated/cache.pyc";
  mkdirSync(join(f.path, "scratch/generated"), { recursive: true }); writeFileSync(join(f.path, root), "approved bytecode");
  const outside = join(f.root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "cache.pyc"), "external file must survive");
  let swapped = false; const effects = [], dispatched = [];
  const access = nativeCleanupAccess(f.repo, { removeArtifact: async (path) => {
    assert.ok(path.startsWith("/proc/self/fd/"), "Deletion must use the held physical parent");
    swapped = true;
    renameSync(join(f.path, "scratch/generated"), join(f.root, "moved-generated"));
    symlinkSync(outside, join(f.path, "scratch/generated"));
    await rm(path, { recursive: true });
  } });
  const op = { ...f.op, artifactRoots: [root], removeWorktree: false, deleteBranch: false };
  const policy = readPluginSettings(manifest, f.repo).effective;
  const snapshot = await captureCleanup(f.repo, op, policy, access);
  await assert.rejects(performCleanup(f.repo, op, policy, access, snapshot, () => {},
    async () => assert.fail("Artifact-only cleanup must not dispatch Git"), effects,
    (description) => dispatched.push(description), createCleanupBudget()), /source changes|untracked files|Unknown cleanup resource|resources changed/);
  assert.equal(swapped, true); assert.equal(effects.length, 1); assert.equal(dispatched.length, 1);
  assert.equal(readFileSync(join(outside, "cache.pyc"), "utf8"), "external file must survive");
  assert.equal(existsSync(join(f.root, "moved-generated/cache.pyc")), false, "Only the originally approved file was removed");
  assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
});
test("nested cleanup fails closed before approval without no-follow directory-handle support", async (t) => {
  const f = nestedFixture(t); f.artifact("src/meetings/__pycache__");
  // Keep the default platform-probe bridge: a false injected predicate alone
  // would not prove the real supportsNestedCleanup probe notices missing proc-fd.
  const originalExists = fs.existsSync;
  const mocked = t.mock.method(fs, "existsSync", (path) => path === "/proc/self/fd" ? false : originalExists(path));
  syncBuiltinESMExports();
  try {
    const { executeGitOperation: execute } = await createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import("./server.ts");
    failed(await execute(f.repo, f.op, { ...f.ui, pluginCard: () => assert.fail("Unsupported deletion must not ask") }), /Linux no-follow directory handles/);
    assert.equal(f.receipts.length, 0); assert.equal(existsSync(join(f.path, "src/meetings/__pycache__/cache")), true);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

test("browser cleanup top and nested five-root tuples keep one-time consent, native identity and durable no-replay outcome", async (t) => {
  const { reviewEntry, reviewPreview, reviewManifest, reviewStream } = await jiti.import("../../lib/plugins/review-store.ts");
  // Native storage download API, not HTTP/browser historical-download proof.
  const download = async (ref, entry) => {
    const stream = await reviewStream(ref, entry);
    if (!stream) return Buffer.alloc(0);
    const closed = finished(stream, { cleanup: true }); void closed.catch(() => {});
    const chunks = [];
    try { for await (const chunk of stream) chunks.push(Buffer.from(chunk)); }
    finally { stream.destroy(); await closed; }
    assert.equal(stream.closed, true); assert.equal(stream.fd, null);
    return Buffer.concat(chunks);
  };
  const { readOperationReceipt, collapseOperationReceipts } = await jiti.import("../../lib/operation-receipts.ts");
  const { acquireDirectoryReservation, assertDirectoryAdmissionAllowed } = await jiti.import("../../lib/directory-reservations.ts");
  for (const nested of [false, true]) await t.test(nested ? "nested" : "top", { skip: nested && process.platform !== "linux" }, async st => {
    const f = fixture(st);
    // Reuse the native fixture, but retain both original tracked siblings in BOTH tuples.
    for (const [name, body] of [["src/meetings/main.py", "# tracked sibling, not a cleanup artifact\n"], ["src/other/main.py", "# second tracked sibling\n"]]) {
      mkdirSync(join(f.path, name, ".."), { recursive: true }); writeFileSync(join(f.path, name), body);
    }
    writeFileSync(join(f.path, ".gitignore"), readFileSync(join(f.path, ".gitignore"), "utf8") + "__pycache__/\n*.pyc\n");
    git(f.path, "add", "."); git(f.path, "commit", "-qm", "Tracked siblings and nested ignores");
    git(f.repo, "merge", "--no-ff", "--no-edit", "feature");
    f.op.featureTip = git(f.path, "rev-parse", "HEAD"); f.op.integrationCommit = git(f.repo, "rev-parse", "HEAD");
    const directories = nested ? ["node_modules", "src/meetings/__pycache__", "src/other/__pycache__"] : ["node_modules", ".codegraph", ".next", "test-results"];
    const files = ["next-env.d.ts", ...(nested ? ["src/meetings/main.pyc"] : [])], roots = [...directories, ...files];
    for (const name of directories) { mkdirSync(join(f.path, name), { recursive: true }); writeFileSync(join(f.path, name, "generated"), "fixture artifact"); }
    writeFileSync(join(f.path, "next-env.d.ts"), "/// <reference types=\"next\" />\n");
    if (nested) writeFileSync(join(f.path, "src/meetings/main.pyc"), "fixture bytecode");
    f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
    const settings = f.settingsBytes(), saved = join(f.root, "receipts.jsonl");
    const identity = path => { const s = lstatSync(path); return [s.dev, s.ino, s.mode]; };
    const bytes = path => readFileSync(path).toString("hex");
    const state = () => ({ refs: git(f.repo, "show-ref"), registrations: git(f.repo, "worktree", "list", "--porcelain"),
      path: identity(f.path), administrative: bytes(join(f.path, ".git")), head: git(f.path, "rev-parse", "HEAD"),
      index: bytes(git(f.path, "rev-parse", "--path-format=absolute", "--git-path", "index")),
      artifacts: roots.map(name => [name, identity(join(f.path, name)), bytes(join(f.path, directories.includes(name) ? `${name}/generated` : name))]),
      source: [f.repo, f.path].flatMap(path => ["src/meetings/main.py", "src/other/main.py"].map(name => [path, name, identity(join(path, name)), bytes(join(path, name))])) });
    const before = state(), main = git(f.repo, "rev-parse", "main"), mainIdentity = identity(f.repo);
    const disk = [], cards = [];
    const record = (id, receipt) => {
      f.ui.operationReceipt(id, receipt);
      disk.push(snapshotOperationReceipt(id, receipt, disk.length + 1));
      writeFileSync(saved, disk.map(value => JSON.stringify(value)).join("\n") + "\n", { mode: 0o600 });
    };
    const inventory = card => card.sections.flatMap(s => s.fields ?? []).filter(field => /SHA256/.test(field.value));
    const checkCard = async card => {
      validatePluginCard(card); cards.push(structuredClone(card));
      assert.equal(card.title, "Clean up integrated Git feature"); assert.equal(card.patch, undefined);
      assert.deepEqual(inventory(card).map(field => field.label).sort(), [...roots].sort());
      for (const field of inventory(card)) {
        assert.match(field.value, /Needs one-time approval/); assert.match(field.value, /entries · \d+ bytes · SHA256 [a-f0-9]{64}$/);
        if (files.includes(field.label)) assert.match(field.value, /1 entries · /);
      }
      // Bundle identity covers data, entry metadata AND offsets; validate that
      // domain through the public API rather than hashing a text concatenation.
      assert.deepEqual(await reviewManifest(card.review, "git-workflow"), {
        version: 1, pluginId: "git-workflow", operationId: card.operationId,
        entries: card.review.entries, bytes: card.review.bytes, sha256: card.review.sha256,
      });
      assert.equal(card.review.entries, 1, "field-only cleanup has one exact metadata entry");
      const entry = await reviewEntry(card.review, 0), exact = await reviewPreview(card.review, entry);
      assert.equal(exact.complete, true);
      assert.equal(entry.kind, "text"); assert.equal(entry.start, 0);
      const data = JSON.parse(exact.text); assert.deepEqual(data.operation, f.op);
      assert.deepEqual(inventory(data.presentation), inventory(card));
      // Entry SHA binds entry bytes. The reference SHA above binds the bundle.
      const exactBytes = Buffer.from(exact.text);
      assert.equal(exactBytes.length, entry.bytes); assert.equal(exactBytes.length, card.review.bytes);
      assert.equal(createHash("sha256").update(exactBytes).digest("hex"), entry.sha256);
      assert.deepEqual(await download(card.review, entry), exactBytes);
      assert.deepEqual(await download(card.review), exactBytes, "complete native download retains exact cleanup review");
    };
    const native = { operationReceipt: record,
      // This fixture has no sessions/terminals. Real reservation, not native-idle proof.
      reserveDirectory: path => acquireDirectoryReservation(path, () => false) };
    const kept = await f.call({}, { ...native, pluginCard: async (_id, card) => {
      await checkCard(card); assert.equal(card.actions.find(a => a.id === "reject").label, "Keep resources"); return "reject";
    } });
    failed(kept, /not approved/); assert.deepEqual(state(), before); assert.equal(f.settingsBytes(), settings);
    assert.equal(disk.at(-1).phase, "cancelled"); assert.equal(disk.at(-1).effectStarted, false);
    const approved = await f.call({}, { ...native, pluginCard: async (_id, card) => {
      await checkCard(card);
      assert.notEqual(card.operationId, cards[0].operationId); assert.notEqual(card.review.id, cards[0].review.id);
      assert.deepEqual(state(), before, "fresh capture keeps exact native incarnation through review");
      assert.deepEqual(inventory(card), inventory(cards[0])); return "approve";
    } });
    passed(approved); assert.equal(cards.length, 2); assert.equal(existsSync(f.path), false);
    assert.equal(git(f.repo, "branch", "--list", "feature"), ""); assert.equal(git(f.repo, "rev-parse", "main"), main);
    assert.equal(git(f.repo, "show-ref"), before.refs.split("\n").filter(line => !line.endsWith(" refs/heads/feature")).join("\n"));
    assert.equal(git(f.repo, "worktree", "list", "--porcelain"), before.registrations.split("\n\n").filter(record => !record.startsWith(`worktree ${f.path}\n`)).join("\n\n"));
    assert.deepEqual(identity(f.repo), mainIdentity); assert.equal(f.settingsBytes(), settings);
    for (const name of ["src/meetings/main.py", "src/other/main.py"]) {
      const expected = before.source.find(row => row[0] === f.repo && row[1] === name);
      assert.deepEqual(identity(join(f.repo, name)), expected[2]); assert.equal(bytes(join(f.repo, name)), expected[3]);
    }
    assert.equal(approved.details.effects.length, roots.length + 2);
    for (const name of roots) assert.equal(approved.details.effects.includes(`Removed generated artifact: ${name}`), true);
    assert.equal(approved.details.effects.includes(`Removed worktree: ${f.path}`), true);
    assert.equal(approved.details.effects.includes(`Deleted local branch: feature at ${f.op.featureTip}`), true);
    assert.equal(git(f.repo, "worktree", "list", "--porcelain").includes(f.path), false);
    assertDirectoryAdmissionAllowed(f.path); // release observed after whole executor promise
    const reload = () => readFileSync(saved, "utf8").trim().split("\n").map(line => readOperationReceipt(JSON.parse(line)));
    const history = reload(); assert.equal(history.every(Boolean), true);
    const messages = history.map(details => ({ role: "custom", customType: "pi-web:operation-receipt", details }));
    const collapsed = collapseOperationReceipts({ messages, entryIds: messages.map((_, i) => String(i)) });
    assert.equal(collapsed.messages.length, 2);
    const outcome = collapsed.messages.find(m => m.details.operationId === cards[1].operationId).details;
    assert.equal(outcome.phase, "succeeded"); assert.equal(outcome.authorization.mode, "ask");
    assert.equal(outcome.authorization.decision, "user-approved"); assert.equal(outcome.authorization.source, "one-time artifacts (project allow)");
    assert.deepEqual(outcome.card.actions, []); assert.deepEqual(inventory(outcome.card), inventory(cards[1]));
    const finalRefs = git(f.repo, "show-ref"), count = disk.length;
    reload(); reload(); assert.equal(disk.length, count); assert.equal(cards.length, 2);
    assert.equal(git(f.repo, "show-ref"), finalRefs); assert.equal(f.settingsBytes(), settings);
  });
});

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
test("original generated directories and next-env.d.ts share one approval without preconfigured permission", async (t) => {
  for (const [mode, selection] of [["ask", "explicit"], ["allow", "discovered"]]) await t.test(`${mode}: ${selection}`, async (st) => {
    const f = fixture(st); f.set({ cleanupFeature: mode, approvedArtifactRoots: null });
    const roots = [".codegraph", ".next", "node_modules", "test-results", "next-env.d.ts"];
    for (const root of roots.slice(0, -1)) f.artifact(root);
    writeFileSync(join(f.path, "next-env.d.ts"), "/// <reference types=\"next\" />\n");
    const beforeSettings = f.settingsBytes();
    const result = await f.call({ artifactRoots: selection === "explicit" ? roots : [] }); passed(result);
    assert.equal(f.approvals(), 1, "operation and artifacts require one combined card");
    const inventory = f.cards[0].sections.flatMap((section) => section.fields ?? []).filter((field) => /SHA256/.test(field.value));
    assert.deepEqual(inventory.map((field) => field.label).sort(), [...roots].sort());
    assert.match(inventory.find((field) => field.label === "next-env.d.ts").value, /1 entries · \d+ bytes · SHA256/);
    assert.equal(existsSync(f.path), false); assert.equal(git(f.repo, "branch", "--list", "feature"), "");
    assert.equal(result.details.effects.length, roots.length + 2);
    for (const root of roots) assert.ok(result.details.effects.some((effect) => effect.includes(root)), `Missing deletion effect for ${root}`);
    assert.ok(f.receipts.every((receipt) => receipt.authorization.mode === "ask"));
    const receipt = f.receipts.at(-1);
    assert.equal(receipt.phase, "succeeded"); assert.equal(receipt.authorization.decision, "user-approved");
    assert.equal(receipt.authorization.source, `one-time artifacts (project ${mode})`); assert.equal(receipt.toolCallId, "cleanup-call");
    assert.equal(new Set(f.receipts.map((entry) => entry.operationId)).size, 1);
    assert.equal(f.settingsBytes(), beforeSettings, "one-time approval must never write settings");
  });
});
test("Allow stays noninteractive only when every selected or discovered artifact is permitted, including regular files", async (t) => {
  for (const selection of ["explicit", "discovered"]) await t.test(selection, async (st) => {
    const f = fixture(st); f.artifact("node_modules"); writeFileSync(join(f.path, "next-env.d.ts"), "generated types\n");
    f.set({ cleanupFeature: "allow", approvedArtifactRoots: "node_modules, next-env.d.ts" });
    const beforeSettings = f.settingsBytes();
    const result = await f.call({ artifactRoots: selection === "explicit" ? ["node_modules", "next-env.d.ts"] : [] }, { pluginCard: () => assert.fail("All artifacts are already permitted") });
    passed(result); assert.equal(result.details.effects.length, 4); assert.equal(existsSync(f.path), false);
    assert.equal(f.receipts.at(-1).authorization.mode, "allow");
    assert.equal(f.receipts.at(-1).authorization.decision, "policy-authorized");
    assert.equal(f.settingsBytes(), beforeSettings);
  });
});
test("one unpermitted artifact forces Ask under Allow and rejection preserves every resource", async (t) => {
  for (const answer of ["approve", "reject", null]) await t.test(String(answer), async (st) => {
    const f = fixture(st); f.artifact("node_modules"); writeFileSync(join(f.path, "next-env.d.ts"), "generated types\n");
    f.set({ cleanupFeature: "allow", approvedArtifactRoots: "node_modules" });
    const beforeSettings = f.settingsBytes(); let approvals = 0;
    const result = await f.call({}, { pluginCard: async (_id, card) => {
      approvals++; const preview = JSON.stringify(card);
      assert.ok(preview.includes("node_modules")); assert.ok(preview.includes("next-env.d.ts"));
      assert.equal(f.receipts[0].authorization.mode, "ask"); assert.equal(f.receipts[0].authorization.decision, "pending");
      return answer;
    } });
    assert.equal(approvals, 1); assert.equal(f.settingsBytes(), beforeSettings);
    const receipt = f.receipts.at(-1); assert.equal(receipt.authorization.mode, "ask");
    assert.equal(receipt.authorization.source, "one-time artifacts (project allow)");
    if (answer === "approve") {
      passed(result); assert.equal(existsSync(f.path), false); assert.equal(receipt.authorization.decision, "user-approved");
    } else {
      failed(result, /not approved/); assert.equal(receipt.authorization.decision, "not-approved");
      assert.equal(receipt.phase, "cancelled"); assert.equal(receipt.effectStarted, false);
      assert.equal(readFileSync(join(f.path, "next-env.d.ts"), "utf8"), "generated types\n");
      assert.equal(existsSync(join(f.path, "node_modules", "cache")), true);
      assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
    }
  });
});
test("Allow cannot delete unpermitted discovered resources without the live approval UI", async (t) => {
  const f = fixture(t); f.artifact("unknown"); f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
  failed(await f.call({}, { pluginCard: undefined }), /Ask requires/);
  assert.equal(existsSync(join(f.path, "unknown")), true); assert.equal(f.receipts.at(-1).effectStarted, false);
});
test("nonignored generated files and directories need explicit selection, not a familiar name or allowlist alone", async (t) => {
  for (const kind of ["file", "directory"]) await t.test(kind, async (st) => {
    const f = fixture(st); const root = kind === "file" ? "generated.d.ts" : "generated-output";
    if (kind === "file") writeFileSync(join(f.path, root), "generated\n"); else f.artifact(root);
    f.set({ cleanupFeature: "allow", approvedArtifactRoots: root });
    failed(await f.call({}, { pluginCard: () => assert.fail("Unknown untracked resources must not be offered") }), /untracked files|Unknown cleanup/);
    assert.equal(existsSync(join(f.path, root)), true);
    f.set({ approvedArtifactRoots: null }); const beforeSettings = f.settingsBytes();
    passed(await f.call({ artifactRoots: [root], removeWorktree: false, deleteBranch: false }));
    assert.equal(f.approvals(), 1); assert.equal(existsSync(join(f.path, root)), false);
    assert.equal(existsSync(f.path), true); assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
    assert.equal(f.settingsBytes(), beforeSettings);
  });
});
test("explicit generated selection does not authorize an unrelated untracked file", async (t) => {
  const f = fixture(t); writeFileSync(join(f.path, "next-env.d.ts"), "generated\n");
  writeFileSync(join(f.path, "personal-notes.txt"), "keep me\n"); f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
  failed(await f.call({ artifactRoots: ["next-env.d.ts"] }, { pluginCard: () => assert.fail("Unlisted files block preview") }), /untracked files|Unknown cleanup/);
  assert.equal(readFileSync(join(f.path, "personal-notes.txt"), "utf8"), "keep me\n");
  assert.equal(existsSync(join(f.path, "next-env.d.ts")), true);
});
test("target advancement alone retains cleanup approval when integration remains reachable", async (t) => {
  const f = fixture(t);
  passed(await f.call({}, { pluginCard: async () => { git(f.repo, "commit", "--allow-empty", "-qm", "Later unrelated work"); return "approve"; } }));
});
test("unselected untracked artifacts, source changes, locks and unsafe roots block before approval", async (t) => {
  for (const kind of ["unknown", "source", "tracked-file", "tracked-directory", "locked", "active", "nested", "symlink", "file-symlink", "keep", "keep-artifacts", "deny", "feature-tip", "integration"]) await t.test(kind, async (st) => {
    const f = fixture(st); let extra = {}; let custom = { pluginCard: () => assert.fail("Unsafe preview must not ask") }; let pattern;
    if (kind === "unknown") { f.artifact("unlisted"); pattern = /Unknown cleanup|untracked files/; }
    if (kind === "source") { writeFileSync(join(f.path, "source"), "local work"); pattern = /source changes/; }
    if (kind === "tracked-file") { extra.artifactRoots = ["source"]; pattern = /include or alias tracked source/; }
    if (kind === "tracked-directory") {
      mkdirSync(join(f.path, "src")); writeFileSync(join(f.path, "src", "index.ts"), "export {};\n");
      git(f.path, "add", "src"); git(f.path, "commit", "-qm", "Tracked directory");
      git(f.repo, "merge", "--no-ff", "--no-edit", "feature");
      extra = { artifactRoots: ["src"], featureTip: git(f.path, "rev-parse", "HEAD"), integrationCommit: git(f.repo, "rev-parse", "HEAD") };
      pattern = /include or alias tracked source/;
    }
    if (kind === "locked") { git(f.repo, "worktree", "lock", f.path); pattern = /locked/; }
    if (kind === "active") { custom.isDirectoryInUse = () => true; pattern = /active use/; }
    if (kind === "nested") { f.artifact("node_modules"); mkdirSync(join(f.path, "node_modules", ".git")); extra.artifactRoots = ["node_modules"]; pattern = /Nested repository/; }
    if (kind === "symlink") { symlinkSync(f.root, join(f.path, "node_modules")); extra.artifactRoots = ["node_modules"]; pattern = /untracked files|symlink|existing generated/; }
    if (kind === "file-symlink") { symlinkSync(join(f.repo, "source"), join(f.path, "next-env.d.ts")); extra.artifactRoots = ["next-env.d.ts"]; pattern = /symlink|existing generated/; }
    if (kind === "keep") { f.set({ cleanupWorktree: "keep" }); pattern = /Keep choice/; }
    if (kind === "keep-artifacts") { f.artifact("node_modules"); f.set({ cleanupFeature: "allow", cleanupArtifacts: "keep" }); pattern = /Keep choice/; }
    if (kind === "deny") { f.artifact("unknown"); f.set({ cleanupFeature: "deny", approvedArtifactRoots: null }); pattern = /denied/; }
    if (kind === "feature-tip") { git(f.path, "commit", "--allow-empty", "-qm", "New feature work"); pattern = /Feature branch changed/; }
    if (kind === "integration") { extra.integrationCommit = "a".repeat(40); pattern = /bad object|Not a valid|Command failed/; }
    failed(await f.call(extra, custom), pattern); assert.equal(existsSync(f.path), true);
  });
});
test("metadata grammar rejects both explicit roots and configured authority before receipts or approval", async (t) => {
  // Both public root and configured-list wiring; the full spelling table is pure.
  for (const root of [".GIT"]) await t.test(JSON.stringify(root), async (st) => {
    const f = fixture(st); f.set({ cleanupFeature: "allow" });
    const metadata = readFileSync(join(f.path, ".git"), "utf8");
    failed(await f.call({ artifactRoots: [root] }), /distinct literal relative generated files or directories/);
    if (root) {
      f.set({ approvedArtifactRoots: root });
      failed(await f.call(), /Invalid configured generated artifact list/);
    }
    assert.equal(f.approvals(), 0); assert.equal(f.receipts.length, 0);
    assert.equal(readFileSync(join(f.path, ".git"), "utf8"), metadata);
    assert.equal(readFileSync(join(f.path, "source"), "utf8"), "feature\n");
    assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
  });
});
test("alternate-case artifact spellings must match an exact enumerated top-level entry", async (t) => {
  for (const root of ["node_modules", "next-env.d.ts"]) await t.test(root, async (st) => {
    const f = fixture(st);
    if (root === "node_modules") f.artifact(root); else writeFileSync(join(f.path, root), "generated\n");
    const alias = root.toUpperCase(); f.set({ cleanupFeature: "allow", approvedArtifactRoots: `${root}, ${alias}` });
    failed(await f.call({ artifactRoots: [alias] }), /Artifact must match an exact directory entry|overlap or alias/);
    assert.equal(f.approvals(), 0); assert.equal(f.receipts.length, 0);
    assert.equal(existsSync(join(f.path, root)), true);
    assert.equal(readFileSync(join(f.path, root === "node_modules" ? "node_modules/cache" : root), "utf8"), "generated" + (root === "node_modules" ? "" : "\n"));
    assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
  });
});
test("case and trailing-dot aliases of tracked files or directories are conservatively refused", async (t) => {
  for (const kind of ["file", "directory"]) for (const spelling of ["case", "trailing-dot", "both"]) await t.test(`${kind}: ${spelling}`, async (st) => {
    const f = fixture(st); const trackedRoot = kind === "file" ? "source" : "src";
    const extra = {};
    if (kind === "directory") {
      mkdirSync(join(f.path, trackedRoot)); writeFileSync(join(f.path, trackedRoot, "index.ts"), "export {};\n");
      git(f.path, "add", trackedRoot); git(f.path, "commit", "-qm", "Tracked directory");
      git(f.repo, "merge", "--no-ff", "--no-edit", "feature");
      extra.featureTip = git(f.path, "rev-parse", "HEAD"); extra.integrationCommit = git(f.repo, "rev-parse", "HEAD");
    }
    const alias = spelling === "case" ? trackedRoot.toUpperCase() : spelling === "trailing-dot" ? `${trackedRoot}.` : `${trackedRoot.toUpperCase()}...`;
    // Linux permits these distinct literal entries. Never overwrite the tracked
    // resource if this test runs on a filesystem that resolves the alias itself.
    if (existsSync(join(f.path, alias))) { st.skip("Requires distinct case/trailing-dot directory entries"); return; }
    writeFileSync(join(f.repo, ".git", "info", "exclude"), `/${alias}\n`);
    if (kind === "file") writeFileSync(join(f.path, alias), "generated alias\n"); else f.artifact(alias, "generated alias\n");
    assert.equal(git(f.path, "check-ignore", "--", alias), alias);
    assert.equal(git(f.path, "status", "--porcelain"), "");
    f.set({ cleanupFeature: "allow", approvedArtifactRoots: alias });
    failed(await f.call({ ...extra, artifactRoots: [alias] }), /include or alias tracked source/);
    assert.equal(f.approvals(), 0); assert.equal(f.receipts.length, 0);
    assert.equal(readFileSync(join(f.path, kind === "file" ? trackedRoot : `${trackedRoot}/index.ts`), "utf8"), kind === "file" ? "feature\n" : "export {};\n");
    assert.equal(readFileSync(join(f.path, kind === "file" ? alias : `${alias}/cache`), "utf8"), "generated alias\n");
    assert.equal(git(f.repo, "rev-parse", "feature"), extra.featureTip ?? f.op.featureTip);
  });
});
test("nested Git metadata aliases are refused inside otherwise permitted artifacts", async (t) => {
  for (const name of [".GIT", ".git.", ".GiT..."]) await t.test(name, async (st) => {
    const f = fixture(st); f.artifact("node_modules"); f.set({ cleanupFeature: "allow" });
    mkdirSync(join(f.path, "node_modules", name));
    writeFileSync(join(f.path, "node_modules", name, "config"), "repository metadata\n");
    failed(await f.call(), /Nested repository in cleanup resources/);
    assert.equal(f.approvals(), 0); assert.equal(f.receipts.length, 0);
    assert.equal(readFileSync(join(f.path, "node_modules", name, "config"), "utf8"), "repository metadata\n");
    assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
  });
});
test("literal regular artifacts have nonzero inventory entries even when empty", async (t) => {
  const f = fixture(t); writeFileSync(join(f.path, "next-env.d.ts"), ""); mkdirSync(join(f.path, ".next"));
  passed(await f.call({ artifactRoots: ["next-env.d.ts", ".next"], removeWorktree: false, deleteBranch: false }));
  assert.equal(f.approvals(), 1);
  const inventory = f.cards[0].sections.flatMap((section) => section.fields ?? []).filter((field) => /SHA256/.test(field.value));
  assert.deepEqual(inventory.map((field) => field.label), ["next-env.d.ts", ".next"]);
  for (const field of inventory) assert.match(field.value, / · 1 entries · 0 bytes · SHA256 [a-f0-9]{64}$/);
  assert.equal(existsSync(join(f.path, "next-env.d.ts")), false); assert.equal(existsSync(join(f.path, ".next")), false);
  assert.equal(readFileSync(join(f.path, "source"), "utf8"), "feature\n");
  assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
});
test("content changed during approval invalidates bounded cleanup, not just porcelain status", async (t) => {
  const f = fixture(t); f.artifact("node_modules", "before");
  failed(await f.call({ artifactRoots: ["node_modules"] }, { pluginCard: async () => { writeFileSync(join(f.path, "node_modules", "cache"), "after!"); return "approve"; } }), /resources changed/);
  assert.equal(existsSync(f.path), true); assert.equal(f.receipts.at(-1).phase, "failed"); assert.equal(f.receipts.at(-1).effectStarted, false);
});
test("forced approval is stale when a regular file changes or a new ignored artifact appears", async (t) => {
  for (const kind of ["changed-file", "new-file", "new-directory"]) await t.test(kind, async (st) => {
    const f = fixture(st); f.artifact("node_modules"); writeFileSync(join(f.path, "next-env.d.ts"), "before\n");
    f.set({ cleanupFeature: "allow", approvedArtifactRoots: null }); let approvals = 0;
    const beforeSettings = f.settingsBytes();
    failed(await f.call({}, { pluginCard: async () => {
      approvals++;
      if (kind === "changed-file") writeFileSync(join(f.path, "next-env.d.ts"), "after!\n");
      else if (kind === "new-file") writeFileSync(join(f.path, "node_modules", "new-cache"), "new artifact\n");
      else f.artifact("test-results");
      return "approve";
    } }), /resources changed|Stale operation|Unknown cleanup resource/);
    assert.equal(approvals, 1); assert.equal(existsSync(join(f.path, "node_modules", "cache")), true);
    assert.equal(existsSync(join(f.path, "next-env.d.ts")), true);
    if (kind === "new-directory") assert.equal(existsSync(join(f.path, "test-results", "cache")), true);
    assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
    assert.equal(f.receipts.at(-1).effectStarted, false); assert.equal(f.receipts.at(-1).phase, "failed");
    assert.equal(f.settingsBytes(), beforeSettings);
  });
});
test("new top-level ignored file after approval is not silently discovered and deleted", async (t) => {
  const f = fixture(t); f.artifact("node_modules"); f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
  failed(await f.call({}, { pluginCard: async () => {
    writeFileSync(join(f.path, "next-env.d.ts"), "not reviewed\n"); return "approve";
  } }), /resources changed|Stale operation|Unknown cleanup resource/);
  assert.equal(readFileSync(join(f.path, "next-env.d.ts"), "utf8"), "not reviewed\n");
  assert.equal(existsSync(join(f.path, "node_modules")), true); assert.equal(f.receipts.at(-1).effectStarted, false);
});
test("discovered roots are frozen before effects; a new ignored root after one deletion is retained", async (t) => {
  const f = fixture(t); f.artifact("node_modules"); f.set({ cleanupFeature: "allow", approvedArtifactRoots: "node_modules, test-results" });
  const result = await f.call({}, { pluginCard: () => assert.fail("Initial inventory is permitted"), isDirectoryInUse: () => {
    if (!existsSync(join(f.path, "node_modules")) && !existsSync(join(f.path, "test-results"))) f.artifact("test-results");
    return false;
  } });
  failed(result, /resources changed|root changed|Unknown cleanup resource/); assert.equal(result.details.effects.length, 1);
  assert.equal(existsSync(join(f.path, "node_modules")), false); assert.equal(existsSync(join(f.path, "test-results")), true);
  assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
  assert.equal(f.receipts.at(-1).effectStarted, true); assert.equal(f.receipts.at(-1).phase, "failed");
});
test("nested artifact symlinks are removed without following their external targets", async (t) => {
  const f = fixture(t); f.artifact("node_modules");
  const outside = join(f.root, "outside.txt"); writeFileSync(outside, "external source\n");
  symlinkSync(outside, join(f.path, "node_modules", "external"));
  passed(await f.call()); assert.equal(readFileSync(outside, "utf8"), "external source\n");
});
test("mount boundaries still refuse discovered cleanup roots before approval", { skip: process.platform !== "linux" }, async (t) => {
  const f = fixture(t); f.artifact("node_modules"); f.set({ cleanupFeature: "allow", approvedArtifactRoots: null });
  let mountReads = 0;
  // Real inventory/identities with only mountinfo bytes supplied, including the host's actual table.
  const access = nativeCleanupAccess(f.repo, { readMountInfo: () => {
    mountReads++;
    return `${readFileSync("/proc/self/mountinfo", "utf8")}\n999 1 0:1 / ${join(f.path, "node_modules")} rw - tmpfs fixture rw\n`;
  } });
  await assert.rejects(captureCleanup(f.repo, f.op, readPluginSettings(manifest, f.repo).effective, access), /Mounted cleanup|mounted filesystem/);
  assert.ok(mountReads > 0, "The actual inventory must read the supplied mount table");
  assert.equal(f.receipts.length, 0); assert.equal(f.approvals(), 0);
  assert.equal(existsSync(join(f.path, "node_modules", "cache")), true);
  assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
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
  } }), /root changed|resources changed|Unknown cleanup resource/);
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
test("compact cleanup preview keeps the complete approved review and native effects", async (t) => {
  const f = fixture(t);
  const presentation = Object.freeze({ sectionFieldLimit: 2 });
  const roots = Array.from({ length: presentation.sectionFieldLimit + 1 }, (_, i) => `generated-${i}`);
  for (const root of roots) f.artifact(root);
  const result = await f.call({ artifactRoots: roots }, {}, { presentation });
  passed(result);
  assert.equal(f.approvals(), 1);
  assert.equal(f.receipts.at(-1).phase, "succeeded");
  const card = f.receipts[0].card;
  assert.equal(card.sections[0].fields.length, presentation.sectionFieldLimit, "compact preview obeys the application section budget");
  assert.match(card.sections[0].text, /Showing 2 of 3 items/);
  assert.deepEqual(card.fields.map(field => field.label), ["Repository checkout", "Integrated feature", "Verified integration", "Worktree", "Local branch"], "essential operation fields are not list-budgeted");
  assert.ok(card.review);
  const { reviewEntry, reviewPreview } = await jiti.import("../../lib/plugins/review-store.ts");
  const saved = await reviewPreview(card.review, await reviewEntry(card.review, 0));
  assert.equal(saved.complete, true);
  const exact = JSON.parse(saved.text);
  assert.deepEqual(exact.operation.artifactRoots, roots, "approval retains the complete selected operation");
  assert.deepEqual(exact.presentation.sections[0].fields.map(field => field.label), roots, "exact review is saved before preview compaction");
  assert.deepEqual(result.details.effects.filter(effect => effect.startsWith("Removed generated artifact:")), roots.map(root => `Removed generated artifact: ${root}`));
  assert.equal(existsSync(f.path), false);
  assert.equal(git(f.repo, "branch", "--list", "feature"), "");
});

test("cleanup setup preserves literal shell metacharacters and embedded newlines in native repository paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-cleanup-argv-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Windows keeps its native dispatch path and accepts neither quotes nor LF.
  const unusual = process.platform === "win32" ? " ' $(printf escaped) ; λ" : " ' \" $(printf escaped) ; λ\n";
  const repo = join(root, `repo${unusual}main`), path = join(root, `feature${unusual}linked`);
  const { featureTip, integrationCommit } = setupCleanupRepository(root, repo, path);
  assert.equal(git(path, "rev-parse", "HEAD"), featureTip);
  assert.equal(git(repo, "rev-parse", "HEAD"), integrationCommit);
  assert.equal(git(repo, "rev-parse", "feature"), featureTip);
  const parents = git(repo, "rev-list", "--parents", "-1", integrationCommit).split(" ");
  assert.equal(parents.length, 3); assert.equal(parents[2], featureTip);
  assert.equal(git(repo, "show", "-s", "--format=%s", parents[1]), "Base");
  assert.equal(git(repo, "show", "-s", "--format=%s", featureTip), "Feature");
  assert.equal(git(repo, "config", "user.name"), "Fixture");
  assert.equal(git(path, "config", "user.email"), "fixture@example.invalid");
  assert.equal(lstatSync(join(path, ".git")).isFile(), true, "native linked-worktree administration");
  const registrations = git(repo, "worktree", "list", "--porcelain", "-z").split("\0");
  const registeredPath = process.platform === "win32" ? path.replaceAll("\\", "/") : path;
  assert.equal(registrations.includes(`worktree ${registeredPath}`), true);
  for (const cwd of [repo, path]) {
    assert.equal(readFileSync(join(cwd, "source"), "utf8"), "feature\n");
    assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "node_modules/\n.codegraph/\n.next/\ntest-results/\nnext-env.d.ts\nunknown/\n");
    assert.equal(git(cwd, "status", "--porcelain"), "");
  }
});

test("cleanup setup stops at a native worktree-add failure before later writes, commits or merge", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-cleanup-setup-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"), path = join(root, "blocked-feature");
  mkdirSync(path); writeFileSync(join(path, "source"), "untouched\n");
  let failure;
  assert.throws(() => setupCleanupRepository(root, repo, path), error => { failure = error; return true; });
  assert.equal(readFileSync(join(path, "source"), "utf8"), "untouched\n", "failed setup cannot dispatch the later feature write");
  assert.equal(Number.isInteger(failure.status) && failure.status > 0, true, "native setup failure propagates");
  assert.equal(readFileSync(join(repo, "source"), "utf8"), "base\n");
  assert.equal(git(repo, "log", "--format=%s"), "Base", "no later commit or merge");
  assert.equal(git(repo, "worktree", "list", "--porcelain", "-z").split("\0").filter(value => value.startsWith("worktree ")).length, 1);
});

test("async capture identity preserves fresh initial/final observations, failure identity and replacement refusal", async (t) => {
  const cases = [["success", 0], ["null", 1], ["null", 2], ["reject", 1], ["reject", 2],
    ["missing-common", 1], ["missing-common", 2], ["replace-common", 2], ["replace-checkout", 2]];
  for (const [kind, stage] of cases) await t.test(`${kind} at ${stage}`, async (st) => {
    const pending = [], cleanups = [], sentinel = new Error("original identity observation failure");
    let undo = () => {};
    st.after(async () => {
      const errors = [], outcomes = await Promise.all(pending);
      errors.push(...outcomes.filter(value => value.error && value.error !== sentinel).map(value => value.error));
      for (const finish of [() => undo(), ...cleanups]) { try { await finish(); } catch (error) { errors.push(error); } }
      if (errors.length) throw new AggregateError(errors, "Async identity capture cleanup failed");
    });
    const f = fixture({ after: finish => cleanups.push(finish) });
    const policy = readPluginSettings(manifest, f.repo).effective;
    let calls = 0;
    const access = nativeCleanupAccess(f.repo, { project: cwd => {
      const work = (async () => {
        const common = await pluginProjectIdentityAsync(cwd);
        assert.notEqual(common, null);
        if (++calls === stage) {
          if (kind === "null") return null;
          if (kind === "reject") throw sentinel;
          if (kind === "missing-common" || kind === "replace-common") {
            const backup = join(f.root, "held-common"); renameSync(common, backup);
            if (kind === "replace-common") mkdirSync(common);
            undo = () => { if (kind === "replace-common") rmSync(common, { recursive: true }); renameSync(backup, common); };
          } else if (kind === "replace-checkout") {
            const backup = join(f.root, "held-checkout"); renameSync(cwd, backup); mkdirSync(cwd);
            symlinkSync(join(backup, ".git"), join(cwd, ".git"), process.platform === "win32" ? "junction" : "dir");
            undo = () => { rmSync(cwd, { recursive: true }); renameSync(backup, cwd); };
          }
        }
        return common;
      })();
      pending.push(work.then(value => ({ value }), error => ({ error })));
      return work;
    } });
    if (kind === "success") {
      const synchronous = await captureCleanup(f.repo, f.op, policy, nativeCleanupAccess(f.repo));
      const asynchronous = await captureCleanup(f.repo, f.op, policy, access);
      assert.equal(asynchronous.repositoryIdentity, synchronous.repositoryIdentity);
      assert.equal(asynchronous.fingerprint, synchronous.fingerprint);
    } else {
      await assert.rejects(captureCleanup(f.repo, f.op, policy, access), error => {
        if (kind === "reject") return error === sentinel;
        if (kind === "null") return /repository identity is unavailable/.test(error.message);
        if (kind === "missing-common") return error.code === "ENOENT";
        return /Repository changed during inventory/.test(error.message);
      });
    }
    assert.equal(calls, stage || 2, "both identity epochs stay independent and awaited");
    undo(); undo = () => {};
    assert.equal(git(f.repo, "rev-parse", "feature"), f.op.featureTip);
    assert.equal(git(f.repo, "rev-parse", "main"), f.op.integrationCommit);
    assert.equal(existsSync(f.path), true);
  });
});

test("async identity is observed again between real artifact effects after repository replacement", async (t) => {
  const pending = [], cleanups = [];
  let undo = () => {};
  t.after(async () => {
    const outcomes = await Promise.all(pending), errors = outcomes.filter(value => value.error).map(value => value.error);
    for (const finish of [() => undo(), ...cleanups]) { try { await finish(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, "Between-effect identity cleanup failed");
  });
  const f = fixture({ after: finish => cleanups.push(finish) });
  f.artifact("node_modules"); f.artifact(".next");
  const refs = git(f.repo, "show-ref"), registrations = git(f.repo, "worktree", "list", "--porcelain"), removed = [];
  const policy = readPluginSettings(manifest, f.repo).effective;
  const access = nativeCleanupAccess(f.repo, {
    project: cwd => {
      const work = pluginProjectIdentityAsync(cwd);
      pending.push(work.then(value => ({ value }), error => ({ error }))); return work;
    },
    removeArtifact: async path => {
      await rm(path, { recursive: true }); removed.push(path);
      const common = join(f.repo, ".git"), backup = join(f.root, "held-common");
      renameSync(common, backup); mkdirSync(common);
      undo = () => { rmSync(common, { recursive: true }); renameSync(backup, common); };
    },
  });
  const snapshot = await captureCleanup(f.repo, f.op, policy, access), effects = [];
  const [first, second] = snapshot.artifacts.map(value => value.path);
  await assert.rejects(performCleanup(f.repo, f.op, policy, access, snapshot, () => {},
    async args => git(f.repo, ...args), effects, () => {}, createCleanupBudget()), /repository identity is unavailable/);
  assert.deepEqual(removed, [join(f.path, first)]);
  assert.deepEqual(effects, [`Removed generated artifact: ${first}`]);
  assert.equal(existsSync(join(f.path, first)), false);
  assert.equal(existsSync(join(f.path, second)), true);
  assert.equal(pending.length, 5, "prepared capture and each effect retain their own fresh identity observations");
  undo(); undo = () => {};
  assert.equal(git(f.repo, "show-ref"), refs);
  assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
  assert.equal(git(f.path, "rev-parse", "HEAD"), f.op.featureTip);
  assert.equal(readFileSync(join(f.path, "source"), "utf8"), "feature\n");
});

test("Stop and disable during native identity retain the reservation through child close and prevent effects", async (t) => {
  for (const action of ["stop", "disable"]) await t.test(action, async (st) => {
    const cleanups = [];
    let work, gate;
    st.after(async () => {
      const errors = [];
      for (const finish of [() => gate?.release(), () => work, () => gate?.join(), () => gate?.restore(), ...cleanups]) {
        try { await finish(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Held identity operation cleanup failed");
    });
    const f = fixture({ after: finish => cleanups.push(finish) });
    f.set({ cleanupFeature: "allow" }); f.artifact("node_modules");
    const refs = git(f.repo, "show-ref"), registrations = git(f.repo, "worktree", "list", "--porcelain"), abort = new AbortController();
    let reserved = false, releases = 0, settled = false;
    gate = createIdentityGate(st, f.root, { shouldHold: () => reserved });
    const fresh = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
    const { executeGitOperation: execute } = await fresh.import("./server.ts");
    work = execute(f.repo, f.op, { ...f.ui, reserveDirectory: () => { reserved = true; return () => { releases++; }; } }, abort.signal)
      .then(value => { settled = true; return value; });
    await gate.ready();
    assert.equal(reserved, true); assert.equal(releases, 0); assert.equal(settled, false);
    if (action === "stop") abort.abort();
    else updatePluginSettings(manifest, "global", f.repo, { enabled: false }, []);
    await new Promise(setImmediate); // One observed event-loop opportunity, not a universal drain.
    assert.equal(gate.outcome(), undefined, "Stop/disable cannot terminate the owned native identity query");
    assert.equal(settled, false); assert.equal(releases, 0, "reservation stays held during the native query");
    gate.release();
    const result = await work;
    failed(result, action === "stop" ? /aborted|Cancelled/i : /disabled/);
    assert.equal(gate.outcome(), "released"); assert.equal(gate.child.exitCode, 0);
    assert.equal(releases, 1); assert.equal(f.receipts.at(-1).effectStarted, false);
    assert.equal(f.receipts.at(-1).phase, action === "stop" ? "cancelled" : "failed");
    assert.equal(existsSync(join(f.path, "node_modules/cache")), true);
    assert.equal(git(f.repo, "show-ref"), refs);
    assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
    assert.equal(git(f.path, "rev-parse", "HEAD"), f.op.featureTip);
    assert.equal(readFileSync(join(f.path, "source"), "utf8"), "feature\n");
  });
});
