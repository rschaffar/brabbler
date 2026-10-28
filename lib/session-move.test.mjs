import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });

test("session-family move refuses running children, repairs parent references and preserves independent forks", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "brabbler-family-move-"));
  const source = join(root, "source"), destination = join(root, "destination"), agent = join(root, "agent");
  for (const path of [source, destination, agent]) mkdirSync(path);
  const priorDir = process.env.PI_CODING_AGENT_DIR, priorSessions = globalThis.__piSessions;
  const priorStarts = globalThis.__piStartLocks, priorRelocations = globalThis.__piSessionRelocations;
  const priorRecent = globalThis.__piRecentSessionRelocations;
  globalThis.__piStartLocks = new Map(); globalThis.__piSessionRelocations = new Map(); globalThis.__piRecentSessionRelocations = new Map();
  process.env.PI_CODING_AGENT_DIR = agent;
  t.after(() => {
    globalThis.__piSessions = priorSessions;
    globalThis.__piStartLocks = priorStarts; globalThis.__piSessionRelocations = priorRelocations;
    globalThis.__piRecentSessionRelocations = priorRecent;
    if (priorDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorDir;
    rmSync(root, { recursive: true, force: true });
  });
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { moveSessionFamily } = await jiti.import("./session-move.ts");
  const { pendingSessionRelocation } = await jiti.import("./session-relocation.ts");
  const { POST } = await jiti.import("../app/api/sessions/[id]/move/route.ts");
  const { cacheSessionPath, resolveSessionPath, readSessionHeader } = await jiti.import("./session-reader.ts");
  const create = (parent, subagent = false) => {
    const manager = SessionManager.create(source, undefined, parent ? { parentSession: parent.getSessionFile() } : undefined);
    if (subagent) manager.appendCustomEntry("brabbler:subagent", { version: 1, parentSessionId: parent.getSessionId(), parentSessionPath: parent.getSessionFile(),
      parentToolCallId: "fixture", profile: "explore", description: "fixture", task: "fixture", runInBackground: false, createdAt: new Date().toISOString() });
    manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], timestamp: Date.now() });
    cacheSessionPath(manager.getSessionId(), manager.getSessionFile());
    return manager;
  };
  const parent = create(), child = create(parent, true), fork = create(parent), foreign = create();
  // Opaque obsolete metadata is preserved, not interpreted as a session gate.
  parent.appendCustomEntry("brabbler:git-workflow", { version: "obsolete-malformed", enabled: false });
  const parentId = parent.getSessionId(), childId = child.getSessionId();
  const paths = [parent, child, fork].map((manager) => manager.getSessionFile());
  const original = paths.map((path) => readFileSync(path, "utf8"));
  globalThis.__piSessions = new Map([[childId, { isRunning: () => true }], [foreign.getSessionId(), { cwd: source, isRunning: () => true }]]);
  await assert.rejects(moveSessionFamily(parentId, destination), /Stop the session and its subagents/);
  assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), original);
  globalThis.__piSessions.delete(childId);
  let finishStarting;
  const starting = new Promise(resolve => { finishStarting = resolve; });
  t.after(() => finishStarting());
  globalThis.__piStartLocks.set(childId, starting);
  await assert.rejects(moveSessionFamily(parentId, destination), /finish starting before moving/);
  assert.deepEqual(paths.map(path => readFileSync(path, "utf8")), original);
  assert.equal(globalThis.__piSessionRelocations.size, 0, "refused pre-admitted startup releases the root reservation");
  finishStarting(); globalThis.__piStartLocks.delete(childId);
  const response = await POST(new Request("http://localhost/api/sessions/fixture/move", {
    method: "POST", body: JSON.stringify({ cwd: destination }),
  }), { params: Promise.resolve({ id: parentId }) });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(new Set((await response.json()).movedIds), new Set([parentId, childId]));
  const parentPath = await resolveSessionPath(parentId), childPath = await resolveSessionPath(childId);
  assert.equal(readSessionHeader(parentPath).cwd, destination);
  assert.equal(readSessionHeader(childPath).cwd, destination);
  assert.equal(readSessionHeader(childPath).parentSession, parentPath);
  assert.equal(readSessionHeader(paths[2]).cwd, source);
  assert.equal(readSessionHeader(paths[2]).parentSession, parentPath);
  assert.ok(readFileSync(childPath, "utf8").includes(JSON.stringify(parentPath)));
  assert.ok(readFileSync(parentPath, "utf8").includes("obsolete-malformed"));
  assert.equal(existsSync(paths[0]), false); assert.equal(existsSync(paths[1]), false);
  assert.equal(readSessionHeader(foreign.getSessionFile()).cwd, source);
  await assert.rejects(moveSessionFamily(parentId, destination), /already in that directory/);
  let validations = 0;
  const movingBack = moveSessionFamily(parentId, source, { validate: async () => {
    validations++;
    assert.equal(pendingSessionRelocation(parentId, parentPath).id, parentId);
    assert.equal(pendingSessionRelocation(childId, childPath).id, childId);
    if (validations === 2) assert.equal(pendingSessionRelocation(fork.getSessionId(), paths[2]).id, fork.getSessionId(), "linked rewrite joins the same startup fence");
  } });
  const admitted = (async () => {
    await Promise.resolve(); // withSessionMoveLock admitted this turn; discovery itself is not settled.
    assert.equal(pendingSessionRelocation(parentId, parentPath).id, parentId, "root is held before native discovery/validation yields");
  })();
  const outcomes = await Promise.allSettled([admitted, movingBack]);
  const errors = outcomes.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "Move admission observation and original move settled with errors");
  assert.equal(validations, 2);
  assert.equal(globalThis.__piSessionRelocations.size, 0);
  assert.equal(await resolveSessionPath(parentId), paths[0]);
  assert.equal(readSessionHeader(await resolveSessionPath(childId)).parentSession, paths[0]);
  const refused = new Error("controlled final validation refusal");
  const beforeRefusal = paths.map(path => readFileSync(path, "utf8"));
  let refusalValidations = 0;
  await assert.rejects(moveSessionFamily(parentId, destination, { validate: async () => {
    assert.equal(pendingSessionRelocation(parentId, paths[0]).id, parentId);
    if (++refusalValidations === 2) throw refused;
  } }), error => error === refused);
  assert.equal(refusalValidations, 2);
  assert.equal(globalThis.__piSessionRelocations.size, 0);
  assert.deepEqual(paths.map(path => readFileSync(path, "utf8")), beforeRefusal);
});
