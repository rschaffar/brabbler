import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import ts from "typescript";
const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: "automatic" }, alias: { "@": new URL("..", import.meta.url).pathname } });
const helpers = await jiti.import("../lib/git-patch-display.ts");
const review = await jiti.import("../lib/git-diff-review.ts");
const toolbar = await jiti.import("./GitDiffToolbar.tsx");
const preferences = await jiti.import("../hooks/useGitDiffPreferences.ts");
const filename = new URL("./GitPatchStack.tsx", import.meta.url).pathname;
const source = await readFile(filename, "utf8");
const mod = new Module(filename);
mod.filename = filename;
const require = createRequire(import.meta.url);
mod.require = (id) => {
  if (id === "@/lib/git-patch-display") return helpers;
  if (id === "@/lib/git-diff-review") return review;
  if (id === "./GitDiffToolbar") return toolbar;
  if (id === "@/hooks/useGitDiffPreferences") return preferences;
  if (id === "./CommittedPatchDiff") return { CommittedPatchDiff: ({ patch, view }) => React.createElement("pre", { "data-view": view }, patch) };
  return require(id);
};
mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const patch = (path, content) => `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${content}\n`;
const supplied = patch("first.txt", "<script>not executable</script>") + patch("second.txt", "second file content");

test("stack initially opens only the first file with one shared toolbar and preserves complete raw patch", () => {
  const html = renderToStaticMarkup(React.createElement(mod.exports.SuppliedPatchStack, { patch: supplied, before: "HEAD", after: "Candidate" }));
  assert.match(html, /aria-label="Toggle diff: first.txt"/);
  assert.match(html, /aria-expanded="true" aria-label="Toggle diff: first.txt"/);
  assert.match(html, /aria-expanded="false" aria-label="Toggle diff: second.txt"/);
  assert.equal((html.match(/aria-label="Patch view"/g) ?? []).length, 1);
  assert.equal((html.match(/data-view="split"/g) ?? []).length, 1, "Collapsed file renderer is not mounted");
  assert.match(html, /Expand all files/); assert.match(html, /Collapse all files/);
  assert.match(html, /Complete raw patch/); assert.match(html, /second file content/);
  assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test("malformed framing exposes complete escaped raw text instead of a partial file list", () => {
  const raw = "unrecognized <header>\n" + supplied;
  const html = renderToStaticMarkup(React.createElement(mod.exports.SuppliedPatchStack, { patch: raw, before: "HEAD", after: "Candidate" }));
  assert.match(html, /could not be separated into files/);
  assert.match(html, /unrecognized &lt;header&gt;/);
  assert.match(html, /second file content/);
  assert.doesNotMatch(html, /Toggle diff:/);
});
test("Explorer stack never starts patch reads during static rendering and has expansion semantics", () => {
  let reads = 0;
  const html = renderToStaticMarkup(React.createElement(mod.exports.GitPatchStack, {
    files: [{ id: "a", path: "a", status: "M" }, { id: "b", path: "b", status: "A" }],
    before: "parent", after: "commit", loadPatch: async () => { reads++; throw new Error("not expected"); },
  }));
  assert.equal(reads, 0);
  assert.match(html, /Loading patch/);
  assert.match(html, /aria-expanded="false" aria-label="Toggle diff: b"/);
  assert.doesNotMatch(html, /Complete raw patch/);
});
