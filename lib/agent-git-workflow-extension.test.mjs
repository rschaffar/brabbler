import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";

const historyDir = await mkdtemp(path.join(os.tmpdir(), "agent-action-history-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = historyDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(historyDir, { recursive: true, force: true });
});
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { interopDefault: false });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const managers = new Map();
function sessionFixture(cwd, entries = []) {
  const persisted = SessionManager.create(cwd, path.join(historyDir, "sessions"));
  persisted.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
  persisted.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const id = persisted.getSessionId();
  const manager = { getSessionId: () => id, getSessionFile: () => persisted.getSessionFile(), getCwd: () => cwd, getHeader: () => ({ id, cwd }),
    getEntries: () => entries, isPersisted: () => true, appendCustomEntry: (customType, data) => {
      const entryId = randomUUID();
      entries.push({ id: entryId, parentId: entries.at(-1)?.id ?? null, timestamp: new Date().toISOString(), type: "custom", customType, data });
      return entryId;
    } };
  managers.set(cwd, manager);
  return manager;
}
const managerFor = (cwd) => managers.get(cwd) ?? sessionFixture(cwd);
const appendFor = (cwd) => (type, data) => managerFor(cwd).appendCustomEntry(type, data);
const exec = promisify(execFile);
// Keep named exports live for scoped fault injection; jiti's default interop
// proxy caches property reads and would conceal or retain mocked dependencies.
const { createAgentGitWorkflowExtension } = await jiti.import("./agent-git-workflow-extension.ts");
const fileAccess = await jiti.import("./file-access.ts");
const { allowFileRoot } = fileAccess;
const { isGitCheckoutGated } = await jiti.import("./git-checkout-gate.ts");
const access = await jiti.import("./git-workflow-access.ts");
const selector = await jiti.import("./git-workspace-selector.ts");
const trust = await jiti.import("./project-trust.ts");
const rpc = await jiti.import("./rpc-manager.ts");
const actions = await jiti.import("./git-action-controller.ts");
const verification = await jiti.import("./git-verification.ts");
const runRealVerification = verification.runGitVerification;
function testVerification(t) {
  const backend = createTestContainmentBackend();
  t.mock.method(verification, "runGitVerification", (options) =>
    runRealVerification({ ...options, testContainmentBackend: backend }));
}
const integration = await jiti.import("./git-integration.ts");
const { readGitAction } = await jiti.import("./git-action-journal.ts");
const { beginGitOperationIntent } = await jiti.import("./git-operation-admission.ts");
const { appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { resolveGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");

function forbidExecution(t) {
  const spies = [
    t.mock.method(verification, "runGitVerification", () => { throw new Error("Unexpected verification"); }),
    t.mock.method(integration, "prepareIntegration", () => { throw new Error("Unexpected integration preparation"); }),
    t.mock.method(integration, "confirmIntegration", () => { throw new Error("Unexpected integration"); }),
  ];
  return () => spies.forEach((spy) => assert.equal(spy.mock.callCount(), 0, "No verification or integration after refusal"));
}
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();
async function fixture(t) {
  // Direct tool invocation has no SDK wrapper/tool event. RPC coordination is
  // covered separately; these tests exercise the action's policy and preview.
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-git-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await git(dir, "init", "-q", "-b", "target");
  allowFileRoot(dir);
  await git(dir, "config", "user.name", "Test");
  await git(dir, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(dir, "a"), "first\n");
  await git(dir, "add", "a");
  await git(dir, "commit", "-qm", "initial");
  let tool;
  createAgentGitWorkflowExtension(dir).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(dir), registerTool: (value) => { tool = value; } });
  return { dir, tool };
}
const context = (cwd, gitAction) => ({ cwd, hasUI: true, sessionManager: managerFor(cwd), ui: { gitAction } });

test("agent commit is human-bound even without a saved policy", async (t) => {
  const { dir, tool } = await fixture(t);
  await writeFile(path.join(dir, "a"), "changed\n");
  const original = await git(dir, "rev-parse", "HEAD");
  let shown;
  const params = { operation: "commit", paths: ["a"], message: "Exact message" };
  const refused = await tool.execute("call", params, undefined, undefined, context(dir, async (candidate) => {
    shown = candidate;
    return false;
  }));
  assert.equal(refused.details.approved, false);
  assert.equal(await git(dir, "rev-parse", "HEAD"), original);
  assert.equal(shown.kind, "commit");
  assert.equal(shown.preview.head, original);
  assert.deepEqual(shown.preview.paths, ["a"]);
  assert.match(shown.diff.patch, /\+changed/);
  assert.equal(shown.message, "Exact message");
  const approved = await tool.execute("call", params, undefined, undefined, context(dir, async () => true));
  assert.equal(approved.details.status, "committed");
  assert.deepEqual(approved.details.parents, [original]);
  assert.equal(await git(dir, "show", "-s", "--format=%s", "HEAD"), "Exact message");
});

test("changed candidate after approval fails closed; no implicit retry", async (t) => {
  const { dir, tool } = await fixture(t);
  await writeFile(path.join(dir, "a"), "changed\n");
  const original = await git(dir, "rev-parse", "HEAD");
  const response = await tool.execute("call", { operation: "commit", paths: ["a"], message: "Approve" }, undefined, undefined,
    context(dir, async () => { await writeFile(path.join(dir, "a"), "changed again\n"); return true; }));
  assert.equal(response.isError, true);
  assert.equal(await git(dir, "rev-parse", "HEAD"), original);
});

test("generic merge and individual comparison are read-only without policy", async (t) => {
  const { dir, tool } = await fixture(t);
  await git(dir, "checkout", "-qb", "feature");
  await writeFile(path.join(dir, "a"), "changed\n");
  await git(dir, "add", "a");
  await git(dir, "commit", "-qm", "one");
  const featureOid = await git(dir, "rev-parse", "HEAD");
  const candidates = [];
  const ui = context(dir, async (candidate) => { candidates.push(candidate); return true; });
  await tool.execute("call", { operation: "review", targetBranch: "target" }, undefined, undefined, ui);
  await tool.execute("call", { operation: "review", targetBranch: "target", commitOids: [featureOid] }, undefined, undefined, ui);
  assert.deepEqual(candidates.map((item) => item.selection.kind), ["merge", "commits"]);
  assert.equal(candidates[0].review.featureOid, featureOid);
  assert.match(candidates[0].diff.patch, /\+changed/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), featureOid);
  assert.equal(await git(dir, "rev-parse", "target"), candidates[0].review.targetOid);
});

async function integrationFixture(t) {
  // Direct tool invocation has no registered SDK tool event; the RPC gate's
  // exact-ID and sibling semantics have dedicated tests.
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-merge-"));
  t.after(async () => {
    // Corrupt/uncertain test actions cannot contaminate later temporary repos.
    for (const cwd of [feature, target]) {
      for (const entry of managerFor(cwd).getEntries()) {
        if (entry.customType === "pi-web:git-action") {
          await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
        }
      }
    }
    await rm(home, { recursive: true, force: true });
  });
  // The journal and admission ledger must share the same private agent root.
  const target = path.join(home, "target"), feature = path.join(home, "feature"), agentDir = historyDir;
  await git(home, "init", "-q", "-b", "target", target);
  await git(target, "config", "core.autocrlf", "false");
  await git(target, "config", "user.name", "Test");
  await git(target, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(target, "a"), "base\n");
  await git(target, "add", "a"); await git(target, "commit", "-qm", "base");
  await git(target, "worktree", "add", "-qb", "feature", feature);
  await writeFile(path.join(feature, "a"), "feature\n");
  await git(feature, "add", "a"); await git(feature, "commit", "-qm", "feature");
  allowFileRoot(home);
  let tool;
  createAgentGitWorkflowExtension(feature, agentDir).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(feature), registerTool: (value) => { tool = value; } });
  const checks = [{ label: "node succeeds", argv: [process.execPath, "-e", "process.exit(0)"] }];
  const params = { operation: "integrate", targetBranch: "target", checks };
  const run = (ui, signal) => tool.execute("call", params, signal, undefined, {
    cwd: feature, hasUI: true, sessionManager: managerFor(feature), ui: { gitAction: ui },
  });
  return { home, feature, target, agentDir, params, run };
}

test("unresolved integration intent blocks agent check approval before any executable action", async (t) => {
  const f = await integrationFixture(t);
  const noExecution = forbidExecution(t);
  const common = await git(f.feature, "rev-parse", "--path-format=absolute", "--git-common-dir");
  beginGitOperationIntent(f.agentDir, common, randomUUID(), "integration");
  let prompted = false;
  const result = await f.run(async () => { prompted = true; return true; });
  assert.equal(prompted, false);
  assert.equal(result.isError, true);
  assert.equal(result.details.phase, "admission");
  assert.equal(result.details.checksStarted, false);
  noExecution();
});

test("captured managed target/check changes during check approval invalidate the old policy before verification", async (t) => {
  const f = await integrationFixture(t);
  const noExecution = forbidExecution(t);
  const manager = managerFor(f.feature);
  const saved = resolveGitWorkflowSettings({ workspace: "current", targetBranch: "target", checks: f.params.checks }).values;
  appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: saved });
  const before = [await git(f.feature, "rev-parse", "HEAD"), await git(f.target, "rev-parse", "HEAD")];
  let prompted = 0;
  const result = await f.run(async (candidate) => {
    prompted++;
    assert.equal(candidate.kind, "checks");
    appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: { ...saved,
      checks: [{ label: "Changed", argv: [process.execPath, "-e", "process.exit(0)"] }] } });
    return true;
  });
  assert.equal(prompted, 1);
  assert.equal(result.isError, true);
  assert.match(result.details.error, /Captured integration settings changed/);
  assert.deepEqual([await git(f.feature, "rev-parse", "HEAD"), await git(f.target, "rev-parse", "HEAD")], before);
  noExecution();
});

test("adopting a managed task during a legacy check approval cannot replay old target or checks", async (t) => {
  const f = await integrationFixture(t);
  const noExecution = forbidExecution(t);
  const oldTarget = await git(f.target, "rev-parse", "HEAD");
  let prompted = 0;
  const result = await f.run(async (candidate) => {
    prompted++;
    assert.equal(candidate.kind, "checks");
    appendManagedSessionGitWorkflow(managerFor(f.feature), {}, { kind: "managed", settings: resolveGitWorkflowSettings({
      workspace: "current", targetBranch: "target", checks: [{ label: "New", argv: [process.execPath, "-e", "process.exit(0)"] }],
    }).values });
    return true;
  });
  assert.equal(prompted, 1);
  assert.equal(result.isError, true);
  assert.match(result.details.error, /Captured integration settings changed/);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), oldTarget);
  noExecution();
});

test("primary caller declines checks with isolated trust while another session targets either checkout", async (t) => {
  const f = await integrationFixture(t);
  const noExecution = forbidExecution(t);
  const checks = [
    { label: "Unit tests", argv: ["npm", "test"] },
    { label: "Typecheck", argv: ["node_modules/.bin/tsc", "--noEmit"] },
    { label: "Lint", argv: ["npm", "run", "lint"] },
    { label: "Git workflow browser tests", argv: ["nix", "develop", "--offline", "path:.", "-c", "env", "E2E_GIT_WORKFLOW_ONLY=1", "npm", "run", "test:e2e"] },
  ];
  const caller = managerFor(f.target);
  const previous = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = previous; });
  let otherCwd = f.feature, otherRunning = false;
  const self = { sessionId: caller.getSessionId(), cwd: f.target, isRunning: () => true };
  const other = { sessionId: "other", get cwd() { return otherCwd; }, isRunning: () => otherRunning };
  globalThis.__piSessions = new Map([[self.sessionId, self], [other.sessionId, other]]);
  let tool;
  createAgentGitWorkflowExtension(f.target, f.agentDir).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: caller.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const cards = [];
  const ctx = context(f.target, async (candidate) => {
    cards.push(candidate);
    assert.equal(isGitCheckoutGated(f.feature), false);
    assert.equal(isGitCheckoutGated(f.target), false);
    return false; // Never authorize these real commands or an integration.
  });
  const run = () => tool.execute("decline", { operation: "integrate", workspaceBranch: "feature", targetBranch: "target", checks }, undefined, undefined, ctx);
  const before = await Promise.all([f.target, f.feature].map((cwd) => git(cwd, "rev-parse", "HEAD")));
  // Empty extension directories require trust but do not dirty either checkout
  // or load executable resources. All trust writes use this fixture's agentDir.
  for (const cwd of [f.target, f.feature]) {
    await mkdir(path.join(cwd, ".pi", "extensions"), { recursive: true });
    assert.equal(await git(cwd, "status", "--porcelain"), "");
    assert.deepEqual(trust.getProjectTrustStatus(cwd, f.agentDir), { requiresTrust: true, trusted: false });
  }
  assert.match((await run()).details.error, /Trust both registered checkouts/);
  trust.trustProject(f.feature, f.agentDir);
  assert.match((await run()).details.error, /Trust both registered checkouts/);
  trust.trustProject(f.target, f.agentDir);
  otherRunning = true;
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => { throw new Error("session activity must not be consulted"); });
  const result = await run();
  assert.equal(result.details.approved, false, JSON.stringify(result));
  assert.match(result.content[0].text, /no checks or integration executed/);
  assert.equal(cards.length, 1, "Only check approval is requested despite another active session");
  assert.equal(cards[0].kind, "checks");
  assert.equal(cards[0].featureCwd, f.feature);
  assert.equal(cards[0].targetCwd, f.target);
  assert.equal(cards[0].featureBranch, "feature");
  assert.equal(cards[0].targetBranch, "target");
  assert.deepEqual(cards[0].checks, checks);
  const { record } = await readGitAction(result.details.actionId);
  assert.equal(record.sessionId, caller.getSessionId());
  assert.equal(record.state, "declined");
  assert.equal(record.decision, "declined");
  assert.equal(record.outcome, undefined);
  assert.equal(caller.getCwd(), f.target);
  assert.deepEqual(await Promise.all([f.target, f.feature].map((cwd) => git(cwd, "rev-parse", "HEAD"))), before);
  for (otherCwd of [f.feature, f.target]) {
    const competingChat = await run();
    assert.equal(competingChat.details.approved, false, "another active session targeting either checkout must not block review");
  }
  assert.equal(cards.length, 3);
  for (const cwd of [f.target, f.feature]) assert.equal(await git(cwd, "status", "--porcelain"), "");
  noExecution();
});

test("unexpected pre-approval failures report only an allowlisted phase and never ask or execute", async (t) => {
  const cases = [
    { name: "permission lookup throws synchronously", phase: "permission", install: (t, f, fail) => t.mock.method(access, "assertManagedGitAction", fail) },
    { name: "managed workspace guard rejects", phase: "permission", install: (t, f, fail) => t.mock.method(access, "assertManagedGitWorkspace", async () => fail()) },
    { name: "workspace selection rejects", phase: "workspace", install: (t, f, fail) => t.mock.method(selector, "selectGitWorkspace", async () => fail()) },
    { name: "caller header throws", phase: "caller", install: (t, f, fail) => t.mock.method(managerFor(f.feature), "getHeader", fail) },
    // With an omitted workspaceBranch, the first allowed-roots lookup is inside targetCheckout.
    { name: "target roots throw synchronously", phase: "target", install: (t, f, fail) => t.mock.method(fileAccess, "getAllowedFileRoots", fail) },
    { name: "target roots reject", phase: "target", install: (t, f, fail) => t.mock.method(fileAccess, "getAllowedFileRoots", async () => fail()) },
    { name: "trust lookup throws synchronously", phase: "trust", install: (t, f, fail) => t.mock.method(trust, "getProjectTrustStatus", fail) },
    { name: "dynamic trust status getter throws", phase: "trust", install: (t, f, fail) => t.mock.method(trust, "getProjectTrustStatus", () => ({ get trusted() { return fail(); } })) },
    { name: "journal sink throws", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "gitActionSink", fail) },
    { name: "candidate snapshot throws", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "snapshotGitActionCandidate", fail) },
    { name: "journal creation throws synchronously", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "beginGitAction", fail) },
    { name: "journal creation rejects", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "beginGitAction", async () => fail()) },
    { name: "transcript anchor throws", phase: "journal", install: (t, f, fail) => t.mock.method(managerFor(f.feature), "appendCustomEntry", fail) },
    { name: "awaiting-decision journal update rejects", phase: "journal", install: (t, f, fail) => {
      const begin = actions.beginGitAction;
      t.mock.method(actions, "beginGitAction", async (...args) => {
        const handle = await begin(...args), update = handle.update;
        t.mock.method(handle, "update", async (state, ...rest) => state === "awaiting-decision" ? fail() : update(state, ...rest));
        return handle;
      });
    } },
  ];
  for (const { name, phase, install } of cases) await t.test(name, async (t) => {
    const f = await integrationFixture(t);
    const noExecution = forbidExecution(t);
    const before = await git(f.target, "rev-parse", "HEAD");
    f.params.checks = [{ label: "PRIVATE_LABEL_SENTINEL", argv: ["npm", "PRIVATE_ARGV_SENTINEL"] }];
    let failures = 0, prompts = 0;
    install(t, f, () => {
      failures++;
      throw Object.assign(new TypeError("PRIVATE_ERROR_SENTINEL"), { stderr: "PRIVATE_STDERR_SENTINEL", trust: "PRIVATE_TRUST_SENTINEL" });
    });
    const result = await f.run(() => { prompts++; return false; });
    assert.equal(failures, 1, "The intended dynamic or synchronous failure was reached");
    assert.equal(result.isError, true);
    assert.equal(result.details.code, "integration-preapproval-failed");
    assert.equal(result.details.phase, phase);
    assert.equal(result.details.checkApprovalRequested, false);
    assert.equal(result.details.checksStarted, false);
    assert.equal(result.details.integrationStarted, false);
    assert.match(result.content[0].text, /Inspect /);
    assert.match(result.content[0].text, /Check approval was not requested; no checks or merge were executed/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|unavailable or stale|TypeError|stack/);
    assert.equal(prompts, 0);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), before);
    assert.equal(isGitCheckoutGated(f.feature), false);
    assert.equal(isGitCheckoutGated(f.target), false);
    noExecution();
  });
});

test("malformed checks (including byte overflow) and typed permission denials still refuse before approval", async (t) => {
  const f = await integrationFixture(t);
  const noExecution = forbidExecution(t);
  let prompts = 0;
  const ask = () => { prompts++; return false; };
  for (const check of [
    { label: "shell", argv: ["sh", "-c", "PRIVATE_ARGV_SENTINEL"] },
    { label: "é".repeat(41), argv: ["npm", "test"] },
    { label: "executable", argv: ["é".repeat(129)] },
    { label: "argument", argv: ["npm", "é".repeat(257)] },
  ]) {
    f.params.checks = [check];
    const result = await f.run(ask);
    assert.equal(result.isError, true);
    assert.equal(result.details.phase, "checks");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|é/);
  }
  f.params.checks = [{ label: "valid", argv: ["npm", "test"] }];
  t.mock.method(access, "assertManagedGitAction", () => { throw new access.ManagedGitAccessError("Existing managed permission denial"); });
  const result = await f.run(ask);
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { error: "Existing managed permission denial" });
  assert.equal(result.content[0].text, "Existing managed permission denial");
  assert.equal(prompts, 0);
  noExecution();
});

test("approval transport throws and later revalidation never claim approval was not requested", async (t) => {
  for (const when of ["synchronous transport", "rejected transport", "after approval"]) await t.test(when, async (t) => {
    const f = await integrationFixture(t);
    const noExecution = forbidExecution(t);
    let prompts = 0;
    const fail = () => { throw new Error("PRIVATE_TRANSPORT_SENTINEL"); };
    const result = await f.run((candidate) => {
      prompts++;
      assert.equal(candidate.kind, "checks");
      if (when === "synchronous transport") return fail();
      if (when === "rejected transport") return Promise.resolve().then(fail);
      t.mock.method(trust, "getProjectTrustStatus", fail);
      return true;
    });
    assert.equal(result.isError, true);
    assert.equal(prompts, 1);
    assert.equal(result.details.phase, undefined);
    assert.equal(result.details.checkApprovalRequested, undefined);
    assert.doesNotMatch(JSON.stringify(result), /not requested|no checks|no .* executed|PRIVATE_/);
    noExecution();
  });
});

test("a chat in the target can review and integrate a distinct registered feature worktree", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  let tool;
  createAgentGitWorkflowExtension(f.target, f.agentDir).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const cards = [];
  const context = { cwd: f.target, hasUI: true,
    sessionManager: managerFor(f.target),
    ui: { gitAction: async (candidate) => { cards.push(candidate); return true; } } };
  const comparison = await tool.execute("id", { operation: "review", workspaceBranch: "feature", targetBranch: "target" }, undefined, undefined, context);
  assert.equal(comparison.details.viewed, true);
  assert.equal(cards[0].featureCwd, f.feature);
  const refused = await tool.execute("id", { operation: "review", workspaceBranch: "absent", targetBranch: "target" }, undefined, undefined, context);
  assert.equal(refused.isError, true);
  const result = await tool.execute("id", { ...f.params, workspaceBranch: "feature" }, undefined, undefined, context);
  assert.equal(result.details.status, "integrated");
  assert.equal(cards[1].featureCwd, f.feature);
  assert.equal(cards[1].targetCwd, f.target);
  assert.equal(cards[2].featureCwd, f.feature);
  assert.equal(cards[2].targetCwd, f.target);
  assert.equal(isGitCheckoutGated(f.feature), false);
});

test("managed agent FF requires separate check and exact-tip approvals without a merge object", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const manager = managerFor(f.feature);
  const settings = resolveGitWorkflowSettings({ workspace: "worktree", baseBranch: "target", targetBranch: "target",
    delivery: "local", method: "ff", checks: f.params.checks }).values;
  const captured = { kind: "managed", settings };
  appendManagedSessionGitWorkflow(manager, {}, captured, true);
  const targetBefore = await git(f.target, "rev-parse", "HEAD");
  const disabled = await f.run(async () => { throw new Error("Opted-out chat must not request Git approval"); });
  assert.equal(disabled.isError, true);
  assert.match(disabled.content[0].text, /off for this chat/i);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), targetBefore);
  appendManagedSessionGitWorkflow(manager, {}, captured, false);
  const cards = [];
  const result = await f.run(async (candidate) => { cards.push(candidate); return true; });
  assert.equal(result.details.status, "integrated");
  assert.equal(result.details.method, "ff");
  assert.equal(result.details.mergeOid, undefined);
  assert.deepEqual(cards.map((card) => card.kind), ["checks", "integration"]);
  assert.equal(cards[1].plan.method, "ff");
  assert.equal(cards[1].plan.mergeOid, undefined);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), cards[1].plan.featureOid);
  assert.equal(await git(f.target, "show", "-s", "--format=%P", "HEAD"), cards[1].plan.parents.join(" "));
  const anchor = manager.getEntries().filter((entry) => entry.customType === "pi-web:git-action").at(-1);
  const recorded = await readGitAction(anchor.data.actionId, { includeArtifact: true }, f.agentDir);
  assert.equal(recorded.candidate.integrationMethod, "ff");
  assert.equal(recorded.record.outcome.mergeOid, undefined);
  assert.equal(recorded.record.outcome.featureOid, cards[1].plan.featureOid);
});

test("changing the selected worktree branch while approving a commit refuses mutation", async (t) => {
  const f = await integrationFixture(t);
  await writeFile(path.join(f.feature, "a"), "new candidate\n");
  let tool;
  createAgentGitWorkflowExtension(f.target).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const before = await git(f.feature, "rev-parse", "HEAD");
  const result = await tool.execute("id", { operation: "commit", workspaceBranch: "feature", paths: ["a"], message: "stale" }, undefined, undefined,
    context(f.target, async () => { await git(f.feature, "checkout", "-qb", "swapped"); return true; }));
  assert.equal(result.isError, true);
  assert.equal(await git(f.feature, "rev-parse", "HEAD"), before);
});

test("early chat choices save only preferences and prefill later separate approvals", async (t) => {
  const f = await integrationFixture(t);
  const entries = [];
  const manager = sessionFixture(f.feature, entries);
  let tool;
  createAgentGitWorkflowExtension(f.feature, undefined, manager).factory({ getActiveTools: () => ["read", "edit"], appendEntry: manager.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const sessionManager = manager;
  const original = await git(f.target, "rev-parse", "HEAD");
  let card;
  const ctx = (answer, gitAction = async () => false) => ({ cwd: f.feature, hasUI: true, sessionManager,
    ui: { gitPreferences: async (candidate) => { card = candidate; return answer(candidate); }, gitAction } });
  const choose = { operation: "preferences", checks: f.params.checks };
  const cancelled = await tool.execute("call", choose, undefined, undefined, ctx(async () => null));
  assert.equal(cancelled.details.saved, false);
  assert.equal(entries.length, 0);
  const invalid = await tool.execute("call", choose, undefined, undefined, ctx(async () => ({ targetBranch: "evil", method: "merge", checks: [], cleanup: "retain", mode: "current" })));
  assert.equal(invalid.isError, true);
  assert.equal(entries.length, 0);
  const saved = await tool.execute("call", choose, undefined, undefined, ctx(async () => ({ targetBranch: "target", method: "merge", checks: card.checks, cleanup: "offer", mode: "worktree" })));
  assert.equal(saved.details.preferences.cleanup, "offer");
  assert.deepEqual(card.targets, ["target"]);
  assert.equal(entries.length, 1);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), original);
  const cards = [];
  const prefetched = await tool.execute("call", { operation: "integrate" }, undefined, undefined,
    ctx(async () => null, async (candidate) => { cards.push(candidate); return false; }));
  assert.equal(prefetched.details.approved, false);
  assert.equal(cards[0].kind, "checks");
  assert.deepEqual(cards[0].checks, f.params.checks);
  assert.equal(cards[0].targetBranch, "target");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), original);
  const overridden = await tool.execute("call", { operation: "integrate", targetBranch: "target", checks: [{ label: "override", argv: [process.execPath, "-e", "process.exit(0)"] }] }, undefined, undefined,
    ctx(async () => null, async (candidate) => { cards.push(candidate); return false; }));
  assert.equal(overridden.details.approved, false);
  assert.equal(cards.at(-1).checks[0].label, "override");
});

test("stale preference target is not persisted", async (t) => {
  const f = await integrationFixture(t);
  const entries = [];
  const manager = { getEntries: () => entries, isPersisted: () => true, appendCustomEntry: (type, data) => { entries.push({ type: "custom", customType: type, data }); return "id"; } };
  let tool;
  createAgentGitWorkflowExtension(f.feature, undefined, manager).factory({ getActiveTools: () => ["read", "edit"], registerTool: (value) => { tool = value; } });
  const result = await tool.execute("call", { operation: "preferences" }, undefined, undefined, { cwd: f.feature, hasUI: true,
    sessionManager: { getSessionId: () => "id", getCwd: () => f.feature, getHeader: () => ({ cwd: f.feature }) },
    ui: { gitPreferences: async () => {
      await git(f.target, "commit", "--allow-empty", "-qm", "changed target");
      return { targetBranch: "target", method: "merge", checks: [], mode: "current", cleanup: "retain" };
    }, gitAction: async () => true } });
  assert.equal(result.isError, true);
  assert.equal(entries.length, 0);
});

test("legacy git_workflow commit enforces Chat Deny on invocation and after exact approval", async (t) => {
  const f = await integrationFixture(t);
  await writeFile(path.join(f.feature, "a"), "changed\n");
  let tool, prompts = 0;
  const ownerManager = managerFor(f.target);
  const owner = { sessionId: ownerManager.getSessionId(), sessionFile: ownerManager.getSessionFile(), sessionCwd: f.target };
  const selection = await selectGitProjectResources(f.feature);
  const save = async (decision) => saveProjectAuthorization(selection, owner, "session", "commit", decision,
    await readProjectAuthorization(selection, owner, f.agentDir), f.agentDir);
  createAgentGitWorkflowExtension(f.target, f.agentDir).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const run = (ui) => tool.execute("id", { operation: "commit", workspaceBranch: "feature", paths: ["a"], message: "commit" },
    undefined, undefined, context(f.target, ui));
  const head = await git(f.feature, "rev-parse", "HEAD");
  await save("deny");
  assert.equal((await run(async () => { prompts++; return true; })).isError, true);
  assert.equal(prompts, 0);
  await save("inherit");
  const blocked = await run(async () => { prompts++; await save("deny"); return true; });
  assert.equal(blocked.isError, true);
  assert.equal(prompts, 1, JSON.stringify(blocked));
  assert.equal(await git(f.feature, "rev-parse", "HEAD"), head);
});

test("legacy git_workflow checks enforce saved Deny at invocation and after approval", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  let tool, prompts = 0;
  const caller = managerFor(f.target);
  const owner = { sessionId: caller.getSessionId(), sessionFile: caller.getSessionFile(), sessionCwd: f.target };
  const selection = await selectGitProjectResources(f.feature);
  const save = async (action, decision) => saveProjectAuthorization(selection, owner, "session", action, decision,
    await readProjectAuthorization(selection, owner, f.agentDir), f.agentDir);
  createAgentGitWorkflowExtension(f.target, f.agentDir).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const run = (ui) => tool.execute("id", { ...f.params, workspaceBranch: "feature" }, undefined, undefined,
    context(f.target, async (candidate) => { prompts++; return ui(candidate); }));
  const head = await git(f.target, "rev-parse", "HEAD");
  await save("checks", "deny");
  assert.equal((await run(async () => true)).isError, true);
  assert.equal(prompts, 0);
  await save("checks", "inherit");
  assert.equal((await run(async (candidate) => {
    if (candidate.kind === "checks") await save("checks", "deny");
    return true;
  })).isError, true);
  assert.equal(prompts, 1, "revocation after approval prevents check execution");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), head);
});

test("legacy git_workflow integration Deny prevents checks and revocation before merge prevents apply", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const caller = managerFor(f.target);
  const owner = { sessionId: caller.getSessionId(), sessionFile: caller.getSessionFile(), sessionCwd: f.target };
  const selection = await selectGitProjectResources(f.feature);
  const save = async (decision) => saveProjectAuthorization(selection, owner, "session", "integration", decision,
    await readProjectAuthorization(selection, owner, f.agentDir), f.agentDir);
  let tool, prompts = 0;
  createAgentGitWorkflowExtension(f.target, f.agentDir).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const run = (ui) => tool.execute("id", { ...f.params, workspaceBranch: "feature" }, undefined, undefined,
    context(f.target, async (candidate) => { prompts++; return ui(candidate); }));
  const head = await git(f.target, "rev-parse", "HEAD");
  await save("deny");
  assert.equal((await run(async () => true)).isError, true);
  assert.equal(prompts, 0);
  await save("inherit");
  const blockedMerge = await run(async (candidate) => {
    if (candidate.kind === "integration") await save("deny");
    return true;
  });
  assert.equal(blockedMerge.isError, true, JSON.stringify(blockedMerge));
  assert.equal(prompts, 2, "checks passed but merge approval could not override live Deny");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), head);
});

test("agent merge asks for checks then separately approves an exact plan without a saved policy", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const before = await git(f.target, "rev-parse", "HEAD");
  const cards = [];
  const declined = await f.run(async (candidate) => { cards.push(candidate); return candidate.kind === "checks"; });
  assert.equal(declined.details.approved, false, JSON.stringify({ declined, cards: cards.map((c) => c.kind) }));
  assert.deepEqual(cards.map((c) => c.kind), ["checks", "integration"]);
  assert.deepEqual(cards[0].checks, f.params.checks);
  assert.equal(cards[1].receipts[0].checkIndex, 0);
  assert.match(cards[1].plan.diff.patch, /\+feature/);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), before);
  assert.equal(isGitCheckoutGated(f.target), false); // the UI wait is never gated
  const approved = await f.run(async () => {
    assert.equal(isGitCheckoutGated(f.target), false);
    return true;
  });
  assert.equal(approved.details.status, "integrated");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), approved.details.mergeOid);
  assert.equal(await git(f.target, "rev-list", "--parents", "-n", "1", "HEAD").then((s) => s.split(" ").length), 3);
});

test("agent integration returns typed pre-apply target movement without intent", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const response = await f.run(async (candidate) => {
    if (candidate.kind === "integration") await git(f.target, "commit", "--allow-empty", "-qm", "concurrent target");
    return true;
  });
  assert.equal(response.isError, true);
  assert.equal(response.details.code, "target_moved");
  assert.match(response.details.error, /refresh review/);
  assert.equal(await git(f.target, "show", "-s", "--format=%s", "HEAD"), "concurrent target");
  const commonDir = await git(f.feature, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const { inspectGitOperationAdmission } = await jiti.import("./git-operation-admission.ts");
  assert.equal(inspectGitOperationAdmission(f.agentDir, commonDir).reason, "clear");
});

test("invalid argv, check refusal, stale plan and cancellation never update target", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const before = await git(f.target, "rev-parse", "HEAD");
  assert.equal((await f.run(async () => false)).details?.approved, false);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), before);
  f.params.checks = [{ label: "shell", argv: ["sh", "-c", "exit 0"] }];
  assert.equal((await f.run(async () => true)).isError, true);
  f.params.checks = [{ label: "node", argv: [process.execPath, "-e", "process.exit(0)"] }];
  const changed = await f.run(async (candidate) => {
    if (candidate.kind === "integration") await git(f.feature, "commit", "--allow-empty", "-qm", "stale");
    return true;
  });
  assert.equal(changed.isError, true);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), before);
  const abort = new AbortController();
  const cancelled = await f.run(async (candidate) => { if (candidate.kind === "checks") abort.abort(); return true; }, abort.signal);
  assert.equal(cancelled.details.approved, false);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), before);
});

test("Stop during an authorized check releases gates without integrating", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const before = await git(f.target, "rev-parse", "HEAD");
  f.params.checks = [{ label: "slow", argv: [process.execPath, "-e", "setTimeout(() => {}, 30000)"] }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    const result = await f.run(async () => true, controller.signal);
    assert.equal(result.isError, true);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), before);
    assert.equal(isGitCheckoutGated(f.feature), false);
    assert.equal(isGitCheckoutGated(f.target), false);
  } finally { clearTimeout(timer); }
});

test("refuses mismatched cwd, missing UI and unreviewed mutations", async (t) => {
  const { dir, tool } = await fixture(t);
  const params = { operation: "commit", paths: ["a"], message: "No" };
  assert.equal((await tool.execute("call", params, undefined, undefined, context("/elsewhere", async () => true))).isError, true);
  assert.equal((await tool.execute("call", params, undefined, undefined, { cwd: dir, hasUI: false, ui: {} })).isError, true);
});

test("explicit status/review alternates repositories from a non-Git chat without leaking its settings or changing cwd", async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const jiti = createJiti(import.meta.url);
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const { appendGitProjectSessionSettings } = await jiti.import("./git-project-session.ts");
  const { appendAgentGitPreferences } = await jiti.import("./agent-git-preferences.ts");
  const caller = sessionFixture(a.home);
  const callerId = caller.getSessionId();
  const agentDir = path.join(a.home, "scoped-agent");
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {
    [a.target]: { targetBranch: "a-default", checks: [{ label: "A only", argv: ["node", "a.mjs"] }] },
    [b.target]: { targetBranch: "target", commits: "manual", checks: [{ label: "B only", argv: ["node", "b.mjs"] }] },
  } }, agentDir);
  appendAgentGitPreferences(caller, { targetBranch: "caller-only", method: "merge", checks: [], cleanup: "retain", mode: "current" });
  appendGitProjectSessionSettings(caller, a.target, { targetBranch: "a-chat" });
  let tool;
  createAgentGitWorkflowExtension(a.home, agentDir, caller).factory({ getActiveTools: () => ["read", "edit"], appendEntry: caller.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const shown = [];
  const ctx = { cwd: a.home, hasUI: true, sessionManager: caller, ui: { gitAction: async (candidate) => { shown.push(candidate); return true; } } };
  const before = await Promise.all([a.target, b.target].map((cwd) => git(cwd, "rev-parse", "HEAD")));
  const outputs = [];
  for (const [root, checkout] of [[a.target, a.feature], [b.target, b.feature], [a.target, a.feature]]) {
    const response = await tool.execute("id", { operation: "status", repositoryPath: root, checkoutPath: checkout, workspaceBranch: "feature" }, undefined, undefined, { ...ctx, hasUI: false });
    assert.equal(response.isError, undefined, JSON.stringify(response));
    outputs.push(response.details);
  }
  assert.deepEqual(outputs.map((o) => o.selection.cwd), [a.feature, b.feature, a.feature]);
  assert.deepEqual(outputs.map((o) => o.saved.values.targetBranch), ["a-chat", "target", "a-chat"]);
  assert.deepEqual(outputs.map((o) => o.saved.values.checks[0].label), ["A only", "B only", "A only"]);
  assert.equal(outputs[1].permissions.agent.commit.code, "manual-commits");
  assert.equal(outputs[0].permissions.agent.commit.code, "project-scope-read-only");
  assert.deepEqual(outputs[0].capabilities.mutations, process.platform === "linux" ? { commit: "ask-or-saved-allow-none" } : false);
  for (const invalid of [
    { operation: "commit", checkoutPath: b.feature, paths: ["a"], message: "no" },
    { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature, paths: ["a"], message: "no" },
    { operation: "integrate", repositoryPath: b.target, checkoutPath: b.feature },
    { operation: "commit", paths: ["a"], message: "no", futureAuthorization: true },
  ]) assert.equal((await tool.execute("deny", invalid, undefined, undefined, ctx)).isError, true);
  assert.equal(shown.length, 0, "status never asks or starts an action");
  const review = await tool.execute("id", { operation: "review", repositoryPath: b.target, checkoutPath: b.feature, workspaceBranch: "feature" }, undefined, undefined, ctx);
  if (process.platform === "linux") {
    assert.equal(review.details.viewed, true, JSON.stringify(review));
    assert.equal(shown[0].featureCwd, b.feature);
    assert.equal(shown[0].review.targetBranch, "target", "B's target wins; unqualified caller preferences are ignored");
    assert.equal(review.details.resources.projectRoot, b.target);
  } else {
    assert.equal(review.details.code, "unsupported-platform");
    assert.equal(shown.length, 0);
  }
  assert.equal(caller.getCwd(), a.home);
  assert.equal(caller.getSessionId(), callerId);
  assert.deepEqual(await Promise.all([a.target, b.target].map((cwd) => git(cwd, "rev-parse", "HEAD"))), before);
  assert.equal(caller.getEntries().filter((e) => e.customType === "pi-web:git-action").length, process.platform === "linux" ? 1 : 0, "read-only history belongs to the unchanged caller");
});

test("explicit-project integration and preferences fail before UI or commands run", async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  let tool, prompts = 0;
  createAgentGitWorkflowExtension(a.target).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(a.target), registerTool: (value) => { tool = value; } });
  const before = await git(b.target, "rev-parse", "HEAD");
  for (const operation of ["integrate", "preferences"]) {
    const response = await tool.execute("id", { operation, repositoryPath: b.target, workspaceBranch: "feature",
      targetBranch: "target", checks: b.params.checks, paths: ["a"], message: "Not supported yet" }, undefined, undefined,
      context(a.target, async () => { prompts++; return true; }));
    assert.equal(response.isError, true);
    assert.match(response.details.error, /project-scoped managed action is unavailable/);
  }
  // A saved Allow with confirmation:none cannot manufacture a no-prompt
  // decision in the absence of a persisted ordinary caller.
  const jiti = createJiti(import.meta.url);
  const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
  const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const agentDir = path.join(a.home, "scoped-agent");
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {
    [b.target]: { commits: "ask", commitConfirmation: "none" },
  } }, agentDir);
  const selected = await selectGitProjectResources(b.target, "feature", b.feature);
  await saveProjectAuthorization(selected, undefined, "project", "commit", "allow",
    await readProjectAuthorization(selected, undefined, agentDir), agentDir);
  let guarded;
  createAgentGitWorkflowExtension(a.target, agentDir).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: appendFor(a.target), registerTool: (value) => { guarded = value; } });
  await writeFile(path.join(b.feature, "a"), "would-be commit\n");
  const beforeFeature = await git(b.feature, "rev-parse", "HEAD");
  const beforeEntries = managerFor(a.target).getEntries().length;
  for (const hasUI of [true, false]) for (const checkoutPath of [b.feature, undefined]) {
    const response = await guarded.execute("id", { operation: "commit", repositoryPath: b.target, checkoutPath,
      paths: ["a"], message: "never commit" }, undefined, undefined,
    { cwd: a.target, hasUI, sessionManager: managerFor(a.target), ui: { gitAction: async () => { prompts++; return true; } } });
    assert.equal(response.isError, true);
    assert.match(response.details.error, /interactive|persisted ordinary chat|explicit canonical repository|roots differ/);
  }
  assert.equal(prompts, 0);
  assert.equal(managerFor(a.target).getEntries().length, beforeEntries, "no candidate was journalled");
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), beforeFeature);
  assert.equal(await git(b.target, "rev-parse", "HEAD"), before);
});

test("selected-project commit asks on a saved Allow with confirmation:none, then honors live Deny", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
  const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
  manager.appendMessage({ role: "user", content: "Commit only if allowed by this project's instructions", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  t.after(async () => {
    for (const entry of manager.getEntries()) if (entry.customType === "pi-web:git-action") {
      await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
    }
  });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {
    [b.target]: { commits: "ask", commitConfirmation: "none" },
  } }, historyDir);
  const selection = await selectGitProjectResources(b.target, "feature", b.feature);
  const owner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionCwd: a.target };
  const save = async (decision) => saveProjectAuthorization(selection, undefined, "project", "commit", decision,
    await readProjectAuthorization(selection, undefined, historyDir), historyDir);
  await save("allow");
  let tool;
  createAgentGitWorkflowExtension(a.target, historyDir, manager).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
  await writeFile(path.join(b.feature, "a"), "selected change\n");
  const previous = await git(b.feature, "rev-parse", "HEAD");
  const params = { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature, workspaceBranch: "feature",
    paths: ["a"], message: "selected exact commit" };
  const calls = [];
  const ctx = (answer, hasUI = true) => ({ cwd: a.target, hasUI, sessionManager: manager,
    ui: { gitAction: async (candidate) => { calls.push(candidate); return answer(candidate); } } });
  const declined = await tool.execute("id", params, undefined, undefined, ctx(() => false));
  assert.equal(declined.details.approved, false, JSON.stringify(declined));
  assert.equal(calls.length, 1, "saved Allow plus confirmation:none does not silently approve a commit");
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), previous);
  assert.equal((await readProjectAuthorization(selection, owner, historyDir)).actions.commit.effective, "allow");
  const approved = await tool.execute("id", params, undefined, undefined, ctx(() => true));
  assert.equal(approved.details.status, "committed", JSON.stringify(approved));
  assert.equal(calls[1].kind, "commit");
  assert.equal(calls[1].preview.repositoryRoot, b.feature);
  assert.equal(calls[1].preview.head, previous);
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), approved.details.commit);
  assert.equal(await git(b.target, "rev-parse", "HEAD"), await git(b.target, "rev-parse", "target"));
  assert.equal(manager.getCwd(), a.target, "selection must not move the chat");
  await writeFile(path.join(b.feature, "a"), "next change\n");
  const withoutPrompt = await tool.execute("id", { ...params, confirmation: "none" }, undefined, undefined,
    { cwd: a.target, hasUI: false, sessionManager: manager, ui: {} });
  assert.equal(withoutPrompt.details.status, "committed", JSON.stringify(withoutPrompt));
  assert.equal(withoutPrompt.details.approval, "saved-project-allow");
  assert.equal(calls.length, 2);
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), withoutPrompt.details.commit);
  const journal = await readGitAction(withoutPrompt.details.actionId);
  assert.equal(journal.record.decision, undefined, "standing Allow is not a human candidate approval");
  assert.match(journal.record.reason, /saved Allow and confirmation:none/);
  await save("deny");
  await writeFile(path.join(b.feature, "a"), "another change\n");
  const denied = await tool.execute("id", params, undefined, undefined, ctx(() => true));
  assert.equal(denied.isError, true);
  assert.match(denied.details.error, /authorization is denied/);
  assert.equal(calls.length, 2, "Deny must refuse before the human candidate");
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), withoutPrompt.details.commit);
  assert.equal((await tool.execute("id", { ...params, confirmation: "none" }, undefined, undefined, ctx(() => true, false))).isError, true);
});

test("selected policy, caller restrictions, stale grants and read-only tools fail before approval", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
  const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const { appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
  const manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
  manager.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  t.after(async () => {
    for (const entry of manager.getEntries()) if (entry.customType === "pi-web:git-action") {
      await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
    }
  });
  const selected = await selectGitProjectResources(b.target, "feature", b.feature);
  let mode = "ask", enabled = true, tools = ["read", "edit"], shown = 0;
  const settings = () => writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {
    [b.target]: { commits: mode, enabled, commitConfirmation: "none" },
  } }, historyDir);
  settings();
  const owner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionCwd: a.target };
  const params = { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature, paths: ["a"], message: "candidate" };
  await writeFile(path.join(b.feature, "a"), "changed\n");
  let tool;
  createAgentGitWorkflowExtension(a.target, historyDir, manager).factory({ getActiveTools: () => tools,
    appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
  const run = () => tool.execute("id", params, undefined, undefined, { cwd: a.target, hasUI: true, sessionManager: manager,
    ui: { gitAction: async () => { shown++; return false; } } });
  // confirmation:none and policy Ask do not mint saved approval.
  assert.equal((await readProjectAuthorization(selected, owner, historyDir)).actions.commit.effective, "none");
  const noGrant = await tool.execute("id", { ...params, confirmation: "none" }, undefined, undefined,
    { cwd: a.target, hasUI: false, sessionManager: manager, ui: {} });
  assert.equal(noGrant.isError, true, "policy-only confirmation:none cannot mint a grant");
  assert.equal((await run()).details.approved, false);
  assert.equal(shown, 1);
  await saveProjectAuthorization(selected, owner, "session", "commit", "allow",
    await readProjectAuthorization(selected, owner, historyDir), historyDir);
  mode = "manual"; settings();
  assert.equal((await run()).isError, true);
  mode = "off"; settings();
  assert.equal((await run()).isError, true);
  mode = "ask"; enabled = false; settings();
  assert.equal((await run()).isError, true);
  enabled = true; settings();
  assert.equal((await readProjectAuthorization(selected, owner, historyDir)).actions.commit.effective, "deny", "stale specific chat grant cannot fall back to broader consent");
  assert.equal((await run()).isError, true);
  assert.equal(shown, 1);
  await saveProjectAuthorization(selected, owner, "session", "commit", "inherit",
    await readProjectAuthorization(selected, owner, historyDir), historyDir);
  tools = ["read"];
  assert.equal((await run()).isError, true);
  tools = ["read", "edit"];
  appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: resolveGitWorkflowSettings({ commits: "off" }).values });
  assert.equal((await run()).isError, true);
  appendManagedSessionGitWorkflow(manager, {}, { kind: "legacy", policy: null });
  assert.equal((await run()).isError, true, "legacy chat must not be upgraded by selected project policy");
  manager.appendCustomEntry("pi-web:subagent", { version: 1 });
  assert.equal((await run()).isError, true, "subagent must not use a project grant");
  assert.equal(shown, 1);
});

test("selected-project commit refuses a concurrent Git transaction before and after candidate approval", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
  manager.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  t.after(async () => {
    for (const entry of manager.getEntries()) if (entry.customType === "pi-web:git-action") {
      await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
    }
  });
  await writeFile(path.join(b.feature, "a"), "writer blocked\n");
  const before = await git(b.feature, "rev-parse", "HEAD");
  let tool, prompted = 0;
  const { acquireGitCheckoutGate, isGitCheckoutGated } = await jiti.import("./git-checkout-gate.ts");
  createAgentGitWorkflowExtension(a.target, historyDir, manager).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
  const params = { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature, paths: ["a"], message: "writer test" };
  let blockAfterApproval = true;
  const ctx = { cwd: a.target, hasUI: true, sessionManager: manager, ui: { gitAction: async () => {
    prompted++;
    if (blockAfterApproval) releaseAfterApproval = acquireGitCheckoutGate([b.feature]);
    return true;
  } } };
  let releaseAfterApproval;
  const releaseBeforeApproval = acquireGitCheckoutGate([b.feature]);
  try { assert.equal((await tool.execute("id", params, undefined, undefined, ctx)).isError, true); }
  finally { releaseBeforeApproval(); }
  assert.equal(prompted, 0);
  try { assert.equal((await tool.execute("id", params, undefined, undefined, ctx)).isError, true); }
  finally { releaseAfterApproval?.(); }
  assert.equal(prompted, 1);
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), before);
  assert.equal(isGitCheckoutGated(b.feature), false);
  blockAfterApproval = false;
});

test("selected-project approval revocation blocks the ref CAS and never retries", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
  const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
  const manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
  manager.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  t.after(async () => {
    for (const entry of manager.getEntries()) if (entry.customType === "pi-web:git-action") {
      await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
    }
  });
  const selected = await selectGitProjectResources(b.target, "feature", b.feature);
  await saveProjectAuthorization(selected, undefined, "project", "commit", "allow",
    await readProjectAuthorization(selected, undefined, historyDir), historyDir);
  await writeFile(path.join(b.feature, "a"), "would be committed\n");
  const before = await git(b.feature, "rev-parse", "HEAD");
  let tool, prompts = 0;
  createAgentGitWorkflowExtension(a.target, historyDir, manager).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
  const response = await tool.execute("id", { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature,
    paths: ["a"], message: "not committed" }, undefined, undefined, { cwd: a.target, hasUI: true, sessionManager: manager,
    ui: { gitAction: async () => {
      prompts++;
      await saveProjectAuthorization(selected, undefined, "project", "commit", "deny",
        await readProjectAuthorization(selected, undefined, historyDir), historyDir);
      return true;
    } } });
  assert.equal(prompts, 1);
  assert.equal(response.isError, true, JSON.stringify(response));
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), before);
});

test("saved-Allow no-prompt commit rechecks revocation at the pre-ref intent boundary", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
  const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const commit = await jiti.import("./git-commit.ts");
  const manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
  manager.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  t.after(async () => {
    for (const entry of manager.getEntries()) if (entry.customType === "pi-web:git-action") {
      await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
    }
  });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {
    [b.target]: { commits: "ask", commitConfirmation: "none" },
  } }, historyDir);
  const selected = await selectGitProjectResources(b.target, "feature", b.feature);
  await saveProjectAuthorization(selected, undefined, "project", "commit", "allow",
    await readProjectAuthorization(selected, undefined, historyDir), historyDir);
  const confirm = commit.confirmGitCommit;
  let reached = 0;
  t.mock.method(commit, "confirmGitCommit", (preview, message, beforeRef) => confirm(preview, message, async (intended) => {
    reached++;
    await saveProjectAuthorization(selected, undefined, "project", "commit", "deny",
      await readProjectAuthorization(selected, undefined, historyDir), historyDir);
    await beforeRef(intended);
  }));
  let tool;
  createAgentGitWorkflowExtension(a.target, historyDir, manager).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
  await writeFile(path.join(b.feature, "a"), "unapproved no-prompt change\n");
  const before = await git(b.feature, "rev-parse", "HEAD");
  const response = await tool.execute("id", { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature,
    confirmation: "none", paths: ["a"], message: "no commit" }, undefined, undefined,
  { cwd: a.target, hasUI: false, sessionManager: manager, ui: {} });
  assert.equal(reached, 1, "revocation reached the actual native pre-ref callback");
  assert.equal(response.isError, true);
  assert.equal(await git(b.feature, "rev-parse", "HEAD"), before);
  const { inspectGitOperationAdmission } = await jiti.import("./git-operation-admission.ts");
  assert.equal(inspectGitOperationAdmission(historyDir, selected.commonDir).admitted, true,
    "journalled pre-CAS refusal resolves its durable intent without pretending a ref update occurred");
});

test("inspecting B while an A comparison waits cannot retarget the candidate or later omitted selection", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  await git(a.target, "branch", "only-in-A");
  let tool, shown = 0;
  createAgentGitWorkflowExtension(a.feature).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(a.feature), registerTool: (value) => { tool = value; } });
  const ctx = context(a.feature, async (candidate) => {
    shown++;
    assert.equal(candidate.featureCwd, a.feature);
    const other = await tool.execute("other", { operation: "status", repositoryPath: b.target, workspaceBranch: "feature" }, undefined, undefined, context(a.feature));
    assert.equal(other.details.selection.cwd, b.feature);
    const implicit = await tool.execute("implicit", { operation: "status" }, undefined, undefined, context(a.feature));
    assert.equal(implicit.details.cwd, a.feature);
    assert.equal(candidate.featureCwd, a.feature);
    return true;
  });
  const response = await tool.execute("review", { operation: "review", repositoryPath: a.target, workspaceBranch: "feature", targetBranch: "target" }, undefined, undefined, ctx);
  assert.equal(response.isError, undefined);
  assert.equal(response.details.resources.cwd, a.feature);
  const missing = await tool.execute("missing", { operation: "review", repositoryPath: b.target, workspaceBranch: "feature", targetBranch: "only-in-A" }, undefined, undefined, ctx);
  assert.equal(missing.isError, true);
  assert.equal(shown, 1, "a missing target in B never falls back to A or displays an A patch");
});

test("explicit review detects a selected branch changing during comparison without hiding the actual review decision", { skip: process.platform !== "linux" }, async (t) => {
  const f = await integrationFixture(t);
  let tool;
  createAgentGitWorkflowExtension(f.target).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const response = await tool.execute("id", { operation: "review", repositoryPath: f.target, workspaceBranch: "feature", targetBranch: "target" }, undefined, undefined,
    context(f.target, async () => { await git(f.feature, "branch", "-m", "changed"); return true; }));
  assert.equal(response.isError, true);
  assert.equal(response.details.code, "selection-changed");
  const anchor = managerFor(f.target).getEntries().findLast((entry) => entry.customType === "pi-web:git-action");
  const { readGitAction } = await createJiti(import.meta.url).import("./git-action-journal.ts");
  const { record } = await readGitAction(anchor.data.actionId);
  assert.equal(record.state, "blocked");
  assert.equal(record.decision, "reviewed");
});
