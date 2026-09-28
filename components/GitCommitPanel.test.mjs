import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./GitCommitPanel.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("commit review is only mounted for a persisted ordinary chat at the chat cwd", () => {
  assert.match(chat, /session && !session\.transient && session\.relation\?\.kind !== "subagent" && createPortal/);
  assert.match(chat, /hidden=\{gitControlsPanel !== "commit"\}.*visitedGitDetails\.includes\("commit"\)/);
  assert.match(chat, /session && !session\.transient && session\.relation\?\.kind !== "subagent"/);
  assert.match(chat, /<GitCommitPanel key=\{`commit:\$\{session\.id\}:\$\{session\.cwd\}`\} sessionId=\{session\.id\} cwd=\{session\.cwd\}/);
  assert.match(chat, /<GitCommitPanel[\s\S]*?busy=\{sessionBusy \|\| isCompacting \|\| modelSwitching \|\| Boolean\(forkingEntryId\) \|\| quoteSubmitting \|\| Boolean\(sessionRunning\)\}/);
});

test("review keeps diff read-only and requires explicit paths, message, preview, and confirm", () => {
  assert.match(panel, /\/api\/git\/status\?/);
  assert.match(panel, /\/api\/git\/diff\?/);
  assert.match(panel, /checked=\{selected\.includes\(path\)\}/);
  assert.match(panel, /NOT the authoritative commit candidate/);
  assert.match(panel, /non-authoritative working-tree diff/);
  assert.match(panel, /Authoritative candidate patch \(HEAD tree → candidate tree\)/);
  assert.match(panel, /candidate\.candidateDiff\.hasBinaryChanges/);
  assert.match(panel, /candidate\.candidateDiff\.patch/);
  assert.match(panel, /candidateDiffUnavailable/);
  assert.match(panel, /preview\.reviewToken/);
  assert.match(panel, /unsupported diffs do not exclude a file/);
  assert.match(panel, /JSON\.stringify\(\{ operation: "preview", sessionId, paths: selected, message \}\)/);
  assert.match(panel, /JSON\.stringify\(\{ operation: "confirm", sessionId, preview, message, actionId: candidate\.actionId \}\)/);
  assert.match(panel, /new CustomEvent\("pi-web:git-actions-changed", \{ detail: \{ sessionId \} \}\)/);
  assert.match(panel, /body\.recoveryRequired/);
  assert.match(panel, /result\.recoveryWarning/);
  assert.match(panel, /onClick=\{\(\) => void confirm\(\)\}/);
  assert.doesNotMatch(panel, /location\.reload|window\.location/);
});

test("selection, message, refresh and busy invalidate preview; stale errors and partial success remain visible", () => {
  assert.match(panel, /const invalidate = \(\) => \{ generation\.current\+\+; setCandidate\(null\); \}/);
  assert.match(panel, /if \(busy\) \{ generation\.current\+\+; setCandidate\(null\); \}/);
  assert.match(panel, /const refresh = \(\) => \{\s*invalidate\(\)/);
  assert.match(panel, /onChange=\{\(event\) => \{ invalidate\(\); setSelected/);
  assert.match(panel, /onChange=\{\(event\) => \{ invalidate\(\); setMessage/);
  assert.match(panel, /if \(generation\.current === version\) setCandidate\(body\)/);
  assert.match(panel, /const preview = candidate\?\.preview \?\? null/);
  assert.match(panel, /response\.status === 409/);
  assert.match(panel, /setResult\(body\)/);
  assert.match(panel, /status === "partial-success"/);
  assert.match(panel, /<dt>Commit ID<\/dt>/);
  assert.match(panel, /<dt>Author email<\/dt>/);
  assert.match(panel, /setRevision\(\(value\) => value \+ 1\)/);
});
