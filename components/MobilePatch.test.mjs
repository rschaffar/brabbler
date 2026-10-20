import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { PatchDiffFiles } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { parseUnifiedPatch, unifiedDiffLines } = await jiti.import("../lib/patch.ts");
const files = parseUnifiedPatch("--- a/example.ts\n+++ b/example.ts\n@@ -9,2 +9,3 @@\n-old_line\n+new_line\n+added_line\n context_line\n");
test("single-column patch orders replacements and uses new numbers for context", () => {
  const lines = unifiedDiffLines(files[0]);
  assert.deepEqual(lines.map(l => l.type), ["removed", "added", "added", "context"]);
  assert.deepEqual(lines.map(l => l.type === "removed" ? l.oldLineNo : l.newLineNo), [9,9,10,11]);
  for (const [layout, count] of [["stacked",1],["split",2]]) {
    const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(PatchDiffFiles, { files, layout })));
    assert.equal((html.match(/context_line/g) ?? []).length, count);
    assert.equal(html.includes("grid-template-columns:minmax(0, 1fr) minmax(0, 1fr)"), layout === "split");
  }
});
