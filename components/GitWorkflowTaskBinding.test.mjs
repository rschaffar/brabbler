import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import { bindingTestModule } from "../lib/git-workflow-binding-test-loader.mjs";
// The production component is JSX; use the same isolated compilation pattern as
// the Workflow home tests, with effects exercised by the real browser suite.
const jiti = createJiti(import.meta.url);
const types = await jiti.import("../lib/git-workflow-binding-types.ts");
const source = readFileSync(new URL("./GitWorkflowTaskBinding.tsx", import.meta.url), "utf8");
const data = { status: { status: "none", revision: "none", reason: "No private task binding." }, editable: true,
  requests: [{ entryId: "request", label: "A user request" }], workspaces: [{ branch: "feature", path: "/repo" }] };
const snapshot = { owner: { sessionId: "session", sessionFile: "/session.jsonl" }, workspace: { branch: "feature", root: "/repo" }, request: { entryId: "request", goal: "Bounded task" }, settings: { commits: "ask" },
  sources: { sources: [{ path: "/repo/AGENTS.md", realPath: "/repo/AGENTS.md", role: "context", bytes: 40, digest: "a".repeat(64), content: '<script>unsafe()</script><img src="https://example.invalid">' }], selectionSources: [], shadowed: [] } };
function render({ body = data, preview = null, busy = false } = {}) {
  let index = 0;
  const states = { 0: true, 1: body, 6: preview };
  const component = bindingTestModule("../components/GitWorkflowTaskBinding.tsx", {
    react: { ...React, useState(initial) { const value = Object.hasOwn(states, index) ? states[index] : initial; index++; return [value, () => {}]; } },
    "@/lib/git-workflow-binding-types": types,
  });
  return renderToStaticMarkup(React.createElement(component.GitWorkflowTaskBinding, { sessionId: "session", cwd: "/repo", settingsRevision: "settings", visible: true, busy }));
}
test("review is a Current-task disclosure, with explicit goal/request/workspace and no grant controls", () => {
  const html = render();
  for (const label of ["Task binding &amp; source review", "Task goal", "Originating user request", "Existing task checkout", "Additional Markdown dependencies"]) assert.ok(html.includes(label));
  assert.match(html, /not prove all prose rules/); assert.match(html, /does not retarget existing Git tools/);
  assert.match(html, /Automatic execution remains unavailable/);
  assert.doesNotMatch(html, /type="checkbox"|Save global|Allow automatic/);
});
test("preview renders inert exact source text and one direct adoption decision without a review checkbox", () => {
  const html = render({ preview: { previewId: "preview", snapshot } });
  assert.match(html, /aria-label="Exact task binding preview"/);
  assert.match(html, /&lt;script&gt;unsafe/); assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /Adopt reviewed task metadata/); assert.match(html, /Adoption approves no Git actions/);
  assert.match(html, /no response timeout/); assert.match(html, /not a claim about the agent/);
  assert.doesNotMatch(html, /type="checkbox"|I have reviewed/);
  assert.match(render({ preview: { previewId: "p", snapshot }, busy: true }), /class="workflow-primary" disabled=""/);
});
test("saved metadata is labelled separately from authority and remains releasable while the chat runs", () => {
  const body = { ...data, editable: false, status: { status: "current", revision: "r", reason: "Not execution permission", binding: {
    state: "adopted", goal: "Reviewed goal", branch: "feature", workspace: "/repo", generation: 4, sources: [],
  } } };
  const html = render({ body, busy: true });
  assert.match(html, /Reviewed metadata · current/); assert.match(html, /generation 4/);
  assert.match(html, /<button type="button">Release task binding/);
  assert.match(source, /operation === "preview" && body\.sourceTargets\) setTargets\(selectedTargets\)/, "Successive mapping prompts retain prior explicit selections");
  assert.match(source, /controller\.signal\.aborted/); assert.match(source, /revision\.current !== reviewedRevision/);
  assert.doesNotMatch(source, /\/api\/agent\/new|setInterval|setTimeout|dangerouslySetInnerHTML/);
});
