import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { loadTsModule, sseFixture, readText } from "../../../lib/sse-stream.fixture.mjs";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const start = source.indexOf('if (type === "watch")');
const end = source.indexOf("// type === \"list\"", start);
assert.notEqual(start, -1, "watch route not found");
assert.notEqual(end, -1, "watch route end not found");
const watchBlock = source.slice(start, end);

test("file watching survives same-path replacement", () => {
  assert.match(watchBlock, /watcher = fs\.watch\(watchedDirectory/);
  assert.match(watchBlock, /samePath\(path\.join\(watchedDirectory, changedName\.toString\(\)\), filePath\)/);
  assert.match(watchBlock, /s\.ctimeMs === lastCtimeMs/);
  assert.match(watchBlock, /s\.ino === lastIno/);
  assert.match(watchBlock, /lastExists/);
});

test("a missing target can be watched after its parent is authorized", () => {
  assert.match(source, /if \(type !== "watch"\)[\s\S]*error: "Not found"/);
  assert.match(source, /const existingAuthorizationPath = stat \? filePath : path\.dirname\(filePath\)/);
  assert.match(watchBlock, /lastExists = stat !== undefined/);
});

test("connected is emitted only after the watcher exists", () => {
  const watcher = watchBlock.indexOf("watcher = fs.watch");
  const connected = watchBlock.indexOf('send("connected"');
  assert.ok(watcher >= 0, "watcher creation missing");
  assert.ok(connected > watcher, "connected emitted before watcher creation");
});

function watchFixture(t, { failWatch = false } = {}) {
  const sse = sseFixture(t);
  const abort = new AbortController();
  let change;
  let error;
  let closes = 0;
  let watches = 0;
  const stat = { isFile: () => true, mtimeMs: 1, ctimeMs: 1, ino: 1, size: 7,
    mtime: new Date("2026-01-01T00:00:00Z") };
  const mocks = {
    "next/server": { NextResponse: { json: Response.json } },
    fs: {
      statSync: () => stat,
      watch(_dir, listener) {
        watches++;
        if (failWatch) throw new Error("fixture watch failed");
        change = listener;
        return { close() { closes++; }, on(_name, listener) { error = listener; } };
      },
    },
    path,
    "@/lib/file-access": { getAllowedFileRoots: async () => new Set(["/fixture"]),
      isFilePathAllowed: () => true, isExistingFilePathAllowed: () => true },
    "@/lib/file-types": {}, "@/lib/file-dirent": {},
    "@/lib/session-file-references": {}, "@/lib/request-security": {},
    "@/lib/file-edit": {}, "@/lib/file-upload": {}, "@/lib/bounded-form-data": {},
    "@/lib/paths": { filePathFromApiSegments: () => "/fixture/quiet.txt", samePath: (a, b) => a === b },
    "@/lib/text-preview": {}, "@/lib/sse-stream": sse,
  };
  const { GET } = loadTsModule(new URL("./[...path]/route.ts", import.meta.url), mocks).exports;
  const request = new Request("http://localhost/api/files/fixture/quiet.txt?type=watch", { signal: abort.signal });
  request.nextUrl = new URL(request.url);
  return { ...sse, abort, stat,
    open: () => GET(request, { params: Promise.resolve({ path: ["fixture", "quiet.txt"] }) }),
    change: () => change("change", "quiet.txt"), error: () => error(),
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
