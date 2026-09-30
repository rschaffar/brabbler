import assert from "node:assert/strict";

// The browser fixture supplies a read-only tool-result locator. The mocked
// proposal endpoint exercises the card, while API tests own the real write gate.
export async function checkSettingsProposalCard(page, { base, sessionId, proposalId, projectRoot }) {
  let state = "pending";
  let applied = 0;
  let holdNextGet = false;
  let releaseOldGet;
  let oldGetStarted;
  const oldGetPending = new Promise((resolve) => { oldGetStarted = resolve; });
  await page.route(`**/api/git/workflow/proposals/${proposalId}*`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      assert.deepEqual(request.postDataJSON(), { sessionId, decision: "apply" });
      state = "applied";
      applied++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state }) });
    }
    assert.equal(new URL(request.url()).searchParams.get("sessionId"), sessionId);
    const answerState = holdNextGet ? "pending" : state;
    if (holdNextGet) {
      holdNextGet = false;
      oldGetStarted();
      await new Promise((resolve) => { releaseOldGet = resolve; });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      id: proposalId, scope: "project", projectRoot, projectPath: projectRoot,
      changes: [{ field: "enabled", inherit: false, value: false }, { field: "targetBranch", inherit: true }],
      before: { targetBranch: "main" }, after: { enabled: false },
      effectiveBefore: { enabled: true, targetBranch: "main" },
      effectiveAfter: { enabled: false, targetBranch: null },
      state: answerState, idleRequired: false, canApply: true, inFlight: false,
    }) });
  });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  const card = page.getByRole("group", { name: "Workflow settings proposal" });
  await card.getByText("Workflow settings proposal · project").waitFor();
  assert.match(await card.innerText(), /Saved override: "main"/);
  assert.match(await card.innerText(), /Proposed override: Inherit \(remove override\)/);
  assert.match(await card.innerText(), /Effective here: "main" → null/);
  holdNextGet = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await oldGetPending;
  await card.getByRole("button", { name: "Apply settings" }).click();
  await card.getByText("Settings saved. Current task was not applied or started.").waitFor();
  releaseOldGet();
  await page.waitForTimeout(150);
  assert.equal(applied, 1);
  assert.equal(await card.getByRole("button", { name: "Apply settings" }).count(), 0);
  await page.unroute(`**/api/git/workflow/proposals/${proposalId}*`);
  console.log("PASS: in-chat Workflow proposal reviews scoped overrides and applies once without task capture");
}
