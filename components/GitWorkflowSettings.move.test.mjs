import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settings = await readFile(new URL("./GitWorkflowSettings.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("continuation lists registered worktrees for the persisted chat cwd, not sidebar cwd", () => {
  assert.match(settings, /const actualCwd = sessionId \? value\?\.cwd : null/);
  assert.match(settings, /\/api\/worktrees\?cwd=\$\{encodeURIComponent\(actualCwd\)\}/);
  assert.match(settings, /worktrees\.isTopLevel && worktrees\.currentWorktreePath/);
  assert.match(settings, /item\.path !== worktrees\.currentWorktreePath/);
  assert.match(settings, /actual chat checkout/);
});

test("move requires explicit confirmation and cautions about source changes", () => {
  assert.match(settings, /\/api\/git\/status\?cwd=\$\{encodeURIComponent\(actualCwd\)\}/);
  assert.match(settings, /changedCount === null/);
  assert.match(settings, /Uncommitted files stay in the source checkout/);
  assert.match(settings, /setMoveTarget\(item\.path\)/);
  assert.match(settings, /availableTargets\.some\(\(item\) => item\.path === moveTarget\)/);
  assert.match(settings, /method: "POST"[\s\S]*?JSON\.stringify\(\{ cwd: moveTarget \}\)/);
  assert.match(settings, /onClick=\{\(\) => void confirmMove\(\)\}/);
  assert.match(chat, /transient=\{session\?\.transient\}/);
  assert.match(chat, /busy=\{sessionBusy \|\| isCompacting \|\| modelSwitching/);
});

test("successful move refreshes sidebar and explorer and remounts same-id chat at new cwd", () => {
  assert.match(settings, /await onSessionMoved\?\.\(sessionId, moveTarget\)/);
  assert.match(shell, /handleSessionMoved = useCallback\(async \(sessionId: string, cwd: string\)/);
  assert.match(shell, /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`/);
  assert.match(shell, /setSelectedSession\(\(current\) => current\?\.id === sessionId[\s\S]*?cwd, transient: false/);
  assert.match(shell, /setSessionKey\(\(key\) => key \+ 1\)/);
  assert.match(shell, /setRefreshKey\(\(key\) => key \+ 1\);\s*setExplorerRefreshKey\(\(key\) => key \+ 1\)/);
  assert.match(shell, /onSessionMoved=\{handleSessionMoved\}/);
});
