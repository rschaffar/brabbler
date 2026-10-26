import assert from "node:assert/strict";

// Conditional replacement BODY; parent must close retirement gates and publish
// new receipts before dispatch. Actual installed APIs only, never provider HTTP.
export async function checkInstalledModelContext(page, { base, api, post, sessionId, project }) {
  const responsive = page.viewportSize().width < 768;
  // The ordered desktop input enables/saves this same real service/session.
  // Compact verifies the inherited field and active row without replaying writes.
  if (!responsive) {
    const enabled = await fetch(`${base}/api/models/enabled`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "provider", provider: "e2e-followups", enabled: true, cwd: project }) });
    assert.equal(enabled.status, 200);
    await enabled.json();
  }
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("E2E final answer", { exact: true }).waitFor();
  const uncoverChat = async () => {
    const hide = page.getByRole("button", { name: "Hide sidebar", exact: true });
    if (responsive && await hide.isVisible()) {
      // The drawer overlays the chat's toggle after Settings closes. Use the
      // same real outside-drawer pointer gesture as the retained Files journey.
      await page.locator(".sidebar-overlay-backdrop").click({ position: { x: page.viewportSize().width - 10, y: 200 } });
      await page.getByRole("button", { name: "Show sidebar", exact: true }).waitFor();
    }
  };
  await uncoverChat();
  const reselect = async active => {
    const collapse = page.getByRole("button", { name: "Collapse controls", exact: true });
    if (await collapse.isVisible()) await collapse.click();
    await page.locator(".model-selector.is-toolbar").getByRole("button").click();
    const option = page.getByRole("listbox").getByRole("option", { name: "Adaptive fixture", exact: true });
    await option.waitFor();
    if (active) assert.equal(await option.getAttribute("aria-selected"), "true");
    const [response] = await Promise.all([
      page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/agent/${sessionId}`
        && reply.request().method() === "POST" && reply.request().postDataJSON()?.type === "set_model"),
      option.click(),
    ]);
    assert.equal(response.status(), 200);
    assert.deepEqual(response.request().postDataJSON(), { type: "set_model", provider: "e2e-followups", modelId: "adaptive-fixture" });
    assert.equal((await response.json()).success, true);
    await page.waitForFunction(() => !document.querySelector('.model-selector.is-toolbar button[aria-busy="true"]'));
  };
  // Desktop establishes/applies one changed native definition. Mobile inherits
  // that SAME service/session and uses one active-row chooser gesture. Its real
  // numeric field still has the original scroll/bounds check, without a Save.
  if (!responsive) await reselect(false);
  const before = (await post(`/api/agent/${sessionId}`, { type: "get_state" })).data;
  const nextWindow = before.contextUsage.contextWindow + (responsive ? 0 : 1024);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const openModel = async () => {
    const show = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await show.isVisible()) await show.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const picker = settings.getByRole("combobox", { name: "Settings", exact: true });
    if (await picker.isVisible()) await picker.selectOption("models");
    else await settings.getByRole("button", { name: "Models", exact: true }).click();
    await settings.getByText("e2e-followups", { exact: true }).click();
    await settings.getByText("adaptive-fixture", { exact: true }).click();
  };
  await openModel();
  const field = settings.locator(".config-field").filter({ has: page.getByText("Context window (tokens)", { exact: true }) }).getByRole("spinbutton");
  assert.equal(await field.count(), 1);
  await field.scrollIntoViewIfNeeded();
  const bounds = await field.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds && bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width
    && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, "actual context field fits the original physical Settings viewport");
  if (!responsive) {
    const modelPanel = field.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' config-panel-root ')][1]");
    const modelFooter = modelPanel.locator(":scope > .config-panel-surface > .config-footer > .config-footer-actions");
    assert.equal(await modelFooter.count(), 1);
    await field.fill(String(nextWindow));
    // Scope to the actual Models footer, not the sibling credential Save.
    const [saved] = await Promise.all([
      page.waitForResponse(reply => new URL(reply.url()).pathname === "/api/models-config" && reply.request().method() === "PUT"),
      modelFooter.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    assert.equal(saved.status(), 200);
    const intended = saved.request().postDataJSON();
    assert.equal(intended.providers["e2e-followups"].models[0].contextWindow, nextWindow);
    assert.equal((await saved.json()).success, true);
    await modelFooter.getByRole("button", { name: "Saved", exact: true }).waitFor();
    assert.deepEqual(await api("/api/models-config"), intended, "real installed disk/config readback");
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await openModel();
  }
  assert.equal(await field.inputValue(), String(nextWindow));
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await uncoverChat();
  await reselect(true);
  const after = (await post(`/api/agent/${sessionId}`, { type: "get_state" })).data;
  assert.equal(after.contextUsage.contextWindow, nextWindow);
  assert.equal(after.thinkingLevel, before.thinkingLevel);
  const label = `of ${nextWindow.toLocaleString("en-US")} tokens`;
  await page.waitForFunction(label => [...document.querySelectorAll('button[aria-label="Session info"]')].some(button => button.title.includes(label)), label);
  if (!responsive) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("textarea").last().waitFor();
    await uncoverChat();
    await page.waitForFunction(label => [...document.querySelectorAll('button[aria-label="Session info"]')].some(button => button.title.includes(label)), label);
  }
  assert.ok((await page.locator('button[aria-label="Session info"]:visible').first().getAttribute("title")).includes(label));
  if (!responsive) return { config: await api("/api/models-config"), command: async body => (await post(`/api/agent/${sessionId}`, body)).data, reselect };
}
