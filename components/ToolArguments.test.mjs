import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { MessageView, getToolCallInputText } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { setToolCallExpanded, clearExpandedToolCalls } = await jiti.import("@/lib/tool-call-expansion");

function render(input, options = {}) {
  const block = { type: "toolCall", toolCallId: "argument-test", toolName: options.toolName ?? "read", input,
    ...(options.rawInput !== undefined ? { rawInput: options.rawInput } : {}) };
  clearExpandedToolCalls();
  setToolCallExpanded(block.toolCallId, options.expanded !== false);
  try {
    return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(MessageView, {
      message: { role: "assistant", content: [block], timestamp: 1 }, entryId: "historical-entry",
      toolResults: options.result ? new Map([[block.toolCallId, options.result]]) : undefined,
    })));
  } finally { clearExpandedToolCalls(); }
}
const textOf = (html) => html.replace(/<[^>]*>/g, "").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

test("expanded read, Agent and unknown flat tools get complete escaped semantic rows", () => {
  for (const toolName of ["read", "Agent", "unknown_package_tool"]) {
    const html = render(Object.freeze({ path: "a.ts", offset: 0, enabled: false, extra: null, empty: "" }), { toolName });
    assert.match(html, /data-tool-fields/);
    assert.match(html, /<th scope="row"[^>]*>offset<\/th>/);
    assert.match(html, />0<\/td>/);
    assert.match(html, />false<\/td>/);
    assert.match(html, />null<\/td>/);
    assert.match(html, /\(empty\)/);
    assert.match(html, /Copy arguments/);
    assert.match(html, /Show raw arguments/);
    assert.match(html, /data-entry-id="historical-entry"/);
    assert.match(html, /aria-expanded="true"/);
  }
});

test("a single nested field keeps the entire complete JSON, including edit input with no diff", () => {
  const input = { path: "a.ts", edits: [{ oldText: "x", newText: "y" }], extra: [1, { z: false }] };
  for (const toolName of ["edit", "functions.edit", "mcp__issues__search", "unknown_tool"]) {
    for (const result of [undefined, { role: "toolResult", isError: true, content: [{ type: "text", text: "failed" }] }]) {
      const html = render(input, { toolName, result });
      assert.doesNotMatch(html, /data-tool-fields/);
      assert.match(html, /data-tool-input/);
      assert.ok(textOf(html).includes(JSON.stringify(input, null, 2)));
      if (result) assert.ok(textOf(html).includes("failed"));
    }
  }
  assert.match(textOf(render({})), /\{\}/);
});

test("simple writes show exact file text, but empty/extra/ambiguous writes never hide fields", () => {
  const input = { path: "a.ts", content: "first line\nsecond line\n" };
  const html = render(input, { toolName: "write" });
  assert.match(html, /data-tool-file-text/);
  assert.ok(textOf(html).includes(input.content));
  assert.doesNotMatch(html, /data-tool-fields/);
  assert.equal(getToolCallInputText({ input }), JSON.stringify(input, null, 2));
  for (const extra of [{ content: "" }, { mode: "append" }, { file_path: "b.ts" }]) {
    const fallback = render({ ...input, ...extra }, { toolName: "write" });
    assert.doesNotMatch(fallback, /data-tool-file-text/);
    assert.match(fallback, /data-tool-fields/);
    for (const key of Object.keys(extra)) assert.ok(textOf(fallback).includes(key));
  }
});

test("partial input, including empty raw input, never becomes rows or a file view", () => {
  for (const rawInput of ["", '{"path":"a.ts","content":"one\\ntwo']) {
    const input = { path: "not-yet-authoritative", content: "do not show parsed snapshot" };
    const html = render(input, { toolName: "write", rawInput });
    assert.doesNotMatch(html, /data-tool-fields|data-tool-file-text|do not show parsed snapshot/);
    assert.match(html, /data-tool-input/);
    assert.ok(textOf(html).includes(rawInput));
    assert.equal(getToolCallInputText({ input, rawInput }), rawInput);
  }
});

test("collapsed input stays unmounted and multiline values are bounded, keyboard-scrollable data", () => {
  const input = { ["long-label".repeat(30)]: '<img src="/api/files/unsafe" onerror="alert(1)">\n[open](/outside/file)\n'.repeat(60) };
  const collapsed = render(input, { expanded: false });
  assert.doesNotMatch(collapsed, /data-tool-arguments|data-tool-fields|Copy arguments|<table/);
  const html = render(input);
  assert.match(html, /max-height:260px/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /table-layout:fixed/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|href=|<a /);
});

test("a valid edit diff keeps its rich renderer and full raw/copy controls", () => {
  const input = { path: "a.ts", oldText: "old", newText: "new" };
  const html = render(input, { toolName: "edit", result: { role: "toolResult", content: [],
    details: { diff: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n" } } });
  assert.match(html, /Copy arguments/);
  assert.match(html, /Show raw arguments/);
  assert.doesNotMatch(html, /data-tool-fields|data-tool-input/);
  assert.ok(textOf(html).includes("new"));
});
