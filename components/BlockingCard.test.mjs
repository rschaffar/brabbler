import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createJiti } from "jiti";
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
const { PluginCard, PluginCardContent } = await component("./plugin-ui/PluginCard.tsx", {
  "../BlockingCard": shell,
  "../MarkdownBody": { MarkdownBody: ({ children }) => React.createElement("p", {}, children) },
  "../GitPatchStack": { SuppliedPatchStack: () => React.createElement("div", {}, "stack") },
  "./ReviewAttachment": await component("./plugin-ui/ReviewAttachment.tsx", {
    "../GitPatchStack": { SuppliedPatchStack: () => React.createElement("div", {}, "stack") },
  }),
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

test("large reference-only reviews retain the entire-operation scope and live actions", () => {
  const html = renderToStaticMarkup(React.createElement(PluginCard, { sessionId: "current-session", onRespond() {}, request: {
    id: "request", pluginId: "example", title: "Large operation", operationId: "operation", scope: "Approve the entire operation",
    review: { version: 1, id: "review", operationId: "operation", sha256: "a".repeat(64), entries: 100000, bytes: 5_000_000_000 },
    actions: [{ id: "approve", label: "Approve merge", primary: true }],
  } }));
  assert.match(html, /Download complete exact patch/);
  assert.match(html, /\/api\/sessions\/current-session\/reviews\/review/);
  assert.match(html, /data-primary="true"[^>]*>Approve merge/);
  assert.match(html, /Approve the entire operation/);
  assert.ok(html.length < 10000);
});

test("historical shell uses outcome labels and does not mount expensive collapsed bodies", () => {
  let mounted = 0;
  const Content = () => { mounted += 1; return React.createElement("div", {}, "diff renderer"); };
  const html = renderToStaticMarkup(React.createElement(shell.BlockingCard, {
    title: "Approval", collapsed: true, collapsedLabel: "Answered", retainBodyWhenCollapsed: false,
    onExpand() {}, footer: React.createElement("p", {}, "Decision only"),
  }, React.createElement(Content)));
  assert.match(html, /Answered/);
  assert.doesNotMatch(html, /chat.extensionPending|diff renderer/);
  assert.equal(mounted, 0);
});

const jiti = createJiti(import.meta.url);
const receiptHelpers = await jiti.import("../lib/interaction-receipts.ts");
const receiptDependencies = {
  "@/lib/interaction-receipts": receiptHelpers,
  "./BlockingCard": shell,
  "./MarkdownBody": { MarkdownBody: ({ children }) => React.createElement("p", {}, children) },
  "./plugin-ui/PluginCard": { PluginCardContent },
  "./QuestionSetReview": await component("./QuestionSetReview.tsx", {
    "./MarkdownBody": { MarkdownBody: ({ children }) => React.createElement("p", {}, children) },
  }),
};
const { InteractionReceiptCard } = await component("./InteractionReceiptCard.tsx", receiptDependencies);
const { InteractionReceiptCard: ExpandedReceipt } = await component("./InteractionReceiptCard.tsx", {
  ...receiptDependencies, react: { ...React, useState: () => [false, () => {}] },
});
test("receipt cards default collapsed; expanded approvals retain scope and patches without actionable controls", () => {
  const receipt = { version: 1, outcome: "answered", response: { action: "approve" }, request: {
    type: "extension_ui_request", id: "receipt", method: "plugin_card", pluginId: "example", title: "Commit",
    text: "Exact message", patch: "exact patch", scope: "Entire candidate", subtitle: "Approval required",
    actions: [{ id: "approve", label: "Approve commit", primary: true }],
  } };
  const collapsed = renderToStaticMarkup(React.createElement(InteractionReceiptCard, { receipt }));
  assert.match(collapsed, /data-interaction-receipt="receipt"/);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /Exact message|stack|chat.extensionPending/);
  const expanded = renderToStaticMarkup(React.createElement(ExpandedReceipt, { receipt }));
  assert.match(expanded, /Exact message/);
  assert.match(expanded, /stack/);
  assert.match(expanded, /Entire candidate/);
  assert.match(expanded, /Approval required/);
  assert.match(expanded, /chat.receiptDecisionOnly/);
  assert.doesNotMatch(expanded, /<form|<input|<textarea|type="submit"|data-primary|>chat.cancel</);
  assert.equal((expanded.match(/<button/g) ?? []).length, 1, "only collapse can act on the historical card");
});
const operationHelpers = await jiti.import("../lib/operation-receipts.ts");
const operationDependencies = {
  "@/lib/operation-receipts": operationHelpers,
  "./BlockingCard": shell,
  "./plugin-ui/PluginCard": { PluginCardContent },
};
const { OperationReceiptCard } = await component("./OperationReceiptCard.tsx", operationDependencies);
const { OperationReceiptCard: ExpandedOperation } = await component("./OperationReceiptCard.tsx", {
  ...operationDependencies, react: { ...React, useState: () => [false, () => {}] },
});
test("operation receipts collapse unmounted bodies and separate policy authorization from unknown execution", () => {
  const receipt = { version: 1, pluginId: "example", sequence: 1, operationId: "a046677d-8293-4445-9a2b-558317345abc", toolCallId: "call-1",
    card: { title: "Operation", text: "Exact candidate", scope: "Entire candidate", patch: "exact patch",
      actions: [{ id: "approve", label: "Forbidden callback control" }] }, phase: "executing",
    authorization: { mode: "allow", source: "session", revision: "revision-1", decision: "policy-authorized" },
    checks: [{ name: "Tests", status: "passed" }], effectStarted: true };
  const collapsed = renderToStaticMarkup(React.createElement(OperationReceiptCard, { receipt }));
  assert.match(collapsed, /aria-expanded="false"/);
  assert.match(collapsed, /Policy authorized/);
  assert.match(collapsed, /outcome unknown/);
  assert.doesNotMatch(collapsed, /Exact candidate|stack|Forbidden callback control|User accepted|Succeeded/);
  const expanded = renderToStaticMarkup(React.createElement(ExpandedOperation, { receipt }));
  assert.match(expanded, /Exact candidate/);
  assert.match(expanded, /stack/);
  assert.match(expanded, /Entire candidate/);
  assert.match(expanded, /revision-1/);
  assert.match(expanded, /call-1/);
  assert.match(expanded, /Tests: passed/);
  assert.match(expanded, /Effect started/);
  const intentOnly = renderToStaticMarkup(React.createElement(ExpandedOperation, { receipt: { ...receipt, effectStarted: false } }));
  assert.match(intentOnly, /Effect may have started/);
  assert.doesNotMatch(intentOnly, /Effect not started/);
  assert.doesNotMatch(expanded, /<form|<input|<textarea|type="submit"|data-primary|Forbidden callback control/);
  assert.equal((expanded.match(/<button/g) ?? []).length, 1, "only local collapse control");
  const terminal = renderToStaticMarkup(React.createElement(OperationReceiptCard, { receipt: { ...receipt, phase: "failed" } }));
  assert.match(terminal, /Failed/);
  assert.doesNotMatch(terminal, /outcome unknown/);
});

test("expanded question receipts preserve context, described choices and the normalized answer read-only", () => {
  const receipt = { version: 1, outcome: "answered", response: { answer: {
    kind: "selection", selections: ["Second"], comment: "Explanation",
  } }, request: { type: "extension_ui_request", id: "question", method: "ask_user", question: "Which?",
    context: "Background", options: [{ title: "First", description: "First details" }, { title: "Second", description: "Second details" }],
    allowMultiple: false, allowFreeform: true, allowComment: true, contextExpanded: false } };
  const html = renderToStaticMarkup(React.createElement(ExpandedReceipt, { receipt }));
  assert.match(html, /Background/);
  assert.match(html, /Second — Explanation/);
  assert.match(html, /First details/);
  assert.match(html, /Second details/);
  assert.match(html, /data-selected="true"/);
  assert.doesNotMatch(html, /<form|<input|<textarea|type="submit"|chat.extensionPending/);
});
