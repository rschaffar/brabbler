import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePatchFiles } from "@pierre/diffs";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MultiFileGitDiff, splitCapturedGitPatch } = await jiti.import("./MultiFileGitDiff.tsx");
const text = `diff --git a/one.txt b/one.txt
index 1111111..2222222 100644
--- a/one.txt
+++ b/one.txt
@@ -1 +1 @@
-before one
+after one
`;
const rename = `diff --git "a/old name.txt" "b/new name.txt"
similarity index 80%
rename from old name.txt
rename to new name.txt
--- "a/old name.txt"
+++ "b/new name.txt"
@@ -1 +1 @@
-old two
+new two
`;
const binary = "diff --git a/image.png b/image.png\nindex 1111111..2222222 100644\nBinary files a/image.png and b/image.png differ\n";
const mode = "diff --git a/tool b/tool\nold mode 100644\nnew mode 100755\n";

test("multi-file adapter preserves every raw byte and Pierre old/new file identities", () => {
  const patch = text + rename + binary + mode;
  const result = splitCapturedGitPatch(patch);
  assert.equal(result.fallback, undefined);
  assert.deepEqual(result.files.map((file) => file.name), ["one.txt", "new name.txt", "image.png", "tool"]);
  assert.equal(result.files[1].previousName, "old name.txt");
  assert.equal(result.files.map((file) => file.patch).join(""), patch);
  assert.equal(result.files[2].binary, true);
  for (const [index, oldText, newText] of [[0, "before one\n", "after one\n"], [1, "old two\n", "new two\n"]]) {
    const parsed = parsePatchFiles(result.files[index].patch, undefined, true)[0].files[0];
    assert.deepEqual(parsed.deletionLines, [oldText]);
    assert.deepEqual(parsed.additionLines, [newText]);
  }
  assert.equal(parsePatchFiles(result.files[3].patch, undefined, true)[0].files[0].hunks.length, 0);
  const html = renderToStaticMarkup(React.createElement(MultiFileGitDiff, { patch, hasBinaryChanges: true, before: "captured-old", after: "captured-new" }));
  for (const name of ["one.txt", "new name.txt", "image.png", "tool"]) assert.ok(html.includes(name));
  assert.match(html, /Side by side/);
  assert.match(html, /Binary changes are summarized/);
});

test("added/deleted and quoted octal paths are decoded without whitespace heuristics", () => {
  const patch = `diff --git "a/with\\tspace" "b/with\\tspace"
new file mode 100644
--- /dev/null
+++ "b/with\\tspace"
@@ -0,0 +1 @@
+<script>new file</script>
`;
  const { files } = splitCapturedGitPatch(patch);
  assert.equal(files[0].name, "with\tspace");
  const file = parsePatchFiles(files[0].patch, undefined, true)[0].files[0];
  assert.deepEqual(file.deletionLines, []);
  assert.deepEqual(file.additionLines, ["<script>new file</script>\n"]);
  const deleted = text.replace("@@ -1 +1 @@\n-before one\n+after one", "@@ -1 +0,0 @@\n-before one");
  assert.deepEqual(parsePatchFiles(splitCapturedGitPatch(deleted).files[0].patch, undefined, true)[0].files[0].additionLines, []);
});

test("malformed/foreign/oversized patches never silently drop files or invent columns", () => {
  for (const patch of ["unexpected prefix\n" + text, text + rename.replace("@@ -1 +1 @@", "@@ -1,50 +1 @@"), "diff --cc combined\nprivate raw text\n"]) {
    const result = splitCapturedGitPatch(patch);
    assert.equal(result.files.length, 0);
    assert.match(result.fallback, /complete raw patch/);
    const html = renderToStaticMarkup(React.createElement(MultiFileGitDiff, { patch, before: "old", after: "new", hasBinaryChanges: false }));
    assert.match(html, /complete raw patch/);
    assert.doesNotMatch(html, /Side by side/);
  }
  assert.equal(splitCapturedGitPatch("a".repeat(2 * 1024 * 1024 + 1)).oversized, true);
  assert.equal(splitCapturedGitPatch(mode.repeat(201)).oversized, true);
});

test("adapter reuses captured-file renderer and bounds independently scrolling mobile columns", async () => {
  const source = await readFile(new URL("./MultiFileGitDiff.tsx", import.meta.url), "utf8");
  const renderer = await readFile(new URL("./CommittedPatchDiff.tsx", import.meta.url), "utf8");
  assert.match(source, /CommittedPatchDiff patch=\{file.patch\}.*independentScroll/);
  assert.doesNotMatch(source, /fetch\(|\/api\/files|\/api\/git\/diff/);
  assert.match(renderer, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(renderer, /max-height: 44vh; overflow: auto/);
  assert.match(renderer, /unsafeCSS: independentScroll \? INDEPENDENT_SCROLL_CSS/);
  assert.match(renderer, /visibleView === "split" && !independentScroll/);
});
