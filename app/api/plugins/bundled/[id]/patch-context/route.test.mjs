import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-plugin-patch-context-route-"));
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
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, fsCache: false });
const { NextRequest } = await jiti.import("next/server");
const route = await jiti.import("./route.ts");
const { bundledPlugin } = await jiti.import("../../../../../../lib/plugins/registry.ts");
const { DiffContextError } = await jiti.import("../../../../../../lib/diff-context.ts");
const { registerGitPatchContext, GIT_CONTEXT_TTL_MS } = await jiti.import("../../../../../../plugins/git-workflow/context.ts");
const plugin = bundledPlugin("git-workflow");
beforeEach(() => globalThis[Symbol.for("pi-web:git-plugin-context")].clear());
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
}).trim();
let sequence = 0;
function fixture() {
  const cwd = join(root, `repo-${++sequence}`); mkdirSync(cwd);
  git(cwd, "init", "-qb", "main"); git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.invalid"); git(cwd, "config", "core.autocrlf", "false");
  writeFileSync(join(cwd, "file.txt"), "before\nfull context\n"); git(cwd, "add", "--all"); git(cwd, "commit", "-qm", "before");
  const before = git(cwd, "rev-parse", "HEAD");
  writeFileSync(join(cwd, "file.txt"), "after\nfull context\n"); git(cwd, "add", "--all"); git(cwd, "commit", "-qm", "after");
  const after = git(cwd, "rev-parse", "HEAD");
  const patch = git(cwd, "diff", "--no-color", "--no-ext-diff", "--no-textconv", before, after) + "\n";
  return { cwd, before, after, patch };
}
const request = (query, id = "git-workflow") => route.GET(
  new NextRequest(`http://localhost/api/plugins/bundled/${id}/patch-context?${typeof query === "string" ? query : new URLSearchParams(query)}`),
  { params: Promise.resolve({ id }) },
);
const validHandle = "12345678-1234-1234-1234-123456789abc";
function treeDigest(directory) {
  const hash = createHash("sha256");
  const visit = (relative) => {
    const absolute = join(directory, relative), stat = lstatSync(absolute);
    hash.update(JSON.stringify([relative, stat.mode, stat.size]));
    if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) visit(join(relative, name));
    else { assert.ok(stat.isFile()); hash.update(readFileSync(absolute)); }
  };
  visit(""); return hash.digest("hex");
}

// This route is deliberately generic: only opaque handle + file ID are admitted.
test("strict handle/file/query validation rejects paths, revisions, duplicates and noncanonical IDs before dispatch", async (t) => {
  let calls = 0;
  t.mock.method(plugin, "readPatchContext", async () => { calls++; assert.fail("Invalid request was dispatched"); });
  for (const handle of ["", "HEAD", "../repo", "f".repeat(40), validHandle.toUpperCase(), validHandle + "\0"]) {
    assert.equal((await request({ handle, file: "0" })).status, 400);
  }
  for (const file of ["", "01", "-1", "1.0", "256", "1000", "file.txt", ".git/config", "\0"]) {
    assert.equal((await request({ handle: validHandle, file })).status, 400);
  }
  for (const query of [
    "", `handle=${validHandle}`, `handle=${validHandle}&file=0&file=1`,
    `handle=${validHandle}&handle=${validHandle}&file=0`,
    ...["cwd", "path", "before", "after", "oid"].map((key) => `handle=${validHandle}&file=0&${key}=arbitrary`),
  ]) assert.equal((await request(query)).status, 400);
  assert.equal(calls, 0);
});

test("valid opaque fields dispatch unchanged, with unknown/unavailable providers returning 404", async (t) => {
  const calls = [], context = { oldFile: null, newFile: { name: "file.txt", contents: "", cacheKey: "immutable" } };
  t.mock.method(plugin, "readPatchContext", async (...args) => { calls.push(args); return context; });
  for (const file of ["0", "255"]) {
    const response = await request({ handle: validHandle, file });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), context);
  }
  assert.deepEqual(calls, [[validHandle, "0"], [validHandle, "255"]]);
  assert.equal((await request({ handle: validHandle, file: "0" }, "unknown")).status, 404);
  // A bundled provider without this optional display capability is not executable.
  const read = plugin.readPatchContext; plugin.readPatchContext = undefined;
  try { assert.equal((await request({ handle: validHandle, file: "0" })).status, 404); }
  finally { plugin.readPatchContext = read; }
  assert.equal(calls.length, 2);
});

test("GET preserves bounded display errors without turning them into successful or executable responses", async (t) => {
  for (const status of [400, 404, 409, 413]) {
    t.mock.method(plugin, "readPatchContext", async () => { throw new DiffContextError(`display unavailable ${status}`, status); });
    const response = await request({ handle: validHandle, file: "0" });
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: `display unavailable ${status}` });
    t.mock.restoreAll();
  }
  t.mock.method(plugin, "readPatchContext", async () => { throw new Error("provider unavailable"); });
  assert.equal((await request({ handle: validHandle, file: "0" })).status, 409);
  assert.deepEqual(Object.keys(route).sort(), ["GET", "dynamic"], "There is no POST/write method on this resource");
});

test("real expired/missing handles and files return 409/404 while the saved patch is untouched", async () => {
  const value = fixture(), handle = registerGitPatchContext(value.cwd, value.before, value.after, value.patch);
  assert.equal((await request({ handle, file: "1" })).status, 404);
  assert.equal((await request({ handle: validHandle, file: "0" })).status, 409);
  const expired = registerGitPatchContext(value.cwd, value.before, value.after, value.patch, Date.now() - GIT_CONTEXT_TTL_MS);
  const response = await request({ handle: expired, file: "0" });
  assert.equal(response.status, 409); assert.match((await response.json()).error, /saved patch remains available/);
  const stillAvailable = await request({ handle, file: "0" });
  assert.equal(stillAvailable.status, 200); assert.equal((await stillAvailable.json()).newFile.contents, "after\nfull context\n");
});

test("real context GET executes only immutable Git reads, never previews/checks/index/object/ref/worktree writes", async (t) => {
  const value = fixture(), handle = registerGitPatchContext(value.cwd, value.before, value.after, value.patch);
  writeFileSync(join(value.cwd, "file.txt"), "dirty live checkout\n");
  writeFileSync(join(value.cwd, "untracked.txt"), "keep untracked\n");
  const before = treeDigest(value.cwd), originalPath = process.env.PATH;
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const shim = join(root, "read-only-git"); mkdirSync(shim);
  const log = join(shim, "commands.jsonl");
  writeFileSync(join(shim, "git"), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const rest = args.slice(args[2] === '--no-pager' ? 3 : 2);
const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const permitted = args[0] === '-C' && args[1] === ${JSON.stringify(value.cwd)} && (
  JSON.stringify(rest) === JSON.stringify(['rev-parse', '--path-format=absolute', '--git-common-dir']) ||
  (rest[0] === 'ls-tree' && rest[1] === '-z' && oid.test(rest[2]) && rest[3] === '--' && rest[4] === 'file.txt' && rest.length === 5) ||
  (rest[0] === 'cat-file' && ['-s', 'blob'].includes(rest[1]) && oid.test(rest[2]) && rest.length === 3)
);
if (!permitted) { process.stderr.write('Forbidden preview or write: ' + JSON.stringify(args)); process.exit(97); }
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });
  t.mock.method(plugin, "extension", () => assert.fail("GET must not create an extension/tool execution context"));
  process.env.PATH = `${shim}:${originalPath}`;
  try {
    for (let index = 0; index < 2; index++) {
      const response = await request({ handle, file: "0" }); assert.equal(response.status, 200);
      const context = await response.json();
      assert.equal(context.oldFile.contents, "before\nfull context\n");
      assert.equal(context.newFile.contents, "after\nfull context\n");
    }
    const commands = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(commands.length > 0, "The real context provider reached native Git reads");
    assert.deepEqual(new Set(commands.map((args) => args[2] === "--no-pager" ? args[3] : args[2])), new Set(["rev-parse", "ls-tree", "cat-file"]));
    assert.equal(treeDigest(value.cwd), before, "GET must not alter checkout, index, refs or create preview objects");
  } finally { process.env.PATH = originalPath; }
});
