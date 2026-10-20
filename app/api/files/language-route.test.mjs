// Adapted from upstream 898eb5ae; real route reads, synthetic files only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";
import { refractor } from "refractor/core";
import ts from "typescript";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-grammars-"));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { loadPrismLanguages } = await jiti.import("../../../lib/prism-languages.ts");
allowFileRoot(root);
await loadPrismLanguages();

const source = fs.readFileSync(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
let map;
file.forEachChild(function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "EXT_TO_LANGUAGE") map = node.initializer;
  else node.forEachChild(visit);
});
assert.ok(map && ts.isObjectLiteralExpression(map));
const extensions = map.properties.map(property => property.name.text).filter(ext => !["pdf", "docx"].includes(ext));
assert.ok(extensions.includes("tsx") && extensions.every(Boolean));

async function languageOf(name) {
  const target = path.join(root, name);
  fs.writeFileSync(target, "synthetic source\n");
  const response = await GET(new NextRequest("http://localhost/api/files/x?type=read"),
    { params: Promise.resolve({ path: target.replace(/\\/g, "/").split("/").filter(Boolean) }) });
  assert.equal(response.status, 200, name);
  return (await response.json()).language;
}

test("all mapped source languages are registered by the actual lazy loader", async () => {
  for (const name of [...extensions.map(ext => `sample.${ext}`), "Dockerfile", "Dockerfile.dev", "Makefile", "GNUmakefile", ".env.local"]) {
    const language = await languageOf(name);
    if (language !== "text") assert.ok(refractor.registered(language), `${name}: ${language}`);
  }
});

test("preview languages remain exclusive to HTML and Markdown, not templates", async () => {
  const preview = [];
  for (const ext of extensions) if (["html", "markdown"].includes(await languageOf(`sample.${ext}`))) preview.push(ext);
  assert.deepEqual(preview.sort(), ["htm", "html", "md", "mdx"]);
  for (const ext of ["vue", "svelte", "astro"]) assert.equal(await languageOf(`App.${ext}`), "markup");
  for (const name of ["plot.m", "server.conf", "unknown.xyz", "table.csv", "table.tsv"]) assert.equal(await languageOf(name), "text");
});

test("JSX/TSX tags and attributes tokenize, styles have their own grammar", async () => {
  for (const ext of ["tsx", "jsx"]) {
    assert.equal(await languageOf(`App.${ext}`), ext);
    const tokens = JSON.stringify(refractor.highlight('const a = <a href="x">t</a>;', ext));
    assert.match(tokens, /"tag"/);
    assert.match(tokens, /"attr-name"/);
  }
  for (const ext of ["scss", "less", "nix"]) assert.equal(await languageOf(`source.${ext}`), ext);
  assert.equal(await languageOf("analysis.R"), "r");
});
