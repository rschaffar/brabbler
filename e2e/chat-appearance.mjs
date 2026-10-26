import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { checkAppearanceThemes } from "./appearance-themes.mjs";
import { checkFontPreferences } from "./font-preferences.mjs";

const columns = page => page.evaluate(() => {
  const input = document.querySelector(".chat-input-textarea");
  let composer = input;
  while (composer && !composer.style.maxWidth) composer = composer.parentElement;
  const message = document.querySelector("[data-chat-message-column]");
  return [message, composer].map(el => ({
    width: el.getBoundingClientRect().width,
    maxWidth: getComputedStyle(el).maxWidth,
  }));
});

/** The old numeric preference has one distinct first-paint/physical obligation.
 * It does not require another copy of all themes, fonts, title settings and sizes.
 */
export async function checkLegacyNumericWidthBridge(page) {
  await page.setViewportSize({ width: 2560, height: 1100 });
  await page.getByRole("button", { name: "Use reading width", exact: true }).waitFor();
  assert.ok((await columns(page)).every(column => column.width > 2000 && column.maxWidth === "none"));
  await page.getByRole("button", { name: "Use reading width", exact: true }).click();
  assert.ok((await columns(page)).every(column => column.width <= 820));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Use full width", exact: true }).waitFor();
  assert.ok((await columns(page)).every(column => column.maxWidth === "820px"));
  await page.getByRole("button", { name: "Use full width", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Use reading width", exact: true }).waitFor();
  assert.ok((await columns(page)).every(column => column.width > 2000 && column.maxWidth === "none"));
}

export async function checkChatAppearance(page) {
  await page.setViewportSize({ width: 2560, height: 1100 });
  const textarea = page.locator(".chat-input-textarea");
  const openSettings = async () => {
    const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  };
  const closeSettings = () => page.keyboard.press("Escape");
  const width = page.getByRole("slider", { name: "Chat content width", exact: true });
  const fontSize = page.getByRole("slider", { name: "Chat & terminal font size", exact: true });
  const font = (locator) => locator.evaluate((el) => getComputedStyle(el).fontSize);
  const fittedHeight = async () => {
    await page.waitForFunction(() => {
      const input = document.querySelector(".chat-input-textarea");
      return input && (input.scrollHeight <= input.clientHeight + 1 || input.clientHeight >= 199);
    });
    return textarea.evaluate((el) => el.clientHeight);
  };

  await checkLegacyNumericWidthBridge(page);

  await openSettings();
  await checkAppearanceThemes(page, openSettings);
  assert.equal(await page.getByRole("radiogroup", { name: "Language", exact: true }).count(), 0);
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  const titleLanguage = page.getByRole("combobox", { name: "Generated title language" });
  await titleLanguage.selectOption("en");
  await waitForAsyncCondition(page, async () => {
    const response = await fetch("/api/sessions/title-language");
    return response.ok && (await response.json()).language === "en";
  });
  await closeSettings();
  await openSettings();
  await page.waitForFunction(() => document.querySelector("#settings-title-language")?.value === "en");
  assert.equal(await titleLanguage.inputValue(), "en", "The title language must reload from the server");
  await titleLanguage.selectOption("auto");
  // The server-side setting survives closing the panel; a catalog entry has a
  // provider/id pair rather than depending on credentials in the E2E fixture.
  await page.route("**/api/models?*", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ modelList: [{ provider: "test", id: "cheap", name: "Cheap" }] }),
  }));
  await closeSettings();
  await openSettings();
  const titleModel = page.getByRole("combobox", { name: "Generated title model" });
  const cheapOption = JSON.stringify(["test", "cheap"]);
  await page.waitForFunction(() => !!document.querySelector(`#settings-title-model option[value='${JSON.stringify(["test", "cheap"])}']`));
  await titleModel.selectOption(cheapOption);
  await waitForAsyncCondition(page, async () => {
    const response = await fetch("/api/sessions/title-model");
    return response.ok && (await response.json()).model?.modelId === "cheap";
  });
  await closeSettings();
  await openSettings();
  await page.waitForFunction(() => document.querySelector("#settings-title-model")?.value === JSON.stringify(["test", "cheap"]));
  assert.equal(await titleModel.inputValue(), cheapOption, "The title model must reload from the server");
  await titleModel.selectOption("");
  await waitForAsyncCondition(page, async () => (await (await fetch("/api/sessions/title-model")).json()).model === null);
  await page.unroute("**/api/models?*");
  assert.equal(await width.inputValue(), "820");
  assert.equal(await fontSize.inputValue(), "14");
  await width.press("End");
  await closeSettings();
  const draft = "Existing drafts resize when the available width or the reading font changes. ".repeat(6);
  await textarea.fill(draft);
  const wideHeight = await fittedHeight();
  await openSettings();
  await width.press("Home");
  await closeSettings();
  const narrowHeight = await fittedHeight();
  assert.ok(narrowHeight > wideHeight, "Narrowing must grow the draft without another keystroke");

  await openSettings();
  await fontSize.press("End");
  await closeSettings();
  assert.ok(await fittedHeight() > narrowHeight, "Increasing the font must grow the draft");
  await openSettings();
  await width.press("End");
  await fontSize.press("Home");
  for (let i = 12; i < 18; i++) await fontSize.press("ArrowRight");
  await closeSettings();
  assert.equal(await textarea.inputValue(), draft);
  assert.ok(await fittedHeight() < narrowHeight, "Widening must shrink the existing draft");
  await page.getByRole("button", { name: "Use full width", exact: true }).click();
  assert.ok((await columns(page)).every((column) => column.width > 2000));
  await page.getByRole("button", { name: "Use reading width", exact: true }).click();
  assert.ok((await columns(page)).every((column) => column.maxWidth === "2000px"), "The toggle must preserve the custom reading width");
  assert.equal(await textarea.inputValue(), draft, "Width toggles must preserve the draft");
  // Activity polls in the background, so networkidle is not a reliable page-ready signal.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".markdown-code-block pre").waitFor();
  assert.equal(await font(textarea), "18px");
  assert.equal(await font(page.locator(".markdown-user-message")), "18px");
  assert.equal(await font(page.locator(".markdown-code-block pre")), "16.5px");

  await openSettings();
  assert.equal(await width.inputValue(), "2000");
  assert.equal(await fontSize.inputValue(), "18");
  // Exact 2000/24 reset independence and stored/default values are owned by the
  // actual General controls below Chromium. Keep one real reset→layout bridge.
  await page.getByRole("button", { name: "Reset chat content width", exact: true }).click();
  await page.getByRole("button", { name: "Reset chat & terminal font size", exact: true }).click();
  assert.equal(await width.inputValue(), "820");
  assert.equal(await fontSize.inputValue(), "14");
  await checkFontPreferences(page, openSettings);
  for (const viewport of [{ width: 1280, height: 600 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    // The title-language setting remains independent from the English-only UI.
    // Retain the hit-test so clipping still fails acceptance.
    await titleLanguage.scrollIntoViewIfNeeded();
    assert.equal(await titleLanguage.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, "Title language must remain reachable in a short settings panel");
  }
  await fontSize.press("Home");
  await closeSettings();
  assert.equal(await font(textarea), "16px", "Mobile inputs retain the focus-zoom minimum");
  await textarea.fill("A mobile draft wraps and resizes within the available space.");
  await fittedHeight();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const expand = page.getByRole("button", { name: "Use full width", exact: true });
  await expand.focus();
  await page.keyboard.press("Enter");
  const narrow = page.getByRole("button", { name: "Use reading width", exact: true });
  await narrow.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--chat-content-max-width")), "none");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await narrow.click();
  await expand.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--chat-content-max-width")), "820px");
  console.log("PASS: chat appearance persistence, typography, draft resizing, and short settings panels");
}
