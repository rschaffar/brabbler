import assert from "node:assert/strict";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";
import { activityLayoutChecks, activityReceiptResponse } from "./activity-layout.mjs";
import { checkActivityFamilyUsage } from "./activity-family-usage.mjs";
import { observeBrowserReads } from "./browser-read-barrier.mjs";

/** Layout/input variant, not another native lifecycle claim.
 * Completion rows are seeded in the REAL ledger by the existing callback.
 * Running/question/pause additions are explicitly read-only synthetic layout
 * observations. None of their controls is invoked while that route is present.
 */
export async function checkActivityResponsiveTail(page, width, {
  base, api, post, artifacts, selected, selectedSessionId, waitingSessionId, otherSessionId,
  subagentIds, seedSubagentCompletions,
}) {
  assert.ok(width === 700 || width === 390, "responsive inputs retain their reviewed widths");
  const mobile = width <= 640;
  const [childA, childB, workingChild] = subagentIds;
  const completed = seedSubagentCompletions();
  assert.equal(completed.size, 5, "seed the real parent and four existing children");
  const { checkWorktreeBadge, dotColor, checkActionBox, checkControlFits } = activityLayoutChecks(page, width, selected);
  const overview = page.getByRole("region", { name: "Activity", exact: true });
  const starred = page.getByRole("region", { name: "Starred", exact: true });
  const row = (id, status = "ready") => overview.locator(`.activity-item-${status}`).filter({ hasText: id });
  // Children display "in Branch root" after their reviewed parent leaves the
  // section. Match the actual session title, not that retained parent metadata.
  const parentReady = overview.locator(".activity-item-ready").filter({ has: page.getByText("Branch root", { exact: true }) });
  const syntheticRequestId = "e2e-responsive-layout-only-question";
  const syntheticPauseId = "e2e-responsive-layout-only-pause";
  const summary = "Responsive layout question (synthetic, read-only)";
  let metricsChildRunning = true;
  let geometryRegistered = false;
  let geometryDisposed = false;
  let metricsRegistered = false;
  let metricsDisposed = false;
  const interceptedReads = new WeakSet();
  const mutationPosts = [];
  const observeMutation = (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path !== "/api/activity/review" && path !== "/api/activity/pause") return;
    const body = request.postDataJSON();
    if (path === "/api/activity/pause" || ["ack", "later", "later-request"].includes(body.op)) mutationPosts.push({ path, body });
  };
  const pattern = "**/api/agent/running";
  const continueRead = (route) => {
    interceptedReads.add(route.request());
    return route.continue();
  };
  const geometryRoutes = createOwnedRoutes(async (route) => {
    interceptedReads.add(route.request());
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: {
      ...snapshot,
      runningSessionIds: [...new Set([...snapshot.runningSessionIds, workingChild, selectedSessionId])],
      attention: [...snapshot.attention, {
        sessionId: waitingSessionId, requestId: syntheticRequestId, method: "ask_user", summary, since: 1,
      }],
      pauses: [...snapshot.pauses, {
        id: syntheticPauseId, sessionId: otherSessionId, state: "paused", requestedAt: 1, pausedAt: 1,
      }],
    } });
  }, continueRead);
  // A separate owned lifetime with ONLY the original working-child addition.
  // No synthetic geometry question/pause/root-running fields enter metrics.
  const metricsRoutes = createOwnedRoutes(async (route) => {
    interceptedReads.add(route.request());
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: { ...snapshot,
      runningSessionIds: [...new Set([...snapshot.runningSessionIds, ...(metricsChildRunning ? [workingChild] : [])])],
    } });
  }, continueRead);
  const failures = [];
  page.on("request", observeMutation);
  try {
    await page.route(pattern, geometryRoutes.handler);
    geometryRegistered = true;
    for (const id of [selectedSessionId, waitingSessionId]) await post("/api/starred-sessions", { op: "set", id, starred: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: /^Activity/ }).click();
    await overview.waitFor();
    await overview.getByRole("combobox", { name: "Project" }).selectOption("");
    const working = overview.locator(".activity-item-working").filter({ hasText: "Branch root" });
    await working.waitFor({ timeout: 15000 });
    await checkWorktreeBadge(working);
    await checkActionBox(working);
    const question = overview.locator(".activity-item-needs-you").filter({ hasText: summary });
    await question.waitFor();
    await checkActionBox(question);
    assert.equal(await overview.getByText(summary).count(), 1);
    assert.match(await question.getAttribute("aria-label"), /project.*Responsive layout question/);
    assert.equal(await overview.getByRole("button", { name: "Mark Render **E2E markdown** as read", exact: true }).count(), 0,
      "layout-only question is not a readable completion");
    await row(childB).waitFor();
    await checkActionBox(row(childB));
    await row(workingChild, "working").waitFor();
    assert.equal(await row(workingChild, "working").evaluate((node) => node.classList.contains("activity-nested")), true,
      "working child remains nested in the same section as its visible working parent");
    await row(childA).waitFor();
    const needsColor = await dotColor(question);
    await page.getByRole("button", { name: "Starred", exact: true }).click();
    const starredNeeds = starred.locator(".activity-starred-item").filter({ hasText: "Render **E2E markdown**" });
    await starredNeeds.getByText("Needs you", { exact: true }).waitFor();
    assert.match(await starredNeeds.locator(".activity-item").getAttribute("aria-label"), /Needs you/);
    assert.equal(needsColor, await dotColor(starredNeeds), "synthetic layout status uses the same Needs-you CSS in both real views");
    await page.getByRole("button", { name: /^Activity/ }).click();
    const paused = overview.locator(".activity-item-paused").filter({ hasText: "Other workspace task" });
    await paused.waitFor();
    // Geometry only: NEVER click a synthetic Pause, Resume, Later-question or
    // global control. The sole native P chain owns actual control semantics.
    await checkControlFits(paused.locator("..").getByRole("button", { name: "Resume Other workspace task", exact: true }));
    for (const name of ["Pause all", "Resume all"]) await checkControlFits(overview.getByRole("button", { name, exact: true }));
    await page.screenshot({ path: join(artifacts, `activity-responsive-layout-${width}.png`) });
    assert.deepEqual(mutationPosts, [], "layout controls do not submit synthetic identities");

    // End and drain geometry before installing the independent child-only
    // metrics boundary. Its complete assertions run at all three widths.
    geometryRoutes.beginDisposal();
    await geometryRoutes.dispose((handler) => page.unroute(pattern, handler));
    geometryDisposed = true;
    await page.route(pattern, metricsRoutes.handler);
    metricsRegistered = true;
    await question.waitFor({ state: "hidden", timeout: 15000 });
    await paused.waitFor({ state: "hidden" });
    await parentReady.waitFor();
    assert.equal(await row(childB).evaluate((node) => node.classList.contains("activity-nested")), true,
      "ready child remains nested in the same section as its genuine ready parent");
    await checkActivityFamilyUsage(page, width, {
      base, api, selectedSessionId, otherSessionId, subagentIds, overview, parentReady,
      setMetricsChildRunning: (value) => { metricsChildRunning = value; },
      navigate: (url, options) => page.goto(url, options),
    });
    assert.deepEqual(mutationPosts, [], "metrics and layout never acknowledge or pause a session");

    metricsRoutes.beginDisposal();
    await metricsRoutes.dispose((handler) => page.unroute(pattern, handler));
    metricsDisposed = true;
    // Passive observation starts only AFTER both synthetic lifetimes are drained
    // and removed. No API probe, wake event or substitute application read.
    const natural = await observeBrowserReads(page, [{ pathname: "/api/agent/running" }], { natural: true });
    const naturalFailures = [];
    try {
      const genuineResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent/running"
        && response.request().method() === "GET" && !interceptedReads.has(response.request()));
      void genuineResponse.catch(() => {});
      const [reads, genuine] = await Promise.all([natural.wait(), genuineResponse]);
      assert.ok(reads.length > 0 && reads.every((read) => read.outcome === "consumed"), "the page consumes a natural genuine running body");
      assert.equal(genuine.status(), 200);
      const genuineSnapshot = await genuine.json();
      assert.ok(!genuineSnapshot.attention.some((entry) => entry.requestId === syntheticRequestId));
      assert.ok(!genuineSnapshot.pauses.some((entry) => entry.id === syntheticPauseId));
      assert.ok(!genuineSnapshot.runningSessionIds.includes(workingChild), "the synthetic running child is not native execution");
      assert.ok(genuineSnapshot.completedRuns.some((entry) => entry.sessionId === selectedSessionId && entry.at === completed.get(selectedSessionId)),
        "the actual default response contains the relevant genuine completion identity");
      // The DOM transition additionally proves application/render projection,
      // rather than treating Playwright headers/body alone as consumption.
      await row(workingChild, "working").waitFor({ state: "hidden", timeout: 15000 });
      await row(workingChild).waitFor();
      await parentReady.waitFor();
    } catch (error) { naturalFailures.push(error); }
    finally {
      try { await natural.dispose(); } catch (error) { naturalFailures.push(error); }
    }
    if (naturalFailures.length) throw new AggregateError(naturalFailures, "Natural Activity observation failed");
    await checkWorktreeBadge(parentReady);
    await checkActionBox(parentReady);
    const readyColor = await dotColor(parentReady);
    await page.getByRole("button", { name: "Starred", exact: true }).click();
    const starredParent = starred.locator(".activity-starred-item").filter({ hasText: "Branch root" });
    await starredParent.getByText("Ready to review", { exact: true }).waitFor();
    assert.match(await starredParent.locator(".activity-item").getAttribute("aria-label"), /Ready to review/);
    assert.equal(readyColor, await dotColor(starredParent), "genuine Ready uses the same CSS in both views");
    await page.getByRole("button", { name: /^Activity/ }).click();
    // Native tap on touch; native Enter on tablet. Both actions target the exact
    // genuine completion seeded above, never the layout-only question/pause.
    const at = completed.get(selectedSessionId);
    const laterReceipt = activityReceiptResponse(page, "later", selectedSessionId, at);
    void laterReceipt.catch(() => {});
    const laterButton = overview.getByRole("button", { name: "Review Branch root later", exact: true });
    if (mobile) await laterButton.tap();
    else { await laterButton.focus(); await laterButton.press("Enter"); }
    await laterReceipt;
    const parentLater = overview.locator(".activity-item-later").filter({ hasText: "Branch root" });
    await parentLater.waitFor();
    const ackReceipt = activityReceiptResponse(page, "ack", selectedSessionId, at);
    void ackReceipt.catch(() => {});
    const readButton = overview.getByRole("button", { name: "Mark Branch root as read", exact: true });
    if (mobile) await readButton.tap();
    else { await readButton.focus(); await readButton.press("Enter"); }
    await ackReceipt;
    await parentLater.waitFor({ state: "hidden" });
    assert.ok(mutationPosts.every(({ path, body }) => path === "/api/activity/review" && ["later", "ack"].includes(body.op)
      && body.entries.every((entry) => entry.sessionId === selectedSessionId && entry.at === at)),
    "responsive input sends only genuine completion receipts, never synthetic question or pause identities");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Other workspace task", { exact: true }).last().waitFor();
    await page.getByRole("button", { name: /^Activity/ }).click();
    await row(workingChild).waitFor({ timeout: 15000 });
    assert.equal(await parentReady.count(), 0, "responsive Read remains durable after real reload");
    assert.equal(await overview.locator(".activity-item-later").filter({ hasText: "Branch root" }).count(), 0);
    console.log(`PASS: ${width}px responsive Activity geometry, shared family usage and genuine completion Later/Read`);
  } catch (error) { failures.push(error); }
  finally {
    page.off("request", observeMutation);
    for (const [routes, registered, disposed] of [[geometryRoutes, geometryRegistered, geometryDisposed], [metricsRoutes, metricsRegistered, metricsDisposed]]) {
      if (registered && !disposed) {
        routes.beginDisposal();
        try { await routes.dispose((handler) => page.unroute(pattern, handler)); }
        catch (error) { failures.push(error); }
      }
    }
    // Same shared-service baseline reset as the complete chain. This API ack-all
    // is cleanup, not an assertion of individual responsive UI review coverage.
    for (const id of [selectedSessionId, waitingSessionId]) {
      try { await post("/api/starred-sessions", { op: "set", id, starred: false }); }
      catch (error) { failures.push(error); }
    }
    try {
      const finalReview = await api("/api/agent/running");
      await post("/api/activity/review", { op: "ack", entries: finalReview.completedRuns });
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Responsive Activity fixture failed");
  }
}
