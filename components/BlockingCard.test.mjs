import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function component(name, dependencies = {}) {
  const filename = new URL(name, import.meta.url).pathname;
  const source = await readFile(filename, "utf8");
  const mod = new Module(filename); mod.filename = filename;
  mod.require = (id) => id === "@/hooks/useI18n" ? { useI18n: () => ({ t: (key) => key }) }
    : dependencies[id] ?? require(id);
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
const shell = await component("./BlockingCard.tsx");
const { PluginCard } = await component("./plugin-ui/PluginCard.tsx", {
  "../BlockingCard": shell,
  "../MarkdownBody": { MarkdownBody: ({ children }) => React.createElement("p", {}, children) },
  "../GitPatchStack": { SuppliedPatchStack: () => React.createElement("div", {}, "stack") },
});

test("shared shell labels grouped sections and forms, escapes titles, and retains hidden content on collapse", () => {
  const props = { title: "Question <script>", label: "Pending", children: React.createElement("input", { defaultValue: "draft" }),
    footer: React.createElement("button", {}, "Submit"), onCollapse() {} };
  const html = renderToStaticMarkup(React.createElement(shell.BlockingCard, props));
  assert.match(html, /<section role="group" aria-label="Question &lt;script&gt;" aria-labelledby=/);
  assert.match(html, /blocking-card-header/); assert.match(html, /blocking-card-body/); assert.match(html, /blocking-card-footer/);
  assert.doesNotMatch(html, /<script>/);
  const form = renderToStaticMarkup(React.createElement(shell.BlockingCard, { ...props, onSubmit() {}, collapsed: true, onExpand() {} }));
  assert.match(form, /blocking-card-collapsed/);
  assert.match(form, /<form hidden="" role="group"/);
  assert.match(form, /value="draft"/);
});
test("generic plugin cards display exact structured values, warnings, checks and approval scope without parsing text", () => {
  const html = renderToStaticMarkup(React.createElement(PluginCard, { onRespond() {}, request: {
    id: "request", method: "plugin_card", pluginId: "example", title: "Review", subtitle: "Approval required",
    fields: [{ label: "Checkout", value: "/repo/<script>", code: true }],
    sections: [{ title: "Message", text: "Exact\n\nMessage", code: true },
      { title: "Checks", fields: [{ label: "Tests", value: "npm test", code: true }] },
      { title: "Warning", text: "All selected files", notice: true },
      { title: "Technical details", text: "full IDs", collapsible: true }],
    scope: "Approve the entire candidate", actions: [{ id: "reject", label: "Reject" }, { id: "approve", label: "Approve commit", primary: true }],
  } }));
  assert.match(html, /<dt>Checkout<\/dt><dd class="blocking-card-code">\/repo\/&lt;script&gt;/);
  assert.match(html, /Exact\n\nMessage/); assert.match(html, /npm test/);
  assert.match(html, /blocking-card-notice/);
  assert.match(html, /<details[^>]*><summary[^>]*>Technical details/);
  assert.match(html, /Approve the entire candidate/);
  assert.match(html, /data-primary="true"[^>]*>Approve commit/);
  assert.doesNotMatch(html, /<script>/);
});
