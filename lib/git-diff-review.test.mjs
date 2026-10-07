import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { hydratePartialDiff } from "@pierre/diffs";
import { iterateOverDiff } from "../node_modules/@pierre/diffs/dist/utils/iterateOverDiff.js";
const { createDiffReview, validateReviewContext, rememberExpansion, matchingLines, validLine } = await createJiti(import.meta.url).import("./git-diff-review.ts");
const oldLines = Array.from({ length: 100 }, (_, index) => `Line ${index + 1}\n`);
const newLines = [...oldLines]; newLines[49] = "Changed line 50\n";
const patch = `diff --git a/long.txt b/long.txt\n--- a/long.txt\n+++ b/long.txt\n@@ -47,7 +47,7 @@\n${oldLines.slice(46, 49).map((line) => ` ${line}`).join("")}-Line 50\n+Changed line 50\n${oldLines.slice(50, 53).map((line) => ` ${line}`).join("")}`;
const snapshot = () => ({ oldFile: { name: "long.txt", contents: oldLines.join(""), cacheKey: "old" }, newFile: { name: "long.txt", contents: newLines.join(""), cacheKey: "new" } });
const count = (file, style, full) => { let rows = 0; iterateOverDiff({ diff: file, diffStyle: style, expandedHunks: full ? true : undefined, callback: () => { rows++; } }); return rows; };

test("hydrate the original partial patch in place for split and unified whole-file context", () => {
  const model = createDiffReview(patch), file = model.file;
  assert.equal(file.isPartial, true);
  assert.equal(count(file, "split", false), 7); assert.equal(count(file, "unified", false), 8);
  const context = snapshot(); validateReviewContext(model, context);
  const semantics = () => JSON.stringify(file.hunks.map((hunk) => hunk.hunkContent.map((content) => content.type === "context"
    ? { type: content.type, lines: content.lines } : { type: content.type, additions: content.additions, deletions: content.deletions })));
  const hunks = semantics();
  assert.equal(hydratePartialDiff("merge", file, context), file);
  assert.equal(model.file, file); assert.equal(model.patch, patch);
  assert.equal(count(file, "split", true), 100); assert.equal(count(file, "unified", true), 101);
  assert.equal(semantics(), hunks);
  assert.deepEqual(model.changes, [{ lineNumber: 50, side: "additions" }]);
});
test("mismatched versions and unsafe or over-limit contents cannot hydrate a supplied patch", () => {
  const model = createDiffReview(patch);
  for (const alter of [
    (value) => { value.oldFile.name = "other.txt"; },
    (value) => { value.oldFile.contents = value.oldFile.contents.replace("Line 50", "Unrelated 50"); },
    (value) => { value.oldFile.contents = value.oldFile.contents.replace("Line 20", "Unrelated 20"); },
    (value) => { value.newFile.contents = value.newFile.contents.replace("Line 90", "Hidden change 90"); },
    (value) => { value.newFile.contents = value.newFile.contents.replace("Changed line 50", "Wrong change"); },
    (value) => { value.newFile.contents += "\0"; },
    (value) => { value.newFile.contents = "x".repeat(1024 * 1024 + 1); },
    (value) => { value.newFile.contents = "x\n".repeat(50_001); },
    (value) => { value.oldFile = null; },
  ]) {
    const context = snapshot(); alter(context);
    assert.throws(() => validateReviewContext(model, context));
    assert.equal(model.file.isPartial, true); assert.equal(model.patch, patch);
  }
});
test("add/delete patches distinguish absent sides from empty existing files and exclude non-regular modes", () => {
  const added = createDiffReview("diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..e69de29\n");
  assert.equal(added.context.oldFile, null); assert.equal(added.context.newFile.contents, "");
  const deleted = createDiffReview("diff --git a/deleted b/deleted\ndeleted file mode 100644\n--- a/deleted\n+++ /dev/null\n@@ -1 +0,0 @@\n-Deleted text\n");
  assert.equal(deleted.context.oldFile.contents, "Deleted text\n"); assert.equal(deleted.context.newFile, null);
  const link = createDiffReview("diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+target\n");
  assert.equal(link.context, null);
});
test("expansion ledger and reading/search state are comparison-local and reusable after renderer removal", () => {
  const model = createDiffReview(patch);
  rememberExpansion(model, 0, "up", 20); rememberExpansion(model, 0, "down", 20);
  rememberExpansion(model, 0, "both", Infinity);
  assert.deepEqual(model.expansions.get(0), { fromStart: Infinity, fromEnd: Infinity });
  model.context = snapshot(); model.full = true; model.reading = "before"; model.query = "Line 50";
  model.anchors.before = { lineNumber: 50, side: "deletions", offset: 5 };
  const cache = new Map([["file", model]]);
  assert.equal(cache.get("file").file, model.file);
  const another = createDiffReview(patch);
  assert.equal(another.context, null); assert.equal(another.full, false); assert.equal(another.expansions.size, 0);
  assert.notEqual(another.file.cacheKey, model.file.cacheKey);
});
test("literal case-insensitive search and safe existing-line navigation include unchanged text", () => {
  assert.deepEqual(matchingLines("One\n[Two]\nTWO\n", "two"), [2, 3]);
  assert.deepEqual(matchingLines("One\n[Two]\n", "[two]"), [2]);
  assert.deepEqual(matchingLines("One\n", ""), []);
  assert.equal(validLine("100", oldLines.join("")), 100);
  assert.equal(validLine("1", ""), null);
  for (const value of ["0", "101", "-1", "1.2", "1e2", " 1", "01", "Infinity"]) assert.equal(validLine(value, oldLines.join("")), null);
});
