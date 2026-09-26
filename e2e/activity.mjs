import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkActivityOverview(page, width, { base, api, post, waitingSessionId, selectedSessionId, otherSessionId, artifacts, seedInterruptedRun }) {
  const mobile = width <= 640;
  await page.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Activity/ }).waitFor();
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  assert.equal(await page.getByText("A previous run may have been interrupted", { exact: false }).count(), 0);
  seedInterruptedRun();
  await page.waitForFunction(() => localStorage.getItem("pi-web:reviewed-run-times") !== null);
  await page.getByRole("button", { name: /^Activity/ }).click();
  const recoveryOverview = page.getByRole("region", { name: "Activity" });
  assert.equal(await recoveryOverview.locator(".activity-item-ready").count(), 0,
    "a new browser must not inherit prior clients' completed-run backlog");
  const interrupted = recoveryOverview.locator(".activity-item-interrupted").filter({ hasText: "Branch root" });
  await interrupted.waitFor();
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
  await page.waitForFunction(async (id) => {
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
  if (mobile) await sessionRow.getByRole("button", { name: "Session actions" }).click();
  else await sessionRow.hover();
  await sessionRow.getByRole("button", { name: "Star session" }).click();
  await sessionRow.getByRole("button", { name: "Unstar session" }).waitFor();
  await page.waitForFunction(async (id) => {
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
  await page.unroute("**/api/agent/running");
  await starredBranch.getByText("Working", { exact: true }).waitFor({ state: "hidden", timeout: 15000 });
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
  await page.waitForFunction(async (id) => {
    const response = await fetch("/api/agent/running", { cache: "no-store" });
    const snapshot = await response.json();
    return snapshot.attention.some((item) => item.sessionId === id && item.method === "ask_user");
  }, waitingSessionId);
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  const starredNeeds = page.getByRole("region", { name: "Starred" }).locator(".activity-starred-item")
    .filter({ hasText: "Render **E2E markdown**" });
  await starredNeeds.getByText("Needs you").waitFor();
  assert.match(await starredNeeds.locator(".activity-item").getAttribute("aria-label"), /Needs you/);
  await page.getByRole("button", { name: /Activity.*1 awaiting input/ }).click();
  const overview = page.getByRole("region", { name: "Activity" });
  await overview.getByRole("heading", { name: /Needs you/ }).waitFor();
  const card = overview.locator(".activity-item-needs-you").filter({ hasText: "E2E browser question" });
  await card.waitFor();
  assert.equal(await overview.getByText("E2E browser question").count(), 1);
  assert.match(await card.getAttribute("aria-label"), /project.*E2E browser question/);
  await page.screenshot({ path: join(artifacts, `activity-${width}.png`) });
  await card.click();
  const question = page.getByRole("dialog", { name: "E2E browser question" });
  await question.waitFor();
  if (mobile) {
    await overview.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Back to Activity" }).click();
    await overview.waitFor({ state: "visible" });
    await card.click();
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
  await ready.waitFor({ state: "hidden" });

  await post(`/api/agent/${waitingSessionId}`, { type: "prompt", message: "/e2e-ask-user timeout" });
  const originalReady = overview.locator(".activity-item-ready").filter({ hasText: "Render **E2E markdown**" });
  await originalReady.waitFor({ timeout: 15000 });
  await post(`/api/agent/${otherSessionId}`, { type: "prompt", message: "/e2e-ask-user timeout" });
  const otherReady = overview.locator(".activity-item-ready").filter({ hasText: "Other workspace task" });
  await otherReady.waitFor({ timeout: 15000 });
  await overview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
  await otherReady.waitFor({ state: "hidden" });
  await originalReady.waitFor();
  await overview.getByRole("combobox", { name: "Project" }).selectOption({ label: "other-project" });
  await otherReady.waitFor();
  await originalReady.waitFor({ state: "hidden" });
  // Two tabs share one browser's review state. Acknowledging in this tab must
  // clear the peer's queue without requiring a reload.
  const peer = width === 1280 ? await page.context().newPage() : null;
  if (peer) {
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem("pi-web:unread-session-ids") ?? "[]").includes(id), otherSessionId);
    await peer.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
    await peer.getByText("Active branch answer", { exact: true }).waitFor();
    await peer.getByRole("button", { name: /^Activity/ }).click();
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-ready")
      .filter({ hasText: "Other workspace task" }).waitFor();
  }
  await otherReady.click();
  if (peer) {
    await peer.getByRole("region", { name: "Activity" }).locator(".activity-item-ready")
      .filter({ hasText: "Other workspace task" }).waitFor({ state: "hidden", timeout: 15000 });
    await peer.close();
  }
  await page.waitForURL((url) => url.searchParams.get("session") === otherSessionId);
  if (mobile) await page.getByRole("button", { name: "Back to Activity" }).click();
  await otherReady.waitFor({ state: "hidden" });
  assert.equal(await overview.getByRole("combobox", { name: "Project" }).evaluate((select) => select.selectedOptions[0]?.textContent), "other-project",
    "a project filter stays visibly selected after its final row is reviewed");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Other workspace task", { exact: true }).last().waitFor();
  await page.getByRole("button", { name: /^Activity/ }).click();
  const reloadedOverview = page.getByRole("region", { name: "Activity" });
  await reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Render **E2E markdown**" }).waitFor();
  assert.equal(await reloadedOverview.locator(".activity-item-ready").filter({ hasText: "Other workspace task" }).count(), 0,
    "reviewed runs must not reappear after reloading this browser");
  console.log(`PASS: ${width}px Activity starring, background question, review, project filter and chat navigation`);
}
