import assert from "node:assert/strict";
import test from "node:test";
import { followBlockingCard } from "./blocking-card-scroll.ts";

function fixture(t, { height = 500, observerAvailable = true } = {}) {
  const frames = new Map(), observers = [], writes = [];
  let nextFrame = 0;
  t.mock.method(globalThis, "requestAnimationFrame", (fn) => { frames.set(++nextFrame, fn); return nextFrame; });
  t.mock.method(globalThis, "cancelAnimationFrame", (id) => frames.delete(id));
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = observerAvailable ? class {
    observed = []; disconnected = false;
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(element) { this.observed.push(element); }
    disconnect() { this.disconnected = true; }
  } : undefined;
  t.after(() => { globalThis.ResizeObserver = previousObserver; });
  const container = new EventTarget();
  Object.assign(container, {
    scrollTop: 100, clientTop: 2, clientHeight: height,
    getBoundingClientRect: () => ({ top: 50 }),
    scrollTo({ top, behavior }) { this.scrollTop = Math.max(0, top); writes.push({ top, behavior }); },
  });
  const card = {
    isConnected: true, fullscreen: false, top: 600, height: 200,
    querySelector() { return this.fullscreen ? {} : null; },
    getBoundingClientRect() { return { top: this.top - container.scrollTop, bottom: this.top + this.height - container.scrollTop, height: this.height }; },
  };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); };
  return { container, card, frames, observers, writes, flush, resize: () => observers[0].callback(),
    scroll: (top) => { container.dispatchEvent(new Event("wheel")); container.scrollTop = top; container.dispatchEvent(new Event("scroll")); },
    start: (state) => followBlockingCard(container, card, state) };
}

// Browser globals are absent in Node; install configurable placeholders for mocks.
for (const name of ["requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"]) {
  if (!(name in globalThis)) Object.defineProperty(globalThis, name, { value: () => {}, configurable: true, writable: true });
}

test("reveals actions on arrival and after delayed growth without scrolling ancestors or body", (t) => {
  const f = fixture(t), cleanup = f.start();
  assert.equal(f.writes.length, 0, "wait for committed layout");
  f.flush();
  assert.deepEqual(f.writes, [{ top: 264, behavior: "instant" }]);
  assert.deepEqual(f.observers[0].observed, [f.card, f.container]);
  f.container.dispatchEvent(new Event("scroll")); // Our own scroll is not user takeover.
  f.card.height = 400;
  f.resize(); f.resize();
  assert.equal(f.frames.size, 1, "coalesce resize notifications");
  f.flush();
  assert.equal(f.container.scrollTop, 464);
  f.resize(); f.flush();
  assert.equal(f.writes.length, 2, "visible actions need no correction");
  cleanup();
});

test("prioritizes the footer in a short viewport and responds to composer/viewport resizing", (t) => {
  const f = fixture(t, { height: 150 }), cleanup = f.start();
  f.flush();
  assert.equal(f.container.scrollTop, 614);
  f.container.clientHeight = 100;
  f.resize(); f.flush();
  assert.equal(f.container.scrollTop, 664);
  cleanup();
});

test("manual scrolling cancels queued and future corrections until a new request", (t) => {
  const f = fixture(t), cleanup = f.start();
  f.flush(); f.card.height = 400; f.resize();
  f.scroll(200); f.flush();
  f.resize(); f.flush();
  assert.equal(f.writes.length, 1);
  cleanup();
  const nextCleanup = f.start(); f.flush();
  assert.equal(f.writes.length, 2, "the next request gets its own arrival follow");
  nextCleanup();
});

test("cover/uncover retains manual takeover for the same request", (t) => {
  const f = fixture(t), state = { following: true }, cleanup = f.start(state);
  f.flush(); f.scroll(100); cleanup();
  const resumeCleanup = f.start(state);
  f.flush(); f.card.height = 400; f.resize(); f.flush();
  assert.equal(f.writes.length, 1);
  resumeCleanup();
});

test("browser range clamping during fullscreen does not cancel inline arrival follow", (t) => {
  const f = fixture(t), cleanup = f.start();
  f.flush();
  f.card.fullscreen = true; f.container.scrollTop = 0;
  f.container.dispatchEvent(new Event("scroll")); f.resize(); f.flush();
  assert.equal(f.writes.length, 1);
  f.card.fullscreen = false; f.resize(); f.flush();
  assert.equal(f.writes.length, 2);
  cleanup();
});

test("touch, scrollbar and navigation keys stop follow, but text editing does not", (t) => {
  for (const type of ["touchmove", "pointerdown", "keydown"]) {
    const f = fixture(t), cleanup = f.start(); f.flush();
    const event = new Event(type);
    if (type === "keydown") Object.defineProperty(event, "key", { value: "PageUp" });
    // EventTarget is not an HTMLElement; supply the minimal key target interface.
    f.container.closest = () => null;
    f.container.dispatchEvent(event);
    f.card.height = 400; f.resize(); f.flush();
    assert.equal(f.writes.length, 1, type);
    cleanup();
  }
  const f = fixture(t), cleanup = f.start(); f.flush();
  f.container.closest = () => ({});
  const typing = new Event("keydown"); Object.defineProperty(typing, "key", { value: "Home" });
  f.container.dispatchEvent(typing); f.card.height = 400; f.resize(); f.flush();
  assert.equal(f.writes.length, 2); cleanup();
});

test("settlement disconnects observers/listeners and cancels pending frames", (t) => {
  const f = fixture(t), cleanup = f.start();
  cleanup(); f.flush(); f.resize(); f.scroll(0);
  assert.equal(f.observers[0].disconnected, true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.writes.length, 0);
});

test("does not move hidden, detached or fullscreen cards", (t) => {
  const f = fixture(t), cleanup = f.start();
  f.card.fullscreen = true; f.flush();
  f.card.fullscreen = false; f.card.isConnected = false; f.resize(); f.flush();
  f.card.isConnected = true; f.card.height = 0; f.resize(); f.flush();
  assert.equal(f.writes.length, 0);
  cleanup();
});

test("still reveals initial actions without ResizeObserver", (t) => {
  const f = fixture(t, { observerAvailable: false }), cleanup = f.start();
  f.flush(); assert.equal(f.writes.length, 1); cleanup();
});
