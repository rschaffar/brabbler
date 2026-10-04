import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { bindingTestModule } from "./git-workflow-binding-test-loader.mjs";
import { seedRetiredGitBookkeeping } from "./retired-git-bookkeeping-fixture.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("retired cleanup bookkeeping cannot stop relocation reaching the actual session-family writer", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-move-independent-")), child = join(root, "child"); mkdirSync(child);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let settingsCalls = 0;
  const stop = new Error("fixture stops at actual family writer");
  const imports = { "@earendil-works/pi-coding-agent": { getAgentDir: () => join(root, "fixture-agent") },
    "./git-workflow-settings-store": { withGitWorkflowSettingsLock() { settingsCalls++; throw stop; } } };
  for (const name of ["rpc-manager", "session-reader", "session-path", "subagents", "subagent-runtime", "git-workflow-binding-store", "git-workflow-write-epoch"]) imports[`./${name}`] = {};
  const loaded = bindingTestModule("./session-move.ts", imports);
  const restore = seedRetiredGitBookkeeping([root, child]);
  try {
    await assert.rejects(loaded.moveSessionFamily("fixture", child), (error) => error === stop);
    assert.equal(settingsCalls, 1);
  } finally { restore(); }
});

test("actual move keeps running-family refusal, repairs references and advances every rewritten session epoch despite foreign activity", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-family-independent-"));
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
  const { readGitScopedAuthorityRevision } = await jiti.import("./git-scoped-authority.ts");
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
  const parentId = parent.getSessionId(), childId = child.getSessionId(), forkId = fork.getSessionId();
  const paths = [parent, child, fork].map((manager) => manager.getSessionFile());
  const original = paths.map((path) => readFileSync(path, "utf8"));
  globalThis.__piSessions = new Map([[childId, { isRunning: () => true }], [foreign.getSessionId(), { cwd: source, isRunning: () => true }]]);
  await assert.rejects(moveSessionFamily(parentId, destination), /Stop the session and its subagents/);
  assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), original);
  globalThis.__piSessions.delete(childId);
  const revision = (sessionId) => readGitScopedAuthorityRevision(agent, { sessionId, projectRoots: [] });
  const before = new Map([parentId, childId, forkId, foreign.getSessionId()].map((id) => [id, revision(id)]));
  const restore = seedRetiredGitBookkeeping([source, destination]);
  try {
    const response = await POST(new Request("http://localhost/api/sessions/fixture/move", {
      method: "POST", body: JSON.stringify({ cwd: destination }),
    }), { params: Promise.resolve({ id: parentId }) });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.deepEqual(new Set(result.movedIds), new Set([parentId, childId]));
    const parentPath = await resolveSessionPath(parentId), childPath = await resolveSessionPath(childId);
    assert.equal(readSessionHeader(parentPath).cwd, destination);
    assert.equal(readSessionHeader(childPath).cwd, destination);
    assert.equal(readSessionHeader(childPath).parentSession, parentPath);
    assert.equal(readSessionHeader(paths[2]).cwd, source, "fork is not automatically moved");
    assert.equal(readSessionHeader(paths[2]).parentSession, parentPath);
    assert.ok(readFileSync(childPath, "utf8").includes(JSON.stringify(parentPath)));
    assert.equal(existsSync(paths[0]), false); assert.equal(existsSync(paths[1]), false);
    for (const id of [parentId, childId, forkId]) assert.notEqual(revision(id), before.get(id));
    assert.equal(revision(foreign.getSessionId()), before.get(foreign.getSessionId()));
    assert.equal(readSessionHeader(foreign.getSessionFile()).cwd, source);
  } finally { restore(); }
});
