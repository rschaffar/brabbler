import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-workflow-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, PUT } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const git = promisify(execFile);
const first = { mode: "worktree", baseBranch: "main", onCreate: "continue", commits: "agent" };
const second = { mode: "current", branch: "feature/a", onCreate: "stay", commits: "manual" };

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

function put(body) {
  return PUT(new Request("http://localhost/api/git/workflow", { method: "PUT", body: JSON.stringify(body) }));
}
function get(cwd, sessionId) {
  const params = new URLSearchParams();
  if (cwd !== undefined) params.set("cwd", cwd);
  if (sessionId !== undefined) params.set("sessionId", sessionId);
  return GET(new Request(`http://localhost/api/git/workflow?${params}`));
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-workflow-route-"));
  const cwd = join(dir, "repo");
  await git("git", ["init", cwd]);
  allowFileRoot(cwd);
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const id = sm.getSessionId();
  const file = sm.getSessionFile();
  cacheSessionPath(id, file);
  t.after(async () => { invalidateSessionPathCache(id); invalidateSessionListCache(); await rm(dir, { recursive: true, force: true }); });
  return { dir, cwd, id, file, sm };
}

test("project default and saved snapshot are independent; null is an explicit opt-out", async (t) => {
  const { cwd, id, file } = await fixture(t);
  assert.equal((await get(cwd)).status, 200);
  assert.equal((await (await get(cwd, id)).json()).sessionSnapshotPresent, false);
  assert.equal((await put({ scope: "project", cwd, policy: first })).status, 200);
  let response = await get(undefined, id);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cwd, project: first, session: null, sessionSnapshotPresent: false });
  assert.equal((await put({ scope: "session", sessionId: id, policy: second })).status, 200);
  assert.equal((await put({ scope: "project", cwd, policy: null })).status, 200);
  response = await get(cwd, id);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cwd, project: null, session: second, sessionSnapshotPresent: true });
  assert.equal((await put({ scope: "session", sessionId: id, policy: null })).status, 200);
  assert.deepEqual(await (await get(cwd, id)).json(), { cwd, project: null, session: null, sessionSnapshotPresent: true });
  assert.match(await readFile(file, "utf8"), /pi-web:git-workflow/);
});

test("rejects invalid policies, scope targets, mismatched cwds and unauthorized paths", async (t) => {
  const { cwd, dir, id, file } = await fixture(t);
  const other = join(dir, "other");
  await git("git", ["init", other]);
  allowFileRoot(other);
  assert.equal((await get(other, id)).status, 409);
  assert.equal((await put({ scope: "session", sessionId: id, cwd: other, policy: first })).status, 400);
  assert.equal((await put({ scope: "project", cwd, sessionId: id, policy: first })).status, 400);
  assert.equal((await put({ scope: "session", sessionId: id, policy: { ...first, autoApprove: true } })).status, 400);
  assert.equal((await put({ scope: "session", sessionId: id })).status, 400);
  assert.equal((await get("relative", id)).status, 400);
  assert.equal((await get(join(dir, "private"))).status, 403);
  assert.equal((await put({ scope: "project", cwd: join(dir, "private"), policy: first })).status, 403);
  const outside = await mkdtemp(join(tmpdir(), "pi-web-workflow-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const alias = join(cwd, "escape");
  await symlink(outside, alias, "dir");
  assert.equal((await put({ scope: "project", cwd: alias, policy: first })).status, 403);
  assert.equal((await get(cwd, "not-a-session")).status, 404);
  const original = await readFile(file, "utf8");
  assert.equal((await put({ scope: "session", sessionId: id, policy: { mode: "current", commits: "agent", onCreate: "fork", token: "secret" } })).status, 400);
  assert.equal(await readFile(file, "utf8"), original);
});

test("rejects running sessions, subagents, header ID mismatch, and stale live editors", async (t) => {
  const { cwd, id, file, sm } = await fixture(t);
  const previous = globalThis.__piSessions;
  const live = { sessionFile: file, isAlive: () => true, isRunning: () => true, inner: { sessionManager: sm } };
  globalThis.__piSessions = new Map([[id, live]]);
  t.after(() => { globalThis.__piSessions = previous; });
  assert.equal((await put({ scope: "session", sessionId: id, policy: first })).status, 409);
  live.isRunning = () => false;
  const external = SessionManager.open(file, undefined);
  external.appendMessage({ role: "user", content: "other editor", timestamp: Date.now() });
  assert.equal((await put({ scope: "session", sessionId: id, policy: first })).status, 409);
  globalThis.__piSessions = new Map();
  external.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: "parent" });
  assert.equal((await put({ scope: "session", sessionId: id, policy: first })).status, 409);
  const contents = await readFile(file, "utf8");
  await writeFile(file, contents.replace(`"id":"${id}"`, '"id":"wrong-id"'));
  assert.equal((await get(cwd, id)).status, 409);
});
