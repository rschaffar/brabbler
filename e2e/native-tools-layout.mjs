import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MODEL_SPEED_IDS } from "./model-speed.mjs";

export async function checkNativeToolsModalLayout(page, { base, api, fixture }) {
  const id = MODEL_SPEED_IDS[1];
  const starts = () => existsSync(fixture.starts) ? readFileSync(fixture.starts, "utf8") : "";
  const before = starts();
  await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
  const input = page.locator("textarea").last();
  await input.fill("Mobile native draft retained");
  const trigger = page.getByRole("button", { name: "Session tools", exact: true });
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Session tools", exact: true });
  await dialog.getByText("oauth", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('dialog[open] fieldset')?.disabled);
  const native = await dialog.evaluate(node => ({ native: node instanceof HTMLDialogElement,
    open: node.open, modal: node.matches(":modal"), focusInside: node.contains(document.activeElement) }));
  console.log("NATIVE_MODAL_READY", JSON.stringify(native));
  assert.deepEqual({ native: native.native, open: native.open, modal: native.modal }, { native: true, open: true, modal: true });
  // Loading temporarily disables the initial focusable fieldset. Observe native
  // keyboard containment after a real Tab, not a new auto-refocus-on-load policy.
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate(node => node instanceof HTMLDialogElement && node.open && node.matches(":modal") && node.contains(document.activeElement)), true,
    "real native top-layer dialog contains keyboard focus");
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845);
  assert.equal(starts(), before, "metadata must not start another stdio lifecycle");
  // This other session remains off after the desktop OTHER-busy window. Apply
  // proves the installed control binding without repeating a native tool turn.
  assert.equal(await dialog.getByRole("checkbox", { name: "Code-mode", exact: true }).isChecked(), false);
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await apply.scrollIntoViewIfNeeded();
  assert.equal(await apply.evaluate(node => {
    const r = node.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), true, "Apply is reachable through native modal overflow");
  const [response] = await Promise.all([
    page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/agent/${id}` && reply.request().method() === "POST" && reply.request().postDataJSON()?.type === "set_native_resources"),
    apply.click(),
  ]);
  const off = { version: 1, codeMode: false, mcpServers: [] };
  assert.deepEqual(response.request().postDataJSON(), { type: "set_native_resources", nativeResources: off });
  assert.equal(response.status(), 200);
  assert.equal((await response.json()).success, true);
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "Mobile native draft retained");
  assert.deepEqual((await api(`/api/sessions/${id}`)).nativeResources, off);
  assert.equal(starts(), before, "touch layout must not duplicate native execution");
  await trigger.click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}
