import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { ActivityOverview } = await jiti.import("./ActivityOverview.tsx");

const session = (id, relation) => ({
  id, name: id, cwd: "/project", projectRoot: "/project", created: "2026-01-01T00:00:00Z", modified: "2026-01-02T00:00:00Z",
  ...(relation ? { relation: { kind: "subagent", parentSessionId: relation, profile: "explore" } } : {}),
});

function render(sessions, runningIds, reviewIds, privacy = { keys: new Set(), error: false }) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ActivityOverview, {
    sessions, runningIds: new Set(runningIds), queuedIds: new Set(), attention: [], reviewIds: new Set(reviewIds),
    available: true, selectedId: null, onSelect() {}, onMarkRead() {}, onClose() {},
    privacy: { pendingKey: null, refresh() {}, setHidden() {}, ...privacy },
  })));
}

test("ready subagents are identified even when their parent is working or absent", () => {
  const html = render([session("working-parent"), session("ready-child", "working-parent"),
    session("orphan", "missing-parent"), session("ready-root")], ["working-parent"],
  ["ready-child", "orphan", "ready-root"]);
  assert.match(html, /aria-label="ready-child · project · in working-parent · Sub-agent · Ready to review · Review"/);
  assert.match(html, /aria-label="orphan · project · Sub-agent · Ready to review · Review"/);
  assert.match(html, /class="activity-item-meta"[^>]*>project · in working-parent<\/span>/);
  assert.match(html, /class="activity-item-meta"[^>]*>project<\/span>/);
  assert.equal((html.match(/class="activity-subagent-icon" title="Sub-agent"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Sub-agent · project/);
  assert.match(html, /aria-label="ready-root · project · Ready to review · Review"/);
  assert.doesNotMatch(html, /aria-label="ready-root[^\"]*Sub-agent/);
  assert.match(html, /aria-label="Mark ready-root as read"[^>]*>Read<\/button>/);
  assert.match(html, /aria-label="Mark ready-child as read"[^>]*>Read<\/button>/);
  assert.match(html, /class="activity-mark-read activity-mark-all-subagents-read" title="[^"]+">Mark all subagents as read<\/button>/);
});

test("worktree metadata accompanies ready roots and nested subagents without changing review actions", () => {
  const linked = (id, parent) => ({ ...session(id, parent), isWorktree: true, branch: "feature/topic", cwd: "/project-worktrees/topic" });
  const html = render([linked("parent"), linked("child", "parent"), session("main")], [], ["parent", "child", "main"]);
  assert.equal((html.match(/title="Worktree: \/project-worktrees\/topic"/g) ?? []).length, 2);
  assert.equal((html.match(/>feature\/topic<\/span>/g) ?? []).length, 2);
  assert.match(html, /activity-nested/);
  assert.match(html, /aria-label="child · project · feature\/topic · in parent · Sub-agent · Ready to review · Review"/);
  assert.match(html, /aria-label="Mark child as read"/);
});

test("bulk subagent read is disabled when only parent sessions are ready", () => {
  const html = render([session("ready-root"), session("working-child", "ready-root")], ["working-child"], ["ready-root", "working-child"]);
  assert.match(html, /class="activity-mark-read activity-mark-all-subagents-read" disabled=""/);
});

test("concealed ready subagents do not enable the bulk read action", () => {
  const hiddenParent = { ...session("hidden-parent"), cwd: "/private", projectRoot: "/private" };
  const html = render([hiddenParent, session("hidden-child", "hidden-parent"), session("ready-root")], [],
    ["hidden-child", "ready-root"], { keys: new Set(["/private"]), error: false });
  assert.doesNotMatch(html, /hidden-child|hidden-parent/);
  assert.match(html, /class="activity-mark-read activity-mark-all-subagents-read" disabled=""/);
});

test("concealed projects have no rows, options, titles, summaries or section counts in the rendered HTML", () => {
  const secret = { ...session("private-session"), cwd: "/secret-path", projectRoot: "/secret-path", name: "private-title" };
  const child = { ...session("private-child", "private-session"), cwd: "/another-path" };
  const html = render([secret, child, session("public-session")], ["private-session", "private-child", "public-session"], [], { keys: new Set(["/secret-path"]), error: false });
  assert.doesNotMatch(html, /private-session|private-child|private-title|secret-path|another-path/);
  assert.match(html, /Working <span>1<\/span>/);
  assert.match(html, /aria-label="Show hidden projects"/);
});

test("an unresolved fresh worktree row is withheld until its canonical project identity is hydrated", () => {
  const fresh = { ...session("private-prompt"), cwd: "/private-worktrees/fresh", projectRoot: undefined };
  const privacy = { keys: new Set(["/private"]), error: false };
  const pending = render([fresh, session("public-session")], ["private-prompt", "public-session"], [], privacy);
  assert.doesNotMatch(pending, /private-prompt|private-worktrees/);
  assert.match(pending, /Working <span>1<\/span>/);
  const hydrated = render([{ ...fresh, projectRoot: "/private", projectKey: "/private" }, session("public-session")], ["private-prompt", "public-session"], [], privacy);
  assert.doesNotMatch(hydrated, /private-prompt|private-worktrees/);
});

test("loading and failed privacy state withhold Activity rather than treating it as no hidden projects", () => {
  for (const error of [false, true]) {
    const html = render([session("private-session")], ["private-session"], [], { keys: null, error });
    assert.doesNotMatch(html, /private-session|value="\/project"|Working <span>/);
    assert.match(html, error ? /Project privacy settings are unavailable/ : /Loading project privacy settings/);
    if (error) assert.match(html, />Retry<\/button>/);
  }
});

test("nested subagents retain their indentation and icon", () => {
  const html = render([session("ready-parent"), session("nested", "ready-parent")], [], ["ready-parent", "nested"]);
  assert.match(html, /class="activity-item activity-item-ready activity-nested"[^>]*aria-label="nested · project · in ready-parent · Sub-agent · Ready to review · Review"/);
  assert.equal((html.match(/class="activity-subagent-icon" title="Sub-agent"/g) ?? []).length, 1);
});
