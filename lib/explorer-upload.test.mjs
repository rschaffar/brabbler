import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { ExplorerUpload, browserUploadTransport } = await createJiti(import.meta.url).import("./explorer-upload.ts");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const files = [new File(["body"], "note.txt")];

function fixture(transport) {
  const states = [], completions = [];
  const owner = new ExplorerUpload(state => states.push(state), result => completions.push(result), transport);
  return { owner, states, completions, get latest() { return states.at(-1); } };
}

test("locks preflight/conflict, retains directory through explicit choices and partial results", async () => {
  const calls = [];
  const f = fixture({
    check: async (...args) => { calls.push(args); return { conflicts: ["note.txt"], nonReplaceable: [] }; },
    upload: async (...args) => { calls.push(args); args[4](64); return { status: 207, data: { uploaded: ["note.txt"], errors: [{ name: "other.txt", error: "denied" }] } }; },
  });
  await f.owner.start("//host/share/project/nested", files);
  assert.equal(f.owner.locked, true);
  await f.owner.start("/wrong-target", files);
  assert.equal(calls.length, 1);
  await f.owner.resolve("overwrite");
  assert.equal(calls[1][0], "//host/share/project/nested");
  assert.equal(calls[1][2], "overwrite");
  assert.equal(f.latest.summary.directory, "//host/share/project/nested");
  assert.equal(f.latest.summary.errors[0].name, "other.txt");
  assert.equal(f.completions.length, 1);
  assert.equal(f.owner.locked, false);
});

test("a write-time conflict returns to review and cancellation dispatches no upload", async () => {
  let sends = 0;
  const f = fixture({ check: async () => ({}), upload: async () => { sends++; return { status: 409, data: { conflicts: ["late.txt"] } }; } });
  await f.owner.start("/original", files);
  assert.equal(f.latest.conflict.conflicts[0], "late.txt");
  assert.equal(f.owner.locked, true);
  f.owner.cancelConflict();
  await f.owner.resolve("overwrite");
  assert.equal(sends, 1);
  assert.equal(f.owner.locked, false);
});

for (const phase of ["check", "upload"]) test(`disposed ${phase} cannot continue, update state or report completion`, async () => {
  const gate = deferred();
  let signal, progress, sends = 0;
  const f = fixture({
    check: async (_directory, _files, s) => { signal = s; return phase === "check" ? gate.promise : {}; },
    upload: async (_directory, _files, _strategy, s, p) => { sends++; signal = s; progress = p; return gate.promise; },
  });
  const pending = f.owner.start("/old", files);
  await Promise.resolve();
  f.owner.dispose();
  const count = f.states.length;
  assert.equal(signal.aborted, true);
  progress?.(99);
  gate.resolve(phase === "check" ? {} : { status: 200, data: { uploaded: ["note.txt"] } });
  await pending;
  assert.equal(f.states.length, count);
  assert.equal(f.completions.length, 0);
  assert.equal(sends, phase === "check" ? 0 : 1);
  await f.owner.start("/new", files);
  assert.equal(f.states.length, count);
});

test("failed uploads unlock but never retry or imply success", async () => {
  let sends = 0;
  const f = fixture({ check: async () => ({}), upload: async () => { sends++; throw new Error("connection lost; inspect destination"); } });
  await f.owner.start("/target", files);
  assert.match(f.latest.error, /inspect destination/);
  assert.equal(f.owner.locked, false);
  assert.equal(sends, 1);
  assert.equal(f.completions.length, 0);
});

test("browser preflight preserves UNC encoding and forwards its abort signal", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^\/api\/files\/%2F%2Fhost\/share\/nested\?type=upload-check$/);
    assert.equal(options.signal, controller.signal);
    assert.deepEqual(JSON.parse(options.body), { fileNames: ["note.txt"] });
    return Response.json({ conflicts: [] });
  };
  assert.deepEqual(await browserUploadTransport.check("\\\\host\\share\\nested", files, controller.signal), { conflicts: [] });
});

test("XHR upload aborts once, retains the directory and removes its signal listener", async t => {
  const original = globalThis.XMLHttpRequest;
  const calls = [];
  class Xhr {
    upload = {};
    open(...args) { calls.push(args); }
    send(form) { calls.push(form.get("files").name); }
    abort() { calls.push("abort"); this.onabort(); }
  }
  globalThis.XMLHttpRequest = Xhr;
  t.after(() => { globalThis.XMLHttpRequest = original; });
  const controller = new AbortController();
  let listeners = 0;
  const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { listeners++; return add(...args); };
  controller.signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
  const pending = browserUploadTransport.upload("/root/sub", files, "skip", controller.signal, () => {});
  controller.abort();
  await assert.rejects(pending, /not rolled back/);
  assert.deepEqual(calls, [["POST", "/api/files/root/sub?type=upload&conflict=skip"], "note.txt", "abort"]);
  assert.equal(listeners, 0);
});
