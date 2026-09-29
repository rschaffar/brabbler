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
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "config", "tag.gpgsign", "false");
  git(cwd, "config", "advice.nestedTag", "false");
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
  assert.deepEqual(log.refs, [{ branch: "main", oid: head }, { branch: "side", oid: side }]);
  assert.ok(log.commits.every(({ tags }) => Array.isArray(tags) && tags.length === 0), "No tags is a valid empty decoration list");
  assert.deepEqual(Object.keys(log).sort(), ["branch", "commits", "head", "nextSkip", "refs"]);
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

test("local branch history is read-only and bound to the captured ref tip", async (t) => {
  const cwd = fixture(t);
  const root = commit(cwd, "base.txt", "base\n");
  git(cwd, "switch", "-qc", "side");
  const side = commit(cwd, "side.txt", "side\n");
  git(cwd, "switch", "main");
  const main = commit(cwd, "main.txt", "main\n");
  const page = await explorerLog(cwd, 0, undefined, "side");
  assert.equal(page.branch, "side");
  assert.equal(page.head, side);
  assert.deepEqual(page.commits.map(({ oid }) => oid), [side, root]);
  assert.equal(git(cwd, "branch", "--show-current"), "main");
  assert.deepEqual((await explorerCommit(cwd, side, side, "side")).files, [{ path: "side.txt", status: "A" }]);
  assert.match((await explorerPatch(cwd, side, side, "side.txt", "side")).patch, /\+side/);
  await assert.rejects(explorerCommit(cwd, side, main, "side"), code("NOT_FOUND"));
  await assert.rejects(explorerLog(cwd, 0, undefined, "origin/side"), code("NOT_FOUND"));
  await assert.rejects(explorerLog(cwd, 0, undefined, "side^{commit}"), code("NOT_FOUND"));
  git(cwd, "update-ref", "refs/heads/side", root);
  await assert.rejects(explorerLog(cwd, 0, side, "side"), code("STALE"));
  await assert.rejects(explorerCommit(cwd, side, side, "side"), code("STALE"));
  await assert.rejects(explorerPatch(cwd, side, side, "side.txt", "side"), code("STALE"));
  git(cwd, "branch", "-D", "side");
  await assert.rejects(explorerLog(cwd, 0, side, "side"), code("STALE"));
  assert.equal(git(cwd, "rev-parse", "HEAD"), main);
});

test("local tag labels peel lightweight, annotated and nested tags without splitting names or exposing noncommits", async (t) => {
  const cwd = fixture(t);
  const root = commit(cwd, "base.txt", "base\n");
  const head = commit(cwd, "next.txt", "next\n");
  git(cwd, "tag", "light", head);
  git(cwd, "tag", "-a", "annotated", "-m", "release metadata", head);
  git(cwd, "tag", "-a", "nested/release,rc", "-m", "nested release", "refs/tags/annotated");
  git(cwd, "tag", "release/v1,rc", root);
  git(cwd, "tag", "z/line\u2028break-\u00a0", root);
  const tree = git(cwd, "rev-parse", `${root}^{tree}`);
  const blob = git(cwd, "rev-parse", `${root}:base.txt`);
  for (const [name, oid] of [["tree", tree], ["blob", blob]]) {
    git(cwd, "tag", `light-${name}`, oid);
    git(cwd, "tag", "-a", `annotated-${name}`, "-m", "not a commit", oid);
    git(cwd, "tag", "-a", `nested-${name}`, "-m", "still not a commit", `refs/tags/annotated-${name}`);
  }
  const refsBefore = git(cwd, "show-ref", "--dereference");
  const page = await explorerLog(cwd);
  assert.deepEqual(page.commits.map(({ oid, tags }) => ({ oid, tags })), [
    { oid: head, tags: ["annotated", "light", "nested/release,rc"] },
    { oid: root, tags: ["release/v1,rc", "z/line\u2028break-\u00a0"] },
  ]);
  assert.deepEqual(page.refs, [{ branch: "main", oid: head }], "Only branches enter the history selector");
  assert.equal(git(cwd, "show-ref", "--dereference"), refsBefore, "Browsing never writes refs");
  git(cwd, "pack-refs", "--all", "--prune");
  assert.deepEqual(await explorerLog(cwd), page, "Packed tags keep fully peeled labels too");
});

test("a tag sharing the checked-out branch name cannot change its identity or history root", async (t) => {
  const cwd = fixture(t);
  const root = commit(cwd, "base.txt", "base\n");
  const head = commit(cwd, "next.txt", "next\n");
  git(cwd, "tag", "main", root);
  assert.deepEqual(await explorerCheckout(cwd), { head, branch: "main" });
  const page = await explorerLog(cwd);
  assert.deepEqual(await explorerLog(cwd, 0, undefined, "main"), page);
  assert.equal(page.head, head);
  assert.equal(page.branch, "main");
  assert.deepEqual(page.refs, [{ branch: "main", oid: head }]);
  assert.deepEqual(page.commits.map(({ oid, tags }) => ({ oid, tags })), [{ oid: head, tags: [] }, { oid: root, tags: ["main"] }]);
  assert.equal((await explorerCommit(cwd, head, head, "main")).oid, head);
  await assert.rejects(explorerLog(cwd, 0, root, "main"), code("STALE"));
  assert.equal(git(cwd, "symbolic-ref", "HEAD"), "refs/heads/main");
});

test("tag-only commits never gain branch-root or detail/patch authority", async (t) => {
  const cwd = fixture(t);
  const head = commit(cwd, "base.txt", "base\n");
  git(cwd, "switch", "-qc", "side");
  const outside = commit(cwd, "outside.txt", "outside\n");
  git(cwd, "tag", "-a", "tag-only", "-m", "outside current ancestry", outside);
  git(cwd, "switch", "main");
  git(cwd, "branch", "-D", "side");
  const page = await explorerLog(cwd);
  assert.deepEqual(page.commits.map(({ oid, tags }) => ({ oid, tags })), [{ oid: head, tags: [] }]);
  assert.deepEqual(page.refs, [{ branch: "main", oid: head }]);
  for (const branch of ["tag-only", "refs/tags/tag-only", "tag-only^{commit}"]) {
    await assert.rejects(explorerLog(cwd, 0, undefined, branch), code("NOT_FOUND"));
    await assert.rejects(explorerLog(cwd, 0, outside, branch), code("STALE"));
    await assert.rejects(explorerCommit(cwd, outside, outside, branch), code("STALE"));
    await assert.rejects(explorerPatch(cwd, outside, outside, "outside.txt", branch), code("STALE"));
  }
  await assert.rejects(explorerCommit(cwd, head, outside, "main"), code("NOT_FOUND"));
  await assert.rejects(explorerPatch(cwd, head, outside, "outside.txt", "main"), code("NOT_FOUND"));
  await assert.rejects(explorerCommit(cwd, head, "tag-only", "main"), code("INVALID"));
});

test("refresh replaces moved and deleted tag labels without invalidating the unchanged branch tip", async (t) => {
  const cwd = fixture(t);
  const root = commit(cwd, "base.txt", "base\n");
  const head = commit(cwd, "next.txt", "next\n");
  git(cwd, "tag", "-a", "moving", "-m", "release", head);
  const before = await explorerLog(cwd);
  assert.deepEqual(before.commits.map(({ tags }) => tags), [["moving"], []]);
  git(cwd, "update-ref", "refs/tags/moving", root);
  const moved = await explorerLog(cwd, 0, head, "main");
  assert.deepEqual(moved.commits.map(({ tags }) => tags), [[], ["moving"]]);
  git(cwd, "tag", "-d", "moving");
  const deleted = await explorerLog(cwd, 0, head, "main");
  assert.deepEqual(deleted.commits.map(({ tags }) => tags), [[], []]);
  assert.deepEqual(deleted.refs, before.refs);
  assert.equal(deleted.head, before.head);
  assert.deepEqual(deleted.commits.map(({ oid }) => oid), before.commits.map(({ oid }) => oid));
});

test("oversized tag output fails closed and broken refs are not mistaken for no tags", async (t) => {
  const cwd = fixture(t);
  const head = commit(cwd, "base.txt", "base\n");
  // Packed refs avoid thousands of subprocesses and long filename restrictions.
  const packed = join(cwd, ".git", "packed-refs");
  writeFileSync(packed, Array.from({ length: 2200 }, (_, i) => `${head} refs/tags/${String(i).padStart(4, "0")}-${"x".repeat(1000)}\n`).join(""));
  await assert.rejects(explorerLog(cwd), code("TOO_LARGE"));
  rmSync(packed);
  writeFileSync(join(cwd, ".git", "refs", "tags", "broken"), `${"f".repeat(40)}\n`);
  await assert.rejects(explorerLog(cwd), code("UNAVAILABLE"));
});

test("history pages keep one captured HEAD and refuse missing, detached or subdirectory checkouts", async (t) => {
  const cwd = fixture(t);
  const root = commit(cwd, "note.txt", "0\n");
  git(cwd, "tag", "oldest", root);
  for (let i = 1; i <= 42; i++) commit(cwd, "note.txt", `${i}\n`);
  git(cwd, "tag", "newest");
  const first = await explorerLog(cwd);
  assert.equal(first.commits.length, 40);
  assert.equal(first.nextSkip, 40);
  assert.deepEqual(first.commits.flatMap(({ tags }) => tags), ["newest"]);
  const second = await explorerLog(cwd, first.nextSkip, first.head);
  assert.equal(second.commits.length, 3);
  assert.equal(second.nextSkip, null);
  assert.deepEqual(second.commits.map(({ tags }) => tags), [[], [], ["oldest"]]);
  assert.equal(second.commits.at(-1).oid, root);
  assert.deepEqual(second.refs, first.refs);
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
  assert.equal(new Set([...first.commits, ...second.commits].map(({ oid }) => oid)).size, 43);
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
