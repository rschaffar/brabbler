import assert from "node:assert/strict";

/** Visual history tracks the sidebar checkout, never the open chat's integration target. */
export async function checkGitExplorer(page, { base, sessionId, cwd, targetWorktree }) {
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Git Explorer view" }).click();
  const explorer = page.getByLabel("Git Explorer", { exact: true });
  await explorer.getByText(/feature · [0-9a-f]{10}/).waitFor();
  const graph = explorer.getByLabel("Commit graph");
  assert.equal(await graph.locator("svg circle").count(), 3, "Graph should show feature commits and root");
  await graph.getByText("feature", { exact: true }).waitFor();
  await graph.getByRole("button", { name: /second feature/ }).click();
  const detail = page.getByRole("region", { name: "Git commit details" });
  await detail.getByRole("button", { name: /second\.txt/ }).click();
  await detail.getByText(/\+Second feature patch/).waitFor();

  const delayOldHistory = async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("op") !== "log" || query.get("cwd") !== cwd) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue().catch(() => {}); // switching checkout may abort the obsolete request
  };
  await page.route("**/api/git/explorer?*", delayOldHistory);
  const staleRequest = page.waitForRequest((request) => {
    const query = new URL(request.url()).searchParams;
    return query.get("op") === "log" && query.get("cwd") === cwd;
  });
  await explorer.getByRole("button", { name: "Refresh" }).click();
  await staleRequest;
  await page.getByTitle(`Switch worktree: ${cwd}`).click();
  const targetHistory = page.waitForResponse((response) => {
    const address = new URL(response.url());
    return address.pathname === "/api/git/explorer" && address.searchParams.get("op") === "log"
      && address.searchParams.get("cwd") === targetWorktree;
  });
  await page.locator(".wt-row").filter({ hasText: "target" }).locator("button").first().click();
  assert.equal((await targetHistory).status(), 200);
  await explorer.getByText(/target · [0-9a-f]{10}/).waitFor();
  await page.waitForTimeout(750);
  await explorer.getByText(/target · [0-9a-f]{10}/).waitFor();
  await page.unroute("**/api/git/explorer?*", delayOldHistory);
  assert.equal(await graph.locator("svg circle").count(), 1, "Target checkout should display its own history");
  await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
  await graph.getByRole("button", { name: /base fixture/ }).click();
  await detail.getByRole("button", { name: /base\.txt/ }).click();
  await detail.getByText(/\+Base fixture/).waitFor();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await explorer.getByText(/target · [0-9a-f]{10}/).waitFor();
  assert.equal(await page.getByText("Ready to review Git workflow", { exact: true }).count(), 0,
    "Git Explorer must work without an open session");
  const viewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#file-panel").getByRole("button", { name: "Hide file panel", exact: true }).click();
    const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await explorer.getByText(/target · [0-9a-f]{10}/).waitFor();
    await page.waitForFunction(() => {
      const bounds = document.querySelector('[aria-label="Commit graph"]')?.getBoundingClientRect();
      return bounds && bounds.left >= 0 && bounds.right <= innerWidth;
    });
    const bounds = await graph.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390,
      `Git graph must remain in the mobile sidebar viewport: ${JSON.stringify(bounds)}`);
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
  console.log("PASS: visual Git Explorer follows selected worktree independently of the open chat");
}
