import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { bindingTestModule } from "./git-workflow-binding-test-loader.mjs";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";

const jiti = createJiti(import.meta.url);
const native = await jiti.import("./git-commit.ts");
const invocation = await jiti.import("./git-invocation.ts");
const workspaceNative = await jiti.import("./git-workspace-operation.ts");
const preparationNative = await jiti.import("./git-preparation-apply.ts");
const cleanupNative = await jiti.import("./git-cleanup-operation.ts");
const checkoutNative = await jiti.import("./git-checkout-verification.ts");
const retention = await jiti.import("./git-diagnostic-retention.ts");
const paths = await jiti.import("./paths.ts");
const gitExec = await jiti.import("./git-exec.ts");
const policySchema = await jiti.import("./git-workflow-policy.ts");
const actionTypes = await jiti.import("./git-action-types.ts");
const recipes = await jiti.import("./git-check-recipe.ts");
const settingsSchema = await jiti.import("./git-workflow-settings.ts");
const { captureGitWorkingWorkspaceContentManifest: manifest } = await jiti.import("./git-working-workspace-snapshot.ts");
const review = await jiti.import("./git-review.ts");
const containment = await jiti.import("./git-check-containment.ts");
const projectEnv = await jiti.import("./project-command-env.ts");
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const required = (label = "commit check") => ({ label, argv: ["node", "--version"], requiredStage: "commit" });
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t, checks = [required()], nativeChecks = false) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "pi-commit-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const envNames = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"];
  const prior = new Map(envNames.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, "config"),
    GIT_CONFIG_GLOBAL: path.join(root, "no-global"), GIT_CONFIG_NOSYSTEM: "1" });
  t.after(() => { for (const [k, v] of prior) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const cwd = path.join(root, "sourceB"), agentDir = path.join(root, "agent"), template = path.join(root, "template");
  fs.mkdirSync(template); fs.mkdirSync(agentDir, { mode: 0o700 });
  git(root, "init", "-qb", "main", `--template=${template}`, cwd);
  git(cwd, "config", "user.name", "Commit Fixture"); git(cwd, "config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(cwd, "a"), "base\n"); fs.writeFileSync(path.join(cwd, "other"), "other\n");
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  const resources = bindingTestModule("./git-project-resources.ts", {
    "./file-access": { getAllowedFileRoots: async () => [root], isExistingFilePathAllowed: (p) => p === root || p.startsWith(root + path.sep), isWindowsAbsolutePath: () => false },
    "./git-exec": gitExec, "./paths": paths, "./git-workflow-policy": policySchema,
  });
  const source = await resources.selectGitProjectResources(cwd);
  const document = { version: 1, paused: false, global: {}, projects: { [cwd]: { checks: structuredClone(checks) } } };
  let legacyDefaults;
  const settingsStore = {
    readGitWorkflowSettingsDocument: (dir) => { assert.equal(dir, agentDir); return structuredClone(document); },
    projectWorkflowOverrides: async (doc, projectRoot, checkout, dir) => {
      assert.equal(dir, agentDir); assert.equal(projectRoot, cwd);
      assert.ok(checkout === cwd || checkout === path.join(root, "linked"));
      if (Object.hasOwn(doc.projects, projectRoot)) return doc.projects[projectRoot];
      if (!legacyDefaults) return {};
      const imported = settingsSchema.settingsFromLegacyPolicy(legacyDefaults); delete imported.enabled;
      return imported;
    },
  };
  const sdk = { getAgentDir: () => agentDir }; // Discovery NEVER reads the live user's config.
  const journal = nativeChecks ? bindingTestModule("./git-action-journal.ts", {
    "@earendil-works/pi-coding-agent": sdk, "./paths": paths, "./git-check-recipe": recipes,
    "./git-workflow-policy": policySchema, "./git-action-types": actionTypes, "./git-diagnostic-retention": retention,
  }) : undefined;
  const admission = bindingTestModule("./git-operation-admission.ts", {
    "@earendil-works/pi-coding-agent": sdk, "./git-project-resources": resources,
    "./git-exec": gitExec, "./git-workflow-policy": policySchema,
    "./git-workspace-operation": { readGitWorkspaceNativeProof: () => undefined },
    "./git-action-journal": journal ?? { readGitAction: async () => { throw new Error("Unexpected history read"); } },
    "./git-action-types": actionTypes, "./paths": paths,
  });
  const native = bindingTestModule("./git-commit.ts", {
    "./git-exec": gitExec, "./paths": paths, "./git-operation-admission": admission, "./git-invocation": invocation,
  });
  const controller = bindingTestModule("./git-action-controller.ts", {
    "./git-action-journal": journal ?? {}, "./git-action-types": actionTypes, "./session-reader": {}, "./git-commit": native, "./paths": paths,
    "./git-workspace-operation": workspaceNative, "./git-preparation-apply": preparationNative,
    "./git-cleanup-operation": cleanupNative, "./git-checkout-verification": checkoutNative,
  });
  const policy = { policyRevision: "policyB-1", savedProjectSettings: structuredClone(document.projects[cwd]),
    settings: { ...settingsSchema.DEFAULT_GIT_WORKFLOW_SETTINGS, checks: structuredClone(checks) } };
  let authority = "authority-1", cohort = "cohort-1";
  const receipts = new Map();
  const markers = ["index.lock", "HEAD.lock", "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START"];
  function snapshot(selection, boundary) {
    if (boundary) {
      assert.ok(native.readGitCommitProtectedBoundary(boundary, selection, agentDir), "authentic ledger owner AND real active FD required");
    }
    const allowed = boundary && native.readGitCommitNativeBoundary(boundary.ownedLock).indexLockPath;
    for (const dir of new Set([selection.gitDir, selection.commonDir])) for (const marker of markers) {
      const p = path.join(dir, marker);
      if (fs.existsSync(p) && p !== allowed) throw new Error("unsafe marker");
    }
    const flags = git(selection.cwd, "ls-files", "--debug", "-z");
    if ([...flags.matchAll(/\tflags: ([0-9a-f]+)\n/g)].some((m) => m[1] !== "0")) throw new Error("unsafe index flags");
    return hash([selection.identities, manifest(selection).digest,
      git(selection.cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"),
      git(selection.cwd, "show-ref", "--head"), git(selection.cwd, "symbolic-ref", "HEAD"), git(selection.cwd, "config", "--list", "--null")]);
  }
  // TRUSTED node:test native v3 reader simulation. No fabricated v2 success,
  // persisted receipts, model receipt fields or production injection channel.
  const reader = {
    assertBatchCurrentSync(ids, indexes) {
      // Existing NODE_TEST_CONTEXT-only native-reader simulation. Production
      // uses the fixed runner's authentic private attempt/settlement membership.
      const expected = (policy.savedProjectSettings.checks ?? []).flatMap((check, i) => check.requiredStage === "commit" ? [i] : []);
      assert.ok(expected.length); assert.deepEqual(indexes, expected); assert.equal(ids.length, expected.length);
      assert.equal(new Set(ids).size, ids.length);
      for (let i = 0; i < ids.length; i++) {
        const stored = receipts.get(ids[i]);
        assert.ok(stored && stored.cohort === cohort && stored.receipt.checkIndex === expected[i], "original ordered simulated batch required");
      }
    },
    async validate(id, options) {
      const stored = receipts.get(id);
      if (!stored || options.checkIndex !== stored.receipt.checkIndex || options.stage !== stored.receipt.stage ||
          options.sessionId !== stored.receipt.sessionId || stored.cohort !== cohort || Date.now() >= stored.receipt.expiresAt ||
          !await options.isTrusted(options.source.projectRoot) || !await options.isSelectionAuthorized(options.source) ||
          !await options.isCheckAuthorized(stored.receipt)) throw new Error("native receipt stale");
      await resources.revalidateGitProjectResources(options.source);
      if (stored.snapshot !== snapshot(options.source, options.protectedBoundary)) throw new Error("content stale");
      return stored.receipt;
    },
    assertCurrentSync(id, options) {
      const stored = receipts.get(id);
      if (!stored || stored.cohort !== cohort || Date.now() >= stored.receipt.expiresAt ||
          stored.snapshot !== snapshot(options.source, options.protectedBoundary)) throw new Error("native final source/cohort stale");
    },
  };
  const runner = nativeChecks ? bindingTestModule("./git-check-runner.ts", {
    "./git-exec": gitExec, "./paths": paths, "./git-check-containment": containment, "./git-operation-admission": admission,
    "./git-diagnostic-retention": retention,
  }) : undefined;
  const checker = nativeChecks ? bindingTestModule("./git-checkout-verification.ts", {
    "./git-exec": gitExec, "./project-command-env": projectEnv, "./git-check-recipe": recipes,
    "./git-workflow-settings": settingsSchema, "./git-project-resources": resources, "./git-operation-admission": admission,
    "./git-check-containment": containment, "./git-check-runner": runner, "./git-action-types": actionTypes,
    "./paths": paths, "./git-working-workspace-snapshot": { captureGitWorkingWorkspaceContentManifest: manifest }, "./git-commit": native,
  }) : {};
  const verification = bindingTestModule("./git-commit-verification.ts", {
    "node:fs": fs, "@earendil-works/pi-coding-agent": sdk,
    "./git-checkout-verification": checker, // Empty ONLY for trusted-reader simulation; never fake-cast v2.
    "./git-check-runner": runner ?? { gitCheckSyncValue: (value) => {
      if (value && typeof value.then === "function") {
        void Promise.resolve(value).catch(() => {}); throw new Error("synchronous authority required");
      }
      return value;
    } },
    "./git-workflow-store": { gitWorkflowDefaultsPath: () => path.join(agentDir, "absent-defaults") },
    "./git-workflow-write-epoch": { readGitWorkflowWriteEpoch: () => "fixture-epoch" },
    "./git-scoped-authority": {
      captureGitScopedAuthorityRevision: () => { const original = hash(document); return () => original; },
      readGitScopedAuthorityRevision: () => hash(document),
    },
    "./git-project-resources": resources, "./git-workflow-settings-store": settingsStore,
    "./git-check-recipe": recipes, "./git-workflow-settings": settingsSchema, "./git-commit": native,
  });
  const exact = bindingTestModule("./git-exact-commit-operation.ts", {
    "./git-commit": native, "./git-action-controller": controller, "./git-review": review,
    "./git-operation-admission": admission, "./git-commit-verification": verification, "./git-invocation": invocation,
  });
  // Standalone synchronous fixture authority contract: one immutable local actor,
  // no grant/trust/settings saving. Mutable authority tests advance `authority`;
  // these callbacks never stand in for production authority adapters.
  const context = { sessionId: "ownerB", agentDir, receiptIds: [], sourceGetPolicy: (selection) => {
    assert.equal(selection.projectRoot, cwd); return policy;
  }, isTrusted: (projectRoot) => projectRoot === cwd, isSelectionAuthorized: () => true,
  isCheckAuthorized: () => true, readAuthorityRevisionSync: () => authority, testReceiptReader: reader };
  function issue(index, selection = source) {
    const id = randomUUID(), now = Date.now();
    const receipt = Object.freeze({ kind: "selected-checkout-verification", version: 3, id, evidenceScope: "working-workspace",
      candidateTreeVerified: false, repositoryChecksWaived: false, sessionId: context.sessionId, selection,
      checkIndex: index, stage: "commit", policyRevision: policy.policyRevision, policyDigest: hash(policy.settings),
      finishedAt: now, expiresAt: now + 900_000, exitStatus: 0 });
    receipts.set(id, { receipt, snapshot: snapshot(selection), cohort }); context.receiptIds.push(id);
    return id;
  }
  function handle() {
    let record = { id: randomUUID(), sessionId: context.sessionId, state: "approved", kind: "commit" };
    return { get record() { return record; }, async update(state, extra) { record = { ...record, state, ...extra }; }, release() {} };
  }
  async function apply(capture, extra = {}) {
    const h = extra.handle ?? handle();
    const selected = extra.selection ?? source;
    const owner = { sessionId: context.sessionId, sessionFile: path.join(agentDir, "fixture-session.jsonl"), generation: "fixture-original" };
    const binding = native.gitCommitInvocationBinding(selected, capture.preview, "exact message", owner);
    const capability = invocation.captureGitInvocation(binding, { readAuthorityRevisionSync: context.readAuthorityRevisionSync,
      assertCurrentSync(actual) { assert.equal(actual.owner.sessionId, context.sessionId); assert.equal(actual.source.cwd, selected.cwd); } });
    const result = await exact.applyExactCommitOperation({ invocation: { handle: capability, owner }, handle: h, preview: capture.preview, message: "exact message", selection: source,
      agentDir, verificationHandle: capture.verification?.handle, beforeApply: async () => () => {
        // Private synchronous standalone-fixture actor guard, not a production grant.
        assert.equal(h.record.sessionId, context.sessionId);
        assert.equal(capture.preview.repositoryRoot, (extra.selection ?? source).cwd);
      },
      // Fixture-only result observation AFTER exact/native completion proof.
      // This plain test handle cannot enter production live diagnostic dispatch.
      finish: async (result) => { await h.update(result.status === "committed" ? "succeeded" : "recovery-required", { outcome: { kind: "commit", ...result } }); return result; },
      ...extra });
    return { result, handle: h };
  }
  if (nativeChecks) delete context.testReceiptReader;
  const executions = [];
  async function runNative(index, stage = "commit", afterJournal, nativeCohort) {
    const actionId = randomUUID();
    let journalFailure, intentPromise, record, binding;
    const captureIntent = (candidate) => intentPromise ??= (async () => {
      // Immutable fixture actor authorizes the actual native candidate. Persist
      // its target-free binding BEFORE any payload; no measured runs in intent.
      const working = candidate.snapshot.version === 3;
      assert.equal(working, stage === "commit");
      if (!working) assert.equal(candidate.snapshot.version, 2);
      binding = { sourceOid: git(cwd, "rev-parse", "HEAD"), sourceTreeOid: git(cwd, "rev-parse", "HEAD^{tree}"),
        snapshotDigest: hash(candidate.snapshot), policyDigest: candidate.policyDigest, policyRevision: candidate.policyRevision,
        stage, requiredSavedIndexes: stage === "commit" ? [index] : [], evidenceScope: working ? "working-workspace" : "clean-checkout",
        candidateTreeVerified: false, repositoryChecksWaived: false };
      const snapshot = controller.snapshotGitCheckoutVerificationAction(source, { ...binding,
        source: { gitDir: source.gitDir, checkoutIdentity: source.identities.checkout,
          gitIdentity: source.identities.git, markerIdentity: source.identities.marker },
        checks: [{ checkIndex: index, recipe: policy.settings.checks[index], recipeDigest: candidate.recipeDigest,
          environmentDigest: candidate.snapshot.environmentDigest, executionCwd: path.resolve(cwd, policy.settings.checks[index].cwd ?? "."),
          // Strict v2 history binds this exact native per-check clean snapshot;
          // commit-v3 history must not carry a relabelled v2 manifest.
          ...(working ? {} : { snapshot: candidate.snapshot }) }] });
      record = await journal.createGitActionWithId(actionId, { sessionId: context.sessionId, source: "agent", candidate: snapshot }, agentDir);
      t.after(() => journal.releaseGitAction(actionId, agentDir));
      record = await journal.transitionGitAction(actionId, record.revision, { state: "executing",
        intended: { kind: "checkout-verification", checkoutVerification: { ...binding, runs: [] } } }, agentDir);
    })().catch((cause) => { journalFailure = cause; throw cause; });
    const backend = createTestContainmentBackend();
    const originalObservations = new WeakMap();
    // Explicit protocol simulation only, not OS containment. Match native fact
    // formats without rewriting the measured execution supplied to the journal.
    const proofBackend = { ...backend, async observe(...args) {
      const original = await backend.observe(...args);
      const observation = { ...original, identity: `1:2:${original.unit.InvocationID}:${original.unit.ControlGroup}`,
        launcherIdentity: "123:1:2:3" };
      originalObservations.set(observation, original);
      return observation;
    }, assertLauncherCwd(name, observation, expected) {
      const original = originalObservations.get(observation);
      assert.ok(original, "fixture must retain the originally observed launcher");
      return backend.assertLauncherCwd(name, original, expected);
    }, async originalEmpty() { return "pinned-populated-zero"; } };
    const receipt = await checker.runGitCheckoutVerification({ sessionId: context.sessionId, agentDir, actionId,
      selector: { repositoryPath: cwd, checkoutPath: cwd }, checkIndex: index, stage, cohort: nativeCohort,
      getPolicy: context.sourceGetPolicy, isTrusted: context.isTrusted, isSelectionAuthorized: context.isSelectionAuthorized,
      isActorAuthorized: async (candidate) => { await captureIntent(candidate); return true; },
      readAuthorityRevisionSync: context.readAuthorityRevisionSync,
      testContainmentBackend: proofBackend, testRecoveryEvidence: true,
      onExecution: async (execution) => {
        assert.equal(checker.readGitCheckoutVerificationNativeExecution(execution), execution);
        assert.equal(execution.actionId, actionId);
        assert.equal(execution.receipt, undefined, "measurement is not published success");
        assert.ok(record?.intended);
        assert.equal(record.intended.checkoutVerification.snapshotDigest, execution.snapshotDigest);
        await afterJournal?.(execution);
      } }).catch((cause) => { throw journalFailure ?? cause; });
    const execution = checker.readGitCheckoutVerificationNativeExecution(receipt);
    assert.equal(execution.receipt.id, receipt.id);
    const outcome = { kind: "checkout-verification", status: "passed", checkoutVerification: { ...binding, runs: [execution] } };
    await journal.transitionGitAction(actionId, record.revision, { state: "succeeded", outcome }, agentDir);
    const history = await journal.readGitAction(actionId, {}, agentDir);
    assert.deepEqual(history.record.outcome.checkoutVerification.runs, [execution]);
    executions.push(execution);
    assert.equal(checker.lookupGitCheckoutVerificationReceipt(receipt.id), receipt);
    context.receiptIds.push(receipt.id); return receipt;
  }
  const capture = (mode = "whole-file", c = context) => exact.captureExactCommitCandidate(cwd, ["a"], "exact message", mode, false, c);
  const change = () => fs.writeFileSync(path.join(cwd, "a"), "workspace fixed\n");
  return { root, cwd, agentDir, source, context, policy, document, reader, resources, admission, controller, verification, exact,
    native, checker, runner, runNative, journal, executions,
    setLegacy: (input) => {
      legacyDefaults = policySchema.validateGitWorkflowPolicy(input);
      delete document.projects[cwd];
      const imported = settingsSchema.settingsFromLegacyPolicy(legacyDefaults); delete imported.enabled;
      policy.savedProjectSettings = imported;
      policy.settings = settingsSchema.resolveGitWorkflowSettings(document.global, imported).values;
    },
    receipts, issue, capture, apply, handle, change, setAuthority: (v) => { authority = v; }, failCohort: () => { cohort = "cohort-failed"; } };
}

test("canonical Project required checks fail closed before common capture/apply even with missing context", async (t) => {
  const f = await fixture(t); f.change();
  await assert.rejects(f.exact.captureExactCommitCandidate(f.cwd, ["a"], "exact message", "whole-file"), /missing-context/);
});

test("legacy common capture and apply cannot omit new context; no intent/ref/index mutation", async (t) => {
  const f = await fixture(t); f.change();
  const before = fs.readFileSync(path.join(f.source.gitDir, "index")), head = git(f.cwd, "rev-parse", "HEAD");
  await assert.rejects(f.exact.captureExactCommitCandidate(f.cwd, ["a"], "exact message", "whole-file"), /missing-context/);
  const preview = await native.prepareGitCommit(f.cwd, ["a"]);
  const h = f.handle();
  await assert.rejects(f.apply({ preview }, { handle: h }), /missing-context/);
  assert.equal(h.record.state, "blocked");
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), head); assert.deepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), before);
  assert.equal(fs.existsSync(path.join(f.agentDir, "pi-web")), false);
});

for (const checks of [[], [{ label: "old recipe", argv: ["node", "--version"] }], [{ ...required(), requiredStage: "none" }]]) {
  test(`zero-required old API unchanged (${checks[0]?.requiredStage ?? checks[0]?.label ?? "no-defined"}), never tests waived`, async (t) => {
    const f = await fixture(t, checks); f.change();
    const captured = await f.exact.captureExactCommitCandidate(f.cwd, ["a"], "exact message", "whole-file");
    assert.equal(captured.verification.summary.status, checks.length ? "no-required" : "no-defined");
    assert.equal(captured.verification.summary.repositoryChecksWaived, false);
    assert.equal(captured.verification.summary.candidateTreeVerified, false);
    assert.equal((await f.apply(captured)).result.status, "committed");
  });
}

for (const mode of ["whole-file", "staged"]) for (const actor of ["ask", "none", "human/manual"]) {
  test(`${actor}/${mode} uses same common prerequisite; working workspace not candidate tree`, async (t) => {
    const f = await fixture(t, [{ label: "integration only", argv: ["node", "--version"] }, required("commit one"),
      { ...required("optional"), requiredStage: "none" }, required("commit two")]);
    f.change();
    if (mode === "staged") {
      fs.writeFileSync(path.join(f.cwd, "a"), "staged but failing\n"); git(f.cwd, "add", "a");
      fs.writeFileSync(path.join(f.cwd, "a"), "workspace fixed\n");
      fs.writeFileSync(path.join(f.cwd, "other"), "unselected staged\n"); git(f.cwd, "add", "other");
      fs.writeFileSync(path.join(f.cwd, "other"), "unselected staged\nunstaged\n");
    }
    const index = fs.readFileSync(path.join(f.source.gitDir, "index"));
    f.issue(1); f.issue(3); // Exact ascending ORIGINAL saved indexes, not 0/1 filtered indexes.
    const captured = await f.capture(mode);
    assert.deepEqual(captured.verification.summary.checkIndexes, [1, 3]);
    assert.equal(captured.verification.summary.evidenceScope, "working-workspace");
    assert.equal(captured.verification.summary.candidateTreeVerified, false);
    const { result } = await f.apply(captured); assert.equal(result.status, "committed");
    assert.equal(git(f.cwd, "show", "HEAD:a"), mode === "staged" ? "staged but failing" : "workspace fixed");
    if (mode === "staged") {
      assert.deepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), index);
      assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "other");
      assert.equal(git(f.cwd, "diff", "--name-only"), "a\nother");
    }
  });
}

test("missing, duplicate, foreign, expired, failed cohort, v1, v2 and wrong-stage receipts refuse", async (t) => {
  const f = await fixture(t); f.change();
  await assert.rejects(f.capture(), /missing-receipts/);
  const id = f.issue(0), original = f.receipts.get(id);
  f.context.receiptIds.push(id); await assert.rejects(f.capture(), /missing-receipts/); f.context.receiptIds.pop();
  for (const patch of [{ sessionId: "foreign" }, { stage: "integration" }, { expiresAt: Date.now() - 1 }, { version: 1 },
    { version: 2 }, { evidenceScope: "candidate-tree" }, { candidateTreeVerified: true }, { repositoryChecksWaived: true }, { exitStatus: 1 }]) {
    f.receipts.set(id, { ...original, receipt: { ...original.receipt, ...patch } });
    await assert.rejects(f.capture(), /stale/);
  }
  f.receipts.set(id, original); f.failCohort(); await assert.rejects(f.capture(), /stale/);
});

test("linked checkout discovers canonical source Project even when context is omitted", async (t) => {
  const f = await fixture(t); const linked = path.join(f.root, "linked");
  git(f.cwd, "worktree", "add", "-qb", "feature", linked);
  fs.writeFileSync(path.join(linked, "a"), "linked change\n");
  await assert.rejects(f.exact.captureExactCommitCandidate(linked, ["a"], "exact message", "whole-file"), /missing-context/);
  const selection = await f.resources.selectGitProjectResources(linked);
  assert.equal(selection.projectRoot, f.cwd);
  f.issue(0, selection);
  const captured = await f.exact.captureExactCommitCandidate(linked, ["a"], "exact message", "whole-file", false, f.context);
  assert.equal((await f.apply(captured, { selection })).result.status, "committed");
  assert.equal(git(linked, "show", "HEAD:a"), "linked change");
  assert.equal(git(f.cwd, "show", "HEAD:a"), "base");
});

test("missing native reader export fails closed, never adapted from v2", async (t) => {
  const f = await fixture(t); f.change(); f.issue(0);
  delete f.context.testReceiptReader;
  await assert.rejects(f.capture(), /unavailable/);
});

test("captured evidence is process-only and bound to mode, paths, HEAD, tree, message and index token", async (t) => {
  const f = await fixture(t); f.change(); f.issue(0); const captured = await f.capture();
  for (const patch of [{ verificationHandle: {} }, { message: "different" },
    { preview: { ...captured.preview, mode: "staged" } }, { preview: { ...captured.preview, paths: ["other"] } },
    { preview: { ...captured.preview, tree: "0".repeat(40) } }, { preview: { ...captured.preview, head: "0".repeat(40) } },
    { preview: { ...captured.preview, reviewToken: "0".repeat(64) } }]) {
    await assert.rejects(f.apply(captured, patch), /stale|binding mismatch/);
    assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
  }
});

test("native final source/cohort/authority guard runs after asynchronous callbacks and boundary hooks", async (t) => {
  const f = await fixture(t); f.change(); f.issue(0); const captured = await f.capture();
  const index = fs.readFileSync(path.join(f.source.gitDir, "index"));
  await assert.rejects(f.apply(captured, { atRefBoundary: () => { f.failCohort(); } }), /stale/);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
  assert.deepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), index);
});

test("new required recipe inserted during an awaited callback cannot reuse no-required evidence", async (t) => {
  const f = await fixture(t, []); f.change(); const captured = await f.capture();
  await assert.rejects(f.apply(captured, { beforeApply: async (boundary) => {
    await tick(); if (boundary) f.document.projects[f.cwd].checks = [required()];
  } }), /stale/);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
});

test("protected validation refuses a fabricated lock-path/JSON proof before invoking reservation methods", async (t) => {
  const f = await fixture(t); f.change(); f.issue(0); const captured = await f.capture();
  let invoked = false;
  const fake = { ownedLock: { indexLockPath: path.join(f.source.gitDir, "index.lock") }, reservation: { assertOwned() { invoked = true; } } };
  await assert.rejects(f.verification.revalidateGitCommitVerification(captured.verification.handle, captured.preview, "exact message", fake), /stale/);
  assert.equal(invoked, false);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
});

test("MM status with different dirty tracked and untracked bytes invalidates content digest", async (t) => {
  const f = await fixture(t); f.change(); git(f.cwd, "add", "a");
  fs.writeFileSync(path.join(f.cwd, "a"), "unstaged fix 1\n"); fs.writeFileSync(path.join(f.cwd, "new"), "untracked one\n");
  f.issue(0); const captured = await f.capture("staged"), status = git(f.cwd, "status", "--porcelain");
  fs.writeFileSync(path.join(f.cwd, "a"), "unstaged fix 2\n"); fs.writeFileSync(path.join(f.cwd, "new"), "untracked two\n");
  assert.equal(git(f.cwd, "status", "--porcelain"), status);
  await assert.rejects(f.apply(captured), /stale/);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
});

test("source B policy and check authorization cannot be substituted with caller A or commit scope", async (t) => {
  const f = await fixture(t); f.change(); f.issue(0);
  const captured = await f.capture();
  f.context.isCheckAuthorized = () => false;
  await assert.rejects(f.capture(), /stale|denied/);
  f.context.isCheckAuthorized = () => true;
  f.context.sourceGetPolicy = () => ({ ...f.policy, savedProjectSettings: { checks: [] }, settings: { ...f.policy.settings, checks: [] } });
  await assert.rejects(f.capture(), /stale/);
  f.policy.policyRevision = "sourceB-2";
  await assert.rejects(f.apply(captured), /stale/);
});

test("async authorization requires a live synchronous revision, and late revocation refuses before CAS", async (t) => {
  const f = await fixture(t); f.change(); f.issue(0);
  f.context.isTrusted = async () => true;
  delete f.context.readAuthorityRevisionSync;
  await assert.rejects(f.capture(), /stale/);
  let revision = "revision-initial";
  f.context.readAuthorityRevisionSync = () => revision;
  const captured = await f.capture();
  let applies = 0;
  await assert.rejects(f.apply(captured, { beforeApply: async (boundary) => {
    applies++; await tick(); if (boundary) revision = "revoked";
  } }), /stale/);
  assert.ok(applies >= 2);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
});

for (const late of ["cohort", "authority", "files", "refs", "root"]) test(`late async ${late} change before CAS: zero native mutation`, async (t) => {
  const f = await fixture(t); f.change(); f.issue(0);
  const captured = await f.capture(), h = f.handle();
  const index = fs.readFileSync(path.join(f.source.gitDir, "index"));
  const moved = f.cwd + "-moved";
  let lateRef;
  h.update = async function (state, extra) {
    // Preserve getter-backed fixture record using the saved method below.
    await update(state, extra);
    if (state !== "executing") return;
    await tick();
    if (late === "cohort") f.failCohort();
    if (late === "authority") f.setAuthority("revoked");
    if (late === "files") fs.writeFileSync(path.join(f.cwd, "other"), "changed outside selection\n");
    if (late === "refs") { git(f.cwd, "branch", "late-ref", captured.preview.head); lateRef = "late-ref"; }
    if (late === "root") { fs.renameSync(f.cwd, moved); fs.mkdirSync(f.cwd); }
  };
  // Save a separate record updater before using the replacement above.
  const record = h.record;
  const update = async (state, extra) => { Object.assign(record, { state, ...extra }); };
  try {
    await assert.rejects(f.apply(captured, { handle: h }));
    const physical = late === "root" ? moved : f.cwd;
    assert.equal(git(physical, "rev-parse", "HEAD"), captured.preview.head);
    assert.deepEqual(fs.readFileSync(path.join(physical, ".git", "index")), index);
    assert.equal(record.state, "blocked");
  } finally {
    if (late === "root") { fs.rmdirSync(f.cwd); fs.renameSync(moved, f.cwd); }
    if (lateRef) git(f.cwd, "branch", "-D", lateRef);
  }
});

test("inherited Global commit definitions are explicitly unsupported even without new context", async (t) => {
  const f = await fixture(t, []); f.change();
  delete f.document.projects[f.cwd].checks;
  delete f.policy.savedProjectSettings.checks;
  f.document.global.checks = [required("inherited source B")];
  f.policy.settings.checks = structuredClone(f.document.global.checks);
  for (const context of [undefined, f.context]) {
    await assert.rejects(f.exact.captureExactCommitCandidate(f.cwd, ["a"], "exact message", "whole-file", false, context),
      (error) => error instanceof f.verification.GitCommitVerificationError && error.code === "unsupported-inheritance" && /not supported/.test(error.message));
  }
  assert.equal(fs.existsSync(path.join(f.agentDir, "pi-web")), false);
});

test("effective source B Chat commit recipes cannot become no-required or borrow caller A definitions", async (t) => {
  const f = await fixture(t, []); f.change(); delete f.document.projects[f.cwd].checks; delete f.policy.savedProjectSettings.checks;
  f.policy.settings.checks = [required("effective source B Chat")];
  await assert.rejects(f.capture(), /unsupported-inheritance/);
  f.policy.settings.checks = [{ label: "legacy inheritance", argv: ["node", "--version"] }];
  f.document.global.checks = structuredClone(f.policy.settings.checks);
  const captured = await f.capture();
  assert.equal(captured.verification.summary.status, "no-required");
  assert.deepEqual(captured.verification.summary.checkIndexes, []);
  assert.equal(captured.verification.summary.repositoryChecksWaived, false);
  assert.equal((await f.apply(captured)).result.status, "committed");
});

test("explicit saved Project recipe override is independent of a foreign Global required list", async (t) => {
  const f = await fixture(t, []); f.change(); f.document.global.checks = [required("not the source recipe profile")];
  const captured = await f.capture();
  assert.equal(captured.verification.summary.status, "no-defined");
  assert.equal((await f.apply(captured)).result.status, "committed");
});

test("joint seal refuses copied/foreign-source/retired owners and requires original authorization invocation", async (t) => {
  const f = await fixture(t, []); f.change();
  const preview = await f.native.prepareGitCommit(f.cwd, ["a"]), message = "exact message";
  const operation = await f.admission.beginSupervisedGitOperationIntent(f.source, randomUUID(), "commit", f.agentDir);
  const owner = { sessionId: f.context.sessionId, sessionFile: path.join(f.agentDir, "fixture.jsonl"), generation: "original" };
  const binding = f.native.gitCommitInvocationBinding(f.source, preview, message, owner);
  const capability = invocation.captureGitInvocation(binding, { readAuthorityRevisionSync: f.context.readAuthorityRevisionSync,
    assertCurrentSync(actual) { assert.equal(actual.owner.sessionId, f.context.sessionId); } });
  let seal;
  await assert.rejects(f.native.confirmGitCommit(preview, message, async (_, lock) => {
    assert.equal(f.admission.readGitOperationInvocationOwner({ ...operation }), undefined);
    for (const [op, source, cap, dir] of [[{ ...operation }, f.source, capability, f.agentDir],
      [operation, { ...f.source, branch: "foreign" }, capability, f.agentDir],
      [operation, f.source, { ...capability }, f.agentDir], [operation, f.source, capability, f.agentDir + "-other"]]) {
      assert.throws(() => f.native.captureGitCommitProtectedBoundary(lock, op, source, cap, binding, dir));
    }
    seal = f.native.captureGitCommitProtectedBoundary(lock, operation, f.source, capability, binding, f.agentDir);
    assert.ok(f.native.readGitCommitProtectedBoundary(seal, f.source, f.agentDir));
    assert.equal(f.native.readGitCommitProtectedBoundary({ ...seal }, f.source, f.agentDir), undefined);
    operation.retire();
    assert.equal(f.native.readGitCommitProtectedBoundary(seal, f.source, f.agentDir), undefined);
    throw new Error("fixture refusal before CAS");
  }, { operation, invocation: capability, binding }), /fixture refusal/);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), preview.head);
});

for (const mode of ["whole-file", "staged"]) test(`REAL native v3 receipt and common protected boundary (${mode}), workspace only`, async (t) => {
  const recipe = { label: "read actual workspace fix", argv: [process.execPath, "-e",
    "if(require('node:fs').readFileSync('a','utf8')!=='workspace fixed\\n')process.exit(1)"], requiredStage: "commit" };
  const f = await fixture(t, [recipe], true); f.change();
  if (mode === "staged") {
    fs.writeFileSync(path.join(f.cwd, "a"), "staged but failing\n"); git(f.cwd, "add", "a"); f.change();
    fs.writeFileSync(path.join(f.cwd, "other"), "unselected staged\n"); git(f.cwd, "add", "other");
    fs.writeFileSync(path.join(f.cwd, "other"), "unselected staged\nunstaged\n");
  }
  const index = fs.readFileSync(path.join(f.source.gitDir, "index"));
  const receipt = await f.runNative(0);
  assert.equal(receipt.version, 3); assert.equal(receipt.snapshot.version, 3);
  assert.equal(receipt.snapshot.workspaceContentDigest.length, 64);
  assert.equal(receipt.candidateTreeVerified, false);
  const captured = await f.capture(mode);
  const { result } = await f.apply(captured);
  assert.equal(result.status, "committed");
  assert.equal(git(f.cwd, "show", "HEAD:a"), mode === "staged" ? "staged but failing" : "workspace fixed");
  if (mode === "staged") {
    assert.deepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), index);
    assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "other");
  }
});

test("REAL v3 final synchronous guard rehashes dirty working bytes after the last async check callback", async (t) => {
  const recipe = { label: "check workspace", argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "commit" };
  const f = await fixture(t, [recipe], true); f.change(); git(f.cwd, "add", "a");
  fs.writeFileSync(path.join(f.cwd, "a"), "unstaged fix one\n");
  await f.runNative(0);
  let protectedCalls = 0, atProtected = false;
  f.context.isCheckAuthorized = async () => {
    await tick();
    if (atProtected && ++protectedCalls === 2) fs.writeFileSync(path.join(f.cwd, "a"), "unstaged fix two\n");
    return true;
  };
  const captured = await f.capture("staged"), index = fs.readFileSync(path.join(f.source.gitDir, "index"));
  const status = git(f.cwd, "status", "--porcelain");
  await assert.rejects(f.apply(captured, { beforeApply: async (boundary) => { await tick(); if (boundary) atProtected = true; } }), /stale/);
  assert.ok(protectedCalls >= 2);
  assert.equal(git(f.cwd, "status", "--porcelain"), status);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
  assert.deepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), index);
});

test("REAL v3 rehashes bytes changed during native's last awaited staged recapture, after the common callback", async (t) => {
  const f = await fixture(t, [{ label: "source", argv: [process.execPath, "--version"], requiredStage: "commit" }], true);
  f.change(); git(f.cwd, "add", "a"); fs.writeFileSync(path.join(f.cwd, "a"), "unstaged one\n");
  await f.runNative(0); const captured = await f.capture("staged");
  const indexPath = path.join(f.source.gitDir, "index"), before = fs.readFileSync(indexPath);
  const status = git(f.cwd, "status", "--porcelain");
  let protectedStarted = false, changed = false, finalReached = false;
  const original = fs.promises.readFile;
  const mock = t.mock.method(fs.promises, "readFile", async (file, ...args) => {
    const bytes = await original(file, ...args);
    if (protectedStarted && !changed && file === indexPath) {
      fs.writeFileSync(path.join(f.cwd, "a"), "unstaged two\n"); changed = true;
    }
    return bytes;
  });
  try {
    await assert.rejects(f.apply(captured, { beforeApply: async (boundary) => { await tick(); if (boundary) protectedStarted = true; },
      atRefBoundary: () => { finalReached = true; } }), /stale/);
  } finally { mock.mock.restore(); }
  assert.equal(changed, true); assert.equal(finalReached, true);
  assert.equal(git(f.cwd, "status", "--porcelain"), status);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
  assert.deepEqual(fs.readFileSync(indexPath), before);
});

test("Phase-1 saved Project defaults retain extended commit prerequisites and legacy omitted-stage semantics", async (t) => {
  const f = await fixture(t, []); f.change();
  f.setLegacy({ mode: "current", branch: "main", commits: "manual", onCreate: "stay", checks: [required("Phase-1 saved")] });
  await assert.rejects(f.exact.captureExactCommitCandidate(f.cwd, ["a"], "exact message", "whole-file"), /missing-context/);
  f.issue(0); const captured = await f.capture();
  assert.deepEqual(captured.verification.summary.checkIndexes, [0]);
  assert.equal((await f.apply(captured)).result.status, "committed");
  f.change(); fs.writeFileSync(path.join(f.cwd, "a"), "second workspace fix\n");
  f.setLegacy({ mode: "current", branch: "main", commits: "manual", onCreate: "stay", checks: [{ label: "old definition", argv: ["node", "--version"] }] });
  const old = await f.exact.captureExactCommitCandidate(f.cwd, ["a"], "exact message", "whole-file");
  assert.equal(old.verification.summary.status, "no-required");
  assert.equal(old.verification.summary.repositoryChecksWaived, false);
});

test("REAL v3 rejects foreign/expired IDs and a genuine clean v2 manual receipt", async (t) => {
  const f = await fixture(t, [{ label: "commit", argv: [process.execPath, "--version"], requiredStage: "commit" },
    { label: "manual", argv: [process.execPath, "--version"], requiredStage: "none" }], true);
  const manual = await f.runNative(1, "none"); assert.equal(manual.version, 2);
  const history = await f.journal.readGitAction(f.executions[0].actionId, { includeArtifact: true }, f.agentDir);
  const saved = history.candidate.checkoutVerification;
  assert.equal(saved.evidenceScope, "clean-checkout"); assert.equal(saved.stage, "none");
  assert.deepEqual(saved.checks[0].snapshot, manual.snapshot);
  assert.equal(history.record.outcome.checkoutVerification.evidenceScope, "clean-checkout");
  f.change(); await assert.rejects(f.capture(), /stale/);
  f.context.receiptIds.length = 0;
  const receipt = await f.runNative(0);
  f.context.sessionId = "foreign owner"; await assert.rejects(f.capture(), /stale/); f.context.sessionId = receipt.sessionId;
  const mock = t.mock.method(Date, "now", () => receipt.expiresAt + 1);
  try { await assert.rejects(f.capture(), /stale/); } finally { mock.mock.restore(); }
  assert.equal(git(f.cwd, "show", "HEAD:a"), "base");
});

test("REAL two-required commit rejects independently successful single-member cohorts", async (t) => {
  const recipe = label => ({ label, argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "commit" });
  const f = await fixture(t, [recipe("one"), recipe("two")], true); f.change();
  const first = await f.runNative(0), second = await f.runNative(1);
  assert.equal(f.checker.lookupGitCheckoutVerificationReceipt(first.id), first);
  assert.equal(f.checker.lookupGitCheckoutVerificationReceipt(second.id), second);
  await assert.rejects(f.capture(), /stale|batch/);
  assert.equal(git(f.cwd, "show", "HEAD:a"), "base");
});

test("REAL required source recipes share one batch across cwd/env, reject reversed IDs, and commit with protected index FD", async (t) => {
  const recipe = (cwd, value) => ({ label: `source ${cwd}`, cwd, env: { COMMIT_FIXTURE: value }, requiredStage: "commit",
    argv: [process.execPath, "-e", `if(process.env.COMMIT_FIXTURE!==${JSON.stringify(value)}||require('node:fs').readFileSync('../a','utf8')!=='workspace fixed\\n')process.exit(1)`] });
  const f = await fixture(t, [{ label: "old integration-only", argv: [process.execPath, "--version"] }, recipe("check-one", "one"),
    { label: "manual-only", argv: [process.execPath, "--version"], requiredStage: "none" }, recipe("check-two", "two")], true);
  fs.mkdirSync(path.join(f.cwd, "check-one")); fs.mkdirSync(path.join(f.cwd, "check-two")); f.change();
  const before = fs.readFileSync(path.join(f.source.gitDir, "index"));
  const cohort = f.runner.createGitCheckCohort([1, 3]);
  const first = await f.runNative(1, "commit", undefined, cohort), second = await f.runNative(3, "commit", undefined, cohort);
  assert.equal(f.checker.lookupGitCheckoutVerificationReceipt(first.id), first, "positive sibling settlement must retain the original receipt");
  assert.deepEqual(f.context.receiptIds, [first.id, second.id]);
  for (const receipt of [first, second]) assert.equal(receipt.snapshot.workspaceIndexDigest, createHash("sha256").update(before).digest("hex"));
  await assert.rejects(f.capture("whole-file", { ...f.context, receiptIds: [second.id, first.id] }), /stale/);
  const captured = await f.capture();
  assert.deepEqual(captured.verification.summary.checkIndexes, [1, 3]);
  assert.equal(captured.verification.summary.candidateTreeVerified, false);
  assert.equal((await f.apply(captured)).result.status, "committed");
  assert.notDeepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), before, "whole-file commit installs its selected tree into the real index");
  assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "");
  assert.equal(git(f.cwd, "show", "HEAD:other"), "other");
  assert.equal(git(f.cwd, "show", "HEAD:a"), "workspace fixed");
  assert.equal(f.executions.length, 2);
  for (const run of f.executions) {
    assert.equal(run.exitStatus, 0);
    assert.equal((await f.journal.readGitAction(run.actionId, {}, f.agentDir)).record.state, "succeeded");
  }
});

test("REAL own late sibling failure cannot mix or fall back to an older independent complete batch", async (t) => {
  const recipe = code => ({ label: "required", argv: [process.execPath, "-e", code], requiredStage: "commit" });
  const f = await fixture(t, [recipe("process.exit(0)"), recipe("if(require('fs').existsSync('ignored-failure'))process.exit(7)")], true);
  fs.mkdirSync(path.join(f.source.gitDir, "info"), { recursive: true });
  fs.writeFileSync(path.join(f.source.gitDir, "info", "exclude"), "ignored-failure\n"); f.change();
  const older = f.runner.createGitCheckCohort([0, 1]);
  const a = await f.runNative(0, "commit", undefined, older), b = await f.runNative(1, "commit", undefined, older);
  const own = f.runner.createGitCheckCohort([0, 1]), first = await f.runNative(0, "commit", undefined, own);
  f.context.receiptIds = [first.id, b.id]; await assert.rejects(f.capture(), /stale/);
  fs.writeFileSync(path.join(f.cwd, "ignored-failure"), "explicitly uncovered input");
  await assert.rejects(f.runNative(1, "commit", undefined, own));
  assert.equal(f.checker.lookupGitCheckoutVerificationReceipt(first.id), undefined);
  await assert.rejects(f.capture(), /stale/); // no automatic old-ID search/fallback
  assert.equal(f.checker.lookupGitCheckoutVerificationReceipt(a.id), a); assert.equal(f.checker.lookupGitCheckoutVerificationReceipt(b.id), b);
  assert.equal((await f.capture("whole-file", { ...f.context, receiptIds: [a.id, b.id] })).verification.summary.status, "required");
});

test("REAL final awaited authorization cannot retire the chosen complete batch then fall back to another", async (t) => {
  const recipe = label => ({ label, argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "commit" });
  const f = await fixture(t, [recipe("one"), recipe("two")], true); f.change();
  const own = f.runner.createGitCheckCohort([0, 1]);
  await f.runNative(0, "commit", undefined, own); await f.runNative(1, "commit", undefined, own);
  const captured = await f.capture(); let retired = false;
  f.context.isCheckAuthorized = async receipt => {
    if (receipt.checkIndex === 1 && !retired) { retired = true; f.runner.retireGitCheckCohort(own); }
    return true;
  };
  // The captured context owns original callback identities; arm that callback
  // through a separate fresh capture, rather than pretending replacement rebases it.
  await assert.rejects(f.capture(), /stale/); assert.equal(retired, true);
  await assert.rejects(f.apply(captured), /stale/); assert.equal(git(f.cwd, "show", "HEAD:a"), "base");
});

test("REAL v3 independent failed run cannot invalidate older success with unchanged covered bytes and policy", async (t) => {
  const f = await fixture(t, [{ label: "cohort", argv: [process.execPath, "-e",
    "if(require('node:fs').existsSync('ignored-failure'))process.exit(1)"], requiredStage: "commit" }], true);
  fs.mkdirSync(path.join(f.source.gitDir, "info"));
  fs.writeFileSync(path.join(f.source.gitDir, "info", "exclude"), "ignored-failure\n"); f.change();
  const receipt = await f.runNative(0), before = manifest(f.source).digest;
  fs.writeFileSync(path.join(f.cwd, "ignored-failure"), "fixture failure trigger\n");
  assert.equal(manifest(f.source).digest, before); // Ignored inputs are explicitly not covered, never candidate-tree proof.
  await assert.rejects(f.runNative(0));
  assert.equal(f.checker.lookupGitCheckoutVerificationReceipt(receipt.id), receipt);
  assert.equal((await f.capture()).verification.summary.status, "required");
  assert.equal(git(f.cwd, "show", "HEAD:a"), "base");
  assert.equal(fs.existsSync(path.join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

test("common final actor guard rejects a thenable even without repository-required checks", async (t) => {
  const f = await fixture(t, []); f.change(); const captured = await f.capture();
  const before = fs.readFileSync(path.join(f.source.gitDir, "index"));
  const h = f.handle(); let guarded = false;
  await assert.rejects(f.apply(captured, { handle: h, beforeApply: async () => async () => { guarded = true; } }), /guard must be synchronous/);
  assert.equal(guarded, true); assert.equal(h.record.state, "blocked");
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
  assert.deepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), before);
  assert.equal(fs.existsSync(path.join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

for (const late of ["callback-failure", "same-status-bytes"]) test(`REAL optional diagnostics do not certify success; callback mutation matters (${late})`, async (t) => {
  const f = await fixture(t, [{ label: "source", argv: [process.execPath, "--version"], requiredStage: "commit" }], true);
  f.change(); const status = git(f.cwd, "status", "--porcelain"), head = git(f.cwd, "rev-parse", "HEAD");
  const before = fs.readFileSync(path.join(f.source.gitDir, "index"));
  let measured;
  const pending = f.runNative(0, "commit", async (execution) => {
    measured = execution; assert.equal(execution.receipt, undefined); await tick();
    if (late === "callback-failure") throw new Error("fixture journal failed after its await");
    fs.writeFileSync(path.join(f.cwd, "a"), "different dirty bytes\n");
  });
  if (late === "callback-failure") {
    const receipt = await pending;
    assert.equal(receipt.diagnostics.reason, "storage-unavailable");
    assert.equal(f.checker.readGitCheckoutVerificationNativeExecution(receipt).receipt.id, receipt.id);
  } else { await assert.rejects(pending, /recovery-required/); assert.deepEqual(f.context.receiptIds, []); }
  assert.equal(measured.exitStatus, 0); assert.equal(measured.receipt, undefined);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), head); assert.equal(git(f.cwd, "status", "--porcelain"), status);
  assert.deepEqual(fs.readFileSync(path.join(f.source.gitDir, "index")), before);
});

test("known commit is retained when optional completion recording fails", async (t) => {
  const f = await fixture(t, []); f.change(); const captured = await f.capture(); const h = f.handle(); let warning = false;
  const { result } = await f.apply(captured, { handle: h, record: async () => { throw new Error("fixture storage failure"); },
    onRecordingUnavailable: () => { warning = true; } });
  assert.equal(result.status, "committed"); assert.equal(warning, true);
  assert.equal(h.record.outcome.commit, git(f.cwd, "rev-parse", "HEAD"));
  assert.equal(fs.existsSync(path.join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

test("known commit survives essential finalizer failure without blind retry or artificial quarantine", async (t) => {
  const f = await fixture(t, []); f.change(); const captured = await f.capture();
  const h = f.handle();
  await assert.rejects(f.apply(captured, { handle: h, finish: async (result) => {
    throw new f.controller.GitActionRecordingError(h.record.id, { kind: "commit", ...result });
  } }), (error) => error instanceof f.exact.GitExactCommitCompletionError && error.completion.commit === git(f.cwd, "rev-parse", "HEAD"));
  assert.notEqual(git(f.cwd, "rev-parse", "HEAD"), captured.preview.head);
  assert.equal(fs.existsSync(path.join(f.agentDir, "pi-web", "git-operation-admission")), false);
});
