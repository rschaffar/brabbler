import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const jiti = createJiti(import.meta.url);
const { shouldUseVisualViewportHeight } = await jiti.import("./useViewportHeight.ts");

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), false);
});

test("does not mistake pinch zoom for an open keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 422,
    viewportScale: 2,
  }), false);
});

test("keeps the dynamic viewport height when the visual viewport is not reduced", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("zoom-aware keyboard detection excludes toolbar motion and handles an invalid scale", () => {
  const base = { hasFocusedEditable: true, innerHeight: 844, viewportHeight: 350, viewportScale: 1.3 };
  assert.equal(shouldUseVisualViewportHeight(base), true);
  assert.equal(shouldUseVisualViewportHeight({ ...base, viewportHeight: 806, viewportScale: 1 }), false);
  assert.equal(shouldUseVisualViewportHeight({ ...base, viewportScale: 0 }), true);
});

test("viewport settling follows late IME heights without restarting its chain and cleans up", () => {
  const listeners = new Map(), frames = new Map(), timers = new Map(), styles = new Map();
  let nextId = 0, cleanup;
  const events = (prefix) => ({
    addEventListener: (name, fn) => listeners.set(`${prefix}:${name}`, fn),
    removeEventListener: (name, fn) => { assert.equal(listeners.get(`${prefix}:${name}`), fn); listeners.delete(`${prefix}:${name}`); },
  });
  class Editable { tagName = "INPUT"; }
  const viewport = { ...events("viewport"), height: 844, scale: 1 };
  const root = { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) } };
  const document = { ...events("document"), documentElement: root, activeElement: new Editable() };
  const window = {
    ...events("window"), visualViewport: viewport, innerHeight: 844, scrollX: 0, scrollY: 0,
    requestAnimationFrame: (fn) => { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const source = readFileSync(new URL("./useViewportHeight.ts", import.meta.url), "utf8")
    .replace('import { useEffect } from "react";', "").replaceAll("export ", "");
  vm.runInNewContext(stripTypeScriptTypes(`${source}\nuseViewportHeight();`), {
    window, document, HTMLElement: Editable, useEffect: (effect) => { cleanup = effect(); },
  });
  const flush = () => { for (const [id, fn] of frames) { frames.delete(id); fn(); } };
  const step = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); };
  flush();
  const firstTimer = [...timers.keys()][0];
  viewport.height = 450; // No viewport event: WebKit's late settled value.
  listeners.get("document:compositionupdate")(); flush();
  assert.equal([...timers.keys()][0], firstTimer, "typing must not push settling into the future");
  assert.equal(styles.get("--app-viewport-height"), "450px");
  viewport.height = 280;
  step();
  assert.equal(styles.get("--app-viewport-height"), "280px");
  assert.equal(root.dataset.keyboardOpen, "true");
  document.activeElement = null;
  listeners.get("window:focusout")(); flush();
  assert.equal(styles.has("--app-viewport-height"), false);
  assert.equal(root.dataset.keyboardOpen, undefined);
  cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(frames.size, 0);
});
