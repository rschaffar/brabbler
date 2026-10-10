import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { currentDemoLocale, pick } from "./locale.ts";

test("demo content stays English without accessing browser preferences", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, get() { throw new Error("Browser preferences must not be accessed"); } });
  try {
    assert.equal(currentDemoLocale(), "en");
    assert.equal(pick({ en: "English tutorial", zh: "Legacy tutorial" }, "zh"), "English tutorial");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete globalThis.window;
  }
});

test("demo interface layer mirrors the English-only application", async () => {
  for (const path of ["hooks/useI18n.tsx", "lib/i18n/registry.ts", "lib/i18n/types.ts"]) {
    assert.equal(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), await readFile(new URL(`../../${path}`, import.meta.url), "utf8"));
  }
  const demoSettings = await readFile(new URL("../components/SettingsPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(demoSettings, /setLocale|supportedLocales|settings-language-options/);
});
