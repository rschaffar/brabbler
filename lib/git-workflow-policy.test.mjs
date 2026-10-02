import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
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

test("check labels, executables and every argument obey UTF-8 byte boundaries", () => {
  const bounds = [
    { max: MAX_GIT_WORKFLOW_CHECK_LABEL, check: (text) => ({ label: text, argv: ["npm", "test"] }) },
    { max: MAX_GIT_WORKFLOW_CHECK_EXECUTABLE, check: (text) => ({ label: "Executable", argv: [text] }) },
    { max: MAX_GIT_WORKFLOW_CHECK_ARG, check: (text) => ({ label: "Argument", argv: ["npm", text, "test"] }) },
    { max: MAX_GIT_WORKFLOW_CHECK_ARG, check: (text) => ({ label: "Last argument", argv: ["npm", "test", text] }) },
  ];
  // Include supplementary characters and unpaired surrogates: TextEncoder and
  // the journal's Buffer.byteLength must agree even on replacement encoding.
  for (const char of ["x", "é", "界", "😀", "\ud800", "\udc00"]) {
    for (const { max, check } of bounds) {
      const width = Buffer.byteLength(char, "utf8");
      const boundary = char.repeat(Math.floor(max / width)) + "x".repeat(max % width);
      assert.equal(Buffer.byteLength(boundary, "utf8"), max);
      assert.deepEqual(validateGitWorkflowPolicy({ ...current, checks: [check(boundary)] }).checks, [check(boundary)]);
      assert.throws(() => validateGitWorkflowPolicy({ ...current, checks: [check(boundary + "x")] }), /Invalid Git workflow check/);
    }
  }
  assert.throws(() => validateGitWorkflowPolicy({ ...current, checks: [{ label: "é".repeat(41), argv: ["npm", "test"] }] }), /Invalid Git workflow check/);
});

test("policy-accepted multibyte boundaries also fit the unchanged journal string guards", async (t) => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "policy-check-journal-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const { createGitAction, releaseGitAction } = await createJiti(import.meta.url).import("./git-action-journal.ts");
  const checks = validateGitWorkflowPolicy({ ...current, checks: [{
    label: "é".repeat(MAX_GIT_WORKFLOW_CHECK_LABEL / 2),
    argv: ["😀".repeat(MAX_GIT_WORKFLOW_CHECK_EXECUTABLE / 4), "é".repeat(MAX_GIT_WORKFLOW_CHECK_ARG / 2)],
  }] }).checks;
  const candidate = { kind: "checks", repositoryRoot: agentDir, checks };
  const action = await createGitAction({ sessionId: "byte-boundary-test", source: "agent", candidate }, agentDir);
  try {
    assert.deepEqual(action.summary.checks, checks);
    const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
      : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
        : JSON.stringify(value);
    const expected = canonical({ version: 1, candidate });
    const bytes = await readFile(path.join(agentDir, "pi-web", "git-actions", "v1", action.id, "candidate.json"));
    assert.equal(bytes.toString(), expected, "old artifact has exactly the old fields and canonical bytes");
    assert.equal(action.artifact.sha256, createHash("sha256").update(expected).digest("hex"));
  }
  finally { releaseGitAction(action.id, agentDir); }
});

test("policy and v1 session extended recipes preserve omission and deep-copy env through inheritance", () => {
  const checks = [{ label: "Old", argv: ["npm", "test"] }, { label: "Extended", argv: ["node", "check.mjs"],
    cwd: "checks", env: { CI: "1" }, requiredStage: "commit" }];
  const policy = { ...current, checks };
  const entries = [];
  appendSessionGitWorkflow({ appendCustomEntry: (type, data) => entries.push(entry(data, type)) }, policy);
  assert.equal(JSON.stringify(readSessionGitWorkflow(entries)), JSON.stringify(policy));
  checks[1].env.CI = "input-only";
  assert.equal(readSessionGitWorkflow(entries).checks[1].env.CI, "1");
  const fork = [];
  inheritSessionGitWorkflow(entries, { appendCustomEntry: (type, data) => fork.push(entry(data, type)) });
  assert.deepEqual(fork[0], entries[0]);
  fork[0].data.policy.checks[1].env.CI = "fork-only";
  assert.equal(readSessionGitWorkflow(entries).checks[1].env.CI, "1");
  assert.deepEqual(Object.keys(readSessionGitWorkflow(entries).checks[0]), ["label", "argv"]);
  for (const extra of [{ cwd: "../bad" }, { env: { GIT_DIR: "bad" } }, { requiredStage: "all" }, { approval: true }]) {
    assert.throws(() => validateGitWorkflowPolicy({ ...current, checks: [{ ...checks[1], ...extra }] }));
  }
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

test("legacy snapshots and opt-out; an unsupported newer record never revives old consent", () => {
  assert.equal(readSessionGitWorkflow([]), undefined);
  const entries = [entry({ version: 1, policy: current })];
  entries.push(entry({ version: 1, policy: worktree }, "unrelated"));
  entries.push(entry({ version: 2, policy: worktree }));
  entries.push(entry({ version: 1, policy: { ...current, push: true } }));
  entries.push(entry({ version: 1, policy: worktree, approved: true }));
  entries.push(entry({ version: 1, policy: { ...current, branch: "a..b" } }));
  assert.equal(readSessionGitWorkflow(entries), null);
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
