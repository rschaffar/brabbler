import assert from "node:assert/strict";
import test from "node:test";
import { copyText } from "./clipboard.ts";

test("clipboard fallback reports rejection instead of falsely claiming a code was copied", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const textarea = { style: {}, value: "", select() {} };
  let removed = false;
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      createElement: () => textarea,
      execCommand: () => false,
      body: { appendChild() {}, removeChild(node) { removed = node === textarea; } },
    } });
    await assert.rejects(copyText("DEVICE-1234"), /Could not copy text/);
    assert.equal(removed, true, "temporary textarea must be removed even on failure");
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else delete globalThis.document;
  }
});
