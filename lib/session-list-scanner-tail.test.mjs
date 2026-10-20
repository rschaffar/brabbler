// Synthetic append-tail regressions, adapted from upstream 1a94341c.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as nodeTest } from "node:test";
// Bound new synthetic gates so a regression produces retained TAP, not an endless builder.
const test = (name, run) => nodeTest(name, { timeout: 10_000 }, run);
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { listSessionsIncremental: list, scanSessionFileInfo: full, resetSessionScanIndexForTests: reset,
  flushSessionScanIndexForTests: flush } = await jiti.import("./session-list-scanner.ts");
const timestamp = "2026-01-01T00:00:00.000Z";
const line = (entry) => JSON.stringify(entry) + "\n";
const message = (role, content, time = timestamp) => ({ type: "message", timestamp: time, message: { role, content } });
const archive = (archived, version = 1) => ({ type: "custom", customType: "pi-web:archive", data: { version, archived } });
const spawn = (sessionId, creatorSessionId = "creator") => ({ type: "custom", customType: "pi-web:session-spawn",
  data: { version: 1, sessionId, creatorSessionId, operationId: "operation" } });

function fixture(t) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-scanner-tail-"));
  const dir = join(root, "sessions", "project");
  fs.mkdirSync(dir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = root;
  reset();
  t.after(() => {
    reset();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (id = "session", entries = [], extra = {}) => {
    const path = join(dir, `${id}.jsonl`);
    fs.writeFileSync(path, line({ type: "session", version: 3, id, cwd: root, timestamp, ...extra }) + entries.map(line).join(""));
    return path;
  };
  return { root, dir, write, indexPath: join(root, "pi-web-session-index.json") };
}

function observeReads(t, intercept) {
  const reads = [], original = fs.createReadStream;
  t.mock.method(fs, "createReadStream", (path, options) => {
    reads.push({ path, start: options?.start ?? 0, end: options?.end, fd: options?.fd?.fd ?? options?.fd });
    return intercept?.(path, options, original) ?? original(path, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return reads;
}

async function assertScan(path, reads, expectedStart) {
  const expected = await full(path);
  reads.length = 0;
  const actual = await list();
  assert.deepEqual(actual, [expected]);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].start, expectedStart);
  assert.equal(reads[0].end, fs.statSync(path).size - 1);
  assert.equal(typeof reads[0].fd, "number");
  return actual[0];
}

test("resumes totals, names, literal placeholder text and fork metadata across appends and restart", async (t) => {
  const { write } = fixture(t);
  const path = write("session", [message("assistant", "start", "2026-01-03T00:00:00Z")], { parentSession: "/synthetic/parent.jsonl" });
  await list();
  const reads = observeReads(t);
  const append = async (entry) => {
    const offset = fs.statSync(path).size;
    fs.appendFileSync(path, line(entry));
    return assertScan(path, reads, offset);
  };
  assert.equal((await append({ type: "session_info", name: "  Named  " })).name, "Named");
  assert.equal((await append(message("user", "(no messages)"))).firstMessage, "(no messages)");
  let row = await append(message("user", "not the first", "2026-01-02T00:00:00Z"));
  assert.equal(row.firstMessage, "(no messages)");
  assert.equal(row.modified.toISOString(), "2026-01-03T00:00:00.000Z");
  assert.equal(row.parentSessionPath, "/synthetic/parent.jsonl");
  row = await append({ type: "session_info", name: " " });
  assert.equal(row.name, undefined);
  flush(); reset();
  row = await append(message("assistant", "after restart", "2026-01-04T00:00:00Z"));
  assert.equal(row.messageCount, 4);
  assert.equal(row.modified.toISOString(), "2026-01-04T00:00:00.000Z");
});

test("partial UTF-8 records are reread; complete unterminated records disable resume", async (t) => {
  const { write } = fixture(t);
  const path = write("session", [message("user", "first")]);
  await list();
  const reads = observeReads(t);
  const bytes = Buffer.from(line(message("assistant", "answer 🌍 café")));
  const split = bytes.indexOf(Buffer.from("🌍")) + 2;
  const offset = fs.statSync(path).size;
  fs.appendFileSync(path, bytes.subarray(0, split));
  assert.equal((await assertScan(path, reads, offset)).messageCount, 1);
  flush(); reset();
  fs.appendFileSync(path, bytes.subarray(split));
  assert.equal((await assertScan(path, reads, offset)).messageCount, 2);
  const end = fs.statSync(path).size;
  fs.appendFileSync(path, JSON.stringify(message("assistant", "no newline")));
  assert.equal((await assertScan(path, reads, end)).messageCount, 3);
  fs.appendFileSync(path, "\n");
  assert.equal((await assertScan(path, reads, 0)).messageCount, 3);
  const next = fs.statSync(path).size;
  fs.appendFileSync(path, line(message("toolResult", "counts too")));
  assert.equal((await assertScan(path, reads, next)).messageCount, 4);
});

test("handles chunk-boundary UTF-8, CRLF, split CRLF and raw Unicode separators", async (t) => {
  const { write } = fixture(t);
  const path = write();
  await list();
  const reads = observeReads(t, (path, options, original) => original(path, { ...options, highWaterMark: 7 }));
  const offset = fs.statSync(path).size;
  fs.appendFileSync(path, JSON.stringify(message("user", "🌍\u2028café\u2029end")) + "\r\n"
    + JSON.stringify(message("assistant", "reply")) + "\r\n" + line({ type: "session_info", name: "Title\u2029part" }));
  let row = await assertScan(path, reads, offset);
  assert.equal(row.messageCount, 2);
  assert.equal(row.firstMessage, "🌍\u2028café\u2029end");
  assert.equal(row.name, "Title\u2029part");
  const loaded = SessionManager.open(path);
  assert.equal(loaded.getEntries().filter((entry) => entry.type === "message")[0].message.content, row.firstMessage);
  assert.equal(loaded.getSessionName(), row.name);
  const end = fs.statSync(path).size;
  fs.appendFileSync(path, JSON.stringify(message("assistant", "split CRLF")) + "\r");
  row = await assertScan(path, reads, end);
  assert.equal(row.messageCount, 3);
  fs.appendFileSync(path, "\n");
  assert.equal((await assertScan(path, reads, 0)).messageCount, 3);
});

test("archive and first validated spawn survive resume, summaries, restoration and reload", async (t) => {
  const { write } = fixture(t);
  const path = write("session", [message("user", "keep"), spawn("copied-id"), spawn("session", "../invalid")]);
  await list();
  const reads = observeReads(t);
  let offset = fs.statSync(path).size;
  fs.appendFileSync(path, [spawn("session"), archive(true), archive(false, 99)].map(line).join(""));
  let row = await assertScan(path, reads, offset);
  assert.equal(row.archived, true); assert.equal(row.spawnedBy, "creator");
  flush(); reset();
  offset = fs.statSync(path).size;
  fs.appendFileSync(path, [archive(false), spawn("session", "other-creator")].map(line).join(""));
  reads.length = 0;
  const summary = (await list({ deferDetails: true }))[0];
  assert.equal(summary.archived, false); assert.equal(summary.detailsPending, true);
  assert.equal(reads[0].start, 0, "changed summaries still resolve archive state in full");
  row = await assertScan(path, reads, offset);
  assert.equal(row.archived, undefined); assert.equal(row.spawnedBy, "creator");
  flush(); reset();
  reads.length = 0;
  row = (await list({ deferDetails: true }))[0];
  assert.equal(row.detailsPending, undefined); assert.equal(row.spawnedBy, "creator"); assert.equal(reads.length, 0);
  write("copy", [spawn("session"), message("user", "copied history")], { parentSession: path });
  assert.equal((await list()).find((row) => row.id === "copy").spawnedBy, undefined);
});

test("cold Unicode archive markers remain hidden before detail hydration", async (t) => {
  const { write } = fixture(t);
  write("session", [{ ...archive(true), note: "raw\u2028separator" }]);
  assert.equal((await list({ deferDetails: true }))[0].archived, true);
  assert.equal((await list())[0].archived, true);
});

test("header/sample rewrites, truncation and inode replacement fall back to zero", async (t) => {
  const { write, dir } = fixture(t);
  const path = write("session", [message("user", "original"), message("assistant", "x".repeat(2048))]);
  await list();
  const reads = observeReads(t);
  // In-place same-size edit with restored mtime still changes ctime.
  const before = fs.statSync(path);
  fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("original", "replaced"));
  fs.utimesSync(path, before.atime, before.mtime);
  assert.equal((await assertScan(path, reads, 0)).firstMessage, "replaced");
  write("session", [message("user", "header rewrite"), message("assistant", "x".repeat(4096))], { parentSession: "/new/parent" });
  assert.equal((await assertScan(path, reads, 0)).parentSessionPath, "/new/parent");
  fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace(/x{100}(?=")/, "y".repeat(100)) + line(message("assistant", "grew")));
  // Change the sampled boundary as well, not just an unsampled interior.
  fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace('"grew"', '"new boundary"'));
  await assertScan(path, reads, 0);
  write("session", [message("user", "short")]);
  assert.equal((await assertScan(path, reads, 0)).messageCount, 1);
  const replacement = join(dir, ".replacement");
  fs.writeFileSync(replacement, fs.readFileSync(path));
  fs.renameSync(replacement, path);
  fs.appendFileSync(path, line(message("assistant", "replaced")));
  await assertScan(path, reads, 0);
});

test("same-size replacement cannot hit unchanged cache even with restored mtime", async (t) => {
  const { write, dir } = fixture(t);
  const path = write("session", [message("user", "before")]);
  await list();
  const before = fs.statSync(path), replacement = join(dir, ".replacement");
  fs.writeFileSync(replacement, fs.readFileSync(path, "utf8").replace("before", "after!"));
  fs.utimesSync(replacement, before.atime, before.mtime);
  fs.renameSync(replacement, path);
  const reads = observeReads(t);
  assert.equal((await assertScan(path, reads, 0)).firstMessage, "after!");
});

test("unusual or oversized headers scan but do not checkpoint", async (t) => {
  const { write } = fixture(t);
  const path = write("session", [message("user", "valid")], { padding: "x".repeat(70 * 1024) });
  await list();
  const reads = observeReads(t);
  fs.appendFileSync(path, line(message("assistant", "full fallback")));
  await assertScan(path, reads, 0);
  fs.writeFileSync(path, "\ninvalid\n" + line({ type: "session", version: 3, id: "session", cwd: "/fixture", timestamp }));
  await list();
  fs.appendFileSync(path, line(message("user", "after prefix")));
  await assertScan(path, reads, 0);
});

test("malformed checkpoints retain valid rows but cannot allocate/seek unbounded values", async (t) => {
  const { write, indexPath } = fixture(t);
  const path = write("session", [message("user", "safe")]);
  await list(); flush();
  const pristine = fs.readFileSync(indexPath, "utf8");
  const reads = observeReads(t);
  const cases = [
    (entry) => { entry.resume = null; },
    (entry) => { entry.resume.headerEnd = 2 ** 40; },
    (entry) => { entry.resume.offset = entry.fp.size + 1; },
    (entry) => { entry.resume.offset = -1; },
    (entry) => { entry.resume.check = "invalid"; },
    (entry) => { entry.resume.hasFirstMessage = null; },
    (entry) => { entry.resume.lastActivityTime = "invalid"; },
    (entry) => { entry.fp.ino = 0; },
  ];
  for (const corrupt of cases) {
    const persisted = JSON.parse(pristine);
    corrupt(persisted.entries[path]);
    fs.writeFileSync(indexPath, JSON.stringify(persisted)); reset();
    fs.appendFileSync(path, line(message("assistant", "append")));
    await assertScan(path, reads, 0);
  }
  const old = JSON.parse(pristine); old.version = 1;
  fs.writeFileSync(indexPath, JSON.stringify(old)); reset();
  await assertScan(path, reads, 0);
});

test("persistence coalesces captured snapshots and destinations; reset cancels pending writes", async (t) => {
  const { root, write, indexPath } = fixture(t);
  const path = write("session", [message("user", "first")]);
  await list();
  assert.equal(fs.existsSync(indexPath), false);
  const pending = globalThis.__piWebScanIndexSave;
  fs.appendFileSync(path, line(message("assistant", "second")));
  await list();
  assert.equal(globalThis.__piWebScanIndexSave.timer, pending.timer, "not a resetting debounce");
  const other = fs.mkdtempSync(join(tmpdir(), "pi-web-scanner-other-"));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = other;
  flush();
  assert.equal(fs.existsSync(join(other, "pi-web-session-index.json")), false);
  assert.equal(JSON.parse(fs.readFileSync(indexPath, "utf8")).entries[path].info.messageCount, 2);
  if (process.platform !== "win32") assert.equal(fs.statSync(indexPath).mode & 0o777, 0o600);
  fs.mkdirSync(join(other, "sessions", "project"), { recursive: true });
  const otherPath = join(other, "sessions", "project", "other.jsonl");
  fs.writeFileSync(otherPath, line({ type: "session", version: 3, id: "other", cwd: other, timestamp }));
  await list();
  process.env.PI_CODING_AGENT_DIR = root;
  await list(); // Flush the other destination before changing index ownership.
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(join(other, "pi-web-session-index.json"), "utf8")).entries), [otherPath]);
  fs.appendFileSync(path, line(message("assistant", "not saved")));
  await list(); reset(); flush();
  assert.equal(JSON.parse(fs.readFileSync(indexPath, "utf8")).entries[path].info.messageCount, 2);
});

test("replacement after validation reads the original descriptor but cannot cache it", async (t) => {
  const { write, dir } = fixture(t);
  const path = write("session", [message("user", "old")]);
  await list();
  fs.appendFileSync(path, line(message("assistant", "old append")));
  let replaced = false;
  const reads = observeReads(t, (file, options, original) => {
    if (!replaced) {
      replaced = true;
      const replacement = join(dir, ".replacement");
      fs.writeFileSync(replacement, line({ type: "session", version: 3, id: "session", cwd: "/new", timestamp }) + line(message("user", "new")));
      fs.renameSync(replacement, path);
    }
    return original(file, options);
  });
  const [old] = await list();
  assert.equal(old.firstMessage, "old");
  assert.equal(globalThis.__piWebScanIndex.has(path), false, "raced descriptor cannot be reused");
  assert.equal((await assertScan(path, reads, 0)).firstMessage, "new");
});

test("overlapping listings serialize; append during a bounded scan is hydrated next", async (t) => {
  const { write } = fixture(t);
  const path = write("session", [message("user", "first")]);
  let release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const admitted = new Promise((resolve) => { started = resolve; });
  t.after(() => release());
  let gated = false;
  const reads = observeReads(t, (file, options, original) => {
    if (gated) return original(file, options);
    gated = true;
    return { async *[Symbol.asyncIterator]() { started(); await gate; yield* original(file, options); } };
  });
  const first = list();
  await admitted;
  fs.appendFileSync(path, line(message("assistant", "second")));
  const second = list();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads.length, 1, "second owner cannot publish while first is gated");
  release();
  assert.equal((await first)[0].messageCount, 1, "initial size bounds the first read");
  assert.equal((await second)[0].messageCount, 2);
  flush(); reset();
  reads.length = 0;
  assert.equal((await list())[0].messageCount, 2);
  assert.equal(reads.length, 0, "only the stable second snapshot was persisted");
});

test("truncation during streaming drops the checkpoint and rebuilds next time", async (t) => {
  const { write } = fixture(t);
  const path = write("session", [message("user", "before"), message("assistant", "x".repeat(2048))]);
  await list();
  fs.appendFileSync(path, line(message("assistant", "append")));
  let truncated = false;
  const reads = observeReads(t, (file, options, original) => {
    if (!truncated) { truncated = true; fs.truncateSync(path, 0); }
    return original(file, options);
  });
  await list();
  assert.equal(globalThis.__piWebScanIndex.has(path), false);
  write("session", [message("user", "recovered")]);
  assert.equal((await assertScan(path, reads, 0)).firstMessage, "recovered");
});

test("invalid first entries and injected stream errors close owned handles without poisoning later scans", async (t) => {
  const { write } = fixture(t);
  for (let i = 0; i < 20; i++) {
    const path = write(`invalid-${i}`);
    fs.writeFileSync(path, line(message("user", "not a session header")) + "x".repeat(128 * 1024));
  }
  const good = write("valid", [message("user", "healthy")]);
  assert.deepEqual((await list()).map((row) => row.id), ["valid"]);
  fs.appendFileSync(good, line(message("assistant", "will fail")));
  let failed = false;
  const reads = observeReads(t, (file, options, original) => {
    if (file !== good || failed) return original(file, options);
    failed = true;
    return Readable.from((async function* () { throw new Error("synthetic stream error"); })());
  });
  assert.deepEqual(await list(), []);
  assert.equal(globalThis.__piWebScanIndex.has(good), false);
  reads.length = 0;
  assert.equal((await list())[0].messageCount, 2, "next scan recovers after stream failure");
});

test("a rejected catalogue owner does not poison the serial queue", async (t) => {
  const { write } = fixture(t);
  write("session", [message("user", "healthy")]);
  const options = Object.defineProperty({}, "deferDetails", { get() { throw new Error("synthetic owner failure"); } });
  const rejected = list(options);
  const recovered = list();
  await assert.rejects(rejected, /synthetic owner failure/);
  assert.equal((await recovered)[0].firstMessage, "healthy");
});
