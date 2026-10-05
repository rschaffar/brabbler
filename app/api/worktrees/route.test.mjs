import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agent = mkdtempSync(join(tmpdir(), "pi-web-worktrees-agent-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agent;
after(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  rmSync(agent, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST, DELETE } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const request = (method, body) => new Request("http://localhost/api/worktrees", {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-worktree-route-")), repo = join(root, "repo");
  mkdirSync(repo); t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8" }).trim();
  git("init", "-qb", "main");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--no-gpg-sign", "--allow-empty", "-qm", "base");
  allowFileRoot(repo);
  const base = git("rev-parse", "HEAD");
  return { repo, root, git, body: { cwd: repo, branch: "feature", baseBranch: "main", expectedBaseOid: base, mode: "create" } };
}

test("standalone worktrees list, create and remove with explicit local base/tip and no chat settings", async t => {
  const f = fixture(t);
  const obsolete = join(agent, "pi-web", "git-workflow-settings.json");
  mkdirSync(join(agent, "pi-web"), { recursive: true }); writeFileSync(obsolete, "obsolete invalid data");
  const created = await POST(request("POST", f.body));
  assert.equal(created.status, 200, await created.clone().text());
  const { path } = await created.json(); assert.ok(existsSync(path));
  const listing = await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(f.repo)}`));
  assert.equal(listing.status, 200);
  const data = await listing.json(); assert.equal(data.isGit, true);
  assert.ok(data.worktrees.some(w => w.path === path));
  writeFileSync(join(path, "dirty.txt"), "keep me");
  const dirty = await DELETE(request("DELETE", { cwd: f.repo, path }));
  assert.equal(dirty.status, 409); assert.equal((await dirty.json()).dirty, true);
  assert.ok(existsSync(path));
  const removed = await DELETE(request("DELETE", { cwd: f.repo, path, force: true }));
  assert.equal(removed.status, 200, await removed.clone().text()); assert.equal(existsSync(path), false);
  assert.equal(readFileSync(obsolete, "utf8"), "obsolete invalid data");
});

test("creation rejects missing/stale base and existing branch; explicit attach retains the local tip", async t => {
  const f = fixture(t);
  const missing = await POST(request("POST", { cwd: f.repo, branch: "feature", mode: "create" }));
  assert.equal(missing.status, 400);
  const stale = await POST(request("POST", { ...f.body, expectedBaseOid: "0".repeat(40) }));
  assert.equal(stale.status, 400); assert.equal(f.git("branch", "--list", "feature"), "");
  f.git("branch", "feature");
  const exists = await POST(request("POST", f.body)); assert.equal(exists.status, 400);
  const attached = await POST(request("POST", { ...f.body, mode: "attach", expectedTipOid: f.body.expectedBaseOid }));
  assert.equal(attached.status, 200, await attached.clone().text());
  assert.equal(execFileSync("git", ["-C", (await attached.json()).path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), f.body.expectedBaseOid);
});

test("file-root allowlist and checkout-root selection remain required", async t => {
  const f = fixture(t), outside = join(f.root, "outside"), nested = join(f.repo, "nested");
  mkdirSync(outside); mkdirSync(nested);
  assert.equal((await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(outside)}`))).status, 403);
  assert.equal((await POST(request("POST", { ...f.body, cwd: outside }))).status, 403);
  assert.equal((await POST(request("POST", { ...f.body, cwd: nested }))).status, 409);
  const primary = await DELETE(request("DELETE", { cwd: f.repo, path: f.repo, force: true }));
  assert.notEqual(primary.status, 200); assert.ok(existsSync(join(f.repo, ".git")));
});
