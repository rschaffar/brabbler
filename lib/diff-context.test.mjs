import assert from "node:assert/strict";
import test from "node:test";
import { countDiffTextLines, MAX_DIFF_CONTEXT_LINES } from "./diff-context.ts";
import { decodeDiffText } from "./git-file-context.ts";

test("complete text line counts distinguish empty files and do not count a trailing EOF as another line", () => {
  for (const [contents, count] of [["", 0], ["one", 1], ["one\n", 1], ["one\r\n", 1], ["\n", 1], ["one\n\n", 2]]) assert.equal(countDiffTextLines(contents), count);
  const boundary = "l\n".repeat(MAX_DIFF_CONTEXT_LINES);
  assert.equal(countDiffTextLines(boundary), MAX_DIFF_CONTEXT_LINES);
  assert.equal(decodeDiffText(Buffer.from(boundary)), boundary);
  assert.throws(() => decodeDiffText(Buffer.from(boundary + "another")), /line limit/);
});
test("complete UTF-8 decoding preserves a BOM and exact newline bytes", () => {
  const contents = "\ufeffFirst\r\nSecond\nLast";
  assert.equal(decodeDiffText(Buffer.from(contents)), contents);
});
