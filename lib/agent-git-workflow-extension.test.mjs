import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";

const historyDir = await mkdtemp(path.join(os.tmpdir(), "agent-action-history-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = historyDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(historyDir, { recursive: true, force: true });
});
const managers = new Map();
function sessionFixture(cwd, entries = []) {
  const id = randomUUID();
  const manager = { getSessionId: () => id, getCwd: () => cwd, getHeader: () => ({ id, cwd }),
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
const { createJiti } = await import("jiti");
const { createAgentGitWorkflowExtension } = await createJiti(import.meta.url).import("./agent-git-workflow-extension.ts");
const { allowFileRoot } = await createJiti(import.meta.url).import("./file-access.ts");
const { isGitCheckoutGated } = await createJiti(import.meta.url).import("./git-checkout-gate.ts");
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-git-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await git(dir, "init", "-q", "-b", "target");
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
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-merge-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const target = path.join(home, "target"), feature = path.join(home, "feature"), agentDir = path.join(home, "agent");
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
  return { home, feature, target, params, run };
}

test("a chat in the target can review and integrate a distinct registered feature worktree", async (t) => {
  const f = await integrationFixture(t);
  let tool;
  createAgentGitWorkflowExtension(f.target, path.join(f.home, "agent")).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
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

test("agent merge asks for checks then separately approves an exact plan without a saved policy", async (t) => {
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

test("invalid argv, check refusal, stale plan and cancellation never update target", async (t) => {
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
