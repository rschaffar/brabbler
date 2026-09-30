import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const previous = process.env.PI_CODING_AGENT_DIR;
const home = await realpath(await mkdtemp(join(tmpdir(), "pi-git-proposals-")));
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const { proposeGitSettings, gitSettingsProposal, decideGitSettingsProposal, resetGitSettingsProposalsForTest } = await jiti.import("./git-settings-proposals.ts");
const { readGitWorkflowSettingsDocument, gitWorkflowSettingsPath } = await jiti.import("./git-workflow-settings-store.ts");
const { readManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { env: { ...process.env,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "no-git-config") } })).stdout.trim();
const change = (field, value) => value === undefined ? { field } : { field, value };
const propose = (f, scope, changes, repositoryPath) => proposeGitSettings(f.id, { scope, changes, ...(repositoryPath ? { repositoryPath } : {}) });
beforeEach(async () => { resetGitSettingsProposalsForTest(); await rm(gitWorkflowSettingsPath(), { force: true }); });
after(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(home, { recursive: true, force: true });
});
async function fixture() {
  const repo = await realpath(await mkdtemp(join(home, "repo-")));
  await git(repo, "init", "-qb", "main");
  await git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "initial");
  allowFileRoot(repo);
  const sm = SessionManager.create(repo);
  sm.appendMessage({ role: "user", content: "propose settings", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const file = sm.getSessionFile(), id = sm.getSessionId();
  cacheSessionPath(id, file);
  return { repo, sm, file, id };
}
async function applied(id, sessionId) { const response = await decideGitSettingsProposal(id, sessionId, "apply"); assert.equal(response.status, 200, await response.clone().text()); }

test("Global/Project/Session proposals review changes without writes, then apply ONLY the chosen scope; reset inherits", async (t) => {
  const f = await fixture(); t.after(() => invalidateSessionPathCache(f.id));
  const original = await readFile(f.file, "utf8");
  const global = await propose(f, "global", [change("commits", "manual"), change("checks", [])]);
  assert.deepEqual((await gitSettingsProposal(global, f.id)).after, { commits: "manual", checks: [] });
  assert.equal(await readFile(f.file, "utf8"), original);
  assert.deepEqual(readGitWorkflowSettingsDocument().global, {});
  await applied(global, f.id);
  assert.deepEqual(readGitWorkflowSettingsDocument().global, { commits: "manual", checks: [] });
  assert.equal((await gitSettingsProposal(global, f.id)).state, "applied");
  await assert.rejects(decideGitSettingsProposal(global, f.id, "apply"), /handled/);
  const project = await propose(f, "project", [change("enabled", false), change("targetBranch", null)], f.repo);
  await applied(project, f.id);
  assert.deepEqual(readGitWorkflowSettingsDocument().projects[f.repo], { enabled: false, targetBranch: null });
  const reset = await propose(f, "project", [change("enabled")], f.repo);
  assert.deepEqual((await gitSettingsProposal(reset, f.id)).after, { targetBranch: null });
  await applied(reset, f.id);
  assert.deepEqual(readGitWorkflowSettingsDocument().projects[f.repo], { targetBranch: null });
  const session = await propose(f, "session", [change("commits", "off")]);
  await applied(session, f.id);
  assert.deepEqual(readManagedSessionGitWorkflow(SessionManager.open(f.file).getEntries()).overrides, { commits: "off" });
  assert.deepEqual(readGitWorkflowSettingsDocument().global, { commits: "manual", checks: [] });
  const scoped = await propose(f, "session", [change("checks", [])], f.repo);
  await applied(scoped, f.id);
  const { readGitProjectSessionSettings } = await jiti.import("./git-project-session.ts");
  assert.deepEqual(readGitProjectSessionSettings(SessionManager.open(f.file).getEntries()).get(f.repo).overrides, { checks: [] });
});

test("unknown/duplicate/unsupported fields and forged scope fail before any write", async (t) => {
  const f = await fixture(); t.after(() => invalidateSessionPathCache(f.id));
  for (const changes of [[change("enabled", true), change("enabled", false)], [change("grant", true)],
    [change("commits", "automatic")], [change("cleanup", "delete")], [change("checks", [{ label: "Shell", argv: ["sh", "-c", "git push"] }])],
    [{ field: "enabled", value: true, approved: true }], []]) {
    await assert.rejects(propose(f, "global", changes));
  }
  await assert.rejects(proposeGitSettings(f.id, { scope: "global", changes: [change("enabled", false)], apply: true }));
  await assert.rejects(proposeGitSettings(f.id, { scope: "project", changes: [change("enabled", false)] }));
  assert.deepEqual(readGitWorkflowSettingsDocument().global, {});
});

test("stale revisions, dismissal, process loss and foreign/copy identity cannot apply", async (t) => {
  const f = await fixture(), other = await fixture();
  t.after(() => { invalidateSessionPathCache(f.id); invalidateSessionPathCache(other.id); });
  const id = await propose(f, "global", [change("enabled", false)]);
  await assert.rejects(decideGitSettingsProposal(id, other.id, "apply"), /another chat/);
  const newer = await propose(f, "global", [change("commits", "manual")]);
  await applied(newer, f.id);
  assert.equal((await gitSettingsProposal(id, f.id)).state, "stale");
  const rejected = await decideGitSettingsProposal(id, f.id, "apply").catch((cause) => cause);
  assert.ok(rejected instanceof Error || rejected.status === 409);
  const dismissed = await propose(f, "session", [change("enabled", false)]);
  await decideGitSettingsProposal(dismissed, f.id, "dismiss");
  await assert.rejects(decideGitSettingsProposal(dismissed, f.id, "apply"), /handled/);
  const lost = await propose(f, "project", [change("enabled", false)], f.repo);
  resetGitSettingsProposalsForTest();
  await assert.rejects(decideGitSettingsProposal(lost, f.id, "apply"), /expired/);
  assert.deepEqual({ ...readGitWorkflowSettingsDocument().projects }, {});
  const rebound = await propose(f, "global", [change("enabled", false)]);
  const oldFile = f.file + ".old";
  await rename(f.file, oldFile);
  await import("node:fs/promises").then(({ copyFile }) => copyFile(oldFile, f.file));
  await assert.rejects(decideGitSettingsProposal(rebound, f.id, "apply"), /identity/);
});

test("project identity, write epoch and subagent restrictions cannot be bypassed by proposal IDs", async (t) => {
  const f = await fixture(); t.after(() => invalidateSessionPathCache(f.id));
  const project = await propose(f, "project", [change("enabled", false)], f.repo);
  await git(f.repo, "switch", "-qc", "different-local-branch");
  await assert.rejects(decideGitSettingsProposal(project, f.id, "apply"));
  assert.deepEqual({ ...readGitWorkflowSettingsDocument().projects }, {});
  const global = await propose(f, "global", [change("enabled", false)]);
  const { advanceGitWorkflowWriteEpoch } = await jiti.import("./git-workflow-write-epoch.ts");
  advanceGitWorkflowWriteEpoch(process.env.PI_CODING_AGENT_DIR);
  assert.equal((await gitSettingsProposal(global, f.id)).state, "stale");
  await assert.rejects(decideGitSettingsProposal(global, f.id, "apply"), /stale/);
  const pending = await propose(f, "global", [change("enabled", false)]);
  f.sm.appendCustomEntry("pi-web:subagent", { parentSessionId: "other" });
  await assert.rejects(decideGitSettingsProposal(pending, f.id, "apply"), /ordinary chat/);
  await assert.rejects(propose(f, "global", [change("enabled", false)]), /ordinary chat/);
});

test("proposal HTTP API only accepts a same-chat decision, never client-supplied settings", async (t) => {
  const f = await fixture(), other = await fixture();
  t.after(() => { invalidateSessionPathCache(f.id); invalidateSessionPathCache(other.id); });
  const { GET, POST } = await jiti.import("../app/api/git/workflow/proposals/[proposalId]/route.ts");
  const id = await propose(f, "global", [change("enabled", false)]);
  const ctx = { params: Promise.resolve({ proposalId: id }) };
  const url = `http://localhost/api/git/workflow/proposals/${id}`;
  const get = await GET(new Request(`${url}?sessionId=${f.id}`), ctx);
  assert.equal(get.status, 200);
  assert.equal((await get.json()).effectiveAfter.enabled, false);
  const post = (body) => POST(new Request(url, { method: "POST", body: JSON.stringify(body) }), ctx);
  assert.equal((await post({ sessionId: other.id, decision: "apply" })).status, 403);
  assert.equal((await post({ sessionId: f.id, decision: "apply", overrides: { enabled: true } })).status, 400);
  assert.equal((await post({ sessionId: f.id, decision: "apply", revision: "forged" })).status, 400);
  assert.equal((await post({ sessionId: f.id, decision: "apply", padding: "x".repeat(2048) })).status, 413);
  assert.equal((await post({ sessionId: f.id, decision: "apply" })).status, 200);
  assert.deepEqual(readGitWorkflowSettingsDocument().global, { enabled: false });
  assert.equal((await post({ sessionId: f.id, decision: "apply" })).status, 409);
});

test("Session Apply while running refuses without consuming; idle retry saves but never captures task", async (t) => {
  const f = await fixture(); t.after(() => invalidateSessionPathCache(f.id));
  const id = await propose(f, "session", [change("commits", "manual")]);
  const previousRegistry = globalThis.__piSessions;
  let running = true;
  globalThis.__piSessions = new Map([[f.id, { isAlive: () => true, isRunning: () => running,
    sessionFile: f.file, inner: { sessionManager: f.sm, getActiveToolNames: () => ["read"] } }]]);
  try {
    await assert.rejects(decideGitSettingsProposal(id, f.id, "apply"), /Stop the chat/);
    assert.equal((await gitSettingsProposal(id, f.id)).state, "pending");
    running = false;
    await applied(id, f.id);
    const saved = readManagedSessionGitWorkflow(SessionManager.open(f.file).getEntries());
    assert.deepEqual(saved.overrides, { commits: "manual" });
    assert.deepEqual(saved.task, { kind: "none" });
  } finally { globalThis.__piSessions = previousRegistry; }
});
