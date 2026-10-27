import "./runtime-search-native-observer.fixture.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
  fsCache: false,
});
const { encodeSessionCatalogue, decodeSessionCatalogue } = await jiti.import("../../../lib/session-catalogue-wire.ts");
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
import { createNativeRouteOwner } from "./runtime-native-owner.fixture.mjs";
const { flushSessionScanIndexForTests } = await jiti.import("../../../lib/session-list-scanner.ts");
const nativeRouteCapabilities = { deleteSession, getSessionDetail, renameSession, getSessionList, searchSessions, getRunningSessions, getSessionState, dismissRecovery, listInterrupted };

test("list versions expose idle session creation, rename and deletion to other windows", async (t) => {
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-list-sync-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  let sessionId;
  native.final(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (sessionId) invalidateSessionPathCache(sessionId);
    invalidateSessionListCache();
  });
  const list = async () => {
    const response = await native.routes.getSessionList(new Request("http://localhost/api/sessions"));
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
  const renamed = await native.routes.renameSession(new Request(url, { method: "PATCH", body: JSON.stringify({ name: "Renamed elsewhere" }) }), context);
  assert.equal(renamed.status, 200);
  const poll = await (await native.routes.getRunningSessions()).json();
  assert.deepEqual(poll.runningSessionIds, []);
  assert.deepEqual(poll.attention, [], "on-disk sessions are not assumed to need input");
  assert.ok(poll.sessionListVersion > created.sessionListVersion);
  const updated = await list();
  assert.equal(updated.sessionListVersion, poll.sessionListVersion);
  assert.equal(updated.sessions[0].name, "Renamed elsewhere");
  assert.equal((await list()).sessionListVersion, poll.sessionListVersion, "reads must not create a refresh loop");

  assert.equal((await native.routes.deleteSession(new Request(url, { method: "DELETE" }), context)).status, 200);
  const deleted = await list();
  assert.ok(deleted.sessionListVersion > updated.sessionListVersion);
  assert.deepEqual(deleted.sessions, []);
  assert.equal((await (await native.routes.getRunningSessions()).json()).sessionListVersion, deleted.sessionListVersion);
});

test("session detail reports a possible interrupted run without reopening it; dismissal and deletion persist", async (t) => {
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-restart-recovery-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let id;
  native.final(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (id) invalidateSessionPathCache(id);
    invalidateSessionListCache();
  });
  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: "Saved prompt", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Saved response" }], timestamp: Date.now() });
  id = manager.getSessionId();
  cacheSessionPath(id, manager.getSessionFile());
  const runId = recordRunStart(id);
  const root = join(dir, "pi-web", "run-journal", "v1");
  const startFile = join(root, id, `${runId}.start.json`);
  assert.deepEqual((await (await native.routes.listInterrupted()).json()).interruptedSessionIds, [], "live owner must not appear in Activity");
  const start = JSON.parse(await readFile(startFile, "utf8"));
  await writeFile(startFile, JSON.stringify({ ...start, ownerPid: 99999999 }));
  const context = { params: Promise.resolve({ id }) };
  const url = `http://localhost/api/sessions/${id}`;
  const detail = await native.routes.getSessionDetail(new Request(`${url}?force=1`), context);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).possibleInterruptedRun.runId, runId);
  assert.deepEqual((await (await native.routes.listInterrupted()).json()).interruptedSessionIds, [id]);
  const wrongRun = await native.routes.dismissRecovery(new Request(`${url}/recovery`, { method: "POST", body: JSON.stringify({ runId: "wrong" }) }), context);
  assert.equal(wrongRun.status, 409);
  const secondRun = recordRunStart(id);
  const secondStartFile = join(root, id, `${secondRun}.start.json`);
  const secondStart = JSON.parse(await readFile(secondStartFile, "utf8"));
  await writeFile(secondStartFile, JSON.stringify({ ...secondStart, ownerPid: 99999999,
    startedAt: new Date(Date.parse(start.startedAt) - 60_000).toISOString() }));
  const dismiss = await native.routes.dismissRecovery(new Request(`${url}/recovery`, { method: "POST", body: JSON.stringify({ runId }) }), context);
  assert.equal(dismiss.status, 200);
  assert.equal((await dismiss.json()).possibleInterruptedRun.runId, secondRun);
  const dismissSecond = await native.routes.dismissRecovery(new Request(`${url}/recovery`, { method: "POST", body: JSON.stringify({ runId: secondRun }) }), context);
  assert.equal(dismissSecond.status, 200);
  assert.equal((await dismissSecond.json()).possibleInterruptedRun, null);
  assert.deepEqual((await (await native.routes.listInterrupted()).json()).interruptedSessionIds, []);
  assert.equal((await (await native.routes.getSessionDetail(new Request(url), context)).json()).possibleInterruptedRun, null);
  assert.equal((await native.routes.deleteSession(new Request(url, { method: "DELETE" }), context)).status, 200);
  assert.equal(readPossibleInterruptedRun(id, root, () => false), null);
});

test("running snapshot exposes only live wrapper attention without opening sessions", async (t) => {
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-activity-snapshot-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  native.final(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const previous = globalThis.__piSessions;
  const previousSubagents = globalThis.__piSubagentRuns;
  recordActivityCompletion("finished", activityReviewPath(dir), 42);
  globalThis.__piSubagentRuns = new Map([["queued", { run: { status: "queued" } }]]);
  const waiting = { sessionId: "waiting", isRunning: () => true, hasSuppressedCompletionNotifications: () => false,
    getPendingAttention: () => ({ sessionId: "waiting", method: "ask_user", summary: "Choose?", since: 42 }) };
  globalThis.__piSessions = new Map([["waiting", waiting]]);
  try {
    const snapshot = await (await native.routes.getRunningSessions()).json();
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
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-archive-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  let id;
  native.final(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (id) invalidateSessionPathCache(id);
    invalidateSessionListCache();
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
  const patch = (body) => native.routes.renameSession(new Request(url, { method: "PATCH", body: JSON.stringify(body) }), context);
  const list = async (summary = false) => (await native.routes.getSessionList(new Request(`http://localhost/api/sessions${summary ? "?summary=1" : ""}`))).json();
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
  native.final(() => invalidateSessionPathCache(otherId));
  invalidateSessionListCache();
  const otherKey = (await list()).sessions.find((session) => session.id === otherId).projectKey;
  assert.notEqual(projectKey, otherKey);
  const search = async (status = "active", scope = { projectKey }) => {
    const params = new URLSearchParams({ q: "Archive fixture", status, ...scope });
    const response = await native.routes.searchSessions(new Request(`http://localhost/api/sessions/search?${params}`));
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
    assert.equal((await native.routes.searchSessions(new Request(`http://localhost/api/sessions/search?${invalid}`))).status, 400);
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
  assert.equal((await native.routes.renameSession(
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
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-list-gzip-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  invalidateSessionListCache();
  native.final(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    invalidateSessionListCache();
  });

  const firstMessage = "compressible session content ".repeat(500);
  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: firstMessage, timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const sibling = SessionManager.create(dir);
  sibling.appendMessage({ role: "user", content: firstMessage, timestamp: Date.now() });
  sibling.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  invalidateSessionListCache();

  const response = await native.routes.getSessionList(new Request("http://localhost/api/sessions", {
    headers: { "Accept-Encoding": "gzip" },
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.match(response.headers.get("Vary") ?? "", /(?:^|,\s*)Accept-Encoding(?:\s*,|$)/i);
  const payload = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"));
  assert.equal(payload.sessions.length, 2);
  assert.equal(payload.sessions[0].firstMessage, firstMessage);
  for (const query of ["compact=1", "summary=1&compact=1", "force=1&compact=1"]) for (const encoding of ["identity", "gzip"]) {
    const compact = await native.routes.getSessionList(new Request(`http://localhost/api/sessions?${query}`, {
      headers: { "Accept-Encoding": encoding },
    }));
    const raw = Buffer.from(await compact.arrayBuffer());
    const encoded = JSON.parse((encoding === "gzip" ? gunzipSync(raw) : raw).toString("utf8"));
    assert.equal(compact.status, 200);
    assert.equal(compact.headers.get("Content-Encoding"), encoding === "gzip" ? "gzip" : null);
    assert.equal(encoded.sessions.format, 1, "compact route shares repeated text instead of resending full rows");
    assert.equal(encoded.sessions.rows.length, 2);
    assert.deepEqual(decodeSessionCatalogue(encoded.sessions), payload.sessions, 'native compact summary/force metadata remains exact');
    assert.equal(encoded.sessions.strings[encoded.sessions.rows[0].firstMessage], firstMessage);
    assert.ok(Buffer.byteLength(JSON.stringify(encoded.sessions)) < Buffer.byteLength(JSON.stringify(payload.sessions)) * 0.6,
      "actual compact route JSON removes the duplicate large prompt");
  }
});

test("deleting an unpersisted session shuts down its runtime and invalidates caches", async (t) => {
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-empty-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
  const previousRegistry = globalThis.__piSessions;
  const ids = [];
  globalThis.__piSessions = new Map();
  native.final(async () => {
    globalThis.__piSessions = previousRegistry;
    for (const id of ids) invalidateSessionPathCache(id);
    invalidateSessionListCache();
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
    const before = (await (await native.routes.getRunningSessions()).json()).sessionListVersion;
    const response = await native.routes.deleteSession(
      new Request(`http://localhost/api/sessions/${id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id }) },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(shutdownCalled, true);
    assert.equal(globalThis.__piSessions.has(id), false);
    assert.equal(globalThis.__piSessionPathCache.has(id), false);
    assert.equal([...globalThis.__piPathToSessionIdCache.values()].includes(id), false);
    assert.ok((await (await native.routes.getRunningSessions()).json()).sessionListVersion > before);
    await assert.rejects(readFile(filePath), { code: "ENOENT" });
  }
});

test("deleting a session removes all persisted subagent descendants", async (t) => {
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-reparent-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
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
  native.final(async () => {
    invalidateSessionPathCache(parentId);
  });

  const response = await native.routes.deleteSession(
    new Request(`http://localhost/api/sessions/${parentId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: parentId }) },
  );

  assert.equal(response.status, 200);
  await assert.rejects(readFile(parentPath), { code: "ENOENT" });
  await assert.rejects(readFile(childPath), { code: "ENOENT" });
  await assert.rejects(readFile(grandchildPath), { code: "ENOENT" });
});

test("live detail and state routes work without a persisted JSONL file", async (t) => {
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
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
  native.final(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const routeContext = { params: Promise.resolve({ id }) };
  const detailResponse = await native.routes.getSessionDetail(
    new Request(`http://localhost/api/sessions/${id}`),
    routeContext,
  );
  const stateResponse = await native.routes.getSessionState(
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
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
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
  native.final(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await native.routes.getSessionDetail(
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


import { loadBackend, next, backendCase } from "../../../lib/backend-ownership.fixture.mjs";
import { contextHandler } from "./context-handler.fixture.mjs";
const { mergeSessionLists } = await jiti.import("../../../lib/session-reader.ts");

test("list GET selects summary or forced scan, joins runtime projection, and is never cacheable", async t => {
  const owner = backendCase(t);
  for (const query of ["", "?force=1", "?summary=1", "?summary=1&force=1", "?summary=true&force=true", "?compact=1", "?force=1&compact=1", "?summary=1&compact=1", "?compact=true"]) {
    const calls = [], persisted = [{ id: "saved", path: "/fixture/saved.jsonl", cwd: "/fixture",
      created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z",
      messageCount: 1, firstMessage: "Saved fixture", transient: false }];
    const runtime = [{ id: "transient", path: "", cwd: "/fixture",
      created: "2026-01-02T00:00:00.000Z", modified: "2026-01-02T00:00:00.000Z",
      messageCount: 1, firstMessage: "Runtime fixture", transient: true }];
    const { GET } = await loadBackend(new URL("./route.ts", import.meta.url), {
      "next/server": next, "@/lib/perf": { startServerPerf: () => undefined },
      "@/lib/session-catalogue-wire": { encodeSessionCatalogue },
      "@/lib/json-response": { jsonResponse: (_req, data, init) => Response.json(data, init) },
      "@/lib/rpc-manager": { getRpcSessionInfos: () => runtime, getRunningRpcSessionIds: () => ["transient"], getCompletionNotificationSuppressedRpcSessionIds: () => ["transient"] },
      "@/lib/session-reader": {
        listSessionSummaries: async () => { calls.push(["summary"]); return persisted; },
        listAllSessions: async options => { calls.push(["full", options]); return persisted; },
        getSessionListVersion: () => 42,
        attachSessionProjectInfo: async infos => { assert.equal(infos, runtime); calls.push(["projects"]); return infos; },
        mergeSessionLists,
      },
    });
    const response = await owner.response(GET(new Request(`http://localhost/api/sessions${query}`)));
    const body = await response.json();
    assert.equal(response.status, 200, `list query ${query || "(default)"}: ${JSON.stringify(body).slice(0, 2000)}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body.sessions.map(s => s.id).sort(), ["saved", "transient"]);
    assert.deepEqual(body.sessions.map(s => s.id), ["transient", "saved"], "real merge orders complete metadata by modification time");
    assert.equal(body.sessionListVersion, 42); assert.deepEqual(body.runningSessionIds, ["transient"]);
    assert.deepEqual(body.completionNotificationSuppressedSessionIds, ["transient"]);
    assert.deepEqual(calls[0], query.includes("summary=1") ? ["summary"] : ["full", { force: query.includes("force=1") }]);
    assert.deepEqual(calls[1], ["projects"]);
  }
});

test("detail GET uses live manager before path, probes only force, and opens after idle eviction", async t => {
  const owner = backendCase(t);
  for (const [force, evict] of [[false, false], [true, false], [true, true]]) {
    const calls = [];
    const manager = { getHeader: () => ({ id: "session", cwd: "/fixture", timestamp: "2026-01-01T00:00:00Z" }),
      getEntries: () => [], getLeafId: () => null, getTree: () => [], getSessionName: () => undefined, getSessionFile: () => "/fixture/session.jsonl" };
    const wrapper = { sessionFile: "/fixture/session.jsonl", inner: { sessionManager: manager, sessionId: "session" }, isAlive: () => true,
      evictIfDiskAhead: () => { calls.push("evict"); return evict; } };
    const { GET } = await loadBackend(new URL("./[id]/route.ts", import.meta.url), {
      "next/server": next, "fs": { existsSync: () => false, statSync: () => { throw new Error("not persisted"); } },
      "@/lib/perf": { startServerPerf: () => undefined },
      "@/lib/rpc-manager": { getRpcSession: () => { calls.push("live"); return wrapper; } },
      "@/lib/session-reader": {
        resolveSessionPath: async () => { calls.push("path"); return "/fixture/session.jsonl"; },
        openSessionManager: () => { calls.push("open"); return manager; },
        buildSessionContext: () => ({ messages: [], entryIds: [] }),
        attachSessionProjectInfo: async infos => infos,
      },
      "@/lib/session-run-recovery": { readPossibleInterruptedRun: () => null },
      "@/lib/session-revision": { computeSessionRevision: () => null },
    }, { actual: true });
    const response = await owner.response(GET(new Request(`http://localhost/api/sessions/session${force ? "?force=1" : ""}`), { params: Promise.resolve({ id: "session" }) }));
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(Boolean(body.wrapperRebuilt), force && evict);
    assert.deepEqual(calls, !force ? ["live"] : evict ? ["live", "evict", "path", "open"] : ["live", "evict"]);
  }
  // Context's independent missing-anchor/sibling/disk rules exercise its full GET.
  const context = await contextHandler(t); assert.equal((await context.get("")).status, 200);
  assert.equal(context.calls.some(([name]) => name === "path" || name === "open"), false);
});

test("state GET alive path wins even without disk; dead, missing and command failure stay distinct", async t => {
  const owner = backendCase(t);
  for (const mode of ["alive", "dead", "missing", "error"]) {
    const calls = [];
    const { GET } = await loadBackend(new URL("./[id]/state/route.ts", import.meta.url), {
      "next/server": next,
      "@/lib/rpc-manager": { getRpcSession: () => { calls.push("live"); return { isAlive: () => mode === "alive" || mode === "error", send: async command => {
        assert.deepEqual(command, { type: "get_state" }); if (mode === "error") throw new Error("state failed"); return { isStreaming: true };
      } }; } },
      "@/lib/session-reader": { resolveSessionPath: async () => { calls.push("path"); return mode === "missing" ? null : "/fixture/session.jsonl"; } },
    });
    const response = await owner.response(GET(new Request("http://localhost/api/sessions/session/state"), { params: Promise.resolve({ id: "session" }) }));
    const body = await response.json(); assert.equal(response.status, mode === "error" ? 500 : mode === "missing" ? 404 : 200);
    assert.deepEqual(calls, ["alive", "error"].includes(mode) ? ["live"] : ["live", "path"]);
    if (mode === "alive") assert.deepEqual(body, { running: true, state: { isStreaming: true } });
    if (mode === "dead") assert.deepEqual(body, { running: false });
  }
});


test("native catalogue scope joins real scans and commits its named index writer before root removal", async t => {
  const native = createNativeRouteOwner(t, nativeRouteCapabilities, flushSessionScanIndexForTests);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-native-catalogue-close-"));
  native.root(dir);
  native.remove(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  native.final(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; invalidateSessionListCache(); });
  invalidateSessionListCache();
  const manager = SessionManager.create(dir);
  manager.appendMessage({ role: "user", content: "Owned catalogue", timestamp: Date.now() });
  const response = await native.routes.getSessionList(new Request("http://localhost/api/sessions?force=1"));
  assert.equal(response.status, 200); await response.json();
  await native.close();
  assert.equal(globalThis.__piWebScanIndexSave, undefined, "specific writer committed and timer removed");
  await assert.rejects(stat(dir), { code: "ENOENT" });
});

test("native route owner releases and joins a held peer despite another handler failing", async () => {
  // Ownership-helper probe only; the preceding native case uses real handlers,
  // SDK files and scanner persistence. No synthetic response grants authority.
  const { deferred } = await import("../../../lib/backend-ownership.fixture.mjs");
  const entered = deferred(), release = deferred(), hooks = [], events = [];
  const failure = new Error("controlled handler failure");
  const native = createNativeRouteOwner({ after: fn => hooks.push(fn) }, {
    held: async () => { entered.resolve(); await release.promise; events.push("peer complete"); return Response.json({ ok: true }); },
    failed: async () => { throw failure; },
  }, () => { throw new Error("no scanner writer was admitted in this helper probe"); });
  native.release(() => release.resolve()); native.final(() => events.push("restore"));
  native.remove(() => events.push("remove must remain withheld after failure"));
  const peer = native.body(native.routes.held().then(response => response.json())); await entered.promise;
  await assert.rejects(native.routes.failed(), error => error === failure);
  await assert.rejects(native.close(), error => error instanceof AggregateError && error.errors.includes(failure));
  assert.deepEqual(events, ["peer complete", "restore"]); assert.deepEqual(await peer, { ok: true });
  assert.equal(hooks.length, 1);
});
