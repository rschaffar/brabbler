import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settings = await readFile(new URL("./GitWorkspaceContinuation.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("continuation selects a registered worktree for the persisted chat cwd, not sidebar cwd", () => {
  assert.match(settings, /get<\{ info: \{ cwd: string \} \}>\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`\)/);
  assert.match(settings, /const actualCwd = info\.cwd/);
  assert.match(settings, /if \(info\.cwd !== cwd\) throw new Error/);
  assert.match(settings, /\/api\/worktrees\?cwd=\$\{encodeURIComponent\(actualCwd\)\}/);
  assert.match(settings, /worktrees\.isTopLevel && worktrees\.currentWorktreePath/);
  assert.match(settings, /item\.path !== worktrees\.currentWorktreePath/);
  assert.match(settings, /actual chat checkout/);
  assert.match(settings, /<select className=\{inputClass\} value=\{availableTargets\.some/);
  assert.match(settings, /<option key=\{item\.path\} value=\{item\.path\} disabled=\{item\.path === worktrees\.currentWorktreePath\}/);
  assert.doesNotMatch(settings, /worktrees\.worktrees\.map\(\(item\) => \(\s*<li/);
});

test("move requires explicit confirmation and cautions about source changes", () => {
  assert.match(settings, /\/api\/git\/status\?cwd=\$\{encodeURIComponent\(actualCwd\)\}/);
  assert.match(settings, /changedCount === null/);
  assert.match(settings, /Uncommitted files stay in the source checkout/);
  assert.match(settings, /setDestination\(event\.target\.value\)/);
  assert.match(settings, /setMoveTarget\(destination\)/);
  assert.match(settings, /setForkTarget\(destination\)/);
  assert.match(settings, /setMoveTarget\(null\); setForkTarget\(null\)/);
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
