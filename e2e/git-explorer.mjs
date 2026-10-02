import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** Visual history tracks the selected checkout and branch, never the open chat's integration target. */
export async function checkGitExplorer(page, { base, sessionId, cwd, targetWorktree }) {
  const checkoutHead = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
  const gitButton = page.getByRole("button", { name: "Git Explorer", exact: true });
  const initialViewport = page.viewportSize();
  const sidebarWasOpen = await page.locator("#session-sidebar").isVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const buttonBounds = await gitButton.boundingBox();
    const iconBounds = await gitButton.locator("svg").boundingBox();
    assert.ok(buttonBounds && iconBounds, "Git button and icon are visible");
    assert.ok(Math.abs(buttonBounds.x + buttonBounds.width / 2 - iconBounds.x - iconBounds.width / 2) <= 1,
      `Git icon is horizontally centered at ${width}px`);
    assert.ok(Math.abs(buttonBounds.y + buttonBounds.height / 2 - iconBounds.y - iconBounds.height / 2) <= 1,
      `Git icon is vertically centered at ${width}px`);
  }
  await page.setViewportSize(initialViewport);
  // Entering the mobile layout closes the sidebar; restore it for the history fixture.
  if (sidebarWasOpen) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await gitButton.click();
  const explorer = page.locator("#git-explorer-panel");
  const graph = explorer.getByLabel("Commit graph");
  const branch = explorer.getByRole("combobox", { name: "History branch" });
  await branch.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[aria-label="History branch"]')?.value === "feature");
  assert.equal(await graph.locator("svg circle").count(), 3, "Graph should show feature commits and root");
  const featureRow = graph.getByRole("button", { name: /second feature/ });
  await featureRow.getByLabel("Local branch: feature", { exact: true }).waitFor();
  for (const tag of ["e2e-light", "e2e-annotated"]) {
    const badge = featureRow.getByLabel(`Local tag: ${tag}`, { exact: true });
    await badge.waitFor({ state: "visible" });
    assert.equal(await badge.getAttribute("title"), `Local tag: ${tag}`, "Tag tooltip preserves the complete name");
    assert.equal(await badge.innerText(), `tag: ${tag}`, "Tags are distinguishable from branch labels");
  }
  const branchOptions = await branch.locator("option").evaluateAll((options) => options.map((option) => option.value));
  for (const tag of ["e2e-light", "e2e-annotated", "same-name"]) {
    assert.ok(!branchOptions.includes(tag), `Tag ${tag} must not become a history branch`);
  }
  await branch.selectOption("target");
  await page.waitForFunction(() => document.querySelector('[aria-label="History branch"]')?.value === "target");
  await graph.getByRole("button", { name: /base fixture/ }).waitFor();
  assert.equal(await graph.locator("svg circle").count(), 1, "Other local branch shows only its reachable commits");
  await graph.getByRole("button", { name: /base fixture/ }).getByLabel("Local tag: same-name", { exact: true }).waitFor();
  assert.equal(await graph.getByLabel("Local tag: e2e-light", { exact: true }).count(), 0, "Tags cannot add unreachable commits to the graph");
  assert.equal(execFileSync("git", ["-C", cwd, "branch", "--show-current"], { encoding: "utf8" }).trim(), "feature",
    "Browsing another local branch must not check it out");
  assert.equal(execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), checkoutHead,
    "Tag labels must not change the checkout HEAD");
  await branch.selectOption("feature");
  await graph.getByRole("button", { name: /second feature/ }).waitFor();
  const delayOtherBranch = async (route) => {
    if (new URL(route.request().url()).searchParams.get("branch") !== "target") return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue().catch(() => {});
  };
  await page.route("**/api/git/explorer?*", delayOtherBranch);
  const delayedBranch = page.waitForRequest((request) => new URL(request.url()).searchParams.get("branch") === "target");
  await branch.selectOption("target");
  await delayedBranch;
  await branch.selectOption("feature");
  await graph.getByRole("button", { name: /second feature/ }).waitFor();
  await page.waitForTimeout(700);
  assert.equal(await graph.locator("svg circle").count(), 3, "A late branch response must not replace the newer selection");
  await page.unroute("**/api/git/explorer?*", delayOtherBranch);
  await graph.getByRole("button", { name: /second feature/ }).click();
  const detail = explorer.getByRole("region", { name: "Git commit details" });
  await detail.getByRole("button", { name: /base\.txt/ }).click();
  assert.equal(await page.locator("#file-panel").getByRole("tab").count(), 0,
    "Commit inspection should not create a file tab");
  const oid = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await detail.getByRole("button", { name: "Copy commit ID" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), oid);
  await detail.getByRole("button", { name: "Copy commit message" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "second feature");
  const split = detail.getByRole("region", { name: "Side-by-side diff" });
  await split.locator('[data-deletions] [data-line-type="change-deletion"]').getByText("Base fixture").waitFor();
  await split.locator('[data-additions] [data-line-type="change-addition"]').getByText("Revised base fixture").waitFor();
  assert.ok((await split.locator("[data-line-number-content]").count()) >= 2, "Both sides have line numbers");
  await split.getByLabel("Patch hunk").getByText(/@@ -1 \+1 @@/).waitFor();
  await detail.getByRole("button", { name: "Unified" }).click();
  await detail.getByRole("region", { name: "Unified diff" }).waitFor();
  await detail.getByRole("button", { name: "Raw patch" }).click();
  await detail.getByText(/-Base fixture/).waitFor();
  await detail.getByRole("button", { name: "Side by side" }).click();
  await split.waitFor();
  await detail.getByRole("button", { name: /second\.txt/ }).click();
  await detail.getByText("Second feature patch", { exact: true }).waitFor();
  const graphBounds = await graph.boundingBox();
  const detailBounds = await detail.boundingBox();
  assert.ok(graphBounds && detailBounds && graphBounds.x + graphBounds.width <= detailBounds.x + 2,
    `Graph and commit detail should be adjacent in one panel: ${JSON.stringify({ graphBounds, detailBounds })}`);
  assert.ok(await page.getByText("Ready to review Git workflow", { exact: true }).isVisible(), "Chat stays beside Git view");
  await page.setViewportSize({ width: 900, height: 800 });
  await explorer.getByRole("button", { name: "Back to commits" }).click();
  await graph.waitFor({ state: "visible" });
  await graph.getByRole("button", { name: /second feature/ }).click();
  await detail.waitFor({ state: "visible" });
  assert.ok(await page.getByText("Ready to review Git workflow", { exact: true }).isVisible(),
    "Intermediate widths keep chat beside the single-column Git panel");
  await page.setViewportSize({ width: 1280, height: 800 });

  const delayOldHistory = async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("op") !== "log" || query.get("cwd") !== cwd) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue().catch(() => {});
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
  await page.waitForFunction(() => document.querySelector('[aria-label="History branch"]')?.value === "target");
  await page.waitForTimeout(750);
  assert.equal(await graph.locator("svg circle").count(), 1, "Target checkout shows its own history");
  assert.equal(await detail.count(), 0, "Changing worktrees clears the old commit detail");
  await graph.getByRole("button", { name: /base fixture/ }).click();
  await detail.getByRole("button", { name: /base\.txt/ }).click();
  await detail.getByRole("region", { name: "Side-by-side diff" }).getByText("Base fixture", { exact: true }).waitFor();
  await page.unroute("**/api/git/explorer?*", delayOldHistory);
  await page.getByRole("button", { name: "New", exact: true }).click();
  assert.equal(await page.getByText("Ready to review Git workflow", { exact: true }).count(), 0,
    "Git Explorer works without an open session");

  const viewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDiff = detail.getByRole("region", { name: "Side-by-side diff" });
    await page.waitForFunction(() => {
      const diff = document.querySelector('[aria-label="Side-by-side diff"]');
      return diff && diff.clientWidth <= innerWidth && diff.scrollWidth > diff.clientWidth;
    });
    assert.ok(await mobileDiff.isVisible(), "Side-by-side diff remains scrollable on mobile");
    await explorer.getByRole("button", { name: "Back to commits" }).click();
    await graph.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const bounds = document.querySelector('[aria-label="Commit graph"]')?.getBoundingClientRect();
      return bounds && bounds.left >= 0 && bounds.right <= innerWidth;
    });
    await graph.getByRole("button", { name: /base fixture/ }).click();
    await detail.waitFor({ state: "visible" });
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
  console.log("PASS: Git sidecar shows local branch history and tag labels, adjacent commit detail and copy actions");
}
