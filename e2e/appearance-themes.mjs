import assert from "node:assert/strict";

// Independent expected inventory; this helper runs inside appearance/full, never standalone.
const palettes = [
  ["auto", "System"], ["light", "Light"], ["mist", "Mist"], ["lilac", "Lilac"], ["sand", "Sand"], ["rose", "Rose"],
  ["dark", "Dark"], ["pine", "Pine"], ["dusk", "Dusk"], ["ember", "Ember"], ["slate", "Slate"],
  ["contrast-light", "High contrast light"], ["contrast-dark", "High contrast dark"], ["zenburn", "Zenburn"],
];
const dark = new Set(["dark", "pine", "dusk", "ember", "slate", "contrast-dark", "zenburn"]);
function contrast(a, b) {
  const luminance = hex => {
    assert.match(hex, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, "contrast inputs must be RGB hex colors");
    const digits = hex.length === 4 ? [...hex.slice(1)].map(part => part + part).join("") : hex.slice(1);
    const channels = digits.match(/../g).map(part => {
      const n = parseInt(part, 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Starts and ends in General, restores System/light and the original viewport. */
export async function checkAppearanceThemes(page, openSettings) {
  const originalViewport = page.viewportSize();
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const group = page.getByRole("radiogroup", { name: "Appearance", exact: true });
  const radio = label => group.getByRole("radio", { name: label, exact: true });
  const expectTheme = async id => {
    await page.waitForFunction(id => document.documentElement.dataset.theme === id, id);
    assert.equal(await page.locator("html").evaluate(el => el.classList.contains("dark")), dark.has(id));
    assert.equal(await page.locator("html").evaluate(el => getComputedStyle(el).colorScheme), dark.has(id) ? "dark" : "light");
  };
  assert.equal(await group.getByRole("radio").count(), 14);
  // A fresh profile already resolves System; reselecting it correctly performs no write.
  // Start from a different preference so every iteration below exercises a real change.
  await radio("Light").locator("..").click();
  for (const [id, label] of palettes) {
    await radio(label).locator("..").click();
    await expectTheme(id === "auto" ? "light" : id);
    assert.equal(await radio(label).isChecked(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), id);
    const colors = await page.locator("html").evaluate(el => {
      const css = getComputedStyle(el);
      return Object.fromEntries(["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg", "text", "text-muted", "text-dim", "accent", "accent-hover", "accent-contrast", "border"].map(key => [key, css.getPropertyValue(`--${key}`).trim()]));
    });
    const surfaces = ["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg"];
    for (const foreground of ["text", "text-muted", "text-dim", "accent"]) for (const background of surfaces) {
      assert.ok(contrast(colors[foreground], colors[background]) >= (id.startsWith("contrast-") ? 7 : 4.5), `${id}: ${foreground} on ${background}`);
    }
    for (const background of ["accent", "accent-hover"]) assert.ok(contrast(colors["accent-contrast"], colors[background]) >= 4.5, `${id}: accent button`);
    if (id.startsWith("contrast-")) for (const background of surfaces) assert.ok(contrast(colors.border, colors[background]) >= 3, `${id}: border`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectTheme(id === "auto" ? "light" : id);
    await openSettings();
    assert.equal(await radio(label).isChecked(), true, `${id} survives reload`);
  }
  // Native arrow keys select the next radio, wrapping from the final tile to System.
  await radio("System").locator("..").click();
  await radio("System").focus();
  for (const [id, label] of palettes.slice(1)) {
    await page.keyboard.press("ArrowRight");
    await expectTheme(id);
    assert.equal(await radio(label).isChecked(), true);
  }
  await page.keyboard.press("ArrowRight");
  assert.equal(await radio("System").isChecked(), true);
  await page.emulateMedia({ colorScheme: "dark" }); await expectTheme("dark");
  await radio("Dusk").locator("..").click();
  await page.emulateMedia({ colorScheme: "light" }); await expectTheme("dusk");

  for (const viewport of [{ width: 1280, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await group.scrollIntoViewIfNeeded();
    assert.equal(await group.evaluate(group => {
      const view = document.querySelector(".settings-general").getBoundingClientRect();
      return [...group.querySelectorAll(".settings-theme-option")].every(tile => {
        const box = tile.getBoundingClientRect();
        const text = tile.querySelector(".settings-theme-name, .settings-theme-system-name");
        const range = document.createRange(); range.selectNodeContents(text);
        const ink = range.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.left >= Math.max(0, view.left) && box.right <= Math.min(innerWidth, view.right) + 1
          && box.top >= Math.max(0, view.top) && box.bottom <= Math.min(innerHeight, view.bottom) + 1
          && ink.left >= box.left - 1 && ink.right <= box.right + 1 && ink.top >= box.top && ink.bottom <= box.bottom + 1
          && tile.contains(hit);
      });
    }), true, `All swatches, names and hit targets fit constrained Settings at ${viewport.width}px`);
    const overflow = await page.evaluate(() => {
      const describe = element => {
        const box = element.getBoundingClientRect(), css = getComputedStyle(element);
        return { tag: element.tagName, id: element.id, className: String(element.className), left: box.left, right: box.right,
          width: box.width, position: css.position, overflowX: css.overflowX };
      };
      return { viewport: innerWidth, document: document.documentElement.scrollWidth,
        tracked: [...document.querySelectorAll('#file-panel, .file-workspace, .file-workspace-status')].map(describe),
        outside: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + .5).slice(-12).map(describe) };
    });
    assert.equal(overflow.document <= overflow.viewport, true, `Constrained Settings page overflow: ${JSON.stringify(overflow)}`);
  }
  await radio("System").locator("..").click(); await expectTheme("light");
  await page.setViewportSize(originalViewport);
}
