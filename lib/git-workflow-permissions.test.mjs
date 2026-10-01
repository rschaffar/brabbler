import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { managedGitPermission, managedGitPermissions, selectedProjectCommitEligibility, gitCommitModePermission, MANAGED_GIT_STAGES } = await jiti.import("./git-workflow-permissions.ts");
const { resolveGitWorkflowSettings, DEFAULT_GIT_WORKFLOW_SETTINGS, validateGitWorkflowOverrides } = await jiti.import("./git-workflow-settings.ts");
const coding = { subagent: false, tools: ["read", "edit"] };
function state({ global = {}, project = {}, session = {}, task = {}, ...rest } = {}) {
  return { revision: "fixture", paused: false, global, project, session,
    resolved: { global: resolveGitWorkflowSettings(global), project: resolveGitWorkflowSettings(global, project), session: resolveGitWorkflowSettings(global, project, session) },
    task: { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, workspace: "worktree", baseBranch: "local-base",
      targetBranch: "local-target", checks: [{ label: "Check", argv: ["node", "check.mjs"] }], ...task } }, ...rest };
}

test("commit truth table: Off/Manual/Ask/unsupported Automatic, with no preference granting execution", () => {
  for (const [mode, agent, human] of [
    ["off", "blocked", "blocked"], ["manual", "blocked", "confirmation-required"],
    ["ask", "confirmation-required", "confirmation-required"], ["automatic", "blocked", "blocked"],
  ]) {
    assert.equal(gitCommitModePermission(mode, "agent").kind, agent, mode);
    assert.equal(gitCommitModePermission(mode, "human").kind, human, mode);
    assert.equal(managedGitPermission(state({ task: { commits: mode } }), coding, "commit", "agent").kind, agent);
    assert.equal(managedGitPermission(state({ task: { commits: mode } }), coding, "commit", "human").kind, human);
  }
  assert.equal(gitCommitModePermission("automatic", "agent").code, "automatic-unavailable");
  assert.throws(() => validateGitWorkflowOverrides({ commits: "automatic" }), /Invalid workflow setting/);
  for (const invalid of [undefined, null, "agent", "AUTO", { approved: true }]) assert.equal(gitCommitModePermission(invalid, "agent").kind, "blocked");
});

test("origins are preferences, not authority; every scope has the same captured-mode decisions", () => {
  for (const scope of ["global", "project", "session"]) for (const mode of ["off", "manual", "ask"]) {
    const s = state({ [scope]: { commits: mode }, task: { commits: mode } });
    assert.equal(s.resolved.session.origins.commits, scope);
    const summary = managedGitPermissions(s, coding);
    assert.equal(summary.agent.commit.kind, mode === "ask" ? "confirmation-required" : "blocked");
    assert.equal(summary.human.commit.kind, mode === "off" ? "blocked" : "confirmation-required");
    assert.equal(summary.legacyAgentCommitConsent, false);
  }
});

test("defaults never upgrade captured tasks, while effective Off and Pause are live", () => {
  const s = state({ global: { commits: "ask" }, task: { commits: "manual" } });
  assert.equal(managedGitPermission(s, coding, "commit", "agent").code, "manual-commits");
  const ask = state({ global: { commits: "manual" }, task: { commits: "ask" } });
  assert.equal(managedGitPermission(ask, coding, "commit", "agent").kind, "confirmation-required", "Manual is a later-task choice until adoption");
  const off = state({ project: { commits: "off" }, task: { commits: "ask" } });
  for (const actor of ["agent", "human"]) assert.equal(managedGitPermission(off, coding, "commit", actor).code, "session-commits-off");
  const enabled = state({ global: { enabled: false }, session: { enabled: true } });
  assert.equal(managedGitPermission(enabled, coding, "commit", "agent").kind, "confirmation-required");
  enabled.paused = true;
  for (const actor of ["agent", "human"]) for (const stage of MANAGED_GIT_STAGES) assert.equal(managedGitPermission(enabled, coding, stage, actor).code, "paused");
  for (const actor of ["agent", "human"]) {
    assert.equal(managedGitPermission(state({ global: { enabled: false } }), coding, "commit", actor).code, "disabled");
    assert.equal(managedGitPermission(state({ task: { enabled: false } }), coding, "commit", actor).code, "task-disabled");
  }
});

test("Chat-only, read-only, unknown active tools and subagents never acquire agent mutation permission", () => {
  for (const tools of [[], ["read", "grep", "find", "ls", "git_commit", "git_workflow"], undefined]) {
    const facts = { subagent: false, tools };
    const summary = managedGitPermissions(state(), facts);
    for (const stage of MANAGED_GIT_STAGES) {
      assert.equal(summary.agent[stage].code, tools ? "read-only" : "unknown-tools");
      assert.notEqual(summary.human[stage].kind, "blocked", "Explicit human actions are not agent tool execution");
    }
  }
  for (const tools of [["bash"], ["powershell"], ["edit"], ["write"]]) {
    assert.equal(managedGitPermission(state(), { subagent: false, tools }, "commit", "agent").kind, "confirmation-required");
  }
  for (const actor of ["agent", "human"]) for (const stage of MANAGED_GIT_STAGES) {
    assert.equal(managedGitPermission(state(), { ...coding, subagent: true }, stage, actor).code, "subagent");
  }
});

test("captured setup and unsupported methods cannot be supplied by an approval flag or newer defaults", () => {
  const cases = [
    [{ workspace: "current" }, "workspace", "not-worktree-task"],
    [{ baseBranch: null }, "workspace", "missing-worktree-base"],
    [{ targetBranch: null }, "integration", "missing-integration-setup"],
    [{ checks: [] }, "checks", "missing-integration-setup"],
    [{ method: "ff" }, "integration", "missing-integration-setup"],
    [{ method: "squash" }, "checks", "missing-integration-setup"],
  ];
  for (const [task, stage, code] of cases) for (const actor of ["agent", "human"]) {
    const s = state({ task, approved: true, grant: { source: "human", actions: [stage] } });
    assert.equal(managedGitPermission(s, coding, stage, actor).code, code);
  }
  assert.equal(managedGitPermission(state(), coding, "remote", "agent").code, "unsupported-stage");
});

test("selected-project commits use live selected policy, not a captured task or confirmation preference as consent", () => {
  const eligible = state({ global: { enabled: false }, project: { enabled: true }, task: { commits: "off" },
    session: { commitConfirmation: "none", commits: "ask" } });
  eligible.sessionScope = "project";
  assert.equal(selectedProjectCommitEligibility(eligible, coding, "agent").kind, "confirmation-required",
    "a selected project's exact candidate still needs authorization despite a captured task Off and confirmation:none");
  assert.equal(selectedProjectCommitEligibility(state({ project: { commits: "off" }, session: { commits: "ask" } }), coding, "agent").code, "session-commits-off");
  assert.equal(selectedProjectCommitEligibility(state({ project: { commits: "manual" }, session: { commits: "ask" } }), coding, "agent").code, "manual-commits");
  assert.equal(selectedProjectCommitEligibility(state({ global: { commits: "manual" }, session: { commits: "ask" } }), coding, "agent").kind, "confirmation-required",
    "a Global preference is not an explicit Project restriction");
  assert.equal(selectedProjectCommitEligibility(state({ project: { commits: "manual" } }), coding, "human").kind, "confirmation-required");
  assert.equal(selectedProjectCommitEligibility(state({ session: { enabled: false } }), coding, "agent").code, "disabled");
  assert.equal(selectedProjectCommitEligibility(state({ paused: true }), coding, "agent").code, "paused");
  for (const facts of [{ subagent: true, tools: ["edit"] }, { subagent: false }, { subagent: false, tools: ["read"] }]) {
    assert.equal(selectedProjectCommitEligibility(state(), facts, "agent").kind, "blocked");
  }
});

test("legacy consent is separately labelled, never manufactured from new task settings or defaults", () => {
  const s = state();
  s.task = { kind: "legacy", policy: { mode: "current", onCreate: "stay", commits: "agent" } };
  assert.equal(managedGitPermissions(s, coding).legacyAgentCommitConsent, true);
  assert.equal(managedGitPermissions(s, coding).agent.commit.kind, "confirmation-required", "the common interactive operation still asks");
  assert.equal(managedGitPermissions(s, coding).agent.workspace.code, "missing-legacy-worktree-policy");
  s.task.policy = { ...s.task.policy, mode: "worktree", baseBranch: "base" };
  assert.equal(managedGitPermissions(s, coding).agent.workspace.kind, "legacy-consent", "legacy start has no new approval prompt");
  assert.equal(managedGitPermissions(s, coding).human.workspace.kind, "confirmation-required");
  assert.equal(managedGitPermissions(s, { subagent: false, tools: [] }).legacyAgentCommitConsent, false);
  s.paused = true;
  assert.equal(managedGitPermissions(s, coding).legacyAgentCommitConsent, false);
  s.paused = false;
  for (const task of [{ kind: "none" }, { kind: "legacy", policy: null }, state().task]) {
    s.task = task;
    assert.equal(managedGitPermissions(s, coding).legacyAgentCommitConsent, false);
  }
});
