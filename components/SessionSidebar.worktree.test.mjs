import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("uses the server-resolved current worktree identity", () => {
  assert.match(source, /currentWorktreePath: string \| null/);
  assert.match(
    source,
    /const currentWorktree =[\s\S]*?worktreeState\.currentWorktreePath[\s\S]*?worktree\.path === worktreeState\.currentWorktreePath/,
  );
  assert.match(source, /if \(currentWorktreePath === path\) setSelectedCwd\(worktreeState\.projectRoot\)/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});

test("worktree cleanup needs a separate explicit confirmation, even when clean", () => {
  assert.match(source, /onClick=\{\(\) => \{ setWtConfirmRemove\(null\); setWtPendingRemove\(wt\.path\); \}\}/);
  assert.match(source, /wtPendingRemove === wt\.path[\s\S]*?sidebar\.confirmRemoveCheckout[\s\S]*?handleRemoveWorktree\(wt\.path, false\)/);
  assert.match(source, /data\.dirty && !force[\s\S]*?setWtConfirmRemove\(path\)/);
  assert.match(source, /wtConfirmRemove === wt\.path[\s\S]*?handleRemoveWorktree\(wt\.path, true\)/);
});

test("worktree creation requires explicit local base and captured OIDs", () => {
  assert.match(source, /<option value="">Select a local base…<\/option>/);
  assert.match(source, /Expected base HEAD:.*wtBase\.oid/);
  assert.match(source, /Expected branch tip:.*wtAttach\.oid/);
  assert.match(source, /baseBranch: wtBase\.branch, expectedBaseOid: wtBase\.oid/);
  assert.match(source, /expectedTipOid: wtAttach\?\.oid/);
  assert.match(source, /mode: wtMode/);
  assert.doesNotMatch(source, /setWtBase\(.*localBranches\[0\]/);
});
