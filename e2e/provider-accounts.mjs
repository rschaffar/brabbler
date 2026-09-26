import assert from "node:assert/strict";
import { join } from "node:path";

/** Exercise the account popover with a fake SSE stream: no provider credentials/network required. */
export async function checkProviderAccountAuthorization(page, { base, sessionId, provider, providerName, accountLabel, width, artifacts }) {
  await page.addInitScript(() => {
    const OriginalEventSource = window.EventSource;
    window.__accountOAuthSources = [];
    window.__openedAuthUrls = [];
    window.EventSource = function (url, ...args) {
      if (!String(url).startsWith("/api/auth/login/")) return new OriginalEventSource(url, ...args);
      const source = { url: String(url), onmessage: null, onerror: null, closed: false, close() { this.closed = true; } };
      window.__accountOAuthSources.push(source);
      return source;
    };
    window.__emitAccountOAuth = (data) => {
      const source = window.__accountOAuthSources.at(-1);
      source.onmessage?.({ data: JSON.stringify(data) });
    };
    window.open = (url) => { window.__openedAuthUrls.push(url); return null; }; // Simulate popup blocking.
  });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  const chip = page.getByRole("button", { name: /^Account for/ });
  await chip.waitFor();
  assert.equal(await page.getByLabel("Account provider").count(), 0, "account controls should not occupy permanent composer rows");
  const modelBox = await page.locator(".model-selector.is-toolbar").boundingBox();
  const chipBox = await chip.boundingBox();
  assert.ok(modelBox && chipBox && Math.abs(modelBox.y - chipBox.y) < 6, "account indicator sits beside the model");
  await chip.click();
  const panel = page.getByRole("region", { name: "Provider accounts" });
  await panel.waitFor();
  assert.notEqual(await panel.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)",
    "the account popover must obscure chat text behind it");
  await panel.getByLabel("Account provider").selectOption(provider);
  assert.match(await chip.getAttribute("aria-label"), /^Account for .*Pi default/,
    "managing another provider must not change the model-provider indicator");
  await panel.getByText(accountLabel, { exact: false }).waitFor();
  assert.equal(await panel.getByLabel("Account label").count(), 0, "add-account form stays hidden while existing accounts are visible");
  await panel.getByRole("button", { name: "Add account" }).click();
  await panel.getByLabel("Account label").waitFor();
  await panel.getByRole("button", { name: "Close add form" }).click();
  assert.equal(await panel.getByLabel("Account label").count(), 0);
  await panel.getByText(accountLabel, { exact: false }).waitFor();
  await panel.getByRole("button", { name: "Add account" }).click();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await chip.click();
  assert.equal(await panel.getByLabel("Account label").count(), 0, "reopening the popover does not reopen the add form");
  await panel.getByText(accountLabel, { exact: false }).waitFor();
  await panel.getByRole("button", { name: "Add account" }).click();
  await panel.getByRole("button", { name: "Change login" }).first().click();
  assert.equal(await page.evaluate(() => window.__accountOAuthSources.length), 1);
  assert.equal(await page.evaluate(() => window.__accountOAuthSources.at(-1).url), `/api/auth/login/${encodeURIComponent(provider)}`,
    "Pi default uses the provider-wide login, not a secondary account");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await panel.getByRole("button", { name: "Retry login" }).click();
  assert.match(await page.evaluate(() => window.__accountOAuthSources.at(-1).url), /\?accountId=/,
    "secondary-account reauthorization remains scoped to its ID");
  await page.evaluate(() => window.__emitAccountOAuth({ type: "device_code", verificationUri: "https://github.com/login/device",
    userCode: "WXYZ-1234", expiresInSeconds: 600 }));
  const link = panel.getByRole("link", { name: /Open verification page/ });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), "https://github.com/login/device");
  if (width <= 640) await page.screenshot({ path: join(artifacts, "account-device-390.png") });
  await panel.getByRole("button", { name: "Copy code" }).click();
  await panel.getByRole("button", { name: "Copy code" }).getByText("Copied").waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "WXYZ-1234");
  await page.evaluate(() => window.__emitAccountOAuth({ type: "progress", message: "Waiting for confirmation" }));
  await link.waitFor();
  if (width <= 640) {
    // Simulate the viewport shrinking after focusing an input (mobile keyboard).
    await panel.getByLabel("Account label").focus();
    await page.setViewportSize({ width: 390, height: 360 });
    await page.waitForFunction(() => {
      const region = document.querySelector('[role="region"][aria-label="Provider accounts"]');
      const rect = region?.getBoundingClientRect();
      return rect && rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
    }, undefined, { timeout: 5000 });
    await panel.getByRole("button", { name: "Cancel" }).scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 600 });
  }
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await chip.click();
  await link.waitFor();
  await panel.getByRole("button", { name: "Cancel" }).click();
  assert.equal(await page.evaluate(() => window.__accountOAuthSources.at(-1).closed), true);
  await link.waitFor({ state: "hidden" });

  await panel.getByRole("button", { name: "Retry login" }).click();
  await page.evaluate(() => window.__emitAccountOAuth({ type: "device_code", verificationUri: "javascript:alert(1)", userCode: "unsafe" }));
  await panel.getByRole("alert").getByText("Invalid authorization URL").waitFor();
  assert.equal(await panel.getByRole("link").count(), 0, "malformed device URLs must never be linked");
  assert.equal(await page.evaluate(() => window.__accountOAuthSources.at(-1).closed), true);
  assert.deepEqual(await page.evaluate(() => window.__openedAuthUrls), []);

  await panel.getByRole("button", { name: "Retry login" }).click();
  await page.evaluate(() => window.__emitAccountOAuth({ type: "auth", url: "https://example.com/authorize",
    instructions: "Finish in the provider browser" }));
  await panel.getByText("Finish in the provider browser").waitFor();
  assert.equal(await panel.getByRole("link", { name: /Open authorization page/ }).getAttribute("href"), "https://example.com/authorize");
  assert.deepEqual(await page.evaluate(() => window.__openedAuthUrls), ["https://example.com/authorize"]);
  await panel.getByRole("button", { name: "Cancel" }).click();
  await panel.getByRole("button", { name: "Retry login" }).click();
  await page.evaluate(() => window.__emitAccountOAuth({ type: "prompt_request", token: "test-token", message: "Paste the provider code" }));
  await panel.getByRole("textbox", { name: "Authorization code" }).waitFor();
  assert.equal(await panel.getByLabel("Account provider").isDisabled(), true, "the provider cannot change during authorization");
  await panel.getByRole("button", { name: "Cancel" }).click();
  if (width <= 640) {
    const box = await panel.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1,
      "the account popover stays within the mobile viewport");
  } else {
    // Account-aware usage is a subscription quota, not API-key spend. Mock only
    // the browser's API responses; no live provider credentials are needed.
    const fakeAccount = { id: "e2e-codex-secondary", provider: "openai-codex", label: "Second Codex", type: "oauth", authorized: true };
    const queriedAccounts = [];
    const selectionRoute = async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, accounts: [...data.accounts, fakeAccount] } });
    };
    const usageRoute = async (route) => {
      const { providerId, accountId } = route.request().postDataJSON();
      if (providerId !== "openai-codex") return route.continue();
      queriedAccounts.push(accountId);
      const secondary = accountId === fakeAccount.id;
      await route.fulfill({ json: { providerId, status: "ready", report: { providerId, capturedAt: Date.now(), metrics: [], buckets: [
        { id: "primary", label: "5h", windowMinutes: 300, remaining: secondary ? 50 : 90, unit: "percent" },
        { id: "secondary", label: "Weekly", windowMinutes: 10080, remaining: secondary ? 25 : 70, unit: "percent" },
      ] } } });
    };
    await page.route("**/api/auth/accounts/selection?*", selectionRoute);
    await page.route("**/api/provider-usage/query", usageRoute);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^Account for/ }).click();
    const usagePanel = page.getByRole("region", { name: "Provider accounts" });
    await usagePanel.getByLabel("Account provider").selectOption("openai-codex");
    assert.equal(await usagePanel.getByLabel("Account label").count(), 0);
    await usagePanel.getByText("Weekly 70% remaining · 5h 90% remaining").waitFor();
    await usagePanel.getByText("Weekly 25% remaining · 5h 50% remaining").waitFor();
    assert.ok(queriedAccounts.includes(null) && queriedAccounts.includes(fakeAccount.id), "usage requests are account-specific");
    await page.unroute("**/api/auth/accounts/selection?*", selectionRoute);
    await page.unroute("**/api/provider-usage/query", usageRoute);
    // Start the independent Pi-default settings flow from a fresh page.
    await page.reload({ waitUntil: "domcontentloaded" });
    // Next's development indicator overlaps the sidebar footer in headless mode;
    // dispatch the native button click without that dev-only pointer overlay.
    await page.getByRole("button", { name: "Models", exact: true }).first().evaluate((button) => button.click());
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.waitFor();
    await settings.getByRole("button", { name: "Add provider" }).click();
    await page.getByRole("button", { name: `${providerName} OAuth` }).click();
    await settings.getByRole("button", { name: "Login", exact: true }).click();
    await page.evaluate(() => window.__emitAccountOAuth({ type: "device_code", verificationUri: "https://github.com/login/device",
      userCode: "DEFAULT-42", expiresInSeconds: 120 }));
    const defaultLink = settings.getByRole("link", { name: /Open verification page/ });
    await defaultLink.waitFor();
    await settings.getByRole("button", { name: "Copy code" }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "DEFAULT-42");
    await page.evaluate(() => window.__emitAccountOAuth({ type: "progress", message: "Waiting for provider" }));
    await defaultLink.waitFor();
    await settings.getByRole("button", { name: "Cancel" }).click();
    assert.equal(await page.evaluate(() => window.__accountOAuthSources.at(-1).closed), true);
    await settings.getByRole("button", { name: "Login", exact: true }).click();
    await page.evaluate(() => window.__emitAccountOAuth({ type: "auth", url: "javascript:alert(1)" }));
    await settings.getByText("Invalid authorization URL").waitFor();
    assert.equal(await settings.getByRole("link", { name: /login page/i }).count(), 0);
    await settings.getByRole("button", { name: "Close" }).click();
  }
  console.log(`PASS: ${width}px compact account selection and safe/copyable OAuth device authorization`);
}
