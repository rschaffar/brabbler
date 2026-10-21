import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function elementBlock() {
  const start = source.indexOf("className={`chat-scroll-to-bottom");
  assert.notEqual(start, -1, "scroll-to-latest button not found");
  const buttonStart = source.lastIndexOf("<button", start);
  const buttonEnd = source.indexOf("</button>", start);
  assert.notEqual(buttonStart, -1);
  assert.notEqual(buttonEnd, -1);
  return source.slice(buttonStart, buttonEnd);
}

test("does not let a top sentinel paginate over a pending saved reading anchor", async () => {
  const start = source.indexOf("(entries) => {", source.indexOf("// IntersectionObserver on the sentinel"));
  const end = source.indexOf("\n      },\n      { root: container", start);
  assert.ok(start >= 0 && end > start);
  const callbackSource = source.slice(start, end) + "\n      }";
  const loadingOlderRef = { current: false };
  const pendingScrollRestoreRef = { current: { anchorEntryId: "saved" } };
  const prevScrollDistanceRef = { current: null };
  const calls = [];
  let sentinelTop = 0;
  const sentinel = { isConnected: true, getBoundingClientRect: () => ({ top: sentinelTop, bottom: sentinelTop + 1 }) };
  const container = { scrollHeight: 1000, scrollTop: 120, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
  const callback = new Function(
    "loadingOlderRef", "pendingScrollRestoreRef", "hasEarlierMessages", "historyCursor", "session",
    "sessionIdRef", "prevScrollDistanceRef", "captureScrollDistance", "container", "loadContext", "activeLeafId", "sentinel",
    `return (${callbackSource});`,
  )(loadingOlderRef, pendingScrollRestoreRef, true, "older", { id: "chat" }, { current: "chat" },
    prevScrollDistanceRef, (height, top) => height - top, container,
    (...args) => { calls.push(args); return Promise.resolve({ messages: [] }); }, "leaf", sentinel);

  callback([{ isIntersecting: true }]);
  assert.deepEqual(calls, []);
  assert.equal(prevScrollDistanceRef.current, null);
  assert.equal(loadingOlderRef.current, false);

  pendingScrollRestoreRef.current = null;
  sentinelTop = -100; // The queued observation predates the restored viewport.
  callback([{ isIntersecting: true }]);
  assert.deepEqual(calls, []);
  sentinelTop = 0;
  callback([{ isIntersecting: true }]);
  assert.deepEqual(calls, [["chat", "leaf", "older"]]);
  assert.equal(prevScrollDistanceRef.current, 880);
  await new Promise(setImmediate);
  assert.equal(loadingOlderRef.current, false);
  callback([{ isIntersecting: true }]); // Response resolved, prepend not anchored yet.
  assert.equal(calls.length, 1);
  assert.equal(prevScrollDistanceRef.current, 880);
});

test("anchors committed prepends within an expanded budget and waits for sliced-window reveal", () => {
  const marker = source.indexOf("// Anchor only after the prepend is rendered");
  const start = source.indexOf("useLayoutEffect(() => {", marker);
  const end = source.indexOf("\n  }, [visibleCount, messages.length, scrollContainerRef]);", start);
  assert.ok(marker >= 0 && start > marker && end > start);
  const body = source.slice(start + "useLayoutEffect(() => {".length, end);
  const previous = { current: 880 };
  const container = { scrollHeight: 2000, scrollTop: 120 };
  const anchor = new Function("prevScrollDistanceRef", "visibleCount", "messages", "scrollContainerRef", "restoreScrollTop", body);
  const invoke = (budget, count) => anchor(previous, budget, { length: count }, { current: container }, (height, distance) => height - distance);
  invoke(50, 100);
  assert.equal(previous.current, 880); assert.equal(container.scrollTop, 120);
  invoke(100, 100);
  assert.equal(previous.current, null); assert.equal(container.scrollTop, 1120);
  // Saved-position restoration intentionally leaves a budget larger than history.
  previous.current = 880; container.scrollHeight = 2500;
  invoke(200, 150);
  assert.equal(previous.current, null); assert.equal(container.scrollTop, 1620);
});

test("shows the scroll-to-latest button only when the viewport is detached from the tail", () => {
  assert.match(
    source,
    /className=\{`chat-scroll-to-bottom\$\{showScrollToBottom && !pendingScrollRestore \? " is-visible" : ""\}`\}/,
    "visibility must be a class toggle so the exit transition can play",
  );
});

test("floats the scroll-to-latest button above the composer, clear of the minimap", () => {
  const gate = source.indexOf("{!isEmptyNew && (");
  const marker = source.indexOf('className={`chat-scroll-to-bottom', gate);
  assert.notEqual(gate, -1);
  assert.notEqual(marker, -1);
  const container = source.slice(gate, marker);
  const block = elementBlock();

  assert.match(container, /position: "absolute"/);
  assert.match(container, /bottom: "100%"/);
  assert.match(container, /right: isMobile \? 0 : CHAT_MINIMAP_WIDTH/);
  assert.match(container, /justifyContent: "center"/);
  assert.match(container, /pointerEvents: "none"/);
  assert.match(cssSource, /\.chat-scroll-to-bottom\.is-visible \{[\s\S]*?pointer-events: auto;/);
  assert.match(cssSource, /\.chat-scroll-to-bottom:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.match(block, /onClick=\{\(\) => scrollToBottom\("smooth"\)\}/);
});

test("keeps the visible button faint until hover or focus", () => {
  const hidden = cssSource.slice(cssSource.indexOf(".chat-scroll-to-bottom {"));
  const visible = hidden.slice(hidden.indexOf(".chat-scroll-to-bottom.is-visible {"));
  const reveal = hidden.slice(hidden.indexOf(".chat-scroll-to-bottom.is-visible:hover"));

  assert.match(visible.slice(0, visible.indexOf("}")), /opacity: 0\.28;[\s\S]*?visibility: visible;[\s\S]*?transform: none;/);
  assert.match(reveal.slice(0, reveal.indexOf("}")), /opacity: 1;/);
  assert.match(
    cssSource,
    /\.chat-scroll-to-bottom\.is-visible:hover,\s*\.chat-scroll-to-bottom\.is-visible:focus-visible \{[\s\S]*?opacity: 1;/,
  );
});

test("fades the button in and out without motion when motion is reduced", () => {
  const hidden = cssSource.slice(cssSource.indexOf(".chat-scroll-to-bottom {"));

  assert.match(hidden.slice(0, hidden.indexOf("}")), /opacity: 0;[\s\S]*?visibility: hidden;[\s\S]*?transform: translateY\(4px\) scale\(0\.96\);/);
  assert.match(hidden.slice(0, hidden.indexOf("}")), /transition:[\s\S]*?opacity 0\.16s ease,[\s\S]*?transform 0\.16s ease,[\s\S]*?visibility 0s linear 0\.16s;/);
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.chat-scroll-to-bottom,\s*\.chat-scroll-to-bottom\.is-visible \{\s*transform: none;\s*transition:\s*opacity 0\.16s ease,/,
  );
});

test("jumps to the live tail with the shared smooth scroll helper", () => {
  const block = elementBlock();

  assert.match(block, /aria-label=\{t\("chat.scrollToLatest"\)\}/);
  assert.match(source, /scrollToBottom, scrollToMessage,/);
});

test("exposes the detached-tail flag from the session hook without a ref read", () => {
  assert.match(hookSource, /const \[showScrollToBottom, setShowScrollToBottom\] = useState\(false\)/);
  assert.match(
    hookSource,
    /const shouldShow = shouldShowScrollToLatest\(scrollTop, clientHeight, scrollHeight\);\s*setShowScrollToBottom\(\(previous\) => \(previous === shouldShow \? previous : shouldShow\)\);/,
  );
  assert.match(hookSource, /showScrollToBottom,\s*\/\/ Refs/);
});
