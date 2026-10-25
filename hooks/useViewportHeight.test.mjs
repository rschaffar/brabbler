import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { createJiti } from "jiti";
import { act, createElement } from "react";
import { composerFixture } from "../components/composer.fixture.mjs";

describe("useViewportHeight fixture ownership", () => {
  let fixtureCleanup, shouldUseVisualViewportHeight;
  // Register under this suite before setup can fail, not beside the root guard.
  after(async () => { if (fixtureCleanup) await fixtureCleanup(); });
  before(async () => {
    composerFixture({ after: cleanup => { fixtureCleanup = cleanup; } });
    // Guard the pure-rule import graph too, once for this suite's warm modules.
    const jiti = createJiti(import.meta.url, { fsCache: false });
    ({ shouldUseVisualViewportHeight } = await jiti.import("./useViewportHeight.ts"));
  });

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

test("mounted viewport follows late IME heights without restarting the bounded chain and releases all resources", async t => {
  let viewport, windowEvents, documentEvents, viewportEvents;
  const f = composerFixture(t, { timers: 'window', setup(window) {
    viewport = new window.EventTarget(); viewport.height = 844; viewport.scale = 1;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    windowEvents = f.watchEvents(window, ['resize', 'focusin', 'focusout', 'pageshow']);
    documentEvents = f.watchEvents(window.document, ['compositionstart', 'compositionupdate', 'compositionend', 'input', 'keyup']);
    viewportEvents = f.watchEvents(viewport, ['resize', 'scroll']);
  } });
  const { ViewportProbe } = await f.load();
  const view = await f.mount(createElement(ViewportProbe));
  const input = view.container.querySelector('input'), root = view.window.document.documentElement;
  const initialFrames = [...f.frames.keys()];
  assert.equal(initialFrames.length, 1, 'Strict setup/cleanup/setup leaves one actual viewport frame');
  await f.frame(); // Deliver this finite initial viewport callback, before focus.
  assert.equal(f.frames.size, 0, 'initial viewport frame completed');
  const firstTimer = [...f.timeouts.keys()][0];
  assert.deepEqual([...f.timeouts.values()].map(({ port, delay }) => ({ port, delay })), [{ port: 'window.setTimeout', delay: 48 }], 'only the admitted window policy reread is counted');
  await act(async () => input.focus());
  assert.equal(f.frames.size, 1, 'focus coalesces to one new viewport frame');
  assert.equal([...f.frames.keys()][0] === initialFrames[0], false, 'focus does not reuse the completed initial callback');
  await f.frame();
  assert.equal([...f.timeouts.keys()][0], firstTimer, 'focus does not restart the initial settling chain');
  assert.equal(f.timeouts.size, 1);
  assert.equal(f.timeouts.get(firstTimer).delay, 48, 'the first bounded reread retains its original 48ms delay');
  viewport.height = 450;
  await view.dispatch(input, new view.window.CompositionEvent('compositionupdate', { bubbles: true }));
  assert.equal(f.frames.size, 1, 'editable activity schedules one owned viewport frame');
  await f.frame();
  assert.equal([...f.timeouts.keys()][0], firstTimer, 'typing does not postpone settling');
  assert.equal(root.style.getPropertyValue('--app-viewport-height'), '450px');
  viewport.height = 280; await f.timer(firstTimer);
  assert.equal(root.style.getPropertyValue('--app-viewport-height'), '280px');
  assert.equal(root.dataset.keyboardOpen, 'true');
  await act(async () => input.blur()); await f.frame();
  assert.equal(root.style.getPropertyValue('--app-viewport-height'), '');
  assert.equal(root.dataset.keyboardOpen, undefined);
  // The existing fixed sequence ends, even with repeated composition activity.
  for (const delay of [120, 240, 420, 720]) {
    assert.equal(f.timeouts.size, 1, 'bounded settling retains one named next reread');
    const [id, timer] = [...f.timeouts][0]; assert.equal(timer.delay, delay); await f.timer(id);
  }
  assert.equal(f.timeouts.size, 0);
  await act(async () => input.focus());
  assert.equal(f.timeouts.size, 1, 'new editable activity can begin another chain');
  await view.unmount();
  assert.equal(windowEvents.size, 0); assert.equal(documentEvents.size, 0); assert.equal(viewportEvents.size, 0);
  assert.equal(f.timeouts.size, 0); assert.equal(f.frames.size, 0);
  assert.equal(root.style.getPropertyValue('--app-viewport-height'), '');
  assert.equal(root.dataset.keyboardOpen, undefined);
});

test('mounted viewport coalesces resize/scroll and corrects only unscaled page shifts', async t => {
  let viewport, pageY = 40;
  const f = composerFixture(t, { timers: 'window', setup(window) {
    viewport = new window.EventTarget(); Object.assign(viewport, { height: 450, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => pageY });
    const scrollTo = window.scrollTo;
    f.replace(window, 'scrollTo', (...args) => { scrollTo(...args); pageY = args[1]; });
  } });
  const { ViewportProbe } = await f.load(); const view = await f.mount(createElement(ViewportProbe));
  const initialFrames = [...f.frames.keys()];
  assert.equal(initialFrames.length, 1, 'one viewport setup frame survives Strict replay');
  await f.frame(); // Join only the explicitly admitted initial callback.
  assert.equal(f.frames.size, 0); assert.equal(pageY, 0, 'initial unscaled page correction updates the external geometry');
  assert.deepEqual([...f.timeouts.values()].map(({ port, delay }) => ({ port, delay })), [{ port: 'window.setTimeout', delay: 48 }]);
  await act(async () => view.container.querySelector('input').focus());
  await view.dispatch(view.window, new view.window.Event('resize'));
  await view.dispatch(viewport, new view.window.Event('scroll'));
  assert.equal(f.frames.size, 1, 'focus/window resize/viewport scroll replace one pending frame');
  assert.equal([...f.frames.keys()][0] === initialFrames[0], false);
  await f.frame();
  assert.deepEqual(f.scrolls.filter(call => call.page).map(call => call.args), [[0, 0]]);
  pageY = 40; // A new external pan keeps the original shifted+zoomed input live.
  viewport.scale = 2;
  await view.dispatch(viewport, new view.window.Event('resize')); await f.frame();
  assert.equal(f.scrolls.filter(call => call.page).length, 1);
  assert.equal(view.window.document.documentElement.dataset.keyboardOpen, undefined);
  viewport.scale = 1; viewport.height = 844;
  await view.dispatch(view.window, new view.window.Event('focusout')); await f.frame();
  assert.equal(view.window.document.documentElement.style.getPropertyValue('--app-viewport-height'), '');
});

});
