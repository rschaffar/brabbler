import assert from "node:assert/strict";
/** Native/default bridge: real stats body and four-ID ledger at every input;
 * one desktop selected-toolbar/URL witness. Literal arithmetic and selected-cost
 * permutations live in the fault-gated actual lower Panel, not a stats overlay.
 * Activity2500ms and usage3000ms defaults remain unchanged.
 */
export async function checkActivityFamilyUsage(page, width, {
  base, api, selectedSessionId, otherSessionId, subagentIds, overview, parentReady, setMetricsChildRunning,
}) {
  const mobile = width <= 640;
  const desktop = width === 1280;
  const originalViewport = page.viewportSize();
  const [childA, childB, workingChild] = subagentIds;
  const row = (id, status = "ready") => overview.locator(`.activity-item-${status}`).filter({ hasText: id });
  const familyIds = [selectedSessionId, childA, childB, workingChild];
  const reviewBeforeMetrics = await api("/api/agent/running");
  const metricReviewPosts = [];
  const failures = [];
  const observeReview = (request) => {
    try {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/activity/review") {
        const body = request.postDataJSON();
        if (body.op === "ack" && body.entries.some(({ sessionId }) => familyIds.includes(sessionId))) metricReviewPosts.push(body);
      }
    } catch (error) { failures.push(error); } // retain the original observer error through independent cleanup
  };
  page.on("request", observeReview);
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
    // First default application POST is NOT fulfilled with controlled counts.
    // Observe its genuine browser response and native route/disk authority.
    const nativeRead = page.waitForResponse(response => new URL(response.url()).pathname === "/api/sessions/stats" && response.request().method() === "POST")
      .then(async response => ({ response, body: await response.json() }));
    const nativeOutcome = nativeRead.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    let nativeUi = { ok: true };
    try { await agentsButton.click(); }
    catch (error) { nativeUi = { ok: false, error }; }
    const nativeResult = await nativeOutcome; // join the original full body even after the independent click fails
    const nativeFailures = [];
    if (!nativeUi.ok) nativeFailures.push(nativeUi.error);
    if (!nativeResult.ok) nativeFailures.push(nativeResult.error);
    if (nativeFailures.length === 1) throw nativeFailures[0];
    if (nativeFailures.length) throw new AggregateError(nativeFailures, "Native usage click and response failed");
    const { response: native, body: nativeBody } = nativeResult.value;
    assert.equal(native.status(), 200);
    assert.deepEqual(Object.keys(native.request().postDataJSON()), ["ids"]);
    assert.deepEqual([...native.request().postDataJSON().ids].sort(), [...familyIds].sort());
    const nativeStats = nativeBody.stats;
    for (const id of familyIds) {
      const value = nativeStats[id];
      assert.ok(value, `native stats available for ${id}`);
      for (const n of [value.tokens.input, value.tokens.output, value.tokens.cacheRead, value.tokens.cacheWrite, value.tokens.total, value.cost, value.toolCalls, value.totalActiveMs]) assert.ok(Number.isFinite(n) && n >= 0);
    }
    const agents = page.getByRole("region", { name: "Agents", exact: true });
    const familyUsage = agents.getByTestId("agent-family-usage");
    await familyUsage.getByText("4/4 available", { exact: false }).waitFor();
    assert.equal(await toolbarStats.getAttribute("title"), rootToolbarTitle, "family usage never replaces selected-session toolbar counters");
    const list = agents.getByRole("listbox", { name: "Agents" });
    assert.equal(await list.getByRole("option").count(), 4);
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
    await selectedUsage.waitFor();
    // Real viewport shrink with the same native disclosures/focused summary.
    await page.setViewportSize({ width: originalViewport.width, height: originalViewport.height - 160 });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[role="region"][aria-label="Agents"]');
      if (!panel) return false;
      const rect = panel.getBoundingClientRect();
      return rect.width > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    });
    await page.setViewportSize(originalViewport);
    if (desktop) {
    await list.locator(`[data-agent-usage-id="${childA}"]`).click();
    await page.waitForURL((url) => url.searchParams.get("session") === childA);
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
    } else await agentsButton.click();
    const afterMetrics = await api("/api/agent/running");
    for (const id of familyIds) {
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
    try { setMetricsChildRunning(true); }
    catch (error) { failures.push(error); }
    try { await page.setViewportSize(originalViewport); }
    catch (error) { failures.push(error); }
    try { await page.emulateMedia({ reducedMotion: null }); }
    catch (error) { failures.push(error); }
    try { page.off("request", observeReview); }
    catch (error) { failures.push(error); }
    try { assert.deepEqual(metricReviewPosts, [], "no late metrics acknowledgement through route/resize cleanup"); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Activity family usage fixture failed");
  }
}
