import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./GitWorkflowSettings.tsx", import.meta.url), "utf8");
const commit = await readFile(new URL("./GitCommitPanel.tsx", import.meta.url), "utf8");
const merge = await readFile(new URL("./GitMergeReviewPanel.tsx", import.meta.url), "utf8");

test("separate workspace, commit and merge icons beside Activity own on-demand panels", () => {
  const activity = shell.indexOf('className="activity-top-button"');
  const workspace = shell.indexOf('panel: "git-workspace" as const');
  const chatMount = shell.indexOf("<ChatWindow");
  assert.ok(activity >= 0 && activity < workspace && workspace < chatMount);
  assert.match(shell, /panel: "git-commit" as const, label: "Review & commit"/);
  assert.match(shell, /panel: "git-merge" as const, label: "Local integration review"/);
  assert.match(shell, /const gitControlsPanel = activeTopPanel === "git-workspace"/);
  assert.match(shell, /gitControlsPanel=\{gitControlsPanel\}/);
  assert.match(shell, /gitControlsHost=\{gitControlsHost\}/);
  assert.match(shell, /id="chat-git-controls" role="region"/);
  assert.match(shell, /className="activity-overview git-controls-overview"/);
  assert.match(chat, /messageCwd && gitControlsPanel && gitControlsHost && createPortal/);
  assert.match(chat, /gitControlsPanel === "workspace" && <GitWorkflowSettings/);
  assert.doesNotMatch(chat, /<button[^>]*>\s*Git &amp; workspace\s*<\/button>/);
  for (const panel of [settings, commit, merge]) {
    assert.doesNotMatch(panel, /aria-expanded=\{open\}|\{open && <div/);
    assert.match(panel, /git-panel-content/);
  }
  assert.match(shell, /className="activity-close" onClick=\{closeGitControls\}/);
});
