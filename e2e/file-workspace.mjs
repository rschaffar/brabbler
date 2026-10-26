import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkFileLinkHover, checkFileLinkHoverFocus, checkFileLinkFollowing, checkIndependentFollowRoutes, checkOneTimeFileSplits } from "./file-link-hover.mjs";

/** Runs in the existing Markdown inventory chain, with synthetic user files. */
export async function checkFileWorkspace(page, base, fixture, artifacts) {
  await page.goto(`${base}/?session=${fixture.sessionId}`, { waitUntil: "domcontentloaded" });
  const panel = page.locator("#file-panel");
  const mobile = page.viewportSize().width <= 640;
  const dismissSidebar = async () => {
    if (mobile) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: page.viewportSize().width - 10, y: 200 } });
  };
  const reopenFiles = async () => {
    await dismissSidebar();
    if (mobile) await page.getByRole("button", { name: "Show file panel", exact: true }).click();
  };
  await page.locator("#chat-content").getByRole("link", { name: "Nested preview", exact: true }).click();
  const nestedHost = await panel.locator(".markdown-file-preview").elementHandle();
  if (page.viewportSize().width >= 960) {
    // Opening, switching and closing overviews must not collapse the shown file.
    for (const name of ["Activity", "Starred", "Activity", "Activity", "Starred", "Starred"]) {
      const toggle = page.getByRole("button", { name: name === "Activity" ? /^Activity/ : "Starred", exact: name !== "Activity" });
      await toggle.click();
      await panel.waitFor({ state: "visible" });
      assert.equal(await nestedHost.evaluate(el => el.isConnected && el.getClientRects().length > 0), true,
        `${name} retains the visible file reader`);
      assert.equal(new URL(page.url()).searchParams.get("session"), fixture.sessionId);
    }
  }
  if (!mobile) await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
  await panel.getByRole("button", { name: "Reveal in explorer", exact: true }).click();
  const revealed = page.locator('[data-explorer-revealed="true"]');
  await revealed.waitFor({ state: "visible" });
  assert.equal(await revealed.getAttribute("aria-label"), fixture.nested.replace(/\\/g, "/"));
  assert.equal(await revealed.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
  assert.equal(await nestedHost.evaluate(el => el.isConnected), true, "reveal retains the selected reader");
  await page.getByRole("button", { name: `Collapse folder (${dirname(fixture.nested).replace(/\\/g, "/")})`, exact: true }).click();
  await reopenFiles();
  await panel.getByRole("button", { name: "Reveal in explorer", exact: true }).click();
  await revealed.waitFor({ state: "visible" });
  assert.equal(await revealed.getAttribute("aria-label"), fixture.nested.replace(/\\/g, "/"), "repeat command expands a manually collapsed ancestor");
  if (!mobile) {
    await page.getByRole("button", { name: "Search files", exact: true }).click();
    await page.getByRole("textbox", { name: "Search files", exact: true }).fill("not-a-match");
    await panel.getByRole("button", { name: "Reveal in explorer", exact: true }).click();
    await revealed.waitFor({ state: "visible" });
    assert.equal(await page.getByRole("textbox", { name: "Search files", exact: true }).count(), 0, "reveal leaves a filtered projection");
  }
  await dismissSidebar();
  if (!mobile) await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  await page.locator("#chat-content").getByRole("link", { name: "Absolute sibling", exact: true }).click();
  await panel.getByRole("button", { name: "Reveal in explorer", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-explorer-revealed="true"]')?.getAttribute("aria-label")?.endsWith("/other-project/sibling-line-target.ts"));
  assert.match(await revealed.getAttribute("aria-label"), /other-project\/sibling-line-target\.ts$/);
  assert.equal(new URL(page.url()).searchParams.get("session"), fixture.sessionId, "Explorer-only browsing never changes the selected chat");
  await page.getByRole("button", { name: "Return to workspace folder", exact: true }).click();
  await dismissSidebar();
  if (!mobile) await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  const chatGuide = page.locator("#chat-content").getByRole("link", { name: "Split guide", exact: true });
  if (!mobile) {
    await chatGuide.hover();
    const toolbar = page.getByRole("toolbar", { name: "File link actions", exact: true });
    await toolbar.waitFor();
    assert.equal(await toolbar.getByRole("button", { name: "Follow links", exact: true }).count(), 0, "chat is not a document routing origin");
    await toolbar.getByRole("button", { name: "More link actions", exact: true }).click();
    assert.equal(await toolbar.getByRole("button", { name: "Follow links", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await toolbar.waitFor({ state: "hidden" });
  }
  await chatGuide.click();
  const guide = panel.getByRole("tabpanel", { name: "Pane 1 — split-guide.md", exact: true });
  await guide.getByRole("heading", { name: "Guided review", exact: true }).waitFor();
  assert.equal(await panel.locator("[data-file-pane]").count(), 1);
  const originalViewport = page.viewportSize();
  if (originalViewport.width <= 640) {
    await checkFileLinkHover(page, panel, guide, artifacts);
    await checkFileLinkFollowing(page, panel, guide, artifacts, true);
    const first = panel.locator('[data-file-pane="pane-1"]');
    await first.getByLabel("Pane actions").click();
    await first.getByRole("button", { name: "Reset file layout", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-file-pane]").length === 1);
    await first.getByLabel("File link destination").selectOption("here");
    await guide.getByRole("link", { name: "Source 1", exact: true }).click();
    await panel.getByRole("tabpanel", { name: "Pane 1 — split-source-1.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
    assert.equal(await panel.locator("[data-file-pane]").count(), 1, "mobile ordinary links never create panes");
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    return;
  }
  await checkFileLinkHoverFocus(page, guide);
  await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-file-pane="pane-1"] option[value="new-right"]')?.disabled);
  await checkFileLinkHover(page, panel, guide, artifacts);
  let guideNode = await guide.elementHandle();
  await checkFileLinkFollowing(page, panel, guide, artifacts);
  await page.waitForFunction(() => document.querySelectorAll('[data-file-pane]').length === 2);
  const guideContent = guide.locator(".file-viewer-content");
  for (let i = 1; i <= 5; i++) {
    const link = guide.getByRole("link", { name: `Source ${i}`, exact: true });
    await link.focus();
    const before = await guideContent.evaluate(node => node.scrollTop);
    await link.click();
    const code = panel.getByRole("tabpanel", { name: `Pane 2 — split-source-${i}.ts`, exact: true });
    await code.locator('[data-line-number="40"][data-file-line-target]').waitFor();
    assert.equal(await guideNode.evaluate(node => node.isConnected), true, "routing must not remount the guide");
    assert.equal(await guideContent.evaluate(node => node.scrollTop), before);
    assert.equal(await link.evaluate(node => document.activeElement === node), true, "routed navigation retains guide focus");
    assert.equal(await panel.locator('[data-file-pane="pane-2"] [role="tab"]').count(), 1, "following links reuse one preview");
  }
  // Native PDF page commands refresh only the opaque embed, including repeats.
  const pdfLink = guide.getByRole("link", { name: "PDF page", exact: true });
  await pdfLink.focus();
  const pdfScroll = await guideContent.evaluate(node => node.scrollTop);
  const pdfRead = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith("split-pages.pdf") && url.searchParams.get("type") === "read" && Number(url.searchParams.get("v")) > 0;
  });
  await pdfLink.click();
  await (await pdfRead).finished();
  const pdfPane = panel.getByRole("tabpanel", { name: "Pane 2 — split-pages.pdf", exact: true });
  const pdfHost = await pdfPane.elementHandle(), pdfFrame = pdfPane.locator("iframe");
  const originalPdf = await pdfFrame.elementHandle(), pdfUrl = await pdfFrame.getAttribute("src");
  assert.match(pdfUrl, /#page=2$/);
  await pdfLink.click();
  await page.waitForFunction(node => !node.isConnected, originalPdf);
  assert.equal(await pdfFrame.getAttribute("src"), pdfUrl, "same page/URL is still a fresh navigation command");
  assert.equal(await pdfHost.evaluate(node => node.isConnected), true, "PDF navigation retains the file-view host");
  assert.equal(await guideNode.evaluate(node => node.isConnected), true);
  assert.equal(await guideContent.evaluate(node => node.scrollTop), pdfScroll);
  assert.equal(await pdfLink.evaluate(node => document.activeElement === node), true);
  await guide.getByRole("link", { name: "Source 5", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 2 — split-source-5.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
  // Splitting below creates a third independently retained file view.
  const second = panel.locator('[data-file-pane="pane-2"]');
  await second.getByLabel("Pane actions").click();
  await second.getByRole("button", { name: "Split below", exact: true }).click();
  assert.equal(await second.locator("details").getAttribute("open"), null, "pane actions close after activation");
  await page.waitForFunction(() => document.querySelectorAll('[data-file-pane]').length === 3);
  await guide.getByRole("link", { name: "Test evidence", exact: true }).click({ button: "right" });
  const menu = page.getByRole("toolbar", { name: "File link actions", exact: true });
  await menu.getByRole("button", { name: /^Open in Pane 3/ }).click();
  await panel.getByRole("tabpanel", { name: "Pane 3 — split-tests.ts", exact: true }).locator('[data-line-number="2"][data-file-line-target]').waitFor();
  await guide.getByRole("link", { name: "Source 1", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 2 — split-source-1.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
  assert.equal(await panel.getByRole("tabpanel", { name: "Pane 3 — split-tests.ts", exact: true }).isVisible(), true);
  if (artifacts) await page.screenshot({ path: join(artifacts, `file-workspace-three-panes-${originalViewport.width}x${originalViewport.height}.png`) });
  await checkIndependentFollowRoutes(page, panel, guide);
  // An editor has one server-identified owner even across two file views.
  const code = panel.getByRole("tabpanel", { name: "Pane 2 — split-source-1.ts", exact: true });
  await code.getByRole("button", { name: "Edit", exact: true }).click();
  await code.getByRole("textbox", { name: "Edit", exact: true }).fill("// a retained workspace draft\n");
  const dirtyCodeHost = await code.elementHandle();
  const dirtyEditor = await code.getByRole("textbox", { name: "Edit", exact: true }).elementHandle();
  await guide.getByRole("link", { name: "Source 1", exact: true }).click({ button: "right" });
  await menu.getByRole("button", { name: /^Open in Pane 3/ }).click();
  const duplicate = panel.getByRole("tabpanel", { name: "Pane 3 — split-source-1.ts", exact: true });
  await duplicate.getByRole("button", { name: "Go to editor", exact: true }).waitFor();
  assert.equal(await duplicate.getByRole("button", { name: "Edit", exact: true }).count(), 0);
  await duplicate.getByRole("button", { name: "Go to editor", exact: true }).click();
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).inputValue(), "// a retained workspace draft\n");
  // A foreign workspace's owner is reachable without switching the current chat.
  await guideContent.evaluate(node => { node.scrollTop = 240; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const parkedGuideScroll = await guideContent.evaluate(node => node.scrollTop);
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  const showSidebar = async () => {
    const button = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await button.count()) await button.click();
  };
  await showSidebar();
  await page.getByText("Split owner peer", { exact: true }).click();
  await page.getByText("Peer review context", { exact: true }).waitFor();
  await page.waitForFunction(id => new URLSearchParams(location.search).get("session") === id, fixture.peerSessionId);
  await page.getByRole("link", { name: "Shared edit source", exact: true }).click();
  await panel.getByRole("button", { name: "Go to editor", exact: true }).click();
  await panel.getByText(/^Parked Files ·/).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("session"), fixture.peerSessionId, "Go to editor must not switch chat");
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).inputValue(), "// a retained workspace draft\n");
  assert.equal(await code.evaluate((node, retained) => node.isConnected && node === retained, dirtyCodeHost), true,
    "parked Files retains the original dirty code host");
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).evaluate((node, retained) => node.isConnected && node === retained, dirtyEditor), true,
    "parked Files retains the original dirty editor");
  await panel.getByRole("button", { name: "Return to current session Files", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 1 — split-source-1.ts", exact: true }).getByRole("button", { name: "Go to editor", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("session"), fixture.peerSessionId);
  await panel.getByLabel("Unsaved editors", { exact: true }).selectOption({ label: `split-source-1.ts — ${dirname(fixture.code)}` });
  await panel.getByText(/^Parked Files ·/).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("session"), fixture.peerSessionId, "direct parked-editor recovery also leaves chat unchanged");
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).inputValue(), "// a retained workspace draft\n");
  assert.equal(await code.evaluate((node, retained) => node.isConnected && node === retained, dirtyCodeHost), true,
    "Unsaved editors recovery retains the original dirty code host");
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).evaluate((node, retained) => node.isConnected && node === retained, dirtyEditor), true,
    "Unsaved editors recovery retains the original dirty editor");
  await panel.getByRole("button", { name: "Return to current session Files", exact: true }).click();
  await panel.getByRole("button", { name: "Go to editor", exact: true }).waitFor();
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  await showSidebar();
  await page.getByText("Split review source", { exact: true }).click();
  await page.waitForFunction(id => new URLSearchParams(location.search).get("session") === id, fixture.sessionId);
  await page.getByRole("button", { name: "Show file panel", exact: true }).click();
  await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
  await guide.waitFor({ state: "visible" });
  await page.waitForFunction(expected => document.querySelector('[role="tabpanel"][aria-label="Pane 1 — split-guide.md"] .file-viewer-content')?.scrollTop === expected, parkedGuideScroll);
  // Clean parked readers may unmount; compare live identity only across subsequent layout changes.
  guideNode = await guide.elementHandle();
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).inputValue(), "// a retained workspace draft\n");
  assert.equal(await code.evaluate((node, retained) => node.isConnected && node === retained, dirtyCodeHost), true,
    "returning to the owner session retains the original dirty code host");
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).evaluate((node, retained) => node.isConnected && node === retained, dirtyEditor), true,
    "returning to the owner session retains the original dirty editor");
  const sourceFile = join(dirname(fixture.code), "split-source-1.ts"), original = readFileSync(sourceFile, "utf8");
  let releaseSave, saveStarted;
  const gate = new Promise(resolve => { releaseSave = resolve; });
  const started = new Promise(resolve => { saveStarted = resolve; });
  const holdSave = async route => { if (route.request().method() === "PUT") { saveStarted(); await gate; } await route.continue(); };
  await page.route("**/api/files/**", holdSave);
  try {
    await code.getByRole("button", { name: "Save", exact: true }).click();
    await started;
    await code.getByRole("textbox", { name: "Edit", exact: true }).fill(original);
    const watched = page.waitForResponse(response => response.url().includes("/split-source-1.ts?") && new URL(response.url()).searchParams.get("type") === "read");
    writeFileSync(sourceFile, original);
    await (await watched).finished();
    const saved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/split-source-1.ts?"));
    releaseSave(); await (await saved).finished();
    await code.getByText("Unsaved changes", { exact: true }).waitFor();
    assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).inputValue(), original, "watcher probes during save cannot discard an intentional return to the old baseline");
  } finally { releaseSave(); await page.unroute("**/api/files/**", holdSave); }
  await code.getByRole("button", { name: "Save", exact: true }).click();
  await code.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "hidden" });
  // A fourth pane can form the other half of a 2x2 layout without remounting the guide.
  const first = panel.locator('[data-file-pane="pane-1"]');
  await first.getByLabel("Pane actions").click();
  await first.getByRole("button", { name: "Split below", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-file-pane]').length === 4);
  assert.equal(await guideNode.evaluate(node => node.isConnected), true);
  const fourth = panel.locator('[data-file-pane="pane-4"]');
  const secondGuide = panel.getByRole("tabpanel", { name: "Pane 4 — split-guide.md", exact: true });
  await secondGuide.getByRole("heading", { name: "Guided review", exact: true }).waitFor();
  const secondGuideNode = await secondGuide.elementHandle();
  await fourth.getByLabel("File link destination").selectOption("pane-3");
  await secondGuide.getByRole("link", { name: "Source 3", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 3 — split-source-3.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
  await guide.getByRole("link", { name: "Source 2", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 2 — split-source-2.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
  assert.equal(await first.getByLabel("File link destination").inputValue(), "pane-2");
  assert.equal(await fourth.getByLabel("File link destination").inputValue(), "pane-3");
  if (artifacts) await page.screenshot({ path: join(artifacts, `file-workspace-four-panes-${originalViewport.width}x${originalViewport.height}.png`) });
  await fourth.getByLabel("Pane actions").click();
  await fourth.getByRole("button", { name: /^Move tab to Pane 3/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-file-pane]').length === 3);
  assert.equal(await secondGuideNode.evaluate(node => node.isConnected), true, "moving a live view must retain its host");
  assert.equal(await panel.locator('[data-file-pane="pane-3"]').getByLabel("File link destination").inputValue(), "closed", "a moved guide cannot route into its own group");
  await first.getByLabel("Pane actions").click();
  await first.getByRole("button", { name: "Focus this pane", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-file-pane]')].filter(node => node.getBoundingClientRect().width > 0).length === 1);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => [...document.querySelectorAll('[data-file-pane]')].filter(node => node.getBoundingClientRect().width > 0).length === 3);
  assert.equal(await panel.getByRole("button", { name: "Restore file panel width", exact: true }).getAttribute("aria-pressed"), "true", "pane Escape restores panes, not the outer workspace");
  // The same saved split tree survives a phone-sized projection and restoration.
  await page.setViewportSize({ ...originalViewport, width: 390 });
  await panel.getByLabel("Choose pane").waitFor();
  await panel.getByLabel("Choose pane").selectOption("pane-1");
  await guide.getByRole("link", { name: "Source 2", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 2 — split-source-2.ts", exact: true }).waitFor({ state: "visible" });
  await panel.getByRole("button", { name: "Back to originating guide", exact: true }).click();
  await guide.waitFor({ state: "visible" });
  await page.setViewportSize(originalViewport);
  await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-file-pane]')].every(node => node.getBoundingClientRect().width > 300));
  assert.equal(await guideNode.evaluate(node => node.isConnected), true);
  // Closing the routed destination requires an explicit next choice, not a fallback.
  await second.getByLabel("Pane actions").click();
  await second.getByRole("button", { name: "Close pane", exact: true }).click();
  await page.getByRole("dialog", { name: "Close pane", exact: true }).getByRole("button", { name: "Close tabs", exact: true }).click();
  await guide.getByRole("link", { name: "Source 3", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "Choose destination", exact: true });
  await recovery.waitFor();
  assert.equal(await panel.locator("[data-file-pane]").count(), 2);
  await recovery.getByRole("button", { name: "Cancel", exact: true }).click();
  await guide.waitFor({ state: "visible" });
  await first.getByLabel("Pane actions").click();
  await first.getByRole("button", { name: "Reset file layout", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-file-pane]').length === 1);
  assert.equal(await guideNode.evaluate(node => node.isConnected), true, "reset retains the selected guide host");
  assert.equal(await panel.getByRole("tab", { name: /^split-guide.md · View/ }).count(), 2, "reset retains and disambiguates both guide views");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#file-panel [data-file-pane] [role="tab"]')]
    .every(tab => document.getElementById(tab.getAttribute("aria-controls"))?.getAttribute("role") === "tabpanel")), true,
  "inactive clean tabs retain valid panel references without mounting their readers");
  await checkOneTimeFileSplits(page, panel, guide);
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  console.log("PASS: explicit three-pane guide routing, preview reuse, edit ownership, responsive projection and stale destination recovery");
}
