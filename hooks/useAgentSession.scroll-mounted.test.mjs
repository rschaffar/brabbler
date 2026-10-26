import '../lib/testing/client-native-boundary.fixture.mjs';
// UNEXECUTED. Actual hook controller + real DOM scroll listener. Numeric
// geometry/scrollTo assignment double proves targeting, never browser layout.
import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture, detail } from "./agent-session-mounted.fixture.mjs";
const options = { timeout: 10000 };
const source = f => f.sources.findLast(item => item.readyState !== 2);
const message = text => ({ role: "assistant", content: [{ type: "text", text }], timestamp: 1 });
function geometry(f, { height = 1000, client = 200, top = 800 } = {}) {
  const element = f.current.scrollContainerRef.current;
  assert.equal(element === f.view.container.querySelector('[data-testid="hook-viewport"]'), true);
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, get: () => client },
  });
  element.scrollTop = top;
  return { element, height(value) { height = value; } };
}
const scroll = (f, element, top) => f.run("actual DOM scroll notification", () => {
  element.scrollTop = top;
  element.dispatchEvent(new f.view.window.Event("scroll"));
});

for (const defer of [false, true]) test(`scroll: deferInitialScroll=${defer} suppresses only the initial instant branch; attached auto and later follow retain their separate behavior`, options, async t => {
  const f = await sessionFixture(t, { viewport: true }), row = f.record(f.savedId);
  row.messages = [{ role: "user", content: "restored history", timestamp: 1 }]; row.entryIds = ["restored"];
  const history = f.hold(detail, { stage: "headers", repeat: true });
  const state = f.hold(request => request.path === `/api/sessions/${f.savedId}/state`, { stage: "headers", repeat: true });
  await f.mount({ ...f.existingOptions(), deferInitialScroll: defer });
  await history.entered.promise;
  const { element, height } = geometry(f, { top: 200 });
  assert.deepEqual(f.current.entryIds, []);
  assert.equal(f.current.initialScrollDoneRef.current, defer, "original Boolean defer flag before HTTP transcript");
  assert.deepEqual(f.scrollCalls, [], "no initial transcript means no initial tail assignment");
  assert.equal(source(f).readyState, 0, "connected/SSE publication is still withheld");
  assert.equal(f.current.streamingStore.getState().streamingMessage, null);

  await f.deliver(history, f.snapshot(f.savedId));
  await state.entered.promise;
  assert.deepEqual(f.current.entryIds, ["restored"], "actual HTTP transcript committed while live state is held");
  assert.equal(f.current.agentRunning, false);
  assert.equal(source(f).readyState, 0);
  assert.equal(f.current.streamingStore.getState().streamingMessage, null);
  // Original :599 sets initialScrollDone, not detached follow ownership. The
  // existing next branch follows attached content with auto. Witness precisely
  // that branch; never accept arbitrary calls or clear/filter initial records.
  const expectedInitial = [{ top: 1000, behavior: defer ? "auto" : "instant" }];
  assert.deepEqual(f.scrollCalls, expectedInitial, "one exact initial HTTP assignment before any live callback");
  assert.equal(element.scrollTop, 800);

  await f.deliver(state, { running: false, state: f.live(f.savedId) });
  await f.connect(source(f));
  await f.settleMaintenance(); // actual full admitted mount/readiness/receipt joins
  assert.deepEqual(f.scrollCalls, expectedInitial, "idle readiness adds no scroll");
  height(1200);
  await f.run("independent later committed follow callback", value => value.followLiveOutput());
  assert.deepEqual(f.scrollCalls, [...expectedInitial, { top: 1200, behavior: "auto" }]);
  assert.equal(element.scrollTop, 1000);
  // ChatWindow's default hidden anchor restoration/forwarding and browser
  // viewport ownership are separate required bridges, not proved by this host.
});

test("scroll: Send from a detached viewport attaches to the real content tail with instant assignment; committed follow does not mutate attachment", options, async t => {
  const f = await sessionFixture(t, { viewport: true });
  await f.mountReady(f.existingOptions());
  const { element, height } = geometry(f);
  await scroll(f, element, 800); await scroll(f, element, 400);
  assert.equal(f.current.showScrollToBottom, true);
  await f.run("detached post-commit follow refuses", value => value.followLiveOutput());
  assert.equal(f.scrollCalls.length, 0);
  await f.run("actual ordinary Send", value => {
    const sending = value.handleSend("literal new user prompt");
    value.followLiveOutput();
    assert.equal(f.scrollCalls.length, 0, "pending Send owns its instant commit; pre-commit follow is suppressed");
    return sending;
  });
  assert.deepEqual(f.scrollCalls.at(-1), { top: 1000, behavior: "instant" });
  assert.equal(element.scrollTop, 800);
  height(1200);
  await f.run("committed chunk callback follows new actual content height", value => value.followLiveOutput());
  assert.deepEqual(f.scrollCalls.at(-1), { top: 1200, behavior: "auto" });
  await scroll(f, element, 500);
  const count = f.scrollCalls.length;
  await f.run("committed chunk callback while detached", value => value.followLiveOutput());
  assert.equal(f.scrollCalls.length, count);
  await f.event(source(f), { type: "message_end", entryId: "assistant", message: message("completed") });
  await f.event(source(f), { type: "prompt_done" }); await f.settleMaintenance();
  assert.equal(f.scrollCalls.length, count, "neither transcript nor running=false forces a detached viewport");
});

test("scroll: running upward movement detaches even within 96px, downward near-tail reattaches, idle uses 8px", options, async t => {
  const f = await sessionFixture(t, { viewport: true });
  await f.mountReady(f.existingOptions());
  const { element } = geometry(f);
  await scroll(f, element, 800);
  await f.event(source(f), { type: "agent_start" });
  f.scrollCalls.length = 0;
  await scroll(f, element, 750); // upward 50px is detach, not running tolerance reattach
  await f.run("follow after upward motion", value => value.followLiveOutput());
  assert.equal(f.scrollCalls.length, 0);
  await scroll(f, element, 700); await scroll(f, element, 705); // 95px, moving downward
  assert.deepEqual(f.scrollCalls, [{ top: 1000, behavior: "auto" }]);
  await scroll(f, element, 600);
  await f.event(source(f), { type: "agent_settled" }); await f.settleMaintenance();
  const count = f.scrollCalls.length;
  await scroll(f, element, 705);
  await f.run("idle still detached at 95px", value => value.followLiveOutput());
  assert.equal(f.scrollCalls.length, count);
  await scroll(f, element, 792); // exact idle 8px boundary
  await f.run("idle tail reattached", value => value.followLiveOutput());
  assert.deepEqual(f.scrollCalls.at(-1), { top: 1000, behavior: "auto" });
});

test("scroll: one real RAF coalesces SSE events, native cancellation on user detach prevents obsolete tail assignment", options, async t => {
  const f = await sessionFixture(t, { viewport: true });
  await f.mountReady(f.existingOptions());
  const { element } = geometry(f); await scroll(f, element, 800);
  await f.event(source(f), { type: "agent_start" });
  const witness = f.watchFrames();
  await f.run("same-turn SSE burst followed by actual scroll", () => {
    source(f).message({ type: "message_start", message: message("first") });
    source(f).message({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " second" } });
    assert.equal(witness.frames.length, 1);
    element.scrollTop = 400; element.dispatchEvent(new f.view.window.Event("scroll"));
  });
  assert.equal(witness.frames[0].cancelled, true);
  assert.equal(f.scrollCalls.length, 0);
  await scroll(f, element, 800); f.scrollCalls.length = 0;
  await f.event(source(f), { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " committed" } });
  const committed = witness.frames.at(-1);
  await f.run("join actual requested native frame callback", () => committed.promise);
  assert.equal(committed.cancelled, false);
  assert.deepEqual(f.scrollCalls, [{ top: 1000, behavior: "auto" }]);
  await f.run("same-turn event and unmount-owned frame", () => source(f).message({ type: "message_start", message: message("pending at departure") }));
  const pending = witness.frames.at(-1);
  await f.unmount();
  await f.run("join cancelled native frame", () => pending.promise);
  assert.equal(pending.finished, true);
  // If the native frame already ran before unmount it is joined, not falsely
  // labelled cancelled; user-detach cancellation above is same-turn deterministic.
});

for (const offset of [16, 37]) test(`scroll: explicit message navigation offset ${offset} cancels follow and targets container-relative coordinates`, options, async t => {
  const f = await sessionFixture(t, { viewport: true });
  await f.mountReady(f.existingOptions());
  const { element } = geometry(f, { top: 200 });
  element.getBoundingClientRect = () => ({ top: 100 });
  const target = f.view.window.document.createElement("div"); target.getBoundingClientRect = () => ({ top: 460 }); element.append(target);
  await f.run("exact target navigation", value => offset === 16 ? value.scrollToMessage(target) : value.scrollToMessage(target, offset));
  assert.deepEqual(f.scrollCalls.at(-1), { top: 560 - offset, behavior: "instant" });
  const count = f.scrollCalls.length;
  await f.run("explicit target owns detached viewport", value => value.followLiveOutput());
  assert.equal(f.scrollCalls.length, count);
  assert.equal(f.current.initialScrollDoneRef.current, true);
  await f.unmount();
  const beforeNullTarget = f.scrollCalls.length;
  await f.run("null container no-op after actual ref detach", value => value.scrollToBottom("instant"));
  assert.equal(f.scrollCalls.length, beforeNullTarget);
});
