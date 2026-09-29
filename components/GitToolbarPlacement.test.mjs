import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("./GitWorkflowHome.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

test("one labelled Workflow entry owns a stable, chat-independent home, not general Settings", () => {
  assert.equal(shell.match(/aria-label="Workflow"/g)?.length, 1);
  assert.equal(shell.match(/<GitWorkflowHome\b/g)?.length, 1);
  assert.doesNotMatch(shell, /git-workspace|git-commit|git-merge/);
  assert.match(shell, /<GitWorkflowHome\s+visible=\{workflowOpen\}/);
  assert.doesNotMatch(shell, /showChat &&[^\n]*GitWorkflowHome/);
  assert.doesNotMatch(chat, /<GitWorkflowHome|<GitWorkflowSettings|setNewChatOverride/);
  assert.doesNotMatch(settings, /GitWorkflowHome|GitWorkflowSettings/);
  assert.match(home, /className="workflow-container" data-covering=\{covering\} hidden=\{!visible\}/);
  assert.match(shell, /<GitExplorerPanel key=\{activeCwd \?\? "no-worktree"\} cwd=\{activeCwd\}/);
});

test("existing guarded actions remain chat-bound lazy details in one stable portal", () => {
  assert.match(shell, /workflowDetail\.sessionId === selectedSession\?\.id && workflowDetail\.cwd === selectedSession\.cwd/);
  assert.match(home, /Back to workflow/);
  assert.match(home, /ref=\{onDetailHost\} className="workflow-detail-host" hidden=\{!detail\}/);
  assert.match(chat, /session && !session\.transient && session\.relation\?\.kind !== "subagent" && createPortal/);
  for (const view of ["commit", "merge", "workspace"]) {
    assert.match(chat, new RegExp(`hidden=\\{gitControlsPanel !== "${view}"\\}.*visitedGitDetails\\.includes\\("${view}"\\)`));
  }
  assert.match(chat, /<GitWorkspaceContinuation[\s\S]*?cwd=\{session\.cwd\}[\s\S]*?sessionId=\{session\.id\}/);
  assert.doesNotMatch(chat, /onGitControlsClose|setNewSessionGitWorkflow/);
});

test("requests only update attention, never close Workflow or focus inert request controls", () => {
  assert.match(chat, /onWorkflowStatusChange\?\.\(\{ sessionId: session\?\.id \?\? null, busy: workflowBusy, attention: workflowAttention \}\)/);
  assert.match(chat, /if \(questionId && !workflowOpen\)/);
  assert.match(chat, /ref=\{questionCardRef\} inert=\{workflowOpen\}/);
  assert.match(chat, /<div inert=\{workflowOpen\}><ExtensionCustomPanel/);
  assert.doesNotMatch(chat, /extensionDialog.*onGitControlsClose/);
  assert.match(home, /Your workflow draft is unchanged/);
});

test("legacy preference requests explicitly dismiss and open the same home, not a second config form", () => {
  assert.match(chat, /extensionDialog\.candidate\.kind === "preferences"/);
  assert.match(chat, /Dismiss request &amp; open Workflow/);
  assert.match(chat, /respondToExtensionUi\(extensionDialog, \{ cancelled: true \}\);\s*onOpenWorkflow\?\.\(\)/);
  assert.match(chat, /No operation is approved or continued by opening the panel/);
  assert.match(shell, /onOpenWorkflow=\{configureWorkflow\}/);
});
