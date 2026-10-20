import assert from "node:assert/strict";
import { createOwnedRoutes } from "./owned-routes.mjs";

/** UI-only synthetic managed provider; route tests separately prove the real SDK writer. */
export async function checkManagedModelContext(page) {
  const untouched = { api: "openai-completions", models: [{ id: "keep-me" }] };
  let saved = { providers: { "openai-codex": { modelOverrides: { "fixture-context-model": {} } }, relay: untouched } };
  let writes = 0, rejectSave = false, failDiscovery = true, projectScope = false;
  const scopeWrites = [];
  const paths = new Set(["/api/models-config", "/api/auth/providers", "/api/models/enabled", "/api/provider-usage/query"]);
  const matches = url => paths.has(url.pathname);
  const routes = createOwnedRoutes(async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/models-config") {
      if (route.request().method() === "PUT") {
        writes++;
        if (rejectSave) return route.fulfill({ json: { error: "Synthetic save unavailable" } });
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { success: true } });
      }
      return route.fulfill({ json: saved });
    }
    if (path === "/api/auth/providers") return route.fulfill({ json: failDiscovery ? { error: "Synthetic provider discovery unavailable" } : {
      oauthProviders: [{ id: "openai-codex", name: "OpenAI Codex", loggedIn: false }],
      apiKeyProviders: [{ id: "openai-codex", displayName: "OpenAI Codex", configured: true, modelCount: 1 }],
    } });
    if (path === "/api/provider-usage/query") return route.fulfill({ json: { providers: [] } });
    if (route.request().method() === "PUT") scopeWrites.push({ projectScope, body: route.request().postDataJSON() });
    return route.fulfill({ json: {
      allEnabled: true, patterns: null, stalePatterns: [], enabledTotal: 1, availableTotal: 1,
      scope: projectScope ? "project" : "global", settingsPath: "synthetic/settings.json", editable: !projectScope,
      providers: [{ id: "openai-codex", name: "OpenAI Codex", kind: "builtin", enabledCount: 1, models: [{
        id: "fixture-context-model", name: "Fixture Context Model", ref: "openai-codex/fixture-context-model", enabled: true,
        contextWindow: saved.providers["openai-codex"]?.modelOverrides?.["fixture-context-model"]?.contextWindow ?? 272000,
      }] }],
    } });
  }, route => route.fulfill({ json: {} }));
  await page.route(matches, routes.handler);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const open = async (selectProvider = true) => {
    const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const picker = dialog.getByRole("combobox", { name: "Settings", exact: true });
    if (await picker.isVisible()) await picker.selectOption("models");
    else await dialog.getByRole("button", { name: "Models", exact: true }).click();
    if (selectProvider) await dialog.locator(".config-sidebar-item").filter({ hasText: "OpenAI Codex" }).click();
  };
  const input = dialog.getByRole("textbox", { name: "Context window for Fixture Context Model", exact: true });
  const save = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(reply => new URL(reply.url()).pathname === "/api/models-config" && reply.request().method() === "PUT"),
      dialog.locator("footer").getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    await response.finished();
  };
  try {
    await open(false);
    await dialog.getByRole("alert").filter({ hasText: "Provider discovery is unavailable" }).waitFor();
    assert.equal(await dialog.locator(".config-sidebar-item").filter({ hasText: /^openai-codex$/ }).count(), 0, "failed discovery cannot expose a managed override as a custom provider");
    failDiscovery = false;
    await dialog.getByRole("button", { name: "Retry provider discovery", exact: true }).click();
    await input.waitFor(); // automatic routing must choose active API-key auth, not a manual sidebar click
    assert.equal(await input.getAttribute("placeholder"), "272000", "active API-key auth wins over inactive OAuth for a dual-auth provider");
    await input.fill("500000");
    assert.equal(writes, 0, "budget is a draft, not an immediate switch write");
    await save();
    assert.equal(saved.providers["openai-codex"].modelOverrides["fixture-context-model"].contextWindow, 500000);
    assert.deepEqual(saved.providers.relay, untouched);
    assert.deepEqual(Object.keys(saved.providers["openai-codex"]), ["modelOverrides"], "discovery failure must not add a guessed custom-provider API");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await open();
    assert.equal(await input.inputValue(), "500000");
    assert.equal(await dialog.locator(".config-sidebar-item").filter({ hasText: /^openai-codex$/ }).count(), 0);
    await input.fill("500k");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    await dialog.locator("footer").getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "enter a positive whole number" }).waitFor();
    assert.equal(writes, 1);
    assert.equal(await input.inputValue(), "500k");
    await input.fill("600000");
    rejectSave = true;
    await save();
    await dialog.getByRole("alert").filter({ hasText: "Synthetic save unavailable" }).waitFor();
    assert.equal(await input.inputValue(), "600000");
    rejectSave = false;
    await save();
    assert.equal(saved.providers["openai-codex"].modelOverrides["fixture-context-model"].contextWindow, 600000);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    projectScope = true;
    await open();
    await dialog.getByText("This project's .pi/settings.json sets enabledModels and overrides the global value, so these switches are read-only. Edit that file to change the list.", { exact: true }).waitFor();
    const bounds = await input.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
    await input.fill("");
    await save();
    assert.deepEqual(saved, { providers: { relay: untouched } });
    await input.locator('xpath=self::*[@placeholder="272000"]').waitFor();
    assert.equal(scopeWrites.filter(write => write.projectScope).length, 0, "project-shadowed views must reload without mutating enabledModels");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    console.log(`PASS: ${page.viewportSize().width}px managed budget draft/save/reopen/clear/invalid/failure preserve sibling config`);
  } finally {
    await routes.dispose(handler => page.unroute(matches, handler));
  }
}
