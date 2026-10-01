import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-project-settings-"));
const agentDir = join(home, "agent");
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url);
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { loadGitProjectSettings } = await jiti.import("./git-project-settings.ts");
const { GIT_PROJECT_SETTINGS_TYPE, appendGitProjectSessionSettings, readGitProjectSessionSettings } = await jiti.import("./git-project-session.ts");
const { appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { inheritSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { loadGitWorkflowSettings, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { managedGitPermissions } = await jiti.import("./git-workflow-permissions.ts");
const { assertManagedGitAction, ManagedGitAccessError } = await jiti.import("./git-workflow-access.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { env: { ...process.env,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "no-config") } })).stdout.trim();
after(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(home, { recursive: true, force: true });
});
const manager = (entries) => ({ appendCustomEntry: (customType, data) => {
  entries.push({ type: "custom", customType, data, id: String(entries.length), timestamp: new Date().toISOString() });
} });
async function repo() {
  const dir = await mkdtemp(join(home, "repo-"));
  await git(dir, "init", "-qb", "main");
  await git(dir, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${join(home, "no-hooks")}`, "commit", "--allow-empty", "-qm", "base");
  allowFileRoot(dir);
  return dir;
}
const facts = { subagent: false, tools: ["read", "edit"] };

test("Global → selected Project → Chat×Project does not import unqualified settings or a caller task", async () => {
  const a = await repo(), b = await repo(), entries = [];
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { commits: "ask" }, projects: {
    [a]: { targetBranch: "a-target", checks: [{ label: "A", argv: ["node", "a.mjs"] }] },
    [b]: { targetBranch: "b-target", commits: "manual", checks: [{ label: "B", argv: ["node", "b.mjs"] }] },
  } }, agentDir);
  appendManagedSessionGitWorkflow(manager(entries), { targetBranch: "unqualified-target", checks: [] },
    { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, targetBranch: "pinned-task" } });
  appendGitProjectSessionSettings(manager(entries), a, { targetBranch: "a-chat", checks: [] });
  const selections = await Promise.all([a, b, a].map((root) => selectGitProjectResources(root)));
  const [first, other, again] = await Promise.all(selections.map((selection) => loadGitProjectSettings(selection, entries, agentDir, "same-chat")));
  assert.equal(first.resolved.session.values.targetBranch, "a-chat");
  assert.deepEqual(first.resolved.session.values.checks, []);
  assert.equal(first.resolved.session.origins.targetBranch, "session");
  assert.equal(other.resolved.session.values.targetBranch, "b-target");
  assert.equal(other.resolved.session.values.commits, "manual");
  assert.equal(other.resolved.session.values.checks[0].label, "B");
  assert.deepEqual(other.session, {});
  assert.equal(other.legacySessionSettings, true);
  assert.deepEqual(other.task, { kind: "none" });
  assert.equal(first.revision, again.revision);
  assert.notEqual(first.revision, other.revision);
  assert.equal(managedGitPermissions(other, facts).agent.commit.code, "manual-commits");
  assert.equal(managedGitPermissions(first, facts).agent.commit.code, "project-scope-read-only");
  assert.equal(managedGitPermissions(first, facts).legacyAgentCommitConsent, false);
});

test("explicit project preferences survive fork/move unchanged; malformed or future entries block rather than resurrect", () => {
  const source = [], destination = [];
  appendGitProjectSessionSettings(manager(source), "/project-a", { enabled: false, targetBranch: null, checks: [] });
  appendGitProjectSessionSettings(manager(source), "/project-b", { commits: "manual" });
  appendGitProjectSessionSettings(manager(source), "/project-a", {});
  inheritSessionGitWorkflow(source, manager(destination));
  const copied = readGitProjectSessionSettings(destination);
  assert.deepEqual(copied.get("/project-a").overrides, {});
  assert.deepEqual(copied.get("/project-b").overrides, { commits: "manual" });
  assert.equal(destination.length, 2, "no unqualified policy or authority is synthesized");
  // Session move preserves entries: a changed cwd is not an argument to this reader.
  assert.deepEqual([...readGitProjectSessionSettings(destination).keys()], ["/project-a", "/project-b"]);
  for (const data of [null, { version: 99, projectRoot: "/project-a", overrides: {} },
    { version: 1, projectRoot: "/project-a", overrides: { commits: "automatic" } },
    { version: 1, projectRoot: "/project-a", overrides: {}, approved: true },
    { version: 1, projectRoot: "relative", overrides: {} }]) {
    const entries = [...source, { type: "custom", customType: GIT_PROJECT_SETTINGS_TYPE, data }];
    assert.throws(() => readGitProjectSessionSettings(entries));
    const rejected = [];
    assert.throws(() => inheritSessionGitWorkflow(entries, manager(rejected)));
    assert.deepEqual(rejected, [], "validation precedes copying");
  }
});

test("scoped restrictive saves clamp existing mutation paths only in that project and cannot relax pinned restrictions", async () => {
  const a = await repo(), b = await repo(), entries = [];
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} }, agentDir);
  appendManagedSessionGitWorkflow(manager(entries), {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS } });
  appendGitProjectSessionSettings(manager(entries), b, { commits: "off" });
  const state = (cwd) => loadGitWorkflowSettings(cwd, entries, agentDir, "same-chat");
  assert.equal(managedGitPermissions(await state(a), facts).agent.commit.kind, "confirmation-required");
  assert.equal(managedGitPermissions(await state(b), facts).human.commit.kind, "blocked");
  appendGitProjectSessionSettings(manager(entries), b, { commits: "manual" });
  assert.equal(managedGitPermissions(await state(b), facts).agent.commit.code, "manual-commits");
  assert.equal(managedGitPermissions(await state(b), facts).human.commit.kind, "confirmation-required");
  appendGitProjectSessionSettings(manager(entries), b, { enabled: false });
  assert.equal(managedGitPermissions(await state(b), facts).agent.integration.code, "disabled");
  appendManagedSessionGitWorkflow(manager(entries), { commits: "off" }, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, commits: "manual" } });
  appendGitProjectSessionSettings(manager(entries), a, { enabled: true, commits: "ask" });
  assert.equal(managedGitPermissions(await state(a), facts).agent.commit.kind, "blocked");
});

test("canonical project restrictions also clamp nested caller cwds without changing legacy UI grouping", async () => {
  const root = await repo(), nested = join(root, "src"), linked = `${root}-linked`, entries = [];
  await mkdir(nested);
  await git(root, "worktree", "add", "-qb", "topic", linked); allowFileRoot(linked);
  const linkedNested = join(linked, "src"); await mkdir(linkedNested);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} }, agentDir);
  appendManagedSessionGitWorkflow(manager(entries), {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS } });
  for (const overrides of [{ commits: "off" }, { commits: "manual" }, { enabled: false }]) {
    appendGitProjectSessionSettings(manager(entries), root, overrides);
    for (const cwd of [nested, linkedNested]) {
      const state = await loadGitWorkflowSettings(cwd, entries, agentDir, "same-chat");
      assert.equal(state.projectRoot, cwd, "keep the historical UI/defaults identity");
      assert.deepEqual(state.projectSessionRestrictions, overrides);
      assert.equal(managedGitPermissions(state, facts).agent.commit.kind, "blocked");
      if (overrides.commits === "manual") assert.equal(managedGitPermissions(state, facts).agent.commit.code, "manual-commits");
      if (overrides.enabled === false) assert.equal(managedGitPermissions(state, facts).human.integration.code, "disabled");
    }
  }
});

test("canonical Project Off and Manual restrictions also clamp nested legacy callers", async () => {
  const root = await repo(), nested = join(root, "src"), linked = `${root}-linked`, entries = [];
  await mkdir(nested);
  await git(root, "worktree", "add", "-qb", "topic", linked); allowFileRoot(linked);
  const linkedNested = join(linked, "src"); await mkdir(linkedNested);
  appendManagedSessionGitWorkflow(manager(entries), {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS } });
  for (const [project, expectedCode] of [
    [{ enabled: false }, "disabled"], [{ commits: "off" }, "session-commits-off"], [{ commits: "manual" }, "manual-commits"],
  ]) {
    writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: { [root]: project } }, agentDir);
    for (const cwd of [nested, linkedNested]) {
      const state = await loadGitWorkflowSettings(cwd, entries, agentDir, "same-chat");
      assert.equal(state.projectRoot, cwd, "legacy UI grouping stays independent");
      assert.equal(managedGitPermissions(state, facts).agent.commit.code, expectedCode);
      if (project.enabled === false) assert.equal(managedGitPermissions(state, facts).human.integration.code, "disabled");
      if (project.commits === "off") assert.equal(managedGitPermissions(state, facts).human.commit.code, "session-commits-off");
    }
  }
});

test("unknown canonical caller identity blocks the legacy gate instead of dropping keyed restrictions", async () => {
  const root = await repo(), entries = [];
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} }, agentDir);
  appendManagedSessionGitWorkflow(manager(entries), {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS } });
  appendGitProjectSessionSettings(manager(entries), root, { commits: "off" });
  await rename(join(root, ".git"), join(root, "unavailable-metadata"));
  for (const actor of ["agent", "human"]) {
    await assert.rejects(assertManagedGitAction(root, entries, "commit", actor, agentDir, facts.tools),
      (error) => error instanceof ManagedGitAccessError && /unavailable or unsupported/.test(error.message));
  }
});

test("selected revisions bind caller/project/directory identity but not unrelated transcript activity", async () => {
  const a = await repo(), entries = [];
  const selection = await selectGitProjectResources(a);
  const before = await loadGitProjectSettings(selection, entries, agentDir, "chat-a");
  entries.push({ type: "message", id: "message", message: { role: "user", content: "unrelated" } });
  assert.equal((await loadGitProjectSettings(selection, entries, agentDir, "chat-a")).revision, before.revision);
  assert.notEqual((await loadGitProjectSettings(selection, entries, agentDir, "chat-b")).revision, before.revision);
  appendGitProjectSessionSettings(manager(entries), a, { targetBranch: "main" });
  assert.notEqual((await loadGitProjectSettings(selection, entries, agentDir, "chat-a")).revision, before.revision);
});
