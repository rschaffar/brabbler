import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as graph from "../lib/git-graph-layout.ts";

const source = await readFile(new URL("./GitExplorer.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const head = "a".repeat(40);
const root = "b".repeat(40);
function fixture(tags = []) {
  return {
    head, branch: "main", refs: [{ branch: "main", oid: head }, { branch: "same-name", oid: root }], nextSkip: null,
    commits: [
      { oid: head, parents: [root], author: "Test", date: "2026-01-01", subject: "latest commit", tags },
      { oid: root, parents: [], author: "Test", date: "2026-01-01", subject: "root commit", tags: [] },
    ],
  };
}
function render(page, initialSelection) {
  // Seed loaded state only; browser tests exercise fetch, selection and cancellation.
  const states = { 3: page, 4: page.refs, 5: page.branch, 7: false, 9: initialSelection?.oid ?? null };
  let index = 0;
  const component = new Module(new URL("./GitExplorer.tsx", import.meta.url).pathname);
  component.filename = new URL("./GitExplorer.tsx", import.meta.url).pathname;
  const realRequire = createRequire(import.meta.url);
  component.require = (id) => {
    if (id === "react") return { ...React, useState: (initial) => {
      const value = Object.hasOwn(states, index) ? states[index] : initial;
      index++; return [value, () => {}];
    } };
    if (id === "@/lib/git-graph-layout") return graph;
    if (id === "@/hooks/useI18n") return { useI18n: () => ({ t: key => key }) };
    return realRequire(id);
  };
  component._compile(compiled, component.filename);
  return renderToStaticMarkup(React.createElement(component.exports.GitExplorer, {
    cwd: "/repo", initialSelection, onOpenCommit() {}, onBranchChange() {},
  }));
}
const rows = (html) => [...html.matchAll(/<button[^>]*aria-pressed="[^"]*"[\s\S]*?<\/button>/g)].map(([row]) => row);
const options = (html) => [...html.matchAll(/<option value="([^"]+)"/g)].map(([, value]) => value);

test("local tags are distinct, fully named display badges, not branch-picker entries", () => {
  const html = render(fixture(["same-name", "release/v1,rc"]));
  assert.deepEqual(options(html), ["main", "same-name"], "A same-name branch remains selectable exactly once");
  assert.match(html, /aria-label="Local branch: same-name"/);
  assert.match(html, /title="Local tag: same-name" aria-label="Local tag: same-name">tag: same-name/);
  assert.match(html, /title="Local tag: release\/v1,rc" aria-label="Local tag: release\/v1,rc">tag: release\/v1,rc/);
  const [latest, oldest] = rows(html);
  assert.match(latest, /Local branch: main/);
  assert.match(latest, /Local tag: same-name/);
  assert.doesNotMatch(oldest, /Local tag:/, "A tag is only shown on its matching commit");
  assert.match(source, /onOpenCommit\(page\.branch, page\.head, commit\.oid\)/);
  assert.match(source, /branch: page\.branch, head: page\.head, skip: String\(page\.nextSkip\)/);
});

test("referenced commits are selected only in matching graph rows, with an honest off-page notice", () => {
  const reference = { cwd: "/repo", branch: "main", head, oid: root, requestId: 1 };
  const html = render(fixture(), reference);
  assert.match(rows(html)[1], /aria-pressed="true"/);
  assert.doesNotMatch(html, /review.outsidePage/);
  const offPage = render(fixture(), { ...reference, oid: "c".repeat(40) });
  assert.match(offPage, /review.outsidePage/);
  assert.ok(rows(offPage).every(row => row.includes('aria-pressed="false"')));
});

test("long tag names are contained and escaped without shortening accessible names or tooltips", () => {
  const long = `release/${"very-long-".repeat(50)}v1,rc`;
  const html = render(fixture([long, "release/<rc>&v1"]));
  assert.ok(html.includes(`title="Local tag: ${long}" aria-label="Local tag: ${long}">tag: ${long}`));
  assert.match(html, /class="min-w-0 max-w-40 truncate rounded [^"]+" title="Local tag:/);
  assert.match(html, /class="flex w-full min-w-0 items-center gap-1 overflow-hidden text-\[10px\]"/);
  assert.match(html, /aria-label="Local tag: release\/&lt;rc&gt;&amp;v1"/);
  assert.doesNotMatch(html, /<rc>/);
});

test("empty, moved and deleted tag snapshots render without lingering decorations", () => {
  assert.doesNotMatch(render(fixture()), /Local tag:/);
  const page = fixture(["moving"]);
  assert.match(rows(render(page))[0], /Local tag: moving/);
  page.commits[0].tags = [];
  page.commits[1].tags = ["moving"];
  const moved = rows(render(page));
  assert.doesNotMatch(moved[0], /Local tag:/);
  assert.match(moved[1], /Local tag: moving/);
  page.commits[1].tags = [];
  assert.doesNotMatch(render(page), /Local tag:/);
});
