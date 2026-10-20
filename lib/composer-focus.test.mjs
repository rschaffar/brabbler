import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { requestFreshComposerFocus } = await createJiti(import.meta.url).import("./composer-focus.ts");

test("explicit New focus respects modal, card, control, mobile and navigation ownership", () => {
  const saved = new Map(["document", "window", "requestAnimationFrame"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const body = { closest: () => null };
  const button = { closest: () => null };
  const frames = [];
  let modals = [], mobile = false, current = true, focused = 0;
  const input = { current: { focus: () => focused++ } };
  const listeners = new Map();
  const document = {
    body, documentElement: {}, activeElement: button, querySelectorAll: () => modals,
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: (key) => listeners.delete(key),
  };
  globalThis.document = document;
  globalThis.window = { matchMedia: () => ({ matches: mobile }) };
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const request = () => requestFreshComposerFocus(input, mobile, () => current);
  const flush = () => { for (const fn of frames.splice(0)) fn(); };
  try {
    request(); flush();
    assert.equal(focused, 1, "the New trigger may hand focus to the fresh composer");
    request(); document.activeElement = body; flush();
    assert.equal(focused, 2, "an unmounted trigger/composer may fall back to the page");
    for (const event of ["keydown", "pointerdown"]) {
      request(); listeners.get(event)(); flush();
      assert.equal(focused, 2, "subsequent user interaction consumes the request");
      assert.equal(listeners.size, 0);
    }
    document.activeElement = button;
    request(); document.activeElement = { closest: () => null }; flush();
    assert.equal(focused, 2, "an intervening control wins");
    document.activeElement = button;
    request(); current = false; flush(); current = true;
    assert.equal(focused, 2, "a superseded New cannot focus a different session");
    request(); mobile = true; flush();
    request(); flush(); mobile = false;
    assert.equal(focused, 2, "mobile and desktop-to-mobile transitions do not summon a keyboard");
    modals = [{ getClientRects: () => [{}] }];
    request(); assert.equal(frames.length, 0);
    modals = [];
    request(); modals = [{ getClientRects: () => [{}] }]; flush();
    assert.equal(focused, 2, "a modal opening after New also wins");
    modals = [{ getClientRects: () => [] }];
    request(); flush();
    assert.equal(focused, 3, "hidden modal bodies are not focus owners");
    modals = [];
    document.activeElement = { closest: () => ({}) };
    request(); assert.equal(frames.length, 0, "inline cards, quote/picker dialogs and inert regions keep focus");
    document.activeElement = { shadowRoot: { activeElement: button } };
    request(); flush();
    assert.equal(focused, 4, "the same shadow-root control may hand focus over");
    request(); document.activeElement.shadowRoot.activeElement = { closest: () => null }; flush();
    assert.equal(focused, 4, "a different shadow-root control wins");
    document.activeElement = button;
    input.current = null;
    request(); flush();
    assert.equal(focused, 4, "an absent composer is not retried later");
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
