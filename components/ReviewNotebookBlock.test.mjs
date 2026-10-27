import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const block = { version: 1, kind: "source", id: "factory", title: "Authenticate before extraction", cwd: "/repo", branch: "main", oid: "a".repeat(40), path: "factory.cs", start: 1, end: 3 };
function render(source, props = {}) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(MarkdownBody, props, source)));
}
const fence = value => "```brabbler-review\n" + JSON.stringify(value) + "\n```";
test("ordinary opt-in Markdown renders an inert collapsed source stop; other consumers and streaming stay literal", () => {
  const source = fence(block);
  const active = render(source, { enableReviewBlocks: true });
  assert.match(active, /Review stop: Authenticate before extraction/);
  assert.match(active, /Expand source/); assert.match(active, /Show file diff/);
  assert.match(active, /aria-expanded="false"/);
  assert.doesNotMatch(active, /Pinned source|Loading pinned|Reveal in Git Explorer|iframe|fetchpriority/);
  for (const props of [{}, { enableReviewBlocks: true, isStreaming: true }, { enableReviewBlocks: true, onNavigateLink() {} }]) {
    const literal = render(source, props);
    assert.doesNotMatch(literal, /Review stop:|Expand source|Show file diff/);
    assert.match(literal, /Authenticate before extraction/);
  }
});
test("malformed blocks show escaped original content, without breaking neighbouring valid blocks", () => {
  const html = render(fence({ ...block, title: "<script>globalThis.BAD=true</script>", version: 2 }) + "\n\n" + fence(block), { enableReviewBlocks: true });
  assert.match(html, /Inactive review block: Unsupported/);
  assert.doesNotMatch(html, /<script>|onclick=/);
  assert.match(html, /Expand source/);
  assert.equal((html.match(/data-review-stop=/g) ?? []).length, 1);
});
