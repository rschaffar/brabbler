import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const original = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-review-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { appendSessionGitWorkflow } = await jiti.import("../../../../lib/git-workflow-policy.ts");
const { readGitAction } = await jiti.import("../../../../lib/git-action-journal.ts");
const exec = promisify(execFile);
async function git(cwd, ...args) {
  return (await exec("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout.trim();
}
after(async () => {
  if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = original;
  await rm(agentDir, { recursive: true, force: true });
});
function get(id, suffix = "") {
  return GET(new Request(`http://localhost/api/git/review?sessionId=${encodeURIComponent(id)}${suffix}`));
}
function post(body) {
  return POST(new Request("http://localhost/api/git/review", { method: "POST", body: JSON.stringify(body) }));
}
function request(id, review, selection) {
  return { sessionId: id, expectedFeatureOid: review.featureOid, expectedTargetOid: review.targetOid, selection };
}
async function commit(cwd, file, content) {
  await writeFile(join(cwd, file), content);
  await git(cwd, "add", file);
  await git(cwd, "commit", "-qm", file);
  return git(cwd, "rev-parse", "HEAD");
}
async function fixture(t, integration = true) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-review-route-"));
  const cwd = join(dir, "repo");
  await exec("git", ["init", "-q", "-b", "target", cwd]);
  await git(cwd, "config", "user.name", "Tester");
  await git(cwd, "config", "user.email", "test@example.invalid");
  await commit(cwd, "base", "base\n");
  await git(cwd, "switch", "-qc", "feature");
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  if (integration) appendSessionGitWorkflow(sm, { mode: "current", branch: "feature", onCreate: "stay", commits: "manual", integration: { targetBranch: "target", method: "merge" } });
  const id = sm.getSessionId();
  cacheSessionPath(id, sm.getSessionFile());
  allowFileRoot(cwd);
  t.after(async () => { invalidateSessionPathCache(id); invalidateSessionListCache(); await rm(dir, { recursive: true, force: true }); });
  return { cwd, id, sm, dir };
}

test("GET derives the checkout branch and persisted target; POST serves whole, single and contiguous diffs", async (t) => {
  const { cwd, id } = await fixture(t);
  const first = await commit(cwd, "first", "first\n");
  const second = await commit(cwd, "second", "second\n");
  const third = await commit(cwd, "third", "third\n");
  await writeFile(join(cwd, "second"), "uncommitted secret\n");
  let response = await get(id);
  assert.equal(response.status, 200);
  const { review } = await response.json();
  assert.equal(review.featureBranch, "feature");
  assert.equal(review.targetBranch, "target");
  assert.deepEqual(review.commits.map((c) => c.oid), [first, second, third]);
  response = await post(request(id, review, { kind: "merge" }));
  assert.equal(response.status, 200);
  const captured = await response.json();
  const whole = captured.diff;
  const history = await readGitAction(captured.actionId, { includeArtifact: true });
  assert.equal(history.record.source, "human");
  assert.equal(history.record.state, "succeeded");
  assert.equal(history.record.decision, undefined, "Capturing a comparison is not an execution approval or a claim it was read");
  assert.equal(history.record.outcome.status, "comparison-captured");
  assert.equal(history.record.summary.projectRoot, cwd);
  assert.equal(history.candidate.sourceCheckoutRoot, cwd);
  assert.equal(history.candidate.targetCheckoutRoot, undefined, "un-checked-out target is a branch, not a physical checkout");
  assert.deepEqual(history.candidate.diff, whole);
  assert.equal(whole.fromTreeOid, review.targetTreeOid);
  assert.equal(whole.toTreeOid, review.mergeTreeOid);
  assert.match(whole.patch, /\+third/);
  assert.doesNotMatch(whole.patch, /uncommitted secret/);
  response = await post(request(id, review, { kind: "commits", commitOids: [second] }));
  assert.equal(response.status, 200);
  const single = (await response.json()).diff;
  assert.equal(single.fromTreeOid, review.commits[0].treeOid);
  assert.equal(single.toTreeOid, review.commits[1].treeOid);
  assert.match(single.patch, /\+second/);
  assert.doesNotMatch(single.patch, /\+first|\+third/);
  response = await post(request(id, review, { kind: "commits", commitOids: [second, third] }));
  assert.equal(response.status, 200);
  const range = (await response.json()).diff;
  assert.equal(range.fromTreeOid, review.commits[0].treeOid);
  assert.equal(range.toTreeOid, review.commits[2].treeOid);
  assert.match(range.patch, /\+second/);
  assert.match(range.patch, /\+third/);
  assert.equal((await post(request(id, review, { kind: "commits", commitOids: [first, third] }))).status, 400);
  assert.equal((await post(request(id, review, { kind: "commits", commitOids: [third, first] }))).status, 400);
});

test("stale feature and target OIDs require refresh; checkout and policy are re-derived", async (t) => {
  const { cwd, id, sm } = await fixture(t);
  const first = await commit(cwd, "first", "first\n");
  const review = (await (await get(id)).json()).review;
  await commit(cwd, "second", "second\n");
  assert.equal((await post(request(id, review, { kind: "merge" }))).status, 409);
  const refreshed = (await (await get(id)).json()).review;
  await git(cwd, "update-ref", "refs/heads/target", first);
  assert.equal((await post(request(id, refreshed, { kind: "commits", commitOids: [first] }))).status, 409);
  await git(cwd, "switch", "-q", "target");
  assert.equal((await get(id)).status, 409);
  await git(cwd, "switch", "-q", "feature");
  appendSessionGitWorkflow(sm, null);
  assert.equal((await get(id)).status, 409);
  assert.equal((await post(request(id, refreshed, { kind: "merge" }))).status, 409);
});

test("rejects no target, malformed input, unauthorized cwd, subdirectory, and missing session", async (t) => {
  const { cwd, id } = await fixture(t, false);
  assert.equal((await get(id)).status, 409);
  assert.equal((await post({ sessionId: id, expectedFeatureOid: "a".repeat(40), expectedTargetOid: "b".repeat(40), selection: { kind: "merge" } })).status, 409);
  assert.equal((await get("missing")).status, 404);
  assert.equal((await get(id, "&cwd=/tmp")).status, 400);
  assert.equal((await post({ sessionId: id, cwd, selection: { kind: "merge" } })).status, 400);
  const allowed = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
  try {
    assert.equal((await get(id)).status, 403);
    assert.equal((await post({ sessionId: id, expectedFeatureOid: "a".repeat(40), expectedTargetOid: "b".repeat(40), selection: { kind: "merge" } })).status, 403);
  } finally { globalThis.__piAllowedRootsCache = allowed; }

  const active = await fixture(t);
  const review = (await (await get(active.id)).json()).review;
  const valid = request(active.id, review, { kind: "merge" });
  for (const body of [
    { ...valid, cwd }, { ...valid, featureBranch: "target" },
    { ...valid, selection: { kind: "merge", toTreeOid: review.targetTreeOid } },
    { ...valid, selection: { kind: "commits", commitOids: [] } },
    { ...valid, expectedTargetOid: "not an oid" },
  ]) assert.equal((await post(body)).status, 400);
  assert.equal((await post({ ...valid, expectedFeatureOid: "a".repeat(40) })).status, 409);
  const nested = join(active.cwd, "nested");
  await mkdir(nested);
  const nestedSession = SessionManager.create(nested);
  nestedSession.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  nestedSession.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  appendSessionGitWorkflow(nestedSession, { mode: "current", onCreate: "stay", commits: "manual", integration: { targetBranch: "target", method: "merge" } });
  cacheSessionPath(nestedSession.getSessionId(), nestedSession.getSessionFile());
  t.after(() => invalidateSessionPathCache(nestedSession.getSessionId()));
  assert.equal((await get(nestedSession.getSessionId())).status, 409);
});

test("oversized patches fail closed without partial output or raw subprocess stderr", async (t) => {
  const { cwd, id } = await fixture(t);
  await commit(cwd, "large", "x".repeat(1024 * 1024 + 100) + "\n");
  const review = (await (await get(id)).json()).review;
  const response = await post(request(id, review, { kind: "merge" }));
  assert.equal(response.status, 413);
  const text = await response.text();
  assert.doesNotMatch(text, /\+x{30}|stderr|fatal:/);
  assert.equal((await post({ ...request(id, review, { kind: "merge" }), extra: "x".repeat(256 * 1024) })).status, 413);
  assert.equal((await POST(new Request("http://localhost/api/git/review", { method: "POST", body: "{" }))).status, 400);
});
