import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { ModelContextWindow } = await jiti.import("./ModelContextWindow.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
function render(value) {
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(ModelContextWindow, { modelName: "Fixture Model", effective: 272000, value, describedBy: "budget-help", onChange() {} })));
}
test("one compact named input preserves invalid typed text and identifies its help", () => {
  const blank = render(undefined);
  assert.match(blank, /^<input [^>]*\/>$/);
  assert.match(blank, /value=""/);
  assert.match(blank, /placeholder="272000"/);
  assert.match(blank, /inputmode="numeric"/i);
  assert.match(blank, /aria-label="Context window for Fixture Model"/);
  assert.match(blank, /aria-describedby="budget-help"/);
  assert.match(render("500k"), /value="500k"/);
  assert.match(render("500k"), /aria-invalid="true"/);
  assert.doesNotMatch(render(400000.5), /aria-invalid/);
});
