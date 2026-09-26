import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const previous = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-workspace-status-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../../lib/session-reader.ts");
const { recordGitWorkspaceTransition, claimGitWorkspaceTransition, finishGitWorkspaceTransition } = await jiti.import("../../../../lib/git-workspace-transition.ts");
const get = (id) => GET(new Request(`http://localhost/api/git/workspace-transition?sessionId=${encodeURIComponent(id)}`));

test("status route reads only a persisted, allowed session's private result and never dispatches it", async (t) => {
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(agentDir, { recursive: true, force: true });
  });
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-workspace-status-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const id = manager.getSessionId();
  cacheSessionPath(id, manager.getSessionFile());
  t.after(() => invalidateSessionPathCache(id));
  allowFileRoot(cwd);
  assert.equal((await get("non-uuid")).status, 400);
  assert.equal((await get(randomUUID())).status, 404);
  assert.deepEqual(await (await get(id)).json(), { transition: null });
  const nonce = randomUUID();
  const transition = { version: 1, originCwd: cwd, destinationPath: join(cwd, "new-worktree"), branch: "feature",
    baseOid: "a".repeat(40), onCreate: "continue", featureTip: "a".repeat(40), createdAt: new Date().toISOString(), nonce };
  recordGitWorkspaceTransition(id, transition);
  assert.equal((await (await get(id)).json()).transition.status, "pending");
  assert.equal(claimGitWorkspaceTransition(id, nonce), true);
  assert.equal((await (await get(id)).json()).transition.status, "claimed");
  finishGitWorkspaceTransition(id, nonce, transition.destinationPath);
  const { transition: result } = await (await get(id)).json();
  assert.deepEqual(result, { status: "succeeded", action: "continue", sourceCwd: cwd,
    destinationPath: transition.destinationPath, nonce });
  assert.equal(claimGitWorkspaceTransition(id, nonce), false);
});
