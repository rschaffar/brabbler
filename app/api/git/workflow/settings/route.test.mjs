import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-workflow-settings-route-agent-"));
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
const { gitWorkflowDefaultsPath, setProjectGitWorkflow } = await jiti.import("../../../../../lib/git-workflow-store.ts");
const { acquireGitCheckoutGate } = await jiti.import("../../../../../lib/git-checkout-gate.ts");
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
  await rm(gitWorkflowSettingsPath(), { force: true });
  await rm(gitWorkflowDefaultsPath(), { force: true });
});
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
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
  await save("global", {}, { overrides: { commits: "manual", targetBranch: "main", checks: [check("Global", "npm", "test")] } });
  assert.deepEqual((await state(f.query)).task, captured);
  await save("project", { cwd: f.cwd }, { overrides: { workspace: "worktree", baseBranch: "main", commits: "off" } });
  assert.deepEqual((await state(f.query)).task, captured);
  assert.equal(await readFile(f.file, "utf8"), initialFile, "default saves must not append to an existing session");
  const sessionOverrides = { commits: "manual", targetBranch: null, checks: [] };
  const sessionSaved = await save("session", f.query, { overrides: sessionOverrides });
  assert.deepEqual(sessionSaved.task, captured);
  assert.deepEqual(sessionSaved.session, sessionOverrides);
  assert.equal(sessionSaved.resolved.session.origins.workspace, "project");
  assert.equal(sessionSaved.resolved.session.origins.targetBranch, "session");
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
  const global = { enabled: true, baseBranch: "main", targetBranch: "main", checks: [check("Inherited", "npm", "test")] };
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
  assert.equal(projectReset.resolved.session.values.baseBranch, "main");
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

test("running chats and busy checkouts expose read-only session state and block override/apply", async (t) => {
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
  const release = acquireGitCheckoutGate([f.cwd]);
  try {
    const busy = await state(f.query);
    assert.equal(busy.sessionEditable, false);
    assert.match(busy.sessionReason, /busy/i);
    for (const operation of [{ scope: "session", overrides: {} }, { scope: "task" }]) {
      await json(await put({ ...operation, ...f.query, revision: busy.revision }), 409);
    }
    assert.equal(await readFile(f.file, "utf8"), original);
  } finally { release(); }
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
