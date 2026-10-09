import assert from "node:assert/strict";
import { fstatSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const { directoryIdentity, holdCleanupParent, supportsNestedCleanup } = await createJiti(import.meta.url).import("./cleanup-path.ts");
const enabled = supportsNestedCleanup();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-cleanup-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worktree = join(root, "worktree"); mkdirSync(join(worktree, "parent/nested"), { recursive: true });
  writeFileSync(join(worktree, "parent/nested/cache.pyc"), "approved");
  const identities = ["", "parent", "parent/nested"].map((path) => ({ path, identity: directoryIdentity(lstatSync(join(worktree, path), { bigint: true })) }));
  return { root, worktree, identities };
}
test("nested removal holds captured ancestors and closes the final descriptor", { skip: !enabled }, async (t) => {
  const f = fixture(t); const held = holdCleanupParent(f.worktree, "parent/nested/cache.pyc", f.identities);
  const fd = Number(held.path.match(/^\/proc\/self\/fd\/(\d+)\//)[1]);
  try { held.validate(); await rm(held.path); assert.equal(readdirSync(join(f.worktree, "parent/nested")).length, 0); }
  finally { held.close(); }
  assert.throws(() => fstatSync(fd), { code: "EBADF" });
});
test("ancestor replacement is observed without redirecting the held removal path", { skip: !enabled }, async (t) => {
  const f = fixture(t); const outside = join(f.root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "cache.pyc"), "external");
  const held = holdCleanupParent(f.worktree, "parent/nested/cache.pyc", f.identities);
  try {
    renameSync(join(f.worktree, "parent/nested"), join(f.root, "moved")); symlinkSync(outside, join(f.worktree, "parent/nested"));
    assert.throws(() => held.validate(), /ancestor identity changed/);
    assert.equal(readFileSync(held.path, "utf8"), "approved", "The held path remains the approved inode's child");
    assert.equal(readFileSync(join(outside, "cache.pyc"), "utf8"), "external");
  } finally { held.close(); }
});
test("no-follow opens reject symlink ancestors and mismatched identities without leaking descriptors", { skip: !enabled }, (t) => {
  const f = fixture(t); const before = readdirSync("/proc/self/fd").length;
  const bad = f.identities.map((item) => ({ ...item, identity: ["0", "0", "0"] }));
  assert.throws(() => holdCleanupParent(f.worktree, "parent/nested/cache.pyc", bad), /ancestor identity changed/);
  renameSync(join(f.worktree, "parent/nested"), join(f.root, "moved")); symlinkSync(join(f.root, "moved"), join(f.worktree, "parent/nested"));
  assert.throws(() => holdCleanupParent(f.worktree, "parent/nested/cache.pyc", f.identities), /ENOTDIR|ELOOP/);
  assert.equal(readdirSync("/proc/self/fd").length, before);
});
test("held root validation refuses replacement of the worktree itself", { skip: !enabled }, (t) => {
  const f = fixture(t); const held = holdCleanupParent(f.worktree, "parent/nested/cache.pyc", f.identities);
  try {
    renameSync(f.worktree, join(f.root, "old-worktree")); mkdirSync(f.worktree);
    assert.throws(() => held.validate(), /worktree identity changed/);
  } finally { held.close(); }
});
