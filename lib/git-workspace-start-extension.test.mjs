import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-workspace-agent-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});
const git = promisify(execFile);
const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const {
  createGitWorkspaceStartExtension, readPendingGitWorkspaceTransition,
  appendCompletedGitWorkspaceTransition, GIT_WORKSPACE_START_TYPE, GIT_WORKSPACE_COMPLETED_TYPE,
} = await jiti.import("./git-workspace-start-extension.ts");
const { appendSessionGitWorkflow, readSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { resolveGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { allowFileRoot } = await jiti.import("./allowed-roots.ts");
const { recordGitWorkspaceTransition } = await jiti.import("./git-workspace-transition.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const policy = { mode: "worktree", baseBranch: "main", onCreate: "fork", commits: "manual" };

async function fixture(t, onStarted) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-workspace-start-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const repo = path.join(dir, "repo");
  await git("git", ["init", "-q", "-b", "main", repo]);
  await git("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base", "--allow-empty"]);
  const base = (await git("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
  const persisted = SessionManager.create(repo, path.join(dir, "sessions"));
  persisted.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
  persisted.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const sessionFile = persisted.getSessionFile();
  const entries = [];
  const sessionId = persisted.getSessionId();
  const manager = {
    getSessionId: () => sessionId,
    getEntries: () => entries, appendCustomEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
    getSessionFile: () => sessionFile, isPersisted: () => true,
    getCwd: () => repo, getHeader: () => ({ id: sessionId, cwd: repo }),
  };
  allowFileRoot(repo);
  let tool;
  const pi = {
    getActiveTools: () => ["read", "edit"],
    registerTool: (value) => { tool = value; },
    appendEntry: (customType, data) => manager.appendCustomEntry(customType, data),
  };
  createGitWorkspaceStartExtension(repo, () => readSessionGitWorkflow(entries), onStarted && ((transition) => onStarted(transition, entries))).factory(pi);
  const execute = (branch = "feature/one", oid = base, cwd = repo) => tool.execute("call", { branch, expectedBaseOid: oid }, undefined, undefined, { cwd, sessionManager: manager });
  return { repo, dir, entries, manager, pi, tool, execute, base, sessionId, sessionFile };
}

test("explicit saved worktree consent, real cwd, and base OID are required; defaults are not consent", async (t) => {
  const f = await fixture(t);
  assert.equal(f.tool.executionMode, "sequential");
  assert.equal((await f.execute()).isError, true);
  appendSessionGitWorkflow(f.manager, { mode: "current", onCreate: "stay", commits: "agent" });
  assert.equal((await f.execute()).isError, true);
  appendSessionGitWorkflow(f.manager, policy);
  assert.equal((await f.execute("feature/one", "a".repeat(40))).isError, true);
  assert.equal((await f.execute("feature/one", f.base, os.tmpdir())).isError, true);
  assert.equal((await f.execute("feature/one", f.base.slice(0, -1))).isError, true);
  f.manager.getHeader = () => ({ cwd: f.repo, parentSession: "/parent" });
  assert.equal((await f.execute()).isError, true);
  f.manager.getHeader = () => ({ id: f.sessionId, cwd: f.repo });
  f.manager.getSessionFile = () => null;
  assert.equal((await f.execute()).isError, true);
  f.manager.getSessionFile = () => f.sessionFile;
  assert.equal(f.entries.some((e) => e.customType === GIT_WORKSPACE_START_TYPE), false);
});

test("create only; durable start tracks the saved preference, feature tip, and blocks replay until completion", async (t) => {
  let notified = false;
  const f = await fixture(t, (transition, entries) => {
    assert.equal(entries.at(-1).customType, GIT_WORKSPACE_START_TYPE);
    assert.equal(entries.at(-1).data, transition);
    notified = true;
  });
  appendSessionGitWorkflow(f.manager, policy);
  const result = await f.execute();
  assert.equal(result.isError, undefined);
  assert.equal(notified, true);
  assert.equal(result.details.onCreate, "fork");
  assert.equal(result.details.baseOid, f.base);
  assert.equal(result.details.featureTip, f.base);
  assert.equal(result.details.originCwd, f.repo);
  assert.match(result.details.nonce, /^[a-f\d-]{36}$/);
  assert.deepEqual(readPendingGitWorkspaceTransition(f.entries), result.details);
  assert.equal((await f.execute("feature/two")).isError, true);
  const target = { entries: [...f.entries], getEntries() { return this.entries; }, appendCustomEntry(customType, data) { this.entries.push({ type: "custom", customType, data }); } };
  appendCompletedGitWorkspaceTransition(f.manager, result.details, target);
  appendCompletedGitWorkspaceTransition(f.manager, result.details, target);
  assert.equal(f.entries.filter((e) => e.customType === GIT_WORKSPACE_COMPLETED_TYPE).length, 1);
  assert.equal(target.entries.filter((e) => e.customType === GIT_WORKSPACE_COMPLETED_TYPE).length, 1);
  assert.equal(readPendingGitWorkspaceTransition(f.entries), null);
  assert.equal(readPendingGitWorkspaceTransition(target.entries), null);
  assert.equal((await f.execute()).isError, true); // existing branch cannot silently attach
  assert.equal((await f.execute("feature/two")).isError, undefined);
  assert.equal(readPendingGitWorkspaceTransition([{ type: "custom", customType: GIT_WORKSPACE_START_TYPE, data: { ...result.details, nonce: "bad" } }]), null);
});

test("saved chat and project workspace Deny block creation from any same-repo registered source", async (t) => {
  const f = await fixture(t);
  appendSessionGitWorkflow(f.manager, policy);
  const other = path.join(f.dir, "other");
  await git("git", ["-C", f.repo, "worktree", "add", "-qb", "other", other]);
  allowFileRoot(other);
  const selection = await selectGitProjectResources(f.repo);
  const owner = { sessionId: f.sessionId, sessionFile: f.sessionFile, sessionCwd: f.repo };
  const run = (branch) => f.tool.execute("call", { workspaceBranch: "other", branch, expectedBaseOid: f.base }, undefined, undefined,
    { cwd: f.repo, sessionManager: f.manager });
  const current = await readProjectAuthorization(selection, owner, testAgentDir);
  await saveProjectAuthorization(selection, owner, "session", "workspace", "deny", current, testAgentDir);
  assert.match((await run("feature/denied")).details.error, /Project authorization denies/);
  await saveProjectAuthorization(selection, owner, "session", "workspace", "inherit", await readProjectAuthorization(selection, owner, testAgentDir), testAgentDir);
  await saveProjectAuthorization(selection, undefined, "project", "workspace", "deny", await readProjectAuthorization(selection, undefined, testAgentDir), testAgentDir);
  assert.match((await run("feature/denied")).details.error, /Project authorization denies/);
  await saveProjectAuthorization(selection, undefined, "project", "workspace", "inherit", await readProjectAuthorization(selection, undefined, testAgentDir), testAgentDir);
  assert.equal((await run("feature/allowed")).isError, undefined);
});

test("creates from another registered source but transitions the calling chat", async (t) => {
  const f = await fixture(t);
  appendSessionGitWorkflow(f.manager, policy);
  const other = path.join(f.dir, "other");
  await git("git", ["-C", f.repo, "worktree", "add", "-qb", "other", other]);
  allowFileRoot(other);
  const run = (workspaceBranch, branch) => f.tool.execute("call", { workspaceBranch, branch, expectedBaseOid: f.base }, undefined, undefined,
    { cwd: f.repo, sessionManager: f.manager });
  assert.equal((await run("missing", "feature/missing")).isError, true);
  const result = await run("other", "feature/cross");
  assert.equal(result.isError, undefined);
  assert.equal(result.details.originCwd, f.repo);
  assert.equal(result.details.featureTip, f.base);
  assert.match((await readFile(path.join(f.dir, "repo-worktrees", "feature-cross", ".git"), "utf8")), /gitdir:/);
});

test("stale/dirty base and add failures never append a start; failed append reports recoverable path", async (t) => {
  const f = await fixture(t);
  appendSessionGitWorkflow(f.manager, policy);
  assert.equal((await f.execute("bad", "0".repeat(40))).isError, true);
  await writeFile(path.join(f.repo, "untracked"), "change");
  assert.equal((await f.execute("dirty")).isError, true);
  await rm(path.join(f.repo, "untracked"));
  assert.equal(f.entries.some((e) => e.customType === GIT_WORKSPACE_START_TYPE), false);
  f.pi.appendEntry = () => { throw new Error("disk full"); };
  const result = await f.execute("recovery");
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Worktree created at .*recovery.*Recover manually/);
  assert.equal(f.entries.some((e) => e.customType === GIT_WORKSPACE_START_TYPE), false);
  assert.match((await readFile(path.join(f.dir, "repo-worktrees", "recovery", ".git"), "utf8")), /gitdir:/);
});

test("awaits durable callback and reports manual recovery without re-creating on failure", async (t) => {
  let accept;
  const f = await fixture(t, () => new Promise((resolve) => { accept = resolve; }));
  appendSessionGitWorkflow(f.manager, policy);
  const pending = f.execute("feature/awaited");
  for (let i = 0; !accept && i < 1000; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(typeof accept, "function");
  assert.equal((await f.execute("feature/other")).isError, true);
  accept();
  assert.match((await pending).content[0].text, /scheduled after this run/);

  const rejected = await fixture(t, async () => { throw new Error("secret error"); });
  appendSessionGitWorkflow(rejected.manager, policy);
  const result = await rejected.execute("feature/recovery");
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Recover manually; do not retry creation/);
  assert.doesNotMatch(result.content[0].text, /secret error/);
  assert.equal((await rejected.execute("feature/recovery-two")).isError, true);
});

test("completed receipt refuses another tool creation before touching git", async (t) => {
  let source;
  const f = await fixture(t, (transition) => recordGitWorkspaceTransition(source.sessionId, transition));
  source = f;
  t.after(() => rm(path.join(getAgentDir(), "pi-web", "git-workspace-transitions", "v1", f.sessionId), { recursive: true, force: true }));
  appendSessionGitWorkflow(f.manager, policy);
  const first = await f.execute("feature/first");
  assert.equal(first.isError, undefined);
  appendCompletedGitWorkspaceTransition(f.manager, first.details);
  const second = await f.execute("feature/second");
  assert.equal(second.isError, true);
  assert.match(second.content[0].text, /already has a workspace transition/);
  await assert.rejects(readFile(path.join(f.dir, "repo-worktrees", "feature-second", ".git")), /ENOENT/);
});

test("stay creates without scheduling movement", async (t) => {
  let called = false;
  const f = await fixture(t, () => { called = true; });
  appendSessionGitWorkflow(f.manager, { ...policy, onCreate: "stay" });
  const result = await f.execute();
  assert.equal(result.isError, undefined);
  assert.equal(called, false);
  assert.match(result.content[0].text, /No session movement was requested/);
});

test("missing managed base proposes one create-only worktree with exact approval while chat stays put", async (t) => {
  let transitioned = false;
  const f = await fixture(t, () => { transitioned = true; });
  const settings = resolveGitWorkflowSettings({ workspace: "worktree", baseBranch: null, onCreate: "continue" }).values;
  appendManagedSessionGitWorkflow(f.manager, {}, { kind: "managed", settings });
  const saved = structuredClone(f.entries);
  const calls = [];
  const run = (branch, baseBranch, confirm = async () => true) => f.tool.execute("call", {
    branch, baseBranch, expectedBaseOid: f.base,
  }, undefined, undefined, { cwd: f.repo, sessionManager: f.manager, hasUI: true,
    ui: { confirm: async (title, detail) => { calls.push({ title, detail }); return confirm(); } } });
  assert.match((await run("feature/missing")).content[0].text, /Supply an explicit local baseBranch/);
  assert.equal(calls.length, 0);
  assert.deepEqual(f.entries, saved, "missing input must not write settings/history");
  assert.match((await run("feature/decline", "main", async () => false)).content[0].text, /cancelled/);
  assert.equal(f.entries.some((e) => e.customType === GIT_WORKSPACE_START_TYPE), false);
  assert.match((await readFile(path.join(f.repo, ".git", "HEAD"), "utf8")), /main/);
  const result = await run("feature/one", "main");
  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 2);
  assert.match(calls[1].detail, /feature\/one.*feature-one.*local main.*stay \(one-off base; no settings change or automatic chat movement\)/);
  assert.equal(result.details.onCreate, "stay");
  assert.equal(transitioned, false);
  assert.equal(readPendingGitWorkspaceTransition(f.entries), null);
  assert.equal(f.entries.filter((e) => e.customType === GIT_WORKSPACE_COMPLETED_TYPE).length, 1);
  assert.equal(readSessionGitWorkflow(f.entries), null, "no saved base/legacy grant is created");
  assert.deepEqual(f.entries.filter((e) => e.customType === "pi-web:git-workflow"), saved.filter((e) => e.customType === "pi-web:git-workflow"));
  assert.match((await readFile(path.join(f.dir, "repo-worktrees", "feature-one", ".git"), "utf8")), /gitdir:/);
});

test("configured-base mismatch, pause during approval, and stale base fail before creating", async (t) => {
  const f = await fixture(t);
  const settings = resolveGitWorkflowSettings({ workspace: "worktree", baseBranch: null, onCreate: "fork" }).values;
  appendManagedSessionGitWorkflow(f.manager, {}, { kind: "managed", settings });
  const run = (branch, baseBranch, confirm = async () => true) => f.tool.execute("call", {
    branch, baseBranch, expectedBaseOid: f.base,
  }, undefined, undefined, { cwd: f.repo, sessionManager: f.manager, hasUI: true,
    ui: { confirm } });
  const denied = await run("feature/paused", "main", async () => {
    writeGitWorkflowSettingsDocument({ ...readGitWorkflowSettingsDocument(), paused: true });
    return true;
  });
  assert.match(denied.content[0].text, /paused/);
  assert.equal(f.entries.some((e) => e.customType === GIT_WORKSPACE_START_TYPE), false);
  writeGitWorkflowSettingsDocument({ ...readGitWorkflowSettingsDocument(), paused: false });
  assert.match((await run("feature/stale", "main", async () => {
    await git("git", ["-C", f.repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "moved", "--allow-empty"]);
    return true;
  })).content[0].text, /failed/);
  assert.equal(f.entries.some((e) => e.customType === GIT_WORKSPACE_START_TYPE), false);
  appendManagedSessionGitWorkflow(f.manager, {}, { kind: "managed", settings: resolveGitWorkflowSettings({ workspace: "worktree", baseBranch: "main" }).values });
  assert.match((await run("feature/mismatch", "other")).content[0].text, /differs from the captured base/);
  assert.equal(f.entries.some((e) => e.customType === GIT_WORKSPACE_START_TYPE), false);
});

test("registration is ordinary non-chat-only only", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const chatOnly = source.indexOf("extensionFactories: [checkoutGuard, exactSystemPromptExtension, createSessionReferenceExtension(), createGitWorkflowContextFilterExtension()]");
  const ordinary = source.indexOf("createProjectCommandBashExtension({", chatOnly);
  const end = source.indexOf("extensionsOverride:", ordinary);
  assert.ok(chatOnly > 0 && ordinary > chatOnly && end > ordinary);
  assert.match(source.slice(ordinary, end), /createGitWorkspaceStartExtension\(/);
  assert.doesNotMatch(source.slice(source.indexOf("chatOnly\n"), ordinary), /createGitWorkspaceStartExtension\(/);
});
