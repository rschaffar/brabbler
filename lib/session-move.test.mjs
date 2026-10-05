import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("session-family move refuses running children, repairs parent references and preserves independent forks", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-family-move-"));
  const source = join(root, "source"), destination = join(root, "destination"), agent = join(root, "agent");
  for (const path of [source, destination, agent]) mkdirSync(path);
  const priorDir = process.env.PI_CODING_AGENT_DIR, priorSessions = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = agent;
  t.after(() => {
    globalThis.__piSessions = priorSessions;
    if (priorDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorDir;
    rmSync(root, { recursive: true, force: true });
  });
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { moveSessionFamily } = await jiti.import("./session-move.ts");
  const { POST } = await jiti.import("../app/api/sessions/[id]/move/route.ts");
  const { cacheSessionPath, resolveSessionPath, readSessionHeader } = await jiti.import("./session-reader.ts");
  const create = (parent, subagent = false) => {
    const manager = SessionManager.create(source, undefined, parent ? { parentSession: parent.getSessionFile() } : undefined);
    if (subagent) manager.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: parent.getSessionId(), parentSessionPath: parent.getSessionFile(),
      parentToolCallId: "fixture", profile: "explore", description: "fixture", task: "fixture", runInBackground: false, createdAt: new Date().toISOString() });
    manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], timestamp: Date.now() });
    cacheSessionPath(manager.getSessionId(), manager.getSessionFile());
    return manager;
  };
  const parent = create(), child = create(parent, true), fork = create(parent), foreign = create();
  // Opaque obsolete metadata is preserved, not interpreted as a session gate.
  parent.appendCustomEntry("pi-web:git-workflow", { version: "obsolete-malformed", enabled: false });
  const parentId = parent.getSessionId(), childId = child.getSessionId();
  const paths = [parent, child, fork].map((manager) => manager.getSessionFile());
  const original = paths.map((path) => readFileSync(path, "utf8"));
  globalThis.__piSessions = new Map([[childId, { isRunning: () => true }], [foreign.getSessionId(), { cwd: source, isRunning: () => true }]]);
  await assert.rejects(moveSessionFamily(parentId, destination), /Stop the session and its subagents/);
  assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), original);
  globalThis.__piSessions.delete(childId);
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
  await moveSessionFamily(parentId, source);
  assert.equal(await resolveSessionPath(parentId), paths[0]);
  assert.equal(readSessionHeader(await resolveSessionPath(childId)).parentSession, paths[0]);
});
