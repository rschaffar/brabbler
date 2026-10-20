import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./FileWorkspace.tsx", import.meta.url), "utf8");

test("the shell delegates file lifetime to one retained workspace, independently of terminal hosts", () => {
  assert.equal(shell.match(/<FileWorkspace /g)?.length, 1);
  assert.doesNotMatch(shell, /<FileViewer/);
  assert.match(shell, /terminalTabs\.map\(\(tab\) => \(/);
  assert.match(shell, /active=\{rightPanelOpen && tab\.id === activeFileTabId\}/);
});
test("views use stable identity and explicit location commands rather than navigation-key remounts", () => {
  assert.match(workspace, /key=\{composite\(key, view\.id\)\}/);
  assert.match(workspace, /navigationId=\{view\.viewerRevision\}/);
  assert.match(workspace, /initialState=\{view\.viewerState\}/);
  assert.doesNotMatch(workspace, /key=\{[^\n]*viewerRevision/);
});
test("resource edit owners retain drafts, settle saves and guard close operations", () => {
  assert.match(workspace, /if \(!selected && !session\.draft && !session\.saving\) return \[\]/);
  assert.match(workspace, /if \(ids\.some\(id => protect\(key, id\)\.saving\)\) return false/);
  assert.match(workspace, /FileEditContext\.Provider/);
  assert.match(workspace, /edits\.dirty/);
});
test("hidden readers retain their host but pause their watcher", () => {
  assert.match(workspace, /watchEnabled=\{visible && props\.active\}/);
  assert.match(workspace, /hidden=\{!visible\} inert=\{!visible\}/);
});
test("file links retain page, line and originating read context", () => {
  assert.match(workspace, /onOpenFile=\{\(filePath, page, lineTarget, disposition\)/);
  assert.match(workspace, /cwd: view\.cwd, sourceSessionId: view\.sourceSessionId, page, lineTarget/);
  assert.match(workspace, /initialPage=\{view\.page\} initialLineTarget=\{view\.lineTarget\}/);
});
