import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const filename = new URL("./CommittedPatchDiff.tsx", import.meta.url).pathname;
const source = await readFile(filename, "utf8");
const mod = new Module(filename);
mod.filename = filename;
mod.require = createRequire(import.meta.url);
mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { CommittedPatchDiff } = mod.exports;
const render = (patch, hasBinaryChanges = false) => renderToStaticMarkup(React.createElement(CommittedPatchDiff, {
  patch, hasBinaryChanges, before: "parent", after: "commit",
}));

const modified = `diff --git a/notes.txt b/notes.txt
index 4824a54..d914290 100644
--- a/notes.txt
+++ b/notes.txt
@@ -1,2 +1,2 @@
 First line
-Old text
+New text
`;

test("committed text patches render labeled, aligned old/new columns with hunk and line numbers", () => {
  const html = render(modified);
  assert.match(html, /aria-label="Side-by-side diff"/);
  assert.match(html, /Before · parent/);
  assert.match(html, /After · commit/);
  assert.match(html, /class="diff diff-split/);
  assert.match(html, /@@ -1,2 \+1,2 @@/);
  assert.match(html, /Old text/);
  assert.match(html, /New text/);
  assert.match(html, /aria-pressed="true"[^>]*>Side by side/);
  assert.match(html, /class="diff-gutter/);
});

test("root commits render additions next to the empty parent and escape file contents", () => {
  const root = `diff --git a/base.txt b/base.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/base.txt
@@ -0,0 +1 @@
+<script>alert(1)</script>
`;
  const html = render(root);
  assert.match(html, /diff-code-insert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("large patches keep their complete raw text rather than creating thousands of DOM rows", () => {
  const added = Array.from({ length: 2501 }, (_, index) => `+Line ${index}`).join("\n");
  const patch = `diff --git a/large b/large\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/large\n@@ -0,0 +1,2501 @@\n${added}\n`;
  const html = render(patch);
  assert.match(html, /Too many lines for the interactive diff/);
  assert.match(html, /Line 2500/);
  assert.doesNotMatch(html, /aria-label="Side-by-side diff"/);
});

test("binary and metadata-only changes retain a truthful raw patch, never fake columns", () => {
  const binary = render("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n", true);
  assert.match(binary, /Binary changes are summarized/);
  assert.match(binary, /Binary files a\/x.png and b\/x.png differ/);
  assert.doesNotMatch(binary, /Side-by-side diff|Side by side/);
  const metadata = render("diff --git a/tool b/tool\nold mode 100644\nnew mode 100755\n");
  assert.match(metadata, /metadata-only change/);
  assert.match(metadata, /new mode 100755/);
});
