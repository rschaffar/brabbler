import assert from "node:assert/strict";
import { createOwnedRoutes } from "./owned-routes.mjs";

/** Original browser metrics fragment, reused at every Activity input.
 * Controlled usage/live boundaries; real header, navigation, disclosures and
 * receipt negatives. No mounted AppShell-metrics replacement is claimed.
 */
export async function checkActivityFamilyUsage(page, width, {
  base, api, selectedSessionId, otherSessionId, subagentIds, overview, parentReady, setMetricsChildRunning,
}) {
  const mobile = width <= 640;
  const [childA, childB, workingChild] = subagentIds;
  const row = (id, status = "ready") => overview.locator(`.activity-item-${status}`).filter({ hasText: id });
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
  const failures = [];
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
    setMetricsChildRunning(false);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const idleAgents = page.getByRole("button", { name: /^Agents · \d+ subagents$/ });
    await idleAgents.waitFor({ timeout: 15000 });
    assert.equal(await idleAgents.locator("span[aria-hidden=true]").innerText(), "3", "idle badge returns to the family child count");
    setMetricsChildRunning(true);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await agentsButton.waitFor({ timeout: 15000 });
    const afterMetrics = await api("/api/agent/running");
    for (const id of amounts.keys()) {
      assert.equal(afterMetrics.reviewedRuns.find((entry) => entry.sessionId === id)?.at,
        reviewBeforeMetrics.reviewedRuns.find((entry) => entry.sessionId === id)?.at, "viewing usage does not acknowledge Activity");
    }
    // Preserve the original selected OTHER prerequisite, including mobile, and
    // return to the project Activity panel with the controlled working child.
    await page.goto(`${base}/?session=${otherSessionId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Other workspace task", { exact: true }).last().waitFor();
    await page.getByRole("button", { name: /^Activity/ }).click();
    await overview.getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
    await row(workingChild, "working").waitFor();
    assert.deepEqual(metricReviewPosts, []);
  } catch (error) { failures.push(error); }
  finally {
    setMetricsChildRunning(true);
    page.off("request", observeReview);
    statsRoutes.beginDisposal();
    try { await statsRoutes.dispose((handler) => page.unroute(statsURL, handler)); }
    catch (error) { failures.push(error); }
    try { await page.emulateMedia({ reducedMotion: null }); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Activity family usage fixture failed");
  }
}
