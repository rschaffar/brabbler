import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

// The maintained Nix application source explicitly excludes the independent demo.
for (const path of ["./ChatInput.tsx"]) {
  test(`${path}: focusing continues a draft without editing it or crossing hidden/IME ownership`, () => {
    const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function find(node) {
      if (ts.isMethodDeclaration(node) && node.name.getText(source) === "focus") return node;
      return ts.forEachChild(node, find);
    }
    const method = find(source);
    assert.ok(method);
    const script = new Script(ts.transpileModule(`(${method.getText(source).replace(/^focus\(\)/, "function()")})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText);
    let focusCount = 0, selection = null, hidden = false;
    const ta = {
      value: " literal draft\n@\"my file\"  ", disabled: false,
      closest: () => hidden ? {} : null,
      getClientRects: () => [{}],
      focus(options) { assert.equal(options.preventScroll, true); focusCount++; },
      setSelectionRange(a, b) { selection = [a, b]; },
    };
    const textareaRef = { current: ta }, isComposingRef = { current: false };
    const focus = script.runInNewContext({ textareaRef, isComposingRef });
    focus();
    assert.equal(focusCount, 1);
    assert.deepEqual(selection, [ta.value.length, ta.value.length]);
    assert.equal(ta.value, " literal draft\n@\"my file\"  ");
    hidden = true; focus(); hidden = false;
    ta.disabled = true; focus(); ta.disabled = false;
    isComposingRef.current = true; focus(); isComposingRef.current = false;
    ta.getClientRects = () => []; focus();
    textareaRef.current = null; focus();
    assert.equal(focusCount, 1);
  });
}

for (const path of ["./ChatWindow.tsx"]) {
  test(`${path}: Ask here leaves insertion in charge of the caret`, () => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const body = source.match(/const askSelectionHere = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/)[0];
    assert.doesNotMatch(body.replace(/^\s*\/\/.*$/gm, ""), /removeAllRanges\s*\(/);
    assert.match(body, /insertText\(buildQuotedSelection/);
  });
}
