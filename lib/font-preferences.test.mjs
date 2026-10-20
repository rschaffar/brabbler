import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FONT_PREFERENCES, FONT_FAMILY_MAX_LENGTH, FONT_WEIGHT_OPTIONS, fontFamilyCss, fontFamilyOverride, readFontPreference, readFontWeight } from "./font-preferences.ts";

test("base weights are 100..600, malformed weights use Regular", () => {
  assert.deepEqual(FONT_WEIGHT_OPTIONS.map(({ value }) => value), [100, 200, 300, 400, 500, 600]);
  for (const value of [null, undefined, "", "Light", 0, 350, 700, Infinity, {}, "600px"]) assert.equal(readFontWeight(value), 400);
  for (const { value } of FONT_WEIGHT_OPTIONS) {
    assert.equal(readFontWeight(value), value);
    assert.equal(readFontWeight(String(value)), value);
  }
  assert.deepEqual(DEFAULT_FONT_PREFERENCES, { ui: "", mono: "", uiWeight: 400, monoWeight: 400 });
});

test("bounded raw names keep typing whitespace and custom stacks retain built-in fallbacks", () => {
  assert.equal(readFontPreference(" Times New "), " Times New ");
  assert.equal(readFontPreference("a".repeat(FONT_FAMILY_MAX_LENGTH + 1)), "");
  for (const value of [null, {}, 4, undefined]) assert.equal(readFontPreference(value), "");
  assert.equal(fontFamilyOverride("ui", "Georgia, serif"), '"Georgia", serif, var(--font-ui-default)');
  assert.equal(fontFamilyOverride("mono", '"Family, With Comma", monospace'), '"Family, With Comma", monospace, var(--font-mono-default)');
  assert.equal(fontFamilyOverride("mono", " ,  , "), "");
});

test("font names are quoted data, not declarations, keywords, functions or URLs", () => {
  assert.equal(fontFamilyCss('Times New Roman, "serif", SANS-SERIF'), '"Times New Roman", "serif", sans-serif');
  assert.equal(fontFamilyCss("O'Reilly, serif"), '"O\'Reilly", serif');
  assert.equal(fontFamilyCss("'A, B', monospace"), '"A, B", monospace');
  assert.equal(fontFamilyCss('"A\\"B", serif'), '"A\\"B", serif');
  assert.equal(fontFamilyCss('"A\\\\B", serif'), '"A\\\\B", serif');
  assert.equal(fontFamilyCss("inherit, initial, unset, revert"), '"inherit", "initial", "unset", "revert"');
  assert.equal(fontFamilyCss('x; color:red; url(https://example.invalid/font)'), '"x; color:red; url(https://example.invalid/font)"');
  assert.equal(fontFamilyCss('"unterminated; } body { color:red'), '"\\"unterminated; } body { color:red"');
  assert.equal(fontFamilyCss("A\nB\0C"), '"A\\a B\\fffd C"');
});
