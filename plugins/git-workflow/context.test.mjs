import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-git-approval-context-"));
const isolated = {
  HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"),
  PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1",
};
const previous = Object.fromEntries(Object.keys(isolated).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(isolated)) process.env[key] = value;
mkdirSync(isolated.HOME);
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { fsCache: false });
const { registerGitPatchContext, readGitPatchContext, GIT_CONTEXT_TTL_MS } = await jiti.import("./context.ts");
const { splitGitPatch } = await jiti.import("../../lib/git-patch-display.ts");
const snapshots = globalThis[Symbol.for("pi-web:git-plugin-context")];
beforeEach(() => snapshots.clear());
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
}).trim();
let sequence = 0;
function fixture() {
  const cwd = join(root, `repo-${++sequence}`); mkdirSync(cwd);
  git(cwd, "init", "-qb", "main"); git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.invalid"); git(cwd, "config", "core.autocrlf", "false");
  git(cwd, "config", "core.filemode", "true");
  writeFileSync(join(cwd, "file.txt"), "before\nunchanged context\n");
  const before = commit(cwd);
  writeFileSync(join(cwd, "file.txt"), "after\nunchanged context\n");
  const after = commit(cwd);
  return { cwd, before, after, patch: patch(cwd, before, after) };
}
function commit(cwd) {
  git(cwd, "add", "--all"); git(cwd, "commit", "-qm", "fixture"); return git(cwd, "rev-parse", "HEAD");
}
function patch(cwd, before, after) {
  return git(cwd, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--binary", "--find-renames", before, after) + "\n";
}
const register = (value, now) => registerGitPatchContext(value.cwd, value.before, value.after, value.patch, now);
const metadata = (name) => `diff --git a/${name} b/${name}\nold mode 100644\nnew mode 100755\n`;

// Git blob validation/parser behavior is covered by the shared helper tests.
// These cases focus on opaque plugin admission, patch-to-file mapping and lifetime.
test("opaque handles are unique and read the reviewed immutable pair despite dirty worktree/index/HEAD", async () => {
  const value = fixture();
  // Commit approvals supply a captured candidate tree, not an after-commit ref.
  value.after = git(value.cwd, "rev-parse", `${value.after}^{tree}`);
  const handle = register(value), second = register(value);
  assert.match(handle, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.notEqual(handle, second); assert.ok(!handle.includes(value.before));
  writeFileSync(join(value.cwd, "file.txt"), "staged content must not be used\n"); git(value.cwd, "add", "file.txt");
  git(value.cwd, "commit", "-qm", "different current HEAD");
  writeFileSync(join(value.cwd, "file.txt"), "dirty worktree must not be used\n");
  const context = await readGitPatchContext(handle, "0");
  assert.equal(context.oldFile.contents, "before\nunchanged context\n");
  assert.equal(context.newFile.contents, "after\nunchanged context\n");
  assert.equal(context.oldFile.name, "file.txt"); assert.equal(context.newFile.name, "file.txt");
  assert.notEqual(context.oldFile.cacheKey, context.newFile.cacheKey);
  assert.deepEqual(await readGitPatchContext(second, "0"), context);
});

test("file IDs follow the supplied patch order, including renamed, metadata-only, added/deleted/empty and binary blocks", async () => {
  const { cwd } = fixture();
  const renamedBefore = "retained context\n".repeat(30) + "old\n";
  writeFileSync(join(cwd, "old name.txt"), renamedBefore);
  writeFileSync(join(cwd, "mode.txt"), "mode-only contents\n");
  writeFileSync(join(cwd, "delete.txt"), "deleted snapshot\n");
  writeFileSync(join(cwd, "binary.dat"), Buffer.from([1, 0, 2]));
  const before = commit(cwd);
  renameSync(join(cwd, "old name.txt"), join(cwd, "new name.txt"));
  const renamedAfter = renamedBefore.replace("old\n", "new\n"); writeFileSync(join(cwd, "new name.txt"), renamedAfter);
  chmodSync(join(cwd, "mode.txt"), 0o755); rmSync(join(cwd, "delete.txt"));
  writeFileSync(join(cwd, "added.txt"), "added snapshot\n"); writeFileSync(join(cwd, "empty.txt"), "");
  writeFileSync(join(cwd, "binary.dat"), Buffer.from([3, 0, 4]));
  const after = commit(cwd);
  // Deliberately reverse Git's native sort order: IDs belong to the saved patch,
  // not to a fresh diff/status call or a path supplied by the browser.
  const blocks = splitGitPatch(patch(cwd, before, after)).reverse();
  assert.deepEqual(blocks.map((file) => file.path), ["new name.txt", "mode.txt", "empty.txt", "delete.txt", "binary.dat", "added.txt"]);
  const suppliedPatch = blocks.map((file) => file.value.patch).join("");
  const handle = registerGitPatchContext(cwd, before, after, suppliedPatch);
  const expected = new Map([
    ["new name.txt", [renamedBefore, renamedAfter]], ["mode.txt", ["mode-only contents\n", "mode-only contents\n"]],
    ["empty.txt", [null, ""]], ["delete.txt", ["deleted snapshot\n", null]], ["added.txt", [null, "added snapshot\n"]],
  ]);
  for (const [index, block] of blocks.entries()) {
    if (block.path === "binary.dat") {
      await assert.rejects(readGitPatchContext(handle, String(index)), { status: 409, message: /binary/ });
      continue;
    }
    const context = await readGitPatchContext(handle, String(index));
    const [old, current] = expected.get(block.path);
    assert.equal(context.oldFile === null ? null : context.oldFile.contents, old);
    assert.equal(context.newFile === null ? null : context.newFile.contents, current);
    if (block.path === "new name.txt") assert.equal(context.oldFile.name, "old name.txt");
  }
  await assert.rejects(readGitPatchContext(handle, "file.txt"), { status: 404 });
});

test("bad/missing handles and file IDs cannot name arbitrary paths, objects or another snapshot's file", async () => {
  const value = fixture(), handle = register(value);
  for (const candidate of ["", "HEAD", value.before, "../../file.txt", "00000000-0000-0000-0000-000000000000"]) {
    await assert.rejects(readGitPatchContext(candidate, "0"), { status: 409, message: /expired|restarted/ });
  }
  for (const fileId of ["", "01", "-1", "1", "256", "file.txt", ".git/config", "\0"]) {
    await assert.rejects(readGitPatchContext(handle, fileId), { status: 404, message: /not part/ });
  }
  snapshots.clear();
  await assert.rejects(readGitPatchContext(handle, "0"), { status: 409, message: /restarted/ });
});

test("handles expire exactly at one hour and registering a later snapshot prunes expired handles", async () => {
  assert.equal(GIT_CONTEXT_TTL_MS, 60 * 60 * 1000);
  const value = fixture(), now = Date.now(), handle = register(value, now);
  assert.ok((await readGitPatchContext(handle, "0", now + GIT_CONTEXT_TTL_MS - 1)).newFile);
  await assert.rejects(readGitPatchContext(handle, "0", now + GIT_CONTEXT_TTL_MS), { status: 409, message: /expired/ });
  const fresh = register(value, now + GIT_CONTEXT_TTL_MS);
  assert.equal(snapshots.has(handle), false);
  assert.ok((await readGitPatchContext(fresh, "0", now + GIT_CONTEXT_TTL_MS)).newFile);
});

test("the plugin cache evicts only the oldest snapshot when exceeding 64 handles", async () => {
  const value = fixture(), now = Date.now(), handles = [];
  for (let index = 0; index < 64; index++) handles.push(register(value, now));
  assert.equal(new Set(handles).size, 64);
  assert.ok((await readGitPatchContext(handles[0], "0", now)).newFile);
  const latest = register(value, now);
  await assert.rejects(readGitPatchContext(handles[0], "0", now), { status: 409 });
  assert.ok((await readGitPatchContext(handles[1], "0", now)).newFile);
  assert.ok((await readGitPatchContext(latest, "0", now)).newFile);
  assert.equal(snapshots.size, 64);
});

test("registration admits at most 256 files and refuses malformed framing without dropping blocks", async () => {
  const value = fixture(); writeFileSync(join(value.cwd, "file255"), "last admitted file\n");
  const oid = commit(value.cwd), boundedPatch = Array.from({ length: 256 }, (_, index) => metadata(`file${index}`)).join("");
  const handle = registerGitPatchContext(value.cwd, oid, oid, boundedPatch);
  assert.ok(handle); assert.equal(snapshots.get(handle).files.size, 256);
  assert.equal((await readGitPatchContext(handle, "255")).newFile.contents, "last admitted file\n");
  assert.equal(registerGitPatchContext(value.cwd, oid, oid, boundedPatch + metadata("file256")), undefined);
  for (const invalid of ["", "not a patch", "unexpected preamble\n" + value.patch]) {
    assert.equal(registerGitPatchContext(value.cwd, oid, oid, invalid), undefined);
  }
  assert.equal(snapshots.size, 1, "Refusal must not replace the existing admitted snapshot");
});

test("repository disappearance or common-directory replacement refuses saved handles, not live checkout content", async (t) => {
  for (const kind of ["missing", "replaced"]) await t.test(kind, async () => {
    const value = fixture(), handle = register(value);
    if (kind === "missing") renameSync(value.cwd, `${value.cwd}-moved`);
    else {
      const common = join(value.cwd, ".git"), backup = `${common}-saved`;
      renameSync(common, backup); cpSync(backup, common, { recursive: true });
    }
    await assert.rejects(readGitPatchContext(handle, "0"), { status: 409, message: /repository is no longer available.*saved patch/ });
  });
});

test("missing immutable objects and unmatched tree paths return bounded unavailable errors", async () => {
  const value = fixture();
  const missingObject = registerGitPatchContext(value.cwd, value.before, "f".repeat(40), value.patch);
  await assert.rejects(readGitPatchContext(missingObject, "0"), { status: 409, message: /snapshot is unavailable/ });
  const missingPath = registerGitPatchContext(value.cwd, value.before, value.after, metadata("not-in-either-tree"));
  await assert.rejects(readGitPatchContext(missingPath, "0"), { status: 404, message: /snapshot is unavailable/ });
});
