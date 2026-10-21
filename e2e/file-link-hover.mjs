import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkFileLinkHoverFocus(page, guide) {
  const composer = page.locator(".chat-input-textarea:visible");
  const toolbar = page.getByRole("toolbar", { name: "File link actions", exact: true });
  await composer.focus();
  await guide.getByRole("link", { name: "Dense one", exact: true }).hover();
  await toolbar.waitFor();
  assert.equal(await composer.evaluate(element => document.activeElement === element), true, "hover never steals composer focus");
  await page.keyboard.press("Escape");
  await toolbar.waitFor({ state: "hidden" });
  assert.equal(await composer.evaluate(element => document.activeElement === element), true, "passive-hover dismissal leaves composer focus alone");
}

async function readingLine(page, view, line) {
  const target = view.locator(`[data-line-number="${line}"][data-file-line-target]`);
  await target.waitFor();
  await page.waitForFunction(element => {
    const root = element.closest(".file-viewer-content");
    if (!root || !element.isConnected) return false;
    const pane = root.getBoundingClientRect(), rect = element.getBoundingClientRect();
    return rect.top >= pane.top - 1 && rect.bottom <= pane.bottom + 1;
  }, await target.elementHandle());
}

export async function checkFileLinkFollowing(page, panel, guide, artifacts, mobile = false) {
  const viewport = page.viewportSize();
  const back = async () => { if (mobile && !await guide.isVisible()) await panel.getByRole("button", { name: "Back to originating guide", exact: true }).click(); };
  const toolbar = page.getByRole("toolbar", { name: "File link actions", exact: true });
  await guide.getByRole("link", { name: "Dense one", exact: true }).hover();
  await toolbar.getByRole("button", { name: "Follow links", exact: true }).click();
  await toolbar.getByRole("button", { name: mobile ? "Open and follow in new pane below" : "Open and follow in new pane right", exact: true }).click();
  const source = panel.getByRole("tabpanel", { name: "Pane 2 — split-source-1.ts", exact: true });
  await readingLine(page, source, 40);
  const reader = await source.locator(".file-viewer-content").elementHandle();
  await back();
  if (mobile) {
    assert.equal(await guide.isVisible(), true, "a fitting below split retains both phone readers");
    await page.setViewportSize({ ...viewport, height: 520 });
    await panel.getByLabel("Choose pane").waitFor();
    await panel.locator('[data-file-pane="pane-1"]').getByLabel("File link destination").selectOption("here");
    await guide.getByRole("link", { name: "Dense one", exact: true }).hover();
    await toolbar.getByRole("button", { name: "Follow links", exact: true }).click();
    await toolbar.getByRole("button", { name: /^Open and follow in Pane 2/ }).click();
    await readingLine(page, source, 40);
    await back();
  }
  assert.equal(await panel.locator('[data-file-pane="pane-1"]').getByLabel("File link destination").inputValue(), "pane-2");
  assert.equal(await panel.locator("[data-file-pane]").count(), 2);
  await guide.getByRole("link", { name: "Dense next", exact: true }).click();
  await readingLine(page, source, 70);
  assert.equal(await source.locator('[data-line-number="40"][data-file-line-target]').count(), 0);
  if (!mobile) assert.equal(await reader.evaluate(element => element.isConnected), true, "following a same-file range retains the reader");
  await source.locator(".file-viewer-content").evaluate(element => { element.scrollTop = 0; });
  await back();
  await guide.getByRole("link", { name: "Dense next", exact: true }).click();
  await readingLine(page, source, 70);
  await back();
  await guide.getByRole("link", { name: "Dense two", exact: true }).click();
  await readingLine(page, panel.getByRole("tabpanel", { name: "Pane 2 — split-source-2.ts", exact: true }), 40);
  assert.equal(await panel.locator("[data-file-pane]").count(), 2);
  assert.equal(await panel.locator('[data-file-pane="pane-2"] [role="tab"]').count(), 1);
  assert.equal(await panel.locator('[data-file-pane="pane-2"]').getByLabel("File link destination").inputValue(), "here", "receiving files do not inherit the source route");
  if (artifacts) await page.screenshot({ path: join(artifacts, mobile ? "file-link-following-touch.png" : "file-link-following.png") });
  await back();
  if (mobile) await page.setViewportSize(viewport);
}

export async function checkIndependentFollowRoutes(page, panel, guide) {
  const toolbar = page.getByRole("toolbar", { name: "File link actions", exact: true });
  const first = panel.locator('[data-file-pane="pane-1"]');
  await guide.getByRole("link", { name: "Chapter", exact: true }).click({ button: "right" });
  await toolbar.getByRole("button", { name: "Open here", exact: true }).click();
  const chapter = panel.getByRole("tabpanel", { name: "Pane 1 — split-chapter.md", exact: true });
  await chapter.getByRole("heading", { name: "Independent chapter", exact: true }).waitFor();
  assert.equal(await first.getByLabel("File link destination").inputValue(), "here");
  await chapter.getByRole("link", { name: "Chapter source 1", exact: true }).hover();
  await toolbar.getByRole("button", { name: "Follow links", exact: true }).click();
  await toolbar.getByRole("button", { name: /^Open and follow in Pane 3/ }).click();
  await readingLine(page, panel.getByRole("tabpanel", { name: "Pane 3 — split-source-1.ts", exact: true }), 40);
  assert.equal(await first.getByLabel("File link destination").inputValue(), "pane-3");
  await chapter.getByRole("link", { name: "Chapter source 3", exact: true }).click();
  await readingLine(page, panel.getByRole("tabpanel", { name: "Pane 3 — split-source-3.ts", exact: true }), 40);
  assert.equal(await panel.locator('[data-file-pane="pane-3"]').getByRole("tab", { name: /Preview/ }).count(), 1);
  await first.getByRole("tab", { name: "split-guide.md", exact: true }).click();
  assert.equal(await first.getByLabel("File link destination").inputValue(), "pane-2");
  await guide.getByRole("link", { name: "Source 1", exact: true }).click();
  await readingLine(page, panel.getByRole("tabpanel", { name: "Pane 2 — split-source-1.ts", exact: true }), 40);
  assert.equal(await panel.getByRole("tabpanel", { name: "Pane 3 — split-source-3.ts", exact: true }).isVisible(), true);
  await first.getByRole("tab", { name: "split-chapter.md", exact: true }).click();
  assert.equal(await first.getByLabel("File link destination").inputValue(), "pane-3");
  await first.getByRole("tab", { name: "split-guide.md", exact: true }).click();
  assert.equal(await panel.locator("[data-file-pane]").count(), 3);
}

export async function checkOneTimeFileSplits(page, panel, guide) {
  const first = panel.locator('[data-file-pane="pane-1"]');
  const route = await first.getByLabel("File link destination").inputValue();
  const toolbar = page.getByRole("toolbar", { name: "File link actions", exact: true });
  for (const [link, action, file, count] of [["Dense one", "Open once in new pane right", "split-source-1.ts", 2], ["Dense two", "Open once in new pane below", "split-source-2.ts", 3]]) {
    await guide.getByRole("link", { name: link, exact: true }).hover();
    await toolbar.getByRole("button", { name: action, exact: true }).click();
    await readingLine(page, panel.getByRole("tabpanel", { name: new RegExp(` — ${file.replaceAll(".", "\\.")}$`) }), 40);
    assert.equal(await panel.locator("[data-file-pane]").count(), count);
    assert.equal(await first.getByLabel("File link destination").inputValue(), route, "one-shot opens never establish or change a follow route");
  }
  await first.getByLabel("Pane actions").click();
  await first.getByRole("button", { name: "Reset file layout", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-file-pane]").length === 1);
}

/** Extends the existing file-workspace chain; no separate fixture or inventory. */
export async function checkFileLinkHover(page, panel, guide, artifacts) {
  const link = guide.getByRole("link", { name: "Dense one", exact: true });
  const paragraph = guide.locator("p").filter({ hasText: "Dense review:" });
  const toolbar = page.getByRole("toolbar", { name: "File link actions", exact: true });
  const layout = () => paragraph.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, links: [...element.querySelectorAll("a")].map(anchor => {
      const a = anchor.getBoundingClientRect(), wrapper = anchor.parentElement.getBoundingClientRect();
      return { x: a.x, y: a.y, width: a.width, reserved: wrapper.width - a.width };
    }) };
  });
  await link.scrollIntoViewIfNeeded();
  const before = await layout();
  assert.ok(before.links.every(item => Math.abs(item.reserved) < 1), "links reserve no inline menu space");

  if (page.viewportSize().width <= 640) {
    // Real Chromium touch input, including native context-menu/compatibility-click behavior.
    const touch = await page.context().newCDPSession(page);
    const point = await link.boundingBox();
    try {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x + point.width / 2, y: point.y + point.height / 2 }] });
      await toolbar.waitFor();
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally { await touch.detach(); }
    assert.equal(await guide.isVisible(), true, "a long press does not also follow the link");
    assert.equal(await panel.locator("[data-file-pane]").count(), 1);
    await toolbar.getByRole("button", { name: "Follow links", exact: true }).click();
    await toolbar.getByRole("button", { name: "Open and follow in new pane below", exact: true }).waitFor();
    assert.equal(await panel.locator("[data-file-pane]").count(), 1, "opening Follow choices alone does not create a pane");
    await toolbar.getByRole("button", { name: "More link actions", exact: true }).click();
    await toolbar.getByRole("button", { name: "Copy link", exact: true }).waitFor();
    if (artifacts) await page.screenshot({ path: join(artifacts, "file-link-hover-touch.png") });
    await page.keyboard.press("Escape");
    await toolbar.waitFor({ state: "hidden" });
    await link.press("Enter");
    await panel.getByRole("tabpanel", { name: "Pane 1 — split-source-1.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
    await panel.locator('[data-file-pane="pane-1"]').getByRole("tab", { name: "split-guide.md", exact: true }).click();
    await guide.getByRole("heading", { name: "Guided review", exact: true }).waitFor();
    return;
  }

  await link.hover();
  await toolbar.waitFor();
  await toolbar.getByRole("button", { name: "Follow links", exact: true }).waitFor();
  assert.deepEqual(await layout(), before, "hovering never shifts text or following links");
  const rect = await toolbar.boundingBox(), anchor = await link.boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= page.viewportSize().width);
  assert.ok(Math.min(Math.abs(rect.y + rect.height - anchor.y), Math.abs(rect.y - anchor.y - anchor.height)) <= 8,
    "toolbar is anchored to the link, not centered in the page");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await toolbar.getByRole("button", { name: "Open here", exact: true }).waitFor();
  if (artifacts) await page.screenshot({ path: join(artifacts, "file-link-hover-compact.png") });
  await toolbar.getByRole("button", { name: "More link actions", exact: true }).click();
  await toolbar.getByRole("button", { name: /^Open in Pane 1/ }).waitFor();
  assert.deepEqual(await layout(), before, "expanded pane choices remain out of flow");
  await page.keyboard.press("Escape");
  await toolbar.waitFor({ state: "hidden" });
  assert.equal(await link.evaluate(element => document.activeElement === element), true);
  assert.equal(await panel.getByRole("button", { name: "Restore file panel width", exact: true }).getAttribute("aria-pressed"), "true",
    "toolbar Escape does not collapse expanded Files");

  // Keyboard focus and native DOM tab order expose the same bar without a modifier.
  await link.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await toolbar.waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await toolbar.getByRole("button", { name: "Open here", exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("End");
  assert.equal(await toolbar.getByRole("button", { name: "More link actions", exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await toolbar.getByRole("button", { name: "Open here", exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await toolbar.getByRole("button", { name: "More link actions", exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press("Escape");
  await toolbar.waitFor({ state: "hidden" });
  await link.press("Shift+F10");
  await toolbar.getByRole("button", { name: "Copy link", exact: true }).waitFor();
  await toolbar.getByRole("button", { name: "Follow links", exact: true }).press("Enter");
  await toolbar.getByRole("button", { name: "Open and follow in new pane right", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await toolbar.waitFor({ state: "hidden" });

  // Top-layer controls escape the reader's overflow clipping without moving its text.
  const scroller = guide.locator(".file-viewer-content").first();
  await scroller.evaluate(element => {
    const anchor = [...element.querySelectorAll("a")].find(item => item.textContent === "Dense one");
    element.scrollTop += anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - 2;
  });
  await link.hover();
  await toolbar.waitFor();
  assert.ok((await toolbar.boundingBox()).y < (await scroller.boundingBox()).y);
  assert.equal(await toolbar.getByRole("button", { name: "Open here", exact: true }).evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), true, "overflowing toolbar controls remain real pointer targets");
  if (artifacts) await page.screenshot({ path: join(artifacts, "file-link-hover-overflow.png") });
  await page.keyboard.press("Escape");
  await toolbar.waitFor({ state: "hidden" });
  await scroller.evaluate(element => { element.scrollTop = 0; });

  // Direct Here is a one-shot action; the original document remains a tab.
  await link.hover();
  await toolbar.getByRole("button", { name: "Open here", exact: true }).click();
  await panel.getByRole("tabpanel", { name: "Pane 1 — split-source-1.ts", exact: true }).locator('[data-line-number="40"][data-file-line-target]').waitFor();
  assert.equal(await panel.locator("[data-file-pane]").count(), 1);
  await panel.locator('[data-file-pane="pane-1"]').getByRole("tab", { name: "split-guide.md", exact: true }).click();
  await guide.getByRole("heading", { name: "Guided review", exact: true }).waitFor();
  assert.equal(await panel.locator('[data-file-pane="pane-1"]').getByLabel("File link destination").inputValue(), "here");
}
