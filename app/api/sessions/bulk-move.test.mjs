import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, fsCache: false });

test("genuine inventory and bulk recovery use the existing mover and preserve archived/mixed-family history", async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-bulk-move-"));
  const agent = join(root, "agent"), main = join(root, "repo"), missing = `${main}-worktrees/missing`, live = `${main}-worktrees/live`;
  const oldAgent = process.env.PI_CODING_AGENT_DIR, oldSessions = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = agent; globalThis.__piSessions = new Map();
  t.after(() => { globalThis.__piSessions = oldSessions; if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent; rmSync(root, { recursive: true, force: true }); });
  mkdirSync(agent); mkdirSync(main);
  const git = (...args) => execFileSync("git", ["-C", main, ...args], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-qb", "main"); git("-c", "user.name=Synthetic", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
  git("worktree", "add", "-qb", "missing", missing); git("worktree", "add", "-qb", "live", live);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { POST } = await jiti.import("./move/route.ts");
  const { GET } = await jiti.import("./worktrees/route.ts");
  const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts"); allowFileRoot(main);
  const { listAllSessions, resolveSessionPath, invalidateSessionListCache } = await jiti.import("../../../lib/session-reader.ts");
  const create = (cwd, parent, archived = false) => {
    const manager = SessionManager.create(cwd, undefined, parent ? { parentSession: parent.getSessionFile() } : undefined);
    // Match ordinary subagent layout: relation metadata immediately follows header.
    if (parent) manager.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: parent.getSessionId(), parentSessionPath: parent.getSessionFile(), profile: "explore", description: "fixture" });
    manager.appendMessage({ role: "user", content: "HISTORY_CANARY /old/path stays literal", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Synthetic persisted reply" }], timestamp: Date.now() });
    if (archived) manager.appendCustomEntry("pi-web:archive", { version: 1, archived: true });
    return manager;
  };
  const parent = create(missing), child = create(live, parent), archived = create(missing, undefined, true),
    liveParent = create(main), missingChild = create(missing, liveParent);
  assert.equal(JSON.parse(readFileSync(child.getSessionFile(), "utf8").split("\n")[0]).parentSession, parent.getSessionFile(), "synthetic child header carries its parent path");
  const { readSubagentRun } = await jiti.import("../../../lib/subagents.ts");
  const childEntries = readFileSync(child.getSessionFile(), "utf8").trim().split("\n").slice(1).map(line => JSON.parse(line));
  assert.equal(readSubagentRun(childEntries, child.getSessionId(), child.getSessionFile())?.parentSessionId, parent.getSessionId(), "synthetic metadata is a valid subagent");
  git("worktree", "remove", missing); git("worktree", "prune");
  const post = async (body, status = 200) => {
    const response = await POST(new Request("http://localhost/api/sessions/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data));
    assert.equal(response.headers.get("cache-control"), "private, no-store"); return data;
  };
  const preview = async () => (await post({ mode: "preview", project: main, missingOnly: true })).plan;
  invalidateSessionListCache();
  const inventoryResponse = await GET(new Request(`http://localhost/api/sessions/worktrees?project=${encodeURIComponent(main)}`));
  assert.equal(inventoryResponse.status, 200);
  const inventory = await inventoryResponse.json(); assert.equal(inventory.mainCwd, main);
  assert.equal(inventory.worktrees.find(row => row.path === missing).state, "missing");
  assert.equal(inventory.worktrees.find(row => row.path === missing).sessionCount, 3);
  assert.equal(inventory.worktrees.find(row => row.path === missing).archivedCount, 1);
  const catalogue = await listAllSessions({ force: true });
  assert.equal(catalogue.find(row => row.id === child.getSessionId())?.relation?.parentSessionId, parent.getSessionId(),
    JSON.stringify({ expectedChild: child.getSessionId(), catalogue: catalogue.map(({ id, cwd, relation, parentSessionId }) => ({ id, cwd, relation, parentSessionId })) }));
  const plan = await preview();
  assert.equal(plan.sessionCount, 4); assert.equal(plan.archivedCount, 1);
  assert.deepEqual(new Set(plan.roots.map(row => row.id)), new Set([parent.getSessionId(), archived.getSessionId(), missingChild.getSessionId()]));
  assert.ok(!plan.roots.some(row => row.id === child.getSessionId()), "ancestor selection deduplicates its child");
  const originals = new Map([parent, child, archived, missingChild].map(manager => [manager.getSessionId(), readFileSync(manager.getSessionFile(), "utf8")]));
  const liveParentBytes = readFileSync(liveParent.getSessionFile(), "utf8");

  // Missing eligibility is revalidated at execution; a path that returns is not stale.
  mkdirSync(missing);
  const reappeared = await post({ mode: "execute", plan });
  assert.equal(reappeared.movedIds.length, 0); assert.equal(reappeared.failed.length, 3);
  rmSync(missing, { recursive: true });

  // Changed descendant cwd cannot be silently promoted from a reviewed family ID.
  const childPath = child.getSessionFile(), priorChild = readFileSync(childPath, "utf8");
  const lines = priorChild.split("\n"), header = JSON.parse(lines[0]); header.cwd = main; lines[0] = JSON.stringify(header);
  writeFileSync(childPath, lines.join("\n")); invalidateSessionListCache();
  const rootOnly = { ...plan, roots: plan.roots.filter(row => row.id === parent.getSessionId()), sessionCount: 2, archivedCount: 0 };
  const changed = await post({ mode: "execute", plan: rootOnly });
  assert.equal(changed.movedIds.length, 0); assert.match(changed.failed[0].error, /changed/);
  writeFileSync(childPath, priorChild); invalidateSessionListCache();

  // Running families fail individually; other selected roots still complete.
  globalThis.__piSessions.set(parent.getSessionId(), { cwd: missing, isRunning: () => true });
  const first = await post({ mode: "execute", plan: await preview() });
  assert.equal(first.failed.length, 1); assert.equal(first.failed[0].id, parent.getSessionId());
  assert.deepEqual(new Set(first.movedIds), new Set([archived.getSessionId(), missingChild.getSessionId()]));
  globalThis.__piSessions.delete(parent.getSessionId());
  const second = await post({ mode: "execute", plan: await preview() });
  assert.equal(second.failed.length, 0); assert.deepEqual(new Set(second.movedIds), new Set([parent.getSessionId(), child.getSessionId()]));
  assert.equal(readFileSync(liveParent.getSessionFile(), "utf8"), liveParentBytes, "missing-child-only move leaves its live parent unchanged");
  const sessions = await listAllSessions({ force: true });
  for (const id of originals.keys()) {
    const session = sessions.find(row => row.id === id); assert.equal(session.cwd, main);
    const bytes = readFileSync(await resolveSessionPath(id), "utf8");
    assert.match(bytes, /HISTORY_CANARY \/old\/path stays literal/);
    if (id === archived.getSessionId()) assert.equal(session.archived, true);
  }
  assert.equal(existsSync(missing), false, "moving history must not recreate the checkout");
  const noOp = await post({ mode: "preview", project: main, cwd: main, ids: [archived.getSessionId()] });
  assert.equal(noOp.plan.roots.length, 0); assert.deepEqual(noOp.skippedAlreadyThere, [archived.getSessionId()]);
  const fresh = create(live);
  const freshBytes = readFileSync(fresh.getSessionFile(), "utf8");
  const { plan: bad } = await post({ mode: "preview", project: main, cwd: main, ids: [fresh.getSessionId()] });
  assert.equal(bad.roots.length, 1);
  bad.roots[0].bindings[0].path = join(root, "UNADMITTED");
  const refused = await post({ mode: "execute", plan: bad });
  assert.equal(refused.movedIds.length, 0); assert.equal(refused.failed[0].id, fresh.getSessionId());
  assert.match(refused.failed[0].error, /source directories changed/);
  assert.equal(readFileSync(fresh.getSessionFile(), "utf8"), freshBytes);
  assert.equal(existsSync(join(root, "UNADMITTED")), false);
  await post({ mode: "preview", project: dirname(root), ids: [liveParent.getSessionId()], cwd: main, authority: true }, 400);
  await post({ mode: "preview", project: dirname(root), ids: [liveParent.getSessionId()], cwd: main }, 403);

  const { moveSessionFamily } = await jiti.import("../../../lib/session-move.ts");
  const guardedRoot = create(live), guardedChild = create(live, guardedRoot);
  const guardedBytes = [guardedRoot, guardedChild].map(manager => readFileSync(manager.getSessionFile(), "utf8"));
  let stoppedRunningChild = false;
  await assert.rejects(moveSessionFamily(guardedRoot.getSessionId(), main, {
    assertAffected(ids) {
      assert.equal(ids.length, 2);
      globalThis.__piSessions.set(ids[0], { isRunning: () => false, shutdown: async () => {
        globalThis.__piSessions.delete(ids[0]);
        globalThis.__piSessions.set(ids[1], { isRunning: () => true, shutdown: async () => { stoppedRunningChild = true; } });
      } });
    },
  }), /Stop linked sessions/);
  assert.equal(stoppedRunningChild, false, "a late-running wrapper must not be shut down implicitly");
  globalThis.__piSessions.clear();
  assert.deepEqual([guardedRoot, guardedChild].map(manager => readFileSync(manager.getSessionFile(), "utf8")), guardedBytes);

  const replacement = create(live); const replacementBytes = readFileSync(replacement.getSessionFile(), "utf8");
  let validations = 0;
  await assert.rejects(moveSessionFamily(replacement.getSessionId(), main, {
    validate: async () => {
      if (++validations === 2) globalThis.__piSessions.set(replacement.getSessionId(), { isRunning: () => false });
    },
  }), /reopened/);
  globalThis.__piSessions.clear();
  assert.equal(readFileSync(replacement.getSessionFile(), "utf8"), replacementBytes, "an idle replacement cannot retain a stale handle across relocation");
});
