import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { withExpectedBrowserConflict } from "./expected-browser-conflict.mjs";
import { checkDiffContext } from "./git-diff-context.mjs";
import { checkGitExplorerFullscreen } from "./git-explorer-fullscreen.mjs";
import { checkGitGraphAlignment } from "./git-graph-geometry.mjs";
import { holdBrowserRead } from "./browser-read-barrier.mjs";

/** Visual history tracks the selected checkout and branch, independently of the open chat. */
export async function checkGitExplorer(page, { base, sessionId, cwd, targetWorktree }) {
  const checkoutHead = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  const quotePreference = await page.evaluate(() => {
    const saved = localStorage.getItem("pi-quote-selection-enabled");
    localStorage.setItem("pi-quote-selection-enabled", "true");
    return saved;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Ready to browse Git history", { exact: true }).waitFor();
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
  await checkGitGraphAlignment(graph);
  const rootFontSize = await page.evaluate(() => document.documentElement.style.fontSize);
  try {
    // SVG uses pixel coordinates; rem-based rows must not drift at other root sizes either.
    for (const size of [16, 18]) {
      await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, size);
      await checkGitGraphAlignment(graph);
    }
  } finally {
    await page.evaluate((saved) => { document.documentElement.style.fontSize = saved; }, rootFontSize);
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
  const oldBranch = await holdBrowserRead(page, { pathname: "/api/git/explorer", query: { cwd, op: "log", branch: "target" } });
  try {
    await branch.selectOption("target");
    await oldBranch.arrived();
    await branch.selectOption("feature");
    await graph.getByRole("button", { name: /second feature/ }).waitFor();
    await oldBranch.releaseAndObserve();
    assert.equal(await graph.locator("svg circle").count(), 3, "A late branch response must not replace the newer selection");
  } finally { await oldBranch.dispose(); }
  const patchReads = [], contextReads = [];
  const recordPatch = (request) => {
    const query = new URL(request.url()).searchParams;
    if (query.get("op") === "patch") patchReads.push(query.get("path"));
    if (query.get("op") === "context") contextReads.push(query.get("path"));
  };
  page.on("request", recordPatch);
  await graph.getByRole("button", { name: /second feature/ }).click();
  const detail = explorer.getByRole("region", { name: "Git commit details" });
  const firstFile = detail.getByRole("region", { name: "File changes: base.txt", exact: true });
  const secondFile = detail.getByRole("region", { name: "File changes: second.txt", exact: true });
  await firstFile.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  assert.equal(await secondFile.getByRole("button", { name: "Toggle diff: second.txt", exact: true }).getAttribute("aria-expanded"), "false");
  assert.equal(contextReads.length, 0, "Opening committed diffs is patch-only until context is requested");
  assert.deepEqual([...new Set(patchReads)], ["base.txt"], "Only the initially expanded file is fetched (Strict Mode may cancel/restart its first read)");
  assert.equal(await detail.getByRole("group", { name: "Patch view" }).count(), 1);
  assert.equal(await page.locator("#file-panel [data-file-pane]").getByRole("tab").count(), 0,
    "Commit inspection should not create a file tab");
  const oid = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await detail.getByRole("button", { name: "Copy commit ID" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), oid);
  await detail.getByRole("button", { name: "Copy commit message" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "second feature");
  const split = firstFile.getByRole("region", { name: "Side-by-side diff" });
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
  await secondFile.getByRole("button", { name: "Toggle diff: second.txt", exact: true }).click();
  await secondFile.getByText("Second feature patch", { exact: true }).waitFor();
  assert.deepEqual([...new Set(patchReads)], ["base.txt", "second.txt"]);
  const loadedReads = patchReads.length;
  await secondFile.getByRole("button", { name: "Toggle diff: second.txt", exact: true }).click();
  await secondFile.getByRole("button", { name: "Toggle diff: second.txt", exact: true }).click();
  await secondFile.getByText("Second feature patch", { exact: true }).waitFor();
  assert.equal(patchReads.length, loadedReads, "Reopening a file reuses its candidate-bound successful patch");
  await detail.getByRole("button", { name: "Unified", exact: true }).click();
  await firstFile.getByRole("region", { name: "Unified diff" }).waitFor();
  await secondFile.getByRole("region", { name: "Unified diff" }).waitFor();
  await detail.getByRole("button", { name: "Side by side", exact: true }).click();
  const longFile = detail.getByRole("region", { name: "File changes: z-context.txt", exact: true });
  const toggleLongFile = longFile.getByRole("button", { name: "Toggle diff: z-context.txt", exact: true });
  await detail.getByRole("button", { name: "Expand all files", exact: true }).click();
  await toggleLongFile.scrollIntoViewIfNeeded();
  await longFile.getByRole("region", { name: "Side-by-side diff", exact: true }).waitFor();
  assert.equal(contextReads.length, 0, "Expand all files opens patches, never all full-file contents");
  const contextUrl = `${base}/api/git/explorer?${new URLSearchParams({ cwd, op: "context", branch: "feature", head: oid, oid, path: "z-context.txt" })}`;
  const refuseContext = (route) => route.fulfill({ status: 409, json: { error: "E2E matching context unavailable" } });
  await page.route(contextUrl, refuseContext);
  await withExpectedBrowserConflict(page, { scenario: "matching context unavailable", url: contextUrl, method: "GET", body: null }, async () => {
    const response = page.waitForResponse(contextUrl);
    await longFile.getByRole("button", { name: "Show full file", exact: true }).click();
    const refused = await response; assert.equal(refused.status(), 409);
    await longFile.getByRole("alert").getByText(/E2E matching context unavailable/).waitFor();
    assert.equal(await longFile.getByRole("button", { name: "Show full file", exact: true }).getAttribute("aria-pressed"), "false");
    assert.ok(await longFile.getByRole("region", { name: "Side-by-side diff", exact: true }).isVisible(), "Context failure never replaces the supplied patch");
    return refused;
  });
  await page.unroute(contextUrl, refuseContext);
  await longFile.getByRole("button", { name: "Retry context", exact: true }).click();
  await longFile.getByRole("alert").waitFor({ state: "hidden" });
  await checkDiffContext(page, longFile, detail, { toggleFile: toggleLongFile });
  assert.deepEqual(contextReads, ["z-context.txt", "z-context.txt"], "Failure retries once, then layouts/expansion/reading reuse the same snapshot");
  await checkGitExplorerFullscreen(page, { base, sessionId, explorer, graph, detail, file: longFile });
  await page.evaluate((saved) => {
    if (saved === null) localStorage.removeItem("pi-quote-selection-enabled");
    else localStorage.setItem("pi-quote-selection-enabled", saved);
  }, quotePreference);
  const oldViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await longFile.getByRole("textbox", { name: "Line number", exact: true }).fill("5000");
  await longFile.getByRole("button", { name: "Go to line", exact: true }).click();
  await longFile.getByText("Context line 5000", { exact: true }).first().waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('[aria-label="File changes: z-context.txt"] .git-diff-code-view');
    return element && element.scrollWidth > element.clientWidth && element.clientWidth <= innerWidth;
  });
  await longFile.getByRole("button", { name: "Next change", exact: true }).click();
  const addition = longFile.getByText("Explorer changed 4500", { exact: true }); await addition.waitFor();
  const additionBounds = await addition.boundingBox(), readerBounds = await longFile.locator(".git-diff-code-view").boundingBox();
  assert.ok(additionBounds && readerBounds && additionBounds.x < readerBounds.x + readerBounds.width && additionBounds.x + additionBounds.width > readerBounds.x,
    "Change navigation brings the selected new side into the mobile viewport");
  await page.setViewportSize(oldViewport);
  const restoreSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (sidebarWasOpen && await restoreSidebar.isVisible()) await restoreSidebar.click();
  page.off("request", recordPatch);

  const rootOid = execFileSync("git", ["-C", cwd, "rev-parse", "target"], { encoding: "utf8" }).trim();
  const oldPatch = await holdBrowserRead(page, { pathname: "/api/git/explorer", query: { cwd, op: "patch", oid: rootOid } });
  try {
    await graph.getByRole("button", { name: /base fixture/ }).click();
    await oldPatch.arrived();
    await graph.getByRole("button", { name: /second feature/ }).click();
    await firstFile.getByRole("region", { name: "Side-by-side diff" }).getByText("Revised base fixture", { exact: true }).waitFor();
    await oldPatch.releaseAndObserve();
    await detail.getByText(oid, { exact: true }).waitFor();
    assert.equal(await secondFile.getByRole("button", { name: "Toggle diff: second.txt", exact: true }).getAttribute("aria-expanded"), "false", "New commit view resets expansion and cannot inherit the old patch");
  } finally { await oldPatch.dispose(); }

  const unavailableUrl = `${base}/api/git/explorer?${new URLSearchParams({ cwd, op: "patch", branch: "feature", head: oid, oid, path: "second.txt" })}`;
  const refusePatch = (route) => route.fulfill({ status: 409, json: { error: "E2E patch unavailable" } });
  await page.route(unavailableUrl, refusePatch);
  await withExpectedBrowserConflict(page, { scenario: "local file-patch error", url: unavailableUrl, method: "GET", body: null }, async () => {
    const response = page.waitForResponse(unavailableUrl);
    await secondFile.getByRole("button", { name: "Toggle diff: second.txt", exact: true }).click();
    const refused = await response;
    assert.equal(refused.status(), 409);
    assert.deepEqual(await refused.json(), { error: "E2E patch unavailable" });
    await secondFile.getByRole("alert").waitFor();
    assert.match(await secondFile.getByRole("alert").innerText(), /E2E patch unavailable/);
    assert.ok(await firstFile.getByRole("region", { name: "Side-by-side diff" }).isVisible(), "One file's error does not replace another file's diff");
    assert.equal(execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), checkoutHead);
    return refused;
  });
  await page.unroute(unavailableUrl, refusePatch);
  await secondFile.getByRole("button", { name: "Retry", exact: true }).click();
  await secondFile.getByText("Second feature patch", { exact: true }).waitFor();
  const graphBounds = await graph.boundingBox();
  const detailBounds = await detail.boundingBox();
  assert.ok(graphBounds && detailBounds && graphBounds.x + graphBounds.width <= detailBounds.x + 2,
    `Graph and commit detail should be adjacent in one panel: ${JSON.stringify({ graphBounds, detailBounds })}`);
  assert.ok(await page.getByText("Ready to browse Git history", { exact: true }).isVisible(), "Chat stays beside Git view");
  await page.setViewportSize({ width: 900, height: 800 });
  await explorer.getByRole("button", { name: "Back to commits" }).click();
  await graph.waitFor({ state: "visible" });
  await graph.getByRole("button", { name: /second feature/ }).click();
  await detail.waitFor({ state: "visible" });
  assert.ok(await page.getByText("Ready to browse Git history", { exact: true }).isVisible(),
    "Intermediate widths keep chat beside the single-column Git panel");
  await page.setViewportSize({ width: 1280, height: 800 });

  const oldHistory = await holdBrowserRead(page, { pathname: "/api/git/explorer", query: { cwd, op: "log" } });
  try {
    await explorer.getByRole("button", { name: "Refresh" }).click();
    await oldHistory.arrived();
    await page.getByTitle(`Switch worktree: ${cwd}`).click();
    const targetHistory = page.waitForResponse((response) => {
      const address = new URL(response.url());
      return address.pathname === "/api/git/explorer" && address.searchParams.get("op") === "log"
        && address.searchParams.get("cwd") === targetWorktree;
    });
    await page.locator(".wt-row").filter({ hasText: "target" }).locator("button").first().click();
    assert.equal((await targetHistory).status(), 200);
    await page.waitForFunction(() => document.querySelector('[aria-label="History branch"]')?.value === "target");
    await graph.getByRole("button", { name: /base fixture/ }).waitFor();
    await oldHistory.releaseAndObserve();
    assert.equal(await graph.locator("svg circle").count(), 1, "Target checkout shows its own history");
    assert.equal(await detail.count(), 0, "Changing worktrees clears the old commit detail");
    await graph.getByRole("button", { name: /base fixture/ }).click();
    await detail.getByRole("region", { name: "Side-by-side diff" }).getByText("Base fixture", { exact: true }).waitFor();
  } finally { await oldHistory.dispose(); }
  await page.getByRole("button", { name: "New", exact: true }).click();
  assert.equal(await page.getByText("Ready to browse Git history", { exact: true }).count(), 0);
  await detail.getByRole("region", { name: "Side-by-side diff" }).getByText("Base fixture", { exact: true }).waitFor();
  await page.waitForFunction(() => new URL(location.href).searchParams.has("session"));
  assert.equal(await explorer.isVisible(), true, "desktop New preserves its independent Git sidecar");
  // New now saves an actual empty session. Exercise genuine no-session Explorer
  // through the passive setup view instead, without creating a second session.
  await page.goto(`${base}/?cwd=${encodeURIComponent(targetWorktree)}`, { waitUntil: "domcontentloaded" });
  await page.locator(".chat-input-textarea").waitFor();
  assert.equal(new URL(page.url()).searchParams.has("session"), false, "setup has no selected session");
  await gitButton.click();
  await graph.getByRole("button", { name: /base fixture/ }).waitFor();
  assert.equal(await page.getByText("Ready to browse Git history", { exact: true }).count(), 0,
    "Git Explorer works without an open session");
  await explorer.getByRole("button", { name: "Expand Git Explorer", exact: true }).click();
  assert.equal(Math.round((await explorer.boundingBox()).width), page.viewportSize().width, "No-chat Explorer fills the viewport too");
  await explorer.getByRole("button", { name: "Close Git Explorer", exact: true }).click();
  await explorer.waitFor({ state: "detached" });
  assert.equal(await gitButton.evaluate((button) => button === document.activeElement), true, "Close returns focus to the Git Explorer trigger");
  await gitButton.click();
  assert.equal(await explorer.getByRole("button", { name: "Expand Git Explorer", exact: true }).getAttribute("aria-pressed"), "false", "Reopening starts in the normal sidecar");
  await graph.getByRole("button", { name: /base fixture/ }).click();
  await detail.getByRole("region", { name: "Side-by-side diff" }).waitFor();

  const viewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDiff = detail.getByRole("region", { name: "Side-by-side diff" });
    await page.waitForFunction(() => {
      const diff = document.querySelector('[aria-label="Side-by-side diff"]');
      const viewport = diff?.querySelector('.git-diff-code-view');
      return diff && viewport && diff.clientWidth <= innerWidth && viewport.scrollWidth > viewport.clientWidth;
    });
    assert.ok(await mobileDiff.isVisible(), "Side-by-side diff remains scrollable on mobile");
    await explorer.getByRole("button", { name: "Back to commits" }).click();
    await graph.waitFor({ state: "visible" });
    await checkGitGraphAlignment(graph);
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
