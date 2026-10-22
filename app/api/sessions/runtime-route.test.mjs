import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { createJiti } from "jiti";

const listRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const detailRoute = await readFile(new URL("./[id]/route.ts", import.meta.url), "utf8");
const contextRoute = await readFile(new URL("./[id]/context/route.ts", import.meta.url), "utf8");
const stateRoute = await readFile(new URL("./[id]/state/route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  deleteSession,
  getSessionDetail,
  renameSession,
  getSessionList,
  searchSessions,
  getRunningSessions,
  getSessionState,
  dismissRecovery,
  listInterrupted,
  recordRunStart,
  readPossibleInterruptedRun,
  recordActivityCompletion,
  activityReviewPath,
  cacheSessionPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  SessionManager,
} = await jiti.import("./runtime-route.fixture.ts");

test("list versions expose idle session creation, rename and deletion to other windows", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-list-sync-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  let sessionId;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (sessionId) invalidateSessionPathCache(sessionId);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  const list = async () => {
    const response = await getSessionList(new Request("http://localhost/api/sessions"));
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await list();
  assert.deepEqual(initial.sessions, []);

  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: "Cross-window search fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Already finished" }], timestamp: Date.now() });
  sessionId = manager.getSessionId();
  invalidateSessionListCache();
  const created = await list();
  assert.ok(created.sessionListVersion > initial.sessionListVersion);
  assert.equal(created.sessions[0].id, sessionId);
  assert.deepEqual(created.runningSessionIds, []);

  const context = { params: Promise.resolve({ id: sessionId }) };
  const url = `http://localhost/api/sessions/${sessionId}`;
  const renamed = await renameSession(new Request(url, { method: "PATCH", body: JSON.stringify({ name: "Renamed elsewhere" }) }), context);
  assert.equal(renamed.status, 200);
  const poll = await (await getRunningSessions()).json();
  assert.deepEqual(poll.runningSessionIds, []);
  assert.deepEqual(poll.attention, [], "on-disk sessions are not assumed to need input");
  assert.ok(poll.sessionListVersion > created.sessionListVersion);
  const updated = await list();
  assert.equal(updated.sessionListVersion, poll.sessionListVersion);
  assert.equal(updated.sessions[0].name, "Renamed elsewhere");
  assert.equal((await list()).sessionListVersion, poll.sessionListVersion, "reads must not create a refresh loop");

  assert.equal((await deleteSession(new Request(url, { method: "DELETE" }), context)).status, 200);
  const deleted = await list();
  assert.ok(deleted.sessionListVersion > updated.sessionListVersion);
  assert.deepEqual(deleted.sessions, []);
  assert.equal((await (await getRunningSessions()).json()).sessionListVersion, deleted.sessionListVersion);
});

test("session detail reports a possible interrupted run without reopening it; dismissal and deletion persist", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-restart-recovery-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let id;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (id) invalidateSessionPathCache(id);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: "Saved prompt", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Saved response" }], timestamp: Date.now() });
  id = manager.getSessionId();
  cacheSessionPath(id, manager.getSessionFile());
  const runId = recordRunStart(id);
  const root = join(dir, "pi-web", "run-journal", "v1");
  const startFile = join(root, id, `${runId}.start.json`);
  assert.deepEqual((await (await listInterrupted()).json()).interruptedSessionIds, [], "live owner must not appear in Activity");
  const start = JSON.parse(await readFile(startFile, "utf8"));
  await writeFile(startFile, JSON.stringify({ ...start, ownerPid: 99999999 }));
  const context = { params: Promise.resolve({ id }) };
  const url = `http://localhost/api/sessions/${id}`;
  const detail = await getSessionDetail(new Request(`${url}?force=1`), context);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).possibleInterruptedRun.runId, runId);
  assert.deepEqual((await (await listInterrupted()).json()).interruptedSessionIds, [id]);
  const wrongRun = await dismissRecovery(new Request(`${url}/recovery`, { method: "POST", body: JSON.stringify({ runId: "wrong" }) }), context);
  assert.equal(wrongRun.status, 409);
  const secondRun = recordRunStart(id);
  const secondStartFile = join(root, id, `${secondRun}.start.json`);
  const secondStart = JSON.parse(await readFile(secondStartFile, "utf8"));
  await writeFile(secondStartFile, JSON.stringify({ ...secondStart, ownerPid: 99999999,
    startedAt: new Date(Date.parse(start.startedAt) - 60_000).toISOString() }));
  const dismiss = await dismissRecovery(new Request(`${url}/recovery`, { method: "POST", body: JSON.stringify({ runId }) }), context);
  assert.equal(dismiss.status, 200);
  assert.equal((await dismiss.json()).possibleInterruptedRun.runId, secondRun);
  const dismissSecond = await dismissRecovery(new Request(`${url}/recovery`, { method: "POST", body: JSON.stringify({ runId: secondRun }) }), context);
  assert.equal(dismissSecond.status, 200);
  assert.equal((await dismissSecond.json()).possibleInterruptedRun, null);
  assert.deepEqual((await (await listInterrupted()).json()).interruptedSessionIds, []);
  assert.equal((await (await getSessionDetail(new Request(url), context)).json()).possibleInterruptedRun, null);
  assert.equal((await deleteSession(new Request(url, { method: "DELETE" }), context)).status, 200);
  assert.equal(readPossibleInterruptedRun(id, root, () => false), null);
});

test("running snapshot exposes only live wrapper attention without opening sessions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-activity-snapshot-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(dir, { recursive: true, force: true });
  });
  const previous = globalThis.__piSessions;
  const previousSubagents = globalThis.__piSubagentRuns;
  recordActivityCompletion("finished", activityReviewPath(dir), 42);
  globalThis.__piSubagentRuns = new Map([["queued", { run: { status: "queued" } }]]);
  const waiting = { sessionId: "waiting", isRunning: () => true, hasSuppressedCompletionNotifications: () => false,
    getPendingAttention: () => ({ sessionId: "waiting", method: "ask_user", summary: "Choose?", since: 42 }) };
  globalThis.__piSessions = new Map([["waiting", waiting]]);
  try {
    const snapshot = await (await getRunningSessions()).json();
    assert.deepEqual(snapshot.runningSessionIds, ["waiting"]);
    assert.deepEqual(snapshot.queuedSessionIds, ["queued"]);
    assert.deepEqual(snapshot.attention, [{ sessionId: "waiting", method: "ask_user", summary: "Choose?", since: 42 }]);
    assert.deepEqual(snapshot.completedRuns, [{ sessionId: "finished", at: 42 }]);
    assert.deepEqual(snapshot.reviewedRuns, []);
    assert.equal(globalThis.__piSessions.size, 1);
  } finally {
    globalThis.__piSessions = previous;
    globalThis.__piSubagentRuns = previousSubagents;
  }
});

test("archive and restore preserve the session file and refresh the catalogue", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-archive-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  let id;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (id) invalidateSessionPathCache(id);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: "Archive fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: Date.now() });
  id = manager.getSessionId();
  const path = manager.getSessionFile();
  cacheSessionPath(id, path);
  invalidateSessionListCache();
  const context = { params: Promise.resolve({ id }) };
  const url = `http://localhost/api/sessions/${id}`;
  const patch = (body) => renameSession(new Request(url, { method: "PATCH", body: JSON.stringify(body) }), context);
  const list = async (summary = false) => (await getSessionList(new Request(`http://localhost/api/sessions${summary ? "?summary=1" : ""}`))).json();
  const before = await list();
  assert.equal((await patch({ archived: true })).status, 200);
  const archived = await list();
  assert.match(await readFile(path, "utf8"), /pi-web:archive/);
  assert.ok(archived.sessionListVersion > before.sessionListVersion);
  assert.equal(archived.sessions.find((session) => session.id === id)?.archived, true);
  assert.equal((await list(true)).sessions.find((session) => session.id === id)?.archived, true);
  const projectKey = archived.sessions.find((session) => session.id === id).projectKey;
  const otherDir = join(dir, "other-project");
  await mkdir(otherDir);
  const other = SessionManager.create(otherDir);
  other.appendMessage({ role: "user", content: "Archive fixture", timestamp: Date.now() });
  other.appendMessage({ role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: Date.now() });
  const otherId = other.getSessionId();
  cacheSessionPath(otherId, other.getSessionFile());
  t.after(() => invalidateSessionPathCache(otherId));
  invalidateSessionListCache();
  const otherKey = (await list()).sessions.find((session) => session.id === otherId).projectKey;
  assert.notEqual(projectKey, otherKey);
  const search = async (status = "active", scope = { projectKey }) => {
    const params = new URLSearchParams({ q: "Archive fixture", status, ...scope });
    const response = await searchSessions(new Request(`http://localhost/api/sessions/search?${params}`));
    assert.equal(response.status, 200);
    return (await response.json()).results.map((result) => result.session.id);
  };
  assert.deepEqual(await search(), [], "archived sessions stay excluded from active search");
  assert.deepEqual(await search("archived"), [id]);
  assert.deepEqual(await search("both"), [id]);
  assert.deepEqual(await search("active", { projectKey: otherKey }), [otherId]);
  assert.deepEqual(await search("active", { scope: "all" }), [otherId]);
  assert.deepEqual(new Set(await search("both", { scope: "all" })), new Set([id, otherId]));
  assert.deepEqual(await search("both", { projectKey, field: "title" }), [], "previews and bodies are not titles");
  assert.equal((await patch({ name: "Archive fixture title" })).status, 200);
  assert.deepEqual(await search("active", { projectKey, field: "title" }), [], "title mode preserves archive scope");
  assert.deepEqual(await search("archived", { projectKey, field: "title" }), [id]);
  assert.deepEqual(await search("both", { scope: "all", field: "title" }), [id]);
  assert.deepEqual(new Set(await search("both", { scope: "all", field: "all" })), new Set([id, otherId]));
  for (const invalid of [new URLSearchParams({ q: "Archive fixture", status: "active" }),
    new URLSearchParams({ q: "Archive fixture", scope: "all", status: "unknown" }),
    new URLSearchParams({ q: "Archive fixture", scope: "all", status: "active", field: "body" }),
    new URLSearchParams({ q: "Archive fixture", scope: "all", status: "active", field: "" }),
    new URLSearchParams({ q: "Archive fixture", projectKey, status: "active", includeArchived: "1" })]) {
    assert.equal((await searchSessions(new Request(`http://localhost/api/sessions/search?${invalid}`))).status, 400);
  }
  assert.deepEqual(await search("active", { projectKey: "unknown" }), []);
  assert.match(await readFile(path, "utf8"), /pi-web:archive/);
  assert.equal((await patch({ archived: false })).status, 200);
  assert.deepEqual(await search(), [id], "restored sessions return to active search");
  assert.equal((await list()).sessions.find((session) => session.id === id)?.archived, undefined);
  assert.equal((await patch({ archived: "yes" })).status, 400);
  assert.equal((await patch({ name: "x", archived: true })).status, 400);
  const transient = SessionManager.create(dir);
  cacheSessionPath(transient.getSessionId(), transient.getSessionFile());
  assert.equal((await renameSession(
    new Request(`http://localhost/api/sessions/${transient.getSessionId()}`, { method: "PATCH", body: JSON.stringify({ archived: true }) }),
    { params: Promise.resolve({ id: transient.getSessionId() }) },
  )).status, 409);
  invalidateSessionPathCache(transient.getSessionId());
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[id, { isRunning: () => true }]]);
  try {
    assert.equal((await patch({ archived: true })).status, 409);
    assert.match(await readFile(path, "utf8"), /"archived":false/);
  } finally {
    globalThis.__piSessions = previousRegistry;
  }
});

test("session listing returns a gzip-compressed response when the client accepts it", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-list-gzip-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });

  const firstMessage = "compressible session content ".repeat(500);
  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: firstMessage, timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  invalidateSessionListCache();

  const response = await getSessionList(new Request("http://localhost/api/sessions", {
    headers: { "Accept-Encoding": "gzip" },
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.match(response.headers.get("Vary") ?? "", /(?:^|,\s*)Accept-Encoding(?:\s*,|$)/i);
  const payload = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"));
  assert.equal(payload.sessions[0].firstMessage, firstMessage);
});

test("deleting an unpersisted session shuts down its runtime and invalidates caches", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-empty-"));
  const previousRegistry = globalThis.__piSessions;
  const ids = [];
  globalThis.__piSessions = new Map();
  t.after(async () => {
    globalThis.__piSessions = previousRegistry;
    for (const id of ids) invalidateSessionPathCache(id);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });

  for (const persistOnShutdown of [false, true]) {
    const manager = SessionManager.create(dir, dir);
    const id = manager.getSessionId();
    const filePath = manager.getSessionFile();
    ids.push(id);
    await assert.rejects(readFile(filePath), { code: "ENOENT" });
    cacheSessionPath(id, filePath);
    let shutdownCalled = false;
    globalThis.__piSessions.set(id, {
      isRunning: () => false,
      shutdown: async () => {
        shutdownCalled = true;
        if (persistOnShutdown) await writeFile(filePath, JSON.stringify(manager.getHeader()));
        globalThis.__piSessions.delete(id);
      },
    });
    const before = (await (await getRunningSessions()).json()).sessionListVersion;
    const response = await deleteSession(
      new Request(`http://localhost/api/sessions/${id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id }) },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(shutdownCalled, true);
    assert.equal(globalThis.__piSessions.has(id), false);
    assert.equal(globalThis.__piSessionPathCache.has(id), false);
    assert.equal([...globalThis.__piPathToSessionIdCache.values()].includes(id), false);
    assert.ok((await (await getRunningSessions()).json()).sessionListVersion > before);
    await assert.rejects(readFile(filePath), { code: "ENOENT" });
  }
});

test("session listing supports cheap summaries and honors force refresh", () => {
  assert.match(listRoute, /searchParams\.get\("summary"\) === "1"/);
  assert.match(listRoute, /summary\s*\n?\s*\? listSessionSummaries\(\)/);
  assert.match(listRoute, /searchParams\.get\("force"\) === "1"/);
  assert.match(listRoute, /listAllSessions\(\{ force \}\)/);
  assert.match(listRoute, /attachSessionProjectInfo\(getRpcSessionInfos\(\)\)/);
  assert.match(listRoute, /mergeSessionLists\(persistedSessions, runtimeSessions\)/);
  assert.match(listRoute, /"Cache-Control": "no-store"/);
});

test("session reads use the live SessionManager before requiring a JSONL path", () => {
  for (const source of [detailRoute, contextRoute]) {
    const liveLookup = source.indexOf("getRpcSession(id)");
    const pathLookup = source.indexOf("resolveSessionPath(id)");
    assert.ok(liveLookup >= 0);
    assert.ok(pathLookup > liveLookup);
    // openSessionManager is the cached read-only opener; the live wrapper's
    // manager must still win over any disk read, cached or not.
    assert.match(source, /liveRpc\?\.inner\.sessionManager \?\? openSessionManager\(/);
  }
});

test("detail reads probe disk only on force/mount and evict a stale idle wrapper", () => {
  assert.match(detailRoute, /searchParams\.get\("force"\) === "1"/);
  assert.match(detailRoute, /force && liveWrapper\?\.evictIfDiskAhead\(\)/);
  // Anchored reconnect may recover a restore marker missed by idle startup;
  // ordinary context reads and known sibling anchors retain the live snapshot.
  assert.match(contextRoute, /ancestorId && liveRpc && !sm\.getEntry\(ancestorId\) && liveRpc\.evictIfDiskAhead\(\)/);
  assert.doesNotMatch(contextRoute, /readLatestSessionEntryId/);
});

test("live agent state is available before the session file is persisted", () => {
  const liveLookup = stateRoute.indexOf("getRpcSession(id)");
  const pathLookup = stateRoute.indexOf("resolveSessionPath(id)");
  assert.ok(liveLookup >= 0);
  assert.ok(pathLookup > liveLookup);
  assert.match(stateRoute, /if \(rpc\?\.isAlive\(\)\)/);
});

test("deleting a session removes all persisted subagent descendants", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-reparent-"));
  const grandparentPath = join(dir, "grandparent.jsonl");
  const parentPath = join(dir, "parent.jsonl");
  const childPath = join(dir, "child.jsonl");
  const grandchildPath = join(dir, "grandchild.jsonl");
  const parentId = "delete-reparent-parent";
  const childId = "delete-reparent-child";
  const grandchildId = "delete-reparent-grandchild";
  const header = (id, parentSession) => JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    ...(parentSession ? { parentSession } : {}),
  });
  await writeFile(grandparentPath, `${header("delete-reparent-grandparent")}\n`);
  await writeFile(parentPath, `${header(parentId, grandparentPath)}\n`);
  await writeFile(childPath, [
    header(childId, parentPath),
    JSON.stringify({
      type: "custom",
      customType: "pi-web:subagent",
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: parentId,
        parentSessionPath: parentPath,
        profile: "Explore",
        description: "Inspect parser",
      },
    }),
    "",
  ].join("\n"));
  await writeFile(grandchildPath, [
    header(grandchildId, childPath),
    JSON.stringify({
      type: "custom",
      customType: "pi-web:subagent",
      id: "grandchild-meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: childId,
        parentSessionPath: childPath,
        profile: "Review",
        description: "Review parser",
      },
    }),
    "",
  ].join("\n"));
  cacheSessionPath(parentId, parentPath);
  t.after(async () => {
    invalidateSessionPathCache(parentId);
    await rm(dir, { recursive: true, force: true });
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${parentId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: parentId }) },
  );

  assert.equal(response.status, 200);
  await assert.rejects(readFile(parentPath), { code: "ENOENT" });
  await assert.rejects(readFile(childPath), { code: "ENOENT" });
  await assert.rejects(readFile(grandchildPath), { code: "ENOENT" });
});

test("live detail and state routes work without a persisted JSONL file", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "live-route-test";
  const timestamp = "2026-08-12T01:02:03.000Z";
  const entry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp,
    message: { role: "user", content: "hello live" },
  };
  const sessionManager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp", timestamp }),
    getEntries: () => [entry],
    getLeafId: () => entry.id,
    getTree: () => [],
    getSessionName: () => undefined,
    getSessionFile: () => `/tmp/pi-web-live-route-not-persisted-${process.pid}.jsonl`,
  };
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => true,
    inner: { sessionManager },
    sessionFile: sessionManager.getSessionFile(),
    sessionId: id,
    cwd: "/tmp",
    send: async () => ({ isStreaming: true }),
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const routeContext = { params: Promise.resolve({ id }) };
  const detailResponse = await getSessionDetail(
    new Request(`http://localhost/api/sessions/${id}`),
    routeContext,
  );
  const stateResponse = await getSessionState(
    new Request(`http://localhost/api/sessions/${id}/state`),
    routeContext,
  );
  const detail = await detailResponse.json();

  assert.equal(detailResponse.status, 200);
  assert.equal(detail.info.transient, true);
  assert.equal(detail.info.projectRoot, "/tmp");
  assert.equal(typeof detail.info.projectKey, "string");
  assert.deepEqual(detail.context.messages.map((message) => message.content), ["hello live"]);
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), {
    running: true,
    state: { isStreaming: true },
  });
});

test("session detail returns a gzip-compressed response when the client accepts it", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "live-route-gzip-test";
  const timestamp = "2026-09-05T00:00:00.000Z";
  const firstMessage = "large session detail content ".repeat(500);
  const entry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp,
    message: { role: "user", content: firstMessage },
  };
  const sessionManager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp", timestamp }),
    getEntries: () => [entry],
    getLeafId: () => entry.id,
    getTree: () => [],
    getSessionName: () => undefined,
    getSessionFile: () => `/tmp/pi-web-live-route-gzip-${process.pid}.jsonl`,
  };
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => false,
    inner: { sessionManager },
    sessionFile: sessionManager.getSessionFile(),
    sessionId: id,
    cwd: "/tmp",
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await getSessionDetail(
    new Request(`http://localhost/api/sessions/${id}`, {
      headers: { "Accept-Encoding": "gzip" },
    }),
    { params: Promise.resolve({ id }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  const payload = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"));
  assert.equal(payload.info.firstMessage, firstMessage);
});
