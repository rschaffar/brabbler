import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as fonts from "../lib/font-preferences.ts";

const script = new Script(ts.transpileModule(readFileSync(new URL("./FontSettings.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText);
function fixture() {
  const values = { ...fonts.DEFAULT_FONT_PREFERENCES };
  const calls = [];
  const exported = {};
  const jsx = (type, props) => ({ type, props });
  script.runInNewContext({ exports: exported, require(id) {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "@/hooks/useI18n") return { useI18n: () => ({ t: (key) => key }) };
    if (id === "@/lib/font-preferences") return fonts;
    if (id === "./SettingsUi") return { ConfigButton: "button" };
    if (id === "@/hooks/useFontPreferences") return { useFontPreferences: () => ({ ...values,
      setFontPreference(kind, value) { calls.push(["family", kind, value]); values[kind] = value; },
      setFontWeight(kind, value) { calls.push(["weight", kind, value]); values[`${kind}Weight`] = value; },
      resetFontPreference(kind) { calls.push(["reset-family", kind]); values[kind] = ""; },
      resetFontWeight(kind) { calls.push(["reset-weight", kind]); values[`${kind}Weight`] = 400; },
    }) };
    throw Error(`Unexpected import ${id}`);
  } });
  function elements(node) {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== "object") return [];
    return [node, ...elements(node.props?.children)];
  }
  return { values, calls, elements: () => elements(exported.FontSettings()) };
}

test("font inputs and six-step weight sliders are labelled; family/weight resets never share an action", () => {
  const f = fixture();
  for (const kind of ["ui", "mono"]) {
    const find = (predicate) => f.elements().find(predicate);
    const field = () => find((node) => node.props?.id === `settings-font-${kind}`);
    const slider = () => find((node) => node.props?.id === `settings-font-${kind}-weight`);
    const prefix = kind === "ui" ? "Ui" : "Mono";
    const resetFamily = () => find((node) => node.props?.["aria-label"] === `settings.reset${prefix}Font`);
    const resetWeight = () => find((node) => node.props?.["aria-label"] === `settings.reset${prefix}FontWeight`);
    assert.equal(field().props.maxLength, 500);
    assert.equal(field().props["aria-describedby"], "settings-typography-description");
    assert.ok(find((node) => node.type === "label" && node.props.htmlFor === field().props.id));
    assert.ok(find((node) => node.type === "label" && node.props.htmlFor === slider().props.id));
    assert.equal(slider().props.min, 100); assert.equal(slider().props.max, 600); assert.equal(slider().props.step, 100);
    assert.equal(resetFamily().props.disabled, true); assert.equal(resetWeight().props.disabled, true);
    field().props.onChange({ target: { value: '"Local, Font", monospace' } });
    slider().props.onChange({ target: { value: "600" } });
    assert.match(slider().props["aria-valuetext"], /^600 /);
    resetFamily().props.onClick();
    assert.equal(f.values[kind], ""); assert.equal(f.values[`${kind}Weight`], 600);
    assert.equal(resetFamily().props.disabled, true); assert.equal(resetWeight().props.disabled, false);
    resetWeight().props.onClick();
    assert.equal(f.values[`${kind}Weight`], 400);
  }
  assert.equal(f.calls.length, 8);
});
