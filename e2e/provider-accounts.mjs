import assert from "node:assert/strict";
import { join } from "node:path";

/** Exercise the account popover with a fake SSE stream: no provider credentials/network required. */
export async function checkProviderAccountAuthorization(page, { base, sessionId, provider, providerName, accountId, accountLabel, width, artifacts }) {
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
  // CONDITIONAL: adopt only after the exact Close/reopen owner is positive,
  // its actual handler fault is semantic RED and restored source is positive.
  // Only compact native keyboard geometry needs an open Account-label field.
  if (width <= 640) await panel.getByRole("button", { name: "Add account" }).click();
  await panel.getByRole("button", { name: "Change login" }).first().click();
  assert.equal(await page.evaluate(() => window.__accountOAuthSources.length), 1);
  assert.equal(await page.evaluate(() => window.__accountOAuthSources.at(-1).url), `/api/auth/login/${encodeURIComponent(provider)}`,
    "Pi default uses the provider-wide login, not a secondary account");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await panel.getByRole("button", { name: "Retry login" }).click();
  assert.equal(await page.evaluate(() => window.__accountOAuthSources.at(-1).url),
    `/api/auth/login/${encodeURIComponent(provider)}?accountId=${encodeURIComponent(accountId)}`,
    "secondary-account reauthorization remains scoped to this exact fixture ID");
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

  // Unsafe device/auth URLs, popup-blocked fallback and manual prompt/pending
  // permutations execute in ProviderAccounts.authorization.behavior.test.mjs.
  // The real clipboard, source identity, popover and keyboard geometry stay here.
  if (width <= 640) {
    const box = await panel.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1,
      "the account popover stays within the mobile viewport");
  } else {
    // CONDITIONAL: exact original quota/expiry labels and required null/ID
    // requests belong to the real account-control owner after positive/fault/
    // restored proof. No route proxy, synthetic account or usage reload here.
    // Start the independent Pi-default settings flow from a fresh page.
    await page.reload({ waitUntil: "domcontentloaded" });
    // Wait for the client-owned account control after reload, then use the real
    // Settings navigation. A DOM-only click can run before hydration, and the
    // development indicator overlaps the Models shortcut in the sidebar footer.
    await page.getByRole("button", { name: /^Account for/ }).waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.waitFor();
    await settings.getByRole("button", { name: "Models", exact: true }).click();
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
    // The actual ModelsConfig -> OAuthDetail unsafe-URL owner covers this
    // second synthetic login; keep the installed Settings/device/copy bridge.
    await settings.getByRole("button", { name: "Close" }).click();
  }
  console.log(`PASS: ${width}px installed account source/clipboard/popover and default Settings bridge`);
}
