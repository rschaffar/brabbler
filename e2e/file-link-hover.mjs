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
