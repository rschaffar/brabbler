import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { NextRequest } = await jiti.import("next/server");
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const request = (params) => GET(new NextRequest(`http://localhost/api/git/explorer?${new URLSearchParams(params)}`));
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), "pi-web-explorer-route-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const cwd = join(parent, "repo");
  git(parent, "init", "-q", "-b", "main", cwd);
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "base.txt"), "base\n");
  git(cwd, "add", "base.txt");
  git(cwd, "commit", "-qm", "root");
  allowFileRoot(cwd);
  return { cwd, parent, head: git(cwd, "rev-parse", "HEAD") };
}

test("read-only Git Explorer routes bind a physical allowed checkout and captured HEAD", async (t) => {
  const { cwd, parent, head } = fixture(t);
  assert.equal((await request({ cwd: parent, op: "log" })).status, 403);
  assert.equal((await request({ cwd: join(cwd, ".git"), op: "log" })).status, 409);
  assert.equal((await request({ cwd, op: "log", skip: "-1" })).status, 400);
  assert.equal((await request({ cwd, op: "log", extra: "unknown" })).status, 400);
  const history = await request({ cwd, op: "log" });
  assert.equal(history.status, 200);
  assert.deepEqual((await history.json()).commits.map((commit) => commit.oid), [head]);
  const detail = await request({ cwd, op: "commit", oid: head, head });
  assert.equal(detail.status, 200);
  assert.deepEqual((await detail.json()).files, [{ path: "base.txt", status: "A" }]);
  const patch = await request({ cwd, op: "patch", oid: head, head, path: "base.txt" });
  assert.equal(patch.status, 200);
  assert.match((await patch.json()).patch, /\+base/);
  assert.equal((await request({ cwd, op: "patch", oid: head, head, path: ".git/config" })).status, 404);
  writeFileSync(join(cwd, "base.txt"), "new\n");
  git(cwd, "add", "base.txt");
  git(cwd, "commit", "-qm", "next");
  assert.equal((await request({ cwd, op: "commit", oid: head, head })).status, 409);
});
