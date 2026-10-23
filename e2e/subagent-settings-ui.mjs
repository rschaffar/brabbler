import assert from "node:assert/strict";

/** UI-only fragment from the native S chain. Requires its REAL persisted agent
 * definition/provider/model settings; does not manufacture model availability.
 */
export async function checkSubagentModelSettings(page, { width }) {
  // Real controls display the suffixed model as available and retain it when saved.
  if (width <= 640) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  if (width <= 640) await dialog.getByRole("combobox", { name: "Settings", exact: true }).selectOption("agents");
  else await dialog.getByRole("button", { name: "Sub-agents", exact: true }).click();
  await dialog.getByRole("button", { name: /e2e-lifecycle/ }).click();
  await dialog.getByRole("button", { name: "Model override", exact: true }).getByText("e2e-subagents/child:high", { exact: true }).waitFor();
  assert.equal(await dialog.getByText(/Unavailable.*e2e-subagents/).count(), 0);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  if (width <= 640) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });
}
