// Passive observation of the SAME jiti graph as the mounted hook. No constructor
// substitution, source handler replacement, readiness resolution or timer delivery.
import { nativeTimerWitness } from "./agent-session-native-timers.fixture.mjs";

export function readinessWitness() {
  const calls = [], stack = [];
  let timers, Connection;
  return {
    calls,
    get timers() { return timers; },
    get Connection() { return Connection; },
    observeProduction({ AgentEventConnection, afterSettlement }) {
      Connection = AgentEventConnection;
      timers = nativeTimerWitness({ after: afterSettlement }, () => stack.at(-1) ?? null);
      // Timer restoration is already registered. Prototype restorations are
      // independently registered BEFORE installation, including partial setup.
      for (const name of ["ensureConnected", "maintain"]) {
        const prototype = Connection.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        afterSettlement(() => Object.defineProperty(prototype, name, descriptor));
        Object.defineProperty(prototype, name, { ...descriptor, value: function (...args) {
          const call = { name, instance: this, sid: args[0], parent: stack.at(-1) ?? null };
          calls.push(call); stack.push(call);
          try {
            // Neither async nor .then-returning: forward EXACT original promise.
            const originalPromise = Reflect.apply(descriptor.value, this, args);
            call.originalPromise = originalPromise;
            // TS private fields are observed, never written. Capture the actual
            // current source/attempt, not a parallel reconstruction of open().
            call.source = this.current?.source;
            call.attempt = this.current?.attempt;
            call.optionMs = this.options.readinessTimeoutMs;
            call.settlement = originalPromise.then(
              () => { call.status = "fulfilled"; },
              error => { call.status = "rejected"; call.error = error; });
            return originalPromise;
          } finally { stack.pop(); }
        } });
      }
      // Registered last => joins run before either prototype or timer restore.
      afterSettlement(async () => {
        await Promise.allSettled(calls.flatMap(call => call.originalPromise ? [call.originalPromise] : []));
        await Promise.all(calls.flatMap(call => call.settlement ? [call.settlement] : []));
      });
    },
    async join() {
      await Promise.all(calls.flatMap(call => call.settlement ? [call.settlement] : []));
    },
  };
}
