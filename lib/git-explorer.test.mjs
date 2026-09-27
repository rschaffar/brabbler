import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { explorerCheckout, explorerLog, explorerCommit, explorerPatch } = await import("./git-explorer.ts");

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-git-explorer-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  return cwd;
}
function commit(cwd, path, content, message = path) {
  writeFileSync(join(cwd, path), content);
  git(cwd, "add", path);
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}
const code = (expected) => (error) => error?.code === expected;

test("worktree HEAD graph has root, merges, detail and first-parent file patches without reading working files", async (t) => {
  const cwd = fixture(t);
  const root = commit(cwd, "base.txt", "base\n", "root");
  git(cwd, "switch", "-qc", "side");
  const side = commit(cwd, "side.txt", "side\n");
  git(cwd, "switch", "main");
  const main = commit(cwd, "main.txt", "main\n");
  git(cwd, "merge", "--no-ff", "-qm", "join", "side");
  const head = git(cwd, "rev-parse", "HEAD");
  writeFileSync(join(cwd, "base.txt"), "private uncommitted\n");
  writeFileSync(join(cwd, "secret.env"), "private ignored or untracked\n");
  assert.deepEqual(await explorerCheckout(cwd), { head, branch: "main" });
  const log = await explorerLog(cwd);
  assert.equal(log.commits[0].oid, head);
  assert.equal(log.commits.at(-1).oid, root);
  assert.deepEqual(new Set(log.commits.slice(1, 3).map((entry) => entry.oid)), new Set([main, side]));
  assert.deepEqual(log.commits[0].parents, [main, side]);
  assert.equal(log.nextSkip, null);
  const detail = await explorerCommit(cwd, head, head);
  assert.deepEqual(detail.files, [{ path: "side.txt", status: "A" }]);
  assert.match((await explorerPatch(cwd, head, head, "side.txt")).patch, /\+side/);
  assert.deepEqual((await explorerCommit(cwd, head, root)).files, [{ path: "base.txt", status: "A" }]);
  const initial = (await explorerPatch(cwd, head, root, "base.txt")).patch;
  assert.match(initial, /\+base/);
  assert.doesNotMatch(initial, /private/);
  await assert.rejects(explorerPatch(cwd, head, root, "secret.env"), code("NOT_FOUND"));
  await assert.rejects(explorerCommit(cwd, head, "f".repeat(40)), code("NOT_FOUND"));
  await assert.rejects(explorerCommit(cwd, head, "HEAD"), code("INVALID"));
  git(cwd, "switch", "side");
  await assert.rejects(explorerLog(cwd, 0, head), code("STALE"));
  await assert.rejects(explorerPatch(cwd, head, root, "base.txt"), code("STALE"));
});

test("history pages keep one captured HEAD and refuse missing, detached or subdirectory checkouts", async (t) => {
  const cwd = fixture(t);
  commit(cwd, "note.txt", "0\n");
  for (let i = 1; i <= 42; i++) commit(cwd, "note.txt", `${i}\n`);
  const first = await explorerLog(cwd);
  assert.equal(first.commits.length, 40);
  assert.equal(first.nextSkip, 40);
  const second = await explorerLog(cwd, first.nextSkip, first.head);
  assert.equal(second.commits.length, 3);
  assert.equal(second.nextSkip, null);
  await assert.rejects(explorerLog(cwd, -1), code("INVALID"));
  await assert.rejects(explorerLog(cwd, 20_001), code("INVALID"));
  await assert.rejects(explorerCheckout(cwd + "/.git"), code("UNAVAILABLE"));
  commit(cwd, "note.txt", "new\n");
  await assert.rejects(explorerLog(cwd, 40, first.head), code("STALE"));
  git(cwd, "switch", "--detach", "-q");
  await assert.rejects(explorerCheckout(cwd), code("UNAVAILABLE"));
});

test("historical file paths are literal Git pathspecs, even when their name resembles pathspec magic", async (t) => {
  const cwd = fixture(t);
  commit(cwd, "ordinary.txt", "ordinary\n");
  const magic = ":(glob)*";
  writeFileSync(join(cwd, magic), "only-this-file\n");
  execFileSync("git", ["-C", cwd, "add", "--", magic], { env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" } });
  git(cwd, "commit", "-qm", "literal magic filename");
  const head = git(cwd, "rev-parse", "HEAD");
  const result = await explorerPatch(cwd, head, head, magic);
  assert.match(result.patch, /only-this-file/);
  assert.doesNotMatch(result.patch, /ordinary/);
});

test("oversized and binary patches are bounded and binary is reported without exposing unrelated files", async (t) => {
  const cwd = fixture(t);
  const root = commit(cwd, "big.txt", "x".repeat(1024 * 1024 + 100) + "\n");
  await assert.rejects(explorerPatch(cwd, root, root, "big.txt"), code("TOO_LARGE"));
  const binary = commit(cwd, "binary.dat", Buffer.from([0, 1, 2, 3]));
  const patch = await explorerPatch(cwd, binary, binary, "binary.dat");
  assert.equal(patch.hasBinaryChanges, true);
  assert.doesNotMatch(patch.patch, /xxxxxx/);
});
