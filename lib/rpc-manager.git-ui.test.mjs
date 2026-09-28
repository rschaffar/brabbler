import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;
const NOW = Date.UTC(2026, 0, 1);

// Isolate before importing the SDK, including its default-directory discovery.
// No SDK session is initialized or registered, and no Git commands are executed.
const root = mkdtempSync(join(tmpdir(), "pi-web-git-ui-test-"));
const home = join(root, "home");
const agentDir = join(root, "agent");
const cwd = join(root, "project");
for (const dir of [home, agentDir, cwd]) mkdirSync(dir, { mode: 0o700 });
const environment = {
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  PI_CODING_AGENT_DIR: agentDir,
  PI_WEB_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT),
};
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
Object.assign(process.env, environment);
after(() => {
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSession } = await jiti.import("@earendil-works/pi-coding-agent");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { GitActionDecisionEndedError } = await jiti.import("./git-action-controller.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
let sessionNumber = 0;

// Follow rpc-manager-extension-ui.test.mjs: use the actual wrapper UI methods
// and SDK command/abort paths with only the inner session and command stubbed.
function setup(t, handler = async () => {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  let ui;
  const errors = [];
  const dispose = t.mock.fn();
  const inner = {
    sessionId: `git-ui-test-${++sessionNumber}`,
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: { getCwd: () => cwd },
    agent: { state: {}, abort() {} },
    abortRetry() {}, abortCompaction() {}, abortBranchSummary() {}, dispose,
    subscribe: () => () => {},
    prompt: AgentSession.prototype.prompt,
    _tryExecuteExtensionCommand: AgentSession.prototype._tryExecuteExtensionCommand,
    abort: AgentSession.prototype.abort,
    waitForIdle: AgentSession.prototype.waitForIdle,
    _extensionRunner: {
      getCommand: () => ({ handler: () => handler(ui) }),
      createCommandContext: () => ({}),
      emitError: (error) => errors.push(error),
    },
    extensionRunner: {},
  };
  const wrapper = new AgentSessionWrapper(inner, { suppressCompletionNotifications: true });
  t.after(() => wrapper.destroy());
  ui = wrapper.createExtensionUiContext();
  const events = [];
  const disconnect = wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  return { wrapper, ui, events, errors, dispose, disconnect };
}

function gitCard(kind) {
  const checks = [{ label: "Unit tests", argv: ["node", "--version"] }];
  const preferences = { targetBranch: "main", method: "merge", checkIndexes: [0], cleanup: "offer", mode: "worktree" };
  const diff = { fromTreeOid: "a".repeat(40), toTreeOid: "b".repeat(40), patch: "captured patch", hasBinaryChanges: false };
  const review = {
    targetBranch: "main", targetOid: "c".repeat(40), targetTreeOid: diff.fromTreeOid,
    featureBranch: "feature", featureOid: "d".repeat(40), featureTreeOid: diff.toTreeOid,
    mergeTreeOid: diff.toTreeOid, commits: [],
  };
  const candidates = {
    preferences: { kind, featureBranch: "feature", targets: ["main"], checks },
    commit: {
      kind, actionId: "fixture-commit", message: "Commit the captured changes", diff,
      preview: { repositoryRoot: cwd, branch: "refs/heads/feature", head: review.featureOid,
        paths: ["file.txt"], tree: diff.toTreeOid, reviewToken: "e".repeat(64) },
    },
    review: { kind, actionId: "fixture-review", featureCwd: cwd, review, selection: { kind: "merge" }, diff },
    checks: { kind, actionId: "fixture-checks", featureCwd: cwd, targetCwd: join(root, "target"),
      targetBranch: "main", featureBranch: "feature", checks },
    integration: {
      kind, actionId: "fixture-integration", featureCwd: cwd, targetCwd: join(root, "target"),
      // Synthetic native metadata: UI waiting must neither expire the question
      // nor renew these deadlines. Execution-layer validity is not tested here.
      plan: { planId: "exact-native-plan", sessionId: "fixture", review, diff,
        receiptIds: ["native-receipt"], mergeOid: "f".repeat(40), message: "Merge feature",
        expiresAt: NOW + 15 * MINUTE },
      receipts: [{ id: "native-receipt", expiresAt: NOW + 15 * MINUTE }],
    },
  };
  return {
    method: kind === "preferences" ? "gitPreferences" : "gitAction",
    candidate: candidates[kind],
    approval: kind === "preferences" ? { preferences }
      : kind === "integration" ? { approvePlanId: "exact-native-plan" } : { confirmed: true },
    approvedValue: kind === "preferences"
      ? { targetBranch: "main", method: "merge", checks, cleanup: "offer", mode: "worktree" } : true,
    declinedValue: kind === "preferences" ? null : false,
    invalidReplies: kind === "preferences"
      ? [{ preferences: { ...preferences, targetBranch: "not-offered" } },
        { preferences: { ...preferences, checkIndexes: [1] } }, { preferences, confirmed: true }]
      : kind === "integration" ? [{ confirmed: true }, { approvePlanId: "different-plan" }]
        : [{ value: "yes" }, { confirmed: "true" }],
  };
}

async function openGitQuestion(t, card, signal) {
  let decision;
  const settlements = [];
  const harness = setup(t, (ui) => {
    decision = ui[card.method](card.candidate, signal);
    decision.then((value) => settlements.push({ value }), (error) => settlements.push({ error }));
    return decision;
  });
  const sending = harness.wrapper.send({ type: "prompt", message: "/git-ui-test" });
  await nextTurn();
  assert.ok(decision);
  const request = harness.events.find((event) => event.method === "git_action");
  assert.ok(request);
  return { ...harness, card, decision, settlements, sending, request, attention: harness.wrapper.getPendingAttention() };
}

async function advance(t, milliseconds) {
  // Exercise repeated idle callbacks, rather than jumping over the whole day
  // in one tick (a rearmed timer starts at the mock clock's current time).
  while (milliseconds > 0) {
    const step = Math.min(milliseconds, IDLE_TIMEOUT);
    t.mock.timers.tick(step);
    await nextTurn();
    milliseconds -= step;
  }
}

function assertPending(h) {
  assert.equal(h.wrapper.isAlive(), true);
  assert.equal(h.wrapper.isRunning(), true, "the waiting command is active even while the SDK agent is idle");
  assert.deepEqual(h.settlements, []);
  assert.deepEqual(h.errors, []);
  assert.deepEqual([...h.wrapper.pendingUiRequests.values()], [h.request]);
  assert.deepEqual([...h.wrapper.pendingUiResponses.keys()], [h.request.id]);
  assert.deepEqual(h.wrapper.getPendingAttention(), h.attention);
  assert.equal(h.dispose.mock.callCount(), 0);
}

function assertClosedOnce(h) {
  assert.equal(h.settlements.length, 1);
  assert.equal(h.wrapper.pendingUiRequests.size, 0);
  assert.equal(h.wrapper.pendingUiResponses.size, 0);
  assert.equal(h.wrapper.pendingUiStartedAt.size, 0);
  assert.equal(h.wrapper.getPendingAttention(), null);
  assert.equal(h.wrapper.isRunning(), false);
  assert.equal(h.events.filter((event) => event.type === "extension_ui_closed" && event.id === h.request.id).length, 1);
  assert.equal(h.events.filter((event) => event.type === "prompt_done").length, 1);
  const replay = [];
  h.wrapper.onEvent((event) => replay.push(event))();
  assert.deepEqual(replay, []);
}

const respond = (h, body) => h.wrapper.send({ type: "extension_ui_response", id: h.request.id, ...body });

for (const kind of ["preferences", "commit", "review", "checks", "integration"]) {
  for (const outcome of ["approval", "decline"]) {
    test(`Git ${kind} has no UI deadline, replays after a day offline, and settles ${outcome} once`, async (t) => {
      const card = gitCard(kind);
      const originalCandidate = structuredClone(card.candidate);
      const h = await openGitQuestion(t, card);
      assert.equal(Object.hasOwn(h.request, "timeout"), false);
      assert.equal(Object.hasOwn(h.request, "expiresAt"), false);
      assert.deepEqual(h.request.candidate, originalCandidate);
      assertPending(h);

      h.disconnect();
      assert.equal(h.wrapper.listeners.size, 0);
      await advance(t, 5 * MINUTE + 1);
      assertPending(h);
      await advance(t, DAY - (5 * MINUTE + 1));
      assert.equal(Date.now(), NOW + DAY);
      assertPending(h);

      const replay = [];
      const disconnect = h.wrapper.onEvent((event) => { replay.push(event); h.events.push(event); });
      t.after(disconnect);
      assert.deepEqual(replay, [{ type: "extension_ui_request", id: h.request.id, method: "git_action", candidate: originalCandidate }]);
      assert.deepEqual(card.candidate, originalCandidate, "replay must not replace the candidate or renew native deadlines");
      if (kind === "integration") {
        assert.ok(h.request.candidate.plan.expiresAt < Date.now());
        assert.ok(h.request.candidate.receipts[0].expiresAt < Date.now());
      }

      if (outcome === "approval") {
        for (const reply of card.invalidReplies) {
          await respond(h, reply);
          assertPending(h);
        }
      }
      await respond(h, outcome === "approval" ? card.approval : { cancelled: true });
      await h.sending;
      await nextTurn();
      assert.deepEqual(await h.decision, outcome === "approval" ? card.approvedValue : card.declinedValue);
      assertClosedOnce(h);
      assert.deepEqual(h.errors, []);

      // Duplicate and contradictory responses cannot change the settled result.
      await respond(h, card.approval);
      await respond(h, { cancelled: true });
      assertClosedOnce(h);
      await advance(t, IDLE_TIMEOUT);
      assert.equal(h.wrapper.isAlive(), false, "ordinary idle expiry resumes after the decision");
      assert.equal(h.dispose.mock.callCount(), 1);
    });
  }
}

for (const kind of ["preferences", "commit", "integration"]) {
  for (const cancellation of ["signal", "Stop", "destroy", "shutdown"]) {
    test(`${cancellation} cancels a long-pending Git ${kind} question and ignores late approval`, async (t) => {
      const controller = new AbortController();
      const h = await openGitQuestion(t, gitCard(kind), controller.signal);
      await advance(t, 6 * MINUTE);
      assertPending(h);

      if (cancellation === "signal") controller.abort();
      else if (cancellation === "Stop") await h.wrapper.send({ type: "abort" });
      else if (cancellation === "destroy") h.wrapper.destroy();
      else await h.wrapper.shutdown();
      await h.sending;
      await nextTurn();

      if (kind !== "preferences") {
        await assert.rejects(h.decision, (error) => error instanceof GitActionDecisionEndedError && error.state === "cancelled");
        assert.equal(h.errors.length, 1);
        assert.match(h.errors[0].error, /Git decision cancelled/);
      } else if (cancellation === "Stop") {
        await assert.rejects(h.decision, { name: "AbortError" });
        assert.equal(h.errors.length, 1);
        assert.match(h.errors[0].error, /cancelled by Stop/);
      } else {
        assert.equal(await h.decision, null);
        assert.deepEqual(h.errors, []);
      }
      assertClosedOnce(h);
      await respond(h, h.card.approval);
      await respond(h, { cancelled: true });
      controller.abort();
      await advance(t, DAY);
      assertClosedOnce(h);
    });
  }
}

const question = { question: "Continue?", options: [], allowMultiple: false, allowFreeform: true, allowComment: false, contextExpanded: false };
for (const [method, invoke, defaultValue, lateReply] of [
  ["select", (ui, timeout) => ui.select("Choose", ["A"], { timeout }), undefined, { value: "A" }],
  ["confirm", (ui, timeout) => ui.confirm("Confirm", "Continue?", { timeout }), false, { confirmed: true }],
  ["input", (ui, timeout) => ui.input("Value", "", { timeout }), undefined, { value: "late" }],
  ["editor", (ui, timeout) => ui.editor("Edit", "", { timeout }), undefined, { value: "late" }],
  ["ask_user", (ui, timeout) => ui.askUser(question, timeout), null, { answer: { kind: "freeform", text: "late" } }],
]) {
  test(`explicit generic ${method} timeout still expires and ignores late replies`, async (t) => {
    const { wrapper, ui, events } = setup(t);
    const timeout = 1_500;
    const values = [];
    const waiting = invoke(ui, timeout);
    waiting.then((value) => values.push(value));
    const request = events.at(-1);
    assert.equal(request.method, method);
    assert.equal(request.timeout, timeout);
    assert.equal(request.expiresAt, NOW + timeout);
    t.mock.timers.tick(timeout - 1);
    await nextTurn();
    assert.deepEqual(values, []);
    assert.equal(wrapper.pendingUiRequests.has(request.id), true);
    assert.equal(wrapper.getPendingAttention().method, method);

    t.mock.timers.tick(1);
    assert.equal(await waiting, defaultValue);
    await wrapper.send({ type: "extension_ui_response", id: request.id, ...lateReply });
    assert.deepEqual(values, [defaultValue]);
    assert.equal(wrapper.pendingUiRequests.size, 0);
    assert.equal(wrapper.pendingUiResponses.size, 0);
    assert.equal(wrapper.pendingUiStartedAt.size, 0);
    assert.equal(wrapper.getPendingAttention(), null);
    assert.deepEqual(events.filter((event) => event.type === "extension_ui_closed"), [{ type: "extension_ui_closed", id: request.id }]);
    const replay = [];
    wrapper.onEvent((event) => replay.push(event))();
    assert.deepEqual(replay, []);
  });
}
