import assert from "node:assert/strict";
import { checkModelKeyboard, checkFreshComposerFocus } from "./composer-keyboard-focus.mjs";

import { createOwnedRoutes } from "./owned-routes.mjs";

/** Isolated tab: never disturb the existing reading/history assertion chain. */
export async function checkUpstreamComposer(context, base, sessionId, alternateSessionId, width) {
  // This local cleanup scope exists BEFORE newPage admission. A rejected
  // newPage cannot expose an unreturned Page; that limit is not fabricated away.
  const primary = { caught: false, value: undefined };
  const events = [], modelCalls = [], observations = [], releases = [];
  const registration = { pattern: /\/api\/models(?:\?|$)/, adapter: undefined };
  const nativeCleanup = {}, cleanup = { unexpected: [], observationFailures: [], releaseResults: [], complete: false };
  let page, pageReturned = false, routes, manifestCall;
  let modelJoinCursor = 0, observationCursor = 0;
  const modelList = Array.from({ length: 12 }, (_, i) => ({ provider: i === 11 ? "relay-fixture" : "fixture", id: `model-${i}`, name: `Fixture model ${i}` }));
  /* PRIVATE_DECLARATIONS */

  const observeOriginal = (original) => {
    const entry = { original, outcome: undefined };
    // This fulfilled observation is an acknowledgement, NOT operation success.
    // The original promise and SAME rejection remain in the live local owner.
    entry.observation = original.then(
      value => { entry.outcome = { status: "fulfilled", value }; },
      reason => { entry.outcome = { status: "rejected", reason }; },
    );
    observations.push(entry.observation);
    return entry;
  };
  const phase = async (record, name, invoke) => {
    const entry = { attempted: true, start: events.length };
    record[name] = entry;
    events.push({ kind: name, entry });
    try {
      entry.original = invoke(); // Retain the actual native promise immediately.
      const value = await entry.original;
      entry.outcome = { status: "fulfilled", value };
      return value;
    } catch (reason) {
      entry.outcome = { status: "rejected", reason };
      throw reason;
    }
  };
  const resultOf = (errors, label) => ({
    present: errors.length !== 0,
    items: errors,
    value: errors.length === 1 ? errors[0] : errors.length ? new AggregateError(errors, label) : undefined,
  });
  const throwResult = (result) => { if (result.present) throw result.value; };

  const executeModel = async (route, call) => {
    let response;
    const errors = [];
    try {
      response = await phase(call.api, "fetch", () => route.fetch());
      call.response = response;
      const data = await phase(call.api, "json", () => response.json());
      await phase(call.api, "fulfill", () => route.fulfill({ response, json: {
        ...data, modelList, models: Object.fromEntries(modelList.map((m) => [`${m.provider}/${m.id}`, m.name])),
      } }));
      /* PRIVATE_AFTER_FULFILL */
    } catch (reason) { errors.push(reason); }
    if (response !== undefined) {
      try { await phase(call.api, "dispose", () => response.dispose()); }
      catch (reason) { errors.push(reason); }
    }
    // JSON/fulfill and API disposal errors coexist; finally cannot replace one.
    throwResult(resultOf(errors, "Composer model native operation and disposal failed"));
    /* PRIVATE_AFTER_MODEL_DISPOSE */
  };
  const byRoute = new Map();
  const handleModel = (route) => {
    const call = byRoute.get(route);
    /* PRIVATE_ACTUAL_ROUTE_ADMISSION */
    const original = executeModel(route, call);
    call.native = observeOriginal(original);
    return original;
  };
  const readManifest = async (call) => {
    let response, value;
    const errors = [];
    try {
      response = await phase(call.api, "get", () => page.request.get(`${base}/manifest.webmanifest`));
      call.response = response;
      value = await phase(call.api, "json", () => response.json());
    } catch (reason) { errors.push(reason); }
    if (response !== undefined) {
      try { await phase(call.api, "dispose", () => response.dispose()); }
      catch (reason) { errors.push(reason); }
    }
    throwResult(resultOf(errors, "Composer manifest native read and disposal failed"));
    return value;
  };
  const attemptCleanup = async (action) => {
    try { await action(); } catch (reason) { cleanup.unexpected.push(reason); }
  };
  const joinCaptured = async () => {
    // Repeat ONLY for observed new admissions, never as an idle/flush loop.
    while (modelJoinCursor < modelCalls.length || observationCursor < observations.length) {
      const batch = modelCalls.slice(modelJoinCursor); modelJoinCursor = modelCalls.length;
      const jobs = [];
      for (const call of batch) {
        for (const [name, original] of [["native", call.native?.original], ["owner", call.owner?.original], ["ack", call.ack]]) {
          if (original === undefined) { cleanup.unexpected.push(new Error(`Missing captured composer ${name} work`)); continue; }
          jobs.push({ call, name, original });
        }
      }
      const outcomes = await Promise.allSettled(jobs.map(job => job.original));
      outcomes.forEach((outcome, index) => { jobs[index].call[`${jobs[index].name}Joined`] = outcome; });
      const observed = observations.slice(observationCursor); observationCursor = observations.length;
      for (const outcome of await Promise.allSettled(observed)) {
        if (outcome.status === "rejected") cleanup.observationFailures.push(outcome.reason);
      }
    }
  };
  const settle = async () => {
    // Invoke ALL local releases before awaiting ANY join/removal/disposal.
    // Normal has no gates. Private release failures cannot strand their peers.
    const startedReleases = [];
    for (const release of releases) {
      try {
        release.invoked = true; release.start = events.length;
        events.push({ kind: "release", release });
        startedReleases.push(Promise.resolve(release.run()));
      } catch (reason) { startedReleases.push(Promise.reject(reason)); }
    }
    cleanup.releaseResults = await Promise.allSettled(startedReleases);
    if (routes !== undefined) {
      try { routes.beginDisposal(); cleanup.beginDisposal = { status: "fulfilled" }; }
      catch (reason) { cleanup.beginDisposal = { status: "rejected", reason }; }
    }
    // Removing Playwright's last interceptor resumes its in-flight requests.
    // First finish captured callbacks so their original fulfill cannot race that
    // native fallback. Releases above precede this join; a rejected chain remains
    // fatal and cannot skip the independent exact removal attempt below.
    await attemptCleanup(joinCaptured);
    // The unchanged OwnedRoutes disposer receives this SAME removal result.
    await attemptCleanup(async () => {
      if (!pageReturned || !registration.operation?.attempted) return;
      const original = (async () => {
        cleanup.removalAdapter = registration.adapter;
        cleanup.removalPattern = registration.pattern;
        await phase(nativeCleanup, "unroute", () => page.unroute(registration.pattern, registration.adapter));
        /* PRIVATE_AFTER_EXACT_UNROUTE */
      })();
      cleanup.unregister = observeOriginal(original);
      await cleanup.unregister.observation;
    });
    await attemptCleanup(async () => {
      if (routes === undefined) return;
      cleanup.ownerDisposeStart = events.length;
      events.push({ kind: "owner-dispose" });
      const original = routes.dispose(rawHandler => {
        cleanup.disposerRawHandler = rawHandler;
        return cleanup.unregister?.original;
      });
      cleanup.ownerDispose = observeOriginal(original);
      await cleanup.ownerDispose.observation;
    });
    await attemptCleanup(joinCaptured);
    // A manifest failure never skips its original body/disposal continuation.
    await attemptCleanup(async () => {
      if (manifestCall?.work !== undefined) {
        const [outcome] = await Promise.allSettled([manifestCall.work.original]);
        manifestCall.joined = outcome;
        await manifestCall.work.observation;
      }
    });
    await attemptCleanup(async () => {
      if (!pageReturned) return;
      cleanup.close = observeOriginal(phase(nativeCleanup, "pageClose", () => page.close()));
      await cleanup.close.observation;
    });
    // Retain callbacks actually admitted during cleanup/close, including errors.
    await attemptCleanup(joinCaptured);
    cleanup.complete = true;
  };

  try {
    page = await phase(nativeCleanup, "newPage", () => context.newPage());
    pageReturned = true;
    // Closing uses the SAME full native handler, not an unowned continue/catch.
    routes = createOwnedRoutes(handleModel, handleModel);
    const adapter = (route) => {
      const call = { route, api: {} };
      modelCalls.push(call); byRoute.set(route, call);
      const original = routes.handler(route);
      call.owner = observeOriginal(original);
      call.ack = call.owner.observation;
      return call.ack; // Dispatcher ACK, deliberately not the raw operation.
    };
    registration.adapter = adapter; // BEFORE registration can admit a callback.
    await phase(registration, "operation", () => page.route(registration.pattern, adapter));
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
    manifestCall = { api: {} };
    manifestCall.work = observeOriginal(readManifest(manifestCall));
    const manifest = await manifestCall.work.original;
    assert.equal(manifest.name, "E2E Pi Desk", "installed package reads the launch environment, not the build environment");
    assert.equal(manifest.short_name, "E2E Pi Desk");
    assert.equal(manifest.id, "/");
    const input = page.locator(".chat-input-textarea");
    await input.waitFor();
    await page.locator(".model-selector.is-toolbar").getByRole("button").click();
    const filter = page.getByRole("textbox", { name: "Filter models" });
    await filter.waitFor();
    /* PRIVATE_UI_AFTER_FILTER */
    assert.equal(await filter.evaluate((node) => document.activeElement === node), width > 640, "desktop autofocus only");
    await filter.fill(" RELAY-FIXTURE/model-11 ");
    const listbox = page.getByRole("listbox");
    await listbox.getByRole("option", { name: "Fixture model 11", exact: true }).waitFor();
    await checkModelKeyboard(page, width);
    // Toggle the fixed picker closed: it can cover the textarea's click point.
    // Never select a synthetic model or invoke a provider.
    await page.locator(".model-selector.is-toolbar").getByRole("button").click();
    await filter.waitFor({ state: "hidden" });
    const newline = width <= 640 ? "Enter" : "Shift+Enter";
    await input.fill("1. undo fixture");
    await input.press("End");
    await input.press(newline);
    assert.equal(await input.inputValue(), "1. undo fixture\n2. ");
    await input.press("Control+z");
    assert.equal(await input.inputValue(), "1. undo fixture", "list insertion remains a native undo unit");
    await input.press("Control+Shift+z");
    assert.equal(await input.inputValue(), "1. undo fixture\n2. ");

    await input.fill("1. select this");
    await input.evaluate((node) => node.setSelectionRange(3, 14));
    await input.press(newline);
    assert.equal(await input.inputValue(), "1. \n", "selections retain native replacement behavior");

    await input.fill("upstream-list-draft\n2. retained");
    // Drafts are deliberately memory-only: use SPA session changes, not reload.
    const selectSession = async (id) => {
      const show = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await show.isVisible()) await show.click();
      await page.locator(`.session-row[data-session-id="${id}"]`).click({ position: { x: 12, y: 12 } });
      await page.waitForFunction((id) => new URL(location.href).searchParams.get("session") === id, id);
    };
    await selectSession(alternateSessionId);
    await selectSession(sessionId);
    await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "upstream-list-draft\n2. retained");
    await input.fill("");
    await checkFreshComposerFocus(page, alternateSessionId, width);
    console.log(`PASS: ${width}px installed model filter/focus, native list undo/selection and SPA draft retention`);
  } catch (value) {
    primary.caught = true; primary.value = value; // Even throw undefined/unknown.
  } finally {
    await attemptCleanup(settle);
  }

  const errors = [];
  if (primary.caught) errors.push(primary.value);
  for (const outcome of cleanup.releaseResults) if (outcome.status === "rejected") errors.push(outcome.reason);
  for (const outcome of [cleanup.beginDisposal, cleanup.unregister?.outcome, cleanup.ownerDispose?.outcome]) {
    if (outcome?.status === "rejected") errors.push(outcome.reason);
  }
  for (const call of modelCalls) {
    // Keep each original failed chain, even when OwnedRoutes also represents
    // that SAME reason. Correlated references are not filtered or relabelled.
    for (const outcome of [call.native?.outcome, call.owner?.outcome, call.ackJoined]) {
      if (outcome?.status === "rejected") errors.push(outcome.reason);
    }
  }
  if (manifestCall?.work?.outcome?.status === "rejected") errors.push(manifestCall.work.outcome.reason);
  if (cleanup.close?.outcome?.status === "rejected") errors.push(cleanup.close.outcome.reason);
  errors.push(...cleanup.observationFailures, ...cleanup.unexpected);
  const failure = resultOf(errors, "Composer native boundary failed");
  /* PRIVATE_VERIFY_AFTER_SETTLEMENT */
  throwResult(failure);
}

export async function checkOverflowTabs(page) {
  const panel = page.locator("#file-panel");
  for (let i = 0; i < 12; i++) {
    const hide = panel.getByRole("button", { name: "Hide file panel", exact: true, includeHidden: true });
    if (await hide.getAttribute("aria-expanded") === "true") await hide.click();
    await panel.waitFor({ state: "hidden" });
    const link = page.getByRole("link", { name: `Overflow tab ${i}`, exact: true });
    await link.scrollIntoViewIfNeeded();
    // Re-present the uncovered/scrolled chat before choosing pointer coordinates.
    // This is a rendering opportunity, not a global scroll-stability guarantee.
    await link.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await link.click();
    await panel.getByRole("tab", { name: `upstream-overflow-tab-${i}.txt`, exact: true }).waitFor();
  }
  const list = panel.locator('[data-file-pane="pane-1"]').getByRole("tablist");
  assert.ok(await list.evaluate((node) => node.scrollWidth > node.clientWidth), "fixture must genuinely overflow");
  const last = list.getByRole("tab", { name: "upstream-overflow-tab-11.txt", exact: true });
  await last.scrollIntoViewIfNeeded();
  const geometry = await last.evaluate((node) => {
    const tab = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect();
    const close = node.querySelector("button").getBoundingClientRect();
    return { top: tab.top, bottom: tab.bottom, height: tab.height, listTop: list.top, listBottom: list.bottom, closeTop: close.top, closeBottom: close.bottom };
  });
  assert.ok(geometry.height > 20 && geometry.top >= geometry.listTop && geometry.bottom <= geometry.listBottom, JSON.stringify(geometry));
  assert.ok(geometry.closeTop >= geometry.listTop && geometry.closeBottom <= geometry.listBottom, "close control must not be clipped");
  await last.press("Home");
  assert.equal(await list.getByRole("tab").first().getAttribute("aria-selected"), "true");
  await list.getByRole("tab").first().press("End");
  assert.equal(await last.getAttribute("aria-selected"), "true");
  await last.getByRole("button").click();
  await last.waitFor({ state: "detached" });
  console.log(`PASS: ${page.viewportSize().width}px overflowing tab geometry, keyboard selection and close`);
}
