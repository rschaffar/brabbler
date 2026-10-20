import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { DARK_THEMES, LIGHT_THEMES, THEME_INIT_SCRIPT, THEME_OPTIONS, isDarkTheme, isThemePreference } from "./theme.ts";

test("all thirteen palettes have explicit light/dark classification shared by first paint and renderers", () => {
  assert.equal(THEME_OPTIONS.length, 14);
  assert.equal(new Set(THEME_OPTIONS.map(({ id }) => id)).size, 14);
  assert.deepEqual(LIGHT_THEMES, ["light", "mist", "lilac", "sand", "rose", "contrast-light"]);
  assert.deepEqual(DARK_THEMES, ["dark", "pine", "dusk", "ember", "slate", "contrast-dark", "zenburn"]);
  for (const { id, scheme } of THEME_OPTIONS) if (id !== "auto") assert.equal(isDarkTheme(id), scheme === "dark");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const { id, scheme } of THEME_OPTIONS) {
    if (id === "auto") continue;
    const body = css.match(new RegExp(`\\[data-theme="${id}"\\] \\{([^}]+)\\}`))?.[1];
    assert.ok(body, `${id} owns a palette`);
    assert.match(body, new RegExp(`color-scheme: ${scheme}`));
    for (const token of ["bg", "bg-panel", "bg-hover", "bg-selected", "border", "text", "text-muted", "text-dim", "accent", "accent-hover", "accent-contrast", "user-bg", "assistant-bg", "tool-bg"]) {
      assert.match(body, new RegExp(`--${token}: #[0-9a-f]{6};`), `${id}: ${token}`);
    }
  }
});

test("first paint restores every palette and falls back to the system for invalid or blocked storage", () => {
  for (const systemDark of [false, true]) {
    for (const stored of [...THEME_OPTIONS.map(({ id }) => id), null, "", "unknown", new Error("Blocked")]) {
      const root = { dataset: {}, classList: { toggle: (name, value) => { root[name] = value; } } };
      runInNewContext(THEME_INIT_SCRIPT, {
        localStorage: { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
        window: { matchMedia: () => ({ matches: systemDark }) },
        document: { documentElement: root },
      });
      const expected = isThemePreference(stored) && stored !== "auto" ? stored : systemDark ? "dark" : "light";
      assert.equal(root.dataset.theme, expected);
      assert.equal(root.dark, isDarkTheme(expected));
    }
  }
});
