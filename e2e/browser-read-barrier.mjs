import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { createOwnedRoutes } from "./owned-routes.mjs";

const matches = (url, spec) => url.pathname === spec.pathname
  && Object.entries(spec.query ?? {}).every(([key, value]) => url.searchParams.get(key) === value);

/** Passive observation of the application's own fetch/body consumption. No reads,
 * timers, visibility events or response data are synthesized for the application.
 * Two rendering frames AFTER consumption give the application's async continuation
 * and React commit an opportunity to run; callers still assert the actual UI.
 */
export async function observeBrowserReads(page, specs, { natural = false } = {}) {
  const key = `__e2eReadBarrier_${Math.random().toString(36).slice(2)}`;
  await page.evaluate(({ key, specs, natural }) => {
    const original = window.fetch;
    const state = { reads: [], interruptions: [], restore: null };
    const events = ["focus", "online", "visibilitychange", "brabbler:activity-refresh"];
    const interrupted = (event) => state.interruptions.push(event.type);
    if (natural) {
      if (document.visibilityState !== "visible") throw new Error("Natural polls require a visible document");
      for (const event of events) (event === "visibilitychange" ? document : window).addEventListener(event, interrupted);
    }
    const afterApplication = (read) => {
      requestAnimationFrame(() => requestAnimationFrame(() => { read.observed = true; }));
    };
    const wrapped = function (...args) {
      const [input, init] = args;
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const index = specs.findIndex(spec => url.pathname === spec.pathname
        && Object.entries(spec.query ?? {}).every(([key, value]) => url.searchParams.get(key) === value));
      if (index < 0 || (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "GET") {
        return Reflect.apply(original, this, args);
      }
      const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
      const read = { index, url: url.href, outcome: "pending", observed: false };
      state.reads.push(read);
      const failed = (error) => {
        read.outcome = signal?.aborted && error?.name === "AbortError" ? "cancelled" : "error";
        read.error = String(error);
        afterApplication(read);
        throw error; // Never change the application's rejection behavior.
      };
      return Reflect.apply(original, this, args).then(response => {
        const json = response.json.bind(response);
        response.json = (...bodyArgs) => json(...bodyArgs).then(body => {
          read.outcome = response.ok ? "consumed" : "error";
          if (!response.ok) read.error = `HTTP ${response.status}`;
          afterApplication(read);
          return body;
        }, failed);
        return response;
      }, failed);
    };
    window.fetch = wrapped;
    state.restore = () => {
      if (window.fetch !== wrapped) throw new Error("Browser read observer lost fetch ownership");
      window.fetch = original;
      if (natural) for (const event of events) (event === "visibilitychange" ? document : window).removeEventListener(event, interrupted);
      delete window[key];
    };
    window[key] = state;
  }, { key, specs, natural });
  return {
    async wait() {
      return waitForAsyncCondition(page, ({ key, count, natural }) => {
        const state = window[key];
        if (!state) throw new Error("Browser read observer missing");
        if (natural && (document.visibilityState !== "visible" || state.interruptions.length)) {
          throw new Error(`Natural polling interrupted: ${state.interruptions.join(",")}`);
        }
        const error = state.reads.find(read => read.outcome === "error");
        if (error) throw new Error(`Observed application read failed: ${error.url}: ${error.error}`);
        if (natural && state.reads.some(read => read.outcome === "cancelled")) throw new Error("Natural poll was cancelled");
        return Array.from({ length: count }, (_, index) => state.reads.some(read => read.index === index))
          .every(Boolean) && state.reads.every(read => read.observed) ? state.reads : false;
      }, { key, count: specs.length, natural });
    },
    async dispose() { await page.evaluate(key => window[key]?.restore(), key); },
  };
}

/** Hold every matching read until the newer UI is committed. Join both route
 * callbacks and actual application consumption OR observed AbortError. A route's
 * continue/fulfill acknowledgement alone is not a completed browser read.
 */
export async function holdBrowserRead(page, spec, { json } = {}) {
  const probe = await observeBrowserReads(page, [spec]);
  let release, arrive;
  const held = new Promise(resolve => { release = resolve; });
  const arrival = new Promise(resolve => { arrive = resolve; });
  const matcher = url => matches(url, spec);
  const routes = createOwnedRoutes(async route => {
    arrive();
    await held;
    try {
      if (json === undefined) await route.continue();
      else await route.fulfill({ json });
    } catch (error) {
      // Narrow exception: the exact request must have an observed browser abort.
      // All other route errors remain owned failures, even if another read aborts.
      await probe.wait();
      if (route.request().failure()?.errorText !== "net::ERR_ABORTED") throw error;
    }
  }, route => route.continue());
  try { await page.route(matcher, routes.handler); }
  catch (error) {
    await probe.dispose();
    throw error;
  }
  let settlement;
  const settleRoutes = () => settlement ??= routes.dispose(handler => page.unroute(matcher, handler));
  return {
    async arrived() {
      let timer;
      try {
        await Promise.race([arrival, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`No held read arrived: ${spec.pathname}`)), 30_000);
        })]);
      } finally { clearTimeout(timer); }
    },
    async releaseAndObserve() {
      release();
      const reads = await probe.wait();
      await settleRoutes();
      assert.ok(reads.length && reads.every(read => ["consumed", "cancelled"].includes(read.outcome)));
      return reads;
    },
    async dispose() {
      release();
      try { await settleRoutes(); }
      finally { await probe.dispose(); }
    },
  };
}
