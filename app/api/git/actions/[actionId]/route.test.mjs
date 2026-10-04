import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "git-action-read-route-"));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: false });
const { GET } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const fileAccess = await jiti.import("../../../../../lib/file-access.ts");
const { allowFileRoot } = fileAccess;
const { pendingGitReadFixture } = await import("../../../../../lib/rpc-pending-git-read-fixture.mjs");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionManagerCache } = await jiti.import("../../../../../lib/session-reader.ts");
const { createGitAction, transitionGitAction, releaseGitAction } = await jiti.import("../../../../../lib/git-action-journal.ts");
const { GIT_ACTION_ANCHOR_TYPE } = await jiti.import("../../../../../lib/git-action-types.ts");
const get = (actionId, query = {}) => GET(new Request(`http://localhost/api/git/actions/${actionId}?${new URLSearchParams(query)}`), { params: Promise.resolve({ actionId }) });
async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}
async function session(t) {
  const cwd = join(agentDir, randomUUID());
  await mkdir(cwd); allowFileRoot(cwd);
  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const id = manager.getSessionId(), file = manager.getSessionFile();
  cacheSessionPath(id, file);
  t.after(() => { invalidateSessionPathCache(id); invalidateSessionManagerCache(file); });
  return { cwd, manager, id, file };
}
const candidate = (repositoryRoot) => ({ kind: "commit", repositoryRoot, featureBranch: "feature", message: "Captured",
  paths: ["one.txt"], parentOid: "1".repeat(40), candidateTreeOid: "2".repeat(40),
  diff: { fromTreeOid: "3".repeat(40), toTreeOid: "2".repeat(40), hasBinaryChanges: false,
    patch: "diff --git a/one.txt b/one.txt\n--- a/one.txt\n+++ b/one.txt\n@@ -1 +1 @@\n-old\n+captured candidate bytes\n" } });
function anchor(manager, actionId, version = 1) {
  manager.appendCustomEntry(GIT_ACTION_ANCHOR_TYPE, { version, actionId });
  invalidateSessionManagerCache(manager.getSessionFile());
}

test("live workspace/preparation patch is readable without an optional SDK anchor and does not settle its question", async (t) => {
  for (const kind of ["workspace", "preparation"]) await t.test(kind, async (t) => {
    const f = await pendingGitReadFixture(t, agentDir, kind);
    assert.ok(f.anchorAttempts > 0);
    assert.equal(f.manager.getEntries().some((entry) => entry.customType === GIT_ACTION_ANCHOR_TYPE), false);
    const metadata = await json(await get(f.action.record.id, { sessionId: f.id }));
    assert.equal(metadata.record.kind, kind); assert.equal(metadata.candidate, undefined);
    const query = { sessionId: f.id, includeArtifact: "1" };
    const result = await json(await get(f.action.record.id, query));
    assert.equal(result.record.state, "awaiting-decision");
    assert.equal(result.candidate.kind, kind); assert.equal(result.candidate.diff.patch, f.patch);
    result.candidate.diff.patch = "changed detached HTTP response";
    assert.equal((await json(await get(f.action.record.id, query))).candidate.diff.patch, f.patch);
    assert.equal(f.wrapper.pendingUiRequests.get(f.request.id), f.request);
    assert.equal(f.wrapper.pendingUiResponses.get(f.request.id), f.response);
    assert.doesNotMatch(JSON.stringify(result), /reviewToken|planId|ownerGeneration|pendingGitActionReadBrand/);
    await json(await get(f.action.record.id, { ...query, proof: "anything" }), 400);
    await json(await get(f.action.record.id, { ...query, agentDir }), 400);
  });
});

test("live reads refuse original pending/owner changes across the access await instead of rebasing or falling back", async (t) => {
  for (const mutation of ["cancel", "new-question", "restore-settled-objects", "request-copy", "response-copy", "missing-response", "wrong-kind", "forked-wrapper", "forked-header", "terminal", "released", "denied-root"]) {
    await t.test(mutation, async (t) => {
      const f = await pendingGitReadFixture(t, agentDir);
      // Even a valid historical anchor must not substitute for this captured
      // pending read if its ORIGINAL association is lost across the await.
      anchor(f.manager, f.action.record.id);
      const originalRoots = fileAccess.getAllowedFileRoots;
      const barrier = t.mock.method(fileAccess, "getAllowedFileRoots", async () => {
        const roots = await originalRoots();
        if (["cancel", "new-question", "restore-settled-objects"].includes(mutation)) f.response.cancel();
        if (mutation === "new-question") { const next = f.ui.gitAction({ ...f.snapshot, actionId: f.action.record.id }); void next.catch(() => {}); }
        if (mutation === "restore-settled-objects") {
          f.wrapper.pendingUiRequests.set(f.request.id, f.request); f.wrapper.pendingUiResponses.set(f.request.id, f.response);
        }
        if (mutation === "request-copy") f.wrapper.pendingUiRequests.set(f.request.id, structuredClone(f.request));
        if (mutation === "response-copy") f.wrapper.pendingUiResponses.set(f.request.id, { ...f.response });
        if (mutation === "missing-response") f.wrapper.pendingUiResponses.delete(f.request.id);
        if (mutation === "wrong-kind") f.request.candidate.kind = "preparation";
        if (mutation === "forked-wrapper") globalThis.__piSessions.set(f.id, { isAlive: () => true, sessionFile: f.file, inner: f.inner });
        if (mutation === "forked-header") {
          const text = await readFile(f.file, "utf8"); await writeFile(f.file, text.replace(`"id":"${f.id}"`, `"id":"${randomUUID()}"`));
        }
        if (mutation === "terminal") await f.action.update("declined", { decision: "declined" });
        if (mutation === "released") f.action.release();
        return mutation === "denied-root" ? new Set() : roots;
      });
      try {
        await json(await get(f.action.record.id, { sessionId: f.id, includeArtifact: "1" }), mutation === "denied-root" ? 403 : mutation === "forked-header" ? 409 : 404);
        assert.equal(barrier.mock.callCount(), 1);
      } finally { barrier.mock.restore(); }
    });
  }
});

test("no-anchor live read requires actual same-session question AND response, not a live record or a wrong-kind question", async (t) => {
  for (const mutation of ["no-question", "no-response", "wrong-kind", "foreign-session"]) await t.test(mutation, async (t) => {
    const f = await pendingGitReadFixture(t, agentDir);
    if (mutation === "no-question") f.wrapper.pendingUiRequests.delete(f.request.id);
    if (mutation === "no-response") f.wrapper.pendingUiResponses.delete(f.request.id);
    if (mutation === "wrong-kind") f.request.candidate.kind = "preparation";
    const other = mutation === "foreign-session" ? await session(t) : undefined;
    await json(await get(f.action.record.id, { sessionId: other?.id ?? f.id, includeArtifact: "1" }), 404);
  });
});

test("history is lazy, anchor-authorized, bounded by IDs and never starts a wrapper", async (t) => {
  const owner = await session(t), other = await session(t);
  const action = await createGitAction({ sessionId: owner.id, source: "human", candidate: candidate(owner.cwd) });
  anchor(owner.manager, action.id);
  const wrappersBefore = globalThis.__piSessions?.size ?? 0;
  const metadata = await json(await get(action.id, { sessionId: owner.id }));
  assert.equal(metadata.record.id, action.id);
  assert.equal(metadata.candidate, undefined);
  assert.doesNotMatch(JSON.stringify(metadata), /captured candidate bytes|reviewToken|planId|receiptIds/);
  const expanded = await json(await get(action.id, { sessionId: owner.id, includeArtifact: "1" }));
  assert.match(expanded.candidate.diff.patch, /captured candidate bytes/);
  assert.equal(globalThis.__piSessions?.size ?? 0, wrappersBefore);
  await json(await get(action.id, { sessionId: other.id }), 404);
  await json(await get(action.id), 400);
  await json(await get("../outside", { sessionId: owner.id }), 400);
  await json(await get(action.id, { sessionId: owner.id, cwd: owner.cwd }), 400);
  await json(await get(action.id, { sessionId: owner.id, includeArtifact: "yes" }), 400);
  releaseGitAction(action.id);
});

test("shared child anchors remain readable after owner session and original workspace disappear", async (t) => {
  const owner = await session(t), child = await session(t);
  let action = await createGitAction({ sessionId: owner.id, source: "agent", candidate: candidate(owner.cwd) });
  action = await transitionGitAction(action.id, action.revision, { state: "awaiting-decision" });
  action = await transitionGitAction(action.id, action.revision, { state: "declined", decision: "declined" });
  anchor(owner.manager, action.id); anchor(child.manager, action.id);
  releaseGitAction(action.id);
  await rm(owner.file); invalidateSessionPathCache(owner.id); invalidateSessionManagerCache(owner.file);
  await rm(owner.cwd, { recursive: true });
  const data = await json(await get(action.id, { sessionId: child.id, includeArtifact: "1" }));
  assert.equal(data.record.sessionId, owner.id);
  assert.equal(data.record.state, "declined");
  assert.match(data.candidate.diff.patch, /captured candidate bytes/);
  assert.doesNotMatch(JSON.stringify(data), /reviewToken|planId|receiptIds/);
});

test("anchored terminal metadata survives artifact eviction and labels the unavailable bytes", async (t) => {
  const owner = await session(t);
  let action = await createGitAction({ sessionId: owner.id, source: "human", candidate: candidate(owner.cwd) });
  action = await transitionGitAction(action.id, action.revision, { state: "awaiting-decision" });
  action = await transitionGitAction(action.id, action.revision, { state: "declined", decision: "declined" });
  anchor(owner.manager, action.id); releaseGitAction(action.id);
  const dir = join(agentDir, "git-diagnostics-v2");
  const artifacts = (await readdir(dir)).filter((name) => name.endsWith(".artifact"));
  assert.ok(artifacts.length > 0);
  for (const name of artifacts) await rm(join(dir, name));
  const result = await json(await get(action.id, { sessionId: owner.id, includeArtifact: "1" }));
  assert.equal(result.record.state, "declined"); assert.equal(result.candidate, undefined);
  assert.match(result.unavailable, /artifact is expired|artifact is unavailable/i);
});

test("future/forged anchors do not authorize reads; missing records stay explicit placeholders", async (t) => {
  const owner = await session(t);
  const action = await createGitAction({ sessionId: owner.id, source: "agent", candidate: candidate(owner.cwd) });
  anchor(owner.manager, action.id, 2);
  await json(await get(action.id, { sessionId: owner.id }), 404);
  const absentId = randomUUID(); anchor(owner.manager, absentId);
  const missing = await json(await get(absentId, { sessionId: owner.id, includeArtifact: "1" }));
  assert.equal(missing.record, null);
  assert.equal(typeof missing.unavailable, "string");
  releaseGitAction(action.id);
});
