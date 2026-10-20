import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { toolFieldsOfInput, writtenFileText } = await jiti.import("./tool-fields.ts");

test("flat arguments keep every scalar, empty value, own field and enumeration order", () => {
  const input = Object.freeze({ path: "a.ts", offset: 0, enabled: false, extra: null, empty: "", prompt: "a\r\nb\n", cr: "a\rb" });
  assert.deepEqual(toolFieldsOfInput(input), [
    { key: "path", value: "a.ts", multiline: false },
    { key: "offset", value: "0", multiline: false },
    { key: "enabled", value: "false", multiline: false },
    { key: "extra", value: "null", multiline: false },
    { key: "empty", value: "", multiline: false },
    { key: "prompt", value: "a\r\nb\n", multiline: true },
    { key: "cr", value: "a\rb", multiline: true },
  ]);
  const own = Object.create({ inherited: "not an argument" });
  own.query = "yes";
  assert.deepEqual(toolFieldsOfInput(own).map((field) => field.key), ["query"]);
});

test("nested, empty and unsupported inputs fall back as a whole, never dropping a field", () => {
  for (const input of [null, undefined, "text", [], {}, { a: "ok", b: [] }, { a: {}, b: 1 },
    { edits: [{ oldText: "x", newText: "y" }] }, { x: undefined }, { x: () => {} }, { x: NaN }, { x: Infinity }]) {
    assert.equal(toolFieldsOfInput(input), null);
  }
});

test("the write file view requires exactly one nonempty path and nonempty string content", () => {
  for (const name of ["write", "functions.write", "mcp_write", "write_file"]) {
    for (const key of ["path", "file_path"]) {
      assert.equal(writtenFileText(name, { [key]: "a.ts", content: "a\nb\n" }), "a\nb\n");
    }
  }
  assert.equal(writtenFileText("unknown", { path: "a", content: "text" }), null);
  for (const input of [{ content: "text" }, { path: "", content: "text" }, { path: 1, content: "text" },
    { path: "a", content: "" }, { path: "a", content: 1 }, { path: "a", content: "text", mode: "append" },
    { path: "a", file_path: "b", content: "text" }, { path: "a", content: "text", nested: {} }]) {
    assert.equal(writtenFileText("write", input), null);
  }
});
