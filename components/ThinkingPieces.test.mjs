import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ThinkingBlock } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
test("expanded long thinking renders bounded pieces, not one giant layout text node", t => {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "true" } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const thinking = "界".repeat(100_000);
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ThinkingBlock, { block: { type: "thinking", thinking }, blockIndex: 0 })));
  const pieces = [...html.matchAll(/<div>(界+)<\/div>/g)].map(match => match[1]);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every(piece => piece.length <= 16_000));
  assert.equal(pieces.join(""), thinking);
});
