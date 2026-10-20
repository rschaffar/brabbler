import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import ts from "typescript";
const { createHighlightQueue, whenSelectionClears } = await createJiti(import.meta.url).import("./highlight-queue.ts");

function fixture() {
  const scheduled = new Map();
  let id = 0;
  const wait = createHighlightQueue(run => {
    const key = ++id;
    scheduled.set(key, run);
    return () => scheduled.delete(key);
  });
  return { wait, scheduled, tick() {
    assert.equal(scheduled.size, 1, "only one outstanding slice");
    const [key, run] = scheduled.entries().next().value;
    scheduled.delete(key); run();
  } };
}

test("grants occur one per slice, newest-biased with bounded oldest fairness", () => {
  const f = fixture(), shown = [];
  for (let i = 0; i < 8; i++) f.wait(() => shown.push(i));
  assert.deepEqual(shown, [], "no render-time work");
  f.tick(); f.tick(); f.tick(); f.tick();
  assert.deepEqual(shown, [7, 6, 5, 0]);
  while (f.scheduled.size) f.tick();
  assert.equal(shown.length, 8);
});

test("cancellation removes callbacks and cancels the idle handle when empty", () => {
  const f = fixture(), shown = [];
  const cancelOld = f.wait(() => shown.push("old"));
  const cancelNew = f.wait(() => shown.push("new"));
  cancelNew(); f.tick();
  assert.deepEqual(shown, ["old"]);
  cancelOld(); cancelNew();
  assert.equal(f.scheduled.size, 0);
  const cancel = f.wait(() => assert.fail("unmounted callback"));
  cancel();
  assert.equal(f.scheduled.size, 0);
});

test("continually arriving newest work cannot starve the oldest waiter", () => {
  const f = fixture(); let oldest = false;
  f.wait(() => { oldest = true; });
  for (let i = 0; i < 4; i++) { f.wait(() => {}); f.tick(); }
  assert.equal(oldest, true);
  while (f.scheduled.size) f.tick();
});

test("browser idle and timer fallback handles are cancellable, with no module-time scheduling", async () => {
  const script = new Script(ts.transpileModule(await readFile(new URL("./highlight-queue.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  for (const idle of [true, false]) {
    const jobs = new Map(); let nextId = 0, granted = 0;
    const window = {
      setTimeout(cb, delay) { assert.equal(delay, 50); jobs.set(++nextId, cb); return nextId; },
      clearTimeout: id => jobs.delete(id),
      ...(idle ? {
        requestIdleCallback(cb, options) { assert.equal(options.timeout, 500); jobs.set(++nextId, cb); return nextId; },
        cancelIdleCallback: id => jobs.delete(id),
      } : {}),
    };
    const exports = {}; script.runInNewContext({ exports, window });
    assert.equal(jobs.size, 0);
    const cancel = exports.waitForHighlight(() => granted++);
    assert.equal(jobs.size, 1); cancel(); assert.equal(jobs.size, 0);
    exports.waitForHighlight(() => granted++);
    const [id, run] = [...jobs][0]; jobs.delete(id); run();
    assert.equal(granted, 1); assert.equal(jobs.size, 0);
  }
  script.runInNewContext({ exports: {} }); // SSR: no window is required merely to import.
});

test("selection defers text-node replacement and cleanup releases its listener", () => {
  const listeners = new Set(); let selected = true, grants = 0;
  const document = {
    getSelection: () => ({ isCollapsed: !selected, rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) }),
    addEventListener: (_name, cb) => listeners.add(cb), removeEventListener: (_name, cb) => listeners.delete(cb),
  };
  const cancel = whenSelectionClears({ ownerDocument: document }, () => grants++);
  assert.equal(grants, 0); assert.equal(listeners.size, 1);
  selected = false; for (const cb of listeners) cb();
  assert.equal(grants, 1); assert.equal(listeners.size, 0);
  cancel();
  selected = true;
  const unmount = whenSelectionClears({ ownerDocument: document }, () => assert.fail("stale selection"));
  unmount(); assert.equal(listeners.size, 0);
  whenSelectionClears(null, () => grants++);
  assert.equal(grants, 2);
});
