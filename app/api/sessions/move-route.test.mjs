import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { POST: move } = await jiti.import("./[id]/move/route.ts");
const exec = promisify(execFile);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { listAllSessions, resolveSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../lib/session-reader.ts");

const { resolveProject, invalidateProjectCache } = await jiti.import("../../../lib/worktree.ts");

const header = (id, cwd, parentSession) => JSON.stringify({
  type: "session", version: 3, id, cwd, timestamp: "2026-01-01T00:00:00.000Z",
  ...(parentSession ? { parentSession } : {}),
});
const request = (id, cwd) => move(new Request(`http://localhost/api/sessions/${id}/move`, {
  method: "POST", body: JSON.stringify({ cwd }),
}), { params: Promise.resolve({ id }) });

test("move persists a nested family, repairs an external fork and refreshes path resolution", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "brabbler-move-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  const oldCwd = join(dir, "old");
  const newCwd = join(dir, "new");
  const forkCwd = join(dir, "fork");
  await Promise.all([oldCwd, newCwd, forkCwd].map((cwd) => mkdir(cwd)));
  const root = SessionManager.create(oldCwd);
  root.appendMessage({ role: "user", content: "Keep this transcript", timestamp: Date.now() });
  root.appendMessage({ role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: Date.now() });
  const id = root.getSessionId();
  const rootPath = root.getSessionFile();
  const childPath = join(dirname(rootPath), `child_${id}-child.jsonl`);
  const grandPath = join(dirname(rootPath), `grand_${id}-grand.jsonl`);
  const subagent = (childId, parentId, parentPath) => [
    header(childId, oldCwd, parentPath),
    JSON.stringify({ type: "custom", customType: "brabbler:subagent", id: `meta-${childId}`, parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z", data: { version: 1, parentSessionId: parentId,
        parentSessionPath: parentPath, profile: "explore", description: "Read files" } }),
    "",
  ].join("\n");
  await writeFile(childPath, subagent(`${id}-child`, id, rootPath));
  await writeFile(grandPath, subagent(`${id}-grand`, `${id}-child`, childPath));
  const fork = SessionManager.create(forkCwd);
  fork.appendMessage({ role: "user", content: "Independent fork", timestamp: Date.now() });
  fork.appendMessage({ role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: Date.now() });
  const forkPath = fork.getSessionFile();
  const forkContent = (await readFile(forkPath, "utf8")).split("\n");
  forkContent[0] = header(fork.getSessionId(), forkCwd, rootPath);
  await writeFile(forkPath, forkContent.join("\n"));
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    for (const sid of [id, `${id}-child`, `${id}-grand`, fork.getSessionId()]) invalidateSessionPathCache(sid);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  invalidateSessionListCache();
  const before = await listAllSessions({ force: true });
  assert.equal(before.find((session) => session.id === `${id}-grand`)?.relation?.parentSessionId, `${id}-child`);
  assert.equal((await request(id, oldCwd)).status, 409);
  const collisionPath = join(dirname(SessionManager.create(newCwd).getSessionFile()), basename(rootPath));
  await writeFile(collisionPath, "other session\n");
  assert.equal((await request(id, newCwd)).status, 409);
  assert.match(await readFile(rootPath, "utf8"), /Keep this transcript/);
  await unlink(collisionPath);
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[id, { isRunning: () => true }]]);
  try {
    assert.equal((await request(id, newCwd)).status, 409);
    assert.match(await readFile(rootPath, "utf8"), /Keep this transcript/);
  } finally {
    globalThis.__piSessions = previousRegistry;
  }
  const previousSubagents = globalThis.__piSubagentRuns;
  globalThis.__piSubagentRuns = new Map([[`${id}-child`, { run: { status: "queued" } }]]);
  try {
    assert.equal((await request(id, newCwd)).status, 409);
    assert.match(await readFile(rootPath, "utf8"), /Keep this transcript/);
  } finally {
    globalThis.__piSubagentRuns = previousSubagents;
  }
  const response = await request(id, newCwd);
  assert.equal(response.status, 200, await response.text());
  const newPath = await resolveSessionPath(id);
  assert.notEqual(newPath, rootPath);
  assert.equal(basename(newPath), basename(rootPath));
  assert.match(await readFile(newPath, "utf8"), /Keep this transcript/);
  await assert.rejects(readFile(rootPath), { code: "ENOENT" });
  const movedChild = await resolveSessionPath(`${id}-child`);
  const movedGrand = await resolveSessionPath(`${id}-grand`);
  assert.equal(JSON.parse((await readFile(movedChild, "utf8")).split("\n")[0]).parentSession, newPath);
  assert.equal(JSON.parse((await readFile(movedGrand, "utf8")).split("\n")[1]).data.parentSessionPath, movedChild);
  assert.equal(JSON.parse((await readFile(forkPath, "utf8")).split("\n")[0]).parentSession, newPath);
  assert.equal(JSON.parse((await readFile(forkPath, "utf8")).split("\n")[0]).cwd, forkCwd);
  const after = await listAllSessions({ force: true });
  assert.equal(after.find((session) => session.id === id)?.cwd, newCwd);
  assert.equal(after.find((session) => session.id === `${id}-child`)?.relation?.parentSessionId, id);
  assert.equal(after.find((session) => session.id === fork.getSessionId())?.relation?.originSessionId, id);
});

test("deleted source checkouts do not strand persisted sessions", async (t) => {
  for (const scenario of [
    { name: "removed worktree to main", target: "main", remove: true },
    { name: "prunable worktree to sibling with cached identity", target: "sibling", cached: true },
    { name: "removed worktree to plain directory", target: "plain", remove: true },
    { name: "custom deleted worktree to main without inferred identity", target: "main", custom: true, remove: true },
  ]) await t.test(scenario.name, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "brabbler-deleted-move-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    const root = join(dir, "repo"), plain = join(dir, "plain");
    const source = scenario.custom ? join(dir, "custom") : join(dir, "repo-worktrees", "deleted");
    const sibling = join(dir, "repo-worktrees", "sibling");
    await Promise.all([root, plain].map((cwd) => mkdir(cwd)));
    const git = (...args) => exec("git", ["-C", root, ...args]);
    await git("init", "-q");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "initial");
    await git("worktree", "add", "-q", "-b", "deleted", source);
    await git("worktree", "add", "-q", "-b", "sibling", sibling);
    const nested = join(root, "nested");
    await mkdir(nested);
    const manager = SessionManager.create(source);
    manager.appendMessage({ role: "user", content: "Recover this history", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Preserved" }], timestamp: Date.now() });
    const id = manager.getSessionId(), oldPath = manager.getSessionFile();
    const original = await readFile(oldPath, "utf8");
    t.after(async () => {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      invalidateSessionPathCache(id);
      invalidateSessionListCache();
      invalidateProjectCache();
      await rm(dir, { recursive: true, force: true });
    });
    if (scenario.cached) await resolveProject(source);
    if (scenario.remove) await git("worktree", "remove", source);
    else await rm(source, { recursive: true });
    if (!scenario.cached) invalidateProjectCache();
    invalidateSessionListCache();
    assert.equal((await request(id, source)).status, 400, "A missing destination still refuses");
    if (!scenario.custom) assert.equal((await request(id, nested)).status, 409, "Known same-repo subdirectories still refuse");
    assert.equal(await readFile(oldPath, "utf8"), original);
    const destination = scenario.target === "plain" ? plain : scenario.target === "sibling" ? sibling : root;
    const registry = globalThis.__piSessions;
    globalThis.__piSessions = new Map([[id, { isRunning: () => true }]]);
    try {
      assert.equal((await request(id, destination)).status, 409, "Missing cwd does not bypass running protection");
      assert.equal(await readFile(oldPath, "utf8"), original);
    } finally { globalThis.__piSessions = registry; }
    const response = await request(id, destination);
    assert.equal(response.status, 200, await response.clone().text());
    const newPath = await resolveSessionPath(id);
    const content = await readFile(newPath, "utf8");
    assert.equal(JSON.parse(content.split("\n")[0]).cwd, destination);
    assert.deepEqual(content.split("\n").slice(1), original.split("\n").slice(1));
    await assert.rejects(readFile(oldPath), { code: "ENOENT" });
    await assert.rejects(readFile(join(source, ".git")), { code: "ENOENT" });
    assert.equal((await listAllSessions({ force: true })).find((item) => item.id === id)?.cwd, destination);
  });
});

test("same-project continuation accepts only distinct registered worktree roots", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "brabbler-worktree-move-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  const root = join(dir, "repo");
  const linked = join(dir, "linked");
  await mkdir(root);
  const git = (...args) => exec("git", ["-C", root, ...args]);
  await git("init", "-q");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "initial");
  await git("worktree", "add", "-q", "-b", "feature", linked);
  const subdir = join(root, "nested");
  await mkdir(subdir);
  const manager = SessionManager.create(root);
  manager.appendMessage({ role: "user", content: "Continue here", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ready" }], timestamp: Date.now() });
  const id = manager.getSessionId();
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  invalidateSessionListCache();
  await listAllSessions({ force: true });
  assert.equal((await request(id, root)).status, 409);
  assert.equal((await request(id, subdir)).status, 409);
  const response = await request(id, linked);
  assert.equal(response.status, 200, await response.text());
  assert.equal(JSON.parse((await readFile(await resolveSessionPath(id), "utf8")).split("\n")[0]).cwd, linked);
  assert.equal((await request(id, root)).status, 200);
});
