import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { withExpectedBrowserConflict } from "./expected-browser-conflict.mjs";

export async function checkScratchpad(page, { base, sessionId, otherId, inputId }) {
  page.setDefaultTimeout(30_000);
  const prefix = `scratch-${inputId}`;
  const trigger = page.locator(".app-topbar").getByRole("button", { name: "Notes", exact: true });
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true });
  const global = dialog.getByRole("textbox", { name: "Global", exact: true });
  const local = dialog.getByRole("textbox", { name: "This session", exact: true });
  const open = async () => {
    await trigger.click(); await dialog.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".scratchpad-note textarea")].length === 2
      && [...document.querySelectorAll(".scratchpad-note textarea")].every((el) => !el.disabled));
  };
  const saved = async (scope, text) => {
    await waitForAsyncCondition(page, async ({ scope, text }) => {
      const response = await fetch(`/api/scratchpad${scope === null ? "" : `?sessionId=${encodeURIComponent(scope)}`}`);
      if (!response.ok) throw new Error(`Scratchpad read: ${response.status}`);
      return (await response.json()).text === text;
    }, { scope, text });
    await page.waitForFunction(() => [...document.querySelectorAll(".scratchpad-status [role=status]")].every((el) => el.textContent === "Saved to server"));
  };
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".markdown-code-block pre").waitFor();
  await open();
  assert.equal(await dialog.evaluate((el) => el.tagName === "DIALOG" && el.matches(":modal") && el.contains(document.activeElement)), true);
  await global.focus();
  await global.dispatchEvent("compositionstart", { data: "" });
  await global.press("Escape");
  assert.equal(await dialog.isVisible(), true, "IME cancellation does not close Notes");
  await global.dispatchEvent("compositionend", { data: "" });
  const originalUrl = page.url();
  await global.press("Control+Alt+n");
  assert.equal(page.url(), originalUrl, "Dialog keys cannot create a background chat");
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  const g = await global.boundingBox(), l = await local.boundingBox();
  if (viewport.width > 640) assert.ok(l.x > g.x + g.width, "Desktop editors are side by side");
  else assert.ok(l.y > g.y + g.height, "Mobile editors stack");
  await global.fill(prefix); await saved(null, prefix);
  assert.equal(await global.evaluate((el) => document.activeElement === el), true, "Autosave does not require blur");
  await local.fill(`${prefix}-session`); await saved(sessionId, `${prefix}-session`);
  await global.press("End"); await global.pressSequentially(" xyz"); await saved(null, `${prefix} xyz`);
  await global.press("Control+z"); assert.equal(await global.inputValue(), prefix); await saved(null, prefix);
  await global.press("Control+Shift+z"); assert.equal(await global.inputValue(), `${prefix} xyz`); await saved(null, `${prefix} xyz`);
  assert.equal(await local.inputValue(), `${prefix}-session`, "Undo never touches the other scope");
  await global.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
  await open(); await dialog.getByRole("button", { name: "Undo Global notes", exact: true }).click();
  assert.equal(await global.inputValue(), prefix); await saved(null, prefix);
  await dialog.getByRole("button", { name: "Redo Global notes", exact: true }).click(); await saved(null, `${prefix} xyz`);
  await dialog.getByRole("button", { name: "Close notes", exact: true }).click();
  // Navigating to another saved chat preserves the global note but not the session note.
  await page.goto(`${base}/?session=${otherId}`, { waitUntil: "domcontentloaded" });
  await open(); assert.equal(await global.inputValue(), `${prefix} xyz`);
  await local.fill(`${prefix}-other`); await saved(otherId, `${prefix}-other`);
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" }); await open();
  assert.equal(await local.inputValue(), `${prefix}-session`);
  // Independent HTTP client advances the server while this focused editor retains its read revision.
  await global.focus();
  const prior = await (await fetch(`${base}/api/scratchpad`)).json();
  const remote = `${prefix}-external`;
  const response = await fetch(`${base}/api/scratchpad`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: null, text: remote, revision: prior.revision }) });
  assert.equal(response.status, 200);
  const mine = `${prefix}-local`;
  await withExpectedBrowserConflict(page, { scenario: "Scratchpad stale writer retains local text", url: `${base}/api/scratchpad`, method: "PUT",
    body: { sessionId: null, text: mine, revision: prior.revision } }, async () => {
    const refusal = page.waitForResponse((r) => r.url() === `${base}/api/scratchpad` && r.request().method() === "PUT");
    await global.fill(mine);
    const rejected = await refusal;
    assert.equal((await rejected.json()).current.text, remote);
    await dialog.getByText("Changed in another browser", { exact: true }).waitFor();
    assert.equal(await global.inputValue(), mine);
    return rejected;
  });
  await page.reload({ waitUntil: "domcontentloaded" }); await open();
  assert.equal(await global.inputValue(), mine, "Immediate local recovery survives reload during a conflict");
  await dialog.getByText("Changed in another browser", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Save my version", exact: true }).click(); await saved(null, mine);
  await dialog.getByRole("button", { name: "Close notes", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" }); await open();
  assert.equal(await global.inputValue(), mine); assert.equal(await local.inputValue(), `${prefix}-session`);
  assert.equal(await dialog.getByRole("button", { name: "Undo Global notes", exact: true }).isDisabled(), true, "Reload restores text, not undo history");
  await local.scrollIntoViewIfNeeded();
  await dialog.getByRole("button", { name: "Undo This session notes", exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await dialog.getByRole("button", { name: "Close notes", exact: true }).click();
}
