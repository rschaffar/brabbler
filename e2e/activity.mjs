import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOwnedRoutes } from "./owned-routes.mjs";

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
  const { sessions } = await api("/api/sessions?force=1");
  const selected = sessions.find((session) => session.id === selectedSessionId);
  assert.ok(selected);
  const checkWorktreeBadge = async (row) => {
    const badge = row.locator('span[title^="Worktree: "]');
    if (selected.isWorktree && selected.branch) {
      await badge.waitFor({ state: "visible" });
      assert.equal(await badge.textContent(), selected.branch);
      assert.equal(await badge.getAttribute("title"), `Worktree: ${selected.cwd}`);
      const button = row.locator("button.activity-item");
      if (await button.count()) assert.ok((await button.getAttribute("aria-label")).includes(selected.branch), "accessible row name includes the worktree branch");
      const bounds = await badge.boundingBox();
      assert.ok(bounds.width > 0 && bounds.x + bounds.width <= width, "worktree badge fits the viewport");
    } else {
      assert.equal(await badge.count(), 0, "main-checkout sessions have no worktree badge");
    }
  };
  if (process.env.E2E_ACTIVITY_ONLY === "1") {
    assert.equal(selected.isWorktree, true, "focused Activity uses a real linked checkout");
    assert.equal(selected.branch, "feature/activity-worktree");
  }
  const dotColor = (row) => row.locator(".activity-item-top .activity-dot")
    .evaluate((dot) => getComputedStyle(dot).backgroundColor);
  const checkActionBox = async (row) => {
    assert.equal(await row.locator(".activity-item-action").count(), 0, "navigation needs no visible Open/Review label");
    const layout = await row.evaluate((button) => {
      const card = button.parentElement.getBoundingClientRect();
      const box = button.parentElement.querySelector(".activity-item-actions");
      const bounds = box.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const title = button.querySelector(".activity-item-title").getBoundingClientRect();
      const controls = [...box.querySelectorAll("button")];
      return {
        compactRightBox: bounds.left >= rect.right && bounds.right <= card.right && bounds.width <= 60 && bounds.width >= 24,
        titleUsesRightEdge: Math.abs(title.right - (rect.right - parseFloat(getComputedStyle(button).paddingRight))) < 1,
        verticallyCentered: Math.abs((bounds.top + bounds.bottom) - (card.top + card.bottom)) < 1,
        stackedTargets: controls.length > 0 && controls.every((control, index) => {
          const target = control.getBoundingClientRect();
          const previous = controls[index - 1]?.getBoundingClientRect();
          return target.left >= bounds.left && target.right <= bounds.right && target.width >= 24 && target.height >= 24
            && (!previous || target.top >= previous.bottom) && getComputedStyle(control).fontSize === "11px";
        }),
      };
    });
    assert.deepEqual(layout, { compactRightBox: true, titleUsesRightEdge: true, verticallyCentered: true, stackedTargets: true },
      "small text actions stack inside one narrow box beside the session, with separate usable targets");
  };
  await checkOverviewDuringInitialRestore(page, base, selectedSessionId);
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

  // Upgrade an existing browser's stars into server storage on the next load.
  await page.evaluate((id) => localStorage.setItem("pi-web:starred-sessions", JSON.stringify([id])), otherSessionId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAsyncCondition(page, async (id) => {
    const response = await fetch("/api/starred-sessions", { cache: "no-store" });
    return (await response.json()).ids.includes(id) && localStorage.getItem("pi-web:starred-sessions") === null;
  }, otherSessionId);
  await post("/api/starred-sessions", { op: "set", id: otherSessionId, starred: false });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

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
  await page.route("**/api/agent/running", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: {
      ...snapshot, runningSessionIds: [...new Set([...snapshot.runningSessionIds, selectedSessionId])],
    } });
  });
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
  await page.unroute("**/api/agent/running");
  await starredBranch.getByText("Working", { exact: true }).waitFor({ state: "hidden", timeout: 15000 });
  assert.equal(await starredBranch.locator(".activity-dot").count(), 0, "the dot clears when the live run ends without a completion");
  await post("/api/starred-sessions", { op: "set", id: otherSessionId, starred: true });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await starredOverview.getByRole("button", { name: /Other workspace task/ }).waitFor();
  await starredOverview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
  await starredOverview.getByRole("button", { name: /Branch root/ }).waitFor();
  assert.equal(await starredOverview.getByRole("button", { name: /Other workspace task/ }).count(), 0, "project filter excludes other stars");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:starred-sessions")), null,
    "stars are stored on the server rather than in this browser");
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
  await restoredStarred.getByRole("button", { name: /Other workspace task/ }).waitFor();
  await restoredStarred.getByRole("button", { name: "Unstar session" }).click();
  await restoredStarred.getByText("No starred sessions yet.").waitFor();
  await page.getByRole("button", { name: "Close Starred" }).click();
  if (await page.getByRole("button", { name: "Show sidebar" }).count()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.locator(`[data-session-id="${selectedSessionId}"]`).locator(".activity-star").waitFor({ state: "hidden" });
  if (mobile) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });
  // Keep the waiting session starred while its real background dialog runs.
  // The Starred list must surface Needs you without moving it into Activity.
  await post("/api/starred-sessions", { op: "set", id: waitingSessionId, starred: true });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Extension commands keep the POST open until the user responds. Launch it
  // without awaiting so the browser can see and answer the background dialog.
  const prompting = post(`/api/agent/${waitingSessionId}`, { type: "prompt", message: "/e2e-ask-user single" });
  void prompting.catch(() => {}); // Observe early rejection during teardown; await below still fails.
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
  const questionDeferred = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/activity/review") || response.request().method() !== "POST") return false;
    return response.request().postDataJSON().op === "later-request";
  });
  void questionDeferred.catch(() => {});
  const deferQuestion = overview.getByRole("button", { name: "Review Render **E2E markdown** later", exact: true });
  await deferQuestion.focus();
  await deferQuestion.press("Enter");
  const questionReceipt = await questionDeferred;
  assert.equal(questionReceipt.status(), 200);
  assert.ok((await questionReceipt.json()).laterRequests.some((entry) => entry.sessionId === waitingSessionId));
  const deferredCard = overview.locator(".activity-item-later.activity-deferred-attention").filter({ hasText: "E2E browser question" });
  await deferredCard.waitFor();
  assert.equal(needsColor, await dotColor(deferredCard), "deferred questions keep their yellow Needs you dot");
  assert.match(await deferredCard.getAttribute("aria-label"), /Later.*Needs you.*E2E browser question.*Open & answer/);
  assert.equal(await overview.getByRole("button", { name: "Mark Render **E2E markdown** as read", exact: true }).count(), 0,
    "deferring a pending question never makes it readable/acknowledged");
  if (width === 1280) {
    const context = await harness.newContext(page.context().browser(), { viewport: { width, height: 900 }, locale: "en-US" }, base);
    const questionPeer = await context.newPage();
    await questionPeer.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
    await questionPeer.getByText("Active branch answer", { exact: true }).waitFor();
    await questionPeer.getByRole("button", { name: /^Activity/ }).click();
    await questionPeer.getByRole("region", { name: "Activity" }).locator(".activity-deferred-attention").filter({ hasText: "E2E browser question" }).waitFor();
    await harness.closeContext(context);
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
  await overview.getByRole("button", { name: "Mark Render **E2E markdown** as read", exact: true }).click();
  await waitingReady.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await starredNeeds.getByText("Ready to review", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await starredNeeds.locator(".activity-dot").count(), 0, "review acknowledgement clears the green dot");
  await starredNeeds.locator(".activity-star").waitFor();
  await starredNeeds.getByRole("button", { name: "Unstar session" }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const snapshot = await api("/api/agent/running");
  assert.equal(snapshot.attention.some((item) => item.sessionId === waitingSessionId), false);

  // A short background run may begin and end between polls. Its completion
  // ledger must still put the result in Ready to review, without a sound from
  // a subagent or treating old idle sessions as completed.
  await post(`/api/agent/${selectedSessionId}`, { type: "prompt", message: "/e2e-ask-user timeout" });
  const ready = overview.locator(".activity-item-ready").filter({ hasText: "Branch root" });
  await ready.waitFor({ timeout: 15000 });
  await ready.click();
  if (mobile) await page.getByRole("button", { name: "Back to Activity" }).click();
  await ready.waitFor();
  await overview.getByRole("button", { name: "Mark Branch root as read" }).click();
  await ready.waitFor({ state: "hidden" });

  await post(`/api/agent/${waitingSessionId}`, { type: "prompt", message: "/e2e-ask-user timeout" });
  const originalReady = overview.locator(".activity-item-ready").filter({ hasText: "Render **E2E markdown**" });
  await originalReady.waitFor({ timeout: 15000 });
  await post(`/api/agent/${otherSessionId}`, { type: "prompt", message: "/e2e-ask-user timeout" });
  const otherReady = overview.locator(".activity-item-ready").filter({ hasText: "Other workspace task" });
  await otherReady.waitFor({ timeout: 15000 });
  const setArchived = async (archived) => {
    const response = await page.request.patch(`${base}/api/sessions/${otherSessionId}`, { data: { archived } });
    assert.equal(response.status(), 200);
  };
  await setArchived(true);
  await waitForAsyncCondition(page, async (id) => {
    const response = await fetch("/api/sessions?force=1");
    return (await response.json()).sessions.some((session) => session.id === id && session.archived);
  }, otherSessionId);
  await otherReady.waitFor();
  await overview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
  await otherReady.waitFor({ state: "hidden" });
  await originalReady.waitFor();
  await overview.getByRole("combobox", { name: "Project" }).selectOption({ label: "other-project" });
  await otherReady.waitFor();
  await originalReady.waitFor({ state: "hidden" });
  // A separate browser context has no shared localStorage. Explicitly marking
  // this result read must still clear its queue on the server's next visible poll.
  const peerContext = width === 1280 ? await harness.newContext(page.context().browser(), { viewport: { width, height: 900 }, locale: "en-US" }, base) : null;
  const peer = peerContext ? await peerContext.newPage() : null;
  if (peer) {
    await waitForAsyncCondition(page, async (id) => {
      const response = await fetch("/api/agent/running", { cache: "no-store" });
      const state = await response.json();
      return state.completedRuns.some((entry) => entry.sessionId === id)
        && !state.reviewedRuns.some((entry) => entry.sessionId === id);
    }, otherSessionId);
    await peer.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
    assert.equal(await peer.evaluate(() => localStorage.getItem("pi-web:unread-session-ids")), null);
    await peer.getByText("Active branch answer", { exact: true }).waitFor();
    await peer.getByRole("button", { name: /^Activity/ }).click();
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-ready")
      .filter({ hasText: "Other workspace task" }).waitFor();
  }
  await otherReady.click();
  await page.waitForURL((url) => url.searchParams.get("session") === otherSessionId);
  await page.getByText("This session is archived.", { exact: false }).waitFor();
  if (mobile) await page.getByRole("button", { name: "Back to Activity" }).click();
  await otherReady.waitFor();
  const deferred = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/activity/review") || response.request().method() !== "POST") return false;
    const body = response.request().postDataJSON();
    return body.op === "later" && body.entries.some((entry) => entry.sessionId === otherSessionId);
  });
  void deferred.catch(() => {});
  // Persist the write, but lose the usable response. No HTTP/console error is
  // suppressed: malformed JSON exercises the client's response-loss catch path.
  await page.route("**/api/activity/review", async (route) => {
    const body = route.request().postDataJSON();
    if (body.op !== "later") return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.fulfill({ response, body: "{" });
  });
  // Hold the next serialized poll before clicking, so its confirmation cannot
  // clear the failure banner before the assertion observes it.
  let releasePoll;
  const pollGate = new Promise((resolve) => { releasePoll = resolve; });
  const heldPoll = page.waitForRequest("**/api/agent/running");
  void heldPoll.catch(() => {});
  await page.route("**/api/agent/running", async (route) => { await pollGate; await route.continue(); });
  const unavailable = overview.getByText("Live status unavailable. Showing the last known state.", { exact: true });
  try {
    await heldPoll;
    await overview.getByRole("button", { name: "Review Other workspace task later", exact: true }).click();
    assert.equal((await deferred).status(), 200);
    await unavailable.waitFor();
  } finally {
    releasePoll();
    await page.unroute("**/api/agent/running");
    await page.unroute("**/api/activity/review");
  }
  await unavailable.waitFor({ state: "hidden", timeout: 15000 });
  const otherLater = overview.locator(".activity-item-later").filter({ hasText: "Other workspace task" });
  await otherLater.waitFor();
  await otherReady.waitFor({ state: "hidden" });
  if (peer) {
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-later")
      .filter({ hasText: "Other workspace task" }).waitFor({ timeout: 15000 });
  }
  // Archive and Later never mask a live registry run or pending question.
  let archivedQuestion = false;
  await page.route("**/api/agent/running", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: { ...snapshot,
      runningSessionIds: [...new Set([...snapshot.runningSessionIds, otherSessionId])],
      attention: archivedQuestion ? [...snapshot.attention, { sessionId: otherSessionId, method: "ask_user", summary: "Archived question", since: 1 }] : snapshot.attention,
    } });
  });
  try {
    await overview.locator(".activity-item-working").filter({ hasText: "Other workspace task" }).waitFor({ timeout: 15000 });
    await otherLater.waitFor({ state: "hidden" });
    archivedQuestion = true;
    await overview.locator(".activity-item-needs-you").filter({ hasText: "Archived question" }).waitFor({ timeout: 15000 });
  } finally {
    await page.unroute("**/api/agent/running");
  }
  await otherLater.waitFor({ timeout: 15000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Activity/ }).click();
  await otherLater.waitFor({ timeout: 15000 });
  await overview.getByRole("combobox", { name: "Project" }).selectOption({ label: "other-project" });
  // Local disappearance is optimistic; wait for persistence before reload can
  // cancel the acknowledgement (compact/mobile have no peer poll to wait for).
  const acknowledged = page.waitForResponse((response) => {
    const request = response.request();
    if (!response.url().endsWith("/api/activity/review") || request.method() !== "POST") return false;
    const body = request.postDataJSON();
    return body.op === "ack" && body.entries.some((entry) => entry.sessionId === otherSessionId);
  });
  void acknowledged.catch(() => {});
  await overview.getByRole("button", { name: "Mark Other workspace task as read" }).click();
  const acknowledgement = await acknowledged;
  assert.equal(acknowledgement.status(), 200);
  const persisted = await acknowledgement.json();
  const completion = persisted.completedRuns.find((entry) => entry.sessionId === otherSessionId);
  assert.ok(completion && persisted.reviewedRuns.some((entry) => entry.sessionId === otherSessionId && entry.at >= completion.at));
  if (peer) {
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-later")
      .filter({ hasText: "Other workspace task" }).waitFor({ state: "hidden", timeout: 15000 });
    await harness.closeContext(peerContext);
  }
  await otherLater.waitFor({ state: "hidden" });
  assert.equal(await overview.getByRole("combobox", { name: "Project" }).evaluate((select) => select.selectedOptions[0]?.textContent), "other-project",
    "a project filter stays visibly selected after its final row is reviewed");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Other workspace task", { exact: true }).last().waitFor();
  await page.getByRole("button", { name: /^Activity/ }).click();
  const reloadedOverview = page.getByRole("region", { name: "Activity" });
  await reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Render **E2E markdown**" }).waitFor();
  assert.equal(await reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Other workspace task" }).count(), 0,
    "server-reviewed runs must not reappear after reloading this browser");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:reviewed-run-times")), null);
  await post(`/api/agent/${otherSessionId}`, { type: "prompt", message: "/e2e-ask-user timeout" });
  const newerReady = reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Other workspace task" });
  await newerReady.waitFor({ timeout: 15000 });
  assert.equal(await reloadedOverview.locator(".activity-item-later").filter({ hasText: "Other workspace task" }).count(), 0,
    "a new archived-session completion must not inherit the older Later receipt");
  await setArchived(false);
  const [childA, childB, workingChild, otherChild] = subagentIds;
  const completed = seedSubagentCompletions();
  let metricsChildRunning = true;
  await page.route("**/api/agent/running", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: { ...snapshot,
      runningSessionIds: [...new Set([...snapshot.runningSessionIds, ...(metricsChildRunning ? [workingChild] : [])])],
    } });
  });
  try {
    const row = (id, status = "ready") => reloadedOverview.locator(`.activity-item-${status}`).filter({ hasText: id });
    await reloadedOverview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
    await row(childA).waitFor({ timeout: 15000 });
    await row(childB).waitFor();
    await row(workingChild, "working").waitFor();
    const parentReady = reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Branch root" });
    await parentReady.waitFor();

    // Extend this owned Activity chain: deterministic recorded usage, but real
    // catalogue/navigation/review storage and the existing running-poll handler.
    const statsURL = `${base}/api/sessions/stats`;
    const amounts = new Map([[selectedSessionId, 100], [childA, 20], [childB, 30], [workingChild, 40]]);
    const serveStats = async (route) => {
      assert.equal(route.request().method(), "POST");
      const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body), ["ids"]);
      assert.ok(body.ids.length > 0 && body.ids.length <= 200);
      const stats = Object.fromEntries(body.ids.filter((id) => amounts.has(id)).map((id) => {
        const total = amounts.get(id);
        return [id, { tokens: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
          cost: total / 10000, toolCalls: 1, totalActiveMs: id === selectedSessionId ? 60000 : 30000 }];
      }));
      await route.fulfill({ headers: { "Cache-Control": "no-store" }, json: { stats } });
    };
    const statsRoutes = createOwnedRoutes(serveStats, serveStats);
    const reviewBeforeMetrics = await api("/api/agent/running");
    const metricReviewPosts = [];
    const observeReview = (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/activity/review") {
        const body = request.postDataJSON();
        if (body.op === "ack" && body.entries.some(({ sessionId }) => amounts.has(sessionId))) metricReviewPosts.push(body);
      }
    };
    page.on("request", observeReview);
    await page.route(statsURL, statsRoutes.handler);
    try {
      await parentReady.click();
      await page.waitForURL((url) => url.searchParams.get("session") === selectedSessionId);
      await page.getByText("Active branch answer", { exact: true }).waitFor();
      const agentsButton = page.getByRole("button", { name: "Agents · 1 running", exact: true });
      await agentsButton.waitFor({ timeout: 15000 });
      assert.equal(await agentsButton.locator("span[aria-hidden=true]").innerText(), "1");
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await agentsButton.locator("svg.animate-spin").evaluate((node) => getComputedStyle(node).animationName), "none");
      const toolbarStats = page.getByRole("button", { name: "Session info", exact: true });
      const rootToolbarTitle = await toolbarStats.getAttribute("title");
      await agentsButton.click();
      const agents = page.getByRole("region", { name: "Agents", exact: true });
      const familyUsage = agents.getByTestId("agent-family-usage");
      await familyUsage.getByText("Summed estimated active time: 2m 30s · 190 tokens · $0.02 recorded", { exact: true }).waitFor();
      assert.ok((await familyUsage.innerText()).includes("4/4 available"));
      assert.equal(await toolbarStats.getAttribute("title"), rootToolbarTitle, "family usage never replaces selected-session toolbar counters");
      const list = agents.getByRole("listbox", { name: "Agents" });
      assert.equal(await list.getByRole("option").count(), 4);
      assert.ok((await list.locator(`[data-agent-usage-id="${selectedSessionId}"]`).innerText()).includes("100 tokens"));
      assert.ok((await list.locator(`[data-agent-usage-id="${childA}"]`).innerText()).includes("20 tokens"));
      assert.equal(await list.locator("summary, details, button button").count(), 0, "breakdown controls are outside options and the listbox");
      const familyDetails = familyUsage.locator("summary");
      if (mobile) await familyDetails.tap();
      else await familyDetails.click();
      await familyUsage.locator("details p").waitFor();
      assert.ok((await familyUsage.innerText()).includes("not an invoice"));
      const selectedDetails = agents.locator("summary").filter({ hasText: "Selected agent usage breakdown" });
      await selectedDetails.focus();
      await page.keyboard.press("Enter");
      const selectedUsage = agents.getByRole("region", { name: "Selected agent usage", exact: true });
      await selectedUsage.getByText("$0.0100", { exact: true }).waitFor();
      await list.locator(`[data-agent-usage-id="${childA}"]`).click();
      await page.waitForURL((url) => url.searchParams.get("session") === childA);
      await selectedUsage.getByText("$0.0020", { exact: true }).waitFor();
      assert.ok((await familyUsage.innerText()).includes("190 tokens"), "selecting a child does not narrow the family sum");
      await list.locator(`[data-agent-usage-id="${selectedSessionId}"]`).click();
      await page.waitForURL((url) => url.searchParams.get("session") === selectedSessionId);
      await agentsButton.click();
      metricsChildRunning = false;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      const idleAgents = page.getByRole("button", { name: /^Agents · \d+ subagents$/ });
      await idleAgents.waitFor({ timeout: 15000 });
      assert.equal(await idleAgents.locator("span[aria-hidden=true]").innerText(), "3", "idle badge returns to the family child count");
      metricsChildRunning = true;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await agentsButton.waitFor({ timeout: 15000 });
      const afterMetrics = await api("/api/agent/running");
      for (const id of amounts.keys()) {
        assert.equal(afterMetrics.reviewedRuns.find((entry) => entry.sessionId === id)?.at,
          reviewBeforeMetrics.reviewedRuns.find((entry) => entry.sessionId === id)?.at, "viewing usage does not acknowledge Activity");
      }
      // Restore the original chain's selected OTHER chat before its later
      // reload/assertion; metrics navigation must not change those prerequisites.
      await page.goto(`${base}/?session=${otherSessionId}`, { waitUntil: "domcontentloaded" });
      await page.getByText("Other workspace task", { exact: true }).last().waitFor();
      await page.getByRole("button", { name: /^Activity/ }).click();
      await reloadedOverview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
      await row(workingChild, "working").waitFor();
      assert.deepEqual(metricReviewPosts, []);
    } finally {
      metricsChildRunning = true;
      page.off("request", observeReview);
      await statsRoutes.dispose((handler) => page.unroute(statsURL, handler));
      await page.emulateMedia({ reducedMotion: null });
    }

    const before = await api("/api/agent/running");
    const reviewedBefore = new Map(before.reviewedRuns.map(({ sessionId, at }) => [sessionId, at]));
    const bulkRead = reloadedOverview.getByRole("button", { name: "Mark all subagents as read", exact: true });
    await bulkRead.click();
    await row(childA).waitFor({ state: "hidden" });
    await row(childB).waitFor({ state: "hidden" });
    assert.equal(await parentReady.isVisible(), true, "bulk review leaves parent sessions unread");
    assert.equal(await row(workingChild, "working").isVisible(), true, "bulk review leaves running children alone");
    assert.equal(await bulkRead.isDisabled(), true, "only a parent remains ready in this filter");
    // Poll outside the page: an async browser predicate returns a truthy Promise
    // before its result, so it is not evidence that both acknowledgements landed.
    const deadline = Date.now() + 15000;
    let after;
    while (true) {
      after = await api("/api/agent/running");
      if ([childA, childB].every((id) => after.reviewedRuns.some((entry) =>
        entry.sessionId === id && entry.at === completed.get(id)))) break;
      assert.ok(Date.now() < deadline, "all bulk read acknowledgements must reach server storage");
      await delay(100);
    }
    for (const id of [selectedSessionId, workingChild, otherChild]) {
      assert.equal(after.reviewedRuns.find((entry) => entry.sessionId === id)?.at, reviewedBefore.get(id),
        `bulk review must not acknowledge ${id}`);
    }
    await reloadedOverview.getByRole("combobox", { name: "Project" }).selectOption({ label: "other-project" });
    await row(otherChild).waitFor();
    await page.screenshot({ path: join(artifacts, `activity-bulk-read-${width}.png`) });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Other workspace task", { exact: true }).last().waitFor();
    await page.getByRole("button", { name: /^Activity/ }).click();
    await reloadedOverview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
    await parentReady.waitFor();
    assert.equal(await row(childA).count(), 0, "reviewed children stay absent after reload");
    assert.equal(await row(childB).count(), 0, "all target children stay absent after reload");
  } finally {
    await page.unroute("**/api/agent/running");
  }
  const finalReview = await api("/api/agent/running");
  assert.ok(finalReview.reviewedRuns.some((entry) => entry.sessionId === otherSessionId));
  // Each viewport is a new browser; leave a shared clean baseline for the next
  // viewport after asserting the cross-device unread/read transitions above.
  await post("/api/activity/review", { op: "ack", entries: finalReview.completedRuns });
  console.log(`PASS: ${width}px Activity starring, background question, review, project filter and chat navigation`);
}
