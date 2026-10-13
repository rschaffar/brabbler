import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import katex from "katex";
import semver from "semver";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("all locked KaTeX renderers share the security-fixed CSS version", () => {
  const version = manifest.devDependencies.katex;
  assert.equal(manifest.overrides.katex, "$katex");
  assert.ok(semver.gte(version, "0.18.2"));
  const copies = Object.entries(lock.packages).filter(([path]) => /(?:^|\/)node_modules\/katex$/.test(path));
  assert.ok(copies.length > 0);
  for (const [path, entry] of copies) assert.equal(entry.version, version, path);
  assert.equal(katex.version, version);
});

test("KaTeX does not inherit trusted rendering from an options prototype", () => {
  const options = Object.create({ trust: true });
  options.throwOnError = false;
  options.strict = false;
  const html = katex.renderToString(String.raw`\href{javascript:alert(1)}{unsafe}`, options);
  assert.doesNotMatch(html, /<a\b|href=/);
});

test("KaTeX still renders inline and display formulas with the shared public API", () => {
  const expression = String.raw`\frac{a}{b} + \sqrt{x}`;
  const inline = katex.renderToString(expression, { throwOnError: false });
  const display = katex.renderToString(expression, { throwOnError: false, displayMode: true });
  assert.match(inline, /class="katex"/);
  assert.match(display, /class="katex-display"/);
  assert.doesNotMatch(inline + display, /katex-error/);
});

test("malformed untrusted formulas remain bounded rendering errors", () => {
  const html = katex.renderToString(String.raw`\notARealCommand{`, { throwOnError: false });
  assert.match(html, /katex-error/);
  assert.doesNotMatch(html, /<script\b|<iframe\b/);
});
