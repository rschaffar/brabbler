import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-commit-history-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});
const fixtureWriters = new Map();
function sessionFixture(cwd, managed = false) {
  const persisted = SessionManager.create(cwd, path.join(agentDir, "sessions"));
  if (managed) snapshotFreshManagedSessionGitWorkflow(persisted, resolveGitWorkflowSettings({ enabled: true, commits: "ask" }).values);
  persisted.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
  persisted.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const id = persisted.getSessionId(); let revision = 1;
  const manager = { getSessionId: () => id, getSessionFile: () => persisted.getSessionFile(), getCwd: () => cwd,
    getHeader: () => persisted.getHeader(), getEntries: () => persisted.getEntries(), getBranch: () => persisted.getBranch(),
    getLeafId: () => persisted.getLeafId(), isPersisted: () => persisted.isPersisted(),
    appendCustomEntry: (customType, data) => { if (customType !== "pi-web:git-action") revision++; return persisted.appendCustomEntry(customType, data); } };
  fixtureWriters.set(cwd, { readSelectionRevisionSync: () => `${id}:${revision}` });
  return manager;
}
const jiti = createJiti(import.meta.url, { interopDefault: false });
const rpc = await jiti.import("./rpc-manager.ts");
const { createGitCommitExtension: createNativeGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const createGitCommitExtension = (cwd, policy) => createNativeGitCommitExtension(cwd, policy, fixtureWriters.get(cwd));
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { snapshotFreshManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { resolveGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
const { createAgentGitWorkflowExtension } = await jiti.import("./agent-git-workflow-extension.ts");
const { prepareGitCommit } = await jiti.import("./git-commit.ts");
const git = promisify(execFile);
test("agent tool gates on saved policy and context cwd; previews then commits sequentially", async (t) => {
  // Direct tool invocations lack a running SDK wrapper; exact-ID admission is
  // exercised by rpc-manager tests rather than granting a production fallback.
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-tool-commit-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.name", "Tool"]);
  await git("git", ["-C", cwd, "config", "user.email", "tool@example.invalid"]);
  await writeFile(path.join(cwd, "a"), "first\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await git("git", ["-C", cwd, "commit", "-qm", "initial"]);
  await writeFile(path.join(cwd, "a"), "second\n");
  allowFileRoot(cwd);
  let policy;
  let tool;
  const sessionManager = sessionFixture(cwd);
  createGitCommitExtension(cwd, () => policy).factory({ getActiveTools: () => ["read", "edit"], appendEntry: sessionManager.appendCustomEntry, registerTool: (registered) => { tool = registered; } });
  assert.equal(tool.executionMode, "sequential");
  const execute = (params, contextCwd = cwd) => tool.execute("id", params, undefined, undefined, { cwd: contextCwd, sessionManager });
  assert.equal((await execute({ operation: "preview", paths: ["a"] })).isError, true);
  policy = { mode: "current", onCreate: "stay", commits: "manual" };
  assert.equal((await execute({ operation: "preview", paths: ["a"] })).isError, true);
  policy = { ...policy, commits: "agent" };
  assert.equal((await execute({ operation: "preview", paths: ["a"] }, os.tmpdir())).isError, true);
  const { details: { preview } } = await execute({ operation: "preview", paths: ["a"] });
  await writeFile(path.join(cwd, "a"), "third\n");
  assert.equal((await execute({ operation: "confirm", preview, message: "stale" })).isError, true);
  const fresh = (await execute({ operation: "preview", paths: ["a"] })).details.preview;
  const before = (await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
  for (const confirmation of ["ask", "none"]) {
    assert.equal((await execute({ operation: "preview", paths: ["a"], confirmation })).isError, true);
    assert.equal((await execute({ operation: "confirm", preview: fresh, message: "not permitted", confirmation })).isError, true);
    assert.equal((await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim(), before);
  }
  const result = await execute({ operation: "confirm", preview: fresh, message: "approved" });
  assert.equal(result.details.status, "committed");
  assert.equal(result.details.authorEmail, "tool@example.invalid");
  assert.deepEqual(result.details.parents, [fresh.head]);
  assert.equal(result.details.tree, fresh.tree);
});
test("agent staged commit requests an exact candidate and preserves unrelated index changes", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-staged-agent-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.name", "Tool"]);
  await git("git", ["-C", cwd, "config", "user.email", "tool@example.invalid"]);
  await writeFile(path.join(cwd, "a"), "base\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await git("git", ["-C", cwd, "commit", "-qm", "base"]);
  await writeFile(path.join(cwd, "a"), "staged\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await writeFile(path.join(cwd, "a"), "staged\nunstaged\n");
  await writeFile(path.join(cwd, "other"), "unrelated\n");
  await git("git", ["-C", cwd, "add", "other"]);
  allowFileRoot(cwd);
  const manager = sessionFixture(cwd);
  let tool, candidateMode;
  createGitCommitExtension(cwd, () => ({ mode: "current", onCreate: "stay", commits: "agent" })).factory({
    getActiveTools: () => ["read", "edit"], appendEntry: manager.appendCustomEntry,
    registerTool: (value) => { tool = value; },
  });
  const result = await tool.execute("id", { operation: "commit", paths: ["a"], mode: "staged", message: "selected" }, undefined, undefined,
    { cwd, sessionManager: manager, hasUI: true, ui: { gitAction: async (candidate) => { candidateMode = candidate.preview.mode; return true; } } });
  assert.equal(result.details.status, "committed");
  assert.equal(candidateMode, "staged");
  assert.equal((await git("git", ["-C", cwd, "show", "HEAD:a"])).stdout.trim(), "staged");
  assert.equal((await git("git", ["-C", cwd, "diff", "--cached", "--name-only"])).stdout.trim(), "other");
  assert.equal((await git("git", ["-C", cwd, "diff", "--name-only"])).stdout.trim(), "a");
});

test("saved chat commit consent can target a different registered worktree but not an unregistered path", async (t) => {
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-web-tool-cross-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = path.join(home, "source"), other = path.join(home, "other");
  await git("git", ["init", "-q", "-b", "source", source]);
  await git("git", ["-C", source, "config", "user.name", "Tool"]);
  await git("git", ["-C", source, "config", "user.email", "tool@example.invalid"]);
  await writeFile(path.join(source, "a"), "first\n");
  await git("git", ["-C", source, "add", "a"]);
  await git("git", ["-C", source, "commit", "-qm", "initial"]);
  await git("git", ["-C", source, "worktree", "add", "-qb", "other", other]);
  allowFileRoot(home);
  await writeFile(path.join(other, "a"), "second\n");
  let tool;
  const sessionManager = sessionFixture(source);
  createGitCommitExtension(source, () => ({ commits: "agent" })).factory({ getActiveTools: () => ["read", "edit"], appendEntry: sessionManager.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const run = (params) => tool.execute("id", params, undefined, undefined, { cwd: source, sessionManager });
  const before = (await git("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
  assert.equal((await run({ operation: "preview", workspaceBranch: "missing", paths: ["a"] })).isError, true);
  const preview = (await run({ operation: "preview", workspaceBranch: "other", paths: ["a"] })).details.preview;
  assert.equal(preview.repositoryRoot, other);
  assert.equal((await run({ operation: "confirm", workspaceBranch: "source", preview, message: "wrong checkout" })).isError, true);
  const result = await run({ operation: "confirm", workspaceBranch: "other", preview, message: "other commit" });
  assert.equal(result.details.status, "committed");
  assert.equal((await git("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim(), before);
});

test("legacy git_commit enforces saved Deny at preview, confirm and immediately before Ask apply across worktrees", async (t) => {
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-deny-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = path.join(home, "source"), other = path.join(home, "other");
  await git("git", ["init", "-qb", "source", source]);
  await git("git", ["-C", source, "config", "user.name", "Test"]);
  await git("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(source, "a"), "base\n");
  await git("git", ["-C", source, "add", "a"]);
  await git("git", ["-C", source, "commit", "-qm", "base"]);
  await git("git", ["-C", source, "worktree", "add", "-qb", "other", other]);
  await writeFile(path.join(other, "a"), "change\n");
  allowFileRoot(home);
  const manager = sessionFixture(source);
  const owner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionCwd: source };
  const selection = await selectGitProjectResources(other);
  const status = () => readProjectAuthorization(selection, owner, agentDir);
  const save = async (decision) => saveProjectAuthorization(selection, owner, "session", "commit", decision, await status(), agentDir);
  let tool, policy = { mode: "current", onCreate: "stay", commits: "agent" }, approvals = 0;
  createGitCommitExtension(source, () => policy).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: manager.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const run = (params, ui = async () => { approvals++; return true; }) => tool.execute("id", { workspaceBranch: "other", ...params }, undefined, undefined,
    { cwd: source, sessionManager: manager, hasUI: true, ui: { gitAction: ui } });
  const before = (await git("git", ["-C", other, "rev-parse", "HEAD"])).stdout.trim();
  await save("deny");
  assert.equal((await run({ operation: "preview", paths: ["a"] })).isError, true);
  assert.equal((await run({ operation: "commit", paths: ["a"], message: "blocked" })).isError, true);
  assert.equal(approvals, 0);
  await save("inherit");
  const preview = (await run({ operation: "preview", paths: ["a"] })).details.preview;
  await save("deny");
  assert.equal((await run({ operation: "confirm", preview, message: "blocked" })).isError, true);
  await save("inherit");
  const afterApproval = await run({ operation: "commit", paths: ["a"], message: "blocked" }, async () => {
    approvals++; await save("deny"); return true;
  });
  assert.equal(afterApproval.isError, true);
  assert.equal(await git("git", ["-C", other, "rev-parse", "HEAD"]).then(({ stdout }) => stdout.trim()), before);
  await save("allow");
  policy = { ...policy, commits: "manual" };
  assert.equal((await run({ operation: "preview", paths: ["a"] })).isError, true, "Allow cannot grant legacy agent consent");
});

test("both aliases and legacy confirm refuse missing required saved-Project commit-stage receipts before approval", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "commit-required-aliases-")); t.after(() => rm(cwd, { recursive: true, force: true }));
  await git("git", ["init", "-qb", "feature", cwd]); await git("git", ["-C", cwd, "config", "user.name", "Fixture"]);
  await git("git", ["-C", cwd, "config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(cwd, "a"), "base\n"); await git("git", ["-C", cwd, "add", "a"]); await git("git", ["-C", cwd, "commit", "-qm", "base"]);
  await writeFile(path.join(cwd, "a"), "changed\n"); allowFileRoot(cwd);
  const checks = [{ label: "required", argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "commit" }];
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true }, projects: { [cwd]: { enabled: true, commits: "ask", checks } } });
  const before = (await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
  for (const managed of [false, true]) {
    const manager = sessionFixture(cwd, managed), tools = new Map(), bootstrap = {
      getActiveTools: () => ["read", "edit"], appendEntry: manager.appendCustomEntry, registerTool: (tool) => tools.set(tool.name, tool) };
    createGitCommitExtension(cwd, () => ({ commits: "agent" })).factory(bootstrap);
    createAgentGitWorkflowExtension(cwd, undefined, undefined, fixtureWriters.get(cwd)).factory(bootstrap);
    let prompts = 0; const ctx = { cwd, sessionManager: manager, hasUI: true, ui: { gitAction: async () => { prompts++; return true; } } };
    for (const name of ["git_commit", "git_workflow"]) {
      const result = await tools.get(name).execute("required", { operation: "commit", paths: ["a"], message: "must refuse", receiptIds: [] }, undefined, undefined, ctx);
      assert.equal(result.isError, true, JSON.stringify(result)); assert.match(result.details.error, /missing-receipts/); assert.equal(prompts, 0);
      const forged = await tools.get(name).execute("forged", { operation: "commit", paths: ["a"], message: "must refuse", receiptIds: ["old-action-id"] }, undefined, undefined, ctx);
      assert.equal(forged.isError, true); assert.equal(prompts, 0);
    }
    if (!managed) {
      const preview = await prepareGitCommit(cwd, ["a"]);
      const result = await tools.get("git_commit").execute("legacy", { operation: "confirm", preview, message: "must refuse", receiptIds: [] }, undefined, undefined, ctx);
      assert.equal(result.isError, true, JSON.stringify(result)); assert.match(result.details.error, /missing-receipts/);
    } else {
      writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true }, projects: { [cwd]: { enabled: true, commits: "ask", commitConfirmation: "none", checks } } });
      const selected = await selectGitProjectResources(cwd);
      await saveProjectAuthorization(selected, undefined, "project", "commit", "allow", await readProjectAuthorization(selected));
      for (const name of ["git_commit", "git_workflow"]) {
        const result = await tools.get(name).execute("none-required", { operation: "commit", confirmation: "none", paths: ["a"], message: "must refuse", receiptIds: [] }, undefined, undefined, { ...ctx, hasUI: false });
        assert.equal(result.isError, true, JSON.stringify(result)); assert.match(result.details.error, /missing-receipts/); assert.equal(prompts, 0);
      }
    }
    assert.equal((await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim(), before);
    assert.equal((await git("git", ["-C", cwd, "diff", "--cached", "--name-only"])).stdout.trim(), "");
  }
});

test("public commit recovery projects actual IDs and effects without private native row proofs", async () => {
  const { workflowCommitFailureResult } = await jiti.import("./git-workflow-commit.ts");
  const { GitActionRecordingError, GitActionApplyError } = await jiti.import("./git-action-controller.ts");
  // A projection-only unit fixture: this data grants no native execution,
  // ordering, receipt or cleanup authority.
  const id = "4d04caea-4c10-4a71-bc23-30739fbfb62b", receiptId = "edc870a2-dd65-481b-9d6a-e9dc003d588a";
  const facts = { status: "committed", commit: "1".repeat(40), tree: "2".repeat(40), workingWorkspaceVerification: {
    evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false, requiredSavedIndexes: [3],
    runs: [{ checkIndex: 3, recipeDigest: "private-recipe", cgroupIdentity: "private-cgroup", launcherIdentity: "private-launcher", receipt: { id: receiptId, sha256: "private-proof" } }] } };
  for (const cause of [new GitActionRecordingError(id, facts), new GitActionApplyError(id, facts)]) {
    const result = workflowCommitFailureResult(cause), projected = result.details.outcome ?? result.details.intended;
    assert.equal(result.details.actionId, id); assert.equal(result.details.recoveryRequired, true); assert.equal(projected.commit, facts.commit);
    assert.deepEqual(projected.workingWorkspaceVerification.receiptIds, [receiptId]);
    assert.equal(projected.workingWorkspaceVerification.candidateTreeVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /private-|cgroup|launcher|recipeDigest|sha256|"runs"/);
  }
});

test("git commit registration is confined to the ordinary extensionFactories branch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const chatOnly = source.indexOf("extensionFactories: [checkoutGuard, exactSystemPromptExtension, createSessionReferenceExtension(), createGitWorkflowContextFilterExtension()]");
  const ordinary = source.indexOf("createProjectCommandBashExtension({", chatOnly);
  const end = source.indexOf("extensionsOverride:", ordinary);
  assert.ok(chatOnly > 0 && ordinary > chatOnly && end > ordinary);
  assert.match(source.slice(ordinary, end), /createGitCommitExtension\(/);
  assert.doesNotMatch(source.slice(source.indexOf("chatOnly\n"), ordinary), /createGitCommitExtension\(/);
});
