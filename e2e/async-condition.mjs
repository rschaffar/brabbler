import { performance } from "node:perf_hooks";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLLING_MS = 100;

/** Fixture-only clock/timer seam; the exported waiter below uses Node's clock. */
export function createAsyncConditionWaiter({
  now = () => performance.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  /**
   * Await page.evaluate's resolved value, not an async waitForFunction predicate's
   * truthy Promise. These callers use read-only probes and ignore the old handle.
   * Only a resolved falsy value is polled again; evaluation errors escape intact.
   *
   * All migrated callers use the original 30-second default. Explicit finite,
   * positive timeout and numeric polling options are supported without mutation;
   * unbounded/unsupported options fail rather than silently changing a deadline.
   */
  return async function waitForAsyncCondition(page, predicate, arg, options = {}) {
    for (const key of Object.keys(options)) {
      if (key !== "timeout" && key !== "polling") {
        throw new TypeError(`Unsupported async-condition option: ${key}`);
      }
    }
    const { timeout = DEFAULT_TIMEOUT_MS, polling = DEFAULT_POLLING_MS } = options;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError("Async-condition timeout must be finite and positive");
    }
    if (!Number.isFinite(polling) || polling <= 0) {
      throw new RangeError("Async-condition polling must be finite and positive");
    }

    // One monotonic deadline includes every evaluate and every poll delay.
    const deadline = now() + timeout;
    const timeoutError = new Error(`waitForAsyncCondition: Timeout ${timeout}ms exceeded`);
    timeoutError.name = "TimeoutError";
    const remaining = () => {
      const ms = deadline - now();
      if (ms <= 0) throw timeoutError;
      return ms;
    };

    // Timeout bounds this fixture wait, not the browser read itself. Harness
    // failure/context shutdown owns in-flight read cleanup; no cancellation or
    // background application authority is claimed here.
    while (true) {
      const budget = remaining();
      let timer;
      let value;
      // Race handlers are installed before evaluation starts, including for a
      // synchronous throw. Promise.race keeps observing any late rejection.
      const evaluation = Promise.resolve().then(() => {
        remaining();
        return page.evaluate(predicate, arg);
      });
      try {
        value = await Promise.race([
          evaluation,
          new Promise((_, reject) => {
            timer = setTimer(() => reject(timeoutError), budget);
          }),
        ]);
      } finally {
        clearTimer(timer);
      }
      // A delayed timer callback must not let a late truthy evaluation pass.
      remaining();
      if (value) return value;
      await new Promise((resolve) => setTimer(resolve, Math.min(polling, remaining())));
    }
  };
}

export const waitForAsyncCondition = createAsyncConditionWaiter();
