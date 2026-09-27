import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("separate workspace, commit and merge icons beside Activity own on-demand panels", () => {
  const activity = shell.indexOf('className="activity-top-button"');
  const workspace = shell.indexOf('panel: "git-workspace" as const');
  const chatMount = shell.indexOf("<ChatWindow");
  assert.ok(activity >= 0 && activity < workspace && workspace < chatMount);
  assert.match(shell, /panel: "git-commit" as const, label: "Review & commit"/);
  assert.match(shell, /panel: "git-merge" as const, label: "Local integration review"/);
  assert.match(shell, /gitControlsPanel=\{activeTopPanel === "git-workspace"/);
  assert.match(chat, /messageCwd && gitControlsPanel && <div id="chat-git-controls"/);
  assert.match(chat, /gitControlsPanel === "workspace" && <GitWorkflowSettings/);
  assert.doesNotMatch(chat, /<button[^>]*>\s*Git &amp; workspace\s*<\/button>/);
});
