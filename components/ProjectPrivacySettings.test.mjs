import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { ProjectPrivacySettings } = await jiti.import("./ProjectPrivacySettings.tsx");
function render(keys, pendingKey = null) {
  const sessions = [
    { id: "a", cwd: "/worktrees/feature", projectRoot: "/repo/example", projectKey: "canonical", modified: "2026-01-01" },
    { id: "b", cwd: "/repo/example", projectRoot: "/repo/example", projectKey: "canonical", modified: "2026-01-02" },
    { id: "unresolved", cwd: "/private-worktrees/provisional", modified: "2026-01-03" },
  ];
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ProjectPrivacySettings, {
    sessions, privacy: { keys, pendingKey, error: keys === null, refresh() {}, setHidden() {} },
  })));
}
test("Privacy deduplicates worktrees, shows paths and retains saved hidden projects absent from the catalogue", () => {
  const html = render(new Set(["canonical", "/missing/private"]));
  assert.equal((html.match(/role="switch"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 2);
  assert.match(html, /\/repo\/example/);
  assert.match(html, /\/missing\/private/);
  assert.doesNotMatch(html, /\/worktrees\/feature|private-worktrees|provisional/);
  assert.match(html, /Search projects by name or path/);
  assert.match(html, /Activity only/);
});
test("settings disables switches while saving and provides retry without writable defaults after failure", () => {
  const saving = render(new Set(["canonical"]), "canonical");
  assert.match(saving, /aria-busy="true"/);
  assert.match(saving, /disabled=""/);
  const failed = render(null);
  assert.match(failed, /role="alert"/);
  assert.match(failed, />Retry<\/button>/);
  assert.doesNotMatch(failed, /role="switch"/);
});
