import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
const { AgentSession, SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
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

const nativeKinds = ["workspace", "workspace-attach", "preparation", "checkout-verification", "checkout-manual", "cleanup", "cleanup-clean"];
function nativeGitCard(name) {
  const oid = (c) => c.repeat(40), digest = (c) => c.repeat(64);
  const identity = { device: "1", inode: "2", birthtime: "3" };
  const physical = { gitDir: join(cwd, ".git"), checkoutIdentity: identity, gitIdentity: identity, markerIdentity: identity };
  const targetPath = join(root, "target"), parentPath = join(root, "project-worktrees");
  const attribution = { actionId: randomUUID(), repositoryRoot: cwd, projectRoot: cwd, sourceCheckoutRoot: cwd,
    resourceAttribution: { version: 2, commonDir: physical.gitDir, commonIdentity: identity, projectIdentity: identity } };
  let candidate, summary;
  if (name.startsWith("workspace")) {
    const mode = name === "workspace-attach" ? "attach" : "create";
    candidate = { ...attribution, kind: "workspace", workspace: { mode, destinationPath: join(parentPath, "new"), baseBranch: "main", baseOid: oid("a"), branch: "new", tipOid: oid("a"), treeOid: oid("b"),
      parentCreation: { path: parentPath, expectedAbsent: true, ancestorPath: root, ancestorIdentity: identity, mode: 448 } },
      diff: { fromTreeOid: oid("e"), toTreeOid: oid("b"), patch: "PRIVATE_CAPTURED_PATCH", hasBinaryChanges: false } };
    summary = mode === "create" ? "Approve exact worktree creation" : "Approve exact worktree attachment";
  } else if (name === "preparation") {
    candidate = { ...attribution, kind: "preparation", featureBranch: "feature", targetBranch: "main", targetCheckoutRoot: targetPath,
      preparation: { oldSourceOid: oid("c"), newSourceOid: oid("d"), targetMainOid: oid("a"), resultTreeOid: oid("b"), emptyRetention: "keep", commitCount: 1,
        commitMapping: [{ oldOid: oid("c"), newOid: oid("d"), oldTreeOid: oid("e"), newTreeOid: oid("b"), emptyAfterReplay: true }], source: physical, target: physical },
      diff: { fromTreeOid: oid("e"), toTreeOid: oid("b"), patch: "PRIVATE_CAPTURED_PATCH", hasBinaryChanges: true } };
    summary = "Approve exact history preparation";
  } else if (name.startsWith("checkout")) {
    const stage = name === "checkout-manual" ? "none" : "commit", sha = (v) => createHash("sha256").update(v).digest("hex");
    const recipe = { label: "Saved tests", argv: ["npm", "test"], cwd: ".", env: { CI: "1" }, requiredStage: stage };
    const snapshot = { version: 2, checkoutPath: sha(cwd), checkoutIdentity: sha(JSON.stringify({ project: identity, checkout: identity, common: identity, git: identity, marker: identity })),
      resourceIdentity: sha(physical.gitDir + "\0" + JSON.stringify(identity)), branch: sha("refs/heads/feature"), head: sha(oid("a")), tree: sha(oid("b")),
      index: digest("7"), status: digest("8"), refs: digest("9"), policyDigest: digest("2"), policyRevision: sha("saved-source-revision"),
      recipeDigest: sha(JSON.stringify(recipe)), checkDigest: sha(JSON.stringify({ checkIndex: 7, recipe })), cwdIdentity: sha(JSON.stringify({ cwd, ...identity })), environmentDigest: digest("4"), stageDigest: sha(stage) };
    candidate = { ...attribution, kind: "checkout-verification", featureBranch: "feature", checkoutVerification: {
      evidenceScope: stage === "commit" ? "working-workspace" : "clean-checkout", candidateTreeVerified: false, repositoryChecksWaived: false, sourceOid: oid("a"), sourceTreeOid: oid("b"), source: physical,
      snapshotDigest: stage === "commit" ? digest("1") : sha(JSON.stringify(snapshot)), policyDigest: digest("2"), policyRevision: "saved-source-revision", stage, requiredSavedIndexes: stage === "none" ? [] : [7],
      checks: [{ checkIndex: 7, recipe, recipeDigest: stage === "commit" ? digest("3") : snapshot.recipeDigest, environmentDigest: digest("4"), executionCwd: cwd,
        ...(stage === "commit" ? {} : { snapshot }) }] } };
    summary = "Approve saved checkout checks";
  } else {
    const ignored = name === "cleanup-clean" ? [] : ["cache", "cache/important"].map((path, index) => ({ path, kind: index ? "file" : "directory", ...identity, size: "12", mode: index ? "33152" : "16832", changed: "4", modified: "5" }));
    candidate = { ...attribution, kind: "cleanup", featureBranch: "feature", targetBranch: "main", targetCheckoutRoot: targetPath, cleanup: {
      featureOid: oid("a"), targetOid: oid("c"), mainOid: oid("c"), sourcePath: cwd, branchRef: "refs/heads/feature", targetPath, mainPath: targetPath,
      source: physical, target: physical, main: physical,
      integration: { completedAt: NOW - 100, delivery: "selected-local", method: "merge", actualFF: false, featureOid: oid("a"), previousTargetOid: oid("b"), resultOid: oid("c"), resultTree: oid("d"), parents: [oid("b"), oid("a")] },
      provenance: { mode: "create", originalSourcePath: targetPath, originalSource: physical, branchRef: "refs/heads/feature" },
      ignoredCount: ignored.length, ignoredDeletion: ignored.length ? "exact-approval-required" : "none", ignored } };
    summary = ignored.length ? "Approve cleanup and ALL named ignored-data deletion" : "Approve exact local cleanup";
  }
  return { method: "gitAction", candidate, summary, approval: { confirmed: true }, approvedValue: true, declinedValue: false,
    invalidReplies: [{ confirmed: "true" }, { cancelled: false }, { permission: "Allow" }, { confirmed: true, permission: "Allow" },
      { confirmed: true, reviewed: true }, { confirmed: true, ignoredDataDeletionApproved: true }, { confirmed: true, receiptIds: ["historical-receipt"] },
      { approvePlanId: candidate.actionId }, { confirmed: true, actionId: candidate.actionId }, { confirmed: true, cancelled: true },
      { preferences: { targetBranch: "main", mode: "worktree", checkIndexes: [7] } }, { confirmed: true, targetCheckoutRoot: targetPath }] };
}

function gitCard(kind) {
  if (nativeKinds.includes(kind)) return nativeGitCard(kind);
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
  assert.ok(decision, JSON.stringify(harness.errors));
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

for (const kind of ["preferences", "commit", "review", "checks", "integration", ...nativeKinds]) {
  for (const outcome of ["approval", "decline"]) {
    test(`Git ${kind} has no UI deadline, replays after a day offline, and settles ${outcome} once`, async (t) => {
      const card = gitCard(kind);
      const originalCandidate = structuredClone(card.candidate);
      const expectedDisplay = structuredClone(originalCandidate);
      if (nativeKinds.includes(kind)) delete expectedDisplay.diff;
      const h = await openGitQuestion(t, card);
      assert.equal(Object.hasOwn(h.request, "timeout"), false);
      assert.equal(Object.hasOwn(h.request, "expiresAt"), false);
      assert.deepEqual(h.request.candidate, expectedDisplay);
      if (nativeKinds.includes(kind)) {
        assert.notEqual(h.request.candidate, card.candidate, "native display must be a bounded independent copy");
        assert.equal(h.attention.summary, card.summary);
        assert.doesNotMatch(JSON.stringify(h.request), /PRIVATE_CAPTURED_PATCH|reviewToken|receiptIds|logContents/);
        assert.notEqual(h.request.id, card.candidate.actionId);
      }
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
      assert.deepEqual(replay, [{ type: "extension_ui_request", id: h.request.id, method: "git_action", candidate: expectedDisplay }]);
      assert.equal(replay[0], h.request, "reconnect reuses the original actual pending packet");
      assert.deepEqual(card.candidate, originalCandidate, "replay must not replace the candidate or renew native deadlines");
      if (kind === "integration") {
        assert.ok(h.request.candidate.plan.expiresAt < Date.now());
        assert.ok(h.request.candidate.receipts[0].expiresAt < Date.now());
      }

      if (outcome === "approval") {
        if (nativeKinds.includes(kind)) {
          await h.wrapper.send({ type: "extension_ui_response", id: card.candidate.actionId, confirmed: true });
          assertPending(h);
        }
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

for (const mode of ["whole-file", "staged"]) {
  test(`actual SDK Git commit request preserves the original ${mode} selection/check packet`, async (t) => {
    const card = gitCard("commit");
    card.candidate.preview.mode = mode;
    card.candidate.preview.paths = ["selected.txt"];
    const bytes = JSON.stringify(card.candidate);
    const h = await openGitQuestion(t, card);
    assert.equal(h.request.candidate, card.candidate);
    assert.equal(JSON.stringify(h.request.candidate), bytes);
    assert.equal(h.request.candidate.preview.mode, mode);
    assert.deepEqual(h.request.candidate.preview.paths, ["selected.txt"]);
    await respond(h, card.approval);
    await h.sending;
    assert.equal(await h.decision, true);
    assertClosedOnce(h);
  });
}

test("actual SDK routes reject wrong candidate roles, unknown future kinds, and unsupported native checkbox/receipt/ignored plans before enqueue", (t) => {
  const { ui, wrapper, events } = setup(t);
  const workspace = nativeGitCard("workspace").candidate, checks = nativeGitCard("checkout-verification").candidate, cleanup = nativeGitCard("cleanup").candidate;
  assert.throws(() => ui.gitPreferences(workspace), /preferences candidate required/);
  assert.throws(() => ui.gitAction(gitCard("preferences").candidate), /preferences question route/);
  assert.throws(() => ui.gitAction({ kind: "future-native-kind" }), /Unsupported Git action display kind/);
  for (const candidate of [
    { ...workspace, reviewed: true }, { ...workspace, workspace: { ...workspace.workspace, parentCreated: true } },
    { ...checks, checkoutVerification: { ...checks.checkoutVerification, receiptIds: ["historical"] } },
    { ...checks, checkoutVerification: { ...checks.checkoutVerification, checks: [{ ...checks.checkoutVerification.checks[0], recipe: { label: "Secret", argv: ["npm"], requiredStage: "commit", env: { TOKEN: "PRIVATE_ENV_SECRET" } } }] } },
    { ...cleanup, cleanup: { ...cleanup.cleanup, ignored: undefined } },
    { ...cleanup, cleanup: { ...cleanup.cleanup, ignoredDeletion: "none" } },
    { ...cleanup, cleanup: { ...cleanup.cleanup, ignored: [{ ...cleanup.cleanup.ignored[0], contents: "PRIVATE_IGNORED_CONTENT" }] } },
  ]) assert.throws(() => ui.gitAction(candidate));
  assert.equal(wrapper.pendingUiRequests.size, 0);
  assert.equal(wrapper.pendingUiResponses.size, 0);
  assert.equal(wrapper.getPendingAttention(), null);
  assert.deepEqual(events, []);
});

test("native SDK packet retains the exact captured source snapshot despite later caller changes and reconnect", async (t) => {
  const card = nativeGitCard("cleanup"), original = structuredClone(card.candidate);
  const h = await openGitQuestion(t, card);
  card.candidate.cleanup.ignored.length = 0;
  card.candidate.cleanup.ignoredCount = 0;
  card.candidate.cleanup.targetOid = "f".repeat(40);
  card.candidate.resourceAttribution.commonIdentity.inode = "999";
  assert.deepEqual(h.request.candidate, original);
  h.disconnect();
  const replay = [];
  const disconnect = h.wrapper.onEvent((event) => { replay.push(event); h.events.push(event); });
  t.after(disconnect);
  assert.deepEqual(replay, [h.request]);
  assert.equal(replay[0], h.request);
  assert.deepEqual(replay[0].candidate, original);
  await respond(h, { confirmed: true, ignoredDataDeletionApproved: true });
  assertPending(h);
  await respond(h, card.approval);
  await h.sending;
  assert.equal(await h.decision, true);
  assertClosedOnce(h);
});

test("future-kind pending-packet corruption fails closed at the actual response resolver, including cancellation", async (t) => {
  const h = await openGitQuestion(t, nativeGitCard("workspace"));
  const captured = h.request.candidate;
  h.request.candidate = { ...captured, kind: "future-native-kind" };
  for (const body of [{ confirmed: true }, { confirmed: false }, { cancelled: true }, { approvePlanId: captured.actionId }]) {
    await respond(h, body);
    assert.deepEqual(h.settlements, []);
    assert.equal(h.wrapper.pendingUiRequests.get(h.request.id), h.request);
    assert.equal(h.wrapper.pendingUiResponses.has(h.request.id), true);
  }
  assert.equal(h.wrapper.getPendingAttention().summary, "Unsupported Git request");
  h.request.candidate = captured;
  assertPending(h);
  await respond(h, h.card.approval);
  await h.sending;
  assert.equal(await h.decision, true);
  assertClosedOnce(h);
});

for (const kind of ["preferences", "commit", "integration", ...nativeKinds]) {
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

test("RPC fences the actual SDK writers before effect, including equal writes/restores/failures, but not transcript or journal appends", (t) => {
  const manager = SessionManager.inMemory(cwd);
  let wrapper, before, activeTools = ["read"];
  const original = (names) => {
    assert.notEqual(wrapper.readGitCheckAuthorityRevisionSync(), before, "epoch advances BEFORE the SDK setter effect");
    activeTools = [...names];
    if (names.includes("invalid")) throw new Error("fixture failed setter");
  };
  const inner = { sessionId: manager.getSessionId(), sessionManager: manager, settingsManager: SettingsManager.create(cwd, agentDir), agent: { state: {} }, dispose() {},
    setActiveToolsByName: original, getActiveToolNames: () => [...activeTools] };
  wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const initial = wrapper.readGitCheckAuthorityRevisionSync();
  for (const names of [["read"], ["edit"], ["read"]]) {
    before = wrapper.readGitCheckAuthorityRevisionSync();
    inner.setActiveToolsByName(names);
    assert.notEqual(wrapper.readGitCheckAuthorityRevisionSync(), before);
  }
  assert.deepEqual(activeTools, ["read"]);
  assert.notEqual(wrapper.readGitCheckAuthorityRevisionSync(), initial, "restoring values cannot renew an old fence");
  before = wrapper.readGitCheckAuthorityRevisionSync();
  assert.throws(() => inner.setActiveToolsByName(["invalid"]), /failed setter/);
  assert.notEqual(wrapper.readGitCheckAuthorityRevisionSync(), before);
  const neutral = wrapper.readGitCheckAuthorityRevisionSync();
  manager.appendCustomEntry("pi-web:git-action", { version: 1, actionId: randomUUID() });
  manager.appendMessage({ role: "user", content: "ordinary transcript", timestamp: Date.now() });
  assert.equal(wrapper.readGitCheckAuthorityRevisionSync(), neutral);
  manager.appendCustomEntry("pi-web:git-workflow-settings", { enabled: false });
  const off = wrapper.readGitCheckAuthorityRevisionSync();
  assert.notEqual(off, neutral);
  manager.appendCustomEntry("pi-web:git-workflow-settings", { enabled: true });
  assert.notEqual(wrapper.readGitCheckAuthorityRevisionSync(), off);
  before = wrapper.readGitCheckAuthorityRevisionSync();
  assert.throws(() => manager.branch("unknown-leaf"));
  assert.notEqual(wrapper.readGitCheckAuthorityRevisionSync(), before, "failed tree selection still fences");
  const instrumented = inner.setActiveToolsByName;
  inner.setActiveToolsByName = original;
  assert.throws(() => wrapper.readGitCheckAuthorityRevisionSync(), /instrumentation changed/);
  inner.setActiveToolsByName = instrumented;
  wrapper.destroy();
  assert.equal(inner.setActiveToolsByName, original);
  assert.throws(() => wrapper.readGitCheckAuthorityRevisionSync(), /provider unavailable/);
});

test("real saved SDK owner uses the registered RPC writer fence; change-and-restore cannot renew its captured authority", async (t) => {
  const { createGitCheckAuthorityFence } = await jiti.import("./git-check-authority-fence.ts");
  const manager = SessionManager.create(cwd, join(agentDir, "authority-sessions"));
  manager.appendMessage({ role: "user", content: "fixture owner", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], api: "openai-responses", provider: "openai", model: "fixture", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  let tools = ["read"];
  const wrapper = new AgentSessionWrapper({ sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager,
    settingsManager: SettingsManager.create(cwd, agentDir), agent: { state: {} }, dispose() {}, setActiveToolsByName: (names) => { tools = [...names]; }, getActiveToolNames: () => [...tools] });
  const oldRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[wrapper.sessionId, wrapper]]);
  t.after(() => { wrapper.destroy(); globalThis.__piSessions = oldRegistry; });
  const fence = createGitCheckAuthorityFence({ scope: { sessionId: wrapper.sessionId, sessionFile: manager.getSessionFile(), cwd }, agentDir, checkouts: [cwd] });
  const before = fence();
  manager.appendCustomEntry("pi-web:git-action", { version: 1, actionId: randomUUID() });
  assert.equal(fence(), before, "its own durable action anchor is not revocation");
  wrapper.inner.setActiveToolsByName(["edit"]);
  assert.notEqual(fence(), before);
  wrapper.inner.setActiveToolsByName(["read"]);
  assert.notEqual(fence(), before, "equal final values cannot renew the old capture");
});

test("unknown direct SDK hosts cannot supply a pretend live authority writer provider", (t) => {
  const { wrapper } = setup(t);
  assert.throws(() => wrapper.readGitCheckAuthorityRevisionSync(), /provider unavailable/);
});

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
