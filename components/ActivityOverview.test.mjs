import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { ActivityOverview } = await jiti.import("./ActivityOverview.tsx");

const session = (id, relation) => ({
  id, name: id, cwd: "/project", created: "2026-01-01T00:00:00Z", modified: "2026-01-02T00:00:00Z",
  ...(relation ? { relation: { kind: "subagent", parentSessionId: relation, profile: "explore" } } : {}),
});

function render(sessions, runningIds, reviewIds) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ActivityOverview, {
    sessions, runningIds: new Set(runningIds), queuedIds: new Set(), attention: [], reviewIds: new Set(reviewIds),
    available: true, selectedId: null, onSelect() {}, onMarkRead() {}, onClose() {},
  })));
}

test("ready subagents are identified even when their parent is working or absent", () => {
  const html = render([session("working-parent"), session("ready-child", "working-parent"),
    session("orphan", "missing-parent"), session("ready-root")], ["working-parent"],
  ["ready-child", "orphan", "ready-root"]);
  assert.match(html, /aria-label="ready-child · project · in working-parent · Sub-agent · Ready to review · Review"/);
  assert.match(html, /aria-label="orphan · project · Sub-agent · Ready to review · Review"/);
  assert.match(html, /class="activity-item-meta"[^>]*>Sub-agent · project · in working-parent<\/span>/);
  assert.match(html, /class="activity-item-meta"[^>]*>Sub-agent · project<\/span>/);
  assert.match(html, /aria-label="ready-root · project · Ready to review · Review"/);
  assert.doesNotMatch(html, /aria-label="ready-root[^\"]*Sub-agent/);
  assert.match(html, /aria-label="Mark ready-root as read"[^>]*>Read<\/button>/);
  assert.match(html, /aria-label="Mark ready-child as read"[^>]*>Read<\/button>/);
});

test("nested subagents retain their indentation and label", () => {
  const html = render([session("ready-parent"), session("nested", "ready-parent")], [], ["ready-parent", "nested"]);
  assert.match(html, /class="activity-item activity-item-ready activity-nested"[^>]*aria-label="nested · project · in ready-parent · Sub-agent · Ready to review · Review"/);
});
