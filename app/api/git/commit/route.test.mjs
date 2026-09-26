import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-commit-route-agent-"));
const original = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const git = promisify(execFile);
after(async () => {
  if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = original;
  await rm(agentDir, { recursive: true, force: true });
});
function post(body) { return POST(new Request("http://localhost/api/git/commit", { method: "POST", body: JSON.stringify(body) })); }
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-commit-route-"));
  const cwd = join(dir, "repo");
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.name", "Route Tester"]);
  await git("git", ["-C", cwd, "config", "user.email", "route@example.invalid"]);
  await writeFile(join(cwd, "a"), "first\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await git("git", ["-C", cwd, "commit", "-qm", "initial"]);
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const id = sm.getSessionId();
  cacheSessionPath(id, sm.getSessionFile());
  allowFileRoot(cwd);
  t.after(async () => { invalidateSessionPathCache(id); invalidateSessionListCache(); await rm(dir, { recursive: true, force: true }); });
  return { cwd, id, sm };
}
test("missing session, invalid cwd input and unauthorized persisted checkout", async (t) => {
  assert.equal((await post({ sessionId: "missing", operation: "preview", paths: ["a"] })).status, 404);
  const { cwd, id } = await fixture(t);
  assert.equal((await post({ sessionId: id, cwd, operation: "preview", paths: ["a"] })).status, 400);
  const old = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
  assert.equal((await post({ sessionId: id, operation: "preview", paths: ["a"] })).status, 403);
  globalThis.__piAllowedRootsCache = old;
});
test("manual commit without policy, running rejection, checkout mismatch, stale preview and success", async (t) => {
  const { cwd, id } = await fixture(t);
  const previous = globalThis.__piSessions;
  const live = { isRunning: () => true };
  globalThis.__piSessions = new Map([[id, live]]);
  t.after(() => { globalThis.__piSessions = previous; });
  await writeFile(join(cwd, "a"), "second\n");
  assert.equal((await post({ sessionId: id, operation: "preview", paths: ["a"] })).status, 409);
  live.isRunning = () => false;
  const denied = await post({ sessionId: id, operation: "preview", paths: ["https://user:secret@example.invalid/repo"] });
  assert.equal(denied.status, 409);
  assert.doesNotMatch(await denied.text(), /secret/);
  const response = await post({ sessionId: id, operation: "preview", paths: ["a"] });
  assert.equal(response.status, 200);
  const { preview, candidateDiff, candidateDiffUnavailable } = await response.json();
  assert.equal(candidateDiffUnavailable, undefined);
  assert.equal(candidateDiff.fromTreeOid, (await git("git", ["-C", cwd, "rev-parse", `${preview.head}^{tree}`])).stdout.trim());
  assert.equal(candidateDiff.toTreeOid, preview.tree);
  assert.match(candidateDiff.patch, /\+second/);
  assert.equal(candidateDiff.hasBinaryChanges, false);
  assert.equal((await post({ sessionId: id, operation: "confirm", preview: { ...preview, repositoryRoot: agentDir }, message: "no" })).status, 409);
  await writeFile(join(cwd, "a"), "third\n");
  assert.equal((await post({ sessionId: id, operation: "confirm", preview, message: "stale" })).status, 409);
  const fresh = (await (await post({ sessionId: id, operation: "preview", paths: ["a"] })).json()).preview;
  const committed = await post({ sessionId: id, operation: "confirm", preview: fresh, message: "approved" });
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.status, "committed");
  assert.equal(result.authorEmail, "route@example.invalid");
  assert.deepEqual(result.parents, [fresh.head]);
  assert.equal(result.tree, fresh.tree);
  assert.equal((await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
});

test("candidate patch is from server-derived trees even if caller supplies other OIDs", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "a"), "only approved contents\n");
  const response = await post({ sessionId: id, operation: "preview", paths: ["a"], head: "0".repeat(40), tree: "f".repeat(40) });
  assert.equal(response.status, 200);
  const { preview, candidateDiff } = await response.json();
  assert.notEqual(preview.tree, "f".repeat(40));
  assert.equal(candidateDiff.toTreeOid, preview.tree);
  assert.match(candidateDiff.patch, /\+only approved contents/);
  assert.equal(candidateDiff.fromTreeOid, (await git("git", ["-C", cwd, "rev-parse", `${preview.head}^{tree}`])).stdout.trim());
});

test("binary candidate patch is a summary; oversized patch has explicit unavailability, not partial output", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 255]));
  const binary = await post({ sessionId: id, operation: "preview", paths: ["binary.bin"] });
  assert.equal(binary.status, 200);
  const binaryBody = await binary.json();
  assert.equal(binaryBody.candidateDiff.hasBinaryChanges, true);
  assert.match(binaryBody.candidateDiff.patch, /Binary files .* differ/);
  assert.equal(binaryBody.candidateDiffUnavailable, undefined);
  await writeFile(join(cwd, "large.txt"), "x".repeat(1024 * 1024 + 100) + "\n");
  const large = await post({ sessionId: id, operation: "preview", paths: ["large.txt"] });
  assert.equal(large.status, 200);
  const body = await large.json();
  assert.ok(body.preview.reviewToken);
  assert.match(body.candidateDiffUnavailable, /1 MB limit/);
  assert.equal(body.candidateDiff, undefined);
});

test("unexpected tree diff failure fails preview rather than returning a token alone", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "a"), "updated\n");
  const bin = await mkdtemp(join(tmpdir(), "pi-web-git-fail-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" --no-pager diff --no-color "*) exit 1 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  try {
    const response = await post({ sessionId: id, operation: "preview", paths: ["a"] });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).preview, undefined);
  } finally { process.env.PATH = oldPath; }
});
