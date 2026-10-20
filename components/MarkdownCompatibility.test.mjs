import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const render = (text, props = {}) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(MarkdownBody, props, text)));

test("prices remain prose without swallowing emphasis, links or genuine math", () => {
  for (const text of ["$20 and $6", "$20 **bold** and $6", "$20 [docs](https://example.test) and $6", "$20 and $x$", "$0.5 and $2", "$-20 and $6"]) {
    const html = render(text);
    if (text.includes("**bold**")) assert.match(html, /<strong>bold<\/strong>/);
    if (text.includes("[docs]")) assert.match(html, />docs<\/a>/);
    if (text.includes("$x$")) assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
    else assert.doesNotMatch(html, /class="katex"/);
    assert.match(html, /\$[0-9-]/);
  }
  for (const text of ["$x+y$", "$ x+y $", "$$x+y$$", "`$20 and $6`", "```text\n$20 and $6\n``` "]) {
    const html = render(text);
    if (!text.startsWith("`")) assert.match(html, /class="katex/);
    else assert.doesNotMatch(html, /class="katex"/);
  }
});

test("CJK emphasis and adjacent autolinks respect punctuation but preserve real CJK paths", () => {
  assert.match(render("这是**重点**，以及「*强调*」。"), /<strong>重点<\/strong>/);
  assert.match(render("这是**重点**，以及「*强调*」。"), /<em>强调<\/em>/);
  const html = render("https://example.test/wiki/中文条目，后面的正文");
  assert.equal(decodeURI(html.match(/href="([^"]+)"/)[1]), "https://example.test/wiki/中文条目");
  assert.match(html, /<\/a>，后面的正文/);
  assert.equal(decodeURI(render("[literal](https://example.test/a，b)").match(/href="([^"]+)"/)[1]), "https://example.test/a，b");
});

test("skill-local anchors cannot navigate the app and heading keys stay document-local", () => {
  const html = render("# Configuration\n# Configuration\n# Configuration-1\n[read](refs/a.md#details)\n[unsafe](javascript:alert%281%29)", { onNavigateLink() {} });
  assert.match(html, /data-heading-anchor="configuration"/);
  assert.match(html, /data-heading-anchor="configuration-1"/);
  assert.match(html, /data-heading-anchor="configuration-1-1"/);
  assert.match(html, /role="link" tabindex="0">read<\/a>/);
  assert.doesNotMatch(html, /href="refs\/|href="javascript:|\sid="configuration/);
});
