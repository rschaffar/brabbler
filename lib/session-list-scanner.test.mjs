import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, mock } from "node:test";
import { createJiti } from "jiti";

// Jiti can retain a builtin namespace on first use. Install one file-lifetime
// dispatch before importing production; individual cases only change its target.
// Every unobserved call delegates to the real native implementation.
let activeRelationIO = null;
const native = Object.fromEntries(["openSync", "closeSync", "readSync", "statSync", "fstatSync"].map((key) => [key, fs[key]]));
const nativeAsyncStat = fs.promises.stat;
mock.method(fs, "openSync", (path, ...args) => {
  const fd = native.openSync(path, ...args), io = activeRelationIO;
  if (io?.watched.has(String(path))) {
    io.descriptors.set(fd, String(path)); io.counts.opens++;
    try { io.afterOpen?.(String(path), fd); }
    catch (error) { native.closeSync(fd); io.descriptors.delete(fd); throw error; }
  }
  return fd;
});
mock.method(fs, "closeSync", (fd) => {
  try { return native.closeSync(fd); } finally { activeRelationIO?.descriptors.delete(fd); }
});
mock.method(fs, "readSync", (fd, ...args) => {
  const io = activeRelationIO, path = io?.descriptors.get(fd);
  if (path) { io.counts.reads++; io.beforeRead?.(path, fd); }
  const read = native.readSync(fd, ...args);
  if (path) io.afterRead?.(path, fd);
  return read;
});
mock.method(fs, "statSync", (path, ...args) => {
  const io = activeRelationIO;
  if (io?.watched.has(String(path))) { io.counts.stats++; io.pathnameStat?.(String(path)); }
  return native.statSync(path, ...args);
});
mock.method(fs, "fstatSync", (fd, ...args) => {
  const stats = native.fstatSync(fd, ...args), io = activeRelationIO, path = io?.descriptors.get(fd);
  if (path) { io.counts.descriptorStats++; return io.descriptorStat?.(path, stats) ?? stats; }
  return stats;
});
mock.method(fs.promises, "stat", (path, ...args) => {
  const fault = activeRelationIO?.asyncStat?.(String(path));
  return fault ? Promise.reject(fault) : nativeAsyncStat(path, ...args);
});
syncBuiltinESMExports();
after(() => { mock.restoreAll(); syncBuiltinESMExports(); });

const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { listSessionsIncremental, resetSessionScanIndexForTests, flushSessionScanIndexForTests, getValidatedSessionScanFingerprint } = await jiti.import("./session-list-scanner.ts");
const { listAllSessions, listSessionSummaries, invalidateSessionListCache } = await jiti.import("./session-reader.ts");
const timestamp = "2026-01-01T00:00:00.000Z";
const line = (entry) => JSON.stringify(entry) + "\n";
const message = (id, role, content, time = timestamp) => ({
  type: "message", id, parentId: null, timestamp: time, message: { role, content },
});

function fixture(t) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "brabbler-scanner-"));
  const dir = join(root, "sessions", "project");
  fs.mkdirSync(dir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = root;
  resetSessionScanIndexForTests();
  invalidateSessionListCache();
  t.after(() => {
    resetSessionScanIndexForTests();
    invalidateSessionListCache();
    globalThis.__piSessionPathCache = undefined;
    globalThis.__piPathToSessionIdCache = undefined;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    assert.equal(activeRelationIO?.descriptors.size ?? 0, 0, "retain fixture if owned descriptor closure is uncertain");
    fs.rmSync(root, { recursive: true, force: true });
  });
  function write(id, entries = [], extraHeader = {}) {
    const path = join(dir, `${id}.jsonl`);
    fs.writeFileSync(path, line({ type: "session", version: 3, id, cwd: root, timestamp, ...extraHeader }) + entries.map(line).join(""));
    return path;
  }
  return { root, dir, write, indexPath: join(root, "brabbler-session-index.json") };
}

async function sdkMetadata() {
  return (await SessionManager.listAll()).map((session) => {
    const info = { ...session };
    delete info.allMessagesText;
    return info;
  });
}

test("matches SDK metadata and tie ordering across cache hits, mutations, and restarts", async (t) => {
  const { write, indexPath } = fixture(t);
  const a = write("a", [
    message("a1", "user", [{ type: "image", data: "ignored", mimeType: "image/png" }, { type: "text", text: "first" }, { type: "text", text: "request" }]),
    message("a2", "assistant", [{ type: "text", text: "answer" }]),
    message("a3", "toolResult", [{ type: "text", text: "output" }], "2026-01-03T00:00:00.000Z"),
    { type: "custom", data: "x".repeat(256 * 1024) },
  ]);
  const b = write("b", [message("b1", "user", "forked request")], { parentSession: a });
  const c = write("c");
  const opened = [];
  const createReadStream = fs.createReadStream;
  t.mock.method(fs, "createReadStream", (path, ...args) => {
    opened.push(path);
    return createReadStream(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  async function check(label, expectedReads) {
    const expected = await sdkMetadata();
    opened.length = 0;
    assert.deepEqual(await listSessionsIncremental(), expected, label);
    flushSessionScanIndexForTests();
    assert.deepEqual([...opened].sort(), [...expectedReads].sort(), `${label}: scanned files`);
  }

  await check("cold", [a, b, c]);
  await check("warm", []);
  if (process.platform !== "win32") assert.equal(fs.statSync(indexPath).mode & 0o777, 0o600);
  resetSessionScanIndexForTests();
  await check("persisted cache", []);

  fs.appendFileSync(a, line({ type: "session_info", name: "  Renamed  " }));
  await check("rename preserves equal-time order", [a]);
  fs.appendFileSync(a, line({ type: "session_info", name: " " }));
  await check("explicit name clear", [a]);
  fs.appendFileSync(b, line(message("b2", "assistant", "new activity", "2026-01-02T00:00:00.000Z")));
  await check("append", [b]);
  write("a", [message("replacement", "user", "rewritten")]);
  await check("whole-file rewrite", [a]);
  const d = write("d", [message("d1", "user", "new session")]);
  fs.rmSync(c);
  await check("create and delete", [d]);

  resetSessionScanIndexForTests();
  fs.appendFileSync(a, line({ type: "session_info", name: "changed while stopped" }));
  fs.rmSync(b);
  await check("restart revalidates changed and deleted files", [a]);
  const persisted = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.deepEqual(Object.keys(persisted.entries).sort(), [a, d].sort());
});

test("archive markers survive summary scans, cache reloads and restoration", async (t) => {
  const { write } = fixture(t);
  const path = write("archive", [
    message("a1", "user", "Keep this transcript"),
    { type: "custom", customType: "brabbler:archive", data: { version: 1, archived: true } },
    { type: "custom", customType: "brabbler:archive", data: { version: 2, archived: false } },
  ]);
  assert.equal((await listSessionsIncremental({ deferDetails: true }))[0].archived, true);
  assert.equal((await listSessionsIncremental())[0].archived, true);
  flushSessionScanIndexForTests();
  resetSessionScanIndexForTests();
  assert.equal((await listSessionsIncremental({ deferDetails: true }))[0].archived, true);
  fs.appendFileSync(path, line({ type: "custom", customType: "brabbler:archive", data: { version: 1, archived: false } }));
  assert.equal((await listSessionsIncremental({ deferDetails: true }))[0].archived, false);
  assert.equal((await listSessionsIncremental())[0].archived, undefined);
});

test("discards malformed persisted entries and rebuilds the list from valid session files", async (t) => {
  const { write, indexPath } = fixture(t);
  const a = write("a", [message("a1", "user", "healthy")]);
  write("b", [message("b1", "user", "also healthy")]);
  const expected = await listSessionsIncremental();
  flushSessionScanIndexForTests();
  const pristine = fs.readFileSync(indexPath, "utf8");
  const corruptions = [
    ["missing fingerprint", (entry) => { delete entry.fp; }],
    ["null fingerprint", (entry) => { entry.fp = null; }],
    ["string size", (entry) => { entry.fp.size = String(entry.fp.size); }],
    ["negative size", (entry) => { entry.fp.size = -1; }],
    ["invalid mtime", (entry) => { entry.fp.mtimeMs = null; }],
    ["missing metadata", (entry) => { delete entry.info; }],
    ["mismatched path", (entry) => { entry.info.path = "/elsewhere/session.jsonl"; }],
    ["invalid id", (entry) => { entry.info.id = null; }],
    ["invalid cwd", (entry) => { entry.info.cwd = []; }],
    ["invalid first message", (entry) => { entry.info.firstMessage = 1; }],
    ["invalid name", (entry) => { entry.info.name = {}; }],
    ["invalid parent", (entry) => { entry.info.parentSessionPath = []; }],
    ["invalid count", (entry) => { entry.info.messageCount = -1; }],
    ["invalid created", (entry) => { entry.info.created = "not a date"; }],
    ["invalid modified", (entry) => { entry.info.modified = "not a date"; }],
    ["null date", (entry) => { entry.info.created = null; }],
  ];
  for (const [label, corrupt] of corruptions) {
    const index = JSON.parse(pristine);
    corrupt(index.entries[a]);
    fs.writeFileSync(indexPath, JSON.stringify(index));
    resetSessionScanIndexForTests();
    assert.deepEqual(await listSessionsIncremental(), expected, label);
    flushSessionScanIndexForTests();
    const sessions = await listAllSessions({ force: true });
    assert.deepEqual(sessions.map((s) => s.id), expected.map((s) => s.id), label);
    resetSessionScanIndexForTests();
    assert.deepEqual(await listSessionsIncremental(), expected, `${label}: repaired cache survives restart`);
  }
  for (const source of ["{", "null", '{"version":99,"entries":{}}', '{"version":1,"entries":[]}', '{"version":1,"entries":{"broken":null}}']) {
    fs.writeFileSync(indexPath, source);
    resetSessionScanIndexForTests();
    assert.deepEqual(await listSessionsIncremental(), expected, source);
  }
});

test("retains SDK handling of partial lines, activity timestamps, and empty sessions", async (t) => {
  const { dir, write } = fixture(t);
  const a = write("a", [
    message("a1", "assistant", "not the first user message"),
    message("a2", "user", []),
    { ...message("a3", "user", "user message"), message: { role: "user", content: "user message", timestamp: Date.parse("2026-01-04T00:00:00.000Z") } },
  ]);
  fs.appendFileSync(a, '{"unfinished":');
  const b = write("b");
  fs.writeFileSync(b, "\nnot json\n" + fs.readFileSync(b, "utf8"));
  fs.writeFileSync(join(dir, "invalid.jsonl"), line(message("invalid", "user", "no header")));
  assert.deepEqual(await listSessionsIncremental(), await sdkMetadata());
});

test("defers changed-file details to a later scan", async (t) => {
  const { write } = fixture(t);
  const sessionPath = write("deferred", [
    message("d1", "user", "deferred request"),
    message("d2", "assistant", "deferred answer"),
  ]);

  // A summary listing reads only the header and stat, so the transcript-derived
  // fields stay empty and the row is marked as pending.
  const summary = await listSessionsIncremental({ deferDetails: true });
  assert.equal(summary.length, 1);
  assert.equal(summary[0].path, sessionPath);
  assert.equal(summary[0].detailsPending, true);
  assert.equal(summary[0].messageCount, 0);
  assert.equal(summary[0].firstMessage, "");
  assert.equal(summary[0].id, "deferred");
  assert.equal(summary[0].cwd, process.env.PI_CODING_AGENT_DIR);

  // The normal listing still hydrates the exact details.
  const detailed = await listSessionsIncremental();
  assert.equal(detailed[0].detailsPending, undefined);
  assert.equal(detailed[0].messageCount, 2);
  assert.equal(detailed[0].firstMessage, "deferred request");
});

test("a summary listing does not downgrade an already-scanned file", async (t) => {
  const { write } = fixture(t);
  write("cached", [message("c1", "user", "cached request")]);

  const detailed = await listSessionsIncremental();
  assert.equal(detailed[0].messageCount, 1);

  // The cached entry is complete, so the summary listing serves it as-is. The
  // scan index is persisted across restarts, so this is the common path: a
  // first paint should not blank details it is already holding.
  const summary = await listSessionsIncremental({ deferDetails: true });
  assert.equal(summary[0].detailsPending, undefined);
  assert.equal(summary[0].messageCount, 1);
  assert.equal(summary[0].firstMessage, "cached request");
  assert.equal((await listSessionsIncremental())[0].messageCount, 1);
});

test("a summary listing defers only the files the index has not scanned", async (t) => {
  const { write } = fixture(t);
  write("cached", [message("c1", "user", "cached request")]);
  assert.equal((await listSessionsIncremental())[0].messageCount, 1);

  // A file the index has never seen has no details to reuse, so it is the one
  // row that comes back pending — the point of the summary mode.
  write("fresh", [message("f1", "user", "fresh request")]);
  const summary = await listSessionsIncremental({ deferDetails: true });
  const byId = Object.fromEntries(summary.map((row) => [row.id, row]));
  assert.equal(byId.cached.detailsPending, undefined);
  assert.equal(byId.cached.messageCount, 1);
  assert.equal(byId.fresh.detailsPending, true);
  assert.equal(byId.fresh.messageCount, 0);
});

// Observe only owned JSONL descriptors; scanner async reads/stat and project
// attachment remain real. Restored builtin exports keep other cases independent.
function relationIO(t, paths) {
  assert.equal(activeRelationIO, null, "native observations remain serial");
  const watched = new Set(paths), descriptors = new Map();
  const counts = { opens: 0, reads: 0, stats: 0, descriptorStats: 0 };
  const observer = { watched, descriptors, counts, beforeRead: null, afterRead: null, afterOpen: null, pathnameStat: null, descriptorStat: null, asyncStat: null };
  observer.reset = () => { for (const key of Object.keys(counts)) counts[key] = 0; };
  observer.watchOnly = (paths) => { watched.clear(); for (const path of paths) watched.add(path); observer.reset(); };
  activeRelationIO = observer;
  t.after(() => {
    assert.equal(descriptors.size, 0, "owned relation descriptors closed");
    activeRelationIO = null;
  });
  return observer;
}

const subagentMeta = (parent, data = {}) => ({
  type: "custom", customType: "brabbler:subagent", data: {
    version: 1, parentSessionId: "parent", parentSessionPath: parent,
    profile: "Explore", description: "Inspect parser", ...data,
  },
});
const lifecycle = (status, data = {}) => ({
  type: "custom", customType: ["running", "queued"].includes(status) ? "brabbler:subagent-status" : "brabbler:subagent-result",
  data: { version: 1, status, ...data },
});
const forceCatalogue = async () => Object.fromEntries((await listAllSessions({ force: true })).map((row) => [row.id, row]));

test("unchanged catalogue rebuilds reuse compact relations without content I/O or extra stats", async (t) => {
  const { write, indexPath } = fixture(t);
  const parent = write("parent");
  const child = write("child", [subagentMeta(parent), lifecycle("completed")], { parentSession: parent });
  const fork = write("fork", [message("u", "user", "fork")], { parentSession: parent });
  const invalid = write("invalid", [subagentMeta(parent, { version: 2 })], { parentSession: parent });
  const io = relationIO(t, [child, fork, invalid]);
  t.mock.method(SessionManager, "open", () => { assert.fail("catalogue must not open full SDK managers"); });
  const first = await forceCatalogue();
  assert.ok(io.counts.opens > 0, "observation must see cold relation reads");
  assert.deepEqual(first.child.relation, { kind: "subagent", parentSessionId: "parent", profile: "Explore", description: "Inspect parser", status: "completed" });
  assert.deepEqual(first.fork.relation, { kind: "fork", originSessionId: "parent" });
  assert.equal(first.invalid.relation.kind, "fork");
  io.reset();
  const second = await forceCatalogue();
  assert.deepEqual(second, first);
  assert.deepEqual(io.counts, { opens: 0, reads: 0, stats: 0, descriptorStats: 0 }, "warm reconstruction must reuse unchanged relation metadata");
  first.child.relation.description = "caller mutation";
  assert.equal((await forceCatalogue()).child.relation.description, "Inspect parser");
  flushSessionScanIndexForTests();
  const persisted = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.equal(persisted.version, 2);
  assert.deepEqual(Object.keys(persisted.entries[child]).sort(), ["fp", "info", "resume"]);
  resetSessionScanIndexForTests();
  io.reset();
  assert.equal((await forceCatalogue()).child.relation.status, "completed");
  assert.ok(io.counts.opens > 0, "restart must validate and warm process-only relations");
  io.reset();
  await forceCatalogue();
  assert.equal(io.counts.opens, 0);
});

test("relation reuse invalidates on file changes while parent resolution remains current", async (t) => {
  const { write } = fixture(t), parent = write("parent");
  const child = write("child", [subagentMeta(parent), lifecycle("running")], { parentSession: parent });
  const fork = write("fork", [], { parentSession: parent });
  const io = relationIO(t, [child, fork]);
  assert.equal((await forceCatalogue()).child.relation.status, "running");
  async function changed(expected) {
    io.reset();
    const rows = await forceCatalogue();
    assert.ok(io.counts.opens > 0, "changed child must reread bounded relation metadata");
    for (const [key, value] of Object.entries(expected)) assert.equal(rows.child.relation[key], value);
    io.reset();
    await forceCatalogue();
    assert.equal(io.counts.opens, 0, "new stable fingerprint becomes reusable");
  }
  fs.appendFileSync(child, line(lifecycle("completed")));
  await changed({ status: "completed" });
  const fixed = new Date("2020-01-01T00:00:00.000Z");
  fs.utimesSync(child, fixed, fixed);
  await forceCatalogue();
  const before = fs.statSync(child), original = fs.readFileSync(child, "utf8");
  fs.writeFileSync(child, original.replace("Inspect parser", "Inspect lexer!"));
  fs.utimesSync(child, fixed, fixed);
  const after = fs.statSync(child);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.notEqual(after.ctimeMs, before.ctimeMs, "native rewrite premise includes changed ctime");
  await changed({ description: "Inspect lexer!" });
  write("child", [subagentMeta(parent), lifecycle("queued")], { parentSession: parent });
  assert.ok(fs.statSync(child).size < before.size, "fixture genuinely truncates the file");
  await changed({ status: "queued" });
  const inode = fs.statSync(child).ino;
  const replacement = write("replacement", [subagentMeta(parent), lifecycle("failed")], { id: "child", parentSession: parent });
  fs.renameSync(replacement, child);
  assert.notEqual(fs.statSync(child).ino, inode);
  await changed({ status: "failed" });
  write("parent", [], { id: "new-parent" });
  io.reset();
  let rows = await forceCatalogue();
  assert.equal(rows.child.parentSessionId, "new-parent");
  assert.equal(rows.child.relation.parentSessionId, "parent", "persisted subagent metadata is separate from header parent lookup");
  assert.equal(rows.fork.relation.originSessionId, "new-parent");
  assert.equal(io.counts.opens, 0, "parent changes do not reread unchanged children");
  fs.rmSync(parent);
  rows = await forceCatalogue();
  assert.equal(rows.child.parentSessionId, undefined);
  assert.deepEqual(rows.fork.relation, { kind: "fork" });
  write("parent", [], { id: "restored-parent" });
  assert.equal((await forceCatalogue()).fork.relation.originSessionId, "restored-parent");
  assert.equal(io.counts.opens, 0);
  fs.rmSync(child);
  assert.equal((await forceCatalogue()).child, undefined);
  write("child", [subagentMeta(parent), lifecycle("paused")], { parentSession: parent });
  await changed({ status: "paused" });
});

test("scanner eligibility revokes old complete rows across summaries, stat failure and root changes", async (t) => {
  const { root, write } = fixture(t), parent = write("parent");
  const child = write("child", [subagentMeta(parent), lifecycle("running")], { parentSession: parent });
  const io = relationIO(t, [child]);
  const old = (await listSessionsIncremental()).find((row) => row.id === "child");
  const token = getValidatedSessionScanFingerprint(old);
  assert.equal(Object.isFrozen(token), true);
  await forceCatalogue();
  io.reset();
  await listSessionSummaries();
  assert.equal(getValidatedSessionScanFingerprint(old), token);
  assert.equal(io.counts.opens, 0);
  fs.appendFileSync(child, line(lifecycle("completed")));
  const pending = (await listSessionsIncremental({ deferDetails: true })).find((row) => row.id === "child");
  assert.equal(pending.detailsPending, true);
  assert.equal(getValidatedSessionScanFingerprint(pending), undefined);
  assert.equal(getValidatedSessionScanFingerprint(old), undefined, "retaining the accumulator must not retain eligibility");
  io.reset();
  assert.equal((await listSessionSummaries()).find((row) => row.id === "child").relation.status, "completed");
  assert.ok(io.counts.opens > 0);
  io.reset();
  await listSessionSummaries();
  assert.ok(io.counts.opens > 0, "pending summary projections are not cached as complete");
  assert.equal((await forceCatalogue()).child.relation.status, "completed");
  const current = (await listSessionsIncremental()).find((row) => row.id === "child");
  assert.ok(getValidatedSessionScanFingerprint(current));
  let failStat = true;
  io.asyncStat = (path) => path === child && failStat
    ? Object.assign(new Error("controlled stat denial"), { code: "EACCES" }) : undefined;
  assert.equal((await listSessionsIncremental()).some((row) => row.id === "child"), false);
  assert.equal(getValidatedSessionScanFingerprint(current), undefined);
  failStat = false;
  await forceCatalogue();
  const originalRow = (await listSessionsIncremental()).find((row) => row.id === "child");
  process.env.PI_CODING_AGENT_DIR = join(root, "other-agent");
  assert.equal(getValidatedSessionScanFingerprint(originalRow), undefined);
  await listSessionsIncremental();
  process.env.PI_CODING_AGENT_DIR = root;
  io.reset();
  await forceCatalogue();
  assert.ok(io.counts.opens > 0);
  assert.equal(getValidatedSessionScanFingerprint(originalRow), undefined);
  // A real write after the detailed scan captures its finite descriptor size
  // yields a useful row, but must not issue reusable/persistable evidence.
  fs.appendFileSync(child, line(message("new", "user", "trigger changed scan")));
  const createStream = fs.createReadStream;
  let mutateDuringScan = true;
  t.mock.method(fs, "createReadStream", (path, options) => {
    const stream = createStream(path, options);
    if (path === child && mutateDuringScan) {
      mutateDuringScan = false;
      fs.appendFileSync(child, line(lifecycle("failed")));
    }
    return stream;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const unstable = (await listSessionsIncremental()).find((row) => row.id === "child");
  assert.equal(mutateDuringScan, false, "real detailed scan mutation hook was reached");
  assert.equal(getValidatedSessionScanFingerprint(unstable), undefined);
  io.reset();
  assert.equal((await forceCatalogue()).child.relation.status, "failed");
  assert.ok(io.counts.opens > 0);
});

test("relation read and validation faults recover without caching errors or raced projections", async (t) => {
  const { write } = fixture(t), parent = write("parent");
  const child = write("child", [subagentMeta(parent), lifecycle("completed")], { parentSession: parent });
  const io = relationIO(t, [child]);
  async function recover(label, arrange, expectedKind = "subagent") {
    resetSessionScanIndexForTests();
    let active = true;
    arrange(() => active);
    assert.equal((await forceCatalogue()).child.relation.kind, expectedKind, label);
    active = false;
    io.reset();
    assert.equal((await forceCatalogue()).child.relation.status, "completed", `${label}: next read recovers`);
    assert.ok(io.counts.opens > 0, `${label}: failed validation was not memoized`);
    io.reset();
    await forceCatalogue();
    assert.equal(io.counts.opens, 0, `${label}: recovered result is reusable`);
    io.beforeRead = io.pathnameStat = io.descriptorStat = null;
  }
  await recover("read exception", (active) => {
    io.beforeRead = () => { if (active()) throw new Error("controlled relation read failure"); };
  }, "fork");
  await recover("pathname revalidation exception", (active) => {
    io.pathnameStat = () => { if (active()) throw new Error("controlled pathname validation failure"); };
  });
  for (const ordinal of [1, 4]) {
    await recover(`descriptor validation ${ordinal}`, (active) => {
      let seen = 0;
      io.descriptorStat = (_path, stats) => active() && ++seen === ordinal
        ? Object.assign(Object.create(stats), { mtimeMs: stats.mtimeMs + 1 }) : stats;
    });
  }
  // A real append between prefix and tail cannot certify the earlier fingerprint.
  resetSessionScanIndexForTests();
  let append = true;
  io.afterRead = () => { if (append) { append = false; fs.appendFileSync(child, line(lifecycle("running"))); } };
  await forceCatalogue();
  io.afterRead = null;
  io.reset();
  assert.equal((await forceCatalogue()).child.relation.status, "running");
  assert.ok(io.counts.opens > 0);
  // Swap the pathname while its original descriptor remains open. The response
  // may project the old descriptor, but later listing must observe the new file.
  resetSessionScanIndexForTests();
  const alternate = write("alternate", [subagentMeta(parent), lifecycle("failed")], { id: "child", parentSession: parent });
  let replace = true;
  io.afterOpen = () => { if (replace) { replace = false; fs.renameSync(alternate, child); } };
  await forceCatalogue();
  io.afterOpen = null;
  io.reset();
  assert.equal((await forceCatalogue()).child.relation.status, "failed");
  assert.ok(io.counts.opens > 0);
});

test("relation reuse preserves bounded prefix/tail and malformed lifecycle semantics", async (t) => {
  const { write } = fixture(t), parent = write("parent");
  const io = relationIO(t, []);
  const cases = [
    ["third-line", [message("u", "user", "before metadata"), subagentMeta(parent), lifecycle("completed")], "fork", undefined, 1],
    ["invalid-first", [subagentMeta(parent, { version: 2 }), subagentMeta(parent), lifecycle("completed")], "fork", undefined, 2],
    ["invalid-latest", [subagentMeta(parent), lifecycle("completed"), { type: "custom", customType: "brabbler:subagent-status", data: null }], "subagent", "interrupted", 2],
    ["tail-invisible", [subagentMeta(parent), lifecycle("completed"), message("big", "assistant", "x".repeat(300 * 1024))], "subagent", "interrupted", 3],
    ["prefix-cutoff", [subagentMeta(parent, { pad: "x".repeat(300 * 1024) }), lifecycle("completed")], "fork", undefined, 64],
    ["invalid-limit", [subagentMeta(parent, { turnLimit: -1 }), lifecycle("completed")], "fork", undefined, 2],
  ];
  for (const [id, entries, kind, status, reads] of cases) {
    const path = write(id, entries, { parentSession: parent });
    io.watchOnly([path]);
    const relation = (await forceCatalogue())[id].relation;
    assert.equal(relation.kind, kind, id);
    assert.equal(relation.status, status, id);
    assert.equal(io.counts.reads, reads, `${id}: original bounded read visibility`);
    io.reset();
    await forceCatalogue();
    assert.equal(io.counts.reads, 0, `${id}: stable result, including null, is reusable`);
  }
  const unterminated = write("unterminated", [subagentMeta(parent)], { parentSession: parent });
  fs.appendFileSync(unterminated, JSON.stringify(lifecycle("completed")));
  io.watchOnly([unterminated]);
  assert.equal((await forceCatalogue()).unterminated.relation.status, "completed");
  const torn = write("torn", [subagentMeta(parent), lifecycle("completed")], { parentSession: parent });
  fs.appendFileSync(torn, '{"type":"custom",');
  assert.equal((await forceCatalogue()).torn.relation.status, "completed");
  const nullEntry = write("null-entry", [subagentMeta(parent), null], { parentSession: parent });
  io.watchOnly([nullEntry]);
  assert.equal((await forceCatalogue())["null-entry"].relation.kind, "fork");
  io.reset();
  assert.equal((await forceCatalogue())["null-entry"].relation.kind, "fork");
  assert.ok(io.counts.reads > 0, "parser exceptions are not memoized as stable null results");
});

test("discovers sessions through project directory symlinks", { skip: process.platform === "win32" }, async (t) => {
  const { root, dir, write } = fixture(t);
  write("a", [message("a1", "user", "linked")]);
  const external = join(root, "external-project");
  fs.renameSync(dir, external);
  fs.symlinkSync(external, dir, "dir");
  assert.deepEqual(await listSessionsIncremental(), await sdkMetadata());
});
