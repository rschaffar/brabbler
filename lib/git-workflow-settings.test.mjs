import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-workflow-settings-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { DEFAULT_GIT_WORKFLOW_SETTINGS, GIT_WORKFLOW_FIELDS, validateGitWorkflowOverrides, validateGitWorkflowScopeOverrides,
  validateGitWorkflowSettings, resolveGitWorkflowSettings, projectPolicyBranches, settingsFromLegacyPolicy,
  policyFromWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
const { appendManagedSessionGitWorkflow, snapshotManagedSessionGitWorkflow,
  readManagedSessionGitWorkflow, validateManagedSessionGitWorkflow,
  workflowTaskFromEntries, policyForWorkflowTask } = await jiti.import("./git-workflow-session.ts");
const { gitWorkflowSettingsPath, readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument,
  withGitWorkflowSettingsLock, loadGitWorkflowSettings } = await jiti.import("./git-workflow-settings-store.ts");
const { GIT_WORKFLOW_TYPE, appendSessionGitWorkflow, readSessionGitWorkflow, readCapturedSessionGitWorkflow,
  inheritSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { gitWorkflowDefaultsPath, setProjectGitWorkflow } = await jiti.import("./git-workflow-store.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], {
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(agentDir, "no-git-config") },
})).stdout.trim();
const check = (label, ...argv) => ({ label, argv });
const settings = (overrides = {}) => resolveGitWorkflowSettings(overrides).values;
const entry = (data, id = "workflow-entry") => ({ type: "custom", id, customType: GIT_WORKFLOW_TYPE, data });
const legacy = () => ({ mode: "worktree", baseBranch: "main", onCreate: "fork", commits: "agent",
  integration: { targetBranch: "main", method: "merge" }, checks: [check("Tests", "npm", "test")] });

// No test reads or writes the operator's Pi state or Git identity/configuration.
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

async function fixture(t, linked = false) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-workflow-settings-repo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo"), storeDir = join(dir, "agent");
  await git(dir, "init", "-qb", "main", repo);
  await git(repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${join(dir, "no-hooks")}`, "commit", "--allow-empty", "-qm", "initial");
  const sm = SessionManager.create(repo);
  sm.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const result = { dir, repo, storeDir, sm, file: sm.getSessionFile(), id: sm.getSessionId() };
  if (linked) {
    result.linked = join(dir, "linked");
    result.alias = join(dir, "alias");
    result.other = join(dir, "other");
    await git(repo, "worktree", "add", "-qb", "feature/linked", result.linked);
    await symlink(result.linked, result.alias, "dir");
    await git(dir, "init", "-qb", "main", result.other);
  }
  return result;
}

function managedData(task, overrides = {}) {
  return { version: 2, overrides, task, policy: policyForWorkflowTask(task) };
}
async function saveDocument(document, storeDir) {
  await withGitWorkflowSettingsLock(storeDir, async () => writeGitWorkflowSettingsDocument(document, storeDir));
}

test("field-level precedence reports all origins and treats false, null and [] as values", () => {
  const global = { workspace: "worktree", baseBranch: "main", branch: "feature/global", targetBranch: "main",
    commits: "manual", checks: [check("Global", "npm", "test")] };
  const project = { enabled: false, baseBranch: "release", branch: null, targetBranch: null, checks: [] };
  const session = { baseBranch: null, onCreate: "stay", commits: "off" };
  const result = resolveGitWorkflowSettings(global, project, session);
  assert.deepEqual(result.values, { ...DEFAULT_GIT_WORKFLOW_SETTINGS, ...global, ...project, ...session });
  assert.deepEqual(result.origins, {
    ...Object.fromEntries(GIT_WORKFLOW_FIELDS.map((key) => [key, "builtin"])),
    enabled: "project", workspace: "global", baseBranch: "session", branch: "project", onCreate: "session",
    commits: "session", checks: "project", targetBranch: "project",
  });
  const reset = resolveGitWorkflowSettings(global, {}, {});
  assert.equal(reset.values.enabled, true);
  assert.equal(reset.values.baseBranch, null);
  assert.equal(reset.values.targetBranch, null);
  assert.deepEqual(reset.values.checks, []);
  assert.equal(reset.origins.checks, "builtin");
  assert.equal(reset.values.workspace, "worktree", "portable Global preferences still inherit");
  assert.deepEqual(Object.keys(resolveGitWorkflowSettings().origins).sort(), [...GIT_WORKFLOW_FIELDS].sort());
  assert.ok(Object.values(resolveGitWorkflowSettings().origins).every((origin) => origin === "builtin"));
});

test("managed Git tool guidance inherits Global to Project to chat without creating a grant", () => {
  assert.equal(DEFAULT_GIT_WORKFLOW_SETTINGS.managedGitToolsOnly, true);
  const global = { managedGitToolsOnly: false };
  const project = { managedGitToolsOnly: true };
  assert.equal(resolveGitWorkflowSettings(global, {}).values.managedGitToolsOnly, false);
  assert.equal(resolveGitWorkflowSettings(global, project).origins.managedGitToolsOnly, "project");
  const chat = resolveGitWorkflowSettings(global, project, { managedGitToolsOnly: false });
  assert.equal(chat.values.managedGitToolsOnly, false);
  assert.equal(chat.origins.managedGitToolsOnly, "session");
  assert.equal(resolveGitWorkflowSettings(global, project, {}).values.managedGitToolsOnly, true);
  assert.deepEqual(validateGitWorkflowScopeOverrides({ managedGitToolsOnly: false }, "session"), { managedGitToolsOnly: false });
  assert.throws(() => validateGitWorkflowOverrides({ managedGitToolsOnly: "off" }), /managedGitToolsOnly/);
});

test("policy inheritance resolves only selected project main; null and [] override without grants", () => {
  const global = { baseBranch: ":project-main", targetBranch: ":project-main", commits: "ask", commitConfirmation: "none", checks: [] };
  const a = resolveGitWorkflowSettings(global, { mainBranch: "trunk", delivery: "local", method: "ff",
    workspace: "current", prepareConfirmation: "none", checks: [check("A", "npm", "test")] });
  const b = resolveGitWorkflowSettings(global, { mainBranch: "release", workspace: "worktree", delivery: "pr", checks: [] });
  assert.deepEqual(projectPolicyBranches(a.values), { base: "trunk", target: "trunk" });
  assert.deepEqual(projectPolicyBranches(b.values), { base: "release", target: null });
  assert.equal(projectPolicyBranches(settings({ mainBranch: "trunk", baseBranch: "project-main" })).base, "project-main",
    "a legacy literal branch named project-main is never reinterpreted as a symbolic target");
  assert.deepEqual(projectPolicyBranches(resolveGitWorkflowSettings(global).values), { base: null, target: null });
  assert.equal(a.origins.mainBranch, "project");
  assert.equal(a.origins.commitConfirmation, "global");
  assert.equal(a.origins.prepareConfirmation, "project");
  assert.equal(resolveGitWorkflowSettings(global, { mainBranch: "trunk", targetBranch: null }, { delivery: "leave" }).values.targetBranch, null);
  assert.deepEqual(resolveGitWorkflowSettings(global, { checks: [check("A", "npm", "test")] }, { checks: [] }).values.checks, []);
  assert.equal(resolveGitWorkflowSettings(global, { mainBranch: "trunk" }, { commitConfirmation: "ask" }).origins.commitConfirmation, "session");
  assert.equal(policyFromWorkflowSettings(b.values).integration, undefined, "PR does not adapt to a legacy local integration plan");
  assert.equal(policyFromWorkflowSettings(settings({ delivery: "leave", targetBranch: "main" })).integration, undefined);
  assert.equal(policyFromWorkflowSettings(settings({ commits: "ask", commitConfirmation: "none" })).commits, "manual");
});

test("global and chat cannot introduce project-specific branches/recipes; old bytes remain readable", () => {
  for (const scope of ["global", "session"]) {
    for (const invalid of [{ mainBranch: "main" }, { baseBranch: "release" }, { branch: "feature/a" },
      { targetBranch: "main" }, { checks: [check("Test", "npm", "test")] }]) {
      assert.throws(() => validateGitWorkflowScopeOverrides(invalid, scope), /project-specific/);
      assert.deepEqual(validateGitWorkflowScopeOverrides(invalid, scope, invalid), invalid, "legacy unchanged values are retained");
    }
    assert.deepEqual(validateGitWorkflowScopeOverrides({ baseBranch: ":project-main", targetBranch: null, checks: [] }, scope),
      { baseBranch: ":project-main", targetBranch: null, checks: [] });
  }
  assert.deepEqual(validateGitWorkflowScopeOverrides({ mainBranch: "main", checks: [check("Test", "npm", "test")] }, "project"),
    { mainBranch: "main", checks: [check("Test", "npm", "test")] });
  assert.equal(validateGitWorkflowSettings(Object.fromEntries(Object.entries(settings()).filter(([key]) => !key.endsWith("Confirmation") && !["managedGitToolsOnly", "mainBranch", "delivery"].includes(key)))).managedGitToolsOnly, true);
});

test("ordered checks replace an ancestor list and are independently copied at every resolution", () => {
  const global = { checks: [check("Global", "npm", "test")] };
  const project = { checks: [check("Second", "node", "second.mjs"), check("First", "node", "first.mjs")] };
  const original = structuredClone(project);
  const result = resolveGitWorkflowSettings(global, project);
  assert.deepEqual(result.values.checks, original.checks);
  result.values.checks[0].argv[1] = "changed.mjs";
  result.values.checks.reverse();
  assert.deepEqual(project, original);
  assert.deepEqual(resolveGitWorkflowSettings(global, project).values.checks, original.checks);
  assert.deepEqual(resolveGitWorkflowSettings(global, project, { checks: [] }).values.checks, []);
  assert.deepEqual(validateGitWorkflowOverrides({ checks: original.checks }).checks, original.checks);
  const builtin = resolveGitWorkflowSettings();
  builtin.values.checks.push(check("Local", "true"));
  assert.deepEqual(resolveGitWorkflowSettings().values.checks, []);
});

test("strict settings reject unsupported authority, malformed values and incomplete task snapshots", () => {
  for (const invalid of [null, [], "settings", { enabled: null }, { enabled: "false" }, { enabled: undefined },
    { workspace: "auto" }, { onCreate: "auto" }, { commits: "agent" }, { commits: "auto" }, { cleanup: "delete" },
    { baseBranch: "refs/remotes/origin/main" }, { branch: "../main" }, { targetBranch: "-main" },
    { method: "rebase" }, { checks: null }, { checks: "npm test" },
    { checks: [{ label: "Shell", argv: ["sh", "-c", "echo test"] }] },
    { checks: [{ label: "Invalid", argv: ["npm", "--token=not-a-real-secret"] }] },
    { checks: [{ label: "Unknown", argv: ["true"], approved: true }] },
    { version: 99 }, { autoApprove: true }, { push: true }, { grant: "all" }]) {
    assert.throws(() => validateGitWorkflowOverrides(invalid), undefined, JSON.stringify(invalid));
  }
  assert.deepEqual(validateGitWorkflowOverrides({ enabled: false, baseBranch: null, checks: [] }),
    { enabled: false, baseBranch: null, checks: [] });
  assert.deepEqual(validateGitWorkflowSettings(settings()), settings());
  for (const field of GIT_WORKFLOW_FIELDS.filter((key) => !key.endsWith("Confirmation") && !["managedGitToolsOnly", "mainBranch", "delivery"].includes(key))) {
    const incomplete = settings();
    delete incomplete[field];
    assert.throws(() => validateGitWorkflowSettings(incomplete), /Incomplete/, field);
  }
});

test("off, manual and ask adapt to preferences only, never legacy automatic commit consent", () => {
  for (const commits of ["off", "manual", "ask"]) {
    const value = settings({ commits, checks: [check("Test", "npm", "test")], targetBranch: "main" });
    const policy = policyFromWorkflowSettings(value);
    assert.equal(policy.commits, "manual", commits);
    policy.checks[0].argv[1] = "changed";
    assert.equal(value.checks[0].argv[1], "test");
  }
  assert.equal(policyFromWorkflowSettings(settings({ enabled: false })), null);
  assert.equal(policyFromWorkflowSettings(settings({ workspace: "worktree", baseBranch: null })), null);
  assert.deepEqual(policyFromWorkflowSettings(settings({ workspace: "worktree", baseBranch: "main", onCreate: "fork" })),
    { mode: "worktree", baseBranch: "main", onCreate: "fork", commits: "manual", checks: [] });
  assert.equal(policyForWorkflowTask({ kind: "none" }), null);
});

test("legacy import preserves configuration but reduces agent commits to ask", () => {
  const policy = legacy();
  const imported = settingsFromLegacyPolicy(policy);
  assert.equal(imported.commits, "ask");
  assert.equal(imported.workspace, "worktree");
  assert.equal(imported.baseBranch, "main");
  assert.equal(imported.targetBranch, "main");
  assert.equal(policyFromWorkflowSettings(imported).commits, "manual");
  imported.checks[0].argv[1] = "changed";
  assert.equal(policy.checks[0].argv[1], "test");
  const manual = settingsFromLegacyPolicy({ mode: "current", branch: "feature/a", onCreate: "stay", commits: "manual" });
  assert.equal(manual.commits, "manual");
  assert.equal(manual.branch, "feature/a");
  assert.equal(manual.baseBranch, null);
  assert.deepEqual(manual.checks, []);
});

test("fresh confirmation-off preferences do not migrate pinned legacy commit modes or create a grant", () => {
  const fresh = resolveGitWorkflowSettings({}, { commits: "ask", commitConfirmation: "none" });
  assert.equal(fresh.values.commits, "ask");
  assert.equal(fresh.values.commitConfirmation, "none");
  const agent = settingsFromLegacyPolicy({ mode: "current", onCreate: "stay", commits: "agent" });
  const manual = settingsFromLegacyPolicy({ mode: "current", onCreate: "stay", commits: "manual" });
  assert.equal(resolveGitWorkflowSettings({}, agent).values.commitConfirmation, "ask");
  assert.equal(resolveGitWorkflowSettings({}, agent).values.commits, "ask");
  assert.equal(resolveGitWorkflowSettings({}, manual).values.commits, "manual");
  assert.equal(resolveGitWorkflowSettings({}, { commits: "off" }).values.commits, "off");
});

test("SDK snapshots persist copies, a compatibility projection and a v1 downgrade tombstone", async (t) => {
  const { sm, file } = await fixture(t);
  appendSessionGitWorkflow(sm, legacy());
  const input = settings({ workspace: "worktree", baseBranch: "main", commits: "ask", checks: [check("Saved", "npm", "test")] });
  snapshotManagedSessionGitWorkflow(sm, input);
  input.checks[0].argv[1] = "mutated";
  const entries = SessionManager.open(file, undefined).getEntries();
  const records = entries.filter((e) => e.type === "custom" && e.customType === GIT_WORKFLOW_TYPE);
  assert.deepEqual(records.at(-2).data, { version: 1, policy: null });
  assert.equal(records.at(-1).data.version, 2);
  assert.equal(readSessionGitWorkflow(entries).commits, "manual");
  // This is the history visible to a pre-v2 reader, which skips unknown versions.
  assert.equal(readSessionGitWorkflow(records.filter((e) => e.data.version === 1)), null);
  const saved = readManagedSessionGitWorkflow(entries);
  assert.equal(saved.task.kind, "managed");
  assert.deepEqual(saved.overrides, {});
  assert.equal(saved.task.settings.checks[0].argv[1], "test");
  saved.task.settings.checks[0].argv[1] = "read-mutated";
  saved.policy.checks[0].label = "read-mutated";
  assert.equal(readManagedSessionGitWorkflow(entries).task.settings.checks[0].argv[1], "test");
  assert.equal(readManagedSessionGitWorkflow(entries).policy.checks[0].label, "Saved");
});

test("session defaults preserve old consent and explicit opt-out until task adoption", async (t) => {
  const { sm, file } = await fixture(t);
  appendSessionGitWorkflow(sm, legacy());
  const oldTask = workflowTaskFromEntries(sm.getEntries());
  appendManagedSessionGitWorkflow(sm, { commits: "off", enabled: false }, oldTask);
  const reopened = SessionManager.open(file, undefined);
  assert.deepEqual(workflowTaskFromEntries(reopened.getEntries()), { kind: "legacy", policy: legacy() });
  assert.equal(readSessionGitWorkflow(reopened.getEntries()).commits, "agent");
  appendManagedSessionGitWorkflow(reopened, {}, { kind: "legacy", policy: null });
  assert.deepEqual(workflowTaskFromEntries(reopened.getEntries()), { kind: "legacy", policy: null });
  assert.equal(readSessionGitWorkflow(reopened.getEntries()), null);
  assert.deepEqual(workflowTaskFromEntries([]), { kind: "none" });
  appendManagedSessionGitWorkflow(reopened, { commits: "ask" }, { kind: "none" });
  assert.deepEqual(workflowTaskFromEntries(reopened.getEntries()), { kind: "none" });
});

test("chat opt-out masks executable policy but retains task, recovery projection, and fork state", async (t) => {
  const { sm } = await fixture(t);
  const old = legacy();
  appendSessionGitWorkflow(sm, old);
  appendManagedSessionGitWorkflow(sm, {}, { kind: "legacy", policy: old }, true);
  const entries = sm.getEntries();
  assert.equal(readSessionGitWorkflow(entries), null);
  assert.deepEqual(readCapturedSessionGitWorkflow(entries), old);
  assert.deepEqual(workflowTaskFromEntries(entries), { kind: "legacy", policy: old });
  assert.equal(readManagedSessionGitWorkflow(entries).optedOut, true);
  assert.equal((await loadGitWorkflowSettings(sm.getCwd(), entries, agentDir, sm.getSessionId())).optedOut, true);
  const fork = [];
  inheritSessionGitWorkflow(entries, { appendCustomEntry: (type, data) => fork.push(entry(data, type)) });
  assert.equal(readManagedSessionGitWorkflow(fork).optedOut, true);
  assert.equal(readSessionGitWorkflow(fork), null);
  appendManagedSessionGitWorkflow(sm, {}, workflowTaskFromEntries(entries), false);
  assert.deepEqual(readSessionGitWorkflow(sm.getEntries()), old);
  assert.equal(readManagedSessionGitWorkflow(sm.getEntries()).optedOut, false);
  assert.equal(validateManagedSessionGitWorkflow(managedData({ kind: "legacy", policy: old })).optedOut, undefined);
  assert.throws(() => validateManagedSessionGitWorkflow({ ...managedData({ kind: "legacy", policy: old }), optedOut: "false" }));
});

test("malformed or future managed records block historical consent, including attempted v1 downgrade", () => {
  const task = { kind: "managed", settings: settings({ commits: "ask" }) };
  const valid = managedData(task);
  const older = entry({ version: 1, policy: legacy() }, "legacy");
  const invalid = [null, [], { version: 3, policy: legacy() }, { ...valid, approved: true },
    { ...valid, overrides: { commits: "agent" } }, { ...valid, task: { kind: "auto" } },
    { ...valid, task: { ...task, approved: true } }, { ...valid, policy: legacy() },
    { ...valid, task: { kind: "managed", settings: { ...task.settings, cleanup: "delete" } } },
    { ...valid, task: { kind: "none", settings: task.settings } }];
  for (const data of invalid) {
    assert.throws(() => validateManagedSessionGitWorkflow(data));
    assert.throws(() => readManagedSessionGitWorkflow([older, entry(data)]));
    assert.throws(() => workflowTaskFromEntries([older, entry(data)]));
  }
  const unrelated = { ...entry({ version: 99 }), customType: "unrelated" };
  assert.deepEqual(workflowTaskFromEntries([older, unrelated]), { kind: "legacy", policy: legacy() });
  assert.deepEqual(readManagedSessionGitWorkflow([entry(valid), unrelated]), valid);
  for (const policy of [legacy(), null]) {
    const downgraded = [older, entry(valid, "managed"), entry({ version: 1, policy }, "downgrade")];
    assert.throws(() => readManagedSessionGitWorkflow(downgraded), /downgraded/);
    assert.throws(() => workflowTaskFromEntries(downgraded), /downgraded/);
  }
});

test("fork inheritance copies current session overrides and the task even when branch history omitted them", async (t) => {
  const { sm, repo } = await fixture(t);
  const branchLeaf = sm.getLeafId();
  const task = { kind: "managed", settings: settings({ commits: "ask", checks: [check("Task", "npm", "test")] }) };
  const overrides = { commits: "manual", checks: [check("Next task", "node", "next.mjs")] };
  appendManagedSessionGitWorkflow(sm, overrides, task);
  const source = sm.getEntries();
  const forkFile = sm.createBranchedSession(branchLeaf);
  const fork = SessionManager.open(forkFile, undefined);
  assert.equal(fork.getCwd(), repo);
  assert.equal(readManagedSessionGitWorkflow(fork.getEntries()), undefined);
  inheritSessionGitWorkflow(source, fork);
  const original = readManagedSessionGitWorkflow(source);
  assert.deepEqual(readManagedSessionGitWorkflow(fork.getEntries()), original);
  const changed = readManagedSessionGitWorkflow(fork.getEntries());
  changed.overrides.checks[0].argv[1] = "fork.mjs";
  changed.task.settings.checks[0].argv[1] = "fork-test";
  appendManagedSessionGitWorkflow(fork, changed.overrides, changed.task);
  assert.deepEqual(readManagedSessionGitWorkflow(source), original);
  assert.equal(readManagedSessionGitWorkflow(SessionManager.open(forkFile, undefined).getEntries()).overrides.checks[0].argv[1], "fork.mjs");
  assert.equal(readSessionGitWorkflow(fork.getEntries().filter((e) => e.data?.version !== 2)), null);
});

test("defaults resolve by physical canonical project across main, linked and aliased worktrees", async (t) => {
  const { repo, linked, alias, other, storeDir } = await fixture(t, true);
  const missing = await loadGitWorkflowSettings(undefined, [], storeDir);
  assert.deepEqual(missing.global, {});
  assert.equal(missing.session, null);
  assert.deepEqual(missing.task, { kind: "none" });
  const document = readGitWorkflowSettingsDocument(storeDir);
  document.global = { commits: "manual", targetBranch: "main" };
  document.projects[repo] = { commits: "off", targetBranch: null, checks: [] };
  document.projects[other] = { commits: "ask" };
  await saveDocument(document, storeDir);
  for (const cwd of [repo, linked, alias]) {
    const loaded = await loadGitWorkflowSettings(cwd, [], storeDir);
    assert.equal(loaded.projectRoot, repo);
    assert.deepEqual(loaded.project, document.projects[repo]);
    assert.equal(loaded.resolved.project.origins.commits, "project");
    assert.equal(loaded.resolved.project.values.targetBranch, null);
  }
  assert.equal((await loadGitWorkflowSettings(other, [], storeDir)).resolved.project.values.commits, "ask");
  assert.equal((await stat(gitWorkflowSettingsPath(storeDir))).mode & 0o777, 0o600);
  assert.equal((await stat(join(storeDir, "pi-web"))).mode & 0o777, 0o700);
});

test("legacy defaults import conservatively without rewriting sessions; explicit empty project suppresses re-import", async (t) => {
  const { repo, linked, sm, storeDir } = await fixture(t, true);
  await setProjectGitWorkflow(repo, legacy(), gitWorkflowDefaultsPath(storeDir));
  const imported = await loadGitWorkflowSettings(linked, sm.getEntries(), storeDir, sm.getSessionId());
  assert.equal(imported.resolved.project.values.commits, "ask");
  assert.deepEqual(imported.task, { kind: "none" });
  appendSessionGitWorkflow(sm, legacy());
  const old = await loadGitWorkflowSettings(repo, sm.getEntries(), storeDir, sm.getSessionId());
  assert.equal(old.task.policy.commits, "agent");
  const document = readGitWorkflowSettingsDocument(storeDir);
  document.global = { commits: "manual" };
  document.projects[repo] = {};
  await saveDocument(document, storeDir);
  const reset = await loadGitWorkflowSettings(linked, sm.getEntries(), storeDir, sm.getSessionId());
  assert.deepEqual(reset.project, {});
  assert.equal(reset.resolved.project.values.commits, "manual");
  assert.equal(reset.resolved.project.origins.commits, "global");
  assert.deepEqual(reset.task, old.task);
});

test("global, project and session default edits leave a persisted task untouched until explicit snapshot apply", async (t) => {
  const { repo, sm, file, storeDir, id } = await fixture(t);
  const initial = settings({ commits: "ask", targetBranch: "main", checks: [check("Original", "npm", "test")] });
  snapshotManagedSessionGitWorkflow(sm, initial);
  const captured = { kind: "managed", settings: initial };
  const load = () => loadGitWorkflowSettings(repo, SessionManager.open(file, undefined).getEntries(), storeDir, id);
  const document = readGitWorkflowSettingsDocument(storeDir);
  document.global = { commits: "manual", checks: [check("Global", "node", "global.mjs")] };
  await saveDocument(document, storeDir);
  assert.deepEqual((await load()).task, captured);
  document.projects[repo] = { commits: "off", targetBranch: null, checks: [] };
  await saveDocument(document, storeDir);
  assert.deepEqual((await load()).task, captured);
  appendManagedSessionGitWorkflow(sm, { commits: "manual", checks: [check("Session", "node", "session.mjs")] }, captured);
  const beforeApply = await load();
  assert.deepEqual(beforeApply.task, captured);
  assert.equal(beforeApply.resolved.session.values.commits, "manual");
  assert.equal(beforeApply.resolved.session.values.targetBranch, null);
  appendManagedSessionGitWorkflow(sm, beforeApply.session, { kind: "managed", settings: beforeApply.resolved.session.values });
  const applied = await load();
  assert.deepEqual(applied.task.settings, beforeApply.resolved.session.values);
  assert.deepEqual(applied.session, beforeApply.session);
  assert.notDeepEqual(applied.task, captured);
});

test("revision binds settings and identity, not unrelated streaming messages", async (t) => {
  const { repo, sm, storeDir, id } = await fixture(t);
  const load = (identity = id) => loadGitWorkflowSettings(repo, sm.getEntries(), storeDir, identity);
  const first = await load();
  assert.match(first.revision, /^[a-f0-9]{64}$/);
  assert.equal((await load()).revision, first.revision);
  assert.notEqual((await load("different-session")).revision, first.revision);
  sm.appendMessage({ role: "user", content: "external edit", timestamp: Date.now() });
  const appended = await load();
  assert.equal(appended.revision, first.revision);
  const document = readGitWorkflowSettingsDocument(storeDir);
  document.paused = true;
  await saveDocument(document, storeDir);
  assert.notEqual((await load()).revision, appended.revision);
});

test("serialized private store updates retain independent fields and release the lock after failure", async (t) => {
  const { repo, storeDir } = await fixture(t);
  let active = 0, peak = 0;
  await Promise.all([
    (doc) => { doc.global.commits = "manual"; },
    (doc) => { doc.projects[repo] = { checks: [] }; },
    (doc) => { doc.paused = true; },
  ].map((change) => withGitWorkflowSettingsLock(storeDir, async () => {
    peak = Math.max(peak, ++active);
    const document = readGitWorkflowSettingsDocument(storeDir);
    await new Promise((resolve) => setTimeout(resolve, 20));
    change(document);
    writeGitWorkflowSettingsDocument(document, storeDir);
    active--;
  })));
  assert.equal(peak, 1);
  const document = readGitWorkflowSettingsDocument(storeDir);
  assert.equal(document.global.commits, "manual");
  assert.deepEqual(document.projects[repo], { checks: [] });
  assert.equal(document.paused, true);
  await assert.rejects(withGitWorkflowSettingsLock(storeDir, async () => { throw new Error("fixture failure"); }), /fixture failure/);
  assert.equal(await withGitWorkflowSettingsLock(storeDir, async () => "released"), "released");
});

test("malformed and future storage blocks resolution without changing the invalid bytes", async (t) => {
  const { repo, storeDir } = await fixture(t);
  const document = readGitWorkflowSettingsDocument(storeDir);
  await saveDocument(document, storeDir);
  const file = gitWorkflowSettingsPath(storeDir);
  for (const raw of ["{", "null", "[]", JSON.stringify({ ...document, version: 2 }),
    JSON.stringify({ ...document, paused: "false" }), JSON.stringify({ ...document, projects: [] }),
    JSON.stringify({ ...document, autoApprove: true }), JSON.stringify({ ...document, global: { commits: "agent" } }),
    JSON.stringify({ ...document, projects: { [repo]: { cleanup: "delete" } } }), " ".repeat(4 * 1024 * 1024 + 1)]) {
    await writeFile(file, raw);
    assert.throws(() => readGitWorkflowSettingsDocument(storeDir));
    await assert.rejects(loadGitWorkflowSettings(repo, [], storeDir));
    assert.equal(await readFile(file, "utf8"), raw);
  }
});
