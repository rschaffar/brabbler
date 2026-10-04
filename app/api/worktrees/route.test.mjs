import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "workflow-worktrees-agent-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { GET, POST, DELETE } = await jiti.import("./route.ts");
const { seedRetiredGitBookkeeping } = await import("../../../lib/retired-git-bookkeeping-fixture.mjs");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("../../../lib/git-workflow-settings-store.ts");
const { selectGitProjectResources } = await jiti.import("../../../lib/git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("../../../lib/git-project-authorization.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();
const request = (method, body) => new Request("http://localhost/api/worktrees", { method, body: JSON.stringify(body) });

test("nested cwd cannot bypass disabled repository worktree mutations; read-only listing remains usable", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-worktrees-route-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo"), nested = join(repo, "subdir"), linked = join(dir, "linked");
  await mkdir(nested, { recursive: true });
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.name", "Fixture");
  await git(repo, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(nested, "file"), "base\n");
  await git(repo, "add", "."); await git(repo, "commit", "-qm", "base");
  await git(repo, "worktree", "add", "-qb", "existing", linked);
  allowFileRoot(dir);
  await mkdir(join(agentDir, "pi-web"), { recursive: true });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: { [repo]: { enabled: false } } });
  const params = { branch: "new-feature", baseBranch: "main", expectedBaseOid: await git(repo, "rev-parse", "HEAD"), mode: "create" };
  const subCreate = await POST(request("POST", { cwd: nested, ...params }));
  assert.equal(subCreate.status, 409);
  assert.match((await subCreate.json()).error, /checkout root/);
  const subDelete = await DELETE(request("DELETE", { cwd: nested, path: linked }));
  assert.equal(subDelete.status, 409);
  assert.equal(existsSync(linked), true);
  const rootCreate = await POST(request("POST", { cwd: repo, ...params }));
  assert.match((await rootCreate.json()).error, /disabled/);
  assert.equal((await git(repo, "worktree", "list", "--porcelain")).match(/^worktree /gm).length, 2);
  assert.equal((await GET(new Request(`http://localhost/api/worktrees?cwd=${encodeURIComponent(repo)}`))).status, 200);
});

test("manual creation and deletion ignore foreign chat/retired bookkeeping but retain expected-base and dirty safety", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-worktrees-independent-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo"); await mkdir(repo);
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "base");
  allowFileRoot(repo);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} });
  const prior = globalThis.__piSessions;
  globalThis.__piSessions = new Map([["foreign", { sessionId: "foreign", cwd: repo, isRunning: () => true }]]);
  const restore = seedRetiredGitBookkeeping([repo]);
  try {
    const body = { cwd: repo, branch: "new-feature", baseBranch: "main", expectedBaseOid: await git(repo, "rev-parse", "HEAD"), mode: "create" };
    const stale = await POST(request("POST", { ...body, expectedBaseOid: "f".repeat(40) }));
    assert.notEqual(stale.status, 200);
    const created = await POST(request("POST", body));
    assert.equal(created.status, 200, await created.clone().text());
    const { path } = await created.json();
    const restoreTarget = seedRetiredGitBookkeeping([repo, path]);
    try {
      await writeFile(join(path, "untracked"), "must retain without deletion consent\n");
      const dirty = await DELETE(request("DELETE", { cwd: repo, path }));
      assert.equal(dirty.status, 409);
      assert.equal((await dirty.json()).dirty, true);
      assert.equal(existsSync(path), true);
      await rm(join(path, "untracked"));
      assert.equal((await DELETE(request("DELETE", { cwd: repo, path }))).status, 200);
      assert.equal(existsSync(path), false);
      assert.equal(globalThis.__piSessions.get("foreign").cwd, repo, "no automatic session movement");
    } finally { restoreTarget(); }
  } finally { restore(); globalThis.__piSessions = prior; }
});

test("Project Deny blocks browser worktree creation without becoming an implicit grant", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "workflow-worktrees-deny-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  await mkdir(repo);
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.name", "Fixture");
  await git(repo, "config", "user.email", "fixture@example.invalid");
  await git(repo, "commit", "--allow-empty", "-qm", "base");
  allowFileRoot(repo);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} });
  const selected = await selectGitProjectResources(repo);
  const first = await readProjectAuthorization(selected, undefined, agentDir);
  await saveProjectAuthorization(selected, undefined, "project", "workspace", "deny", first, agentDir);
  const response = await POST(request("POST", { cwd: repo, branch: "forbidden", baseBranch: "main",
    expectedBaseOid: await git(repo, "rev-parse", "HEAD"), mode: "create" }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /authorization denies worktree creation/);
  assert.equal((await git(repo, "worktree", "list", "--porcelain")).match(/^worktree /gm).length, 1);
});
