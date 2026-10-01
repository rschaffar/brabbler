import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "workflow-dispatch-agent-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { interopDefault: false });
const rpc = await jiti.import("./rpc-manager.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { createGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const { createAgentGitWorkflowExtension } = await jiti.import("./agent-git-workflow-extension.ts");
const { createGitWorkspaceStartExtension } = await jiti.import("./git-workspace-start-extension.ts");
const { appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { readSessionGitWorkflow, appendSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { gitActionSink } = await jiti.import("./git-action-controller.ts");
const { readGitAction } = await jiti.import("./git-action-journal.ts");
const { readSessionToolSelection } = await jiti.import("./session-tool-selection.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();

async function fixture(t, settings = {}) {
  // Direct registered tool calls lack a running SDK wrapper; exact-ID and
  // competing-session admission are tested in rpc-manager independently.
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const cwd = await mkdtemp(join(tmpdir(), "workflow-dispatch-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(agentDir, "pi-web"), { recursive: true });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} });
  await git(cwd, "init", "-q", "-b", "base");
  await git(cwd, "config", "user.name", "Fixture");
  await git(cwd, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(cwd, "a"), "base\n");
  await git(cwd, "add", "a"); await git(cwd, "commit", "-qm", "initial");
  allowFileRoot(cwd);
  const entries = [];
  // Live negative-only project authorization requires a persisted chat header;
  // a synthetic in-memory manager must not bypass that identity check.
  const persisted = SessionManager.create(cwd, join(agentDir, "sessions"));
  persisted.appendMessage({ role: "user", content: "test commit", timestamp: Date.now() });
  persisted.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const sessionId = persisted.getSessionId();
  const manager = { getSessionId: () => sessionId, getSessionFile: () => persisted.getSessionFile(), getEntries: () => entries,
    appendCustomEntry: (customType, data) => entries.push({ id: randomUUID(), parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(), type: "custom", customType, data }) };
  appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, ...settings } });
  const toolOf = (extension) => { let tool; extension.factory({ getActiveTools: () => readSessionToolSelection(entries) ?? ["read", "edit"], appendEntry: manager.appendCustomEntry, registerTool: (value) => { tool = value; } }); return tool; };
  const commit = toolOf(createGitCommitExtension(cwd, () => readSessionGitWorkflow(entries)));
  const workflow = toolOf(createAgentGitWorkflowExtension(cwd, agentDir, manager));
  const start = toolOf(createGitWorkspaceStartExtension(cwd, () => readSessionGitWorkflow(entries)));
  const ctx = (answer = async () => false) => ({ cwd, hasUI: true, sessionManager: manager, ui: { gitAction: answer } });
  const run = (tool, params, answer) => tool.execute("call", params, undefined, undefined, ctx(answer));
  return { cwd, entries, manager, commit, workflow, start, run, head: await git(cwd, "rev-parse", "HEAD") };
}
const change = { operation: "commit", paths: ["a"], message: "Exactly reviewed" };

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
  const result = await f.run(f.commit, change, async () => {
    writeGitWorkflowSettingsDocument({ version: 1, paused: true, global: {}, projects: {} });
    return true;
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /paused/);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  let asked = false;
  assert.equal((await f.run(f.workflow, change, async () => { asked = true; return true; })).isError, true);
  assert.equal(asked, false);
  const status = await f.run(f.workflow, { operation: "status" });
  assert.equal(status.details.paused, true);
});

test("legacy preview cannot be confirmed after live disable", async (t) => {
  const f = await fixture(t);
  // Use a truly legacy manager; an appended v1 record cannot downgrade v2.
  f.entries.length = 0;
  appendSessionGitWorkflow(f.manager, { mode: "current", onCreate: "stay", commits: "agent" });
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
    if (mode === "read-only") f.entries.push({ type: "custom", customType: "pi-web:tool-selection", data: { version: 1, tools: ["read", "grep", "find", "ls"] } });
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
  createGitCommitExtension(f.cwd, () => readSessionGitWorkflow(f.entries)).factory({
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
    sink: gitActionSink(f.manager, f.manager.appendCustomEntry),
    ask: async () => true, beforeApply: async () => {
      if (++preflights === 2) { await new Promise((resolve) => setImmediate(resolve)); abort.abort(); }
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

test("both commit aliases reserve only capture/apply, never the approval wait, and release on every outcome", async (t) => {
  const { isGitCheckoutGated, acquireGitCheckoutGate } = await jiti.import("./git-checkout-gate.ts");
  const { requestWorkflowCommit } = await jiti.import("./git-workflow-commit.ts");
  for (const outcome of ["approve", "decline", "cancel", "stale", "busy"]) {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "candidate\n");
    const abort = new AbortController();
    let releaseRival, guarded = 0;
    let result, failure;
    try {
      result = await requestWorkflowCommit({ cwd: f.cwd, paths: ["a"], message: "gate", signal: abort.signal,
        sink: gitActionSink(f.manager, f.manager.appendCustomEntry),
        beforeApply: async () => { assert.equal(isGitCheckoutGated(f.cwd), true); guarded++; },
        ask: async () => {
          assert.equal(isGitCheckoutGated(f.cwd), false, "No transaction lock during an unlimited human wait");
          if (outcome === "cancel") abort.abort();
          if (outcome === "stale") await writeFile(join(f.cwd, "a"), "changed during wait\n");
          if (outcome === "busy") releaseRival = acquireGitCheckoutGate([f.cwd]);
          return outcome !== "decline";
        } });
    } catch (cause) { failure = cause; }
    finally { releaseRival?.(); }
    assert.equal(isGitCheckoutGated(f.cwd), false, outcome);
    assert.ok(guarded >= 1);
    if (outcome === "approve") assert.equal(result.details.status, "committed");
    else {
      assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
      if (["busy", "stale"].includes(outcome)) {
        assert.match(failure.message, outcome === "busy" ? /busy/ : /stale/);
        const record = (await readGitAction(f.entries.at(-1).data.actionId)).record;
        assert.equal(record.state, "blocked");
        assert.equal(record.decision, "approved", "Later admission failure must retain the actual human decision");
        assert.equal(record.outcome, undefined);
      } else assert.equal(result.details.approved, false);
    }
  }
});

test("agent commits exclude their initiating session, but reject competing running sessions and reservations", async (t) => {
  const { acquireGitCheckoutGate, isGitCheckoutGated } = await jiti.import("./git-checkout-gate.ts");
  const previous = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = previous; });
  for (const alias of ["commit", "workflow"]) {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "candidate\n");
    let otherRunning = false, asked = 0;
    const self = { sessionId: f.manager.getSessionId(), cwd: f.cwd, isRunning: () => true };
    const other = { sessionId: "other", cwd: f.cwd, isRunning: () => otherRunning };
    globalThis.__piSessions = new Map([[self.sessionId, self], [other.sessionId, other]]);
    const answer = async () => { asked++; assert.equal(isGitCheckoutGated(f.cwd), false); return false; };
    const release = acquireGitCheckoutGate([f.cwd]);
    try { assert.match((await f.run(f[alias], change, answer)).content[0].text, /busy/); }
    finally { release(); }
    t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", (cwd, callerId) =>
      otherRunning && cwd === f.cwd && callerId !== other.sessionId);
    otherRunning = true;
    assert.match((await f.run(f[alias], change, answer)).content[0].text, /checkout operation is active|Another checkout operation is active/i);
    assert.equal(asked, 0);
    otherRunning = false;
    assert.equal((await f.run(f[alias], change, answer)).details.approved, false, "own running session and other idle session are allowed");
    assert.equal(asked, 1);
    const late = await f.run(f[alias], change, async () => { otherRunning = true; return true; });
    assert.match(late.content[0].text, /checkout operation is active|Another checkout operation is active/i);
    assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
    assert.equal(isGitCheckoutGated(f.cwd), false);
    otherRunning = false;
    assert.equal((await f.run(f[alias], change, async () => true)).details.status, "committed");
  }
});

test("legacy preview/confirm uses the same checkout reservation without gaining new authority", async (t) => {
  const { acquireGitCheckoutGate, isGitCheckoutGated } = await jiti.import("./git-checkout-gate.ts");
  const f = await fixture(t);
  f.entries.length = 0;
  appendSessionGitWorkflow(f.manager, { mode: "current", onCreate: "stay", commits: "agent" });
  await writeFile(join(f.cwd, "a"), "legacy\n");
  let release = acquireGitCheckoutGate([f.cwd]);
  try { assert.match((await f.run(f.commit, { operation: "preview", paths: ["a"] })).content[0].text, /busy/); }
  finally { release(); }
  const preview = (await f.run(f.commit, { operation: "preview", paths: ["a"] })).details.preview;
  assert.equal(isGitCheckoutGated(f.cwd), false);
  release = acquireGitCheckoutGate([f.cwd]);
  try { assert.match((await f.run(f.commit, { operation: "confirm", preview, message: "legacy" })).content[0].text, /busy/); }
  finally { release(); }
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  assert.equal((await f.run(f.commit, { operation: "confirm", preview, message: "legacy" })).details.status, "committed");
  assert.equal(isGitCheckoutGated(f.cwd), false);
});

test("safe operation blockers are specific, but configured-key diagnostics never leak through either alias", async (t) => {
  const f = await fixture(t);
  const { isGitCheckoutGated } = await jiti.import("./git-checkout-gate.ts");
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
  f.entries.length = 0;
  appendSessionGitWorkflow(f.manager, { mode: "current", onCreate: "stay", commits: "agent" });
  const legacy = await f.run(f.commit, { operation: "preview", paths: ["a"] });
  assert.equal(legacy.isError, true);
  assert.doesNotMatch(JSON.stringify(legacy), /PRIVATE_SENTINEL|filter\./i);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), f.head);
  assert.equal(isGitCheckoutGated(f.cwd), false);
});
