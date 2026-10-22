import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { privacySidebarReady } from "../e2e/project-privacy.mjs";

// Run the actual serialized browser predicate, without a browser or real timers.
function ready({ present = true, content = true, width = 260, contentWidth = 260, scrollLeft = 0, animations = [] } = {}) {
  const sidebar = present ? {
    firstElementChild: content ? { getBoundingClientRect: () => ({ width: contentWidth }) } : null,
    getBoundingClientRect: () => ({ width }),
    getAnimations: () => animations,
    scrollLeft,
  } : null;
  return new Script(`(${privacySidebarReady.toString()})()`).runInNewContext({
    document: { querySelector(selector) {
      assert.equal(selector, ".sidebar-container.sidebar-open");
      return sidebar;
    } },
  });
}

test("Settings navigation waits for a present, fully expanded and unscrolled sidebar", () => {
  assert.equal(ready({ present: false }), false);
  assert.equal(ready({ content: false }), false);
  assert.equal(ready({ width: 0 }), false);
  assert.equal(ready({ width: 68, scrollLeft: 192 }), false, "the captured partially clipped click target is not ready");
  assert.equal(ready({ width: 259, scrollLeft: 155 }), false, "a retained horizontal scroll is not ready");
  assert.equal(ready({ width: 259, scrollLeft: 1 }), true, "allow one pixel of border/subpixel rounding");
  assert.equal(ready(), true);
});

test("Settings navigation waits for pending/running transitions, not only child visibility", () => {
  assert.equal(ready({ animations: [{ pending: true, playState: "idle" }] }), false);
  assert.equal(ready({ animations: [{ pending: false, playState: "running" }] }), false);
  assert.equal(ready({ animations: [{ pending: false, playState: "finished" }] }), true);
  assert.equal(ready({ animations: [] }), true, "reduced-motion/no-transition layouts need no artificial delay");
});
