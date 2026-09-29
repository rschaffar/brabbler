import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../../lib/file-access.ts");
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
