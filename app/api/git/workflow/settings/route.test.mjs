import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentHome = await mkdtemp(join(tmpdir(), "pi-web-workflow-settings-route-agent-"));
let agentDir = agentHome;
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, PUT } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../../lib/session-reader.ts");
const { GIT_WORKFLOW_TYPE, appendSessionGitWorkflow, readSessionGitWorkflow } = await jiti.import("../../../../../lib/git-workflow-policy.ts");
const { workflowTaskFromEntries, readManagedSessionGitWorkflow } = await jiti.import("../../../../../lib/git-workflow-session.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("../../../../../lib/git-workflow-settings.ts");
const { gitWorkflowSettingsPath, readGitWorkflowSettingsDocument } = await jiti.import("../../../../../lib/git-workflow-settings-store.ts");
const { setProjectGitWorkflow } = await jiti.import("../../../../../lib/git-workflow-store.ts");
const { seedRetiredGitBookkeeping } = await import("../../../../../lib/retired-git-bookkeeping-fixture.mjs");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], {
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(agentDir, "no-git-config") },
})).stdout.trim();
const endpoint = "http://localhost/api/git/workflow/settings";
const get = (query = {}) => GET(new Request(`${endpoint}?${new URLSearchParams(query)}`));
const put = (body) => PUT(new Request(endpoint, { method: "PUT", body: JSON.stringify(body) }));
const check = (label, ...argv) => ({ label, argv });
const oldPolicy = () => ({ mode: "worktree", baseBranch: "main", onCreate: "continue", commits: "agent",
  integration: { targetBranch: "main", method: "merge" }, checks: [check("Legacy test", "npm", "test")] });
async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
const state = async (query = {}) => json(await get(query));
async function save(scope, query = {}, fields = {}) {
  const before = await state(query);
  return json(await put({ scope, ...query, revision: before.revision, ...fields }));
}
const bytes = async (file) => readFile(file, "utf8").catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});

beforeEach(async () => {
  // Fresh authority incarnation per test; deleting only the settings document
  // is an unaccounted rewrite, not a legitimate reset of the monotonic ledger.
  agentDir = await mkdtemp(join(agentHome, "case-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentHome, { recursive: true, force: true });
});

async function fixture(t, linked = false) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-workflow-settings-route-repo-"));
  const repo = join(dir, "repo");
  await git(dir, "init", "-qb", "main", repo);
  await git(repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${join(dir, "no-hooks")}`, "commit", "--allow-empty", "-qm", "initial");
  const cwd = linked ? join(dir, "linked") : repo;
  if (linked) await git(repo, "worktree", "add", "-qb", "feature/linked", cwd);
  allowFileRoot(repo);
  allowFileRoot(cwd);
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const id = sm.getSessionId(), file = sm.getSessionFile();
  cacheSessionPath(id, file);
  t.after(async () => {
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, repo, cwd, sm, id, file, query: { sessionId: id } };
}

test("chat opt-out is revision-bound, idle-only and preserves the captured policy", async (t) => {
  const f = await fixture(t);
  appendSessionGitWorkflow(f.sm, oldPolicy());
  const initial = await state(f.query);
  assert.equal(initial.optedOut, false);
  const off = await save("optout", f.query, { optedOut: true });
  assert.equal(off.optedOut, true);
  assert.equal(readSessionGitWorkflow(SessionManager.open(f.file, undefined).getEntries()), null);
  assert.deepEqual(readManagedSessionGitWorkflow(SessionManager.open(f.file, undefined).getEntries()).task.policy, oldPolicy());
  await json(await put({ scope: "optout", ...f.query, revision: initial.revision, optedOut: false }), 409);
  await json(await put({ scope: "optout", ...f.query, revision: off.revision, optedOut: "false" }), 400);
  await json(await put({ scope: "optout", revision: (await state()).revision, optedOut: true }), 409);
  const selected = await state({ ...f.query, projectPath: f.cwd });
  assert.equal(selected.optedOut, true);
  await json(await put({ scope: "optout", ...f.query, projectPath: f.cwd, revision: selected.revision, optedOut: false }), 400);
  const on = await save("optout", f.query, { optedOut: false });
  assert.equal(on.optedOut, false);
  assert.deepEqual(readSessionGitWorkflow(SessionManager.open(f.file, undefined).getEntries()), oldPolicy());
});

test("global settings and pause work without a selected chat and never create a session", async () => {
  const sessionDirs = () => readdir(join(agentDir, "sessions")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const beforeDirs = await sessionDirs();
  const initial = await state();
  assert.equal(initial.session, null);
  assert.equal(initial.sessionEditable, false);
  assert.deepEqual(initial.task, { kind: "none" });
  assert.deepEqual(initial.resolved.global.values, DEFAULT_GIT_WORKFLOW_SETTINGS);
  assert.ok(Object.values(initial.resolved.global.origins).every((origin) => origin === "builtin"));
  assert.equal(Object.hasOwn(initial, "cwd"), false);
  const saved = await save("global", {}, { overrides: { enabled: false, commits: "manual", baseBranch: null, checks: [] } });
  assert.equal(saved.resolved.global.origins.enabled, "global");
  assert.equal(saved.resolved.global.values.enabled, false);
  assert.notEqual(saved.revision, initial.revision);
  assert.equal((await save("pause", {}, { paused: true })).paused, true);
  assert.equal((await save("pause", {}, { paused: false })).paused, false);
  const reset = await save("global", {}, { overrides: {} });
  assert.deepEqual(reset.global, {});
  assert.deepEqual(reset.resolved.global.values, DEFAULT_GIT_WORKFLOW_SETTINGS);
  assert.deepEqual(await sessionDirs(), beforeDirs);
});

test("settings summaries and actual route/tool gates agree for every supported commit mode and origin", async (t) => {
  const { assertManagedGitAction } = await jiti.import("../../../../../lib/git-workflow-access.ts");
  const { POST } = await jiti.import("../../commit/route.ts");
  for (const scope of ["global", "project", "session"]) for (const commits of ["off", "manual", "ask"]) {
    const f = await fixture(t);
    f.sm.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: ["read", "edit"] });
    await save(scope, scope === "global" ? {} : f.query, { overrides: { commits } });
    const captured = await save("task", f.query);
    assert.equal(captured.resolved.session.origins.commits, scope);
    const loaded = SessionManager.open(f.file).getEntries();
    for (const actor of ["agent", "human"]) {
      const permission = captured.permissions[actor].commit;
      const check = () => assertManagedGitAction(f.cwd, loaded, "commit", actor, agentDir, ["read", "edit"]);
      if (permission.kind === "blocked") await assert.rejects(check, (error) => error.message === permission.reason);
      else await check();
    }
    await writeFile(join(f.cwd, "candidate"), "test-only candidate\n");
    const response = await POST(new Request("http://localhost/api/git/commit", { method: "POST", body: JSON.stringify({
      sessionId: f.id, operation: "preview", paths: ["candidate"], message: "Permission parity",
    }) }));
    const body = await response.json();
    if (commits === "off") {
      assert.equal(response.status, 409);
      assert.equal(body.error, captured.permissions.human.commit.reason);
    } else {
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.ok(body.actionId);
    }
    assert.equal(captured.permissions.legacyAgentCommitConsent, false);
  }
});

test("permission facts do not create wrappers, and effective read-only tools override a saved coding preset", async (t) => {
  const f = await fixture(t);
  const registry = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = registry; });
  const original = await readFile(f.file, "utf8");
  assert.equal((await state(f.query)).permissions.agent.commit.code, "unknown-tools");
  assert.equal((await state()).permissions, undefined, "No chat is not a permission-bearing session");
  assert.equal(globalThis.__piSessions, registry, "GET must not initialize an agent");
  assert.equal(await readFile(f.file, "utf8"), original);
  f.sm.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: ["read", "edit"] });
  assert.equal((await state(f.query)).permissions.agent.commit.kind, "confirmation-required");
  globalThis.__piSessions = new Map([[f.id, { sessionFile: f.file, isAlive: () => true, isRunning: () => false,
    inner: { sessionManager: f.sm, getActiveToolNames: () => ["read", "grep", "git_commit"] } }]]);
  const readonly = await state(f.query);
  assert.equal(readonly.permissions.agent.commit.code, "read-only");
  assert.equal(readonly.permissions.human.commit.kind, "confirmation-required");
});

test("project writes use the canonical main repository for linked/aliased cwd and stay isolated", async (t) => {
  const f = await fixture(t, true), other = await fixture(t);
  const alias = join(f.dir, "alias");
  await symlink(f.cwd, alias, "dir");
  allowFileRoot(alias);
  await save("global", {}, { overrides: { commits: "manual" } });
  const overrides = { commits: "off", baseBranch: null, checks: [check("Second", "node", "b.mjs"), check("First", "node", "a.mjs")] };
  const saved = await save("project", { cwd: alias }, { overrides });
  assert.equal(saved.cwd, f.cwd);
  assert.equal(saved.projectRoot, f.repo);
  for (const query of [{ cwd: f.repo }, { cwd: f.cwd }, { cwd: alias }, f.query]) {
    const loaded = await state(query);
    assert.equal(loaded.projectRoot, f.repo);
    assert.deepEqual(loaded.project, overrides);
    assert.deepEqual(loaded.resolved.project.values.checks, overrides.checks);
    assert.equal(loaded.resolved.project.origins.commits, "project");
  }
  await save("project", { cwd: other.cwd }, { overrides: { commits: "ask" } });
  const document = readGitWorkflowSettingsDocument();
  assert.deepEqual(Object.keys(document.projects).sort(), [f.repo, other.repo].sort());
  assert.equal(document.global.commits, "manual");
  assert.deepEqual((await state(f.query)).task, { kind: "none" });
  assert.equal((await state(other.query)).resolved.project.values.commits, "ask");
  assert.equal(await git(f.cwd, "status", "--porcelain"), "");
});

test("global/project/session saves preserve the current task until a separate explicit task apply", async (t) => {
  const f = await fixture(t);
  const adopted = await save("task", f.query);
  const captured = adopted.task;
  assert.equal(captured.kind, "managed");
  assert.deepEqual(captured.settings, DEFAULT_GIT_WORKFLOW_SETTINGS);
  const initialFile = await readFile(f.file, "utf8");
  await save("global", {}, { overrides: { commits: "manual", targetBranch: ":project-main", commitConfirmation: "ask" } });
  assert.deepEqual((await state(f.query)).task, captured);
  await save("project", { cwd: f.cwd }, { overrides: { workspace: "worktree", mainBranch: "main", baseBranch: ":project-main", commits: "off", checks: [check("Project", "npm", "test")] } });
  assert.deepEqual((await state(f.query)).task, captured);
  assert.equal(await readFile(f.file, "utf8"), initialFile, "default saves must not append to an existing session");
  const sessionOverrides = { commits: "manual", checkConfirmation: "disabled" };
  const sessionSaved = await save("session", f.query, { overrides: sessionOverrides });
  assert.deepEqual(sessionSaved.task, captured);
  assert.deepEqual(sessionSaved.session, sessionOverrides);
  assert.equal(sessionSaved.resolved.session.origins.workspace, "project");
  assert.equal(sessionSaved.resolved.session.origins.checkConfirmation, "session");
  const documentBefore = await readFile(gitWorkflowSettingsPath(), "utf8");
  const applied = await save("task", f.query);
  assert.deepEqual(applied.task, { kind: "managed", settings: sessionSaved.resolved.session.values });
  assert.deepEqual(applied.session, sessionOverrides);
  assert.equal(await readFile(gitWorkflowSettingsPath(), "utf8"), documentBefore);
  const reopened = SessionManager.open(f.file, undefined).getEntries();
  assert.deepEqual(workflowTaskFromEntries(reopened), applied.task);
  assert.equal(readSessionGitWorkflow(reopened).commits, "manual");
  assert.deepEqual(reopened.at(-2).data, { version: 1, policy: null });
  assert.deepEqual((await state(f.query)).task, applied.task);
});

test("reset removes overrides; false/null/empty lists do not inherit or implicitly apply", async (t) => {
  const f = await fixture(t);
  const global = { enabled: true, baseBranch: ":project-main", targetBranch: ":project-main", checks: [] };
  await save("global", {}, { overrides: global });
  const project = { enabled: false, baseBranch: null, targetBranch: null, checks: [] };
  await save("project", f.query, { overrides: project });
  const overridden = await save("session", f.query, { overrides: { enabled: true, checks: [] } });
  assert.equal(overridden.resolved.session.values.enabled, true);
  assert.equal(overridden.resolved.session.values.baseBranch, null);
  assert.deepEqual(overridden.resolved.session.values.checks, []);
  const sessionReset = await save("session", f.query, { overrides: {} });
  assert.equal(sessionReset.resolved.session.values.enabled, false);
  assert.equal(sessionReset.resolved.session.origins.enabled, "project");
  assert.deepEqual(sessionReset.session, {});
  const projectReset = await save("project", f.query, { overrides: {} });
  assert.deepEqual(projectReset.project, {});
  assert.equal(projectReset.resolved.session.values.baseBranch, ":project-main");
  assert.deepEqual(projectReset.resolved.session.values.checks, global.checks);
  assert.equal(projectReset.resolved.session.origins.checks, "global");
  assert.deepEqual(projectReset.task, { kind: "none" });
});

test("old sessions retain old consent, imported defaults never grant it, and empty project reset suppresses re-import", async (t) => {
  const f = await fixture(t);
  await setProjectGitWorkflow(f.cwd, oldPolicy());
  appendSessionGitWorkflow(f.sm, oldPolicy());
  const initial = await state(f.query);
  assert.equal(initial.task.policy.commits, "agent");
  assert.equal(initial.resolved.project.values.commits, "ask");
  assert.deepEqual(initial.session, {});
  const updated = await save("session", f.query, { overrides: { commits: "off" } });
  assert.deepEqual(updated.task, initial.task);
  assert.equal(readSessionGitWorkflow(SessionManager.open(f.file, undefined).getEntries()).commits, "agent");
  const defaultsOnly = await state({ cwd: f.cwd });
  assert.deepEqual(defaultsOnly.task, { kind: "none" });
  await save("global", {}, { overrides: { commits: "manual" } });
  const reset = await save("project", f.query, { overrides: {} });
  assert.deepEqual(reset.project, {});
  assert.equal(reset.resolved.project.values.commits, "manual");
  assert.equal(reset.resolved.project.origins.commits, "global");
  const applied = await save("task", f.query);
  assert.equal(applied.task.kind, "managed");
  assert.equal(applied.task.settings.commits, "off");
  const entries = SessionManager.open(f.file, undefined).getEntries();
  assert.equal(readSessionGitWorkflow(entries).commits, "manual");
  assert.equal(readSessionGitWorkflow(entries.filter((e) => e.data?.version !== 2)), null);
});

test("concurrent same-revision saves conflict instead of losing edits, including session versus global", async (t) => {
  const f = await fixture(t);
  for (const [left, right] of [
    [{ scope: "global", overrides: { commits: "manual" } }, { scope: "project", overrides: { targetBranch: "main" } }],
    [{ scope: "session", overrides: { checks: [] } }, { scope: "global", overrides: { enabled: false } }],
  ]) {
    const before = await state(f.query);
    const requests = [left, right].map((operation) => ({ ...operation, ...f.query, revision: before.revision }));
    const results = await Promise.all(requests.map(put));
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    const winnerIndex = results.findIndex((response) => response.status === 200);
    const loserIndex = 1 - winnerIndex;
    const winner = [left, right][winnerIndex], loser = [left, right][loserIndex];
    const conflict = await results[loserIndex].json();
    assert.match(conflict.error, /changed elsewhere/i);
    const fresh = await state(f.query);
    assert.deepEqual(fresh[winner.scope], winner.overrides);
    assert.deepEqual(fresh[loser.scope], before[loser.scope]);
    const retried = await json(await put({ ...requests[loserIndex], revision: fresh.revision }));
    assert.deepEqual(retried[winner.scope], winner.overrides);
    assert.deepEqual(retried[loser.scope], loser.overrides);
    assert.deepEqual(retried.task, before.task);
  }
});

test("unrelated appends do not stale defaults or pause; session saves preserve the freshly loaded transcript", async (t) => {
  const f = await fixture(t);
  const before = await state(f.query);
  const external = SessionManager.open(f.file, undefined);
  external.appendMessage({ role: "user", content: "another editor", timestamp: Date.now() });
  const externalBytes = await readFile(f.file, "utf8");
  assert.equal((await state(f.query)).revision, before.revision);
  const defaults = await json(await put({ scope: "global", ...f.query, revision: before.revision, overrides: { commits: "manual" } }));
  const paused = await json(await put({ scope: "pause", ...f.query, revision: defaults.revision, paused: true }));
  assert.equal(paused.paused, true);
  assert.deepEqual(paused.task, before.task);
  assert.equal(await readFile(f.file, "utf8"), externalBytes);
  await save("session", f.query, { overrides: { commits: "manual" } });
  assert.ok((await readFile(f.file, "utf8")).startsWith(externalBytes));
});

test("invalid bodies, future authority and client-supplied task snapshots never write settings or sessions", async (t) => {
  const f = await fixture(t);
  const before = await state(f.query), original = await readFile(f.file, "utf8");
  const base = { scope: "session", ...f.query, revision: before.revision, overrides: {} };
  const bad = [null, [], "payload", {}, { ...base, scope: "automatic" }, { ...base, revision: 1 },
    { ...base, overrides: null }, { ...base, overrides: [] }, { ...base, overrides: { enabled: "false" } },
    { ...base, overrides: { commits: "agent" } }, { ...base, overrides: { cleanup: "delete" } },
    { ...base, overrides: { autoApprove: true } }, { ...base, overrides: { push: true } },
    { ...base, overrides: { targetBranch: "refs/remotes/origin/main" } },
    { ...base, overrides: { checks: [{ label: "Shell", argv: ["sh", "-c", "echo no"] }] } },
    { ...base, overrides: { checks: [{ label: "URL", argv: ["curl", "https://example.invalid"] }] } },
    { ...base, approved: true }, { ...base, version: 3 }, { ...base, task: { kind: "none" } },
    { scope: "task", ...f.query, revision: before.revision, settings: DEFAULT_GIT_WORKFLOW_SETTINGS },
    { scope: "task", ...f.query, revision: before.revision, overrides: {} },
    { scope: "pause", revision: before.revision, paused: "true" }];
  for (const payload of bad) {
    await json(await put(payload), 400);
    assert.equal(await readFile(f.file, "utf8"), original, JSON.stringify(payload));
    assert.equal(await bytes(gitWorkflowSettingsPath()), null);
  }
  for (const body of ["{", "", "null"]) {
    await json(await PUT(new Request(endpoint, { method: "PUT", body })), 400);
  }
  await json(await PUT(new Request(endpoint, { method: "PUT" })), 400);
  await json(await put({ ...base, padding: "x".repeat(64 * 1024) }), 413);
  assert.equal(await readFile(f.file, "utf8"), original);
  assert.equal(await bytes(gitWorkflowSettingsPath()), null);
});

test("scope must be a string, not a coercible array that writes a different scope", async (t) => {
  const f = await fixture(t);
  const before = await state({ cwd: f.cwd });
  for (const scope of [["global"], ["project"], ["session"], ["pause"], ["task"]]) {
    await json(await put({ scope, cwd: f.cwd, revision: before.revision, overrides: { commits: "off" } }), 400);
    assert.equal(await bytes(gitWorkflowSettingsPath()), null);
  }
});

test("targets require explicit valid scope context, and unknown query keys or conflicting identifiers are rejected", async (t) => {
  const f = await fixture(t);
  const before = await state();
  for (const query of [{ version: "2" }, { sessionId: f.id, cwd: f.cwd }, { cwd: "relative" },
    { cwd: ` ${f.cwd}` }, { sessionId: "../session" }]) await json(await get(query), 400);
  await json(await get({ sessionId: "not-a-persisted-session" }), 409);
  await json(await put({ scope: "project", revision: before.revision, overrides: {} }), 400);
  await json(await put({ scope: "session", revision: before.revision, overrides: {} }), 409);
  await json(await put({ scope: "task", revision: before.revision }), 409);
  await json(await put({ scope: "session", sessionId: f.id, cwd: f.cwd, revision: before.revision, overrides: {} }), 400);
});

test("malformed/future store documents are not overwritten by a previously valid save", async (t) => {
  const f = await fixture(t);
  const initial = await save("global", {}, { overrides: { commits: "manual" } });
  const document = readGitWorkflowSettingsDocument();
  const sessionBytes = await readFile(f.file, "utf8");
  for (const raw of ["{", "null", JSON.stringify({ ...document, version: 99 }),
    JSON.stringify({ ...document, global: { commits: "automatic" } }),
    JSON.stringify({ ...document, approvals: { all: true } })]) {
    await writeFile(gitWorkflowSettingsPath(), raw);
    await json(await get(), 409);
    await json(await get(f.query), 409);
    await json(await put({ scope: "global", revision: initial.revision, overrides: {} }), 409);
    assert.equal(await readFile(gitWorkflowSettingsPath(), "utf8"), raw);
    assert.equal(await readFile(f.file, "utf8"), sessionBytes);
  }
});

test("future session authority and a v1 downgrade after adoption block reads and writes, not resurrect consent", async (t) => {
  for (const kind of ["future", "downgrade", "projection"]) {
    const f = await fixture(t);
    appendSessionGitWorkflow(f.sm, oldPolicy());
    const before = await save("task", f.query);
    const external = SessionManager.open(f.file, undefined);
    if (kind === "future") external.appendCustomEntry(GIT_WORKFLOW_TYPE, { version: 99, policy: oldPolicy() });
    else if (kind === "downgrade") appendSessionGitWorkflow(external, oldPolicy());
    else {
      const managed = readManagedSessionGitWorkflow(external.getEntries());
      external.appendCustomEntry(GIT_WORKFLOW_TYPE, { ...managed, policy: oldPolicy() });
    }
    const savedBytes = await readFile(f.file, "utf8");
    await json(await get(f.query), 409);
    await json(await put({ scope: "task", ...f.query, revision: before.revision }), 409);
    await json(await put({ scope: "session", ...f.query, revision: before.revision, overrides: {} }), 409);
    assert.equal(await readFile(f.file, "utf8"), savedBytes);
  }
});

test("own running chat blocks override/apply but retired bookkeeping does not", async (t) => {
  const f = await fixture(t);
  const previous = globalThis.__piSessions;
  const live = { sessionFile: f.file, isAlive: () => true, isRunning: () => true, inner: { sessionManager: f.sm, getActiveToolNames: () => ["read", "edit"] } };
  globalThis.__piSessions = new Map([[f.id, live]]);
  t.after(() => { globalThis.__piSessions = previous; });
  const original = await readFile(f.file, "utf8");
  const running = await state(f.query);
  assert.equal(running.sessionEditable, false);
  assert.match(running.sessionReason, /Stop the chat/i);
  for (const operation of [{ scope: "session", overrides: {} }, { scope: "task" }]) {
    await json(await put({ ...operation, ...f.query, revision: running.revision }), 409);
  }
  await save("pause", {}, { paused: true });
  await save("global", {}, { overrides: { enabled: false } });
  assert.equal(await readFile(f.file, "utf8"), original);
  live.isRunning = () => false;
  const restore = seedRetiredGitBookkeeping([f.cwd]);
  try {
    assert.equal((await state(f.query)).sessionEditable, true);
    for (const operation of [{ scope: "session", overrides: {} }, { scope: "task" }]) {
      const current = await state(f.query);
      await json(await put({ ...operation, ...f.query, revision: current.revision }));
    }
    assert.notEqual(await readFile(f.file, "utf8"), original);
  } finally { restore(); }
  assert.equal((await state(f.query)).sessionEditable, true);
});

test("subagent sessions are read-only even when idle, while project defaults remain independently editable", async (t) => {
  const f = await fixture(t);
  f.sm.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: "parent" });
  const original = await readFile(f.file, "utf8");
  const before = await state(f.query);
  assert.equal(before.sessionEditable, false);
  assert.match(before.sessionReason, /subagent/i);
  for (const operation of [{ scope: "session", overrides: {} }, { scope: "task" }]) {
    await json(await put({ ...operation, ...f.query, revision: before.revision }), 409);
  }
  await save("project", { cwd: f.cwd }, { overrides: { commits: "manual" } });
  assert.equal(await readFile(f.file, "utf8"), original);
  assert.deepEqual((await state(f.query)).task, { kind: "none" });
});

test("stale live editors and mismatched on-disk session identity fail without appending", async (t) => {
  const f = await fixture(t);
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[f.id, { sessionFile: f.file, isAlive: () => true,
    isRunning: () => false, inner: { sessionManager: f.sm, getActiveToolNames: () => ["read", "edit"] } }]]);
  t.after(() => { globalThis.__piSessions = previous; });
  const before = await state(f.query);
  const external = SessionManager.open(f.file, undefined);
  external.appendMessage({ role: "user", content: "external edit", timestamp: Date.now() });
  const appended = await readFile(f.file, "utf8");
  await json(await get(f.query), 409);
  await json(await put({ scope: "session", ...f.query, revision: before.revision, overrides: {} }), 409);
  assert.equal(await readFile(f.file, "utf8"), appended);
  globalThis.__piSessions = new Map();
  assert.equal((await get(f.query)).status, 200);
  await writeFile(f.file, appended.replace(`"id":"${f.id}"`, '"id":"wrong-id"'));
  const mismatched = await readFile(f.file, "utf8");
  await json(await get(f.query), 409);
  await json(await put({ scope: "task", ...f.query, revision: before.revision }), 409);
  assert.equal(await readFile(f.file, "utf8"), mismatched);
});

test("all cwd and persisted-session access uses the physical allowlist, including symlink escapes", async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "pi-web-workflow-settings-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const alias = join(f.cwd, "escape");
  await symlink(outside, alias, "dir");
  const before = await state(f.query);
  const original = await readFile(f.file, "utf8");
  for (const cwd of [outside, alias]) {
    await json(await get({ cwd }), 403);
    await json(await put({ scope: "project", cwd, revision: before.revision, overrides: {} }), 403);
  }
  const regularFile = join(f.cwd, "not-a-directory");
  await writeFile(regularFile, "fixture");
  await json(await get({ cwd: regularFile }), 404);
  const previousRoots = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 60_000 };
  try {
    await json(await get(f.query), 403);
    await json(await put({ scope: "session", ...f.query, revision: before.revision, overrides: {} }), 403);
    await json(await put({ scope: "task", ...f.query, revision: before.revision }), 403);
  } finally { globalThis.__piAllowedRootsCache = previousRoots; }
  assert.equal(await readFile(f.file, "utf8"), original);
});

test("one unchanged chat saves independent overrides for explicitly selected projects and linked worktrees", async (t) => {
  const a = await fixture(t, true), b = await fixture(t);
  a.sm.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: ["read", "edit"] });
  await save("project", { cwd: a.repo }, { overrides: { targetBranch: "a-target", commits: "ask" } });
  await save("project", { cwd: b.repo }, { overrides: { targetBranch: "b-target", commits: "manual" } });
  await save("session", a.query, { overrides: { commits: "manual", checks: [] } });
  const legacy = await state(a.query);
  const queryA = { sessionId: a.id, projectPath: a.cwd };
  const queryB = { sessionId: a.id, projectPath: b.cwd };
  const beforeB = await state(queryB);
  assert.equal(beforeB.cwd, b.cwd);
  assert.equal(beforeB.projectRoot, b.repo);
  assert.equal(beforeB.sessionScope, "project");
  assert.equal(beforeB.legacySessionSettings, true);
  assert.equal(beforeB.resolved.session.values.targetBranch, "b-target");
  assert.deepEqual(beforeB.session, {});
  assert.equal(beforeB.permissions.agent.commit.code, "manual-commits");
  await save("session", queryA, { overrides: { delivery: "leave", commitConfirmation: "none" } });
  await save("session", queryB, { overrides: { delivery: "pr", commits: "off" } });
  assert.equal((await state(queryA)).resolved.session.values.delivery, "leave");
  assert.deepEqual((await state({ sessionId: a.id, projectPath: a.repo })).session, { delivery: "leave", commitConfirmation: "none" });
  assert.deepEqual((await state(queryB)).session, { commits: "off", delivery: "pr" });
  assert.equal((await state(queryB)).permissions.human.commit.kind, "blocked");
  await save("session", queryB, { overrides: {} });
  assert.equal((await state(queryB)).resolved.session.values.targetBranch, "b-target");
  assert.equal((await state(queryA)).resolved.session.values.delivery, "leave");
  assert.deepEqual((await state(a.query)).session, legacy.session, "unqualified compatibility records remain untouched");
  assert.deepEqual((await state(a.query)).task, legacy.task);
  assert.equal(SessionManager.open(a.file).getCwd(), a.cwd, "configuration must not relocate the chat");
  assert.equal((await state(queryA)).permissions.agent.commit.code, "project-scope-read-only");
  assert.equal(await git(a.cwd, "status", "--porcelain"), "");
  assert.equal(await git(b.cwd, "status", "--porcelain"), "");
});

test("policy writes stay scope-bound, cannot mint execution consent or capture a task", async (t) => {
  const f = await fixture(t);
  f.sm.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: ["read", "edit"] });
  const original = await readFile(f.file, "utf8");
  const names = { mainBranch: "main", baseBranch: "main", targetBranch: "main", branch: "main",
    checks: [check("Test", "npm", "test")] };
  for (const [key, value] of Object.entries(names)) {
    for (const [scope, query] of [["global", {}], ["session", { sessionId: f.id, projectPath: f.cwd }]]) {
      const before = await state(query);
      await json(await put({ scope, ...query, revision: before.revision, overrides: { [key]: value } }), 400);
    }
  }
  assert.equal(await readFile(f.file, "utf8"), original);
  await save("global", {}, { overrides: { baseBranch: ":project-main", targetBranch: ":project-main", integrateConfirmation: "none" } });
  const selected = { sessionId: f.id, projectPath: f.cwd };
  await save("project", selected, { overrides: { mainBranch: "main", delivery: "pr", targetBranch: ":project-main",
    method: "ff", commits: "ask", commitConfirmation: "none", checks: [] } });
  await save("session", selected, { overrides: { delivery: "local", integrateConfirmation: "none" } });
  const result = await state(selected);
  assert.deepEqual(result.task, { kind: "none" });
  assert.equal(result.resolved.project.values.targetBranch, ":project-main");
  assert.equal(result.resolved.session.values.delivery, "local", "display origin is not permission to override PR restriction");
  assert.equal(result.permissions.agent.integration.code, "delivery-no-local-integration");
  assert.equal(result.permissions.agent.commit.code, "project-scope-read-only");
  assert.equal(result.resolved.session.origins.integrateConfirmation, "session");
  assert.equal(result.resolved.project.origins.mainBranch, "project");
  await save("project", selected, { overrides: { mainBranch: "main", delivery: "leave", commits: "off" } });
  assert.equal((await state(selected)).permissions.human.integration.code, "delivery-no-local-integration");
  assert.equal((await state(selected)).permissions.agent.commit.code, "session-commits-off");
  assert.equal(SessionManager.open(f.file).getCwd(), f.cwd);
});

test("PR delivery blocks legacy local integration in a linked checkout and nested caller", async (t) => {
  const f = await fixture(t, true);
  const nested = join(f.cwd, "nested");
  await mkdir(nested);
  await save("global", {}, { overrides: { delivery: "local", integrateConfirmation: "none" } });
  await save("project", { cwd: f.repo }, { overrides: { delivery: "pr" } });
  for (const cwd of [f.repo, f.cwd, nested]) {
    const result = await state({ cwd });
    assert.equal(result.permissions, undefined);
    const { loadGitWorkflowSettings } = await jiti.import("../../../../../lib/git-workflow-settings-store.ts");
    const { managedGitPermission } = await jiti.import("../../../../../lib/git-workflow-permissions.ts");
    const settings = await loadGitWorkflowSettings(cwd, [], agentDir);
    assert.equal(managedGitPermission(settings, { subagent: false, tools: ["edit"] }, "integration", "agent").code, "delivery-no-local-integration");
  }
});

test("project-scoped revisions cannot save to a different project and cannot capture a task", async (t) => {
  const a = await fixture(t), b = await fixture(t);
  const query = { sessionId: a.id, projectPath: a.cwd };
  const before = await state(query), original = await readFile(a.file, "utf8");
  await json(await put({ scope: "session", sessionId: a.id, projectPath: b.cwd, revision: before.revision, overrides: { commits: "off" } }), 409);
  await json(await put({ scope: "task", ...query, revision: before.revision }), 400);
  await json(await get({ ...query, cwd: a.cwd }), 400);
  assert.equal(await readFile(a.file, "utf8"), original);
  const noChat = await state({ projectPath: b.cwd });
  assert.equal(noChat.session, null);
  assert.equal(noChat.sessionEditable, false);
  assert.equal(noChat.projectRoot, b.repo);
});

test("explicit project access never borrows caller roots; retired caller/selected bookkeeping does not block settings", async (t) => {
  const a = await fixture(t), b = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "pi-project-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await json(await get({ sessionId: a.id, projectPath: outside }), 403);
  const query = { sessionId: a.id, projectPath: b.cwd };
  for (const cwd of [a.cwd, b.cwd]) {
    const restore = seedRetiredGitBookkeeping([cwd]);
    try {
      const current = await state(query);
      assert.equal(current.sessionEditable, true);
      await json(await put({ scope: "session", ...query, revision: current.revision, overrides: {} }));
    } finally { restore(); }
  }
  assert.equal((await state(query)).sessionEditable, true);
});

test("project-keyed restrictive settings cannot be bypassed by existing caller mutation entry points", async (t) => {
  const f = await fixture(t), other = await fixture(t);
  f.sm.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: ["read", "edit"] });
  await save("task", f.query);
  await save("session", { sessionId: f.id, projectPath: other.cwd }, { overrides: { enabled: false } });
  assert.equal((await state(f.query)).permissions.agent.commit.kind, "confirmation-required");
  await save("session", { sessionId: f.id, projectPath: f.cwd }, { overrides: { commits: "manual" } });
  assert.equal((await state(f.query)).permissions.agent.commit.code, "manual-commits");
  assert.equal((await state(f.query)).permissions.human.commit.kind, "confirmation-required");
  await save("session", { sessionId: f.id, projectPath: f.cwd }, { overrides: { commits: "off" } });
  const { POST } = await jiti.import("../../commit/route.ts");
  await writeFile(join(f.cwd, "candidate"), "scoped-off fixture\n");
  const refused = await POST(new Request("http://localhost/api/git/commit", { method: "POST", body: JSON.stringify({
    sessionId: f.id, operation: "preview", paths: ["candidate"], message: "Must not bypass scoped Off",
  }) }));
  await json(refused, 409);
});
