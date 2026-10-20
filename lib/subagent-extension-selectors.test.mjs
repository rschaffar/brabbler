import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { selectSubagentExtensionTools: select } = await jiti.import("./subagent-extension-selectors.ts");
const { withSubagentExtensionTools } = await jiti.import("./subagents.ts");
const extension = (path, source, tools, origin = "package") => ({ path, sourceInfo: { source, origin }, tools: new Map(tools.map(n => [n, {}])) });
const scoped = extension("/packages/codegraph/index.ts", "npm:@scope/pi-codegraph@1.2.3", ["Search", "search", "write_graph"]);

test("scoped/pinned package aliases, trailing wildcards and exact tool case", () => {
  for (const name of ["@scope/pi-codegraph", "pi-codegraph", "codegraph", "CODEGRAPH/", "@SCOPE/PI-CODEGRAPH/*"]) assert.deepEqual(select([scoped], ["EXT:"+name]), ["Search", "search", "write_graph"]);
  assert.deepEqual(select([scoped], ["ext:@scope/pi-codegraph/Search"]), ["Search"]);
  assert.deepEqual(select([scoped], ["ext:codegraph/Search/extra"]), []);
});

test("denials cover alternate aliases, entire grants, deny-only defaults and ext:*", () => {
  assert.deepEqual(select([scoped], ["ext:@scope/pi-codegraph"], ["ext:codegraph/Search"]), ["search", "write_graph"]);
  assert.deepEqual(select([scoped], ["ext:codegraph"], ["ext:*"]), []);
  assert.deepEqual(select([scoped], ["ext:*"], ["ext:@scope/pi-codegraph/*"]), []);
  assert.deepEqual(select([scoped], ["ext:*"], ["ext:unknown"]), ["Search", "search", "write_graph"]);
});

test("ambiguous grants refuse; ambiguous denies conservatively cover all claimants", () => {
  const a = extension("/a/index.ts", "npm:@a/shared", ["Search", "search"]);
  const b = extension("/b/index.ts", "npm:@b/shared", ["Search", "other"]);
  assert.deepEqual(select([a,b], ["ext:shared"]), []);
  assert.deepEqual(select([a,b], ["ext:*"], ["ext:shared"]), []);
  assert.deepEqual(select([a,b], ["ext:*"], ["ext:shared/Search"]), ["search", "other"]);
  assert.deepEqual(select([a,b], ["ext:@a/shared"], ["ext:shared"]), []);
});

test("an ambiguous longest name never falls back to a shorter owner", () => {
  const short = extension("/short/@scope.ts", "auto", ["pkg"], "top-level");
  const a = extension("/a/a.ts", "npm:@scope/pkg@1", ["a"]);
  const b = extension("/b/b.ts", "npm:@scope/pkg@2", ["b"]);
  assert.deepEqual(select([short,a,b], ["ext:@scope/pkg"]), []);
});

test("same-package files share ownership, unrelated auto/local files do not", () => {
  const a = extension("/p/extensions/one.ts", "npm:bundle@1", ["one"]);
  const b = extension("/p/extensions/two.ts", "npm:bundle@1", ["two"]);
  assert.deepEqual(select([a,b], ["ext:bundle"]), ["one", "two"]);
  const c = extension("/c/extensions/one.ts", "auto", ["one"], "top-level");
  const d = extension("/d/extensions/two.ts", "auto", ["two"], "top-level");
  assert.deepEqual(select([c,d], ["ext:extensions"]), []);
  assert.deepEqual(select([c,d], ["ext:auto"]), []);
});

test("extension selection cannot resurrect built-ins or subagent control tools", () => {
  const exports = ["bash", "powershell", "read", "write", "edit", "grep", "find", "ls", "Agent", "get_subagent_result", "steer_subagent", "normal_extension"];
  assert.deepEqual(withSubagentExtensionTools(["read"], exports), ["read", "normal_extension"]);
  assert.deepEqual(withSubagentExtensionTools(["bash"], exports), ["bash", "normal_extension"]);
});
