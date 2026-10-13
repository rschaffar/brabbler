import assert from "node:assert/strict";
import test from "node:test";
import { parseFileLineTarget, resolveInlineFileReference, resolveLocalFileHref } from "./file-links.ts";

test("reads one-based line, range and column locations independently of paths", () => {
  for (const [href, expected] of [
    ["src/code.ts#L36", { line: 36 }],
    ["src/code.ts?raw=1#L36-L48", { line: 36, endLine: 48 }],
    ["src/code.ts#L36-48", { line: 36, endLine: 48 }],
    ["src/code.ts:36", { line: 36 }],
    ["src/code.ts:36:5", { line: 36, column: 5 }],
    ["C:\\project\\code.ts:36:5", { line: 36, column: 5 }],
    ["file://host/share/code.ts#L36", { line: 36 }],
  ]) assert.deepEqual(parseFileLineTarget(href), expected, href);
});

test("rejects invalid, reversed, unsafe and unrelated locations", () => {
  for (const href of [undefined, "code.ts", "code.ts#heading", "report.pdf#page=12", "code.ts#L0", "code.ts:0", "code.ts:36:0", "code.ts#L48-L36", "code.ts#L1-L0", "code.ts#L9007199254740992", "code.ts#L-1", "code.ts#L1x", "code.ts#L1&foo=2"])
    assert.equal(parseFileLineTarget(href), undefined, href);
});

test("inline reference recognition respects local path/security rules", () => {
  assert.deepEqual(resolveInlineFileReference("README.md:36", "/repo"), { filePath: "/repo/README.md", lineTarget: { line: 36 } });
  assert.deepEqual(resolveInlineFileReference("src/code.ts:36", "/repo"), { filePath: "/repo/src/code.ts", lineTarget: { line: 36 } });
  assert.deepEqual(resolveInlineFileReference("C:\\repo\\code.ts:36:5"), { filePath: "C:/repo/code.ts", lineTarget: { line: 36, column: 5 } });
  for (const value of ["functionName", "functionName:36", "code.ts", "code.ts#heading", "../outside.ts:36", "https://host/code.ts#L36", "//host/code.ts:36", "/api/files/code.ts#L36", " code.ts:36", "code.ts:36\n"])
    assert.equal(resolveInlineFileReference(value, "/repo"), null, value);
  assert.equal(resolveLocalFileHref("file:///repo/a%23b.ts#L36"), "/repo/a#b.ts");
});
