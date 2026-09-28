import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-workflow-access-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { assertManagedGitAction, watchManagedGitAccess, ManagedGitAccessError } = await jiti.import("./git-workflow-access.ts");
const { resolveGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
const { appendManagedSessionGitWorkflow, snapshotManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { GIT_WORKFLOW_TYPE, appendSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { gitWorkflowSettingsPath, readGitWorkflowSettingsDocument, withGitWorkflowSettingsLock,
  writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const exec = promisify(execFile);
const stages = ["workspace", "commit", "checks", "integration", "settings"];
const configured = (overrides = {}) => resolveGitWorkflowSettings({ workspace: "worktree", baseBranch: "main",
  targetBranch: "main", checks: [{ label: "Tests", argv: ["npm", "test"] }], ...overrides }).values;

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-workflow-access-repo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = join(dir, "repo"), storeDir = join(dir, "agent");
  await exec("git", ["init", "-qb", "main", cwd], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(agentDir, "no-git-config") },
  });
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  snapshotManagedSessionGitWorkflow(sm, configured(overrides));
  const entries = sm.getEntries();
  return { cwd, storeDir, sm, entries, gate: (stage, actor = "agent") => assertManagedGitAction(cwd, entries, stage, actor, storeDir) };
}
async function editDocument(storeDir, edit) {
  await withGitWorkflowSettingsLock(storeDir, async () => {
    const document = readGitWorkflowSettingsDocument(storeDir);
    edit(document);
    writeGitWorkflowSettingsDocument(document, storeDir);
  });
}
async function blocked(action, message) {
  await assert.rejects(action, (error) => error instanceof ManagedGitAccessError && message.test(error.message));
}

test("the same captured task rechecks pause and effective disablement for every actor and stage", async (t) => {
  const f = await fixture(t);
  const captured = structuredClone(f.entries);
  for (const actor of ["agent", "human"]) for (const stage of stages) await f.gate(stage, actor);
  await editDocument(f.storeDir, (doc) => { doc.paused = true; });
  for (const actor of ["agent", "human"]) for (const stage of stages) await blocked(f.gate(stage, actor), /paused/i);
  await editDocument(f.storeDir, (doc) => { doc.paused = false; doc.global.enabled = false; });
  for (const actor of ["agent", "human"]) for (const stage of stages) await blocked(f.gate(stage, actor), /disabled/i);
  await editDocument(f.storeDir, (doc) => { doc.global.enabled = true; });
  await f.gate("commit");
  assert.deepEqual(f.entries, captured, "live safety switches must not rewrite captured task choices");
});

test("session enable overrides a global default-off, but cannot override pause-all", async (t) => {
  const f = await fixture(t);
  appendManagedSessionGitWorkflow(f.sm, { enabled: true }, { kind: "managed", settings: configured() });
  const captured = f.sm.getEntries();
  const gate = () => assertManagedGitAction(f.cwd, captured, "commit", "human", f.storeDir);
  await editDocument(f.storeDir, (doc) => { doc.global.enabled = false; });
  const allowed = await gate();
  assert.equal(allowed.resolved.session.origins.enabled, "session");
  assert.equal(allowed.resolved.session.values.enabled, true);
  await editDocument(f.storeDir, (doc) => { doc.paused = true; });
  await blocked(gate(), /paused/i);
});

test("manual blocks agent commits, off blocks both, and neither forbids explicitly selected human checks", async (t) => {
  for (const commits of ["off", "manual", "ask"]) {
    const f = await fixture(t, { commits });
    const before = structuredClone(f.entries);
    for (const actor of ["agent", "human"]) {
      if (commits === "off" || (commits === "manual" && actor === "agent")) {
        await blocked(f.gate("commit", actor), commits === "off" ? /disabled/i : /manual/i);
      } else {
        const state = await f.gate("commit", actor);
        assert.equal(state.task.settings.commits, commits);
        assert.equal(Object.hasOwn(state, "approved"), false);
      }
      await f.gate("checks", actor);
      await f.gate("integration", actor);
    }
    assert.deepEqual(f.entries, before);
  }
});

test("a disabled captured task does not become executable when defaults are enabled", async (t) => {
  const f = await fixture(t, { enabled: false });
  await editDocument(f.storeDir, (doc) => { doc.global.enabled = true; });
  for (const actor of ["agent", "human"]) for (const stage of stages) await blocked(f.gate(stage, actor), /task is disabled/i);
});

test("workspace and ordered-check prerequisites are task-bound, not supplied by newer defaults", async (t) => {
  const invalid = [
    { overrides: { workspace: "current" }, stage: "workspace", message: /worktree base/i },
    { overrides: { baseBranch: null }, stage: "workspace", message: /worktree base/i },
    { overrides: { targetBranch: null }, stage: "checks", message: /ordered checks/i },
    { overrides: { checks: [] }, stage: "integration", message: /ordered checks/i },
    { overrides: { method: "ff" }, stage: "integration", message: /non-FF/i },
    { overrides: { method: "squash" }, stage: "checks", message: /non-FF/i },
  ];
  for (const { overrides, stage, message } of invalid) {
    const f = await fixture(t, overrides);
    await editDocument(f.storeDir, (doc) => { doc.global = configured(); });
    for (const actor of ["agent", "human"]) await blocked(f.gate(stage, actor), message);
  }
});

test("malformed/future defaults or session authority fail closed rather than reviving legacy consent", async (t) => {
  const f = await fixture(t);
  await editDocument(f.storeDir, () => {});
  for (const raw of ["{", JSON.stringify({ version: 99, paused: false, global: {}, projects: {} }),
    JSON.stringify({ version: 1, paused: false, global: { commits: "agent" }, projects: {} })]) {
    await writeFile(gitWorkflowSettingsPath(f.storeDir), raw);
    for (const actor of ["agent", "human"]) await blocked(f.gate("commit", actor), /unavailable or unsupported/i);
  }
  await writeFile(gitWorkflowSettingsPath(f.storeDir), JSON.stringify({ version: 1, paused: false, global: {}, projects: {} }));
  const legacy = SessionManager.create(f.cwd);
  appendSessionGitWorkflow(legacy, { mode: "current", commits: "agent", onCreate: "stay" });
  const entries = [...legacy.getEntries(), { type: "custom", customType: GIT_WORKFLOW_TYPE, data: { version: 99 } }];
  for (const stage of stages) await blocked(assertManagedGitAction(f.cwd, entries, stage, "agent", f.storeDir), /unavailable or unsupported/i);
});

test("a watcher cancels checks on live pause using the same captured session state", async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setInterval"] });
  let lastCheck;
  const watcher = await watchManagedGitAccess(() => (lastCheck = f.gate("checks", "human")));
  t.after(() => watcher.dispose());
  assert.equal(watcher.signal.aborted, false);
  await editDocument(f.storeDir, (doc) => { doc.paused = true; });
  t.mock.timers.tick(250);
  await blocked(lastCheck, /paused/i);
  await nextTurn();
  assert.equal(watcher.signal.aborted, true);
  await editDocument(f.storeDir, (doc) => { doc.paused = false; });
  t.mock.timers.tick(1000);
  assert.equal(watcher.signal.aborted, true, "revocation must not automatically restart a cancelled check");
});

test("watchers reject initial denial and propagate already-aborted or later-aborted parent signals", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let deniedCalls = 0;
  await assert.rejects(watchManagedGitAccess(async () => { deniedCalls++; throw new Error("denied"); }), /denied/);
  t.mock.timers.tick(1000);
  assert.equal(deniedCalls, 1);
  for (const alreadyAborted of [false, true]) {
    const parent = new AbortController();
    if (alreadyAborted) parent.abort();
    const watcher = await watchManagedGitAccess(async () => {}, parent.signal);
    t.after(() => watcher.dispose());
    assert.equal(watcher.signal.aborted, alreadyAborted);
    parent.abort();
    assert.equal(watcher.signal.aborted, true);
  }
});

test("watch polling is non-overlapping and disposal stops polling and detaches parent cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const parent = new AbortController();
  let calls = 0, finish;
  const watcher = await watchManagedGitAccess(async () => {
    calls++;
    if (calls === 2) await new Promise((resolve) => { finish = resolve; });
  }, parent.signal);
  t.after(() => watcher.dispose());
  t.mock.timers.tick(250);
  assert.equal(calls, 2);
  t.mock.timers.tick(2000);
  assert.equal(calls, 2, "a slow live check must not overlap itself");
  finish();
  await nextTurn();
  t.mock.timers.tick(250);
  assert.equal(calls, 3);
  await nextTurn();
  watcher.dispose();
  watcher.dispose();
  parent.abort();
  t.mock.timers.tick(1000);
  assert.equal(calls, 3);
  assert.equal(watcher.signal.aborted, false, "dispose is not a cancellation and must remove the parent listener");
});
