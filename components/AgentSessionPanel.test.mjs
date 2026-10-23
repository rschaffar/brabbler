import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { AgentSessionPanelContent } = await jiti.import("./AgentSessionPanel.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const info = (id, parent) => ({ id, name: id, path: `/fixture/${id}.jsonl`, cwd: "/fixture", created: "2026-01-01T00:00:00Z", modified: "2026-01-01T00:00:00Z", firstMessage: id, messageCount: 0,
  ...(parent ? { relation: { kind: "subagent", parentSessionId: parent, profile: "explore", description: id, status: "completed" } } : {}) });
const usageSummary = (tokens, cost, time) => ({ tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens }, cost, totalActiveMs: time, toolCalls: 1 });
function renderUsage(usage, selectedSessionId = "main") {
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(AgentSessionPanelContent, {
    rootSession: info("main"), subagents: [info("child", "main"), info("nested", "child")],
    selectedSessionId, runningSessionIds: new Set(["child"]), onSelectSession() {}, usage,
  })));
}

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");

test("bounds the agent list height", () => {
  assert.match(source, /maxHeight: "min\(58dvh, 480px\)"/);
});

test("renders as a compact left-positioned dropdown without a centered inner width", () => {
  assert.match(source, /borderLeft: "1px solid var\(--border\)"/);
  assert.match(source, /borderRadius: "0 0 6px 6px"/);
  assert.doesNotMatch(source, /maxWidth: 680/);
});

test("renders recorded zero and cost-only summaries, summed time and independent selected-agent breakdown", () => {
  const html = renderUsage(new Map([
    ["main", { status: "fresh", summary: usageSummary(0, 0, 0) }],
    ["child", { status: "fresh", summary: usageSummary(0, 0.02, 60000) }],
    ["nested", { status: "fresh", summary: usageSummary(100, 0.01, 30000) }],
  ]), "child");
  assert.ok(html.includes("0s est. active · 0 tokens · $0.00 recorded"));
  assert.ok(html.includes("Summed estimated active time: 1m 30s · 100 tokens · $0.03 recorded"));
  assert.ok(html.includes("3/3 available"));
  const selected = html.slice(html.indexOf('aria-label="Selected agent usage"'));
  assert.ok(selected.includes("$0.0200"));
  assert.ok(!selected.includes("$0.0300"), "selected breakdown must not become family totals");
  const listStart = html.indexOf('role="listbox"');
  const listEnd = html.indexOf("</button>", html.indexOf('data-agent-usage-id="nested"'));
  const list = html.slice(listStart, listEnd);
  assert.ok(!list.includes("<summary"));
  assert.ok(!list.includes("<details"));
  assert.equal((list.match(/<button /g) ?? []).length, 3);
  assert.ok(html.indexOf("Family usage breakdown") < listStart);
  assert.ok(html.indexOf("Selected agent usage breakdown") > listEnd);
  assert.ok(html.includes("not elapsed family time"));
  assert.ok(html.includes("not an invoice"));
});

test("renders partial, stale, unavailable and loading as distinct states instead of fabricated zeros", () => {
  const partial = renderUsage(new Map([
    ["main", { status: "stale", summary: usageSummary(20, 0.01, 1000) }],
    ["child", { status: "unavailable" }],
  ]));
  assert.ok(partial.includes("Partial · 1/3 available"));
  assert.ok(partial.includes("1 stale"));
  assert.ok(partial.includes("Recorded usage unavailable"));
  assert.ok(partial.includes("Loading recorded usage…"));
  assert.ok(!partial.includes("0s est. active · 0 tokens"));
  const unavailable = renderUsage(new Map(["main", "child", "nested"].map((id) => [id, { status: "unavailable" }])));
  assert.ok(unavailable.includes("Partial · 0/3 available"));
  assert.ok(!unavailable.includes("Summed estimated active time: 0s"));
});

test("keeps distinct failed and aborted/interrupted icon branches", () => {
  assert.match(source, /status === "failed"/);
  assert.match(source, /status === "aborted" \|\| status === "interrupted"/);
});
