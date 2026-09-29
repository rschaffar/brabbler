import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as filesystem } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const { createJiti } = await import("jiti");
const { prepareGitCommit, confirmGitCommit } = await createJiti(import.meta.url).import("./git-commit.ts");
async function git(cwd, ...args) { return (await exec("git", ["-C", cwd, ...args])).stdout.trim(); }
async function repo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-commit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "repo");
  await exec("git", ["init", "-q", dir]);
  await git(dir, "config", "user.name", "Test");
  await git(dir, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(dir, "a"), "first\n");
  await writeFile(path.join(dir, "other"), "other\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-qm", "initial");
  return { root, dir };
}

test("selected changes only: preserves unselected worktree and clean real index", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  await writeFile(path.join(dir, "other"), "untouched\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  assert.match(preview.reviewToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(preview.paths, ["a"]);
  const result = await confirmGitCommit(preview, "selected");
  assert.equal(result.status, "committed");
  assert.equal(result.authorEmail, "test@example.invalid");
  assert.deepEqual(result.parents, [preview.head]);
  assert.equal(result.tree, preview.tree);
  const raw = await git(dir, "cat-file", "-p", "HEAD");
  assert.match(raw, new RegExp(`^tree ${preview.tree}\\nparent ${preview.head}\\nauthor Test <test@example\\.invalid> \\d+ [+-]\\d{4}\\ncommitter Test <test@example\\.invalid> \\d+ [+-]\\d{4}\\n\\nselected$`));
  assert.equal(await git(dir, "show", "HEAD:a"), "second");
  assert.equal(await git(dir, "show", "HEAD:other"), "other");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  assert.equal(await git(dir, "status", "--porcelain"), "M other");
});

test("stale worktree, index and branch are rejected; no commit on concurrent ref move", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  let preview = await prepareGitCommit(dir, ["a"]);
  await writeFile(path.join(dir, "a"), "third\n");
  await assert.rejects(confirmGitCommit(preview, "stale"), /stale preview/);
  preview = await prepareGitCommit(dir, ["a"]);
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const beforeRefresh = await readFile(indexPath);
  // Make the stat-cache refresh deterministic; adding an untouched file can be a no-op.
  await utimes(path.join(dir, "other"), new Date(0), new Date(0));
  await git(dir, "add", "other");
  assert.notDeepEqual(await readFile(indexPath), beforeRefresh, "The fixture must actually change index bytes");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "", "Staged contents stay unchanged");
  await assert.rejects(confirmGitCommit(preview, "stale"), /stale preview/);
  await git(dir, "reset", "-q");
  preview = await prepareGitCommit(dir, ["a"]);
  const base = await git(dir, "rev-parse", "HEAD");
  const tree = await git(dir, "rev-parse", "HEAD^{tree}");
  const outsider = await git(dir, "commit-tree", tree, "-p", base, "-m", "outsider");
  await git(dir, "update-ref", preview.branch, outsider, base);
  await assert.rejects(confirmGitCommit(preview, "stale"), /stale preview/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), outsider);
});

test("client cannot forge another selection or edit an approved preview", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "new a\n");
  await writeFile(path.join(dir, "other"), "new other\n");
  const approved = await prepareGitCommit(dir, ["a"]);
  const alternate = await prepareGitCommit(dir, ["other"]);
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const originalIndex = await readFile(indexPath);
  const indexHash = createHash("sha256").update(originalIndex).digest("hex");
  const forged = createHash("sha256")
    .update(JSON.stringify([alternate.branch, alternate.head, alternate.paths, indexHash, alternate.tree]))
    .digest("hex");
  const head = await git(dir, "rev-parse", "HEAD");
  await assert.rejects(confirmGitCommit({ ...alternate, reviewToken: forged }, "forged"), /stale preview/);
  await assert.rejects(confirmGitCommit({ ...alternate, reviewToken: approved.reviewToken }, "forged"), /stale preview/);
  await assert.rejects(confirmGitCommit({ ...approved, tree: alternate.tree }, "forged"), /stale preview/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), head);
  assert.deepEqual(await readFile(indexPath), originalIndex);
});

test("post-ref index installation failure is explicitly partial success, with the original index intact", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "new content\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const before = await readFile(indexPath);
  const renameOriginal = filesystem.rename;
  filesystem.rename = async (from, to) => {
    if (from === `${indexPath}.lock` && to === indexPath) throw new Error("simulated index installation failure");
    return renameOriginal(from, to);
  };
  let result;
  try { result = await confirmGitCommit(preview, "partial"); }
  finally { filesystem.rename = renameOriginal; }
  assert.equal(result.status, "partial-success");
  assert.match(result.reason, /checkout finalization failed/);
  assert.equal(result.authorEmail, "test@example.invalid");
  assert.deepEqual(result.parents, [preview.head]);
  assert.equal(result.tree, preview.tree);
  assert.equal(await git(dir, "rev-parse", "HEAD"), result.commit);
  assert.equal(await git(dir, "show", "HEAD:a"), "new content");
  assert.deepEqual(await readFile(indexPath), before);
  await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
});

test("untracked binary, literal glob characters and a rename pair are complete", async (t) => {
  const { dir } = await repo(t);
  await rename(path.join(dir, "a"), path.join(dir, "new"));
  await writeFile(path.join(dir, "[literal]*"), Buffer.from([0, 1, 255]));
  const preview = await prepareGitCommit(dir, ["a", "new", "[literal]*"]);
  assert.deepEqual(preview.paths, ["[literal]*", "a", "new"]);
  assert.equal((await confirmGitCommit(preview, "rename and binary")).status, "committed");
  assert.deepEqual(await readFile(path.join(dir, "[literal]*")), Buffer.from([0, 1, 255]));
  assert.equal(await git(dir, "show", "--format=", "--name-status", "HEAD"), "A\t[literal]*\nR100\ta\tnew");
  assert.equal(await git(dir, "status", "--porcelain"), "");
});

test("dirty index, detached head, subdirectory, symlink ancestor and existing lock fail closed", async (t) => {
  const { dir, root } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  await git(dir, "add", "a");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /index differs from HEAD/);
  await git(dir, "reset", "-q");
  await exec("git", ["-C", dir, "checkout", "--detach", "-q"]);
  await assert.rejects(prepareGitCommit(dir, ["a"]), /detached HEAD/);
  await git(dir, "switch", "-q", "-");
  await assert.rejects(prepareGitCommit(root, ["a"]), /repository-root|checkout root/);
  await assert.rejects(prepareGitCommit(path.join(dir, ".git"), ["a"]), /repository-root|checkout root/);
  if (process.platform !== "win32") {
    const external = path.join(root, "external");
    await mkdir(external);
    await symlink(external, path.join(dir, "link"), "dir");
    await assert.rejects(prepareGitCommit(dir, ["link/file"]), /not in current status/);
    await mkdir(path.join(dir, "nested"));
    await writeFile(path.join(dir, "nested", "file"), "inside\n");
    await git(dir, "add", "nested/file");
    await git(dir, "commit", "-qm", "nested");
    await rm(path.join(dir, "nested"), { recursive: true });
    await writeFile(path.join(external, "file"), "outside\n");
    await symlink(external, path.join(dir, "nested"), "dir");
    await assert.rejects(prepareGitCommit(dir, ["nested/file"]), /symlink ancestor/);
  }
  const index = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  await writeFile(`${index}.lock`, "another writer");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /index locked/);
  assert.equal(await readFile(`${index}.lock`, "utf8"), "another writer");
});

test("intent-to-add and nonstandard index flags are not silently overwritten", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "changed\n");
  await writeFile(path.join(dir, "new"), "not actually staged\n");
  await git(dir, "add", "-N", "new");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /index differs from HEAD/);
  await git(dir, "reset", "-q", "--", "new");
  await git(dir, "update-index", "--assume-unchanged", "other");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /nonstandard index flags/);
});

test("whitespace errors fail diff --cached --check without mutating the index", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "bad trailing space \n");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /diff.*check|trailing whitespace|Command failed/);
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
});

test("unmerged index fails closed", async (t) => {
  const { dir } = await repo(t);
  const base = await git(dir, "branch", "--show-current");
  await git(dir, "switch", "-qc", "conflict-side");
  await writeFile(path.join(dir, "a"), "side\n");
  await git(dir, "commit", "-qam", "side");
  await git(dir, "switch", "-q", base);
  await writeFile(path.join(dir, "a"), "main\n");
  await git(dir, "commit", "-qam", "main");
  await assert.rejects(git(dir, "merge", "--no-commit", "conflict-side"));
  await assert.rejects(prepareGitCommit(dir, ["a"]), /merge is in progress/);
  // An unmerged index without a merge marker must independently remain blocked.
  await rm(path.join(dir, ".git", "MERGE_HEAD"));
  await assert.rejects(prepareGitCommit(dir, ["a"]), /unmerged index/);
});

test("linked checkout has its own index and branch", async (t) => {
  const { root, dir } = await repo(t);
  const linked = path.join(root, "linked");
  await git(dir, "worktree", "add", "-q", "-b", "linked", linked);
  await writeFile(path.join(linked, "a"), "linked\n");
  const preview = await prepareGitCommit(linked, ["a"]);
  assert.equal(preview.branch, "refs/heads/linked");
  assert.equal((await confirmGitCommit(preview, "linked")).status, "committed");
  assert.equal(await git(dir, "show", "HEAD:a"), "first");
  assert.equal(await git(linked, "show", "HEAD:a"), "linked");
});

test("atomic ref compare-and-swap rejects a branch move during confirmation", { skip: process.platform === "win32" }, async (t) => {
  const { root, dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "candidate\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const realGit = (await exec("which", ["git"])).stdout.trim();
  const wrapper = path.join(bin, "git");
  await writeFile(wrapper, `#!/usr/bin/env node\nconst { execFileSync } = require('node:child_process');\nconst args = process.argv.slice(2);\nconst real = ${JSON.stringify(realGit)};\nif (args.includes('update-ref')) {\n  const cwd = args[args.indexOf('-C') + 1];\n  const ref = args[args.indexOf('update-ref') + 1];\n  const old = args.at(-1);\n  const tree = execFileSync(real, ['-C', cwd, 'rev-parse', 'HEAD^{tree}'], {encoding:'utf8'}).trim();\n  const rival = execFileSync(real, ['-C', cwd, 'commit-tree', tree, '-p', old, '-m', 'rival'], {encoding:'utf8'}).trim();\n  execFileSync(real, ['-C', cwd, 'update-ref', ref, rival, old]);\n}\ntry { process.stdout.write(execFileSync(real, args)); }\ncatch (e) { process.stderr.write(e.stderr || ''); process.exit(e.status || 1); }\n`);
  await chmod(wrapper, 0o755);
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
    await assert.rejects(confirmGitCommit(preview, "ours"), /update-ref/);
  } finally { process.env.PATH = originalPath; }
  assert.equal(await git(dir, "log", "-1", "--format=%s"), "rival");
  assert.equal(await git(dir, "show", "HEAD:a"), "first");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  const index = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  await assert.rejects(readFile(`${index}.lock`), { code: "ENOENT" });
});

test("commit object must have the approved tree, parent and identity before moving the ref", { skip: process.platform === "win32" }, async (t) => {
  const { root, dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "approved\n");
  const preview = await prepareGitCommit(dir, ["a"]);
  const bin = path.join(root, "fake-git");
  await mkdir(bin);
  const realGit = (await exec("which", ["git"])).stdout.trim();
  const wrapper = path.join(bin, "git");
  await writeFile(wrapper, `#!/usr/bin/env node\nconst {execFileSync} = require('node:child_process');\nconst args = process.argv.slice(2);\nconst real = ${JSON.stringify(realGit)};\nif (args.includes('commit-tree')) {\n  process.stdout.write(execFileSync(real, ['-C', args[args.indexOf('-C') + 1], 'rev-parse', 'HEAD']));\n} else {\n  try { process.stdout.write(execFileSync(real, args)); }\n  catch (e) { process.stderr.write(e.stderr || ''); process.exit(e.status || 1); }\n}\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    await assert.rejects(confirmGitCommit(preview, "refused"), /commit object differs/);
  } finally { process.env.PATH = oldPath; }
  assert.equal(await git(dir, "rev-parse", "HEAD"), preview.head);
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), "");
  const indexPath = path.normalize(await git(dir, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
});

test("hooks, configured filters, signing and attribute filters refuse preview", async (t) => {
  const { dir } = await repo(t);
  await writeFile(path.join(dir, "a"), "second\n");
  const hook = path.join(dir, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /hook policy/);
  await rm(hook);
  for (const [key, value] of [["filter.test.clean", "cat"], ["commit.gpgsign", "true"], ["core.hooksPath", "/tmp/hooks"]]) {
    await git(dir, "config", key, value);
    await assert.rejects(prepareGitCommit(dir, ["a"]), /unsupported Git policy/);
    await git(dir, "config", "--unset", key);
  }
  await writeFile(path.join(dir, ".gitattributes"), "a filter=magic\n");
  await assert.rejects(prepareGitCommit(dir, ["a"]), /filter attribute/);
});
