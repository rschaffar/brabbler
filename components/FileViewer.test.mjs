import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { isDelimitedTablePath } from "../lib/delimited-table.ts";
import { needsPrismLanguage } from "../lib/prism-languages.ts";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("large source previews bypass the per-line syntax highlighter", () => {
  assert.match(source, /const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;/);
  assert.match(source, /const useLightweightSource = sourceLines\.length > SOURCE_HIGHLIGHT_MAX_LINES/);

  // Both source trees are memoized so unrelated re-renders (panel open/close,
  // selection changes) reuse them instead of rebuilding every line element.
  assert.match(source, /const highlightedSource = useMemo\(/);

  const lightweightStart = source.indexOf("const lightweightSourceLines = useMemo(");
  const lightweightEnd = source.indexOf("[sourceLines, useLightweightSource, wrapLines]", lightweightStart);
  assert.notEqual(lightweightStart, -1);
  assert.notEqual(lightweightEnd, -1);

  const lightweightSource = source.slice(lightweightStart, lightweightEnd);
  assert.match(lightweightSource, /useLightweightSource \? sourceLines\.map\(\(line, lineIndex\) =>/);
  assert.match(lightweightSource, /className="file-source-line"/);
  assert.match(lightweightSource, /className="file-source-line-content"/);
  assert.match(lightweightSource, /style=\{FILE_LINE_NUMBER_STYLE\}/);

  // The lightweight branch still wins over the syntax highlighter in the JSX.
  const branchStart = source.indexOf(") : useLightweightSource ? (");
  assert.notEqual(branchStart, -1);
  assert.match(source.slice(branchStart), /className="file-source-view is-lightweight"/);
  assert.notEqual(source.indexOf("highlightedSource", branchStart), -1);
});

test("lightweight source rows are skipped for highlighted, diff, and preview views", () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const calculations = viewer.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "isDelimitedTable", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, wrapLines = false, dirty = false, draft = null, initialLineTarget = null, editing = false, filePath = "file.txt") => {
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const FILE_LINE_NUMBER_STYLE = {};
      ${calculations}
      return lightweightSourceLines;
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const render = new Function("React", "useMemo", "isDelimitedTablePath", outputText)(React, (calculate) => calculate(), isDelimitedTablePath);
  const large = { content: "line\n".repeat(1_000), language: "text" };

  assert.equal(render({ ...large, content: "line\n".repeat(999) }, "source"), null);
  assert.equal(render(large, "diff", true), null);
  assert.equal(render(large, "source", true, true), null);
  for (const language of ["html", "markdown"]) {
    assert.equal(render({ ...large, language }, "preview"), null);
  }
  assert.equal(render(large, "preview", false, false, false, false, null, null, false, "fixture.csv"), null);
  for (const mode of ["source", "diff", "preview"]) {
    const rows = render(large, mode);
    assert.equal(rows.length, 1_001, `${mode} must retain its source fallback`);
    assert.equal(rows[0].props["data-line-number"], 1);
    assert.equal(rows[0].props.children[1].props.children, "line");
  }
  assert.equal(render(large, "source", false, false, true)[0].props.children[1].props.style.whiteSpace, "pre-wrap");
  assert.equal(render(large, "source", false, false, false, true, { content: "draft", baseline: "old" }), null);
});

test("grammar demand belongs only to an active bounded typed Source view", () => {
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const names = ["viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "isDelimitedTable", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "prismReady"];
  const calculations = viewer.body.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(file)))).map(node => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode = "source", hasGitDiff = false, editing = false, filePath = "fixture.tsx", autoPreview = false) => {
      const SOURCE_HIGHLIGHT_MAX_LINES = 1000, dirty = false, initialLineTarget = null, isDeletedDiff = false, contentRef = {}, defaultPreviewEligibleRef = { current: autoPreview };
      const useMemo = calculate => calculate(), usePrismLanguages = enabled => enabled;
      ${calculations}
      return prismReady;
    };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const eligible = new Function("isDelimitedTablePath", "needsPrismLanguage", outputText)(isDelimitedTablePath, needsPrismLanguage);
  const small = { content: "line\n".repeat(999), language: "tsx" };
  assert.equal(eligible(small), true, "1000 loaded rows still qualify");
  assert.equal(eligible({ ...small, content: small.content + "\n" }), false);
  assert.equal(eligible(null), false);
  assert.equal(eligible({ ...small, language: "text" }), false);
  assert.equal(eligible(small, "diff", true), false);
  assert.equal(eligible(small, "source", false, true), false, "editor is not source highlighting");
  for (const language of ["html", "markdown"]) {
    assert.equal(eligible({ ...small, language }, "preview"), false);
    assert.equal(eligible({ ...small, language }, "source", false, false, "preview.md", true), false, "auto-preview's transient Source render must not load grammars");
  }
  for (const ext of ["csv", "tsv"]) assert.equal(eligible(small, "preview", false, false, `table.${ext}`), false);
  assert.equal(eligible(small, "diff", false), true, "unavailable Diff falls back to Source");
});

test("markdown preview links use a stable element type for rejection feedback", () => {
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.ok(file.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === "MarkdownPreviewLink"));
  assert.match(source, /a: MarkdownPreviewLink/);
  assert.match(source, /<MarkdownPreviewLinkContext\.Provider value=\{\{ baseDir: markdownDirectory, relativeRoot: cwd \?\? markdownDirectory, onOpenFile \}\}>/);
  assert.match(source, /<BlockedFileLink key=\{href\} reason=\{resolution\.reason\}>/);
});

test("markdown preview links carry PDF page fragments", async () => {
  assert.match(source, /parsePdfPageFragment/);
  assert.match(source, /<LocalFileLink href=\{href\}[^\n]*filePath=\{linkedFile\} page=\{parsePdfPageFragment\(href\) \?\? undefined\}/);
  assert.match(source, /lineTarget=\{parseFileLineTarget\(href\)\} onOpenFile=\{onOpenFile\}/);
  const localLink = await readFile(new URL("./LocalFileLink.tsx", import.meta.url), "utf8");
  assert.match(localLink, /onOpenFile\(filePath, page, lineTarget, disposition\)/);
});
