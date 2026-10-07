import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { checkDiffContext, contextPatch, contextContents, changedContextContents } from "./git-diff-context.mjs";

export const filePanelFixture = `<!doctype html><html><body style="margin:20px;min-height:2400px">
<label>Notes <input id="notes"></label>
<label>Filter <select id="filter"><option>All</option><option>Pending</option></select></label>
<p>HTML preview state must survive layout changes.</p>
<script>window.previewInstance = Math.random();</script></body></html>`;

// Mock only the bounded Git response; exercise the real explorer, file tab and renderer.
export async function checkFileDiffViews(page, filePath) {
  const panel = page.locator("#file-panel");
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  const patches = {
    modified: "diff --git a/editable.txt b/editable.txt\n--- a/editable.txt\n+++ b/editable.txt\n@@ -1 +1 @@\n-Old text\n+New text\n",
    added: "diff --git a/editable.txt b/editable.txt\nnew file mode 100644\n--- /dev/null\n+++ b/editable.txt\n@@ -0,0 +1 @@\n+New text\n",
    deleted: "diff --git a/editable.txt b/editable.txt\ndeleted file mode 100644\n--- a/editable.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-Old text\n",
    context: contextPatch("editable.txt"),
  };
  for (const [status, patch] of Object.entries(patches)) {
    if (await showSidebar.isVisible()) await showSidebar.click();
    let contextReads = 0;
    const respond = (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get("op") === "context") {
        contextReads++; assert.equal(query.get("revision"), "a".repeat(64));
        assert.equal(query.get("path"), filePath);
        return route.fulfill({ json: { oldFile: { name: "editable.txt", contents: contextContents, cacheKey: "before" },
          newFile: { name: "editable.txt", contents: changedContextContents, cacheKey: "after" } } });
      }
      return route.fulfill({ json: { supported: true, status: status === "context" ? "modified" : status, patch,
        ...(status === "context" ? { revision: "a".repeat(64) } : {}) } });
    };
    await page.route("**/api/git/diff?*", respond);
    try {
      await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
      if (status !== "deleted") await panel.getByRole("button", { name: "Diff", exact: true }).click();
      const controls = panel.getByRole("group", { name: "Patch view" });
      await panel.getByRole("region", { name: "Side-by-side diff" }).waitFor();
      assert.equal(await controls.getByRole("button", { name: "Side by side", exact: true }).getAttribute("aria-pressed"), "true");
      await panel.getByText("Before · HEAD", { exact: true }).waitFor();
      await panel.getByText("After · Working tree", { exact: true }).waitFor();
      assert.equal(contextReads, 0, "Opening a file never eagerly fetches full context");
      if (status === "context") {
        await checkDiffContext(page, panel, panel);
        assert.equal(contextReads, 1, "Gap expansion and all reading controls share one lazy snapshot read");
        await panel.getByRole("button", { name: "Source", exact: true }).click();
        await panel.getByRole("button", { name: "Diff", exact: true }).click();
        await panel.getByRole("button", { name: "Diff context", exact: true }).waitFor();
        assert.equal(contextReads, 1, "Source/Diff retains the revision-bound model");
      }
      await controls.getByRole("button", { name: "Unified", exact: true }).click();
      await panel.getByRole("region", { name: "Unified diff" }).waitFor();
      assert.equal(await controls.getByRole("button", { name: "Unified", exact: true }).getAttribute("aria-pressed"), "true");
      await controls.getByRole("button", { name: "Raw patch", exact: true }).click();
      assert.equal(await panel.getByRole("region", { name: "Raw patch" }).textContent(), patch);
      await controls.getByRole("button", { name: "Side by side", exact: true }).click();
      await panel.getByRole("region", { name: "Side-by-side diff" }).waitFor();
      if (status !== "deleted") {
        await panel.getByRole("button", { name: "Source", exact: true }).click();
        assert.equal(await controls.count(), 0, "Diff controls do not appear in source mode");
      }
      await panel.getByRole("button", { name: "Close editable.txt" }).click();
      await panel.getByRole("button", { name: "Hide file panel" }).click();
    } finally {
      await page.unroute("**/api/git/diff?*", respond);
    }
  }
  console.log(`PASS: Files explorer split/unified/raw diffs for modified, added and deleted files at ${page.viewportSize().width}px`);
}

export async function checkEditableFile(page, filePath) {
  writeFileSync(filePath, "Initial text\n");
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
  const panel = page.locator("#file-panel");
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = panel.getByRole("textbox", { name: "Edit", exact: true });
  await editor.fill("A draft\n");
  await panel.getByRole("tab", { name: /preview\.html/ }).click();
  await panel.getByRole("tab", { name: /editable\.txt/ }).click();
  assert.equal(await editor.inputValue(), "A draft\n", "tab switching retains the draft");
  await editor.press("ControlOrMeta+s");
  await panel.getByText("Unsaved changes", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(readFileSync(filePath, "utf8"), "A draft\n");

  await editor.fill("Keep this draft");
  writeFileSync(filePath, "External change\n");
  await panel.getByText(/File changed on disk/).waitFor();
  assert.equal(await editor.inputValue(), "Keep this draft", "external writes must not erase drafts");
  assert.equal(await panel.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Discard draft and reload" }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "External change\n");
  await editor.fill("Do not close yet");
  page.once("dialog", (dialog) => dialog.dismiss());
  await panel.getByRole("button", { name: "Close editable.txt" }).click();
  assert.equal(await editor.inputValue(), "Do not close yet", "cancel keeps the dirty tab");
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Close editable.txt" }).click();
  await panel.getByRole("button", { name: "Hide file panel" }).click();
  console.log("PASS: file edit, save, tab draft retention and external-change conflict");
}

export async function checkFilePanel(page, filePath) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  // The DOM title normalizes Windows paths to forward slashes
  // (lib/file-paths.ts normalizeFilePathSlashes), so match in that form.
  await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
  const panel = page.locator("#file-panel");
  const iframe = panel.locator("iframe");
  await iframe.waitFor();
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator("#notes").fill("Keep this note");
  await frame.locator("#filter").selectOption({ label: "Pending" });
  await frame.evaluate(() => scrollTo(0, 120));
  const instance = await frame.evaluate(() => window.previewInstance);
  const width = () => panel.evaluate(async el => {
    await new Promise(requestAnimationFrame);
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
    return el.getBoundingClientRect().width;
  });
  const storedWidths = () => page.evaluate(() => [
    localStorage.getItem("pi-sidebar-width"), localStorage.getItem("pi-right-panel-width"),
  ]);
  const toggle = panel.getByRole("button", { name: "Expand file panel", exact: true });
  if (page.viewportSize().width <= 640) {
    assert.equal(await toggle.isVisible(), false, "Mobile already uses full width");
  } else {
    // Include a manually resized split in the round trip.
    const separator = page.locator('[data-resize-handle="right-panel"]');
    if (await separator.isVisible()) await separator.press("ArrowLeft");
    const originalWidth = await width();
    const originalStored = await storedWidths();
    const sessionInfo = page.getByRole("button", { name: "Session info", exact: true });
    const sessionPopover = page.locator(".session-info-popover");
    for (let i = 0; i < 2; i++) {
      await sessionInfo.click();
      await sessionPopover.waitFor();
      await toggle.click();
      assert.equal(await sessionPopover.count(), 0, "Full-width mode dismisses inert top-bar menus");
      assert.equal(await panel.getByRole("button", { name: "Restore file panel width", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(Math.round(await width()), page.viewportSize().width);
      assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), true);
      assert.equal(await frame.evaluate(() => window.previewInstance), instance);
      assert.equal(await frame.evaluate(() => scrollY), 120);
      assert.equal(await frame.locator("#notes").inputValue(), "Keep this note");
      assert.equal(await frame.locator("#filter").inputValue(), "Pending");
      await panel.getByRole("button", { name: "Restore file panel width", exact: true }).press("Enter");
      assert.equal(await width(), originalWidth);
      assert.deepEqual(await storedWidths(), originalStored);
      assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
    }
    await toggle.click();
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    await page.getByRole("button", { name: "Show file panel", exact: true }).click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "Reopening returns to the split layout");
    assert.equal(await width(), originalWidth);
    assert.equal(await frame.evaluate(() => window.previewInstance), instance);
  }
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  console.log(`PASS: file panel width and preview state at ${page.viewportSize().width}px`);
}
