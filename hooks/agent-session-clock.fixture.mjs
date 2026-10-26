// A manual external clock port. It only delivers registered elapsed callbacks,
// delay promises and abort signals; it contains no session/retry/recovery policy.
import { deferred } from "../lib/testing/async.fixture.mjs";
export function policyClockFixture() {
  let now = 0, closing = false, sequence = 0;
  const intervals = [], delays = [], deadlines = [], delayWaiters = [];
  const clock = {
    interval(policy, ms, callback) {
      const entry = { policy, ms, callback, active: !closing, at: now + ms, order: ++sequence };
      intervals.push(entry);
      return () => { entry.active = false; };
    },
    modelRetryDelay(ms) {
      const gate = deferred(), entry = { ms, at: now + ms, gate, done: false, order: ++sequence };
      delays.push(entry);
      for (const waiter of delayWaiters.splice(0)) waiter.resolve(entry);
      if (closing) { entry.done = true; gate.resolve(); }
      return gate.promise;
    },
    modelSpeedDeadline(ms) { return deadline("model-speed", ms); },
    questionSetAcknowledgementDeadline(ms) { return deadline("question-set-acknowledgement", ms); },
  };
  function deadline(policy, ms) {
    const controller = new AbortController();
    deadlines.push({ policy, ms, at: now + ms, controller, done: false, order: ++sequence });
    return controller.signal;
  }
  return {
    clock, intervals, delays, deadlines,
    get now() { return now; },
    nextDelay() { const gate = deferred(); delayWaiters.push(gate); return gate.promise; },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const entries = [
          ...intervals.filter(item => item.active).map(item => ({ item, kind: "interval" })),
          ...delays.filter(item => !item.done).map(item => ({ item, kind: "delay" })),
          ...deadlines.filter(item => !item.done).map(item => ({ item, kind: "deadline" })),
        ].filter(({ item }) => item.at <= target).sort((a, b) => a.item.at - b.item.at || a.item.order - b.item.order);
        if (entries.length === 0) break;
        const { item, kind } = entries[0]; now = item.at;
        if (kind === "interval") { item.at += item.ms; item.callback(); }
        else if (kind === "delay") { item.done = true; item.gate.resolve(); }
        else { item.done = true; item.controller.abort(new DOMException(`Controlled ${item.policy} deadline`, "TimeoutError")); }
      }
      now = target;
    },
    releaseForCleanup() {
      closing = true;
      for (const item of intervals) item.active = false;
      for (const item of delays) if (!item.done) { item.done = true; item.gate.resolve(); }
      // Deadlines do not own HTTP settlement. The transport releases its own
      // body/header gates, including ignored-abort requests, separately.
    },
  };
}
