import assert from "node:assert/strict";
import test from "node:test";

import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
  THINKING_EXPANDED_EVENT,
} from "./thinking-expansion-preference.ts";

function installWindow() {
  const store = new Map();
  const listeners = new Set();
  const fakeWindow = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    addEventListener: (_type, handler) => listeners.add(handler),
    removeEventListener: (_type, handler) => listeners.delete(handler),
    dispatchEvent: (event) => {
      for (const handler of listeners) handler(event);
      return true;
    },
  };
  globalThis.window = fakeWindow;
  return { fakeWindow, listeners };
}

test("defaults to collapsed when no preference is stored", () => {
  installWindow();
  assert.equal(isThinkingExpandedByDefault(), false);
});

test("persists the preference and notifies listeners on change", () => {
  installWindow();
  let notified = 0;
  globalThis.window.addEventListener(THINKING_EXPANDED_EVENT, () => notified++);

  setThinkingExpandedByDefault(true);
  assert.equal(isThinkingExpandedByDefault(), true);
  assert.equal(notified, 1);

  setThinkingExpandedByDefault(false);
  assert.equal(isThinkingExpandedByDefault(), false);
  assert.equal(notified, 2);
});

test("blocked storage preserves the tab preference and still notifies mounted readers", () => {
  const { fakeWindow } = installWindow();
  setThinkingExpandedByDefault(false);
  Object.defineProperty(fakeWindow, "localStorage", { get() { throw new Error("Storage blocked"); } });
  let notified = 0;
  fakeWindow.addEventListener(THINKING_EXPANDED_EVENT, () => notified++);
  setThinkingExpandedByDefault(true);
  assert.equal(isThinkingExpandedByDefault(), true);
  setThinkingExpandedByDefault(false);
  assert.equal(isThinkingExpandedByDefault(), false);
  assert.equal(notified, 2);
});

test("a readable old value cannot overwrite an in-tab change after a failed write", () => {
  const { fakeWindow } = installWindow();
  setThinkingExpandedByDefault(false);
  fakeWindow.localStorage.setItem = () => { throw new Error("Quota exceeded"); };
  let observed;
  fakeWindow.addEventListener(THINKING_EXPANDED_EVENT, () => { observed = isThinkingExpandedByDefault(); });
  setThinkingExpandedByDefault(true);
  assert.equal(fakeWindow.localStorage.getItem("brabbler-thinking-expanded"), "false");
  assert.equal(observed, true);
  assert.equal(isThinkingExpandedByDefault(), true);
});

test("returns false when window is unavailable (SSR)", () => {
  const original = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(isThinkingExpandedByDefault(), false);
  } finally {
    if (original !== undefined) globalThis.window = original;
  }
});
