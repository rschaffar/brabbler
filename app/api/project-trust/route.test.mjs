import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const root = mkdtempSync(join(tmpdir(), "brabbler-scoped-trust-route-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { getProjectTrustStatus } = await jiti.import("../../../lib/project-trust.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
let id = 0;
function fixture(t) {
  const dir = join(root, `case-${++id}`), repo = join(dir, "repo"), linked = join(dir, "linked");
  mkdirSync(repo, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(repo, "init", "-qb", "main");
  git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base");
  git(repo, "worktree", "add", "-qb", "linked", linked);
  mkdirSync(join(dir, ".agents", "skills"), { recursive: true });
  allowFileRoot(repo);
  allowFileRoot(linked);
  return { repo, linked };
}
const request = (cwd, scope, action = "trust", headers = {}) => new Request("http://localhost/api/project-trust", {
  method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers }, body: JSON.stringify({ cwd, scope, action }),
});
const get = async (cwd) => GET(new Request(`http://localhost/api/project-trust?cwd=${encodeURIComponent(cwd)}`));

test("worktree grant remains local; Git project grant includes existing and future worktrees", async (t) => {
  const f = fixture(t);
  assert.equal((await POST(request(f.repo, "worktree"))).status, 200);
  assert.equal((await (await get(f.linked)).json()).trusted, false);
  assert.equal((await POST(request(f.repo, "repository"))).status, 200);
  assert.equal((await (await get(f.linked)).json()).scope, "repository");
  const later = join(join(f.repo, ".."), "later");
  git(f.repo, "worktree", "add", "-qb", "later", later);
  allowFileRoot(later);
  assert.equal((await (await get(later)).json()).trusted, true);
  assert.equal((await POST(request(f.linked, "worktree", "revoke"))).status, 200);
  assert.equal((await (await get(f.linked)).json()).scope, "denied");
  assert.equal((await POST(request(f.linked, "worktree", "clear"))).status, 200);
  assert.equal((await (await get(f.linked)).json()).scope, "repository");
  assert.equal((await POST(request(f.repo, "repository", "revoke"))).status, 200);
  assert.equal((await (await get(f.linked)).json()).trusted, false);
  assert.equal((await (await get(f.repo)).json()).scope, "worktree");
});

test("a project grant does not reach subdirectories; directory changes block active descendants", async (t) => {
  const f = fixture(t);
  const nested = join(f.repo, "nested"), child = join(nested, "child");
  mkdirSync(child, { recursive: true });
  assert.equal((await POST(request(f.repo, "repository"))).status, 200);
  const nestedStatus = await (await get(nested)).json();
  assert.equal(nestedStatus.trusted, false);
  assert.equal(nestedStatus.checkoutRoot, null);
  assert.equal((await POST(request(nested, "repository"))).status, 409);
  const starting = globalThis.__piStartingSessionCwds ??= new Map();
  starting.set(child, 1);
  try { assert.equal((await POST(request(nested, "worktree"))).status, 409); }
  finally { starting.delete(child); }
  assert.equal((await POST(request(nested, "worktree"))).status, 200);
  assert.equal((await (await get(nested)).json()).scope, "worktree");
});

test("invalid requests and an active sibling checkout cannot grant project trust", async (t) => {
  const f = fixture(t);
  assert.equal((await POST(request(f.repo, "other"))).status, 400);
  assert.equal((await POST(request(f.repo, "repository", "clear"))).status, 400);
  assert.equal((await POST(request(f.repo, "repository", "trust", { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request(join(root, "missing"), "repository"))).status, 400);
  const starting = globalThis.__piStartingSessionCwds ??= new Map();
  starting.set(f.linked, 1);
  try {
    assert.equal((await POST(request(f.repo, "repository"))).status, 409);
    assert.equal(getProjectTrustStatus(f.repo, process.env.PI_CODING_AGENT_DIR).trusted, false);
  } finally { starting.delete(f.linked); }
  assert.equal((await POST(request(f.repo, "repository"))).status, 200);
});
