import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";

function notesSurface(page) {
  const trigger = page.locator(".app-topbar").getByRole("button", { name: "Notes", exact: true });
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true });
  const global = dialog.getByRole("textbox", { name: "Global", exact: true });
  const local = dialog.getByRole("textbox", { name: "This session", exact: true });
  const ready = async () => {
    await dialog.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".scratchpad-note textarea")].length === 2
      && [...document.querySelectorAll(".scratchpad-note textarea")].every(el => !el.disabled));
    assert.equal(await dialog.evaluate(el => el.tagName === "DIALOG" && el.matches(":modal")
      && el.contains(document.activeElement)), true);
  };
  return { trigger, dialog, global, local, ready };
}

async function saved(page, scope, text) {
  await waitForAsyncCondition(page, async ({ scope, text }) => {
    const response = await fetch(`/api/scratchpad${scope === null ? "" : `?sessionId=${encodeURIComponent(scope)}`}`);
    if (!response.ok) throw new Error(`Scratchpad read: ${response.status}`);
    return (await response.json()).text === text;
  }, { scope, text });
  await page.waitForFunction(() => [...document.querySelectorAll(".scratchpad-status [role=status]")]
    .every(el => el.textContent === "Saved to server"));
}

/** Native keyboard/modal + one global/session durable roundtrip, no conflict matrix. */
export async function checkNotesNativeJourney(page, { base, sessionId }) {
  page.setDefaultTimeout(30_000);
  const prefix = "scratch-en-desktop";
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".markdown-code-block pre").waitFor();
  const { trigger, dialog, global, local, ready } = notesSurface(page);
  await trigger.click(); await ready();
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  const g = await global.boundingBox(), l = await local.boundingBox();
  assert.ok(g && l && l.x > g.x + g.width, "Desktop editors are side by side");
  await global.focus();
  await global.dispatchEvent("compositionstart", { data: "" });
  await global.press("Escape");
  assert.equal(await dialog.isVisible(), true, "IME cancellation does not close Notes");
  await global.dispatchEvent("compositionend", { data: "" });
  const originalUrl = page.url();
  await global.press("Control+Alt+n");
  assert.equal(page.url(), originalUrl, "Native modal keys cannot create a background chat");
  await global.fill(prefix); await saved(page, null, prefix);
  assert.equal(await global.evaluate(el => document.activeElement === el), true);
  await local.fill(`${prefix}-session`); await saved(page, sessionId, `${prefix}-session`);
  await global.press("End"); await global.pressSequentially(" xyz"); await saved(page, null, `${prefix} xyz`);
  await global.press("Control+z"); assert.equal(await global.inputValue(), prefix); await saved(page, null, prefix);
  await global.press("Control+Shift+z"); assert.equal(await global.inputValue(), `${prefix} xyz`); await saved(page, null, `${prefix} xyz`);
  assert.equal(await local.inputValue(), `${prefix}-session`, "Native undo does not touch the other scope");
  await global.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await trigger.click(); await ready();
  assert.equal(await global.inputValue(), `${prefix} xyz`);
  assert.equal(await local.inputValue(), `${prefix}-session`);
  await dialog.getByRole("button", { name: "Close notes", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  console.log("PASS: desktop Notes native undo/focus/modal isolation and global/session persistence once");
}

/** Fresh 390x600 touch context reads the desktop predecessor; it never rewrites notes. */
export async function checkNotesTouchGeometry(page, { base, sessionId }) {
  page.setDefaultTimeout(30_000);
  assert.deepEqual(page.viewportSize(), { width: 390, height: 600 });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".markdown-code-block pre").waitFor();
  const { trigger, dialog, global, local, ready } = notesSurface(page);
  await trigger.tap(); await ready();
  assert.equal(await global.inputValue(), "scratch-en-desktop xyz", "Actual shared server predecessor, not a fabricated layout body");
  assert.equal(await local.inputValue(), "scratch-en-desktop-session");
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0
    && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  const g = await global.boundingBox(), l = await local.boundingBox();
  assert.ok(g && l && l.y > g.y + g.height, "Short-touch editors stack");
  await local.scrollIntoViewIfNeeded();
  await local.tap();
  assert.equal(await local.evaluate(el => document.activeElement === el), true);
  const undo = dialog.getByRole("button", { name: "Undo This session notes", exact: true });
  await undo.scrollIntoViewIfNeeded();
  assert.equal(await undo.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight
      && el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), true, "Last scope action is reachable inside native modal");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const close = dialog.getByRole("button", { name: "Close notes", exact: true });
  await close.scrollIntoViewIfNeeded(); await close.tap();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  console.log("PASS: short-touch Notes top-layer bounds, stacked editors, focus and scroll reachability without repeated writes");
}
