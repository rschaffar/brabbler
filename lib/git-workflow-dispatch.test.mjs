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
const jiti = createJiti(import.meta.url);
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
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();

async function fixture(t, settings = {}) {
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
  const sessionId = randomUUID();
  const manager = { getSessionId: () => sessionId, getEntries: () => entries,
    appendCustomEntry: (customType, data) => entries.push({ id: randomUUID(), parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(), type: "custom", customType, data }) };
  appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, ...settings } });
  const toolOf = (extension) => { let tool; extension.factory({ appendEntry: manager.appendCustomEntry, registerTool: (value) => { tool = value; } }); return tool; };
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
    for (const tool of [f.commit, f.workflow]) {
      const result = await f.run(tool, change, async () => { asked = true; return true; });
      assert.equal(result.isError, true, mode);
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
