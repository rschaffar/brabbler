import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Runs in the existing Markdown inventory chain, with synthetic user files. */
export async function checkFileWorkspace(page, base, fixture) {
  await page.goto(`${base}/?session=${fixture.sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Split guide", exact: true }).click();
  const panel = page.locator("#file-panel"), guide = panel.getByRole("tabpanel", { name: "Pane 1 — split-guide.md", exact: true });
  await guide.getByRole("heading", { name: "Guided review", exact: true }).waitFor();
  assert.equal(await panel.locator("[data-file-pane]").count(), 1);
  const originalViewport = page.viewportSize();
  if (originalViewport.width <= 640) {
    await panel.locator('[data-file-pane="pane-1"]').getByLabel("File link destination").selectOption("here");
    await guide.getByRole("link", { name: "Source 1", exact: true }).click();
    await panel.getByRole("tabpanel", { name: "Pane 1 — split-source-1.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
    assert.equal(await panel.locator("[data-file-pane]").count(), 1, "mobile ordinary links never create panes");
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    return;
  }
  await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-file-pane="pane-1"] option[value="new-right"]')?.disabled);
  const guideNode = await guide.elementHandle();
  await panel.locator('[data-file-pane="pane-1"]').getByLabel("File link destination").selectOption("new-right");
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
  // Splitting below creates a third independently retained file view.
  const second = panel.locator('[data-file-pane="pane-2"]');
  await second.getByLabel("Pane actions").click();
  await second.getByRole("button", { name: "Split below", exact: true }).click();
  assert.equal(await second.locator("details").getAttribute("open"), null, "pane actions close after activation");
  await page.waitForFunction(() => document.querySelectorAll('[data-file-pane]').length === 3);
  await guide.getByRole("link", { name: "Test evidence", exact: true }).click({ button: "right" });
  const menu = page.getByRole("dialog", { name: "File link actions", exact: true });
  await menu.getByRole("button", { name: /^Open in Pane 3/ }).click();
  await panel.getByRole("tabpanel", { name: "Pane 3 — split-tests.ts", exact: true }).locator('[data-line-number="2"][data-file-line-target]').waitFor();
  await guide.getByRole("link", { name: "Source 1", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 2 — split-source-1.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
  assert.equal(await panel.getByRole("tabpanel", { name: "Pane 3 — split-tests.ts", exact: true }).isVisible(), true);
  // An editor has one server-identified owner even across two file views.
  const code = panel.getByRole("tabpanel", { name: "Pane 2 — split-source-1.ts", exact: true });
  await code.getByRole("button", { name: "Edit", exact: true }).click();
  await code.getByRole("textbox", { name: "Edit", exact: true }).fill("// a retained workspace draft\n");
  await guide.getByRole("link", { name: "Source 1", exact: true }).click({ button: "right" });
  await menu.getByRole("button", { name: /^Open in Pane 3/ }).click();
  const duplicate = panel.getByRole("tabpanel", { name: "Pane 3 — split-source-1.ts", exact: true });
  await duplicate.getByRole("button", { name: "Go to editor", exact: true }).waitFor();
  assert.equal(await duplicate.getByRole("button", { name: "Edit", exact: true }).count(), 0);
  await duplicate.getByRole("button", { name: "Go to editor", exact: true }).click();
  assert.equal(await code.getByRole("textbox", { name: "Edit", exact: true }).inputValue(), "// a retained workspace draft\n");
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
  await fourth.getByLabel("Pane actions").click();
  await fourth.getByRole("button", { name: "Close pane", exact: true }).click();
  await page.getByRole("dialog", { name: "Close pane", exact: true }).getByRole("button", { name: "Close tabs", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-file-pane]').length === 3);
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
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  console.log("PASS: explicit three-pane guide routing, preview reuse, edit ownership, responsive projection and stale destination recovery");
}
