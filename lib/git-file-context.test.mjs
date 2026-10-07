import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decodeDiffText, readGitFileContext, readGitTreeFile } from "./git-file-context.ts";
import { explorerFileContext } from "./git-explorer.ts";
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-file-context-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-qb", "main"); git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.invalid"); git(cwd, "config", "commit.gpgsign", "false");
  return cwd;
}
function commit(cwd) { git(cwd, "add", "--all"); git(cwd, "commit", "-qm", "fixture"); return git(cwd, "rev-parse", "HEAD"); }

test("context reads exact immutable old/new blobs, empty/absent sides and literal special paths", async (t) => {
  const cwd = fixture(t), path = ":(glob) café\tfile.txt";
  writeFileSync(join(cwd, path), "before\ncontext\n"); const before = commit(cwd);
  writeFileSync(join(cwd, path), "after\ncontext\n"); writeFileSync(join(cwd, "empty"), ""); const after = commit(cwd);
  writeFileSync(join(cwd, path), "dirty current file must never be used\n");
  const value = await readGitFileContext(cwd, before, after, path);
  assert.equal(value.oldFile.contents, "before\ncontext\n"); assert.equal(value.newFile.contents, "after\ncontext\n");
  assert.notEqual(value.oldFile.cacheKey, value.newFile.cacheKey);
  assert.equal((await readGitFileContext(cwd, null, after, "empty")).oldFile, null);
  assert.equal((await readGitTreeFile(cwd, after, "empty")).contents, "");
  assert.equal(await readGitTreeFile(cwd, before, "empty"), null);
  assert.equal((await readGitFileContext(cwd, after, null, path)).newFile, null);
  await assert.rejects(readGitTreeFile(cwd, "HEAD", path), { status: 400 });
  await assert.rejects(readGitFileContext(cwd, before, after, "absent"), { status: 404 });
});

test("context rejects binary, invalid UTF-8, symlink, gitlink, huge and missing objects without reading live targets", async (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, "binary"), Buffer.from([65, 0, 66])); writeFileSync(join(cwd, "invalid"), Buffer.from([0xff]));
  writeFileSync(join(cwd, "huge"), "x".repeat(1024 * 1024 + 1)); symlinkSync("/unread-live-target", join(cwd, "link"));
  const oid = commit(cwd);
  git(cwd, "update-index", "--add", "--cacheinfo", `160000,${oid},submodule`); git(cwd, "commit", "-qm", "gitlink");
  const withGitlink = git(cwd, "rev-parse", "HEAD");
  for (const path of ["binary", "invalid", "link", "submodule"]) await assert.rejects(readGitTreeFile(cwd, withGitlink, path), { status: 409 });
  await assert.rejects(readGitTreeFile(cwd, oid, "huge"), { status: 413 });
  await assert.rejects(readGitTreeFile(cwd, "f".repeat(40), "invalid"), { status: 409 });
  assert.equal(decodeDiffText(Buffer.from("\ufefftext\r\n")), "\ufefftext\r\n");
  assert.throws(() => decodeDiffText(Buffer.from("\n".repeat(50_001))), { status: 413 });
});

test("Explorer full context shares changed-path membership, reachable commit and captured branch guards", async (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, "changed"), "old\n"); writeFileSync(join(cwd, "unchanged"), "context\n"); const root = commit(cwd);
  writeFileSync(join(cwd, "changed"), "new\n"); const head = commit(cwd);
  writeFileSync(join(cwd, "changed"), "dirty\n");
  assert.equal((await explorerFileContext(cwd, head, head, "changed", "main")).newFile.contents, "new\n");
  await assert.rejects(explorerFileContext(cwd, head, head, "unchanged", "main"), { code: "NOT_FOUND" });
  const added = await explorerFileContext(cwd, head, root, "changed", "main"); assert.equal(added.oldFile, null);
  git(cwd, "branch", "side", root); git(cwd, "update-ref", "refs/heads/main", root);
  await assert.rejects(explorerFileContext(cwd, head, head, "changed", "main"), { code: "STALE" });
  await assert.rejects(explorerFileContext(cwd, root, head, "changed", "side"), { code: "NOT_FOUND" });
});
