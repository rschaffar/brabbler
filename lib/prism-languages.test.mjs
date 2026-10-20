import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import { refractor } from "refractor/core";
import PrismLight from "react-syntax-highlighter/dist/esm/prism-light.js";

const { createPrismLoader, loadPrismLanguages, needsPrismLanguage } = await createJiti(import.meta.url).import("./prism-languages.ts");

test("plain aliases never require grammar loading", () => {
  for (const lang of ["", "text", "plaintext", "plain", "TXT"]) assert.equal(needsPrismLanguage(lang), false);
  for (const lang of ["tsx", "js", "nix", "made-up-grammar"]) assert.equal(needsPrismLanguage(lang), true);
});

test("loader deduplicates demand and retries a failed import without an automatic loop", async () => {
  let attempts = 0, release;
  const loader = createPrismLoader(() => {
    attempts++;
    return attempts === 1 ? Promise.reject(new Error("synthetic chunk failure")) : new Promise(resolve => { release = resolve; });
  });
  const failed = loader.load();
  assert.equal(loader.load(), failed);
  await assert.rejects(failed, /synthetic chunk failure/);
  assert.equal(attempts, 1);
  const pending = loader.load();
  assert.equal(loader.load(), pending);
  await Promise.resolve();
  release();
  await pending;
  assert.equal(loader.load(), pending);
  assert.equal(attempts, 2);
});

test("package-owned lazy entry registers into PrismLight's actual core, aliases included", async () => {
  assert.equal(refractor.registered("tsx"), false, "this file must not eagerly preload all grammars");
  const first = loadPrismLanguages();
  assert.equal(loadPrismLanguages(), first);
  await first;
  for (const language of ["typescript", "ts", "tsx", "jsx", "javascript", "js", "bash", "shell", "python", "py", "nix", "markup", "html", "diff"]) {
    assert.ok(refractor.registered(language), language);
  }
  const html = renderToStaticMarkup(React.createElement(PrismLight, { language: "tsx" }, 'const a = <a href="x">t</a>;'));
  assert.match(html, /class="[^"]*\btag\b[^"]*"/);
  assert.match(html, /class="[^"]*\battr-name\b[^"]*"/);
  const plain = renderToStaticMarkup(React.createElement(PrismLight, { language: "unknown-grammar" }, '<script>sentinel</script>'));
  assert.match(plain, /&lt;script&gt;sentinel&lt;\/script&gt;/);
  assert.doesNotMatch(plain, /<script>/);
  const failed = renderToStaticMarkup(React.createElement(PrismLight, { language: "tsx", astGenerator: { highlight() { throw new Error("synthetic tokenizer failure"); } } }, '<b>safe</b>'));
  assert.match(failed, /&lt;b&gt;safe&lt;\/b&gt;/);
});

test("runtime consumers deep-import core and never eagerly import the package barrel", async () => {
  for (const name of ["../components/FileViewer.tsx", "../components/MermaidBlock.tsx"]) {
    const source = await readFile(new URL(name, import.meta.url), "utf8");
    assert.match(source, /import SyntaxHighlighter from "react-syntax-highlighter\/dist\/esm\/prism-light"/);
    assert.doesNotMatch(source, /import\s*\{[^}]*\bPrism\b[^}]*\}\s*from "react-syntax-highlighter"/);
  }
});
