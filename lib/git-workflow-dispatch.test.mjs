import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { seedRetiredGitBookkeeping } from "./retired-git-bookkeeping-fixture.mjs";

const agentDir = await mkdtemp(join(tmpdir(), "workflow-dispatch-agent-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { interopDefault: false });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { createGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const { captureGitCommitAuthority } = await jiti.import("./git-commit-invocation.ts");
const { createAgentGitWorkflowExtension } = await jiti.import("./agent-git-workflow-extension.ts");
const { createGitWorkspaceStartExtension } = await jiti.import("./git-workspace-start-extension.ts");
const { appendManagedSessionGitWorkflow, snapshotFreshManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const { readSessionGitWorkflow, appendSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { gitActionSink } = await jiti.import("./git-action-controller.ts");
const { readGitAction } = await jiti.import("./git-action-journal.ts");
const { readSessionToolSelection } = await jiti.import("./session-tool-selection.ts");
const { createGitSelectedOperationRuntime } = await jiti.import("./git-selected-operation-runtime.ts");
const { registerGitCheckLiveAuthorityReader } = await jiti.import("./git-check-authority-fence.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();

async function fixture(t, settings = {}, fresh = false, taskKind = "managed") {
  const cwd = await mkdtemp(join(tmpdir(), "workflow-dispatch-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(agentDir, "pi-web"), { recursive: true, mode: 0o700 });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} });
  await git(cwd, "init", "-q", "-b", "base");
  await git(cwd, "config", "user.name", "Fixture");
  await git(cwd, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(cwd, "a"), "base\n");
  await git(cwd, "add", "a"); await git(cwd, "commit", "-qm", "initial");
  allowFileRoot(cwd);
  // Live negative-only project authorization requires a persisted chat header;
  // a synthetic in-memory manager must not bypass that identity check.
  const persisted = SessionManager.create(cwd, join(agentDir, "sessions"));
  if (fresh) snapshotFreshManagedSessionGitWorkflow(persisted, { ...DEFAULT_GIT_WORKFLOW_SETTINGS, ...settings });
  persisted.appendMessage({ role: "user", content: "test commit", timestamp: Date.now() });
  persisted.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const sessionId = persisted.getSessionId();
  const manager = persisted;
  if (!fresh && taskKind === "managed") appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, ...settings } });
  if (taskKind === "legacy") appendSessionGitWorkflow(manager, { mode: "current", onCreate: "stay", commits: "agent" });
  let revision = 1;
  const append = manager.appendCustomEntry.bind(manager);
  manager.appendCustomEntry = (type, data) => { if (type === "pi-web:tool-selection") revision++; return append(type, data); };
  const trustedRuntime = { readSelectionRevisionSync: () => `dispatch-writer:${sessionId}:${revision}` };
  const toolOf = (extension) => { let tool; extension.factory({ getActiveTools: () => readSessionToolSelection(manager.getEntries()) ?? ["read", "edit"], appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } }); return tool; };
  const commit = toolOf(createGitCommitExtension(cwd, () => readSessionGitWorkflow(manager.getEntries()), trustedRuntime));
  const workflow = toolOf(createAgentGitWorkflowExtension(cwd, agentDir, manager, trustedRuntime));
  const start = toolOf(createGitWorkspaceStartExtension(cwd, () => readSessionGitWorkflow(manager.getEntries())));
  const ctx = (answer = async () => false) => ({ cwd, hasUI: true, sessionManager: manager, ui: { gitAction: answer } });
  const run = (tool, params, answer) => tool.execute("call", params, undefined, undefined, ctx(answer));
  const runtime = createGitSelectedOperationRuntime({ ...trustedRuntime, sessionCwd: cwd, manager,
    effectiveTools: () => readSessionToolSelection(manager.getEntries()) ?? ["read", "edit"], appendEntry: manager.appendCustomEntry,
    ask: async () => true, isCancelled: () => false });
  t.after(() => runtime.dispose());
  const selected = await selectGitProjectResources(cwd);
  return { cwd, get entries() { return manager.getEntries(); }, manager, commit, workflow, start, run, runtime, selected, trustedRuntime,
    verificationContext: runtime.commitVerificationContext(selected, []), head: await git(cwd, "rev-parse", "HEAD") };
}
const change = { operation: "commit", paths: ["a"], message: "Exactly reviewed" };
const captureAuthority = (f, signal) => captureGitCommitAuthority({
  scope: { sessionId: f.manager.getSessionId(), sessionFile: f.manager.getSessionFile(), cwd: f.cwd },
  manager: f.manager, effectiveTools: () => readSessionToolSelection(f.entries) ?? ["read", "edit"],
  readSelectionRevisionSync: f.trustedRuntime.readSelectionRevisionSync,
  assertCurrentSync: () => { signal?.throwIfAborted(); },
});

test("git_commit and workflow alias share Ask: decline, approve, no patch-sized tool result", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "unique candidate bytes\n");
  let card;
  const declined = await f.run(f.commit, change, async (value) => { card = value; return false; });
  assert.equal(declined.details.approved, false);
  assert.equal((await readGitAction(declined.details.actionId)).record.state, "declined");
  assert.match(card.diff.patch, /unique candidate bytes/);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  const committed = await f.run(f.workflow, change, async () => true);
  assert.equal(committed.details.status, "committed");
  assert.equal(committed.details.authorEmail, "fixture@example.invalid");
  assert.equal((await readGitAction(committed.details.actionId)).record.state, "succeeded");
  assert.doesNotMatch(JSON.stringify(committed), /unique candidate bytes/);
  assert.equal((await f.run(f.commit, { operation: "preview", paths: ["a"] })).isError, true);
});

test("already-loaded commit tool rechecks pause after approval and does not move HEAD", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "candidate\n");
  let approvals = 0;
  const result = await f.run(f.commit, change, async () => {
    approvals++;
    writeGitWorkflowSettingsDocument({ version: 1, paused: true, global: {}, projects: {} });
    return true;
  });
  assert.equal(result.isError, true);
  assert.equal(approvals, 1);
  assert.match(result.content[0].text, /stale/); // Original authority was revoked by pause.
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  let asked = false;
  assert.equal((await f.run(f.workflow, change, async () => { asked = true; return true; })).isError, true);
  assert.equal(asked, false);
  const status = await f.run(f.workflow, { operation: "status" });
  assert.equal(status.details.paused, true);
});

test("legacy preview cannot be confirmed after live disable", async (t) => {
  const f = await fixture(t, {}, false, "legacy");
  await writeFile(join(f.cwd, "a"), "legacy candidate\n");
  const preview = (await f.run(f.commit, { operation: "preview", paths: ["a"] })).details.preview;
  assert.ok(preview);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: false }, projects: {} });
  assert.equal((await f.run(f.commit, { operation: "confirm", preview, message: "No" })).isError, true);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
});

test("Manual, Off and read-only presets cannot be bypassed through the workflow alias", async (t) => {
  for (const mode of ["manual", "off", "read-only"]) {
    const f = await fixture(t, { commits: mode === "read-only" ? "ask" : mode });
    await writeFile(join(f.cwd, "a"), "candidate\n");
    if (mode === "read-only") f.manager.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: ["read", "grep", "find", "ls"] });
    let asked = false;
    const status = await f.run(f.workflow, { operation: "status" });
    assert.equal(status.details.permissions.agent.commit.kind, "blocked");
    for (const tool of [f.commit, f.workflow]) {
      const result = await f.run(tool, change, async () => { asked = true; return true; });
      assert.equal(result.isError, true, mode);
      assert.equal(result.content[0].text, status.details.permissions.agent.commit.reason, "Status and both aliases use the same eligibility decision");
    }
    assert.equal(asked, false);
    assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  }
});

test("effective unpinned read-only tools refuse a stale registered Git call", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "candidate\n");
  let tool;
  createGitCommitExtension(f.cwd, () => readSessionGitWorkflow(f.entries), f.trustedRuntime).factory({
    getActiveTools: () => ["read", "grep", "find", "ls", "git_commit"], registerTool: (value) => { tool = value; },
  });
  let asked = false;
  const result = await f.run(tool, change, async () => { asked = true; return true; });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /read-only/);
  assert.equal(asked, false);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
});

test("Stop during final async commit validation is checked before mutation starts", async (t) => {
  const f = await fixture(t);
  const { requestWorkflowCommit } = await jiti.import("./git-workflow-commit.ts");
  await writeFile(join(f.cwd, "a"), "candidate\n");
  const abort = new AbortController();
  let preflights = 0;
  const result = await requestWorkflowCommit({ cwd: f.cwd, paths: ["a"], message: "Stop", signal: abort.signal,
    sink: gitActionSink(f.manager, f.manager.appendCustomEntry), verificationContext: f.verificationContext,
    authority: captureAuthority(f, abort.signal),
    ask: async () => true, beforeApply: async () => {
      if (++preflights === 2) { await new Promise((resolve) => setImmediate(resolve)); abort.abort(); }
      return f.runtime.captureAuthorityGuard(f.selected);
    } });
  assert.equal(result.details.approved, false);
  assert.match(result.content[0].text, /cancelled/);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
});

test("captured branch/worktree requirements apply to the selected commit workspace", async (t) => {
  const f = await fixture(t, { branch: "feature" });
  await writeFile(join(f.cwd, "a"), "wrong branch\n");
  let asked = false;
  const denied = await f.run(f.commit, change, async () => { asked = true; return true; });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /requires branch feature/);
  assert.equal(asked, false);
  await writeFile(join(f.cwd, "a"), "base\n");
  const linked = join(f.cwd, "linked");
  await git(f.cwd, "worktree", "add", "-qb", "feature", linked);
  await writeFile(join(linked, "a"), "right branch\n");
  const accepted = await f.run(f.commit, { ...change, workspaceBranch: "feature" }, async () => true);
  assert.equal(accepted.details.status, "committed");
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  appendManagedSessionGitWorkflow(f.manager, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, workspace: "worktree", baseBranch: "base" } });
  await writeFile(join(f.cwd, "a"), "primary candidate\n");
  assert.match((await f.run(f.workflow, change, async () => true)).content[0].text, /linked feature worktree/);
});

test("disabled worktree tool refuses before creation; legacy preferences cannot retarget managed tasks", async (t) => {
  const f = await fixture(t, { workspace: "worktree", baseBranch: "base" });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: false }, projects: {} });
  const result = await f.run(f.start, { branch: "feature", expectedBaseOid: f.head });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /disabled/);
  assert.equal((await git(f.cwd, "worktree", "list", "--porcelain")).match(/^worktree /gm).length, 1);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} });
  assert.match((await f.run(f.workflow, { operation: "preferences" })).content[0].text, /Workflow panel/);
});

test("commit flow retains approval, cancellation and stale-state checks without application reservations", async (t) => {
  const { requestWorkflowCommit } = await jiti.import("./git-workflow-commit.ts");
  for (const outcome of ["approve", "decline", "cancel", "stale", "retired-bookkeeping"]) {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "candidate\n");
    const abort = new AbortController();
    let restore, guarded = 0;
    let result, failure;
    try {
      result = await requestWorkflowCommit({ cwd: f.cwd, paths: ["a"], message: "gate", signal: abort.signal,
        sink: gitActionSink(f.manager, f.manager.appendCustomEntry), verificationContext: f.verificationContext,
        authority: captureAuthority(f, abort.signal),
        beforeApply: async () => { guarded++; return f.runtime.captureAuthorityGuard(f.selected); },
        ask: async () => {
          if (outcome === "cancel") abort.abort();
          if (outcome === "stale") await writeFile(join(f.cwd, "a"), "changed during wait\n");
          if (outcome === "retired-bookkeeping") restore = seedRetiredGitBookkeeping([f.cwd]);
          return outcome !== "decline";
        } });
    } catch (cause) { failure = cause; }
    finally { restore?.(); }
    assert.ok(guarded >= 1);
    if (["approve", "retired-bookkeeping"].includes(outcome)) {
      assert.ifError(failure);
      assert.equal(result.details.status, "committed");
    }
    else {
      assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
      if (outcome === "stale") {
        assert.match(failure.message, /stale/);
        const record = (await readGitAction(f.entries.at(-1).data.actionId)).record;
        assert.equal(record.state, "blocked");
        assert.equal(record.decision, "approved", "Later admission failure must retain the actual human decision");
        assert.equal(record.outcome, undefined);
      } else assert.equal(result.details.approved, false);
    }
  }
});

test("agent commit aliases ignore foreign session activity and retired bookkeeping", async (t) => {
  const previous = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = previous; });
  for (const alias of ["commit", "workflow"]) {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "candidate\n");
    let asked = 0;
    const self = { sessionId: f.manager.getSessionId(), sessionFile: f.manager.getSessionFile(), cwd: f.cwd,
      isAlive: () => true, isRunning: () => true, inner: { sessionManager: f.manager, getActiveToolNames: () => ["read", "edit"] } };
    t.after(registerGitCheckLiveAuthorityReader(self, f.trustedRuntime.readSelectionRevisionSync));
    const other = { sessionId: "other", cwd: f.cwd, isAlive: () => false, isRunning: () => true };
    globalThis.__piSessions = new Map([[self.sessionId, self], [other.sessionId, other]]);
    const restore = seedRetiredGitBookkeeping([f.cwd]);
    try {
      const answer = async () => { asked++; return false; };
      assert.equal((await f.run(f[alias], change, answer)).details.approved, false, "another active session is allowed");
      assert.equal(asked, 1);
      assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head, "decline still has no effect");
      assert.equal((await f.run(f[alias], change, async () => true)).details.status, "committed");
    } finally { restore(); }
  }
});

test("legacy preview/confirm ignores retired bookkeeping without gaining new authority", async (t) => {
  const f = await fixture(t, {}, false, "legacy");
  await writeFile(join(f.cwd, "a"), "legacy\n");
  const restore = seedRetiredGitBookkeeping([f.cwd]);
  try {
    const preview = (await f.run(f.commit, { operation: "preview", paths: ["a"] })).details.preview;
    assert.ok(preview);
    assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
    assert.equal((await f.run(f.commit, { operation: "confirm", preview, message: "legacy" })).details.status, "committed");
  } finally { restore(); }
});

async function commitGrant(f, decision = "allow", scope = "project") {
  const selected = await selectGitProjectResources(f.cwd);
  const owner = scope === "session" ? { sessionId: f.manager.getSessionId(), sessionFile: f.manager.getSessionFile(), sessionCwd: f.cwd } : undefined;
  await saveProjectAuthorization(selected, owner, scope, "commit", decision,
    await readProjectAuthorization(selected, owner, agentDir), agentDir);
  return selected;
}
const nonePolicy = () => writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { commitConfirmation: "none" }, projects: {} });

test("both aliases: a genuine fresh caller still asks by default/explicit Ask, while qualified explicit none needs no UI", { skip: process.platform !== "linux" }, async (t) => {
  for (const alias of ["commit", "workflow"]) {
    const f = await fixture(t, {}, true);
    nonePolicy();
    await commitGrant(f);
    await writeFile(join(f.cwd, "a"), "private exact candidate\n");
    let prompts = 0;
    for (const confirmation of [undefined, "ask"]) {
      const result = await f.run(f[alias], { ...change, ...(confirmation ? { confirmation } : {}) }, async (candidate) => {
        prompts++;
        assert.equal(candidate.preview.repositoryRoot, f.cwd);
        assert.match(candidate.diff.patch, /private exact candidate/);
        return false;
      });
      assert.equal(result.details.approved, false, JSON.stringify(result));
      assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
    }
    assert.equal(prompts, 2, "exactly one question per Ask request; Allow alone is not approval");
    const result = await f[alias].execute("none", { ...change, confirmation: "none" }, undefined, undefined,
      { cwd: f.cwd, sessionManager: f.manager, hasUI: false });
    assert.equal(result.details.status, "committed", JSON.stringify(result));
    assert.equal(result.details.approval, "saved-project-allow");
    assert.equal(result.details.authorEmail, "fixture@example.invalid");
    assert.equal(await git(f.cwd, "rev-parse", "HEAD"), result.details.commit);
    assert.doesNotMatch(JSON.stringify(result), /private exact candidate/);
    const journal = await readGitAction(result.details.actionId);
    assert.equal(journal.record.decision, undefined);
    assert.equal(journal.record.summary.projectRoot, f.cwd);
    assert.equal(journal.record.summary.sourceCheckoutRoot, f.cwd);
  }
});

test("both aliases resolve workspaceBranch to the same canonical physical checkout without moving the fresh caller", { skip: process.platform !== "linux" }, async (t) => {
  for (const alias of ["commit", "workflow"]) {
    const f = await fixture(t, { branch: "feature" }, true);
    const linked = join(f.cwd, "linked");
    await git(f.cwd, "worktree", "add", "-qb", "feature", linked);
    nonePolicy();
    await commitGrant(f);
    await writeFile(join(linked, "a"), "selected linked candidate\n");
    const result = await f[alias].execute("none", { ...change, workspaceBranch: "feature", confirmation: "none" }, undefined, undefined,
      { cwd: f.cwd, sessionManager: f.manager, hasUI: false });
    assert.equal(result.details.status, "committed", JSON.stringify(result));
    assert.equal(await git(linked, "rev-parse", "HEAD"), result.details.commit);
    assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
    assert.equal(f.manager.getCwd(), f.cwd);
    const journal = await readGitAction(result.details.actionId);
    assert.equal(journal.record.summary.projectRoot, f.cwd);
    assert.equal(journal.record.summary.sourceCheckoutRoot, linked);
  }
});

test("both aliases preserve the ordinary Ask path for a real SDK copied caller but refuse explicit none", { skip: process.platform !== "linux" }, async (t) => {
  const f = await fixture(t, {}, true);
  nonePolicy();
  await commitGrant(f);
  const copy = SessionManager.open(SessionManager.open(f.manager.getSessionFile(), undefined).createBranchedSession(f.manager.getLeafId()), undefined);
  let prompts = 0;
  await writeFile(join(f.cwd, "a"), "copied caller candidate\n");
  for (const extension of [createGitCommitExtension(f.cwd, () => readSessionGitWorkflow(copy.getEntries()), f.trustedRuntime), createAgentGitWorkflowExtension(f.cwd, agentDir, copy, f.trustedRuntime)]) {
    let tool;
    extension.factory({ getActiveTools: () => ["read", "edit"], appendEntry: copy.appendCustomEntry.bind(copy), registerTool: (value) => { tool = value; } });
    const context = { cwd: f.cwd, sessionManager: copy, hasUI: true, ui: { gitAction: async () => { prompts++; return false; } } };
    const beforePrompts = prompts;
    assert.equal((await tool.execute("none", { ...change, confirmation: "none" }, undefined, undefined, context)).isError, true);
    assert.equal(prompts, beforePrompts, "none never asks");
    assert.equal((await tool.execute("ask", change, undefined, undefined, context)).details.approved, false);
    assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  }
  assert.equal(prompts, 2);
});

test("both aliases: explicit none refuses old/pinned, caller restrictions, no/stale/Deny grant and live Ask without prompting or ref changes", { skip: process.platform !== "linux" }, async (t) => {
  for (const kind of ["old", "legacy", "task-absent", "pinned", "off", "manual", "optout", "absent", "stale", "deny", "policy-ask", "paused", "read-only"]) {
    const f = await fixture(t, { commits: ["off", "manual"].includes(kind) ? kind : "ask" }, !["old", "legacy", "task-absent"].includes(kind),
      kind === "legacy" ? "legacy" : kind === "task-absent" ? "absent" : "managed");
    nonePolicy();
    if (kind !== "absent") await commitGrant(f, kind === "deny" ? "deny" : "allow", kind === "stale" ? "session" : "project");
    if (kind === "pinned" || kind === "optout") appendManagedSessionGitWorkflow(f.manager, {},
      { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS } }, kind === "optout");
    if (kind === "stale") writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { commitConfirmation: "none", branch: "base" }, projects: {} });
    if (kind === "policy-ask") writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { commitConfirmation: "ask" }, projects: {} });
    if (kind === "paused") writeGitWorkflowSettingsDocument({ version: 1, paused: true, global: { commitConfirmation: "none" }, projects: {} });
    if (kind === "read-only") f.manager.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: ["read"] });
    await writeFile(join(f.cwd, "a"), "must survive refusal\n");
    let prompts = 0;
    for (const alias of ["commit", "workflow"]) {
      const result = await f.run(f[alias], { ...change, confirmation: "none" }, async () => { prompts++; return true; });
      assert.equal(result.isError, true, `${kind}/${alias}: ${JSON.stringify(result)}`);
      assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head, kind);
      assert.equal(await git(f.cwd, "diff", "--cached", "--name-only"), "", "refusal preserves index");
    }
    assert.equal(prompts, 0, kind);
    if (["old", "legacy", "task-absent", "pinned", "absent", "policy-ask"].includes(kind)) {
      for (const alias of ["commit", "workflow"]) assert.equal((await f.run(f[alias], change, async () => { prompts++; return false; })).details.approved, false, kind);
      assert.equal(prompts, 2, "an ineligible none request does not remove the ordinary Ask path");
    }
  }
});

test("both aliases recheck none authorization after preview and at the native pre-CAS callback", { skip: process.platform !== "linux" }, async (t) => {
  const native = await jiti.import("./git-commit.ts");
  const prepare = native.prepareGitCommit, confirm = native.confirmGitCommit;
  for (const alias of ["commit", "workflow"]) for (const boundary of ["preview", "pre-cas"]) {
    const f = await fixture(t, {}, true);
    nonePolicy();
    await commitGrant(f);
    await writeFile(join(f.cwd, "a"), "revoked candidate\n");
    let reached = 0;
    const mock = boundary === "preview"
      ? t.mock.method(native, "prepareGitCommit", async (...args) => { const preview = await prepare(...args); reached++; await commitGrant(f, "deny"); return preview; })
      : t.mock.method(native, "confirmGitCommit", (preview, message, beforeRef, ownedLock) => confirm(preview, message, async (intended) => {
        reached++; await commitGrant(f, "deny"); return beforeRef(intended);
      }, ownedLock));
    try {
      const result = await f[alias].execute("none", { ...change, confirmation: "none" }, undefined, undefined,
        { cwd: f.cwd, sessionManager: f.manager, hasUI: false, ui: {} });
      assert.equal(reached, 1, boundary);
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
      assert.equal(await git(f.cwd, "diff", "--cached", "--name-only"), "");
    } finally { mock.mock.restore(); }
  }
});

test("workflow alias preserves known commit after diagnostic failure without vetoing a separately authorized next commit", { skip: process.platform !== "linux" }, async (t) => {
  const actions = await jiti.import("./git-action-controller.ts");
  const native = await jiti.import("./git-commit.ts");
  const finish = actions.finishGitAction, confirm = native.confirmGitCommit;
  for (const explicitProject of [false, true]) for (const confirmation of ["ask", "none"]) {
    const caller = await fixture(t, {}, true);
    const target = explicitProject ? await fixture(t, {}, true) : caller;
    nonePolicy();
    await commitGrant(target);
    await writeFile(join(target.cwd, "a"), "commit exactly once\n");
    let prompts = 0, commits = 0, recordings = 0;
    const recordingMock = t.mock.method(actions, "finishGitAction", async (...args) => {
      await finish(...args);
      if (++recordings === 1) throw new Error("injected diagnostic failure after known success");
    });
    const nativeMock = t.mock.method(native, "confirmGitCommit", (...args) => { commits++; return confirm(...args); });
    const params = { ...change, confirmation,
      ...(explicitProject ? { repositoryPath: target.cwd, checkoutPath: target.cwd } : {}) };
    const ctx = { cwd: caller.cwd, sessionManager: caller.manager, hasUI: confirmation === "ask",
      ui: { gitAction: async () => { prompts++; return true; } } };
    try {
      const result = await caller.workflow.execute("commit", params, undefined, undefined, ctx);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.equal(result.details.status, "committed");
      assert.equal(result.details.diagnosticsUnavailable, true);
      assert.ok(result.details.actionId, "retain the original diagnostic locator");
      assert.match(result.details.recoveryWarning, /Do not repeat/i);
      assert.doesNotMatch(result.content[0].text, /stale|fresh (?:review|candidate)/i);
      const journal = await readGitAction(result.details.actionId);
      assert.equal(journal.record.state, "succeeded", "do not overwrite the known recorded commit outcome");
      assert.equal(journal.record.outcome.status, "committed");
      assert.equal(await git(target.cwd, "rev-parse", "HEAD"), journal.record.outcome.commit);
      assert.equal(await git(target.cwd, "rev-list", "--count", `${target.head}..HEAD`), "1");
      assert.equal(prompts, confirmation === "ask" ? 1 : 0);
      assert.equal(commits, 1, "no automatic retry after diagnostic failure");
      assert.equal(recordings, 1);
      // A new candidate requires its own authorization; history is not admission.
      await writeFile(join(target.cwd, "a"), "new independently authorized edits\n");
      const next = await caller.workflow.execute("next", params, undefined, undefined, ctx);
      assert.notEqual(next.isError, true, JSON.stringify(next));
      assert.equal(next.details.status, "committed");
      assert.equal(commits, 2);
      assert.equal(prompts, confirmation === "ask" ? 2 : 0, "a new Ask candidate gets its own question");
      assert.equal(recordings, 2);
      assert.equal(await git(target.cwd, "rev-list", "--count", `${target.head}..HEAD`), "2");
      assert.equal(await git(target.cwd, "rev-parse", "HEAD"), next.details.commit);
      assert.equal((await readGitAction(result.details.actionId)).record.outcome.commit, journal.record.outcome.commit);
    } finally { recordingMock.mock.restore(); nativeMock.mock.restore(); }
  }
});

test("safe operation blockers are specific, but configured-key diagnostics never leak through either alias", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "candidate\n");
  await writeFile(join(f.cwd, ".git", "MERGE_HEAD"), `${f.head}\n`);
  for (const tool of [f.commit, f.workflow]) assert.match((await f.run(tool, change)).content[0].text, /merge is in progress/);
  await rm(join(f.cwd, ".git", "MERGE_HEAD"));
  await git(f.cwd, "config", "filter.PRIVATE_SENTINEL.clean", "cat");
  for (const tool of [f.commit, f.workflow]) {
    const denied = await f.run(tool, change);
    assert.equal(denied.isError, true);
    assert.doesNotMatch(JSON.stringify(denied), /PRIVATE_SENTINEL|filter\./i);
  }
  const legacyFixture = await fixture(t, {}, false, "legacy");
  await writeFile(join(legacyFixture.cwd, "a"), "candidate\n");
  await git(legacyFixture.cwd, "config", "filter.PRIVATE_SENTINEL.clean", "cat");
  const legacy = await legacyFixture.run(legacyFixture.commit, { operation: "preview", paths: ["a"] });
  assert.equal(legacy.isError, true);
  assert.doesNotMatch(JSON.stringify(legacy), /PRIVATE_SENTINEL|filter\./i);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
});
