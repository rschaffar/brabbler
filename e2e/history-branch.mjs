import assert from "node:assert/strict";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";

/** Native caller bridge only; obsolete locate/generation decisions live below. */
export async function checkHistoryBranch(page, { harness, sessionId, title, artifacts, errors }) {
  const context = page.context();
  const entries = [], collectors = [], registrations = [], routeCalls = [], releases = [], cleanupCauses = [], contextReads = [];
  const pattern = `**/api/agent/${sessionId}`;
  let primary, primaryCaught = false, routeTried = false, cursor = 0;
  let unroute, disposal, nativeClose, failureCloseStarted = false;
  const closeDescriptor = Object.getOwnPropertyDescriptor(context, "close"), closeMethod = context.close;
  let closeRestored = false;
  // PRIVATE-BRANCH-DECLARATIONS
  const own = (label, invoke) => {
    const entry = { label, original: undefined, outcome: undefined, joined: false };
    entries.push(entry); // Before invocation can throw or admit another callback.
    try {
      entry.original = invoke();
      if (entry.original && typeof entry.original.then === "function") {
        entry.observation = entry.original.then(
          value => { entry.outcome = { status: "fulfilled", value }; },
          reason => { entry.outcome = { status: "rejected", reason }; },
        );
      } else entry.outcome = { status: "fulfilled", value: entry.original };
    } catch (reason) { entry.outcome = { status: "rejected", reason }; }
    return entry;
  };
  const value = async entry => {
    if (entry.outcome?.status === "rejected") throw entry.outcome.reason;
    return await entry.original;
  };
  const register = (target, event, listener) => {
    const registration = { target, event, listener, removed: false };
    registrations.push(registration);
    const addition = own(`on:${event}`, () => target.on(event, listener));
    if (addition.outcome?.status === "rejected") throw addition.outcome.reason;
  };
  const joinKnown = async () => {
    // Only witnessed registry growth; neither future-admission nor global idle.
    while (cursor < entries.length) {
      const batch = entries.slice(cursor); cursor = entries.length;
      const jobs = [];
      for (const entry of batch) {
        if (entry.observation) jobs.push({ entry, role: "original", promise: entry.original },
          { entry, role: "observation", promise: entry.observation });
      }
      const outcomes = await Promise.allSettled(jobs.map(job => job.promise));
      outcomes.forEach((outcome, index) => { jobs[index].entry[`${jobs[index].role}Joined`] = outcome; });
      for (const entry of batch) entry.joined = true;
    }
  };
  const readResponse = (label, waiter) => {
    const parsed = own(`${label}.parsed`, async () => {
      const response = await value(waiter);
      const record = { response, jsonMethod: response.json };
      record.finished = own(`${label}.finished.native`, () => response.finished());
      record.json = own(`${label}.json.native`, () => Reflect.apply(record.jsonMethod, response, []));
      record.network = own(`${label}.finished.consumer`, async () => {
        const reason = await value(record.finished);
        if (reason !== null) throw reason; // finished() may fulfill WITH an Error.
      });
      record.data = await value(record.json);
      await value(record.network);
      assert.equal(response.status(), 200, "complete original native response before status assertion");
      return record;
    });
    const complete = own(`${label}.complete`, async () => {
      const record = await value(parsed);
      if (label === "agent") assert.deepEqual(record.data, {}, "original controlled agent acknowledgement");
      else assert.equal(record.data.context.entryIds.includes("alternate"), true, "actual SDK context contains the selected branch");
      // PRIVATE-BRANCH-BODY-CONTINUATION
      return record;
    });
    return { waiter, parsed, complete };
  };
  const rawAgent = route => {
    const call = { route, native: undefined, callback: undefined, owner: undefined, ack: undefined };
    routeCalls.push(call);
    call.callback = own("route.callback.original", async () => {
      call.method = route.fulfill;
      call.native = own("route.fulfill.native", () => Reflect.apply(call.method, route, [{ json: {} }]));
      const result = await value(call.native);
      // PRIVATE-BRANCH-RAW-CONTINUATION
      return result;
    });
    return call.callback.original; // EXACT original complete callback, not another adopting wrapper.
  };
  const routes = createOwnedRoutes(rawAgent, rawAgent);
  const adapter = route => {
    const owner = own("route.owner.original", () => routes.handler(route));
    const call = routeCalls.findLast(call => call.route === route);
    if (call) call.owner = owner;
    // Acknowledgement never erases the separate callback/owner rejection.
    const ack = own("route.dispatcher.ack", async () => {
      try { return { ok: true, value: await value(owner) }; }
      catch (error) { return { ok: false, error }; }
    });
    if (call) call.ack = ack;
    return ack.original;
  };
  const removeRoute = handler => {
    assert.equal(handler, routes.handler);
    if (!routeTried) return;
    unroute ??= own("route.unroute.exact", () => page.unroute(pattern, adapter));
    if (unroute.outcome?.status === "rejected") throw unroute.outcome.reason;
    return unroute.original;
  };
  const closeFailureOwner = () => {
    if (failureCloseStarted) return;
    failureCloseStarted = true;
    own("page.close.native", () => page.close());
    own("context.close.harness", () => harness.closeContext(context));
  };
  let agent;
  try {
    register(process, "unhandledRejection", error => { collectors.push(error); });
    register(process, "uncaughtExceptionMonitor", error => { collectors.push(error); });
    register(page, "pageerror", error => { collectors.push(error); });
    register(page, "console", message => {
      try { if (message.type() === "error") collectors.push(message); }
      catch (error) { collectors.push(error); }
    });
    register(page, "response", response => {
      try {
        const url = new URL(response.url());
        if (response.status() >= 500) collectors.push(response);
        // Observe the real selected-branch response, not another obsolete-page
        // cancellation replay. The actual default owner qualifies that old work.
        if (url.pathname === `/api/sessions/${sessionId}/context` && url.searchParams.get("leafId") === "alternate") {
          contextReads.push(readResponse("context", own("context.response.original", () => response)));
        }
      } catch (error) { collectors.push(error); }
    });
    await value(own("close.observe", () => Object.defineProperty(context, "close", {
      configurable: true, writable: true,
      value: function (...args) {
        nativeClose = own("context.close.native", () => Reflect.apply(closeMethod, this, args));
        if (nativeClose.outcome?.status === "rejected") throw nativeClose.outcome.reason;
        return nativeClose.original;
      },
    })));
    routeTried = true;
    await value(own("route.register.exact", () => page.route(pattern, adapter)));
    // This is an actual owned native waiter before its trigger, not a custom
    // promise waiting for an unadmitted callback. Failure closes its owner first.
    const waiter = own("agent.response.original", () => page.waitForResponse(response => {
      if (new URL(response.url()).pathname !== `/api/agent/${sessionId}` || response.request().method() !== "POST") return false;
      const body = response.request().postDataJSON();
      return body?.type === "navigate_tree" && body.targetId === "alternate";
    }));
    agent = readResponse("agent", waiter);
    await value(own("ui.select-long", () => page.locator(`[title="${title}"]`).click()));
    await value(own("ui.branches", () => page.getByRole("button", { name: "Branches", exact: true }).click()));
    await value(own("ui.alternate", () => page.getByText("E2E alternate history branch", { exact: true }).click()));
    await value(own("ui.alternate-visible", () => page.locator("[data-entry-id='alternate']:not([data-message-role])").waitFor({ state: "visible" })));
    // PRIVATE-BRANCH-UI
    await value(agent.complete);
    assert.equal(contextReads.length > 0, true, "selected branch has an actual observed SDK context response");
    await value(own("ui.branch-screenshot", () => page.screenshot({ path: join(artifacts, "scroll-restore-branch.png") })));
  } catch (error) { primaryCaught = true; primary = error; }
  finally {
    // Start EVERY private peer release before any removal, close or join.
    for (const release of releases) own("cleanup.release", release);
    own("route.begin-disposal", () => routes.beginDisposal());
    // Start exact native removal before failure-close can invalidate its Page.
    // This handler starts fulfill synchronously (no pre-fulfill fetch/JSON gap).
    // OwnedRoutes later receives this SAME result, after its independent drain.
    try { removeRoute(routes.handler); } catch (error) { cleanupCauses.push(error); }
    // On failure native context close releases original public response/body/UI
    // operations too. On success the unchanged outer History owner closes it.
    if (primaryCaught) closeFailureOwner();
    disposal = own("route.dispose", () => routes.dispose(removeRoute));
    try { await joinKnown(); } catch (error) { cleanupCauses.push(error); }
    own("harness.errors.assert", () => assert.deepEqual(errors, [], "Native branch browser/server errors"));
    if (collectors.length || cleanupCauses.length || entries.some(entry =>
      entry.outcome?.status === "rejected" || entry.observationJoined?.status === "rejected")) {
      closeFailureOwner();
      try { await joinKnown(); } catch (error) { cleanupCauses.push(error); }
    }
    own("close.restore", () => {
      if (closeDescriptor) Object.defineProperty(context, "close", closeDescriptor);
      else delete context.close;
      closeRestored = true;
    });
    // Keep local collectors through original failure-close and exact restoration.
    for (const registration of registrations.toReversed()) own(`off:${registration.event}`, () => {
      registration.target.off(registration.event, registration.listener); registration.removed = true;
    });
    own("cleanup.restoration.assert", () => {
      assert.equal(closeRestored, true);
      assert.equal(disposal.joined, true);
      assert.deepEqual(Object.getOwnPropertyDescriptor(context, "close"), closeDescriptor);
      assert.equal(context.close === closeMethod, true);
      assert.equal(registrations.every(registration => registration.removed), true);
    });
    try { await joinKnown(); } catch (error) { cleanupCauses.push(error); }
  }
  const rejected = entries.filter(entry => entry.outcome?.status === "rejected");
  const causes = primaryCaught ? [primary] : [];
  if (rejected.length) causes.push(new AggregateError(rejected.map(entry => entry.outcome.reason), "Original native branch work"));
  const observerCauses = entries.filter(entry => entry.observationJoined?.status === "rejected").map(entry => entry.observationJoined.reason);
  causes.push(...observerCauses, ...collectors, ...cleanupCauses);
  const failure = causes.length ? new AggregateError(causes, "Native branch failed after owned settlement") : undefined;
  // PRIVATE-BRANCH-VERIFY
  if (failure) throw failure;
}
