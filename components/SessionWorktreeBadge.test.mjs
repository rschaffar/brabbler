import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SessionWorktreeBadge } = await jiti.import("./SessionWorktreeBadge.tsx");

const render = (session) => renderToStaticMarkup(React.createElement(SessionWorktreeBadge, { session, className: "activity-item-meta" }));

test("linked checkout badge preserves branch, full path tooltip and truncation", () => {
  for (const cwd of ["/repo-worktrees/topic", "C:\\repo-worktrees\\topic"]) {
    const html = render({ cwd, isWorktree: true, branch: "feature/long-topic" });
    assert.ok(html.includes(`title="Worktree: ${cwd}"`));
    assert.match(html, /class="activity-item-meta"/);
    assert.match(html, /color:var\(--accent\)/);
    assert.match(html, /<svg aria-hidden="true"/);
    assert.match(html, /text-overflow:ellipsis;white-space:nowrap">feature\/long-topic/);
  }
});

test("main, non-Git, detached and not-yet-hydrated sessions have no worktree badge", () => {
  for (const session of [
    { cwd: "/repo", isWorktree: false, branch: "main" },
    { cwd: "/plain" },
    { cwd: "/linked", isWorktree: true },
    { cwd: "/linked", isWorktree: true, branch: "" },
    { cwd: "/repo", branch: "main" },
  ]) assert.equal(render(session), "");
});
