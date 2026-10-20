import assert from "node:assert/strict";

/** Part of appearance/full's existing assertion chain; starts/ends in General. */
export async function checkFontPreferences(page, openSettings) {
  const ui = page.getByRole("textbox", { name: "Interface font", exact: true });
  const mono = page.getByRole("textbox", { name: "Monospace font", exact: true });
  const uiWeight = page.getByRole("slider", { name: "Interface font weight", exact: true });
  const monoWeight = page.getByRole("slider", { name: "Monospace font weight", exact: true });
  const resetFamily = kind => page.getByRole("button", { name: `Reset ${kind} font family`, exact: true });
  const resetWeight = kind => page.getByRole("button", { name: `Reset ${kind} font weight`, exact: true });
  const style = (selector, key) => page.locator(selector).first().evaluate((el, key) => getComputedStyle(el)[key], key);
  const layout = () => page.evaluate(() => ["pi-chat-content-full-width", "pi-chat-content-width", "pi-chat-content-font-size"].map(key => localStorage.getItem(key)));
  const previousLayout = await layout();
  assert.equal(await ui.inputValue(), ""); assert.equal(await mono.inputValue(), "");
  assert.equal(await uiWeight.inputValue(), "400"); assert.equal(await monoWeight.inputValue(), "400");
  await ui.pressSequentially("Times New Roman, serif");
  await mono.fill('"Unavailable, Local Font", monospace');
  await uiWeight.fill("500"); await monoWeight.fill("600");
  for (const selector of ["body", ".chat-input-textarea", ".markdown-user-message", "#settings-font-ui"]) {
    assert.match(await style(selector, "fontFamily"), /^"?Times New Roman"?, serif,/);
    assert.equal(await style(selector, "fontWeight"), "500");
  }
  for (const selector of [".markdown-code-block pre", ".markdown-code-block code", "#settings-font-mono"]) {
    assert.match(await style(selector, "fontFamily"), /^"Unavailable, Local Font", monospace,/);
    assert.equal(await style(selector, "fontWeight"), "600");
  }
  assert.equal(await style(".markdown-user-message strong", "fontWeight"), "700");
  assert.equal(await style(".markdown-body h2", "fontWeight"), "600");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".markdown-code-block code").waitFor();
  assert.equal(await style("body", "fontWeight"), "500", "AppShell restores fonts before Settings opens");
  assert.equal(await style(".markdown-code-block code", "fontWeight"), "600");
  await openSettings();
  assert.equal(await ui.inputValue(), "Times New Roman, serif");
  assert.equal(await mono.inputValue(), '"Unavailable, Local Font", monospace');
  const other = await page.context().newPage();
  try {
    await other.goto(page.url(), { waitUntil: "domcontentloaded" });
    await ui.fill("serif"); await uiWeight.fill("300");
    await other.waitForFunction(() => getComputedStyle(document.body).fontFamily.startsWith("serif,") && getComputedStyle(document.body).fontWeight === "300");
    await resetFamily("interface").click();
    assert.equal(await uiWeight.inputValue(), "300", "family reset preserves weight");
    await other.waitForFunction(() => !document.documentElement.style.getPropertyValue("--font-ui") && getComputedStyle(document.body).fontWeight === "300");
    await resetWeight("interface").click();
    await other.waitForFunction(() => getComputedStyle(document.body).fontWeight === "400");
  } finally { await other.close(); }
  await resetWeight("monospace").click();
  assert.equal(await mono.inputValue(), '"Unavailable, Local Font", monospace', "weight reset preserves family");
  await resetFamily("monospace").click();
  assert.deepEqual(await layout(), previousLayout, "font resets preserve width mode, reading width and size");

  await page.keyboard.press("Escape");
  const textarea = page.locator(".chat-input-textarea");
  const draft = "iiii llll mmmm wwww sample text ".repeat(12);
  await textarea.fill(draft);
  await openSettings(); await ui.fill("serif");
  const serifHeight = await textarea.evaluate(el => el.clientHeight);
  await ui.fill("monospace");
  await page.waitForFunction(previous => {
    const el = document.querySelector(".chat-input-textarea");
    return el.clientHeight !== previous && (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight >= 199);
  }, serifHeight);
  await uiWeight.fill("600");
  await page.waitForFunction(() => {
    const el = document.querySelector(".chat-input-textarea");
    return getComputedStyle(el).fontWeight === "600" && (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight >= 199);
  });
  assert.equal(await textarea.inputValue(), draft);
  await resetFamily("interface").click(); await resetWeight("interface").click();
  for (const viewport of [{ width: 1280, height: 600 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    for (const control of [ui, mono, uiWeight, monoWeight, resetFamily("interface"), resetWeight("monospace")]) {
      await control.scrollIntoViewIfNeeded();
      assert.equal(await control.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
          && el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), true, "Typography controls fit and remain reachable in constrained Settings");
    }
  }
  await page.setViewportSize({ width: 2560, height: 1100 });
  assert.deepEqual(await page.evaluate(() => ["pi-ui-font-family", "pi-ui-font-weight", "pi-mono-font-family", "pi-mono-font-weight"].map(key => localStorage.getItem(key))), [null, null, null, null]);
}
