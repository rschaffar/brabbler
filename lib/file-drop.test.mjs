import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { hasFileDrag, readDroppedFiles, uploadDirectoryForNode } = await createJiti(import.meta.url).import("./file-drop.ts");
const note = new File(["text"], "note.txt", { type: "text/plain" });

test("only file drags are accepted, including protected transfer data", () => {
  assert.equal(hasFileDrag({ types: ["Files"], items: [] }), true);
  assert.equal(hasFileDrag({ types: [], items: [{ kind: "file", type: "" }] }), true);
  assert.equal(hasFileDrag({ types: ["text/uri-list"], items: [{ kind: "string" }] }), false);
});

test("mixed drops skip directories, retain ordinary files and report unreadable items", () => {
  const data = { items: [
    { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true, name: "folder" }), getAsFile: () => assert.fail("directory must not be read as file") },
    { kind: "file", getAsFile: () => note },
    { kind: "file", getAsFile: () => null },
    { kind: "string", getAsFile: () => assert.fail("not a file") },
  ], files: [note] };
  assert.deepEqual(readDroppedFiles(data), { files: [note], folders: ["folder"], unsupported: true });
});

test("unreadable browser entries fail closed without flattening their File fallback", () => {
  assert.deepEqual(readDroppedFiles({ items: [{ kind: "file", webkitGetAsEntry() { throw new Error("protected transfer"); }, getAsFile: () => note }], files: [note] }),
    { files: [], folders: [], unsupported: true });
});

test("fallback supports supplied files but refuses relative directory inputs", () => {
  const nested = new File(["nested"], "nested.txt");
  Object.defineProperty(nested, "webkitRelativePath", { value: "tree/sub/nested.txt" });
  assert.deepEqual(readDroppedFiles({ items: [], files: [note, nested] }), { files: [note], folders: ["tree"], unsupported: false });
});

test("folder and file rows resolve to precise destinations without breaking UNC or drive roots", () => {
  for (const [fullPath, isDir, expected] of [
    ["/project/nested", true, "/project/nested"],
    ["/project/nested/file.txt", false, "/project/nested"],
    ["C:\\project\\file.txt", false, "C:/project"],
    ["C:\\file.txt", false, "C:/"],
    ["\\\\host\\share\\project\\file.txt", false, "//host/share/project"],
  ]) assert.equal(uploadDirectoryForNode({ fullPath, isDir }, "/project"), expected);
});
