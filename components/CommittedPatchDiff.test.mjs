import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePatchFiles } from "@pierre/diffs";
import ts from "typescript";

const filename = new URL("./CommittedPatchDiff.tsx", import.meta.url).pathname;
const source = await readFile(filename, "utf8");
const mod = new Module(filename);
mod.filename = filename;
const require = createRequire(import.meta.url);
// The component is transpiled to CJS for this focused SSR test; Pierre exports ESM-only entrypoints.
mod.require = (id) => {
  if (id === "@/hooks/useTheme") return { useTheme: () => ({ isDark: false }) };
  if (id === "@pierre/diffs") return require(new URL("../node_modules/@pierre/diffs/dist/index.js", import.meta.url).pathname);
  if (id === "@pierre/diffs/react") return require(new URL("../node_modules/@pierre/diffs/dist/react/index.js", import.meta.url).pathname);
  return require(id);
};
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

test("committed text patches keep the three view controls while highlighting loads", () => {
  const html = render(modified);
  assert.match(html, /aria-label="Patch view"/);
  assert.match(html, /role="region" aria-label="Raw patch"/);
  assert.match(html, />Side by side<|>Unified<|>Raw patch</);
  assert.match(html, /aria-pressed="true"[^>]*>Raw patch/);
  assert.match(html, /-Old text/);
  assert.doesNotMatch(html, /<diffs-container/);
  const file = parsePatchFiles(modified, undefined, true)[0].files[0];
  assert.equal(file.hunks[0].hunkSpecs.trim(), "@@ -1,2 +1,2 @@");
  assert.deepEqual(file.deletionLines.map((line) => line.trim()), ["First line", "Old text"]);
  assert.deepEqual(file.additionLines.map((line) => line.trim()), ["First line", "New text"]);
});

test("a stack can own the view without repeating per-file controls, retaining raw while highlighting loads", () => {
  const html = renderToStaticMarkup(React.createElement(CommittedPatchDiff, {
    patch: modified, hasBinaryChanges: false, before: "parent", after: "commit", view: "unified",
  }));
  assert.doesNotMatch(html, /aria-label="Patch view"/);
  assert.match(html, /role="region" aria-label="Raw patch"/);
  assert.match(html, /-Old text/);
});

test("root commits parse additions next to an empty parent; raw fallback escapes contents", () => {
  const root = `diff --git a/base.txt b/base.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/base.txt
@@ -0,0 +1 @@
+<script>alert(1)</script>
`;
  const file = parsePatchFiles(root, undefined, true)[0].files[0];
  assert.equal(file.type, "new");
  assert.deepEqual(file.deletionLines, []);
  assert.deepEqual(file.additionLines.map((line) => line.trim()), ["<script>alert(1)</script>"]);
  assert.match(render(root), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const raw = render(root.repeat(2)); // unsupported multi-file responses must not lose content
  assert.match(raw, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(raw, /<script>/);
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
