import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { createGitSelectedOperationController: create } = await jiti.import("./git-selected-operation-controller.ts");
const { resolveGitWorkflowSettings: resolve } = await jiti.import("./git-workflow-settings.ts");
const copy = (value) => structuredClone(value);
const signature = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
function modeledCheckSnapshot(source, sourceOid, revision, recipe, index, stage) {
  return { version: stage === "commit" ? 3 : 2, checkoutPath: signature(source.cwd), checkoutIdentity: signature(source.identities),
    resourceIdentity: signature(source.commonDir + "\0" + JSON.stringify(source.identities.common)), branch: signature(`refs/heads/${source.branch}`),
    head: signature(sourceOid), tree: signature(treeOid), index: signature("modeled-index"), status: signature("modeled-status"), refs: signature("modeled-refs"),
    policyDigest: signature("modeled-policy"), policyRevision: signature(revision), recipeDigest: signature(recipe),
    checkDigest: signature({ checkIndex: index, recipe }), cwdIdentity: signature(source.cwd), environmentDigest: signature("modeled-environment"), stageDigest: signature(stage),
    ...(stage === "commit" ? { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false } : {}) };
}
const oldOid = "a".repeat(40), newOid = "b".repeat(40), targetOid = "c".repeat(40), treeOid = "d".repeat(40);
const identity = (inode) => ({ device: "1", inode: String(inode), birthtime: "100" });
function resource(repo, branch, inode) {
  return { projectRoot: repo, cwd: `${repo}/${branch}`, branch, commonDir: `${repo}/.git`, gitDir: `${repo}/.git/worktrees/${branch}`,
    identities: { project: identity(repo === "/selected" ? 1 : 50), common: identity(repo === "/selected" ? 2 : 51),
      checkout: identity(inode), git: identity(inode + 1), marker: { ...identity(inode + 2), changed: "50", size: "20" } } };
}
const selector = (r) => ({ repositoryPath: r.projectRoot, checkoutPath: r.cwd });
const physicalKey = (r) => JSON.stringify([r.identities.project, r.identities.common, r.identities.checkout, r.identities.git]);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

/** UNIT FIXTURE ONLY: no subprocess, files, real Git, settings or history writes.
 * Fake adapters model independently completed identity registries and deliberately
 * broken adapters. Nothing here is a production native/admission implementation. */
function fixture({ nonGit = false } = {}) {
  const source = resource("/selected", "feature", 10), target = resource("/selected", "main", 20), current = resource("/caller", "main", 60);
  const owner = { sessionId: "ordinary-session", sessionFile: "/private/session.jsonl", sessionCwd: nonGit ? "/home/unit/pi-cwd-fresh" : current.cwd };
  const events = [], nativeCaptures = new WeakMap(), nativeCompletions = new WeakMap(), failures = new WeakMap(), seals = new WeakMap(), receiptRegistry = new Map();
  const resources = new Map([source, target, current].map((r) => [r.cwd, r]));
  let clock = 100, sourceOid = oldOid, targetHead = targetOid, realUserEntry = "user-1", callerRevision = "identity-tools-policy-1";
  let tools = ["read", "bash", "edit", "write"], subagent = false, persisted = true, trusted = true, promptCount = 0;
  const durablePreparations = new Set(), prerequisiteHost = new Map();
  let optedOut = false, chatDisabled = false, taskDisabled = false, unknownCurrent = false;
  let grant = "none", currentGrant = "none", decision = true, deny = false, paused = false, generation = 1;
  let settings = { mainBranch: "main", cleanup: "worktree-and-branch", prepareConfirmation: "ask", cleanupConfirmation: "ask",
    checks: [{ label: "Unit", argv: ["unit-check"], requiredStage: "integration" }] };
  let approvalHook, executionHook, completionHook, nativeJournalHook;
  const behavior = { noop: false, missingNative: false, missingDurable: false, fakeReceipt: false, missingReceipt: false,
    changedAfter: false, fail: false, partial: false, targetMoved: false, fakeMoved: false, ignoredNames: [], reconcileProven: true,
    orderingUnknown: false, crashBeforePublication: false, pendingNative: false, pendingDurable: false, downgradeCommitReceipt: false,
    rewriteOid: newOid, movedTargetOid: "e".repeat(40) };
  function policy(r) {
    const project = { ...settings }, resolved = resolve({}, project, {});
    return { revision: `policy-${generation}`, paused, optedOut: false, cwd: r.cwd, projectRoot: r.projectRoot, sessionScope: "project",
      global: {}, project, session: {}, resolved: { global: resolve(), project: resolved, session: resolved }, task: { kind: "none" }, sessionEditable: true };
  }
  const readers = {
    now: () => clock,
    readResources: async (s) => {
      events.push("resources");
      const r = resources.get(s.checkoutPath);
      if (!r) throw Error("unknown resource");
      return copy(r);
    },
    readCaller: async (o) => {
      events.push("caller"); assert.deepEqual(o, owner);
      const own = resolve(chatDisabled ? { enabled: false } : {}, undefined, {});
      return { persisted, revision: callerRevision, facts: { subagent, tools },
        current: nonGit ? { kind: "non-git", cwd: owner.sessionCwd, identity: identity(700),
          noRepository: { verified: !unknownCurrent, revision: "independently-verified-physical-ancestry-absence" } }
          : { kind: "git", resources: copy(current) },
        policy: nonGit ? { revision: `chat-${generation}`, paused, optedOut, global: chatDisabled ? { enabled: false } : {},
          session: {}, resolved: { global: own, project: own, session: own },
          task: taskDisabled ? { kind: "managed", settings: { ...own.values, enabled: false } } : { kind: "none" } } : policy(current) };
    },
    readPolicy: async (r) => { events.push("policy"); return policy(r); },
    readAuthorization: async (r) => {
      events.push("grant");
      return { revision: `grant-${generation}`, policyRevision: `policy-${generation}`,
        actions: Object.fromEntries(["workspace", "prepare", "checks", "integration", "cleanup"].map((k) => [k,
          { effective: deny ? "deny" : r.projectRoot === current.projectRoot ? currentGrant : grant }])) };
    },
    revalidateResources: async (r) => { events.push("revalidate-resources"); assert.deepEqual(r, resources.get(r.cwd)); },
    readCurrentPolicy: async (r) => { assert.equal(nonGit, false); events.push("current-policy"); return policy(r); },
    readCurrentAuthorization: async (r) => { assert.equal(nonGit, false); events.push("current-grant"); return readers.readAuthorization(r); },
    revalidateCurrent: async (r) => {
      if (nonGit) { assert.equal(r.kind, "non-git"); assert.equal(r.cwd, owner.sessionCwd); assert.equal(r.noRepository.verified, true); }
      else await readers.revalidateResources(r.resources);
    },
  };
  function paired(c, operationId) {
    return c.target ? { sessionId: owner.sessionId, operationId, policyRevision: c.policyRevision, source: copy(c.source), target: copy(c.target),
      sourceOid: c.sourceOid, targetOid: c.targetOid } : undefined;
  }
  const native = Object.fromEntries(["workspace", "prepare", "verify", "integrate", "cleanup", "reconcile"].map((operation) => [operation, {
    async capture(request, context) {
      events.push(`capture:${operation}`);
      assert.equal("revisionDependency" in request, false); assert.equal("confirmation" in request, false);
      if (operation === "integrate") {
        const required = settings.checks.map((recipe, i) => ({ recipe, i })).filter(({ recipe }) => (recipe.requiredStage ?? "integration") === "integration");
        const selected = request.receiptIds !== undefined ? context.receiptIds.map((id) => receiptRegistry.get(id))
          : required.map(({ i }) => [...receiptRegistry.values()].findLast((r) => r.stage === "integration" && r.checkIndex === i));
        if (selected.length !== required.length || selected.some((r) => !r || r.stage !== "integration"
          || !required.some(({ i }) => r.checkIndex === i)) || new Set(selected.map((r) => r?.checkIndex)).size !== required.length)
          throw Error("actual selected integration leaf refuses wrong-stage/missing required receipts");
      }
      const s = resources.get(request.selector.checkoutPath), t = operation === "cleanup" ? prerequisiteHost.get(physicalKey(s))?.integration?.proof.target
        : request.target ? resources.get(request.target.checkoutPath) : context.orderingState?.target;
      const c = { operation, revision: `candidate-${randomUUID()}`, source: copy(s), ...(t ? { target: copy(t), targetOid: targetHead } : {}),
        sourceOid: operation === "workspace" ? targetHead : sourceOid, policyRevision: `policy-${generation}`, history: { kind: operation === "prepare" ? "preparation" : operation === "reconcile" ? "review"
          : operation === "verify" ? "checkout-verification" : operation === "integrate" ? "integration" : operation,
        repositoryRoot: s.cwd, projectRoot: s.projectRoot },
        ...(operation === "workspace" || operation === "cleanup" ? { actionId: randomUUID() } : {}),
        ...(context.checks ? { checks: copy(context.checks) } : {}),
        ...(operation === "prepare" && behavior.noop ? { noEffect: "already-prepared" } : {}),
        ...(operation === "cleanup" ? { cleanup: { integrationHandle: context.integrationHandle, creatorHandle: context.creatorHandle,
          ignoredNames: [...behavior.ignoredNames] } } : {}) };
      const snapshots = context.checks?.checkIndexes.map((i) => modeledCheckSnapshot(s, c.sourceOid, c.policyRevision, settings.checks[i], i, context.checks.stage));
      if (operation === "verify") c.history.checkoutVerification = { evidenceScope: context.checks.stage === "commit" ? "working-workspace" : "clean-checkout",
        candidateTreeVerified: false, repositoryChecksWaived: false, stage: context.checks.stage, sourceOid: c.sourceOid, sourceTreeOid: treeOid,
        policyRevision: c.policyRevision, policyDigest: snapshots[0].policyDigest, snapshotDigest: signature(snapshots[0]),
        requiredSavedIndexes: context.checks.stage === "none" ? [] : settings.checks.map((r, i) => ({ r, i }))
          .filter(({ r }) => (r.requiredStage ?? "integration") === context.checks.stage).map(({ i }) => i),
        source: { gitDir: s.gitDir, checkoutIdentity: s.identities.checkout, gitIdentity: s.identities.git, markerIdentity: s.identities.marker },
        checks: context.checks.checkIndexes.map((i, n) => ({ checkIndex: i, recipe: settings.checks[i], recipeDigest: snapshots[n].recipeDigest,
          environmentDigest: snapshots[n].environmentDigest, executionCwd: s.cwd })) };
      const h = Object.freeze({}); nativeCaptures.set(h, { candidate: c, request, context, snapshots }); return h;
    },
    readCandidate: (h) => nativeCaptures.get(h)?.candidate,
    async assertExact(h) { assert.ok(nativeCaptures.has(h)); events.push(`exact:${operation}`); },
    async execute(h, execution) {
      events.push(`execute:${operation}`);
      const { candidate: c, request, snapshots } = nativeCaptures.get(h);
      assert.equal(execution.actionId, execution.journalAdmission.action.record.id);
      await execution.authorize();
      events.push(`effect:${operation}`);
      if (executionHook) await executionHook(operation, execution);
      const before = paired(c, execution.operationId), after = copy(before);
      if (behavior.targetMoved || behavior.fakeMoved) {
        const failure = Object.freeze({});
        if (behavior.targetMoved) {
          const moved = copy(before); moved.targetOid = behavior.movedTargetOid;
          failures.set(failure, { kind: "target-moved", actionId: execution.actionId, candidateRevision: c.revision,
            before, after: moved, noEffect: true, otherStateBefore: "independently-proven", otherStateAfter: "independently-proven" });
        }
        // Arbitrary strings/properties have no registry standing.
        throw behavior.fakeMoved ? { code: "target_moved", noEffect: true } : failure;
      }
      if (behavior.fail || behavior.partial) {
        const failure = Object.freeze({});
        if (behavior.partial) failures.set(failure, { kind: "partial", actionId: execution.actionId, candidateRevision: c.revision,
          recoveryRequired: true, preparation: { status: "partial-state", oldSourceOid: oldOid, observedSourceOid: newOid,
            newSourceOid: newOid, targetOid, treeOid, recoveryRequired: true, recoveryPath: "/private/not-projected" } });
        throw failure;
      }
      let completion;
      if (operation === "prepare") {
        const result = behavior.noop ? { status: "already-prepared", oldSourceOid: sourceOid, newSourceOid: sourceOid, targetOid: targetHead }
          : { status: "prepared", oldSourceOid: sourceOid, newSourceOid: behavior.rewriteOid, targetOid: targetHead, treeOid, recoveryPath: "/private/not-projected" };
        sourceOid = result.newSourceOid; after.sourceOid = sourceOid;
        if (!behavior.noop) durablePreparations.add(physicalKey(c.source));
        completion = { operation, result };
      } else if (operation === "verify") {
        const ids = [];
        for (const checkIndex of c.checks.checkIndexes) {
          await execution.authorize(); events.push(`check:${checkIndex}`); clock++;
          const receipt = { kind: "selected-checkout-verification", version: c.checks.stage === "commit" && !behavior.downgradeCommitReceipt ? 3 : 2,
            id: randomUUID(), sessionId: owner.sessionId, stage: c.checks.stage, selection: copy(c.source), checkIndex, exitStatus: 0,
            snapshot: copy(snapshots[c.checks.checkIndexes.indexOf(checkIndex)]), snapshotDigest: signature(snapshots[c.checks.checkIndexes.indexOf(checkIndex)]),
            policyRevision: c.policyRevision, policyDigest: c.history.checkoutVerification.policyDigest,
            recipeDigest: c.history.checkoutVerification.checks.find((r) => r.checkIndex === checkIndex).recipeDigest,
            executionCwd: c.source.cwd, environmentDigest: snapshots[c.checks.checkIndexes.indexOf(checkIndex)].environmentDigest,
            ...(c.checks.stage === "commit" ? { evidenceScope: "working-workspace",
              candidateTreeVerified: false, repositoryChecksWaived: false } : {}) };
          ids.push(receipt.id);
          if (!behavior.fakeReceipt) receiptRegistry.set(receipt.id, receipt);
        }
        completion = { operation, status: "passed", receiptIds: behavior.missingReceipt ? ids.slice(0, -1) : ids };
      } else if (operation === "integrate") {
        completion = { operation, result: { result: { status: "integrated" }, nativeOutcome: {
          checkoutAttempted: true, refUpdateCompleted: true, indexInstalled: true, completionVerified: true } },
        integration: { completedAt: clock, delivery: "selected-local", method: "ff", actualFF: true, feature: copy(c.source), target: copy(c.target),
          featureOid: c.sourceOid, previousTargetOid: c.targetOid, resultOid: sourceOid, resultTree: treeOid, parents: [targetHead], admissionActionId: execution.actionId } };
        targetHead = sourceOid; after.targetOid = sourceOid;
      } else if (operation === "workspace") {
        const destination = copy(source), w = request.workspace;
        const resultOid = w.mode === "create" ? w.expectedBaseOid : w.expectedTipOid;
        sourceOid = resultOid;
        completion = { operation, result: { status: w.mode === "create" ? "created" : "attached", actionId: execution.actionId,
          path: w.destinationPath, branch: w.branch, oid: resultOid, treeOid },
          creation: { mode: w.mode, destination, originalSource: copy(c.source), branchRef: `refs/heads/${w.branch}` },
          proof: { version: 1, outcome: "completed", status: "clean", actionId: execution.actionId, destination, mode: w.mode,
            sourceOid: c.sourceOid, baseOid: w.expectedBaseOid, branchRef: `refs/heads/${w.branch}`, resultOid, treeOid } };
      } else if (operation === "cleanup") {
        completion = { operation, proof: { actionId: execution.actionId } };
      } else {
        completion = { operation, disposition: execution.previousLaunch ? "recovered" : "revalidated", recoveryHandle: Object.freeze({}) };
      }
      const resultHandle = Object.freeze({});
      const envelope = { stage: "verified-pending-admission", actionId: execution.actionId, candidateRevision: c.revision,
        completedAt: clock, before, after, completion };
      if (behavior.changedAfter && after) after.sourceOid = "f".repeat(40);
      if (completionHook) await completionHook(operation, envelope);
      if (!behavior.missingNative) nativeCompletions.set(resultHandle, envelope);
      events.push(`native-completed:${operation}`);
      await execution.onNativeCompleted(resultHandle);
      if (!behavior.pendingNative) envelope.stage = "completed";
      events.push(`native-return:${operation}`);
      return resultHandle;
    },
    readNativeCompletion: (h) => nativeCompletions.get(h),
    readNativeFailure: (h) => h && typeof h === "object" ? failures.get(h) : undefined,
    retire(h) { events.push(`retire:${operation}`); nativeCaptures.delete(h); },
  }]));
  Object.assign(native, {
    readCleanupPrerequisites: async (o, s) => { assert.deepEqual(o, owner); const p = prerequisiteHost.get(physicalKey(s));
      return p?.integration && p?.creation ? p : undefined; },
    readReceipt: (id) => receiptRegistry.get(id),
    assertReceipt: async (c, r) => { assert.equal(receiptRegistry.get(r.id), r); events.push("authenticate-receipt"); },
    invalidateReceipts: () => { events.push("invalidate-receipts"); receiptRegistry.clear(); },
    assertReconciliation: async () => { events.push("independent-recovery"); if (!behavior.reconcileProven) throw Error("no independent admission/recovery proof"); },
  });
  const journalAdmission = {
    async begin(o, c) {
      assert.deepEqual(o, owner); events.push(`anchor:${c.operation}`);
      const record = { id: c.actionId ?? randomUUID(), sessionId: owner.sessionId, state: "proposed", kind: c.history.kind };
      return {
        action: { record, async update(state) { record.state = state; events.push(`journal:${state}`); }, release() { events.push("release-action"); } },
        workspaceAdmission: { assertAdmission: async () => {}, beginIntent: async () => { throw Error("unit adapter never runs actual leaf"); } },
        cleanup: { acquireUsageLease: async () => { throw Error("unit fixture only"); }, assertAdmission: async () => {}, beginIntent: async () => { throw Error("unit fixture only"); } },
        beginIntegrationIntent: async () => { throw Error("unit fixture only"); },
        async recordNativeCompletion(h) {
          events.push("durable-native-hook"); assert.ok(nativeCompletions.get(h) || behavior.missingNative);
          if (nativeJournalHook) await nativeJournalHook(nativeCompletions.get(h));
        },
        async sealCompletion(h) {
          events.push("seal-durable"); const seal = Object.freeze({}), actual = nativeCompletions.get(h);
          if (!behavior.missingDurable) seals.set(seal, { stage: behavior.pendingDurable ? "pending" : "completed",
            actionId: record.id, nativeHandle: h, candidateRevision: actual.candidateRevision });
          if (!behavior.missingDurable && !behavior.pendingDurable) {
            const completed = actual.completion;
            if (completed.operation === "integrate") {
              const key = physicalKey(completed.integration.feature), p = prerequisiteHost.get(key) ?? {};
              p.integration = { handle: seal, proof: completed.integration }; prerequisiteHost.set(key, p);
            } else if (completed.operation === "workspace") {
              const key = physicalKey(completed.creation.destination), p = prerequisiteHost.get(key) ?? {};
              p.creation = { handle: seal, proof: completed.creation }; prerequisiteHost.set(key, p);
            }
          }
          if (behavior.crashBeforePublication) throw Error("simulated crash AFTER actual native+journal+admission completion BEFORE live result publication");
          return seal;
        },
        readDurableCompletion: (s) => seals.get(s),
        async recordFailure(failure, context) { events.push(`failure:${context.executionStarted ? "recovery" : "blocked"}`); },
      };
    },
  };
  const bootstrap = { owner, authorization: readers, native, journalAdmission, now: () => clock,
    isTrusted: async () => trusted,
    currentUserRequestId: async () => realUserEntry,
    readPreparationOrderingRequirement: async (o, s) => {
      assert.deepEqual(o, owner); assert.deepEqual(s, resources.get(s.cwd));
      return behavior.orderingUnknown ? { kind: "unknown" } : { kind: durablePreparations.has(physicalKey(s)) ? "required" : "independent",
        source: copy(s), sourceOid, evidenceRevision: `physical-tip-preparation-evidence-${generation}` };
    },
    approveExact: async (input) => { promptCount++; events.push(`prompt:${input.operation}`); if (approvalHook) await approvalHook(input); return decision; } };
  const controller = create(bootstrap);
  const request = { selector: selector(source), target: selector(target) };
  const verifyRequest = { selector: selector(source), stage: "integration" };
  const workspaceRequest = { selector: selector(target), workspace: { repositoryPath: target.projectRoot, sourceCheckoutPath: target.cwd,
    destinationPath: source.cwd, branch: source.branch, baseBranch: "main", expectedBaseOid: targetOid, mode: "create" } };
  return { controller, bootstrap, native, behavior, request, verifyRequest, workspaceRequest, events, source, target, current, resources,
    promptCount: () => promptCount, receipts: receiptRegistry,
    setApprovalHook: (f) => { approvalHook = f; }, setExecutionHook: (f) => { executionHook = f; }, setCompletionHook: (f) => { completionHook = f; },
    setNativeJournalHook: (f) => { nativeJournalHook = f; },
    policy: (p) => { settings = { ...settings, ...p }; generation++; },
    set: (p) => {
      if ("optedOut" in p) optedOut = p.optedOut;
      if ("chatDisabled" in p) chatDisabled = p.chatDisabled;
      if ("taskDisabled" in p) taskDisabled = p.taskDisabled;
      if ("unknownCurrent" in p) unknownCurrent = p.unknownCurrent;
      if ("deny" in p) deny = p.deny;
      if ("grant" in p) grant = p.grant;
      if ("currentGrant" in p) currentGrant = p.currentGrant;
      if ("decision" in p) decision = p.decision;
      if ("trusted" in p) trusted = p.trusted;
      if ("subagent" in p) subagent = p.subagent;
      if ("persisted" in p) persisted = p.persisted;
      if ("tools" in p) tools = p.tools;
      if ("paused" in p) paused = p.paused;
      if ("callerRevision" in p) callerRevision = p.callerRevision;
      if ("userEntry" in p) realUserEntry = p.userEntry;
      if ("clock" in p) clock = p.clock;
      if ("sourceOid" in p) sourceOid = p.sourceOid;
      if ("targetHead" in p) targetHead = p.targetHead;
    } };
}
function blocked(r, code) { assert.equal(r.status, "blocked", JSON.stringify(r)); if (code) assert.equal(r.code, code); assert.equal(r.revisionDependency, undefined); }
function completed(r) { assert.equal(r.status, "completed", JSON.stringify(r)); return r; }
const executed = (f, operation) => f.events.filter((e) => e === `execute:${operation}`).length;

test("six single-request methods; actual native then durable completion then live dependency; no task/chat continuation", async () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.controller), ["workspace", "prepare", "verify", "integrate", "cleanup", "reconcile", "dispose"]);
  const p = completed(await f.controller.prepare(f.request));
  assert.match(p.revisionDependency, /^[a-f0-9]{64}$/);
  assert.equal(p.sourceOid, newOid); assert.equal(p.treeOid, treeOid);
  assert.equal(executed(f, "verify"), 0); assert.equal(executed(f, "integrate"), 0); assert.equal(executed(f, "cleanup"), 0);
  assert.ok(f.events.indexOf("prompt:prepare") < f.events.indexOf("execute:prepare"));
  assert.ok(f.events.indexOf("native-return:prepare") < f.events.indexOf("seal-durable"));
  assert.equal(f.promptCount(), 1);
  assert.equal(JSON.stringify(p).includes("recoveryPath"), false); assert.equal(JSON.stringify(p).includes("patch"), false);
});

test("default Ask despite saved Allow; explicit none only live matching Allow; saved deny/current deny/trust/coding owner refuse", async () => {
  for (const mode of ["default", "ask", "none"]) {
    const f = fixture(); f.set({ grant: "allow" }); f.policy({ prepareConfirmation: "none" });
    completed(await f.controller.prepare({ ...f.request, ...(mode === "default" ? {} : { confirmation: mode }) }));
    assert.equal(f.promptCount(), mode === "none" ? 0 : 1);
  }
  for (const state of [{ grant: "none" }, { deny: true }, { currentGrant: "deny" }, { trusted: false }, { tools: ["read"] },
    { subagent: true }, { persisted: false }, { paused: true }]) {
    const f = fixture(); f.policy({ prepareConfirmation: "none" }); f.set(state);
    blocked(await f.controller.prepare({ ...f.request, confirmation: "none" }));
    assert.equal(f.promptCount(), 0); assert.equal(executed(f, "prepare"), 0);
  }
});

test("exact refusal and human-wait revocation perform no effects or token issuance; no locks held across UI", async () => {
  const denied = fixture(); denied.set({ decision: false });
  blocked(await denied.controller.prepare(denied.request), "approval-denied"); assert.equal(executed(denied, "prepare"), 0);
  for (const change of [(f) => f.set({ deny: true }), (f) => f.set({ trusted: false }), (f) => f.policy({ checks: [] }),
    (f) => f.set({ callerRevision: "new-file-instance" }), (f) => f.set({ userEntry: "different-real-user" })]) {
    const f = fixture(); f.setApprovalHook(() => change(f));
    blocked(await f.controller.prepare(f.request)); assert.equal(executed(f, "prepare"), 0); assert.equal(f.promptCount(), 1);
  }
});

test("each native effect rereads live authorization; known partial facts survive without stale retry guidance", async () => {
  const revoked = fixture();
  revoked.setExecutionHook(async (_, execution) => { revoked.set({ deny: true }); await execution.authorize(); });
  const r = await revoked.controller.prepare(revoked.request);
  assert.equal(r.status, "recovery-required"); assert.equal(r.revisionDependency, undefined);
  const partial = fixture(); partial.behavior.partial = true;
  const p = await partial.controller.prepare(partial.request);
  assert.equal(p.status, "recovery-required"); assert.equal(p.recoveryRequired, true);
  assert.deepEqual(p.knownFacts, { observedSourceOid: newOid, newSourceOid: newOid, treeOid });
  assert.doesNotMatch(JSON.stringify(p), /retry|recoveryPath|patch/);
  partial.behavior.partial = false;
  blocked(await partial.controller.prepare(partial.request), "reconciliation-required");
});

test("candidate native registry and durable seal are BOTH mandatory; missing/unknown adapters never pretend success", async () => {
  const f = fixture();
  const broken = { ...f.bootstrap, native: { ...f.native, cleanup: undefined } };
  assert.throws(() => create(broken), /native-adapters-required/);
  for (const fault of ["missingNative", "missingDurable", "pendingNative", "pendingDurable"]) {
    const g = fixture(); g.behavior[fault] = true;
    const r = await g.controller.prepare(g.request);
    assert.equal(r.status, "recovery-required"); assert.equal(r.revisionDependency, undefined);
  }
});

test("strict public schemas cannot forward leaf hooks, commands, ownership, model chain IDs or batch continuations", async () => {
  for (const extra of [{ chainId: "new-scope" }, { actionId: randomUUID() }, { authorize: () => true }, { afterRef: () => {} },
    { commands: ["fake check"] }, { owner: {} }, { task: {} }, { then: ["verify", "integrate"] }]) {
    const f = fixture(); blocked(await f.controller.prepare({ ...f.request, ...extra }), "invalid-request");
    assert.equal(executed(f, "prepare"), 0); assert.equal(f.promptCount(), 0);
  }
  const f = fixture();
  blocked(await f.controller.workspace({ ...f.workspaceRequest, workspace: { ...f.workspaceRequest.workspace, afterAdd: () => {} } }), "invalid-request");
});

test("source/session physical fences block omission, new scope, guessed token, prequeue, reuse and fork", async () => {
  const f = fixture(), approval = deferred(), waiting = deferred();
  f.setApprovalHook(async () => { waiting.resolve(); await approval.promise; });
  const preparation = f.controller.prepare(f.request); await waiting.promise;
  blocked(await f.controller.verify(f.verifyRequest), "operation-in-progress");
  // A second refusal must NOT accidentally release the first request's busy fence.
  blocked(await f.controller.integrate(f.request), "operation-in-progress");
  approval.resolve(); const p = completed(await preparation); f.setApprovalHook(undefined);
  for (const request of [{ ...f.verifyRequest }, { ...f.verifyRequest, revisionDependency: "0".repeat(64) }])
    blocked(await f.controller.verify(request), "revision-dependency-required");
  blocked(await f.controller.integrate(f.request), "revision-dependency-required");
  blocked(await f.controller.prepare(f.request), "reconciliation-required");
  const v = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
  assert.notEqual(v.revisionDependency, p.revisionDependency);
  blocked(await f.controller.integrate({ ...f.request, revisionDependency: p.revisionDependency }), "revision-dependency-required");
  completed(await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency, receiptIds: v.receiptIds }));
  blocked(await f.controller.verify({ ...f.verifyRequest, revisionDependency: v.revisionDependency }), "revision-dependency-required");
});

test("all requested saved checks finish with actual sealed receipts before a completed successor; no fake/missing verifier proofs", async () => {
  const f = fixture(); f.policy({ checks: [{ label: "One", argv: ["one"], requiredStage: "integration" }, { label: "Two", argv: ["two"], requiredStage: "integration" }] });
  const p = completed(await f.controller.prepare(f.request));
  const v = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
  assert.equal(v.receiptIds.length, 2);
  assert.ok(f.events.indexOf("check:1") < f.events.lastIndexOf("seal-durable"));
  assert.equal(f.events.filter((e) => e === "authenticate-receipt").length, 2);
  for (const fault of ["fakeReceipt", "missingReceipt", "changedAfter", "fail"]) {
    const g = fixture(); const original = completed(await g.controller.prepare(g.request)); g.behavior[fault] = true;
    const failed = await g.controller.verify({ ...g.verifyRequest, revisionDependency: original.revisionDependency });
    assert.equal(failed.status, "recovery-required", JSON.stringify(failed)); assert.equal(failed.revisionDependency, undefined);
    blocked(await g.controller.verify({ ...g.verifyRequest, revisionDependency: original.revisionDependency }), "revision-dependency-required");
    g.behavior[fault] = false;
    blocked(await g.controller.verify(g.verifyRequest), "revision-dependency-required");
  }
});

test("zero-defined/no-required discovery precedes token consumption: no command/pass receipt/prompt/successor; integrate consumes ORIGINAL token", async () => {
  for (const checks of [[], [{ label: "Manual", argv: ["manual"], requiredStage: "none" }]]) {
    const f = fixture(); f.policy({ checks });
    const p = completed(await f.controller.prepare(f.request)), prompts = f.promptCount();
    const v = await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency });
    assert.equal(v.status, checks.length ? "no-required" : "no-defined"); assert.equal(v.receiptIds, undefined); assert.equal(v.revisionDependency, undefined);
    assert.equal(executed(f, "verify"), 0); assert.equal(f.promptCount(), prompts); assert.equal(f.receipts.size, 0);
    completed(await f.controller.integrate({ ...f.request, revisionDependency: p.revisionDependency }));
  }
});

test("stage discovery and ordering receipts are separate; selected receipt IDs never waive integration requirements", async () => {
  const f = fixture(); f.policy({ checks: [{ label: "Commit", argv: ["commit"], requiredStage: "commit" }, { label: "Integration", argv: ["integration"], requiredStage: "integration" }] });
  const p = completed(await f.controller.prepare(f.request));
  const v = completed(await f.controller.verify({ ...f.verifyRequest, stage: "commit", revisionDependency: p.revisionDependency }));
  // Trusted integration capture owns actual integration receipt selection; the
  // ordering ledger permits commit-stage receipts without treating them as required integration checks.
  let received;
  const originalCapture = f.native.integrate.capture;
  f.native.integrate.capture = async (request, context) => { received = context; throw Error("missing actual required integration receipt"); };
  blocked(await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency, receiptIds: [] }));
  assert.deepEqual(received.receiptIds, []); assert.ok(received.orderingState);
  f.native.integrate.capture = originalCapture;
});

test("ordinary no-op issues nothing, never renews/clears an outstanding dependency, and adds no approval prompt", async () => {
  const f = fixture(), p = completed(await f.controller.prepare(f.request)); f.behavior.noop = true;
  const n = await f.controller.prepare(f.request);
  assert.equal(n.status, "already-prepared"); assert.equal(n.revisionDependency, undefined); assert.equal(f.promptCount(), 1);
  blocked(await f.controller.integrate(f.request), "revision-dependency-required");
  completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
});

test("explicit independent reconciliation clears receipts, restarts zero, and allows at most THREE renewals in the same server chain", async () => {
  const f = fixture(), p = completed(await f.controller.prepare(f.request));
  const v = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
  assert.ok(f.receipts.size);
  let latest;
  for (let i = 0; i < 3; i++) latest = completed(await f.controller.reconcile(f.request));
  assert.notEqual(latest.revisionDependency, v.revisionDependency); assert.equal(f.receipts.size, 0);
  const fourth = await f.controller.reconcile(f.request);
  assert.equal(fourth.status, "recovery-required"); assert.equal(fourth.revisionDependency, undefined);
  blocked(await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency }), "revision-dependency-required");
  const g = fixture(); completed(await g.controller.prepare(g.request)); g.behavior.reconcileProven = false;
  const refused = await g.controller.reconcile(g.request);
  assert.equal(refused.status, "recovery-required"); assert.equal(refused.revisionDependency, undefined);
});

test("completed failure requires independent recovery reconciliation, not retry; generation/restart cannot replay result or token", async () => {
  const f = fixture(), p = completed(await f.controller.prepare(f.request)); f.behavior.fail = true;
  assert.equal((await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency })).status, "recovery-required");
  f.behavior.fail = false;
  const restored = completed(await f.controller.reconcile(f.request));
  completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: restored.revisionDependency }));
  const restarted = create(f.bootstrap);
  blocked(await restarted.integrate({ ...f.request, revisionDependency: restored.revisionDependency }), "revision-dependency-required");
  blocked(await restarted.integrate(f.request), "revision-dependency-required");
  const fresh = completed(await restarted.reconcile(f.request));
  assert.notEqual(fresh.revisionDependency, restored.revisionDependency);
  f.controller.dispose(); blocked(await f.controller.prepare(f.request), "controller-disposed");
});

test("identical project names/path strings in a replaced physical repository do not share local ordering/capabilities", async () => {
  const f = fixture(), p = completed(await f.controller.prepare(f.request));
  const replaced = copy(f.source); replaced.identities.common.inode = "999"; replaced.identities.checkout.inode = "1000";
  f.resources.set(replaced.cwd, replaced);
  blocked(await f.controller.integrate({ ...f.request, revisionDependency: p.revisionDependency }), "invalid-revision-dependency");
  completed(await f.controller.verify(f.verifyRequest)); // This physical instance is genuinely independent.
  // Capture another repository with the same branch names cannot inherit the original capability.
  const second = resource("/another-selected", "feature", 100); f.resources.set(second.cwd, second);
  blocked(await f.controller.verify({ ...f.verifyRequest, selector: selector(second), revisionDependency: p.revisionDependency }), "invalid-revision-dependency");
  assert.equal(executed(f, "integrate"), 0);
});

test("proven typed target movement retires approvals/receipts and returns to agent; bounded by current real user-entry scope", async () => {
  const f = fixture(); f.policy({ checks: [] }); f.behavior.targetMoved = true;
  for (let i = 1; i <= 3; i++) {
    const r = await f.controller.integrate(f.request);
    assert.equal(r.status, "target-moved"); assert.equal(r.recoveryRequired, undefined); assert.equal(r.movement.count, i);
    // Prior movement chains have no token; independent reconciliation is required
    // before another dependent attempt, never an automatic recapture/retry.
    if (i < 3) {
      f.behavior.targetMoved = false;
      const renewed = completed(await f.controller.reconcile({ selector: f.request.selector, target: f.request.target }));
      f.behavior.targetMoved = true;
      f.request.revisionDependency = renewed.revisionDependency;
    }
  }
  blocked(await f.controller.integrate(f.request), "contention-limit"); assert.equal(executed(f, "integrate"), 3);
  const fake = fixture(); fake.policy({ checks: [] }); fake.behavior.fakeMoved = true;
  const r = await fake.controller.integrate(fake.request);
  assert.equal(r.status, "recovery-required"); assert.equal(r.movement, undefined);
});

test("typed target movement allows ONLY a NEW independently authorized prepare; no stale target/launch, no-op renewal or automatic continuation", async () => {
  const f = fixture({ nonGit: true }), p = completed(await f.controller.prepare(f.request));
  const v = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
  let operationId;
  f.setExecutionHook((op, x) => { if (op === "integrate") operationId = x.operationId; });
  f.behavior.targetMoved = true;
  const moved = await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency, receiptIds: v.receiptIds });
  assert.equal(moved.status, "target-moved"); assert.equal(moved.movement.count, 1); assert.equal(f.receipts.size, 0);
  assert.equal(executed(f, "prepare"), 1); // Returning to agent never runs another request.
  f.behavior.targetMoved = false; f.set({ targetHead: f.behavior.movedTargetOid });
  blocked(await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency }), "revision-dependency-required");
  blocked(await f.controller.verify({ ...f.verifyRequest, revisionDependency: v.revisionDependency }), "revision-dependency-required");
  const capture = f.native.prepare.capture;
  f.native.prepare.capture = async (request, context) => { assert.equal(context.orderingState, undefined); assert.equal(context.operationId, operationId); return capture(request, context); };
  f.setExecutionHook((op, x) => { if (op === "prepare") { assert.equal(x.operationId, operationId); assert.equal(x.previousLaunch, undefined); } });
  f.behavior.noop = true;
  const noop = await f.controller.prepare(f.request); assert.equal(noop.status, "already-prepared"); assert.equal(noop.revisionDependency, undefined);
  blocked(await f.controller.integrate(f.request), "revision-dependency-required");
  f.behavior.noop = false; f.behavior.rewriteOid = "d".repeat(40);
  const fresh = completed(await f.controller.prepare(f.request)); assert.ok(fresh.revisionDependency); assert.notEqual(fresh.revisionDependency, v.revisionDependency);
  const checked = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: fresh.revisionDependency }));
  completed(await f.controller.integrate({ ...f.request, revisionDependency: checked.revisionDependency, receiptIds: checked.receiptIds }));
});

test("fresh preparation/checks preserve SAME-user movement budget through three winners; only a real new user key gets a new budget", async () => {
  for (const confirmation of ["ask", "none"]) {
    const f = fixture({ nonGit: true });
    if (confirmation === "none") { f.set({ grant: "allow" }); f.policy({ prepareConfirmation: "none", integrateConfirmation: "none", checkConfirmation: "none" }); }
    const request = { ...f.request, confirmation }, verify = { ...f.verifyRequest, confirmation };
    let p = completed(await f.controller.prepare(request));
    for (let count = 1; count <= 3; count++) {
      const checked = completed(await f.controller.verify({ ...verify, revisionDependency: p.revisionDependency }));
      f.behavior.movedTargetOid = ["e", "f", "1"][count - 1].repeat(40); f.behavior.targetMoved = true;
      const moved = await f.controller.integrate({ ...request, revisionDependency: checked.revisionDependency });
      assert.equal(moved.status, "target-moved"); assert.deepEqual(moved.movement, { count, limit: 3, returnToAgent: true });
      f.behavior.targetMoved = false; f.set({ targetHead: f.behavior.movedTargetOid });
      if (count < 3) { f.behavior.rewriteOid = ["d", "2"][count - 1].repeat(40); p = completed(await f.controller.prepare(request)); }
    }
    const prompts = f.promptCount(), prepares = executed(f, "prepare");
    blocked(await f.controller.prepare(request), "contention-limit"); blocked(await f.controller.verify(verify), "contention-limit");
    assert.equal(f.promptCount(), prompts); assert.equal(executed(f, "prepare"), prepares);
    f.set({ userEntry: "genuine-new-persisted-user-entry" }); f.behavior.rewriteOid = "3".repeat(40);
    p = completed(await f.controller.prepare(request));
    const checked = completed(await f.controller.verify({ ...verify, revisionDependency: p.revisionDependency }));
    f.behavior.targetMoved = true; f.behavior.movedTargetOid = "4".repeat(40);
    const next = await f.controller.integrate({ ...request, revisionDependency: checked.revisionDependency });
    assert.equal(next.status, "target-moved"); assert.equal(next.movement.count, 1);
    // Neither the new rewrite nor the new user's scope erases the OLD counter.
    f.set({ userEntry: "user-1" }); blocked(await f.controller.prepare(request), "contention-limit");
    if (confirmation === "none") assert.equal(f.promptCount(), 0);
  }
});

test("movement marker is never restored from fake failure/history/restart, cannot retarget prepare or mask live revocation/uncertainty", async () => {
  async function movedFixture() {
    const f = fixture({ nonGit: true }), p = completed(await f.controller.prepare(f.request));
    const v = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
    f.behavior.targetMoved = true;
    assert.equal((await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency })).status, "target-moved");
    f.behavior.targetMoved = false; f.set({ targetHead: f.behavior.movedTargetOid }); f.behavior.rewriteOid = "d".repeat(40); return f;
  }
  const restarted = await movedFixture(); blocked(await create(restarted.bootstrap).prepare(restarted.request), "reconciliation-required");
  const unknown = await movedFixture(); unknown.behavior.orderingUnknown = true; blocked(await unknown.controller.prepare(unknown.request), "reconciliation-required");
  const altered = await movedFixture(); altered.set({ sourceOid: "9".repeat(40) }); blocked(await altered.controller.prepare(altered.request), "reconciliation-required");
  const otherTarget = await movedFixture(), foreign = resource("/selected", "other-target", 90); otherTarget.resources.set(foreign.cwd, foreign);
  blocked(await otherTarget.controller.prepare({ ...otherTarget.request, target: selector(foreign) }), "reconciliation-required");
  for (const change of [{ deny: true }, { trusted: false }, { tools: ["read"] }, { unknownCurrent: true }]) {
    const f = await movedFixture(); f.set(change); const count = executed(f, "prepare");
    blocked(await f.controller.prepare(f.request)); assert.equal(executed(f, "prepare"), count);
  }
  const revokedDuringPrepare = await movedFixture();
  revokedDuringPrepare.setExecutionHook(async (op, x) => { if (op === "prepare") { revokedDuringPrepare.set({ callerRevision: "revoked-during-fresh-prepare" }); await x.authorize(); } });
  assert.equal((await revokedDuringPrepare.controller.prepare(revokedDuringPrepare.request)).status, "recovery-required");
  revokedDuringPrepare.setExecutionHook(undefined); blocked(await revokedDuringPrepare.controller.prepare(revokedDuringPrepare.request), "reconciliation-required");
  const failed = await movedFixture(); failed.behavior.fail = true;
  assert.equal((await failed.controller.prepare(failed.request)).status, "recovery-required"); failed.behavior.fail = false;
  blocked(await failed.controller.prepare(failed.request), "reconciliation-required");
  const fake = fixture(), p = completed(await fake.controller.prepare(fake.request));
  const v = completed(await fake.controller.verify({ ...fake.verifyRequest, revisionDependency: p.revisionDependency }));
  fake.behavior.fakeMoved = true;
  assert.equal((await fake.controller.integrate({ ...fake.request, revisionDependency: v.revisionDependency })).status, "recovery-required");
  fake.behavior.fakeMoved = false; fake.behavior.rewriteOid = "d".repeat(40); blocked(await fake.controller.prepare(fake.request), "reconciliation-required");
  for (const copyError of [(error) => ({ ...error }), (error) => new Error(error.message), (error) => structuredClone(error)]) {
    const f = fixture(), p = completed(await f.controller.prepare(f.request));
    const v = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
    const execute = f.native.integrate.execute;
    f.native.integrate.execute = async (...args) => { try { return await execute(...args); } catch (error) { throw copyError(error); } };
    f.behavior.targetMoved = true;
    const refused = await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency });
    assert.equal(refused.status, "recovery-required"); assert.equal(refused.movement, undefined);
    f.behavior.targetMoved = false; f.behavior.rewriteOid = "d".repeat(40); blocked(await f.controller.prepare(f.request), "reconciliation-required");
  }
});

test("cleanup requires sealed integration AND eligible creation; named ignored data needs exact approval even saved Allow", async () => {
  const f = fixture(); f.policy({ checks: [] }); blocked(await f.controller.cleanup({ selector: selector(f.source) }), "sealed-cleanup-proofs-required");
  completed(await f.controller.workspace(f.workspaceRequest));
  const p = completed(await f.controller.prepare(f.request));
  completed(await f.controller.integrate({ ...f.request, revisionDependency: p.revisionDependency }));
  f.set({ grant: "allow" }); f.policy({ cleanupConfirmation: "none" }); f.behavior.ignoredNames = ["cache.bin"];
  const before = f.promptCount();
  blocked(await f.controller.cleanup({ selector: selector(f.source), confirmation: "none" }), "exact-ignored-approval-required");
  assert.equal(f.promptCount(), before);
  f.set({ decision: false });
  blocked(await f.controller.cleanup({ selector: selector(f.source), confirmation: "none", ignoredNames: ["cache.bin"] }), "approval-denied");
  assert.equal(f.promptCount(), before + 1); assert.equal(executed(f, "cleanup"), 0);
  f.set({ decision: true });
  completed(await f.controller.cleanup({ selector: selector(f.source), confirmation: "none", ignoredNames: ["cache.bin"] }));
  assert.equal(f.promptCount(), before + 2);
  const attached = fixture(); attached.policy({ checks: [] });
  completed(await attached.controller.workspace({ ...attached.workspaceRequest, workspace: { ...attached.workspaceRequest.workspace,
    mode: "attach", expectedTipOid: oldOid } }));
  completed(await attached.controller.integrate(attached.request));
  blocked(await attached.controller.cleanup({ selector: selector(attached.source) }), "sealed-cleanup-proofs-required");
});

test("crash after actual native+journal+admission, before live result projection: durable history ONLY denies in the new generation", async () => {
  const f = fixture(); f.behavior.crashBeforePublication = true;
  const crashed = await f.controller.prepare(f.request);
  assert.equal(crashed.status, "recovery-required"); assert.equal(crashed.revisionDependency, undefined);
  assert.deepEqual(crashed.knownFacts, { newSourceOid: newOid, treeOid });
  assert.ok(f.events.includes("native-return:prepare") && f.events.includes("seal-durable"));
  f.behavior.crashBeforePublication = false;
  const replacement = create(f.bootstrap);
  blocked(await replacement.verify(f.verifyRequest), "revision-dependency-required");
  blocked(await replacement.integrate(f.request), "revision-dependency-required");
  blocked(await replacement.integrate({ ...f.request, revisionDependency: "0".repeat(64) }), "revision-dependency-required");
  // Old history/result objects cannot be restored as dependencies or callbacks.
  blocked(await replacement.verify({ ...f.verifyRequest, revisionDependency: crashed }), "invalid-request");
  f.behavior.noop = true;
  assert.equal((await replacement.prepare(f.request)).status, "already-prepared");
  blocked(await replacement.verify(f.verifyRequest), "revision-dependency-required");
  f.behavior.noop = false;
  const reconciled = completed(await replacement.reconcile(f.request));
  assert.match(reconciled.revisionDependency, /^[a-f0-9]{64}$/);
  assert.equal(reconciled.receiptIds, undefined); assert.equal(f.receipts.size, 0);
  completed(await replacement.verify({ ...f.verifyRequest, revisionDependency: reconciled.revisionDependency }));
});

test("native callback pending admission cannot publish ordering; only awaited native + completed durable seal produce a live token", async () => {
  const f = fixture(), hookEntered = deferred(), releaseHook = deferred();
  f.setNativeJournalHook(async (envelope) => {
    assert.equal(envelope.stage, "verified-pending-admission");
    assert.equal(f.events.includes("native-return:prepare"), false);
    assert.equal(f.events.includes("seal-durable"), false);
    hookEntered.resolve(); await releaseHook.promise;
  });
  let published = false;
  const pending = f.controller.prepare(f.request).then((r) => { published = true; return r; });
  await hookEntered.promise;
  assert.equal(published, false);
  const replacement = create(f.bootstrap);
  blocked(await replacement.verify(f.verifyRequest), "revision-dependency-required");
  blocked(await replacement.integrate(f.request), "revision-dependency-required");
  releaseHook.resolve(); const p = completed(await pending);
  assert.match(p.revisionDependency, /^[a-f0-9]{64}$/);
  assert.equal(f.events.includes("native-return:prepare"), true);
  assert.equal(f.events.includes("seal-durable"), true);
  f.setNativeJournalHook(undefined);
  blocked(await replacement.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }), "revision-dependency-required");
});

test("unknown ordering is fail-closed, not a disabled adapter; fresh independently proved reconciliation is the only exact-epoch override", async () => {
  const f = fixture(); f.behavior.orderingUnknown = true;
  blocked(await f.controller.verify(f.verifyRequest), "ordering-state-unavailable");
  blocked(await f.controller.integrate(f.request), "ordering-state-unavailable");
  assert.equal(executed(f, "verify"), 0); assert.equal(executed(f, "integrate"), 0);
  assert.equal(f.promptCount(), 0);
  const r = completed(await f.controller.reconcile(f.request));
  completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: r.revisionDependency }));
  const replacement = create(f.bootstrap);
  blocked(await replacement.verify(f.verifyRequest), "ordering-state-unavailable");
  const g = fixture();
  assert.throws(() => create({ ...g.bootstrap, readPreparationOrderingRequirement: undefined }), /trusted-bootstrap-required/);
  g.bootstrap.readPreparationOrderingRequirement = async () => { throw Error("evidence unavailable"); };
  const unavailable = create(g.bootstrap);
  blocked(await unavailable.integrate(g.request)); assert.equal(executed(g, "integrate"), 0);
});

test("never-prepared ordinary sources run independently; same-path other physical instance does not inherit historical classification", async () => {
  const independent = fixture();
  completed(await independent.controller.verify(independent.verifyRequest));
  completed(await independent.controller.integrate(independent.request));
  const f = fixture(); f.behavior.crashBeforePublication = true;
  assert.equal((await f.controller.prepare(f.request)).status, "recovery-required");
  f.behavior.crashBeforePublication = false;
  const changed = copy(f.source); changed.identities.common = identity(1001); changed.identities.checkout = identity(1002);
  f.resources.set(changed.cwd, changed);
  const replacement = create(f.bootstrap);
  const r = completed(await replacement.verify(f.verifyRequest));
  assert.equal(r.revisionDependency, undefined);
  assert.equal(r.scope.checkoutPath, f.source.cwd);
});

test("journal/progress appends do not manufacture caller revisions or reprompt; genuine relevant generations do revoke", async () => {
  const f = fixture();
  f.setApprovalHook(() => { f.events.push("unrelated-progress-entry", "unrelated-action-history-entry"); });
  completed(await f.controller.prepare(f.request)); assert.equal(f.promptCount(), 1);
  const g = fixture(); g.setApprovalHook(() => g.set({ callerRevision: "new-effective-tool-selection-revision" }));
  blocked(await g.controller.prepare(g.request), "revision-changed"); assert.equal(g.promptCount(), 1);
});

test("mutable shared native candidate objects cannot retarget an already exact-approved request", async () => {
  const f = fixture(), originalRead = f.native.prepare.readCandidate;
  f.setApprovalHook(() => {
    f.native.prepare.readCandidate = (h) => {
      const candidate = originalRead(h);
      if (candidate) candidate.sourceOid = "e".repeat(40);
      return candidate;
    };
  });
  blocked(await f.controller.prepare(f.request), "native-candidate-changed");
  assert.equal(executed(f, "prepare"), 0); assert.equal(f.promptCount(), 1);
});

test("unknown historical state after a completed preparation needs fresh reconciliation, not merely remembered preparation maps", async () => {
  const f = fixture(), p = completed(await f.controller.prepare(f.request));
  f.behavior.orderingUnknown = true;
  blocked(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }), "ordering-state-unavailable");
  const current = completed(await f.controller.reconcile(f.request));
  completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: current.revisionDependency }));
});

test("stale same-path historical classification cannot masquerade as an independently classified other physical instance", async () => {
  const f = fixture(), oldResource = copy(f.source);
  const replaced = copy(f.source); replaced.identities.common = identity(2000);
  f.resources.set(replaced.cwd, replaced);
  const b = { ...f.bootstrap, readPreparationOrderingRequirement: async () => ({ kind: "independent",
    source: oldResource, sourceOid: oldOid, evidenceRevision: "stale-old-instance" }) };
  const controller = create(b);
  blocked(await controller.verify(f.verifyRequest), "ordering-state-unavailable");
  assert.equal(executed(f, "verify"), 0);
});

test("optional stage:none runs ONLY explicitly selected saved indexes; no-required lookup remains non-executing", async () => {
  const f = fixture(); f.policy({ checks: [{ label: "Manual", argv: ["manual"], requiredStage: "none" }] });
  const before = f.promptCount();
  assert.equal((await f.controller.verify({ ...f.verifyRequest, stage: "none" })).status, "no-required");
  assert.equal((await f.controller.verify(f.verifyRequest)).status, "no-required");
  assert.equal(executed(f, "verify"), 0); assert.equal(f.promptCount(), before); assert.equal(f.receipts.size, 0);
  const r = completed(await f.controller.verify({ ...f.verifyRequest, stage: "none", checkIndexes: [0] }));
  assert.equal(r.receiptIds.length, 1); assert.equal(r.revisionDependency, undefined);
  assert.equal(f.receipts.get(r.receiptIds[0]).stage, "none"); assert.equal(executed(f, "verify"), 1);
  assert.equal(f.promptCount(), before + 1);
});

test("optional/repeated receipts advance PRIVATE ordering; integration receives ONLY required-stage subset, not all ledger reconstruction", async () => {
  const f = fixture(); f.policy({ checks: [{ label: "Manual", argv: ["manual"], requiredStage: "none" },
    { label: "Required", argv: ["required"], requiredStage: "integration" }] });
  const p = completed(await f.controller.prepare(f.request));
  const one = completed(await f.controller.verify({ ...f.verifyRequest, stage: "none", checkIndexes: [0], revisionDependency: p.revisionDependency }));
  const two = completed(await f.controller.verify({ ...f.verifyRequest, stage: "none", checkIndexes: [0], revisionDependency: one.revisionDependency }));
  assert.notEqual(one.receiptIds[0], two.receiptIds[0]);
  const required = completed(await f.controller.verify({ ...f.verifyRequest, checkIndexes: [1], revisionDependency: two.revisionDependency }));
  assert.equal(f.receipts.size, 3);
  const originalCapture = f.native.integrate.capture;
  let submitted;
  f.native.integrate.capture = async (request, context) => { submitted = [...context.receiptIds]; return originalCapture(request, context); };
  completed(await f.controller.integrate({ ...f.request, revisionDependency: required.revisionDependency, receiptIds: required.receiptIds }));
  assert.deepEqual(submitted, required.receiptIds);
  assert.equal(submitted.includes(one.receiptIds[0]) || submitted.includes(two.receiptIds[0]), false);
});

test("manual receipts never satisfy integration prerequisites, even when required-stage selection is empty", async () => {
  for (const includeRequired of [false, true]) {
    const f = fixture(); f.policy({ checks: [{ label: "Manual", argv: ["manual"], requiredStage: "none" },
      ...(includeRequired ? [{ label: "Required", argv: ["required"], requiredStage: "integration" }] : [])] });
    const p = completed(await f.controller.prepare(f.request));
    blocked(await f.controller.verify({ ...f.verifyRequest, checkIndexes: [0], revisionDependency: p.revisionDependency }), "check-stage-mismatch");
    const m = completed(await f.controller.verify({ ...f.verifyRequest, stage: "none", checkIndexes: [0], revisionDependency: p.revisionDependency }));
    blocked(await f.controller.integrate({ ...f.request, revisionDependency: m.revisionDependency, receiptIds: m.receiptIds }));
    assert.equal(executed(f, "integrate"), 0);
    if (includeRequired) {
      const required = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: m.revisionDependency }));
      // No mandatory workflow ID or complete-ledger reconstruction: the bridge
      // independently selects the current exact required-stage receipt when IDs are omitted.
      completed(await f.controller.integrate({ ...f.request, revisionDependency: required.revisionDependency }));
    } else {
      assert.equal((await f.controller.verify({ ...f.verifyRequest, revisionDependency: m.revisionDependency })).status, "no-required");
      completed(await f.controller.integrate({ ...f.request, revisionDependency: m.revisionDependency, receiptIds: [] }));
    }
  }
});

test("persisted positively verified non-Git chat operates selected B without moving, adopting a task or importing A's recipes/grants", async () => {
  const f = fixture({ nonGit: true }), cwd = f.bootstrap.owner.sessionCwd;
  const p = completed(await f.controller.prepare(f.request));
  const v = completed(await f.controller.verify({ ...f.verifyRequest, revisionDependency: p.revisionDependency }));
  completed(await f.controller.integrate({ ...f.request, revisionDependency: v.revisionDependency, receiptIds: v.receiptIds }));
  assert.equal(f.bootstrap.owner.sessionCwd, cwd);
  assert.equal(f.events.includes("current-policy") || f.events.includes("current-grant"), false);
  assert.equal(executed(f, "workspace"), 0); assert.equal(executed(f, "cleanup"), 0);
  for (const [state, code] of [[{ optedOut: true }, "opted-out"], [{ paused: true }, "paused"], [{ chatDisabled: true }, "disabled"],
    [{ taskDisabled: true }, "disabled"], [{ tools: ["read"] }, "coding-tools-required"], [{ unknownCurrent: true }, "caller-identity-unavailable"]]) {
    const g = fixture({ nonGit: true }); g.set(state);
    blocked(await g.controller.prepare(g.request), code); assert.equal(executed(g, "prepare"), 0);
  }
});

test("modeled commit receipt gate rejects v2; source-only handoff/direct-main preserve actual recipe indexes", async () => {
  const checks = [{ label: "Manual", argv: ["manual"], requiredStage: "none" },
    { label: "Commit", argv: ["commit-check"], requiredStage: "commit" }, { label: "Handoff", argv: ["handoff-check"], requiredStage: "handoff" }];
  const f = fixture({ nonGit: true }); f.policy({ checks });
  const commit = completed(await f.controller.verify({ selector: selector(f.target), stage: "commit", checkIndexes: [1] }));
  assert.equal(f.receipts.get(commit.receiptIds[0]).version, 3); assert.equal(f.receipts.get(commit.receiptIds[0]).checkIndex, 1);
  const handoff = completed(await f.controller.verify({ selector: selector(f.target), stage: "handoff" }));
  assert.equal(f.receipts.get(handoff.receiptIds[0]).version, 2); assert.equal(f.receipts.get(handoff.receiptIds[0]).checkIndex, 2);
  assert.equal(commit.revisionDependency, undefined); assert.equal(handoff.revisionDependency, undefined);
  const g = fixture(); g.policy({ checks }); g.behavior.downgradeCommitReceipt = true;
  const refused = await g.controller.verify({ ...g.verifyRequest, stage: "commit" });
  assert.equal(refused.status, "recovery-required"); assert.equal(refused.code, "actual-sealed-receipt-required");
});

test("modeled clean v2 cannot accept paired v1, dirty-working decoration or fabricated v3; native source/recipe/policy signatures remain exact", async () => {
  const cases = [
    [(r) => { r.snapshot.version = 1; }, "actual-sealed-receipt-required"],
    [(r) => { r.version = 3; }, "actual-sealed-receipt-required"],
    [(r) => { r.snapshot.evidenceScope = "working-workspace"; }, "actual-sealed-receipt-required"],
    [(r) => { r.snapshot.workspaceContentDigest = signature("invented-dirty-bytes"); }, "actual-sealed-receipt-required"],
    [(r) => { r.candidateTreeVerified = true; }, "actual-sealed-receipt-required"],
    [(r) => { r.repositoryChecksWaived = true; }, "actual-sealed-receipt-required"],
    [(r) => { r.policyRevision = "changed-and-restored-policy-is-not-the-original-proof"; }, "native-receipt-binding-mismatch"],
    [(r) => { r.snapshot.head = signature(targetOid); }, "native-receipt-binding-mismatch"],
    [(r) => { r.snapshot.checkDigest = signature("other-index-or-recipe"); }, "native-receipt-binding-mismatch"],
    [(r) => { r.environmentDigest = signature("other-environment"); }, "native-receipt-binding-mismatch"],
  ];
  for (const [corrupt, code] of cases) {
    const f = fixture({ nonGit: true }); f.setCompletionHook((op, e) => { if (op === "verify") corrupt(f.receipts.get(e.completion.receiptIds[0])); });
    const r = await f.controller.verify(f.verifyRequest); assert.equal(r.status, "recovery-required"); assert.equal(r.code, code); assert.equal(r.revisionDependency, undefined);
  }
});

test("modeled strict history binds the saved B indexes/recipes and physical source; legacy checks is not independent native verification", async () => {
  for (const corrupt of [(c) => { c.history.kind = "checks"; }, (c) => { c.history.checkoutVerification.stage = "commit"; },
    (c) => { c.history.checkoutVerification.source.checkoutIdentity = identity(999); },
    (c) => { c.history.checkoutVerification.requiredSavedIndexes = []; },
    (c) => { const row = c.history.checkoutVerification.checks[0]; row.recipe = { ...row.recipe, argv: ["caller-A-command"] }; row.recipeDigest = signature(row.recipe); }]) {
    const f = fixture({ nonGit: true }), capture = f.native.verify.capture;
    f.native.verify.capture = async (...args) => { const h = await capture(...args); corrupt(f.native.verify.readCandidate(h)); return h; };
    const r = await f.controller.verify(f.verifyRequest); assert.equal(r.status, "blocked"); assert.equal(executed(f, "verify"), 0); assert.equal(r.revisionDependency, undefined);
  }
});

test("workspace proof must bind native tree/source/base/ref and exact disclosed parent facts", async () => {
  for (const patch of [{ treeOid: "e".repeat(40) }, { sourceOid: "e".repeat(40) }, { baseOid: "e".repeat(40) },
    { branchRef: "refs/heads/foreign" }, { status: "dirty" }]) {
    const f = fixture(); f.setCompletionHook((operation, e) => { if (operation === "workspace") Object.assign(e.completion.proof, patch); });
    const r = await f.controller.workspace(f.workspaceRequest);
    assert.equal(r.status, "recovery-required"); assert.equal(r.code, "sealed-creation-required"); assert.equal(r.revisionDependency, undefined);
  }
  const f = fixture(), plan = { path: "/selected-worktrees", expectedAbsent: true, ancestorPath: "/", ancestorIdentity: identity(800), mode: 0o700 };
  const capture = f.native.workspace.capture;
  f.native.workspace.capture = async (...args) => { const h = await capture(...args), c = f.native.workspace.readCandidate(h);
    c.parentCreation = plan; c.history.workspace = { parentCreation: plan }; return h; };
  f.setCompletionHook((operation, e) => {
    if (operation !== "workspace") return;
    // Matching result/proof copies STILL cannot substitute a different mode
    // for the exact parent effect shown before human approval.
    const known = { path: plan.path, ancestorPath: plan.ancestorPath, ancestorIdentity: plan.ancestorIdentity, identity: identity(801), mode: 0o755, ownerUid: 1 };
    e.completion.result.knownParentCreation = known; e.completion.proof.knownParentCreation = copy(known);
  });
  const r = await f.controller.workspace(f.workspaceRequest);
  assert.equal(r.status, "recovery-required"); assert.equal(r.code, "sealed-creation-required");
});

/** Real native leaves in disposable unit repositories only. No development
 * checkout, app lifecycle, git commit command, build, remote or browser. Object
 * fixtures are written by hash-object; callbacks fsync measured native records.
 * These small admission fixtures are NOT the production ledger implementation. */
async function nativeCleanupFixture(t, { revokeAfterRemoval = false, ignored = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "selected-controller-native-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"), sourcePath = join(root, "feature"), chatCwd = join(root, "pi-cwd-fresh"), agentDir = join(root, "agent"), records = join(root, "records");
  for (const p of [chatCwd, records, agentDir]) mkdirSync(p, { mode: 0o700 });
  // Native gitExecEnv intentionally strips GIT_* overrides; isolate Git's
  // actual HOME/XDG config discovery instead of pretending those overrides work.
  const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME, oldAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = root; process.env.XDG_CONFIG_HOME = root; process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
    if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent; });
  const { gitExecEnv } = await jiti.import("./git-exec.ts");
  const rawGit = (cwd, args, input) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args],
    { input, encoding: "utf8", env: gitExecEnv(), stdio: ["pipe", "pipe", "pipe"] });
  const git = (cwd, ...args) => rawGit(cwd, args).trim();
  const hash = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
  const persist = (name, data) => { writeFileSync(join(records, name), JSON.stringify(data), { mode: 0o600, flush: true });
    const fd = openSync(records, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } };
  const id = (s) => ({ device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) });
  const { allowFileRoot } = await jiti.import("./file-access.ts"); allowFileRoot(root);
  const { selectCanonicalGitResources: select } = await jiti.import("./git-project-resources.ts");
  const { captureGitWorkspaceOperation, applyGitWorkspaceOperation, readGitWorkspaceNativeProof } = await jiti.import("./git-workspace-operation.ts");
  const { prepareSelectedIntegration, confirmSelectedIntegration, readSelectedIntegrationNativeProof } = await jiti.import("./git-selected-integration.ts");
  const { beginSupervisedGitOperationIntent } = await jiti.import("./git-operation-admission.ts");
  const { createGitCleanupEngine } = await jiti.import("./git-cleanup-operation.ts");
  const { createTrustedWorkspaceUsage, beginGitWorkspacePlacement } = await jiti.import("./git-workspace-usage.ts");
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { appendSessionToolSelection } = await jiti.import("./session-tool-selection.ts");
  const { managedGitSessionFacts } = await jiti.import("./git-workflow-access.ts");
  const { gitActionSink, beginGitActionWithId, snapshotGitWorkspaceAction, snapshotGitCleanupAction, recordVerifiedCleanupRemoval,
    finishVerifiedNativeGitAction, failGitAction } = await jiti.import("./git-action-controller.ts");
  git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Unit"); git(repo, "config", "user.email", "unit@example.invalid");
  git(repo, "config", "commit.gpgsign", "false");
  const tree = rawGit(repo, ["hash-object", "-w", "-t", "tree", "--stdin"], "").trim();
  const commitObject = (parent, message) => rawGit(repo, ["hash-object", "-w", "-t", "commit", "--stdin"],
    `tree ${tree}\n${parent ? `parent ${parent}\n` : ""}author Unit <unit@example.invalid> 1000000000 +0000\ncommitter Unit <unit@example.invalid> 1000000000 +0000\n\n${message}\n`).trim();
  const baseOid = commitObject(undefined, "base"); git(repo, "update-ref", "refs/heads/main", baseOid); git(repo, "reset", "--hard", baseOid);
  const selectPath = (cwd) => select({ repositoryPath: repo, checkoutPath: cwd });
  const originalSource = await selectPath(repo);
  const inventory = () => ({ refs: rawGit(repo, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs"]),
    registrations: rawGit(repo, ["worktree", "list", "--porcelain", "-z"]) });
  let workspaceGuardFailure, creationNativeHandle;
  const workspace = await captureGitWorkspaceOperation({ repositoryPath: repo, sourceCheckoutPath: repo, destinationPath: sourcePath,
    mode: "create", branch: "feature", baseBranch: "main", expectedBaseOid: baseOid }, {
    async assertAdmission() { assert.equal(existsSync(sourcePath), false); },
    async beginIntent(e) {
      persist("workspace-intent.json", e);
      const assertOwned = (proof) => {
        try {
          const current = inventory();
          if (proof) {
            const verified = readGitWorkspaceNativeProof(proof); assert.ok(verified); assert.deepEqual(verified, proof);
            assert.equal(readGitWorkspaceNativeProof(copy(proof)), undefined); assert.equal(proof.actionId, e.actionId);
            assert.equal(hash(current.refs), proof.refsDigest); assert.equal(hash(current.registrations), proof.registrationsDigest);
          } else { assert.equal(current.refs, e.refs); assert.equal(current.registrations, e.registrations); }
        } catch (error) { workspaceGuardFailure = error; throw error; }
      };
      return { assertOwned, async completed(proof) { assertOwned(proof); persist("workspace-completed.json", proof); creationNativeHandle = proof; },
        async recordFailure(facts) { persist("workspace-failure.json", facts); } };
    },
  });
  const creationResult = await applyGitWorkspaceOperation({ candidate: workspace, authorize: async () => {} })
    .catch((error) => { throw workspaceGuardFailure ?? error; });
  const creationNativeProof = readGitWorkspaceNativeProof(creationNativeHandle);
  assert.ok(creationNativeProof); assert.equal(creationNativeProof.actionId, creationResult.actionId);
  assert.equal(readGitWorkspaceNativeProof(creationResult), undefined); assert.equal(readGitWorkspaceNativeProof(copy(creationNativeHandle)), undefined);
  assert.equal(readFileSync(join(records, "workspace-completed.json"), "utf8"), JSON.stringify(creationNativeProof));
  const featureOid = commitObject(baseOid, "feature-empty-retention"); git(repo, "update-ref", "refs/heads/feature", featureOid, baseOid);
  const source = await selectPath(sourcePath), target = await selectPath(repo);
  const saved = { mainBranch: "main", targetBranch: ":project-main", method: "ff", delivery: "local", checks: [],
    cleanup: "worktree-and-branch", cleanupConfirmation: "none", prepareConfirmation: "ask" };
  const resolved = resolve({}, saved, {});
  const integrationActionId = randomUUID(), authorityFile = join(records, "integration-authority.json");
  persist("integration-authority.json", { trusted: true, allow: true, source, target, policyRevision: "project-1", saved });
  const authority = () => JSON.parse(readFileSync(authorityFile, "utf8"));
  const plan = await prepareSelectedIntegration({ sessionId: "native-unit-setup", agentDir, source, target, receiptIds: [],
    getPolicy: () => ({ policyRevision: authority().policyRevision, settings: resolve({}, authority().saved, {}).values, savedProjectSettings: authority().saved }),
    isTrusted: () => authority().trusted,
    isSelectionAuthorized: (s) => authority().allow && (JSON.stringify(s) === JSON.stringify(authority().source) || JSON.stringify(s) === JSON.stringify(authority().target)),
    isCheckAuthorized: () => false,
    readAuthorityRevisionSync: () => {
      const s = lstatSync(authorityFile, { bigint: true }); assert.ok(s.isFile() && !s.isSymbolicLink());
      return hash([id(s), String(s.ctimeNs), String(s.mtimeNs), String(s.size), readFileSync(authorityFile, "utf8")]);
    },
    authorize: () => {
      const capturedAuthority = readFileSync(authorityFile, "utf8");
      const assertLive = () => { assert.equal(readFileSync(authorityFile, "utf8"), capturedAuthority); assert.equal(authority().trusted && authority().allow, true); };
      assertLive(); return assertLive;
    } });
  let integrationReservation;
  const integrated = await confirmSelectedIntegration(plan.planId, plan.planId, "native-unit-setup", async () => {
    integrationReservation = await beginSupervisedGitOperationIntent(source, integrationActionId, "integration", agentDir); return integrationReservation;
  });
  assert.equal(integrated.result.status, "integrated");
  const integration = readSelectedIntegrationNativeProof(integrated.nativeHandle);
  assert.ok(integration); assert.equal(readSelectedIntegrationNativeProof(copy(integrated.nativeHandle)), undefined);
  persist("integration-completed.json", integration);
  assert.equal(git(repo, "rev-parse", "HEAD"), featureOid);
  // The leaf intentionally retains its real intent until the trusted parent has
  // fsynced the authenticated completion and independently observed final refs.
  integrationReservation.assertOwned(); integrationReservation.resolve();
  assert.deepEqual(creationNativeProof.destination, source);
  // The cleanup leaf's captured-resource JSON ordering uses canonical selector
  // layout. Normalize this projection ONLY after the opaque native reader and
  // independent exact physical comparison, never from historical metadata.
  const creator = { mode: "create", destination: source, originalSource, branchRef: "refs/heads/feature" };
  const integrationHandle = Object.freeze({}), creatorHandle = Object.freeze({}), sealedPrerequisites = new WeakMap();
  // Issued only after actual returned native results, independent identity reads,
  // completed native admission, and fsynced measured journals; not parsed history.
  sealedPrerequisites.set(integrationHandle, integration); sealedPrerequisites.set(creatorHandle, creator);
  if (ignored) { writeFileSync(join(repo, ".git", "info", "exclude"), "ignored.bin\n"); writeFileSync(join(sourcePath, "ignored.bin"), "named ignored bytes\n"); }
  const session = SessionManager.create(chatCwd, join(agentDir, "sessions"));
  session.appendMessage({ role: "user", content: "independent cleanup", timestamp: Date.now() });
  appendSessionToolSelection(session, ["read", "bash", "edit", "write"]);
  session.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const owner = { sessionId: session.getSessionId(), sessionFile: session.getSessionFile(), sessionCwd: chatCwd };
  const ownerIdentity = id(lstatSync(owner.sessionFile, { bigint: true }));
  const absence = () => {
    const ancestors = [];
    for (let cwd = chatCwd; ; cwd = dirname(cwd)) {
      const s = lstatSync(cwd, { bigint: true }); assert.ok(s.isDirectory() && !s.isSymbolicLink()); assert.equal(realpathSync(cwd), cwd);
      assert.equal(existsSync(join(cwd, ".git")), false);
      // Any ambiguous/broken bare-repository hint denies absence, not just a
      // complete readable repository. Never convert discovery failure to non-Git.
      for (const hint of ["HEAD", "objects", "refs", "commondir"]) assert.equal(existsSync(join(cwd, hint)), false);
      ancestors.push([cwd, id(s)]); if (dirname(cwd) === cwd) break;
    }
    return { kind: "non-git", cwd: chatCwd, identity: id(lstatSync(chatCwd, { bigint: true })), noRepository: { verified: true, revision: hash(ancestors) } };
  };
  let denied = false, prompts = 0, execution, captured, nativeCandidate, action, allowed, leaseCount = 0, leaseReleases = 0;
  const calls = [], resourceReads = [], nativeResults = new WeakMap(), nativeFailures = new WeakMap(), durableSeals = new WeakMap(), issuedRemoval = new WeakMap(), removalAcks = new WeakMap(), nativeOutcomes = new WeakMap();
  const policy = (r) => ({ revision: "project-1", paused: false, optedOut: false, cwd: r.cwd, projectRoot: r.projectRoot, sessionScope: "project",
    global: {}, project: saved, session: {}, resolved: { global: resolve(), project: resolved, session: resolved }, task: { kind: "none" }, sessionEditable: true });
  const own = resolve();
  const authorization = {
    readResources: async (s) => { resourceReads.push([s.checkoutPath, existsSync(sourcePath)]); return select(s); },
    readCaller: async (o) => {
      assert.deepEqual(o, owner); assert.deepEqual(id(lstatSync(owner.sessionFile, { bigint: true })), ownerIdentity);
      const manager = SessionManager.open(owner.sessionFile); assert.equal(manager.getHeader().id, owner.sessionId); assert.equal(manager.getHeader().cwd, chatCwd);
      const facts = managedGitSessionFacts(manager.getEntries());
      return { persisted: true, revision: hash([ownerIdentity, facts.tools, facts.subagent]), facts, current: absence(),
        policy: { revision: "chat-1", paused: false, optedOut: false, global: {}, session: {},
          resolved: { global: own, project: own, session: own }, task: { kind: "none" } } };
    },
    readPolicy: async (r) => policy(r),
    readAuthorization: async () => ({ revision: denied ? "deny-2" : "allow-1", policyRevision: "project-1",
      actions: Object.fromEntries(["workspace", "prepare", "checks", "integration", "cleanup"].map((k) => [k, { effective: denied ? "deny" : "allow" }])) }),
    revalidateResources: async (r) => assert.deepEqual(await selectPath(r.cwd), r),
    readCurrentPolicy: async () => { throw Error("non-Git caller cannot borrow Project policy"); },
    readCurrentAuthorization: async () => { throw Error("non-Git caller has no Project Git grants"); },
    revalidateCurrent: async (c) => assert.deepEqual(c, absence()),
  };
  const usage = createTrustedWorkspaceUsage(() => ({ sessions: { known: true, entries: [{ id: owner.sessionId, cwd: chatCwd }] },
    terminals: { known: true, entries: [] }, checks: { known: true, entries: [] }, inflight: { known: true, entries: [] } }), (ack) => issuedRemoval.get(ack));
  const engine = createGitCleanupEngine({
    readCompletedIntegration: (h) => h === integrationHandle ? sealedPrerequisites.get(h) : undefined,
    readCreatedWorkspace: (h) => h === creatorHandle ? sealedPrerequisites.get(h) : undefined,
    getProjectMain: () => selectPath(repo),
    authorize: async (phase) => { calls.push(`authorize:${phase}`); if (execution) await execution.authorize(); },
    acquireUsageLease: (s, e) => execution.journalAdmission.cleanup.acquireUsageLease(s, e),
    assertAdmission: async (e) => { if (execution) await execution.journalAdmission.cleanup.assertAdmission(e); else assert.equal(inventory().refs, e.inventory.refs); },
    beginIntent: (e) => execution.journalAdmission.cleanup.beginIntent(e),
  });
  const shell = fixture({ nonGit: true });
  const cleanup = {
    async capture(request, context) {
      const c = await engine.capture({ integrationHandle: context.integrationHandle, creatorHandle: context.creatorHandle, ignoredNames: request.ignoredNames });
      const checkout = (r) => ({ gitDir: r.gitDir, checkoutIdentity: r.identities.checkout, gitIdentity: r.identities.git, markerIdentity: r.identities.marker });
      const details = { featureOid, targetOid: featureOid, mainOid: featureOid, sourcePath, branchRef: "refs/heads/feature", targetPath: repo, mainPath: repo,
        source: checkout(source), target: checkout(target), main: checkout(target),
        integration: { completedAt: integration.completedAt, delivery: integration.delivery, method: integration.method, actualFF: integration.actualFF,
          featureOid, previousTargetOid: baseOid, resultOid: featureOid, resultTree: tree, parents: integration.parents },
        provenance: { mode: "create", originalSourcePath: repo, originalSource: checkout(originalSource), branchRef: "refs/heads/feature" },
        ignoredCount: c.ignored.length, ignoredDeletion: c.ignored.length ? "exact-approval-required" : "none", ignored: [...c.ignored] };
      nativeCandidate = { operation: "cleanup", revision: hash([c, details]), actionId: c.actionId, source, target, sourceOid: featureOid, targetOid: featureOid,
        policyRevision: "project-1", history: snapshotGitCleanupAction(source, target, details),
        cleanup: { integrationHandle, creatorHandle, ignoredNames: c.ignored.map((entry) => entry.path) } };
      captured = c; return c;
    },
    readCandidate: (h) => h === captured ? nativeCandidate : undefined,
    assertExact: async () => { assert.deepEqual(await selectPath(repo), target); /* B eligibility/OWN absence remains inside the actual leaf. */ },
    async execute(h, x) {
      execution = x;
      try {
        const result = await engine.apply(h);
        assert.equal(existsSync(sourcePath), false); assert.equal(git(repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
        assert.equal(leaseReleases, 1); assert.equal(readFileSync(join(records, "cleanup-completed.json"), "utf8"), JSON.stringify(result.proof));
        nativeResults.set(result, { stage: "completed", actionId: x.actionId, candidateRevision: nativeCandidate.revision, completedAt: performance.now(),
          completion: { operation: "cleanup", proof: result.proof } });
        nativeOutcomes.set(result, { actionId: x.actionId, outcome: { kind: "cleanup", status: "cleaned-up", cleanup: { ...binding(),
          ...(ignored ? { ignoredDataDeletionApproved: true } : {}), effects: [removalEffect(result.proof.removal), { kind: "branch-deleted", branchRef: result.proof.deletedRef, deletedOid: result.proof.deletedOid,
            transactionExit: 0, finalInventoryDigest: hash(result.proof.finalInventory) }], nativeHeadReflogMayHaveChanged: true } } });
        await x.onNativeCompleted(result); return result;
      } catch (error) {
        if (error.facts) nativeFailures.set(error, { kind: "partial", actionId: x.actionId, candidateRevision: nativeCandidate.revision,
          recoveryRequired: true, cleanup: error.facts });
        throw error;
      }
    },
    readNativeCompletion: (h) => nativeResults.get(h), readNativeFailure: (e) => nativeFailures.get(e), retire() {},
  };
  const binding = () => ({ featureOid, targetOid: featureOid, mainOid: featureOid, sourcePath, branchRef: "refs/heads/feature", targetPath: repo, mainPath: repo });
  const removalEffect = (p) => ({ kind: "worktree-removed", sourcePath: p.sourcePath, sourceIdentity: p.sourceIdentity, adminPath: p.adminPath, featureOid,
    exit: 0, sourceAbsent: true, adminAbsent: true, beforeInventoryDigest: hash(p.before), afterInventoryDigest: hash(p.after) });
  const sink = gitActionSink(session, (type, data) => session.appendCustomEntry(type, data));
  const journalAdmission = { async begin(o, c) {
    assert.deepEqual(o, owner); action = await beginGitActionWithId(c.actionId, sink, "agent", c.history, agentDir);
    const bridgeAction = { get record() { return action.record; }, release: () => action.release(),
      update: (state, extra) => action.update(state, { ...extra, ...(state === "executing" && !action.record.intended
        ? { intended: { kind: "cleanup", cleanup: { ...binding(), effects: [] } } } : {}) }) };
    return { action: bridgeAction, workspaceAdmission: { assertAdmission: async () => { throw Error("not this operation"); }, beginIntent: async () => { throw Error("not this operation"); } },
      beginIntegrationIntent: async () => { throw Error("not this operation"); },
      cleanup: {
        async assertAdmission(e) { assert.equal(inventory().refs, e.inventory.refs); assert.equal(existsSync(join(records, "cleanup-intent.json")), false); },
        async acquireUsageLease(s, e) {
          leaseCount++; const lease = usage.acquireLease(s.cwd, s.identities.checkout, { actionId: e.actionId, featureOid, adminPath: s.gitDir,
            adminIdentity: s.identities.git, markerIdentity: s.identities.marker, adminInventoryHash: e.inventory.admins[s.gitDir.split("/").at(-1)] });
          return { assertIdle: () => lease.assertUnused(), acknowledgeRemoval(p) {
            calls.push("usage-ack"); assert.equal(existsSync(sourcePath), false); lease.acknowledgeRemoval(removalAcks.get(p));
            assert.throws(() => beginGitWorkspacePlacement(sourcePath), (e) => e.code === "leased");
            if (revokeAfterRemoval) denied = true;
          }, release() { calls.push("lease-release"); lease.release(); leaseReleases++; } };
        },
        async beginIntent(e) {
          persist("cleanup-intent.json", e); allowed = e.inventory;
          return { assertOwned(expected, phase) {
            const current = inventory(); assert.equal(current.refs, expected.refs); assert.equal(current.registrations, expected.registrations);
            if (phase !== "complete") assert.deepEqual(expected, allowed);
          }, async recordRemoval(p) {
            assert.equal(existsSync(sourcePath), false); assert.equal(existsSync(source.gitDir), false); assert.equal(p.actionId, c.actionId);
            assert.equal(inventory().refs, p.after.refs); assert.equal(inventory().registrations, p.after.registrations);
            persist("cleanup-removal.json", p); allowed = p.after;
            const ack = Object.freeze({ durable: true, proof: p }); issuedRemoval.set(ack, p); removalAcks.set(p, ack);
            nativeOutcomes.set(p, { actionId: c.actionId, outcome: { kind: "cleanup", status: "worktree-removed", cleanup: { ...binding(),
              ...(ignored ? { ignoredDataDeletionApproved: true } : {}), effects: [removalEffect(p)] } } });
            await recordVerifiedCleanupRemoval(action, p, (h) => nativeOutcomes.get(h)); return ack;
          }, async completed(p) {
            assert.equal(p.actionId, c.actionId); assert.equal(git(repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
            persist("cleanup-completed.json", p); return { durable: true, proof: p };
          }, async recordFailure(facts) { persist("cleanup-failure.json", facts); } };
        },
      },
      async recordNativeCompletion(h) { assert.ok(nativeResults.get(h)); },
      async sealCompletion(h) {
        await finishVerifiedNativeGitAction(action, h, (actual) => nativeOutcomes.get(actual));
        const seal = Object.freeze({}); durableSeals.set(seal, { stage: "completed", actionId: c.actionId, nativeHandle: h, candidateRevision: c.revision }); return seal;
      },
      readDurableCompletion: (s) => durableSeals.get(s), async recordFailure() { await failGitAction(action, true); },
    };
  } };
  const controller = create({ ...shell.bootstrap, owner, authorization, native: { ...shell.native, cleanup,
    readCleanupPrerequisites: async (o, s) => { assert.deepEqual(o, owner); assert.deepEqual(s, source);
      return { integration: { handle: integrationHandle, proof: sealedPrerequisites.get(integrationHandle) }, creation: { handle: creatorHandle, proof: sealedPrerequisites.get(creatorHandle) } }; } },
    journalAdmission, now: () => performance.now(), isTrusted: async (r) => r.projectRoot === repo,
    currentUserRequestId: async () => SessionManager.open(owner.sessionFile).getEntries().findLast((e) => e.type === "message" && e.message.role === "user")?.id,
    approveExact: async ({ ignoredNames }) => { prompts++; assert.deepEqual(ignoredNames, ignored ? ["ignored.bin"] : []); return true; } });
  async function runWorkspace() {
    const selectedSource = await selectPath(repo), destinationPath = join(`${repo}-worktrees`, "another"), completions = new WeakMap(), durable = new WeakMap();
    let candidate, nativeCapture, proofHandle, workspaceAction, initialEvidence;
    const admission = {
      async assertAdmission(s, dest, parent) {
        assert.deepEqual(s, selectedSource); assert.equal(dest, destinationPath); assert.equal(parent.path, `${repo}-worktrees`);
        assert.equal(existsSync(parent.path), false);
      },
      async beginIntent(e) {
        initialEvidence = e; persist("composed-workspace-intent.json", e);
        return { assertOwned(p) {
          const current = inventory();
          if (p) { const verified = readGitWorkspaceNativeProof(p); assert.ok(verified); assert.deepEqual(verified, p);
            assert.equal(hash(current.refs), p.refsDigest); assert.equal(hash(current.registrations), p.registrationsDigest); }
          else { assert.equal(current.refs, e.refs); assert.equal(current.registrations, e.registrations); }
        }, async completed(p) { assert.ok(readGitWorkspaceNativeProof(p)); persist("composed-workspace-completed.json", p); proofHandle = p; },
        async recordFailure(f) { persist("composed-workspace-failure.json", f); } };
      },
    };
    const adapter = {
      async capture(request) {
        nativeCapture = await captureGitWorkspaceOperation(request.workspace, admission);
        candidate = { operation: "workspace", revision: hash(nativeCapture), actionId: nativeCapture.actionId, source: selectedSource,
          sourceOid: nativeCapture.sourceOid, policyRevision: "project-1", parentCreation: nativeCapture.parentCreation,
          history: snapshotGitWorkspaceAction(selectedSource, nativeCapture) };
        return nativeCapture;
      },
      readCandidate: (h) => h === nativeCapture ? candidate : undefined,
      assertExact: async () => assert.deepEqual(await selectPath(repo), selectedSource),
      async execute(h, x) {
        const result = await applyGitWorkspaceOperation({ candidate: h, authorize: x.authorize });
        const proof = readGitWorkspaceNativeProof(proofHandle); assert.ok(proof);
        assert.equal(readGitWorkspaceNativeProof(result), undefined); assert.equal(readGitWorkspaceNativeProof(copy(proofHandle)), undefined);
        assert.equal(readFileSync(join(records, "composed-workspace-completed.json"), "utf8"), JSON.stringify(proof));
        const outcome = { kind: "workspace", status: result.status, workspace: { mode: "create", destinationPath, branch: "another", tipOid: result.oid,
          treeOid: result.treeOid, parentCreated: true, parentCreationAttempted: true, knownParentCreation: result.knownParentCreation } };
        const actual = Object.freeze({}); completions.set(actual, { stage: "completed", actionId: x.actionId, candidateRevision: candidate.revision,
          completedAt: performance.now(), completion: { operation: "workspace", result, proof,
            creation: { mode: "create", destination: proof.destination, originalSource: selectedSource, branchRef: "refs/heads/another" } }, outcome });
        await x.onNativeCompleted(actual); return actual;
      },
      readNativeCompletion: (h) => completions.get(h), readNativeFailure: () => undefined, retire() {},
    };
    const factory = { async begin(o, c) {
      assert.deepEqual(o, owner); workspaceAction = await beginGitActionWithId(c.actionId, sink, "agent", c.history, agentDir);
      return { action: { get record() { return workspaceAction.record; }, release: () => workspaceAction.release(),
        update: (state, extra) => workspaceAction.update(state, { ...extra, ...(state === "executing" ? { intended: { kind: "workspace",
          workspace: { mode: "create", destinationPath, branch: "another", tipOid: featureOid, treeOid: tree } } } : {}) }) },
      workspaceAdmission: admission, cleanup: { assertAdmission: async () => { throw Error("not cleanup"); },
        acquireUsageLease: async () => { throw Error("not cleanup"); }, beginIntent: async () => { throw Error("not cleanup"); } },
      beginIntegrationIntent: async () => { throw Error("not integration"); },
      async recordNativeCompletion(h) { assert.ok(completions.get(h)); },
      async sealCompletion(h) {
        await finishVerifiedNativeGitAction(workspaceAction, h, (key) => completions.has(key)
          ? { actionId: c.actionId, outcome: completions.get(key).outcome } : undefined);
        const seal = Object.freeze({}); durable.set(seal, { stage: "completed", actionId: c.actionId, nativeHandle: h, candidateRevision: c.revision }); return seal;
      }, readDurableCompletion: (s) => durable.get(s), async recordFailure() { await failGitAction(workspaceAction, true); } };
    } };
    const composed = create({ ...shell.bootstrap, owner, authorization, native: { ...shell.native, workspace: adapter }, journalAdmission: factory,
      now: () => performance.now(), isTrusted: async (r) => r.projectRoot === repo,
      currentUserRequestId: async () => SessionManager.open(owner.sessionFile).getEntries().findLast((e) => e.type === "message" && e.message.role === "user")?.id,
      approveExact: async ({ candidate: shown }) => { assert.deepEqual(shown.parentCreation, nativeCapture.parentCreation); return true; } });
    const result = await composed.workspace({ selector: selector(selectedSource), workspace: { repositoryPath: repo, sourceCheckoutPath: repo,
      destinationPath, branch: "another", baseBranch: "main", expectedBaseOid: featureOid, mode: "create" } });
    return { result, initialEvidence, proof: readGitWorkspaceNativeProof(proofHandle), record: workspaceAction.record, destinationPath };
  }
  return { controller, runWorkspace, sourcePath, repo, owner, session, source, featureOid, resourceReads, calls, prompts: () => prompts,
    agentDir, records, persist, selectPath,
    verificationBootstrap: { ...shell.bootstrap, owner, authorization, now: () => performance.now(), isTrusted: async (r) => r.projectRoot === repo,
      currentUserRequestId: async () => SessionManager.open(owner.sessionFile).getEntries().findLast((e) => e.type === "message" && e.message.role === "user")?.id,
      readPreparationOrderingRequirement: async (o, s) => { assert.deepEqual(o, owner); return { kind: "independent", source: s,
        sourceOid: git(s.cwd, "rev-parse", "HEAD"), evidenceRevision: "actual-never-prepared-unit-source" }; } },
    leases: () => [leaseCount, leaseReleases], git };
}

for (const ignored of [false, true]) test(`real native cleanup from B authenticates surviving A after OWN removal (ignored=${ignored})`, { skip: process.platform !== "linux" }, async (t) => {
  const f = await nativeCleanupFixture(t, { ignored });
  const result = completed(await f.controller.cleanup({ selector: { repositoryPath: f.repo, checkoutPath: f.sourcePath }, confirmation: "none",
    ...(ignored ? { ignoredNames: ["ignored.bin"] } : {}) }));
  assert.equal(result.recoveryRequired, undefined); assert.equal(existsSync(f.sourcePath), false);
  assert.equal(f.git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
  assert.deepEqual(f.leases(), [1, 1]); assert.equal(f.prompts(), ignored ? 1 : 0);
  assert.equal(f.resourceReads.some(([cwd, present]) => cwd === f.sourcePath && !present), false);
  assert.equal(f.calls.includes("authorize:before-delete"), true);
  assert.equal(f.session.getHeader().cwd, f.owner.sessionCwd); assert.equal(f.owner.sessionCwd.includes("pi-cwd-fresh"), true);
});

test("real native workspace composition discloses absent conventional parent, seals exact native proof and leaves persisted non-Git chat in place", { skip: process.platform !== "linux" }, async (t) => {
  const f = await nativeCleanupFixture(t), w = await f.runWorkspace();
  const result = completed(w.result);
  assert.equal(w.initialEvidence.parentCreation.expectedAbsent, true); assert.equal(w.initialEvidence.parentCreation.mode, 0o700);
  assert.deepEqual(result.knownParentCreation, w.proof.knownParentCreation);
  assert.deepEqual(w.record.outcome.workspace.knownParentCreation, w.proof.knownParentCreation);
  assert.equal(w.record.state, "succeeded"); assert.equal(result.scope.checkoutPath, w.destinationPath);
  assert.equal(f.session.getHeader().cwd, f.owner.sessionCwd); assert.equal(result.revisionDependency, undefined);
});

/** Controlled composition interface fixture: REAL native source snapshots,
 * parked launcher/payload, callback identity reader and published v2/v3 receipts.
 * Unit accounting is SIMULATED, not OS containment. The fsynced journal/seal
 * implementation below tests ONLY the controller contract, NOT shared history
 * schemas (the history owner separately needs the clean-checkout union). */
async function nativeVerification(t, f, { stage = "integration", directMain = false, delivery = "local", corruptReceipt, corruptHistory } = {}) {
  const { spawn } = await import("node:child_process");
  const { statSync } = await import("node:fs");
  const { gitExecEnv } = await jiti.import("./git-exec.ts");
  const { sanitizeProjectCommandEnvironment } = await jiti.import("./project-command-env.ts");
  const { normalizeGitCheckRecipe } = await jiti.import("./git-check-recipe.ts");
  const { validateGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
  const { runGitCheckoutVerification: run, captureGitCheckoutCheckRecoverySnapshot: capture, lookupGitCheckoutVerificationReceipt: lookup,
    readGitCheckoutVerificationNativeExecution: read, validateGitCheckoutVerificationReceipt: validate } = await jiti.import("./git-checkout-verification.ts");
  const selected = await f.selectPath(directMain ? f.repo : f.sourcePath), units = new Map(), stopped = new Set();
  const backend = {
    async absent(name) { return !units.has(name); },
    start(options) {
      const s = { invocation: randomUUID().replaceAll("-", ""), cwd: options.workingDirectory, done: false, code: null, output() {} };
      s.child = spawn(process.execPath, ["-e", "process.send('ready');process.on('message',p=>{const c=require('child_process').spawn(p.argv[0],p.argv.slice(1),{env:p.env,cwd:process.cwd(),stdio:['ignore','inherit','inherit']});c.on('error',()=>process.exit(125));c.on('close',code=>process.exit(code??125));});"],
        { cwd: s.cwd, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      s.closed = new Promise((resolve) => s.child.once("close", (code) => { s.done = true; s.code = code ?? 125; resolve(); }));
      s.child.stdout.on("data", (data) => s.output(data)); s.child.stderr.on("data", (data) => s.output(data));
      const started = new Promise((resolve, reject) => { s.child.once("error", reject); s.child.once("message", () => {
        const p = statSync(`/proc/${s.child.pid}`, { bigint: true }), text = readFileSync(`/proc/${s.child.pid}/stat`, "utf8");
        s.launcher = `${s.child.pid}:${text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/)[19]}:${p.dev}:${p.ino}`; resolve();
      }); }); units.set(options.unit, s);
      return { started, release(data) { s.child.send(JSON.parse(data)); }, closeInput() {}, dispose() {}, output(fn) { s.output = fn; } };
    },
    async observe(name) {
      const s = units.get(name); assert.ok(s);
      const unit = { Id: name, LoadState: "loaded", ControlGroup: `/test/${name}`, MainPID: s.done ? "0" : String(s.child.pid),
        ActiveState: "active", SubState: s.done ? "exited" : "running", Result: "success", ExecMainCode: "1", ExecMainStatus: String(s.code ?? 0),
        Delegate: "no", KillMode: "control-group", RemainAfterExit: "yes", Restart: "no", InvocationID: s.invocation };
      return { identity: `1:2:${s.invocation}:${unit.ControlGroup}`, populated: !s.done, launcherPlaced: !s.done, launcherIdentity: s.launcher, unit };
    },
    assertLauncherCwd(name, observation, expected) {
      const s = units.get(name), p = statSync(`/proc/${s.child.pid}/cwd`, { bigint: true }); assert.equal(observation.launcherIdentity, s.launcher);
      assert.equal(realpathSync(`/proc/${s.child.pid}/cwd`), realpathSync(s.cwd));
      assert.deepEqual({ device: String(p.dev), inode: String(p.ino), birthtime: String(p.birthtimeNs) }, expected);
    },
    async stop(name) { const s = units.get(name); if (!s.done) process.kill(-s.child.pid, "SIGKILL"); await s.closed;
      stopped.add(`${name}:${s.invocation}`); units.delete(name); },
    async terminal(name, invocation) { return stopped.has(`${name}:${invocation}`); },
    async originalEmpty(name, _id, invocation) { return stopped.has(`${name}:${invocation}`) ? "pinned-populated-zero" : undefined; },
  };
  const recipes = ["none", "integration", "handoff", "commit"].map((requiredStage, i) => ({ label: `Saved-B-${i}`,
    argv: [process.execPath, "-e", "process.exit(0)"], requiredStage }));
  const basePolicy = await f.verificationBootstrap.authorization.readPolicy(selected, f.owner), saved = { ...basePolicy.project, delivery, checks: recipes };
  const resolved = resolve({}, saved, {}), settings = validateGitWorkflowSettings(resolved.values), index = ["none", "integration", "handoff", "commit"].indexOf(stage);
  const revision = "native-check-project-1", authorityPath = join(f.records, "check-authority.json");
  f.persist("check-authority.json", { revision, saved, owner: f.owner, source: selected, trusted: true, allow: true });
  const readAuthority = () => { const p = lstatSync(authorityPath, { bigint: true });
    return signature([String(p.dev), String(p.ino), String(p.birthtimeNs), String(p.ctimeNs), String(p.mtimeNs), readFileSync(authorityPath, "utf8")]); };
  const originalAuthority = readAuthority(), policyDigest = signature(settings), recipe = settings.checks[index], n = normalizeGitCheckRecipe(recipe);
  const envDigest = signature(Object.entries(sanitizeProjectCommandEnvironment({ ...gitExecEnv(), ...n.env }))
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  let candidate, captured, snapshot, executionRow, actualReceipt, returned = false;
  const completed = new WeakMap(), seals = new WeakMap(), events = [];
  const nativeOptions = (x) => ({ sessionId: f.owner.sessionId, agentDir: f.agentDir, actionId: x?.actionId, selector: selector(selected),
    stage, checkIndex: index, getPolicy: () => ({ policyRevision: revision, settings }), isTrusted: () => true, isSelectionAuthorized: () => true,
    isActorAuthorized: async () => { if (x) await x.authorize(); assert.equal(readAuthority(), originalAuthority); return true; }, readAuthorityRevisionSync: readAuthority });
  const adapter = {
    async capture(_request, context) {
      assert.equal(context.orderingState, undefined); assert.equal(context.checks.stage, stage); assert.deepEqual(context.checks.checkIndexes, [index]);
      const binding = { recipe, checkIndex: index, stage, policyRevision: revision, policyDigest, environmentDigest: envDigest };
      snapshot = await capture(selected, binding, true); const scope = stage === "commit" ? "working-workspace" : "clean-checkout";
      const details = { evidenceScope: scope, candidateTreeVerified: false, repositoryChecksWaived: false, stage,
        sourceOid: f.git(selected.cwd, "rev-parse", "HEAD"), sourceTreeOid: f.git(selected.cwd, "rev-parse", "HEAD^{tree}"),
        policyRevision: revision, policyDigest, snapshotDigest: signature(snapshot), requiredSavedIndexes: stage === "none" ? [] : [index],
        source: { gitDir: selected.gitDir, checkoutIdentity: selected.identities.checkout, gitIdentity: selected.identities.git, markerIdentity: selected.identities.marker },
        checks: [{ checkIndex: index, recipe, recipeDigest: snapshot.recipeDigest, environmentDigest: envDigest, executionCwd: selected.cwd }] };
      if (corruptHistory) corruptHistory(details);
      candidate = { operation: "verify", revision: signature([selected, binding, snapshot, details]), source: selected, sourceOid: details.sourceOid,
        policyRevision: revision, checks: context.checks, history: { kind: "checkout-verification", repositoryRoot: selected.cwd, projectRoot: selected.projectRoot, checkoutVerification: details } };
      captured = Object.freeze({}); return captured;
    },
    readCandidate: (h) => h === captured ? candidate : undefined,
    async assertExact() { assert.equal(readAuthority(), originalAuthority); assert.deepEqual(await f.selectPath(selected.cwd), selected); },
    async execute(_h, x) {
      const { assertGitOperationAdmission } = await jiti.import("./git-operation-admission.ts");
      await assertGitOperationAdmission(selected, f.agentDir, x.actionId);
      actualReceipt = await run({ ...nativeOptions(x), timeoutMs: 30000, testContainmentBackend: backend, testRecoveryEvidence: true,
        onExecution: async (row) => { assert.equal(read(row), row); assert.equal(read(copy(row)), undefined); assert.equal(row.actionId, x.actionId);
          assert.equal(row.recipeDigest, snapshot.recipeDigest); assert.equal(row.snapshotDigest, signature(snapshot));
          assert.equal(row.environmentDigest, envDigest); assert.equal(lookup(row.receipt.id), undefined);
          executionRow = row; events.push("native-callback"); await x.onNativeCompleted(row); } });
      returned = true; events.push("native-return"); assert.equal(lookup(actualReceipt.id), actualReceipt); assert.equal(read(actualReceipt), executionRow);
      assert.equal(read(copy(actualReceipt)), undefined); const h = Object.freeze({});
      completed.set(h, { stage: "completed", actionId: x.actionId, candidateRevision: candidate.revision, completedAt: performance.now(),
        completion: { operation: "verify", status: "passed", receiptIds: [actualReceipt.id] } }); return h;
    },
    readNativeCompletion: (h) => completed.get(h), readNativeFailure: () => undefined, retire() {},
  };
  const bootstrap = f.verificationBootstrap;
  const controller = create({ ...bootstrap, authorization: { ...bootstrap.authorization,
    readPolicy: async (s) => ({ ...basePolicy, cwd: s.cwd, revision, project: saved, resolved: { global: resolve(), project: resolved, session: resolved } }),
    readAuthorization: async () => ({ revision: "actual-unit-allow", policyRevision: revision,
      actions: Object.fromEntries(["workspace", "prepare", "checks", "integration", "cleanup"].map((a) => [a, { effective: "allow" }])) }) },
    native: { ...bootstrap.native, verify: adapter, readReceipt: (id) => { const r = lookup(id); return r && corruptReceipt ? corruptReceipt(r) : r; },
      assertReceipt: async (_c, r) => { assert.equal(r, lookup(r.id)); assert.equal(read(r), executionRow); assert.equal(readAuthority(), originalAuthority);
        assert.equal(await validate(r.id, nativeOptions()), r); events.push("native-validate"); } },
    journalAdmission: { async begin(o, c) {
      assert.deepEqual(o, f.owner); const record = { id: randomUUID(), sessionId: o.sessionId, kind: c.history.kind };
      return { action: { record, async update() {}, release() {} }, workspaceAdmission: { assertAdmission: async () => {}, beginIntent: async () => { throw Error("not workspace"); } },
        cleanup: { acquireUsageLease: async () => { throw Error("not cleanup"); }, assertAdmission: async () => {}, beginIntent: async () => { throw Error("not cleanup"); } },
        beginIntegrationIntent: async () => { throw Error("not integration"); }, async recordFailure() {},
        async recordNativeCompletion(row) { assert.equal(read(row), row); assert.equal(returned, false); f.persist(`${record.id}-native-run.json`, row); events.push("durable-native-row"); },
        async sealCompletion(h) { assert.equal(returned, true); assert.ok(completed.has(h)); assert.equal(read(actualReceipt), executionRow);
          f.persist(`${record.id}-completion.json`, { actionId: record.id, row: executionRow, receipt: actualReceipt });
          const seal = Object.freeze({}); seals.set(seal, { stage: "completed", actionId: record.id, candidateRevision: c.revision, nativeHandle: h }); events.push("durable-completed-return"); return seal; },
        readDurableCompletion: (s) => seals.get(s) };
    } }, approveExact: async ({ candidate: shown }) => { assert.equal(shown.history.checkoutVerification.evidenceScope, stage === "commit" ? "working-workspace" : "clean-checkout"); return true; } });
  const result = await controller.verify({ selector: selector(selected), stage, ...(stage === "none" ? { checkIndexes: [index] } : {}) });
  controller.dispose(); return { result, actualReceipt, candidate, events, selected, snapshot };
}

for (const [stage, directMain, delivery] of [["integration", false, "local"], ["integration", true, "local"], ["handoff", true, "pr"], ["none", true, "leave"]]) {
  test(`REAL clean v2 ${stage} (directMain=${directMain}) native callback/receipt composes source-only without calling-chat recipes or candidate-tree claims`, { skip: process.platform !== "linux" }, async (t) => {
    const f = await nativeCleanupFixture(t), v = await nativeVerification(t, f, { stage, directMain, delivery }), r = completed(v.result);
    assert.equal(v.actualReceipt.version, 2); assert.equal(v.actualReceipt.snapshot.version, 2); assert.equal(v.candidate.history.checkoutVerification.evidenceScope, "clean-checkout");
    assert.equal(v.candidate.history.checkoutVerification.candidateTreeVerified, false); assert.equal(v.candidate.target, undefined);
    assert.equal(v.candidate.history.checkoutVerification.requiredSavedIndexes.length, stage === "none" ? 0 : 1);
    assert.equal(r.revisionDependency, undefined); assert.equal(f.session.getHeader().cwd, f.owner.sessionCwd);
    assert.deepEqual(v.events, ["native-callback", "durable-native-row", "native-return", "native-validate", "durable-completed-return"]);
  });
}

test("REAL dirty commit v3 remains working-workspace; fake v2 downgrade and wrong-stage v3 receipt never cross schemas", { skip: process.platform !== "linux" }, async (t) => {
  const f = await nativeCleanupFixture(t); writeFileSync(join(f.sourcePath, "dirty-untracked"), "private actual working input\n");
  const v = await nativeVerification(t, f, { stage: "commit" }); completed(v.result);
  assert.equal(v.actualReceipt.version, 3); assert.equal(v.actualReceipt.snapshot.version, 3); assert.equal(v.actualReceipt.candidateTreeVerified, false);
  const downgraded = await nativeVerification(t, f, { stage: "commit", corruptReceipt: (r) => ({ ...r, version: 2 }) });
  assert.equal(downgraded.result.status, "recovery-required"); assert.equal(downgraded.result.code, "actual-sealed-receipt-required");
  rmSync(join(f.sourcePath, "dirty-untracked"));
  const upgraded = await nativeVerification(t, f, { corruptReceipt: (r) => ({ ...r, version: 3, evidenceScope: "working-workspace",
    candidateTreeVerified: false, repositoryChecksWaived: false, snapshot: { ...r.snapshot, version: 3, evidenceScope: "working-workspace" } }) });
  assert.equal(upgraded.result.status, "recovery-required"); assert.equal(upgraded.result.code, "actual-sealed-receipt-required");
});

test("REAL clean capture cannot be labeled dirty-working, waive checks or claim eventual commit candidate-tree verification", { skip: process.platform !== "linux" }, async (t) => {
  const f = await nativeCleanupFixture(t);
  for (const patch of [{ evidenceScope: "working-workspace" }, { candidateTreeVerified: true }, { repositoryChecksWaived: true }]) {
    const v = await nativeVerification(t, f, { corruptHistory: (h) => Object.assign(h, patch) });
    blocked(v.result, "native-verification-evidence-mismatch"); assert.deepEqual(v.events, []); assert.equal(v.actualReceipt, undefined);
  }
});

test("real native cleanup revocation AFTER durable OWN removal prevents branch deletion and preserves partial facts", { skip: process.platform !== "linux" }, async (t) => {
  const f = await nativeCleanupFixture(t, { revokeAfterRemoval: true });
  const result = await f.controller.cleanup({ selector: { repositoryPath: f.repo, checkoutPath: f.sourcePath }, confirmation: "none" });
  assert.equal(result.status, "recovery-required"); assert.equal(result.recoveryRequired, true);
  assert.equal(result.knownFacts.sourceAbsent, true); assert.equal(result.knownFacts.removalVerified, true); assert.equal(result.knownFacts.removalRecorded, true);
  assert.equal(result.knownFacts.branchDeleteAttempted, false); assert.equal(result.knownFacts.featureRefAbsent, false);
  assert.equal(f.git(f.repo, "rev-parse", "refs/heads/feature"), f.featureOid);
  assert.equal(f.resourceReads.some(([cwd, present]) => cwd === f.sourcePath && !present), false);
  assert.deepEqual(f.leases(), [1, 1]); assert.equal(result.revisionDependency, undefined);
});
