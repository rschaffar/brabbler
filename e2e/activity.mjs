import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";
import { readBrowserJson } from "./browser-http.mjs";
import { activityLayoutChecks } from "./activity-layout.mjs";
import { checkActivityFamilyUsage } from "./activity-family-usage.mjs";
import { checkActivityResponsiveTail } from "./activity-responsive.mjs";

// Local Activity receipt port only. Register before admission; every observed
// original request owns its complete body, including UI-error and non-200 paths.
function activityReceipts(page) {
  const records = [], errors = [];
  const recordByRequest = new Map();
  const retain = error => { if (!errors.includes(error)) errors.push(error); };
  const observe = request => {
    try {
      const path = new URL(request.url()).pathname;
      if (request.method() !== "POST" || !["/api/activity/review", "/api/starred-sessions"].includes(path)) return;
      const record = { request, path }; // capture the admitted body BEFORE fallible metadata parsing
      const original = (async () => {
        const response = await request.response();
        assert.ok(response, "admitted Activity write has an original response");
        const body = await response.json();
        return { response, body };
      })();
      record.original = original;
      record.outcome = original.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
      records.push(record); recordByRequest.set(request, record);
      record.input = request.postDataJSON();
    } catch (error) { retain(error); }
  };
  page.on("request", observe);
  const join = async record => {
    const result = await record.outcome;
    if (!result.ok) { retain(result.error); throw result.error; }
    return result.value;
  };
  return {
    records,
    async action(expected, action, arrivalOptions) {
      const failures = [];
      // Existing page arrival bounds; no timer/retry/deadline change. These are
      // request/body owners, not a universal application-controller idle signal.
      const arrivals = expected.map(({ op, entry }) => page.waitForRequest(request => {
        const input = recordByRequest.get(request)?.input;
        return input?.op === op && Array.isArray(input.entries)
          && input.entries.some(item => Object.entries(entry).every(([key, value]) => item[key] === value));
      }, arrivalOptions).then(async request => ({ record: recordByRequest.get(request), ...await join(recordByRequest.get(request)) })));
      const outcomes = arrivals.map(original => original.then(value => ({ ok: true, value }), error => ({ ok: false, error })));
      try { await action(); } catch (error) { failures.push(error); }
      const results = await Promise.all(outcomes); // independent body joins even when the UI action throws
      for (const result of results) if (!result.ok) failures.push(result.error);
      // UI errors and rejected peer bodies cannot bypass independent diagnostics
      // for ANY fulfilled original. Ordering is UI, wait/body, then status/input.
      for (const [index, result] of results.entries()) {
        if (!result.ok) continue;
        try { assert.equal(result.value.response.status(), 200, "Activity receipt status after original body join"); }
        catch (error) { failures.push(error); }
        try { assert.deepEqual(result.value.record.input, { op: expected[index].op, entries: [expected[index].entry] }, "Activity receipt exact admitted input"); }
        catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, "Activity action and original receipt bodies failed");
      return results.map(result => result.value);
    },
    async finish() {
      // Keep the original observer live through every known body/descendant join.
      for (let index = 0; index < records.length; index++) {
        const result = await records[index].outcome;
        if (!result.ok) retain(result.error);
      }
      try { page.off("request", observe); } catch (error) { retain(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, "Activity receipt observer/body cleanup failed");
    },
  };
}

// Only the two existing read-only running projections use this boundary. The
// original route callback and both native/page bodies remain owned; the separate
// registered adapter acknowledges the dispatcher, never the operation result.
function activityProjection(page, project) {
  const pattern = "**/api/agent/running", errors = [], originals = [];
  const retain = error => { if (!errors.includes(error)) errors.push(error); };
  const read = async (route, projecting) => {
    const failures = [];
    const pageBody = route.request().response().then(async response => {
      assert.ok(response, "admitted running projection has an original page response");
      const body = await response.json();
      return { response, body };
    });
    const pageOutcome = pageBody.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    let response, handled = false;
    try {
      if (projecting) {
        response = await route.fetch();
        let snapshot, parsed = false;
        try { snapshot = await response.json(); parsed = true; } catch (error) { failures.push(error); }
        let json;
        if (parsed && response.status() === 200) {
          try { json = project(snapshot); } catch (error) { failures.push(error); }
        }
        await route.fulfill({ response, ...(json === undefined ? {} : { json }) });
        handled = true;
      } else { await route.continue(); handled = true; }
    } catch (error) { failures.push(error); }
    finally {
      if (!handled) {
        try { await route.abort("failed"); } catch (error) { failures.push(error); }
      }
      const result = await pageOutcome;
      if (!result.ok) failures.push(result.error);
      else { try { assert.equal(result.value.response.status(), 200); } catch (error) { failures.push(error); } }
      if (response) {
        try { assert.equal(response.status(), 200); } catch (error) { failures.push(error); }
        try { await response.dispose(); } catch (error) { failures.push(error); }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Activity running projection bodies failed");
  };
  const owned = createOwnedRoutes(route => read(route, true), route => read(route, false));
  const registered = route => {
    let original;
    try { original = owned.handler(route); }
    catch (error) {
      retain(error);
      const abort = route.abort("failed");
      originals.push(abort.then(value => ({ ok: true, value }), failure => ({ ok: false, error: failure })));
      return abort.then(() => undefined, retain);
    }
    originals.push(original.then(value => ({ ok: true, value }), error => ({ ok: false, error })));
    return original.then(() => undefined, retain); // exact registered ACK adapter; original outcome is retained above
  };
  let attempted = false, finishing;
  return {
    beginDisposal() { owned.beginDisposal(); },
    async install() { attempted = true; await page.route(pattern, registered); },
    finish() {
      return finishing ??= (async () => {
        owned.beginDisposal();
        try { await owned.dispose(() => attempted ? page.unroute(pattern, registered) : undefined); }
        catch (error) { retain(error); }
        for (let index = 0; index < originals.length; index++) {
          const result = await originals[index]; if (!result.ok) retain(result.error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, "Activity projection callback and independent cleanup failed");
      })();
    },
  };
}

/** Deliberately open Activity before catalogue-driven URL session adoption.
 * Join the exact held GETs before leaving; no provider or timeout manipulation. */
async function checkOverviewDuringInitialRestore(page, base, sessionId) {
  const gate = Promise.withResolvers();
  const pattern = /\/api\/sessions(?:\?|$)/;
  const owned = createOwnedRoutes(async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await gate.promise;
    await route.fulfill({ response });
  }, route => route.continue());
  const failures = [];
  await page.route(pattern, owned.handler);
  try {
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
    const toggle = page.getByRole("button", { name: /^Activity/ });
    await toggle.click();
    const overview = page.getByRole("region", { name: "Activity" });
    await overview.waitFor();
    gate.resolve();
    // Chat remains mounted behind the mobile overview. Adoption must complete,
    // but must not silently close the overview the user just opened.
    await page.getByText("Active branch answer", { exact: true }).waitFor({ state: "attached" });
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await overview.waitFor();
    await overview.getByRole("button", { name: "Close Activity", exact: true }).click();
  } catch (error) { failures.push(error); }
  finally {
    gate.resolve();
    owned.beginDisposal();
    try { await owned.dispose(handler => page.unroute(pattern, handler)); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Initial overview restoration fixture failed");
  }
}

export async function checkActivityOverview(page, width, { base, api, post, waitingSessionId, selectedSessionId, otherSessionId, artifacts, harness, seedInterruptedRun, subagentIds, seedSubagentCompletions }) {
  const mobile = width <= 640;
  const failures = [], projections = [], peers = [];
  const receipts = activityReceipts(page);
  let peerContext, peer, questionPending = false, questionOutcome, bulkWindow;
  try {
  const { sessions } = await api("/api/sessions?force=1");
  const selected = sessions.find((session) => session.id === selectedSessionId);
  assert.ok(selected);
  const { checkWorktreeBadge, dotColor, checkActionBox } = activityLayoutChecks(page, width, selected);
  if (process.env.E2E_ACTIVITY_ONLY === "1") {
    assert.equal(selected.isWorktree, true, "focused Activity uses a real linked checkout");
    assert.equal(selected.branch, "feature/activity-worktree");
  }
  await checkOverviewDuringInitialRestore(page, base, selectedSessionId);
  if (mobile) {
    const other = sessions.find(session => session.id === otherSessionId);
    assert.ok(other);
    const sourceRoot = selected.projectRoot ?? selected.cwd;
    const destination = other.projectRoot ?? other.cwd;
    assert.notEqual(sourceRoot, destination);
    for (const panel of ["Activity", "Starred"]) {
      await page.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
      await page.getByText("Active branch answer", { exact: true }).waitFor();
      await page.getByRole("button", { name: panel, exact: true }).click();
      const overview = page.getByRole("region", { name: panel, exact: true });
      await overview.waitFor();
      await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      await page.getByTitle(sourceRoot, { exact: true }).click();
      await page.getByTitle(destination, { exact: true }).click();
      const creation = page.waitForResponse(response => new URL(response.url()).pathname === "/api/agent/new"
        && response.request().method() === "POST");
      await page.getByRole("button", { name: "New", exact: true }).click();
      const response = await creation;
      assert.equal(response.status(), 200);
      assert.equal(response.request().postDataJSON().cwd, destination);
      const { sessionId } = await response.json();
      await page.waitForFunction(id => new URL(location.href).searchParams.get("session") === id, sessionId);
      await overview.waitFor({ state: "hidden" });
      // The backdrop stays mounted at opacity zero; visibility does not mean
      // that the drawer is open. Verify its actual interaction/state boundary.
      await page.waitForFunction(() => !document.querySelector(".sidebar-container.sidebar-open")
        && getComputedStyle(document.querySelector(".sidebar-overlay-backdrop")).pointerEvents === "none");
      const input = page.locator(".chat-input-textarea");
      await input.fill(`mobile draft from ${panel}`);
      assert.equal(await input.evaluate(node => Boolean(node.closest("[inert]"))), false);
      assert.equal((await readBrowserJson(page, "/api/sessions?force=1")).sessions.find(session => session.id === sessionId)?.cwd, destination);
      assert.deepEqual((await readBrowserJson(page, `/api/sessions/${sessionId}`)).context.messages, []);
    }
    await page.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
    console.log("PASS: mobile cross-project New leaves Activity/Starred and saves an editable empty session");
  }
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  assert.equal(await page.getByText("A previous run may have been interrupted", { exact: false }).count(), 0);
  seedInterruptedRun();
  await waitForAsyncCondition(page, async () => {
    const response = await fetch("/api/agent/running", { cache: "no-store" });
    return response.ok && Array.isArray((await response.json()).reviewedRuns);
  });
  await page.getByRole("button", { name: /^Activity/ }).click();
  const recoveryOverview = page.getByRole("region", { name: "Activity" });
  assert.equal(await recoveryOverview.locator(".activity-item-ready").count(), 0,
    "idle transcript history must not become a completed-run backlog");
  const interrupted = recoveryOverview.locator(".activity-item-interrupted").filter({ hasText: "Branch root" });
  await interrupted.waitFor();
  assert.equal(await interrupted.evaluate((button) => {
    const box = button.parentElement.querySelector(".activity-item-actions");
    return getComputedStyle(box).display === "none"
      && Math.abs(button.getBoundingClientRect().width - button.parentElement.getBoundingClientRect().width) < 1;
  }), true, "rows with no actions reserve no empty right-hand space");
  await checkWorktreeBadge(interrupted);
  await interrupted.click();
  await page.getByText("A previous run may have been interrupted", { exact: false }).waitFor();
  if (mobile) await recoveryOverview.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Dismiss" }).click();
  if (mobile) await page.getByRole("button", { name: "Back to Activity" }).click();
  await interrupted.waitFor({ state: "hidden", timeout: 15000 });
  await page.getByRole("button", { name: "Close Activity" }).click();

  // Legacy import is client policy below; retain one installed migration/default
  // storage bridge, not another storage-write/reload/server-reset at each width.
  if (width === 1280) {
    await page.evaluate((id) => localStorage.setItem("pi-web:starred-sessions", JSON.stringify([id])), otherSessionId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAsyncCondition(page, async (id) => {
      const response = await fetch("/api/starred-sessions", { cache: "no-store" });
      return (await response.json()).ids.includes(id) && localStorage.getItem("pi-web:starred-sessions") === null;
    }, otherSessionId);
    await post("/api/starred-sessions", { op: "set", id: otherSessionId, starred: false });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  }

  // Starring an idle session marks its project row and keeps it in the separate
  // Starred view across reloads. Touch rows expose actions via More.
  if (await page.getByRole("button", { name: "Show sidebar" }).count()) {
    await page.getByRole("button", { name: "Show sidebar" }).click();
  }
  const sessionRow = page.locator(`[data-session-id="${selectedSessionId}"]`);
  await sessionRow.waitFor({ state: "visible" });
  await checkWorktreeBadge(sessionRow);
  if (mobile) await sessionRow.getByRole("button", { name: "Session actions" }).click();
  else await sessionRow.hover();
  await sessionRow.getByRole("button", { name: "Star session" }).click();
  await sessionRow.getByRole("button", { name: "Unstar session" }).waitFor();
  await waitForAsyncCondition(page, async (id) => {
    const response = await fetch("/api/starred-sessions", { cache: "no-store" });
    return (await response.json()).ids.includes(id);
  }, selectedSessionId);
  if (!mobile) await page.mouse.move(width - 10, 100);
  assert.equal(await sessionRow.locator(".activity-star").isVisible(), true, "star remains visible without hovering or opening actions");
  if (mobile) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });
  await page.getByRole("button", { name: /^Activity/ }).click();
  const activityWithStar = page.getByRole("region", { name: "Activity" });
  assert.equal(await activityWithStar.getByRole("region", { name: "Starred" }).count(), 0, "Activity excludes the Starred list");
  assert.equal(await activityWithStar.locator(".activity-item-ready").count(), 0, "starring does not mark a session ready to review");
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  const starredOverview = page.getByRole("region", { name: "Starred" });
  const starredBranch = starredOverview.locator(".activity-starred-item").filter({ hasText: "Branch root" });
  await starredBranch.getByRole("button", { name: /Branch root/ }).waitFor();
  await checkWorktreeBadge(starredBranch);
  assert.equal(await starredBranch.locator(".activity-dot").count(), 0, "idle stars have no activity dot");
  // Simulate a live registry snapshot to verify that Starred tracks the same
  // visible-tab running poll as Activity, without starting a model request.
  const workingProjection = activityProjection(page, snapshot => ({
    ...snapshot, runningSessionIds: [...new Set([...snapshot.runningSessionIds, selectedSessionId])],
  }));
  projections.push(workingProjection); // capture before route registration/publication
  await workingProjection.install();
  await starredBranch.getByText("Working", { exact: true }).waitFor({ timeout: 15000 });
  assert.match(await starredBranch.locator(".activity-item").getAttribute("aria-label"), /Working/);
  const workingColor = await dotColor(starredBranch);
  await page.getByRole("button", { name: /^Activity/ }).click();
  const working = page.getByRole("region", { name: "Activity" }).locator(".activity-item-working").filter({ hasText: "Branch root" });
  await working.waitFor();
  await checkWorktreeBadge(working);
  await checkActionBox(working);
  assert.equal(workingColor, await dotColor(working), "Starred and Activity use the same working dot");
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await workingProjection.finish();
  await starredBranch.getByText("Working", { exact: true }).waitFor({ state: "hidden", timeout: 15000 });
  assert.equal(await starredBranch.locator(".activity-dot").count(), 0, "the dot clears when the live run ends without a completion");
  // Exact filter/second-star policies are mounted-owned. Only desktop repeats
  // the native durable star reload; tablet/touch keep their own controls/layout.
  if (width === 1280) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Active branch answer", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:starred-sessions")), null,
      "stars are stored on the server rather than in this browser");
  } else {
    // Unlike reload, staying in this document leaves Starred OPEN. Close it
    // explicitly before reusing the original Sidebar -> Starred input recipe.
    await page.getByRole("button", { name: "Close Starred", exact: true }).click();
  }
  if (await page.getByRole("button", { name: "Show sidebar" }).count()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.locator(`[data-session-id="${selectedSessionId}"]`).locator(".activity-star").waitFor({ state: "visible" });
  if (mobile) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  const restoredStarred = page.getByRole("region", { name: "Starred" });
  await restoredStarred.getByRole("button", { name: /Branch root/ }).waitFor();
  await checkWorktreeBadge(restoredStarred.locator(".activity-starred-item").filter({ hasText: "Branch root" }));
  await restoredStarred.getByRole("button", { name: /Branch root/ }).click();
  if (mobile) {
    await restoredStarred.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Back to Starred" }).click();
  }
  await restoredStarred.locator(".activity-starred-item").filter({ hasText: "Branch root" }).getByRole("button", { name: "Unstar session" }).click();
  await restoredStarred.getByText("No starred sessions yet.").waitFor();
  await page.getByRole("button", { name: "Close Starred" }).click();
  if (await page.getByRole("button", { name: "Show sidebar" }).count()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.locator(`[data-session-id="${selectedSessionId}"]`).locator(".activity-star").waitFor({ state: "hidden" });
  if (mobile) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });
  if (width !== 1280) {
    await checkActivityResponsiveTail(page, width, {
      base, api, post, artifacts, selected, selectedSessionId, waitingSessionId, otherSessionId,
      subagentIds, seedSubagentCompletions,
    });
    return;
  }
  // Keep the waiting session starred while its real background dialog runs.
  // The Starred list must surface Needs you without moving it into Activity.
  await post("/api/starred-sessions", { op: "set", id: waitingSessionId, starred: true });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Extension commands keep the POST open until the user responds. Launch it
  // without awaiting so the browser can see and answer the background dialog.
  const prompting = post(`/api/agent/${waitingSessionId}`, { type: "prompt", message: "/e2e-ask-user single" });
  questionPending = true;
  questionOutcome = prompting.then(value => { questionPending = false; return { ok: true, value }; }, error => { questionPending = false; return { ok: false, error }; });
  await waitForAsyncCondition(page, async (id) => {
    const response = await fetch("/api/agent/running", { cache: "no-store" });
    const snapshot = await response.json();
    return snapshot.attention.some((item) => item.sessionId === id && item.method === "ask_user");
  }, waitingSessionId);
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  const starredNeeds = page.getByRole("region", { name: "Starred" }).locator(".activity-starred-item")
    .filter({ hasText: "Render **E2E markdown**" });
  await starredNeeds.getByText("Needs you").waitFor();
  assert.match(await starredNeeds.locator(".activity-item").getAttribute("aria-label"), /Needs you/);
  const needsColor = await dotColor(starredNeeds);
  await page.getByRole("button", { name: /Activity.*1 awaiting input/ }).click();
  const overview = page.getByRole("region", { name: "Activity" });
  await overview.getByRole("heading", { name: /Needs you/ }).waitFor();
  const card = overview.locator(".activity-item-needs-you").filter({ hasText: "E2E browser question" });
  await card.waitFor();
  await checkActionBox(card);
  assert.equal(needsColor, await dotColor(card), "Starred and Activity use the same needs-you dot");
  assert.equal(await overview.getByText("E2E browser question").count(), 1);
  assert.match(await card.getAttribute("aria-label"), /project.*E2E browser question/);
  await page.screenshot({ path: join(artifacts, `activity-${width}.png`) });
  const questionIdentity = (await api("/api/agent/running")).attention.find(entry => entry.sessionId === waitingSessionId);
  assert.equal(typeof questionIdentity?.requestId, "string", "use this actual native question token");
  const deferQuestion = overview.getByRole("button", { name: "Review Render **E2E markdown** later", exact: true });
  await deferQuestion.focus();
  const [questionReceipt] = await receipts.action([{ op: "later-request", entry: { sessionId: waitingSessionId, requestId: questionIdentity.requestId } }],
    () => deferQuestion.press("Enter"));
  assert.ok(questionReceipt.body.laterRequests.some(entry => entry.sessionId === waitingSessionId && entry.requestId === questionIdentity.requestId));
  const deferredCard = overview.locator(".activity-item-later.activity-deferred-attention").filter({ hasText: "E2E browser question" });
  await deferredCard.waitFor();
  assert.equal(needsColor, await dotColor(deferredCard), "deferred questions keep their yellow Needs you dot");
  assert.match(await deferredCard.getAttribute("aria-label"), /Later.*Needs you.*E2E browser question.*Open & answer/);
  assert.equal(await overview.getByRole("button", { name: "Mark Render **E2E markdown** as read", exact: true }).count(), 0,
    "deferring a pending question never makes it readable/acknowledged");
  if (width === 1280) {
    peerContext = await harness.newContext(page.context().browser(), { viewport: { width, height: 900 }, locale: "en-US" }, base);
    const peerOwner = { context: peerContext, errors: [], harnessErrors: null, removals: [] };
    peers.push(peerOwner); // capture before even collector/newPage setup can fail
    peerOwner.harnessErrors = harness.errorsFor(peerContext); // SAME live harness ledger, not a snapshot
    const watchPage = ownedPage => {
      try {
        const watch = (name, inspect) => {
          const listener = value => {
            try { inspect(value); } catch (error) { peerOwner.errors.push(error); }
          };
          peerOwner.removals.push(() => ownedPage.off(name, listener));
          ownedPage.on(name, listener);
        };
        watch("pageerror", error => peerOwner.errors.push(error)); // original Error reference
        watch("console", message => {
          if (message.type() === "error") peerOwner.errors.push(new Error(`Activity peer console: ${message.text()}`));
        });
        watch("response", response => {
          if (new URL(response.url()).origin === new URL(base).origin && response.status() >= 500) {
            peerOwner.errors.push(new Error(`Activity peer HTTP ${response.status()} ${response.url()}`));
          }
        });
      } catch (error) { peerOwner.errors.push(error); }
    };
    peerOwner.removals.push(() => peerContext.off("page", watchPage));
    peerContext.on("page", watchPage); // before page creation/navigation; no expected-error filter
    peer = await peerContext.newPage();
    await peer.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
    assert.equal(await peer.evaluate(() => localStorage.getItem("pi-web:unread-session-ids")), null);
    await peer.getByText("Active branch answer", { exact: true }).waitFor();
    await peer.getByRole("button", { name: /^Activity/ }).click();
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-deferred-attention").filter({ hasText: "E2E browser question" }).waitFor();
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  // Finish URL-session adoption before asserting persisted Later state.
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^Activity/ }).click();
  await deferredCard.waitFor({ timeout: 15000 });
  assert.equal(needsColor, await dotColor(deferredCard), "deferred attention survives a reload without losing its yellow dot");
  await page.screenshot({ path: join(artifacts, `activity-later-question-${width}.png`) });
  await deferredCard.click();
  const question = page.getByRole("group", { name: "E2E browser question" });
  await question.waitFor();
  if (mobile) {
    await overview.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Back to Activity" }).click();
    await overview.waitFor({ state: "visible" });
    await deferredCard.click();
    await question.waitFor();
  } else {
    assert.equal(await overview.isVisible(), true, "desktop keeps the queue beside the selected chat");
  }
  await question.getByRole("radio", { name: /First/ }).click();
  await question.getByRole("button", { name: "Submit" }).click();
  await prompting;
  await page.getByText(/E2E ask_user result:/).last().waitFor();
  if (mobile) await page.getByRole("button", { name: "Back to Activity" }).click();
  await overview.locator(".activity-item-needs-you").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await starredNeeds.getByText("Needs you").waitFor({ state: "hidden" });
  await starredNeeds.getByText("Ready to review", { exact: true }).waitFor({ timeout: 15000 });
  assert.match(await starredNeeds.locator(".activity-item").getAttribute("aria-label"), /Ready to review/);
  const readyColor = await dotColor(starredNeeds);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const waitingReady = overview.locator(".activity-item-ready").filter({ hasText: "Render **E2E markdown**" });
  await waitingReady.waitFor();
  await checkActionBox(waitingReady);
  await page.screenshot({ path: join(artifacts, `activity-ready-${width}.png`) });
  assert.equal(readyColor, await dotColor(waitingReady), "Starred and Activity use the same ready-to-review dot");
  const goldenCompletion = (await api("/api/agent/running")).completedRuns.find((entry) => entry.sessionId === waitingSessionId);
  assert.ok(goldenCompletion, "the genuine answered question recorded a completion");
  await receipts.action([{ op: "ack", entry: { sessionId: waitingSessionId, at: goldenCompletion.at } }],
    () => overview.getByRole("button", { name: "Mark Render **E2E markdown** as read", exact: true }).click());
  await waitingReady.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await starredNeeds.getByText("Ready to review", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await starredNeeds.locator(".activity-dot").count(), 0, "review acknowledgement clears the green dot");
  await starredNeeds.locator(".activity-star").waitFor();
  await starredNeeds.getByRole("button", { name: "Unstar session" }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const snapshot = await api("/api/agent/running");
  assert.equal(snapshot.attention.some((item) => item.sessionId === waitingSessionId), false);

  // Preserve the original parent's OLDER reviewed generation before the later
  // seed creates its newer unread completion. Bulk must leave that actual prior
  // receipt unchanged, not weaken the native exclusion to an absent marker.
  await post(`/api/agent/${selectedSessionId}`, { type: "prompt", message: "/e2e-complete" });
  const ready = overview.locator(".activity-item-ready").filter({ hasText: "Branch root" });
  await ready.waitFor({ timeout: 15000 });
  const selectedCompletion = (await api("/api/agent/running")).completedRuns.find(entry => entry.sessionId === selectedSessionId);
  assert.ok(selectedCompletion);
  assert.equal(Number.isFinite(selectedCompletion.at), true, "actual older parent completion time");
  const [selectedAcknowledgement] = await receipts.action([{ op: "ack", entry: { sessionId: selectedSessionId, at: selectedCompletion.at } }],
    () => overview.getByRole("button", { name: "Mark Branch root as read" }).click());
  assert.equal(selectedAcknowledgement.body.reviewedRuns.find(entry => entry.sessionId === selectedSessionId)?.at,
    selectedCompletion.at, "native parent ACK body contains its actual older reviewed marker");
  await ready.waitFor({ state: "hidden" });
  // One genuine short OTHER run remains for archive/default/peer receipts. The
  // extra RICH/new-OTHER cycles and navigation-not-Read matrix are lower-owned.
  await post(`/api/agent/${otherSessionId}`, { type: "prompt", message: "/e2e-complete" });
  const otherReady = overview.locator(".activity-item-ready").filter({ hasText: "Other workspace task" });
  await otherReady.waitFor({ timeout: 15000 });
  const setArchived = async (archived) => {
    const response = await page.request.patch(`${base}/api/sessions/${otherSessionId}`, { data: { archived } });
    const failures = [];
    try { await response.body(); assert.equal(response.status(), 200); }
    catch (error) { failures.push(error); }
    finally { try { await response.dispose(); } catch (error) { failures.push(error); } }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Archive response body and independent disposal failed");
  };
  await setArchived(true);
  await waitForAsyncCondition(page, async (id) => {
    const response = await fetch("/api/sessions?force=1");
    return (await response.json()).sessions.some((session) => session.id === id && session.archived);
  }, otherSessionId);
  await otherReady.waitFor();
  // A separate browser context has no shared localStorage. Explicitly marking
  // this result read must still clear its queue on the server's next visible poll.
  // Reuse the SAME independent browser/owner admitted for the real question.
  if (peer) {
    await waitForAsyncCondition(page, async (id) => {
      const response = await fetch("/api/agent/running", { cache: "no-store" });
      const state = await response.json();
      return state.completedRuns.some((entry) => entry.sessionId === id)
        && !state.reviewedRuns.some((entry) => entry.sessionId === id);
    }, otherSessionId);
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-ready")
      .filter({ hasText: "Other workspace task" }).waitFor();
  }
  await otherReady.click();
  await page.waitForURL((url) => url.searchParams.get("session") === otherSessionId);
  await page.getByText("This session is archived.", { exact: false }).waitFor();
  if (mobile) await page.getByRole("button", { name: "Back to Activity" }).click();
  await otherReady.waitFor();
  const otherCompletion = (await api("/api/agent/running")).completedRuns.find(entry => entry.sessionId === otherSessionId);
  assert.ok(otherCompletion, "retain the exact native OTHER completion generation");
  const [deferred] = await receipts.action([{ op: "later", entry: { sessionId: otherSessionId, at: otherCompletion.at } }],
    () => overview.getByRole("button", { name: "Review Other workspace task later", exact: true }).click());
  assert.ok(deferred.body.laterRuns.some(entry => entry.sessionId === otherSessionId && entry.at === otherCompletion.at));
  const otherLater = overview.locator(".activity-item-later").filter({ hasText: "Other workspace task" });
  await otherLater.waitFor();
  await otherReady.waitFor({ state: "hidden" });
  if (peer) {
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-later")
      .filter({ hasText: "Other workspace task" }).waitFor({ timeout: 15000 });
  }
  // Archived/live/question precedence and response-loss confirmation are lower
  // policy. No second controlled priority route, unusable reply or reload here.
  await overview.getByRole("combobox", { name: "Project" }).selectOption({ label: "other-project" });
  // Local disappearance is optimistic; wait for persistence before reload can
  // cancel the acknowledgement (compact/mobile have no peer poll to wait for).
  const [acknowledgement] = await receipts.action([{ op: "ack", entry: { sessionId: otherSessionId, at: otherCompletion.at } }],
    () => overview.getByRole("button", { name: "Mark Other workspace task as read" }).click());
  const persisted = acknowledgement.body;
  const completion = persisted.completedRuns.find((entry) => entry.sessionId === otherSessionId);
  assert.ok(completion && persisted.reviewedRuns.some((entry) => entry.sessionId === otherSessionId && entry.at >= completion.at));
  if (peer) {
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-later")
      .filter({ hasText: "Other workspace task" }).waitFor({ state: "hidden", timeout: 15000 });
  }
  await otherLater.waitFor({ state: "hidden" });
  assert.equal(await overview.getByRole("combobox", { name: "Project" }).evaluate((select) => select.selectedOptions[0]?.textContent), "other-project",
    "a project filter stays visibly selected after its final row is reviewed");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Other workspace task", { exact: true }).last().waitFor();
  await page.getByRole("button", { name: /^Activity/ }).click();
  const reloadedOverview = page.getByRole("region", { name: "Activity" });
  assert.equal(await reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Other workspace task" }).count(), 0,
    "server-reviewed runs must not reappear after reloading this browser");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:reviewed-run-times")), null);
  await setArchived(false);
  const [childA, childB, workingChild, otherChild] = subagentIds;
  const completed = seedSubagentCompletions();
  let metricsChildRunning = true;
  const metricsProjection = activityProjection(page, snapshot => ({ ...snapshot,
    runningSessionIds: [...new Set([...snapshot.runningSessionIds, ...(metricsChildRunning ? [workingChild] : [])])],
  }));
  projections.push(metricsProjection);
  await metricsProjection.install();
  {
    const row = (id, status = "ready") => reloadedOverview.locator(`.activity-item-${status}`).filter({ hasText: id });
    await reloadedOverview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
    await row(childA).waitFor({ timeout: 15000 });
    await row(childB).waitFor();
    await row(workingChild, "working").waitFor();
    const parentReady = reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Branch root" });
    await parentReady.waitFor();

    await checkActivityFamilyUsage(page, width, {
      base, api, selectedSessionId, otherSessionId, subagentIds, overview: reloadedOverview, parentReady,
      setMetricsChildRunning: (value) => { metricsChildRunning = value; },
    });

    const before = await api("/api/agent/running");
    const reviewedBefore = new Map(before.reviewedRuns.map(({ sessionId, at }) => [sessionId, at]));
    const seededParentAt = completed.get(selectedSessionId);
    assert.equal(reviewedBefore.get(selectedSessionId), selectedCompletion.at, "pre-bulk actual older parent marker is present");
    assert.equal(Number.isFinite(seededParentAt), true, "actual seeded parent completion time");
    assert.equal(before.completedRuns.find(entry => entry.sessionId === selectedSessionId)?.at,
      seededParentAt, "pre-bulk native ledger contains this exact seeded parent generation");
    assert.equal(seededParentAt > selectedCompletion.at, true, "seeded parent is newer than its actual reviewed generation");
    const bulkRead = reloadedOverview.getByRole("button", { name: "Mark all subagents as read", exact: true });
    const firstBulkRecord = receipts.records.length;
    bulkWindow = { start: firstBulkRecord, entries: new Map([[childA, completed.get(childA)], [childB, completed.get(childB)]]) };
    const bulkResults = await receipts.action([
      { op: "ack", entry: { sessionId: childA, at: completed.get(childA) } },
      { op: "ack", entry: { sessionId: childB, at: completed.get(childB) } },
    ], () => bulkRead.click(), { timeout: 15000 }); // preserve the original bulk15s observation bound
    await row(childA).waitFor({ state: "hidden" });
    await row(childB).waitFor({ state: "hidden" });
    assert.equal(await parentReady.isVisible(), true, "bulk review leaves parent sessions unread");
    assert.equal(await row(workingChild, "working").isVisible(), true, "bulk review leaves running children alone");
    assert.equal(await bulkRead.isDisabled(), true, "only a parent remains ready in this filter");
    // Native B's complete durable response is the barrier, not optimistic DOM
    // disappearance, a100ms server loop or a substituted controller receipt.
    const bulkWrites = receipts.records.slice(firstBulkRecord).filter(record => record.input?.op === "ack");
    assert.equal(bulkWrites.length, 2, "both original native acknowledgements arrived");
    // Native completion ordering is not invented from childA/childB labels.
    const lastBulk = bulkResults.find(result => result.record === bulkWrites.at(-1));
    assert.ok(lastBulk);
    const after = lastBulk.body;
    for (const id of [childA, childB]) assert.ok(after.reviewedRuns.some(entry => entry.sessionId === id && entry.at === completed.get(id)));
    assert.equal(after.reviewedRuns.find(entry => entry.sessionId === selectedSessionId)?.at,
      selectedCompletion.at, "bulk preserves the concrete older parent marker, never undefined versus undefined");
    for (const id of [workingChild, otherChild]) {
      assert.equal(after.reviewedRuns.find((entry) => entry.sessionId === id)?.at, reviewedBefore.get(id),
        `bulk review must not acknowledge ${id}`); // absent working/foreign markers remain legitimate
    }
    await page.screenshot({ path: join(artifacts, `activity-bulk-read-${width}.png`) });
  }
  await metricsProjection.finish();
  const finalReview = await api("/api/agent/running");
  assert.ok(finalReview.reviewedRuns.some((entry) => entry.sessionId === otherSessionId));
  // Each viewport is a new browser; leave a shared clean baseline for the next
  // viewport after asserting the cross-device unread/read transitions above.
  await post("/api/activity/review", { op: "ack", entries: finalReview.completedRuns });
  console.log(`PASS: ${width}px Activity native star/layout, question/peer receipts, direct bulk bodies and chat navigation`);
  } catch (error) { failures.push(error); }
  finally {
    // Close each observer's own admission first. No native Acceptance/Pause job
    // is cancelled by these read-only projection owners or by React unmount.
    for (const projection of projections) {
      try { projection.beginDisposal(); } catch (error) { failures.push(error); }
    }
    if (questionPending) {
      // Only this helper's still-admitted question command may need termination
      // after UI failure; never a global/Acceptance cancellation or retry.
      try { await post(`/api/agent/${waitingSessionId}`, { type: "abort" }); }
      catch (error) { failures.push(error); }
    }
    if (questionOutcome) {
      const result = await questionOutcome;
      if (!result.ok && !failures.includes(result.error)) failures.push(result.error);
    }
    const joins = projections.map(projection => projection.finish());
    for (const result of await Promise.allSettled(joins)) if (result.status === "rejected" && !failures.includes(result.reason)) failures.push(result.reason);
    // Peer contexts are independent attempts, after native/route joins; harness
    // collectors remain live through each context's real closure.
    for (const owner of peers) {
      try { await harness.closeContext(owner.context); } catch (error) { failures.push(error); }
      // Keep local original-error and SAME harness ledgers live THROUGH close.
      // Attempt every exact removal independently; never filter peer errors.
      for (const remove of owner.removals) {
        try { remove(); } catch (error) { owner.errors.push(error); }
      }
      if (!Array.isArray(owner.harnessErrors)) owner.errors.push(new Error("Activity peer live harness ledger was not captured"));
      const peerFailures = [...owner.errors, ...(Array.isArray(owner.harnessErrors) ? owner.harnessErrors : [])];
      if (peerFailures.length) failures.push(new AggregateError(peerFailures, "Activity peer errors retained through context closure"));
    }
    try { await receipts.finish(); } catch (error) { if (!failures.includes(error)) failures.push(error); }
    if (bulkWindow) {
      try {
        const writes = receipts.records.slice(bulkWindow.start).filter(record => record.input?.op === "ack");
        assert.equal(writes.length, 2, "no additional acknowledgement through all native/route/peer/body joins");
        const seen = new Set();
        for (const { input } of writes) {
          assert.equal(input.entries.length, 1);
          const [{ sessionId, at }] = input.entries;
          assert.equal(bulkWindow.entries.has(sessionId), true, "never acknowledge parent, running or foreign identity");
          assert.equal(seen.has(sessionId), false); seen.add(sessionId);
          assert.deepEqual(input.entries, [{ sessionId, at: bulkWindow.entries.get(sessionId) }]);
          assert.equal(at, bulkWindow.entries.get(sessionId));
        }
      } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Activity native bridge and independent cleanup failed");
  }
}
