import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
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
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
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

test("both Ask aliases and legacy confirm retain the real wrapper's original epoch across human wait", async (t) => {
  for (const mode of ["git_commit", "git_workflow", "legacy"]) {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "commit-live-authority-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await git("git", ["init", "-qb", "main", cwd]);
    await git("git", ["-C", cwd, "config", "user.name", "Fixture"]);
    await git("git", ["-C", cwd, "config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(cwd, "a"), "base\n"); await git("git", ["-C", cwd, "add", "a"]); await git("git", ["-C", cwd, "commit", "-qm", "base"]);
    await writeFile(path.join(cwd, "a"), "candidate\n"); allowFileRoot(cwd);
    const manager = SessionManager.create(cwd, path.join(agentDir, "sessions"));
    manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
    let active = ["read", "edit"], tool;
    const inner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager,
      settingsManager: SettingsManager.create(cwd, agentDir), getActiveToolNames: () => active, setActiveToolsByName: (names) => { active = [...names]; }, dispose() {}, agent: { state: {} } };
    const wrapper = new rpc.AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
    const registry = globalThis.__piSessions; globalThis.__piSessions = new Map([[manager.getSessionId(), wrapper]]);
    try {
      const factory = mode === "git_workflow" ? createAgentGitWorkflowExtension(cwd) : createNativeGitCommitExtension(cwd, () => ({ commits: "agent" }));
      factory.factory({ getActiveTools: inner.getActiveToolNames, appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
      const restore = () => { inner.setActiveToolsByName(["read"]); inner.setActiveToolsByName(["read", "edit"]); };
      let mutate = true, prompts = 0;
      const ctx = { cwd, sessionManager: manager, hasUI: true, ui: { gitAction: async () => { prompts++; if (mutate) restore(); return true; } } };
      const run = (params) => tool.execute("id", params, undefined, undefined, ctx);
      const params = { operation: "commit", paths: ["a"], message: "exact" };
      const before = (await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
      let refused;
      if (mode === "legacy") {
        const captured = await run({ operation: "preview", paths: ["a"] });
        assert.ok(captured.details.preview, JSON.stringify(captured)); restore();
        refused = await run({ operation: "confirm", preview: captured.details.preview, message: "exact" });
      } else refused = await run(params);
      assert.equal(refused.isError, true, JSON.stringify(refused));
      assert.equal((await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim(), before);
      mutate = false;
      let result;
      if (mode === "legacy") {
        const captured = await run({ operation: "preview", paths: ["a"] });
        const confirm = { operation: "confirm", preview: captured.details.preview, message: "exact" };
        result = await run(confirm);
        assert.equal((await run(confirm)).isError, true, "same legacy candidate cannot execute twice");
      } else result = await run(params);
      assert.equal(result.details.status, "committed", JSON.stringify(result));
      assert.equal(prompts, mode === "legacy" ? 0 : 2, "one approval per invocation; no implicit retries");
    } finally { wrapper.destroy(); globalThis.__piSessions = registry; }
  }
});

test("Ask, selected none and legacy confirm expose optional final recording failure without changing native success", async (t) => {
  const { readGitAction } = await jiti.import("./git-action-journal.ts");
  for (const mode of ["ask", "none", "legacy"]) {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "commit-diagnostics-caller-"));
    const bin = await mkdtemp(path.join(os.tmpdir(), "commit-diagnostics-bin-"));
    t.after(async () => { await rm(cwd, { recursive: true, force: true }); await rm(bin, { recursive: true, force: true }); });
    await git("git", ["init", "-qb", "main", cwd]);
    await git("git", ["-C", cwd, "config", "user.name", "Fixture"]);
    await git("git", ["-C", cwd, "config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(cwd, "a"), "base\n"); await git("git", ["-C", cwd, "add", "a"]); await git("git", ["-C", cwd, "commit", "-qm", "base"]);
    await writeFile(path.join(cwd, "a"), `actual native ${mode}\n`); allowFileRoot(cwd);
    const manager = sessionFixture(cwd, mode === "none");
    if (mode === "none") {
      writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true },
        projects: { [cwd]: { enabled: true, commits: "ask", commitConfirmation: "none", checks: [] } } }, agentDir);
      const source = await selectGitProjectResources(cwd);
      await saveProjectAuthorization(source, undefined, "project", "commit", "allow", await readProjectAuthorization(source, undefined, agentDir), agentDir);
    }
    let tool;
    createGitCommitExtension(cwd, () => ({ commits: "agent" })).factory({ getActiveTools: () => ["read", "edit"],
      appendEntry: manager.appendCustomEntry, registerTool: (value) => { tool = value; } });
    let prompts = 0;
    const ctx = { cwd, sessionManager: manager, hasUI: mode === "ask", ui: { gitAction: async () => { prompts++; return true; } } };
    const execute = (params) => tool.execute("id", params, undefined, undefined, ctx);
    const request = mode === "legacy" ? { operation: "confirm", preview: (await execute({ operation: "preview", paths: ["a"] })).details.preview, message: "exact" }
      : { operation: "commit", paths: ["a"], message: "exact", ...(mode === "none" ? { confirmation: "none", repositoryPath: cwd, checkoutPath: cwd } : {}) };
    const before = (await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
    const actionDir = path.join(agentDir, "git-diagnostics-v2");
    const realGit = (await git("which", ["git"])).stdout.trim();
    await writeFile(path.join(bin, "git"), `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; mv "${actionDir}" "${actionDir}.storage-fault" && printf '%s' 'unavailable diagnostic storage' > "${actionDir}"; exit $? ;; esac\nexec "${realGit}" "$@"\n`);
    await chmod(path.join(bin, "git"), 0o755);
    const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    let result;
    try { result = await execute(request); }
    finally {
      process.env.PATH = oldPath;
      if (actionDir && existsSync(`${actionDir}.storage-fault`)) { await rm(actionDir, { force: true }); await rename(`${actionDir}.storage-fault`, actionDir); }
    }
    assert.equal(result.details.status, "committed", JSON.stringify(result)); assert.equal(result.isError, undefined);
    assert.equal(result.details.diagnosticsUnavailable, true);
    assert.deepEqual(result.details.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
    assert.match(result.details.recoveryWarning, /diagnostics unavailable.*do not repeat/i);
    assert.equal(result.details.recoveryRequired, undefined);
    assert.match(result.content[0].text, /diagnostics unavailable/);
    assert.doesNotMatch(JSON.stringify(result), /refresh|retry|ENOTDIR|storage-fault/);
    assert.equal((await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim(), result.details.commit);
    assert.deepEqual(result.details.parents, [before]); assert.equal(existsSync(path.join(cwd, ".git/index.lock")), false);
    assert.equal((await readGitAction(result.details.actionId)).record, null, "missing optional history is not reconstructed as success");
    assert.equal(prompts, mode === "ask" ? 1 : 0);
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
  const chatOnly = source.indexOf("extensionFactories: [exactSystemPromptExtension, createSessionReferenceExtension(), createGitWorkflowContextFilterExtension()]");
  const ordinary = source.indexOf("createProjectCommandBashExtension({", chatOnly);
  const end = source.indexOf("extensionsOverride:", ordinary);
  assert.ok(chatOnly > 0 && ordinary > chatOnly && end > ordinary);
  assert.match(source.slice(ordinary, end), /createGitCommitExtension\(/);
  assert.doesNotMatch(source.slice(source.indexOf("chatOnly\n"), ordinary), /createGitCommitExtension\(/);
});
