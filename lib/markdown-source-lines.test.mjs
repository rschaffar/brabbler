import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { normalizeDisplayMath, normalizeDisplayMathWithSourceMap, markdownPreviewRemarkPlugins, markdownPreviewRehypePlugins } = await jiti.import("./markdown.ts");
const { rehypeMarkdownSourceLines } = await jiti.import("./markdown-source-lines.ts");

function render(source) {
  const mapped = normalizeDisplayMathWithSourceMap(source);
  assert.equal(mapped.markdown, normalizeDisplayMath(source));
  assert.equal(mapped.sourceLines.length, mapped.markdown.split(/\r?\n/).length);
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: markdownPreviewRemarkPlugins,
    rehypePlugins: [...markdownPreviewRehypePlugins.slice(0, -1), [rehypeMarkdownSourceLines, mapped], ...markdownPreviewRehypePlugins.slice(-1)],
  }, mapped.markdown));
}

function assertHeading(html, tag, slug, line, text = "") {
  assert.match(html, new RegExp(`<${tag} (?=[^>]*data-heading-anchor="${slug}")(?=[^>]*data-source-line-start="${line}")(?=[^>]*data-source-line-end="${line}")[^>]*>${text}`));
}

test("rendered blocks retain original file coordinates including frontmatter", () => {
  const html = render("---\ntitle: Example\n---\n\n# Heading\n\nFirst paragraph\nsecond line\n\n- Item one\n- Item two\n\n```ts\nfunction target() {}\n```\n");
  assertHeading(html, "h1", "heading", 5, "Heading");
  assert.match(html, /<p data-source-line-start="7" data-source-line-end="8">/);
  assert.match(html, /<li data-source-line-start="11" data-source-line-end="11">Item two/);
  assert.match(html, /<pre data-source-line-start="13" data-source-line-end="15">/);
});

test("normalization never shifts following blocks' source coordinates", () => {
  for (const math of ["\\[x = y\\]", "$$x = y$$", "$$x = y\nz = w$$", "\\[\nx = y\n\\]"]) {
    const source = `${math}\n\n## After math\n`;
    const line = source.split("\n").indexOf("## After math") + 1;
    assertHeading(render(source), "h2", "after-math", line, "After math");
  }
  assertHeading(render("\\[x=y\\]\r\n\r\n# After\r\n"), "h1", "after", 3);
});

test("display math keeps a positioned wrapper through KaTeX replacement", () => {
  const html = render("$$x=y$$\n");
  assert.match(html, /<div data-source-line-start="1" data-source-line-end="1"><span class="katex-display"/);
  assert.match(render("```math\nx=y\n```\n"), /<div data-source-line-start="1" data-source-line-end="3"><span class="katex-display"/);
});

test("untrusted HTML cannot supply navigation coordinates", () => {
  const html = render('<div data-source-line-start="999" data-source-line-end="999">Safe <script>alert(1)</script></div>');
  assert.doesNotMatch(html, /999|<script/);
  assert.match(html, /data-source-line-start="1"/);
  const heading = render('<h2 data-heading-anchor="forged" data-source-line-start="999" id="session-sidebar">Real heading</h2>');
  assertHeading(heading, "h2", "real-heading", 1, "Real heading");
  assert.doesNotMatch(heading, /forged|999|\sid="session-sidebar"/);
});
