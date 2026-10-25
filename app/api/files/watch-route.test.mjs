import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadTsModule, sseFixture, readText } from "../../../lib/sse-stream.fixture.mjs";
import { fileBodyModuleFixture } from "./file-body-module.fixture.mjs";

// Execute the entire GET and real SSE helper. Stat/watch, path resolution and
// authorization are supplied capabilities, not native filesystem/security proof.
test("file watching survives same-path replacement", async (t) => {
  const f = watchFixture(t);
  const response = await f.open();
  assert.equal(response.status, 200);
  const reader = f.reader(response);
  await readConnected(f, reader);
  assert.deepEqual(f.watchDirectories, ["/fixture"]);
  assert.deepEqual(f.authorizations, [{ filePath: "/fixture/quiet.txt", allowed: true }]);

  // A sibling event must not sample the target, even when its state changed.
  const reads = f.statPaths.length;
  f.stat.ctimeMs++;
  f.change("rename", "sibling.txt");
  assert.equal(f.statPaths.length, reads);
  await heartbeatSentinel(f, reader);

  // Independently vary ctime and ino, keeping size and mtime unchanged. These
  // are two replacements, not a tuple where either comparison could mask loss.
  f.change("rename", "quiet.txt");
  assert.deepEqual(await readChange(f, reader), { mtime: f.stat.mtime.toISOString(), size: 7 });
  f.change();
  await heartbeatSentinel(f, reader);
  f.stat.ino++;
  f.change("rename", Buffer.from("quiet.txt"));
  assert.deepEqual(await readChange(f, reader), { mtime: f.stat.mtime.toISOString(), size: 7 });
  f.change();
  await heartbeatSentinel(f, reader);
  assert.equal(f.stat.mtimeMs, 1);
  assert.equal(f.stat.size, 7);
  assert.equal(f.watches, 1, "one parent watcher survives both replacements");
});

test("a missing target can be watched after its parent is authorized", async (t) => {
  const f = watchFixture(t, { initiallyMissing: true, initiallyAuthorized: false });
  const denied = await f.open();
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "Access denied" });
  assert.deepEqual(f.authorizations, [{ filePath: "/fixture", allowed: false }]);
  assert.equal(f.watches, 0);
  assert.equal(f.intervals.size, 0);

  // Exercise the actual route's parent authorization branch, including denial;
  // only the result of its existing-path capability is supplied here.
  f.authorized = true;
  const response = await f.open();
  assert.equal(response.status, 200);
  const reader = f.reader(response);
  await readConnected(f, reader);
  assert.deepEqual(f.authorizations, [
    { filePath: "/fixture", allowed: false },
    { filePath: "/fixture", allowed: true },
  ]);
  assert.deepEqual(f.watchDirectories, ["/fixture"]);
  assert.deepEqual(f.startup, ["authorize:denied", "authorize:allowed", "watch:enter", "watch:ready", "enqueue:connected"]);
  f.change();
  f.change("rename", "quiet.txt");
  await heartbeatSentinel(f, reader); // Initially missing is not a disappearance.

  f.exists = true;
  f.change("rename", "quiet.txt");
  assert.deepEqual(await readChange(f, reader), { mtime: f.stat.mtime.toISOString(), size: 7 });
  f.exists = false;
  f.change("rename", "quiet.txt");
  assert.deepEqual(await readChange(f, reader), { mtime: f.nowIso, size: 0 });
  f.change();
  f.change();
  await heartbeatSentinel(f, reader); // One disappearance, not repeated misses.

  f.exists = true; // Recreate with the exact pre-disappearance stat tuple.
  f.change("rename", "quiet.txt");
  assert.deepEqual(await readChange(f, reader), { mtime: f.stat.mtime.toISOString(), size: 7 });
  f.change();
  await heartbeatSentinel(f, reader);
  assert.equal(f.watches, 1);
});

test("connected is emitted only after the watcher exists", async (t) => {
  const f = watchFixture(t);
  const response = await f.open();
  assert.equal(response.status, 200);
  const reader = f.reader(response);
  await readConnected(f, reader);
  // This is not a post-open watch count: the forwarding gate observes every
  // connected send synchronously, immediately before the real writer enqueues.
  // Both watch entry and successful construction must precede that boundary.
  assert.deepEqual(f.startup, ["authorize:allowed", "watch:enter", "watch:ready", "enqueue:connected"]);
  assert.deepEqual(f.failures, []);
  await heartbeatSentinel(f, reader); // Also rules out a second connected event.
});

async function readConnected(f, reader) {
  assert.equal(await readText(reader), ":\n\n");
  f.tick(); // Missing connected produces a heartbeat, not a no-event wait.
  const text = await readText(reader);
  assert.match(text, /^event: connected\ndata:/);
  assert.deepEqual(JSON.parse(text.split("data: ")[1]), { filePath: "/fixture/quiet.txt" });
}

async function readChange(f, reader) {
  f.tick(); // Missing change produces a heartbeat; an event suppresses this tick.
  const text = await readText(reader);
  assert.match(text, /^event: change\ndata:/);
  return JSON.parse(text.split("data: ")[1]);
}

async function heartbeatSentinel(f, reader) {
  // All owned notifications are synchronous. A queued event would precede this
  // heartbeat (and suppress it via desiredSize); no no-event timeout or sleep.
  f.tick();
  assert.equal(await readText(reader), ":\n\n");
}

function watchFixture(t, { failWatch = false, initiallyMissing = false, initiallyAuthorized = true } = {}) {
  const abort = new AbortController();
  const failures = [];
  const readers = [];
  const responses = [];
  const ownedWatchers = [];
  const statPaths = [];
  const watchDirectories = [];
  const authorizations = [];
  const startup = [];
  const roots = new Set(["/fixture"]);
  const now = Date.parse("2026-01-02T03:04:05Z");
  let sse;
  let fileBody;
  let change;
  let error;
  let closes = 0;
  let watches = 0;
  let exists = !initiallyMissing;
  let authorized = initiallyAuthorized;
  let watcherReady = false;
  let connectedSends = 0;
  // Register before loading either real module. Attempt every owned cleanup and
  // keep the same failure collector live through cancellation and closure.
  t.after(async () => {
    const attempt = async (operation) => {
      try { await operation(); } catch (failure) { failures.push(failure); }
    };
    await attempt(() => abort.abort());
    for (const reader of readers) await attempt(() => reader.cancel());
    for (const response of responses) {
      if (response.body && !response.body.locked && !response.bodyUsed) {
        await attempt(() => response.body.cancel());
      }
    }
    for (const owned of ownedWatchers) {
      if (!owned.closed) {
        failures.push(new Error("route did not close its owned watcher"));
        await attempt(() => owned.handle.close());
      }
    }
    if (sse) {
      await attempt(() => assert.equal(sse.intervals.size, 0, "route must clear its heartbeat"));
      for (const timer of sse.intervals) {
        await attempt(() => globalThis.clearInterval(timer));
        sse.intervals.delete(timer);
      }
    }
    if (fileBody) await attempt(async () => {
      const { closed } = await fileBody.finish();
      assert.equal(closed, true, "watch fixture must not retain a finite body stream");
    });
    change = undefined;
    error = undefined;
    if (failures.length) throw new AggregateError(failures, "watch fixture runtime/cleanup failures");
  });
  // Route catches must not hide invalid capability use or startup-order errors.
  const checked = (operation) => {
    try { return operation(); } catch (failure) { failures.push(failure); throw failure; }
  };
  sse = sseFixture(t);
  const stat = { isFile: () => true, mtimeMs: 1, ctimeMs: 1, ino: 1, size: 7,
    mtime: new Date("2026-01-01T00:00:00Z") };
  const mocks = {
    "next/server": { NextResponse: { json: Response.json } },
    fs: {
      statSync(filePath) {
        checked(() => assert.equal(filePath, "/fixture/quiet.txt"));
        statPaths.push(filePath);
        if (!exists) throw Object.assign(new Error("fixture target missing"), { code: "ENOENT" });
        return stat;
      },
      watch(directory, listener) {
        watches++;
        watchDirectories.push(directory);
        startup.push("watch:enter");
        checked(() => {
          assert.equal(connectedSends, 0, "connected must not precede watcher construction");
          assert.equal(authorizations.at(-1)?.allowed, true, "authorization must precede watching");
        });
        if (failWatch) throw new Error("fixture watch failed");
        change = listener;
        const owned = { closed: false, handle: null };
        owned.handle = {
          close() { closes++; owned.closed = true; },
          on(name, listener) {
            checked(() => assert.equal(name, "error"));
            error = listener;
          },
        };
        ownedWatchers.push(owned);
        watcherReady = true;
        startup.push("watch:ready");
        return owned.handle;
      },
    },
    path,
    "@/lib/file-access": {
      getAllowedFileRoots: async () => roots,
      isFilePathAllowed(filePath, allowedRoots) {
        checked(() => {
          assert.equal(filePath, "/fixture/quiet.txt");
          assert.equal(allowedRoots, roots);
        });
        return true;
      },
      isExistingFilePathAllowed(filePath, allowedRoots) {
        checked(() => assert.equal(allowedRoots, roots));
        authorizations.push({ filePath, allowed: authorized });
        startup.push(authorized ? "authorize:allowed" : "authorize:denied");
        return authorized;
      },
    },
    "@/lib/file-language": {}, // Watch mode never asks for presentation metadata.
    "@/lib/file-types": {}, "@/lib/file-dirent": {},
    "@/lib/session-file-references": {}, "@/lib/request-security": {},
    "@/lib/file-edit": {}, "@/lib/file-upload": {}, "@/lib/bounded-form-data": {},
    "@/lib/paths": { filePathFromApiSegments: () => "/fixture/quiet.txt", samePath: (a, b) => a === b },
    "@/lib/text-preview": {},
    "@/lib/sse-stream": {
      ...sse,
      createSseStream(request, start, onClose) {
        return sse.createSseStream(request, (writer) => start({
          get closed() { return writer.closed; },
          close: () => writer.close(),
          send(data, eventName) {
            if (eventName === "connected") {
              connectedSends++;
              startup.push("enqueue:connected");
              if (!watcherReady) failures.push(new Error("connected reached real enqueue before fs.watch returned"));
            }
            // Always forward, including invalid ordering: don't manufacture bytes
            // or turn the controlled gate into a second transport implementation.
            writer.send(data, eventName);
          },
        }), onClose);
      },
    },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  fileBody = fileBodyModuleFixture(mocks.fs, { allowReads: false, failures });
  mocks["@/lib/file-body-stream"] = fileBody.load({ Date: ClockDate });
  const { GET } = loadTsModule(new URL("./[...path]/route.ts", import.meta.url), mocks, { Date: ClockDate }).exports;
  const request = new Request("http://localhost/api/files/fixture/quiet.txt?type=watch", { signal: abort.signal });
  request.nextUrl = new URL(request.url);
  return { ...sse, abort, stat, failures, startup, statPaths, watchDirectories, authorizations,
    nowIso: new Date(now).toISOString(),
    async open() {
      const response = await GET(request, { params: Promise.resolve({ path: ["fixture", "quiet.txt"] }) });
      responses.push(response);
      return response;
    },
    reader(response) {
      const reader = response.body.getReader();
      readers.push(reader);
      return reader;
    },
    change: (eventType = "change", name = "quiet.txt") => checked(() => change(eventType, name)),
    error: () => checked(() => error()),
    get exists() { return exists; }, set exists(value) { exists = value; },
    get authorized() { return authorized; }, set authorized(value) { authorized = value; },
    get closes() { return closes; }, get watches() { return watches; },
  };
}

for (const mode of ["abort", "cancel", "watcher error"]) {
  test(`quiet file watching emits heartbeats and cleans up on ${mode}`, async (t) => {
    const f = watchFixture(t);
    const response = await f.open();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const reader = response.body.getReader();
    t.after(() => reader.cancel());
    assert.equal(await readText(reader), ":\n\n");
    assert.equal(f.watches, 1);
    assert.match(await readText(reader), /^event: connected\ndata:/);
    for (let i = 0; i < 5; i++) {
      f.tick();
      assert.equal(await readText(reader), ":\n\n");
    }
    f.stat.mtimeMs++;
    f.change();
    assert.match(await readText(reader), /^event: change\ndata:.*"size":7/);
    if (mode === "abort") f.abort.abort();
    else if (mode === "cancel") await reader.cancel();
    else f.error();
    assert.equal((await reader.read()).done, true);
    assert.equal(f.closes, 1);
    assert.equal(f.intervals.size, 0);
    f.stat.mtimeMs++;
    f.change();
    assert.equal((await reader.read()).done, true);
    f.abort.abort();
    assert.equal(f.closes, 1);
  });
}

test("watch creation failure sends an error and stops its heartbeat", async (t) => {
  const f = watchFixture(t, { failWatch: true });
  const reader = (await f.open()).body.getReader();
  assert.equal(await readText(reader), ":\n\n");
  assert.match(await readText(reader), /^event: error\ndata:/);
  assert.equal((await reader.read()).done, true);
  assert.equal(f.intervals.size, 0);
});

test("already-aborted file watch creates no watcher or timer", async (t) => {
  const f = watchFixture(t);
  f.abort.abort();
  const reader = (await f.open()).body.getReader();
  assert.equal((await reader.read()).done, true);
  assert.equal(f.watches, 0);
  assert.equal(f.intervals.size, 0);
});
