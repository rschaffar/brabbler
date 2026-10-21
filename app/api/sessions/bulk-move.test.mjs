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

  // One reviewed selection spans several bounded requests. Older clients cannot
  // accidentally submit the whole operation as one unbounded execution.
  const many = Array.from({ length: 12 }, () => create(live));
  const manyIds = many.map(manager => manager.getSessionId());
  const { plan: bounded } = await post({ mode: "preview", project: main, cwd: main, ids: manyIds });
  await post({ mode: "execute", plan: bounded }, 400);
  assert.ok(many.every(manager => existsSync(manager.getSessionFile())), "oversized request has no effects");
  for (let offset = 0; offset < manyIds.length; offset += 5) {
    const response = await post({ mode: "execute", plan: bounded, rootIds: manyIds.slice(offset, offset + 5) });
    assert.equal(response.failed.length, 0); assert.deepEqual(response.pending, []);
  }
  const observation = await post({ mode: "reconcile", plan: bounded, rootIds: manyIds.slice(0, 5) });
  assert.ok(observation.roots.every(root => root.state === "destination"));

  const pendingRoots = [create(live), create(live)];
  const { plan: timed } = await post({ mode: "preview", project: main, cwd: main, ids: pendingRoots.map(manager => manager.getSessionId()) });
  let clock = 0;
  const timer = t.mock.method(performance, "now", () => clock += 11_000);
  let yielded;
  try { yielded = await post({ mode: "execute", plan: timed }); }
  finally { timer.mock.restore(); }
  assert.equal(yielded.succeeded.length, 1); assert.equal(yielded.pending.length, 1); assert.equal(yielded.failed.length, 0);

  // New incoming links must fit the original reviewed write footprint, not a
  // client-supplied running counter that could reset the 4096-session ceiling.
  const linkedRoot = create(live);
  const { plan: beforeLink } = await post({ mode: "preview", project: main, cwd: main, ids: [linkedRoot.getSessionId()] });
  const lateFork = create(live), latePath = lateFork.getSessionFile();
  const lateLines = readFileSync(latePath, "utf8").split("\n"), lateHeader = JSON.parse(lateLines[0]);
  lateHeader.parentSession = linkedRoot.getSessionFile(); lateLines[0] = JSON.stringify(lateHeader);
  writeFileSync(latePath, lateLines.join("\n")); invalidateSessionListCache();
  const lateBytes = readFileSync(latePath, "utf8");
  const lateRefusal = await post({ mode: "execute", plan: beforeLink });
  assert.match(lateRefusal.failed[0].error, /Linked sessions changed/);
  assert.equal(readFileSync(latePath, "utf8"), lateBytes);

  const { moveSessionFamily, withSessionMoveLock } = await jiti.import("../../../lib/session-move.ts");
  // Observation cannot see an in-flight staging window and does not append,
  // evict wrappers, create sessions or retry mutations.
  const observedRoot = create(live), observedChild = create(live, observedRoot);
  const { plan: observePlan } = await post({ mode: "preview", project: main, cwd: main, ids: [observedRoot.getSessionId()] });
  const observedBytes = [observedRoot, observedChild].map(manager => readFileSync(manager.getSessionFile(), "utf8"));
  let unlock;
  const held = new Promise(resolve => { unlock = resolve; });
  const holding = withSessionMoveLock(() => held);
  let observed = false;
  const waiting = post({ mode: "reconcile", plan: observePlan, rootIds: [observedRoot.getSessionId()] }).then(value => { observed = true; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(observed, false);
  unlock(); await holding;
  assert.equal((await waiting).roots[0].state, "source");
  globalThis.__piSessions.set(observedChild.getSessionId(), { isRunning: () => true });
  assert.equal((await post({ mode: "reconcile", plan: observePlan, rootIds: [observedRoot.getSessionId()] })).roots[0].state, "unknown");
  globalThis.__piSessions.delete(observedChild.getSessionId());
  assert.deepEqual([observedRoot, observedChild].map(manager => readFileSync(manager.getSessionFile(), "utf8")), observedBytes);
  const observedChildPath = observedChild.getSessionFile();
  const changedLines = observedBytes[1].split("\n"), changedHeader = JSON.parse(changedLines[0]);
  changedHeader.cwd = main; changedLines[0] = JSON.stringify(changedHeader);
  writeFileSync(observedChildPath, changedLines.join("\n")); invalidateSessionListCache();
  assert.equal((await post({ mode: "reconcile", plan: observePlan, rootIds: [observedRoot.getSessionId()] })).roots[0].state, "changed");
  writeFileSync(observedChildPath, observedBytes[1]); invalidateSessionListCache();
  const extraChild = create(live, observedRoot); invalidateSessionListCache();
  assert.equal((await post({ mode: "reconcile", plan: observePlan, rootIds: [observedRoot.getSessionId()] })).roots[0].state, "changed");
  rmSync(extraChild.getSessionFile()); invalidateSessionListCache();
  rmSync(observedChildPath); invalidateSessionListCache();
  assert.equal((await post({ mode: "reconcile", plan: observePlan, rootIds: [observedRoot.getSessionId()] })).roots[0].state, "unknown");

  // A completed last-source move removes its session-derived source admission.
  // Read-only reconciliation can still use the independently admitted target.
  const plain = join(root, "last-source"); mkdirSync(plain);
  const last = create(plain);
  globalThis.__piAllowedRootsCache = undefined; invalidateSessionListCache();
  const { plan: lastPlan } = await post({ mode: "preview", project: plain, cwd: main, ids: [last.getSessionId()] });
  await post({ mode: "execute", plan: lastPlan });
  globalThis.__piAllowedRootsCache = undefined; invalidateSessionListCache();
  assert.equal((await post({ mode: "reconcile", plan: lastPlan, rootIds: [last.getSessionId()] })).roots[0].state, "destination");
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

  // An observation queued behind family A cannot overtake family B in the
  // same lost-ack request. It must wait for the entire dispatched batch.
  const batchA = create(live), batchB = create(live);
  const batchIds = [batchA.getSessionId(), batchB.getSessionId()];
  const { plan: lockedBatch } = await post({ mode: "preview", project: main, cwd: main, ids: batchIds });
  let enterBatch, releaseBatch;
  const enteredBatch = new Promise(resolve => { enterBatch = resolve; });
  const batchGate = new Promise(resolve => { releaseBatch = resolve; });
  globalThis.__piSessions.set(batchA.getSessionId(), { isRunning: () => false, shutdown: async () => {
    enterBatch(); await batchGate; globalThis.__piSessions.delete(batchA.getSessionId());
  } });
  const executingBatch = post({ mode: "execute", plan: lockedBatch });
  await enteredBatch;
  const observingBatch = post({ mode: "reconcile", plan: lockedBatch, rootIds: batchIds });
  releaseBatch();
  const afterBatch = await observingBatch;
  assert.ok(afterBatch.roots.every(root => root.state === "destination"), "observation waits for B as well as A");
  assert.equal((await executingBatch).succeeded.length, 2);

  // Duplicate saved identities are detected before live merging can collapse them.
  const duplicateSession = create(live);
  const { plan: duplicatePlan } = await post({ mode: "preview", project: main, cwd: main, ids: [duplicateSession.getSessionId()] });
  const duplicatePath = join(dirname(duplicateSession.getSessionFile()), `duplicate_${duplicateSession.getSessionId()}.jsonl`);
  writeFileSync(duplicatePath, readFileSync(duplicateSession.getSessionFile())); invalidateSessionListCache();
  assert.equal((await post({ mode: "reconcile", plan: duplicatePlan, rootIds: [duplicateSession.getSessionId()] })).roots[0].state, "unknown");
  rmSync(duplicatePath); invalidateSessionListCache();

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
