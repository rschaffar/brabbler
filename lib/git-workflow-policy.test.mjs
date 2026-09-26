import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  GIT_WORKFLOW_TYPE, validLocalBranchName, validateGitWorkflowPolicy,
  MAX_GIT_WORKFLOW_CHECKS, MAX_GIT_WORKFLOW_CHECK_ARGS, MAX_GIT_WORKFLOW_CHECK_LABEL,
  MAX_GIT_WORKFLOW_CHECK_EXECUTABLE, MAX_GIT_WORKFLOW_CHECK_ARG,
  appendSessionGitWorkflow, readSessionGitWorkflow, inheritSessionGitWorkflow,
} = await createJiti(import.meta.url).import("./git-workflow-policy.ts");
const current = { mode: "current", onCreate: "stay", commits: "manual" };
const worktree = { mode: "worktree", baseBranch: "main", onCreate: "fork", commits: "agent",
  integration: { targetBranch: "release/v2", method: "squash" } };
const entry = (data, customType = GIT_WORKFLOW_TYPE) => ({ type: "custom", customType, data });

test("branch names accept local hierarchical refs but reject unsafe refs and paths", () => {
  for (const name of ["main", "feature/a-b_2", "release/v2", "feature/a+b"]) assert.equal(validLocalBranchName(name), true, name);
  for (const name of ["", " ", "-x", "refs/heads/main", "refs/remotes/origin/main", "@", "a//b", "/main", "main/", "a/../b", ".a", "a/.b", "a.lock", "a/b.lock", "a.", "a@{1}", "a:b", "a?", "a*", "a[", "a\\b", "a\nb", "a\0b", "a\u2028b", "a\u00a0b", "a^b", "a~b", "x".repeat(256), null]) {
    assert.equal(validLocalBranchName(name), false, String(name));
  }
});

test("strict modes, combinations and integration; no approvals or unknown fields", () => {
  assert.deepEqual(validateGitWorkflowPolicy(current), current);
  assert.deepEqual(validateGitWorkflowPolicy({ ...current, branch: "feature/a" }), { ...current, branch: "feature/a" });
  assert.deepEqual(validateGitWorkflowPolicy(worktree), worktree);
  for (const invalid of [
    null, [], {}, { ...current, mode: "other" }, { ...worktree, baseBranch: "" },
    { ...current, branch: "a..b" }, { ...current, baseBranch: "main" },
    { ...worktree, branch: "feature/a" }, { ...current, onCreate: "yes" },
    { ...current, commits: "auto" }, { ...current, approved: true },
    { ...worktree, integration: { targetBranch: "main", method: "rebase" } },
    { ...worktree, integration: { targetBranch: "main", method: "ff", autoApprove: true } },
    { ...current, integration: null }, { ...current, integration: { targetBranch: "a.lock", method: "ff" } },
  ]) assert.throws(() => validateGitWorkflowPolicy(invalid), /Invalid Git workflow/);
});

test("optional argv checks are bounded, strict and never interpreted as shell strings", () => {
  const check = { label: "Unit tests", argv: ["npm", "run", "test", "a b", "--", "literal;command"] };
  assert.deepEqual(validateGitWorkflowPolicy({ ...current, checks: [check] }).checks, [check]);
  assert.deepEqual(validateGitWorkflowPolicy({ ...worktree, checks: [] }).checks, []);
  assert.equal(Object.hasOwn(validateGitWorkflowPolicy(current), "checks"), false);
  assert.deepEqual(validateGitWorkflowPolicy({ ...current, checks: Array(MAX_GIT_WORKFLOW_CHECKS).fill(check) }).checks.length, MAX_GIT_WORKFLOW_CHECKS);
  const badChecks = [
    null, "npm test", {}, [null], ["npm test"], [{ ...check, extra: true }],
    [{ label: "", argv: ["npm"] }], [{ label: "a\nb", argv: ["npm"] }], [{ label: "a\u2028b", argv: ["npm"] }],
    [{ label: "x".repeat(MAX_GIT_WORKFLOW_CHECK_LABEL + 1), argv: ["npm"] }],
    [{ label: "ok", argv: [] }], [{ label: "ok", argv: "npm test" }],
    Array(MAX_GIT_WORKFLOW_CHECKS + 1).fill(check),
    [{ label: "ok", argv: ["npm", ...Array(MAX_GIT_WORKFLOW_CHECK_ARGS + 1).fill("x")] }],
    ...[["sh", "-c", "echo ok"], ["/bin/bash", "-lc", "echo ok"], ["cmd.exe", "/c", "echo ok"],
      ["pwsh", "-Command", "echo ok"]].map((argv) => [{ label: "ok", argv }]),
    ...["", " ", "npm\0x", "npm\nrun", "npm\rtest", "npm\ttest", "npm\x7ftest", "npm\u2028test",
      "x".repeat(MAX_GIT_WORKFLOW_CHECK_EXECUTABLE + 1), "https://host/path", "www.example.org",
      "--token=abc", "TOKEN=secret", "Bearer credential", "ghp_abcdefghijklmno", "git@github.com:org/repo"].map((arg) => [{ label: "ok", argv: [arg] }]),
    ...["", " ", "a\0b", "a\nb", "a\rb", "a\tb", "x".repeat(MAX_GIT_WORKFLOW_CHECK_ARG + 1),
      "--api-key=hidden", "--password", "https://example.com", "git+ssh://host", "sk-abcdefghijklmno"].map((arg) => [{ label: "ok", argv: ["npm", arg] }]),
  ];
  for (const checks of badChecks) assert.throws(() => validateGitWorkflowPolicy({ ...current, checks }), /Invalid Git workflow check/, JSON.stringify(checks));
});

test("checks snapshot, read and fork inheritance use independent argv copies", () => {
  const check = { label: "Tests", argv: ["npm", "test"] };
  const policy = { ...worktree, checks: [check] };
  const entries = [];
  const manager = { appendCustomEntry: (type, data) => entries.push(entry(data, type)) };
  appendSessionGitWorkflow(manager, policy);
  check.argv[1] = "changed";
  policy.checks.push({ label: "extra", argv: ["false"] });
  assert.deepEqual(readSessionGitWorkflow(entries).checks, [{ label: "Tests", argv: ["npm", "test"] }]);
  const read = readSessionGitWorkflow(entries);
  read.checks[0].argv[1] = "mutated";
  assert.equal(readSessionGitWorkflow(entries).checks[0].argv[1], "test");
  const fork = [];
  inheritSessionGitWorkflow(entries, { appendCustomEntry: (type, data) => fork.push(entry(data, type)) });
  assert.deepEqual(readSessionGitWorkflow(fork).checks, [{ label: "Tests", argv: ["npm", "test"] }]);
  fork[0].data.policy.checks[0].argv[1] = "fork-only";
  assert.equal(readSessionGitWorkflow(entries).checks[0].argv[1], "test");
  entries.push(entry({ version: 1, policy: { ...current, checks: [{ label: "bad", argv: ["a\nb"] }] } }));
  assert.equal(readSessionGitWorkflow(entries).checks[0].argv[1], "test");
});

test("latest valid versioned session entry wins, including explicit opt-out", () => {
  assert.equal(readSessionGitWorkflow([]), undefined);
  const entries = [entry({ version: 1, policy: current })];
  entries.push(entry({ version: 1, policy: worktree }, "unrelated"));
  entries.push(entry({ version: 2, policy: worktree }));
  entries.push(entry({ version: 1, policy: { ...current, push: true } }));
  entries.push(entry({ version: 1, policy: worktree, approved: true }));
  entries.push(entry({ version: 1, policy: { ...current, branch: "a..b" } }));
  assert.deepEqual(readSessionGitWorkflow(entries), current);
  entries.push(entry({ version: 1, policy: null }));
  assert.equal(readSessionGitWorkflow(entries), null);
  entries.push(entry({ version: 1, policy: worktree }));
  assert.deepEqual(readSessionGitWorkflow(entries), worktree);
});

test("append validates and copies snapshots; fork inherits even an opt-out", () => {
  const entries = [];
  const manager = { appendCustomEntry: (customType, data) => entries.push(entry(data, customType)) };
  appendSessionGitWorkflow(manager, worktree);
  assert.deepEqual(entries[0].data, { version: 1, policy: worktree });
  worktree.integration.method = "merge";
  assert.equal(readSessionGitWorkflow(entries).integration.method, "squash");
  assert.throws(() => appendSessionGitWorkflow(manager, { ...current, approved: true }));
  const fork = [];
  inheritSessionGitWorkflow(entries, { appendCustomEntry: (type, data) => fork.push(entry(data, type)) });
  assert.deepEqual(readSessionGitWorkflow(fork), readSessionGitWorkflow(entries));
  inheritSessionGitWorkflow([entry({ version: 1, policy: null })], manager);
  assert.equal(readSessionGitWorkflow(entries), null);
  const count = entries.length;
  inheritSessionGitWorkflow([], manager);
  assert.equal(entries.length, count);
});
