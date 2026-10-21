import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { normalizeDisplayMath } = await jiti.import("../lib/markdown.ts");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderMarkdown(markdown, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MarkdownBody, {
        cwd: "/home/me/project",
        onOpenFile() {},
        ...props,
      }, markdown),
    ),
  );
}

test("opted-in local media has explicit activation and no eager media or image source", () => {
  for (const href of ["out/take.wav", "/outside/take.mp4", "file:///outside/take.wav", "C:/work/take.wav", "file://host/share/take.wav"]) {
    const html = renderMarkdown(`![Recording](${href})`, { enableInlineMedia: true, sourceSessionId: "origin-session" });
    assert.match(html, /Load (audio|video): Recording/);
    assert.match(html, /type=download&amp;sessionId=origin-session/);
    assert.doesNotMatch(html, /<(?:audio|video|img|source)\b|\ssrc=|autoplay/i);
  }
  const blank = renderMarkdown("![](out/take.wav)", { enableInlineMedia: true });
  assert.match(blank, /Load audio: take.wav/);
});

test("media preserves link semantics and blocks traversal without eager fallback requests", () => {
  const props = { enableInlineMedia: true };
  const remote = renderMarkdown("![Remote](https://example.com/movie.mp4?v=2)", props);
  assert.match(remote, /<a href="https:\/\/example.com\/movie.mp4\?v=2" target="_blank" rel="noopener noreferrer">Remote<\/a>/);
  const linked = renderMarkdown("[![Demo](demo.webm)](https://example.com/docs)", props);
  assert.equal((linked.match(/<a /g) ?? []).length, 1);
  assert.doesNotMatch(linked, /<button|<video|<img/);
  for (const href of ["../outside/take.wav", "%2e%2e/outside/take.wav"]) {
    const blocked = renderMarkdown(`![Blocked](${href})`, props);
    assert.match(blocked, /blocked-file-link/);
    assert.doesNotMatch(blocked, /src=|href=|Load audio/);
  }
  const streaming = renderMarkdown("![Recording](take.wav)", { ...props, isStreaming: true });
  assert.doesNotMatch(streaming, /Load audio|<img|<audio|type=read/);
  assert.match(renderMarkdown("[Recording](take.wav)", props), /<a href="take.wav">Recording<\/a>/);
});

test("encoded and browser-normalized media URLs never fall through to eager images", () => {
  for (const source of [
    '![Remote](https://example.com/clip.%6dp4)',
    '<img alt="Remote" src="https://example.com/clip.mp4 ">',
    '<img alt="Remote" src="https://example.com/clip.mp&#9;4">',
    '![API](/api/files/tmp/take.%77av?type=read)',
  ]) {
    const html = renderMarkdown(source, { enableInlineMedia: true });
    assert.doesNotMatch(html, /<img|<audio|<video|<source|\ssrc=/);
  }
  const ordinaryFileImage = renderMarkdown('![Image](file:///outside/image.png)', { enableInlineMedia: true });
  assert.doesNotMatch(ordinaryFileImage, /src=|\/api\/files/);
});

test("media opt-in never enables raw media HTML, script URLs or other renderer contexts", () => {
  const html = renderMarkdown('<video src="take.mp4" autoplay></video><audio src="take.wav"></audio><img src="javascript:take.wav" onerror="alert(1)">', { enableInlineMedia: true });
  assert.doesNotMatch(html, /<video|<audio|javascript:|onerror=|autoplay/);
  assert.doesNotMatch(renderMarkdown("![Recording](take.wav)"), /Load audio/);
  assert.doesNotMatch(renderMarkdown("![Recording](take.wav)", { enableInlineMedia: true, onNavigateLink() {} }), /Load audio/);
});

test("ordered lists reserve marker space from their start and direct item count", () => {
  for (const [markdown, digits] of [
    ["1. one\n2. two", 2],
    ["99. one\n100. two", 3],
    ["9999. one", 4],
  ]) {
    const html = renderMarkdown(markdown);
    assert.match(html, new RegExp(`<ol[^>]*style="--ol-marker-digits:${digits}"`));
    assert.doesNotMatch(html, /\snode=/);
  }
  const nested = renderMarkdown("99. outer\n    1. inner\n    2. inner\n100. outer");
  assert.deepEqual([...nested.matchAll(/--ol-marker-digits:(\d+)/g)].map((match) => Number(match[1])), [3, 2]);
});

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const relativeHtml = renderMarkdown("[file](components/MarkdownBody.tsx)");
  const fileUrlHtml = renderMarkdown("[report](file:///home/me/project/report.html)");

  assert.match(relativeHtml, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(relativeHtml, /target=|rel=|\snode=/);
  assert.match(fileUrlHtml, /<a href="file:\/\/\/home\/me\/project\/report\.html">report<\/a>/);
  assert.doesNotMatch(fileUrlHtml, /target=|rel=|\snode=/);
});

test("explains rejected relative file links instead of making them browser links", () => {
  const html = renderMarkdown("[sibling](../sibling/file.yml#L14)");
  assert.match(html, /<button[^>]*type="button"[^>]*title="This relative file link points outside/);
  assert.match(html, /aria-expanded="false"[^>]*>sibling<\/button>/);
  assert.doesNotMatch(html, /<a |href=|target=/);
  const missingBase = renderMarkdown("[file](src/file.ts)", { cwd: undefined });
  assert.match(missingBase, /no working directory to resolve against/);
  assert.doesNotMatch(missingBase, /<a /);
});

test("keeps absolute sibling links local and web/app links navigable", () => {
  const html = renderMarkdown("[sibling](/home/me/sibling/file.yml#L14)");
  assert.match(html, /<a href="\/home\/me\/sibling\/file.yml#L14">sibling<\/a>/);
  for (const href of ["https://example.com/file.ts", "//example.com/file.ts", "/api/files/a.ts", "#heading"]) {
    assert.match(renderMarkdown(`[web](${href})`), /<a /, href);
    assert.doesNotMatch(renderMarkdown(`[web](${href})`), /blocked-file-link/, href);
  }
});

test("rejected links do not nest inline references or image-preview buttons", () => {
  for (const markdown of ["[`src/file.ts:14`](../sibling/file.ts#L14)", "[![diagram](diagram.png)](../sibling/file.ts)"]) {
    const html = renderMarkdown(markdown);
    assert.equal((html.match(/<button /g) ?? []).length, 1);
    assert.doesNotMatch(html, /<a /);
  }
});

test("preserves basename-colon and Windows drive links through URL sanitization", () => {
  assert.match(renderMarkdown("[readme](README.md:25)"), /href="\.\/README\.md:25"/);
  assert.match(renderMarkdown("[code](C:/repo/code.ts#L36)"), /href="file:\/\/\/C:\/repo\/code\.ts#L36"/);
  assert.doesNotMatch(renderMarkdown("[unsafe](javascript:alert%281%29)"), /href="javascript:/);
});

test("autolinks inline source locations without nesting links or linking code blocks", () => {
  const html = renderMarkdown("`src/code.ts:36:5` and `src/code.ts#L36-L48` and `symbolName` and `https://example.com/a.ts#L36`");
  assert.match(html, /<a href="src\/code\.ts:36:5"><code[^>]*>src\/code\.ts:36:5<\/code><\/a>/);
  assert.match(html, /<a href="src\/code\.ts#L36-L48"><code/);
  assert.doesNotMatch(html, /<a[^>]*>(?:<code[^>]*>)?(?:symbolName|https:)/);
  const nested = renderMarkdown("[`src/code.ts:36`](src/code.ts#L36)");
  assert.equal((nested.match(/<a /g) ?? []).length, 1);
  assert.doesNotMatch(renderMarkdown("`src/code.ts:36`", { onOpenFile: undefined }), /<a /);
  assert.doesNotMatch(renderMarkdown("```text\nsrc/code.ts:36\n```"), /<a /);
});

test("keeps file URLs inert without an in-app file handler", () => {
  const html = renderMarkdown("[report](file:///home/me/project/report.html)", { onOpenFile: undefined });

  assert.match(html, /<a href="" target="_blank" rel="noopener noreferrer">report<\/a>/);
});

test("keeps single-tilde CJK numeric ranges literal instead of striking them", () => {
  const html = renderMarkdown("5~7U 保证金 × 100~200倍杠杆");

  assert.doesNotMatch(html, /<del>/);
  assert.match(html, /5~7U/);
  assert.match(html, /100~200倍/);
});

test("still renders double-tilde strikethrough", () => {
  const html = renderMarkdown("~~gone~~");

  assert.match(html, /<del>gone<\/del>/);
});

test("renders backslash-escaped backticks inside inline code", () => {
  const html = renderMarkdown("`AudioManager\\`1.cs`");

  assert.match(html, /<code[^>]*>AudioManager`1\.cs<\/code>/);
  assert.doesNotMatch(html, /<\/code>1\.cs`/);
});

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", () => {
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /class="katex-display"/);
});

test("renders model-emitted bracket-only formula lines as display math", () => {
  const html = renderMarkdown(String.raw`平均一致性：

[ C(x) = \frac{2}{T(T-1)} \sum_{i<j} S(\hat{y}^{(i)}, \hat{y}^{(j)}) ]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /\\sum/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});

test("previews completed Mermaid diagrams by default", () => {
  const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```");

  assert.match(html, /mermaid-block-loading/);
  assert.match(html, />Source</);
  assert.doesNotMatch(html, /A --&gt; B/);
});

test("keeps Mermaid source visible while the response is streaming", () => {
  const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```", { isStreaming: true });

  assert.doesNotMatch(html, /mermaid-block-loading/);
  assert.match(html, />Preview</);
  assert.match(html, /A --&gt; B/);
});

test("opens markdown images in the shared image preview", () => {
  const localHtml = renderMarkdown("![chart](docs/tmp/chart.png)");
  const remoteHtml = renderMarkdown("![logo](https://example.com/logo.png)");

  assert.match(localHtml, /<button[^>]+aria-label="Preview image: chart"[^>]*>/);
  assert.match(localHtml, /<img[^>]+src="\/api\/files\/home\/me\/project\/docs\/tmp\/chart\.png\?type=read"/);
  assert.match(localHtml, /<img[^>]+alt="chart"/);
  assert.match(remoteHtml, /<button[^>]+aria-label="Preview image: logo"[^>]*>/);
  assert.match(remoteHtml, /<img[^>]+src="https:\/\/example\.com\/logo\.png"/);
});

test("keeps linked markdown images as links instead of nested preview buttons", () => {
  const html = renderMarkdown("[![diagram](docs/tmp/diagram.png)](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")[^>]*>/,
  );
  assert.match(html, /<img[^>]+alt="diagram"/);
  assert.doesNotMatch(html, /<a[^>]*>[\s\S]*<button/);
  assert.doesNotMatch(html, /<button[^>]*>[\s\S]*<\/a>/);
});

test("uses a generic preview label when a markdown image has no alt text", () => {
  const html = renderMarkdown("![](https://example.com/shot.png)");

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.doesNotMatch(html, /Preview image:/);
});
