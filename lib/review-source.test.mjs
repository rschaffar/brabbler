import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { explorerSource } from "./git-explorer.ts";
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const code = expected => error => error?.code === expected;
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "brabbler-review-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-qb", "main");
  git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
  return cwd;
}
function save(cwd) { git(cwd, "add", "."); git(cwd, "commit", "-qm", "snapshot"); return git(cwd, "rev-parse", "HEAD"); }

test("source reads unchanged immutable files and exact bounded coordinates, never working content", async t => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, "source.txt"), "first\r\nsecond\r\nthird");
  const original = save(cwd);
  writeFileSync(join(cwd, "later.txt"), "later\n"); const head = save(cwd);
  writeFileSync(join(cwd, "source.txt"), "MUTABLE WORKING FILE\n");
  assert.deepEqual(await explorerSource(cwd, head, head, "source.txt", 2, 3, "main"), {
    oid: head, path: "source.txt", start: 2, end: 3, totalLines: 3, contents: "second\r\nthird",
  });
  assert.equal((await explorerSource(cwd, head, original, "source.txt", 1, 1, "main")).contents, "first\r");
  for (const path of ["../source.txt", "source.txt/../source.txt", "/source.txt", "source\\txt", ".git/config"])
    await assert.rejects(explorerSource(cwd, head, head, path, 1, 1, "main"));
  for (const [start, end] of [[0, 1], [1, 401], [2, 1], [1, 4], [1.5, 2]])
    await assert.rejects(explorerSource(cwd, head, head, "source.txt", start, end, "main"), code("INVALID"));
  await assert.rejects(explorerSource(cwd, head, head, "missing", 1, 1, "main"), code("NOT_FOUND"));
  await assert.rejects(explorerSource(cwd, head, "HEAD", "source.txt", 1, 1, "main"), code("INVALID"));
  git(cwd, "switch", "-qc", "side");
  writeFileSync(join(cwd, "side.txt"), "side\n"); const outside = save(cwd);
  await assert.rejects(explorerSource(cwd, head, outside, "side.txt", 1, 1, "main"), code("NOT_FOUND"));
  git(cwd, "update-ref", "refs/heads/main", original);
  await assert.rejects(explorerSource(cwd, head, original, "source.txt", 1, 1, "main"), code("STALE"));
});

test("source refuses binary, non-UTF8, symlink, absent and over-limit objects", async t => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, "binary"), Buffer.from([0, 1, 2]));
  writeFileSync(join(cwd, "invalid"), Buffer.from([255]));
  writeFileSync(join(cwd, "big"), "x".repeat(1024 * 1024 + 1));
  writeFileSync(join(cwd, "many"), "x\n".repeat(50001));
  writeFileSync(join(cwd, "empty"), "");
  writeFileSync(join(cwd, "deleted"), "old\n");
  symlinkSync("deleted", join(cwd, "link"));
  save(cwd); rmSync(join(cwd, "deleted")); const head = save(cwd);
  for (const path of ["binary", "invalid", "big", "many", "empty", "deleted", "link"])
    await assert.rejects(explorerSource(cwd, head, head, path, 1, 1, "main"), undefined, path);
});
