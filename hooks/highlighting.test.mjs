import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

async function harness(file, modules) {
  const script = new Script(ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const slots = [], effects = [];
  let cursor = 0;
  const equal = (a, b) => a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, value => { slots[index].value = value; }];
    },
    useMemo(calculate, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, value: calculate() };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const exports = {};
  script.runInNewContext({ exports, require: name => name === "react" ? react : modules[name] });
  return { exports, render(run) { cursor = 0; return run(); }, commit() { for (const effect of effects.splice(0)) effect(); }, unmount() { for (const slot of slots) slot.cleanup?.(); } };
}

test("deferred grants are post-commit, cancel on generation change and cannot revive A after A-B-A", async () => {
  const callbacks = new Set(), root = { current: null };
  const h = await harness("./useDeferredHighlight.ts", { "@/lib/highlight-queue": {
    hasHighlightSelection: () => false,
    waitForHighlight: cb => { callbacks.add(cb); return () => callbacks.delete(cb); },
    whenSelectionClears: (_root, cb) => { cb(); return () => {}; },
  } });
  const render = (code = "A", lang = "tsx", enabled = true) => h.render(() => h.exports.useDeferredHighlight(code, lang, enabled, root));
  assert.equal(render(), false); assert.equal(callbacks.size, 0);
  h.commit(); const old = [...callbacks][0];
  assert.equal(render("B"), false); h.commit();
  assert.equal(callbacks.has(old), false);
  assert.equal(render("A"), false); h.commit();
  old(); assert.equal(render("A"), false, "obsolete readiness does not match current generation");
  [...callbacks][0](); assert.equal(render("A"), true);
  assert.equal(render("A", "js"), false); h.commit();
  assert.equal(render("A", "js", false), false); h.commit();
  assert.equal(callbacks.size, 0, "streaming/disabled work is removed");
  render(); h.commit(); h.unmount(); assert.equal(callbacks.size, 0);
});

test("clearing selection requeues blocked fences instead of publishing a batch", async () => {
  let selecting = true;
  const queued = new Set(), selected = new Set(), root = { current: {} };
  const modules = { "@/lib/highlight-queue": {
    hasHighlightSelection: () => selecting,
    waitForHighlight: cb => { queued.add(cb); return () => queued.delete(cb); },
    whenSelectionClears: (_root, cb) => { selected.add(cb); return () => selected.delete(cb); },
  } };
  const first = await harness("./useDeferredHighlight.ts", modules), second = await harness("./useDeferredHighlight.ts", modules);
  const render = h => h.render(() => h.exports.useDeferredHighlight("code", "tsx", true, root));
  const tick = () => { const cb = [...queued][0]; queued.delete(cb); cb(); };
  for (const h of [first, second]) { render(h); h.commit(); }
  tick(); tick();
  assert.equal(queued.size, 0); assert.equal(selected.size, 2);
  selecting = false; for (const cb of selected) cb(); selected.clear();
  assert.equal(render(first), false); assert.equal(render(second), false);
  assert.equal(queued.size, 2);
  tick(); assert.equal(render(first), true); assert.equal(render(second), false);
  tick(); assert.equal(render(second), true);
  first.unmount(); second.unmount();
});

test("language loading starts only after enabled commit, handles rejection and cancels late publication", async () => {
  let loads = 0, resolve, reject;
  const h = await harness("./usePrismLanguages.ts", {
    "@/lib/prism-languages": { loadPrismLanguages() { loads++; return new Promise((yes, no) => { resolve = yes; reject = no; }); } },
    "@/lib/highlight-queue": { whenSelectionClears: (_root, cb) => { cb(); return () => {}; } },
  });
  const render = enabled => h.render(() => h.exports.usePrismLanguages(enabled));
  assert.equal(render(false), false); h.commit(); assert.equal(loads, 0);
  assert.equal(render(true), false); assert.equal(loads, 0); h.commit(); assert.equal(loads, 1);
  reject(new Error("synthetic chunk rejection")); await Promise.resolve();
  assert.equal(render(true), false); h.commit(); assert.equal(loads, 1, "no retry loop");
  render(false); h.commit(); render(true); h.commit(); assert.equal(loads, 2);
  const late = resolve; h.unmount(); late(); await Promise.resolve();
  assert.equal(render(true), false, "unmounted load cannot publish readiness");
});
