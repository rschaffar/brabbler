import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";

// Set isolation before loading the SDK (including its default directory discovery).
// Tests in this file are sequential; every environment change and FS failpoint is restored.
const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "pi-web-action-runtime-")));
let agentDir = join(root, "agent");
const home = join(root, "home"), temp = join(root, "tmp");
for (const dir of [agentDir, home, temp]) fs.mkdirSync(dir, { mode: 0o700 });
const environment = {
  HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"),
  PI_CODING_AGENT_DIR: agentDir, TMPDIR: temp, TMP: temp, TEMP: temp,
};
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
Object.assign(process.env, environment);
after(() => {
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { interopDefault: true });
const rpc = await jiti.import("./rpc-manager.ts");
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { GIT_ACTION_ANCHOR_TYPE } = await jiti.import("./git-action-types.ts");
const { readGitAction, readLiveGitAction, transitionGitAction, subscribeGitActionUpdates } = await jiti.import("./git-action-journal.ts");
const { gitActionSink } = await jiti.import("./git-action-controller.ts");
const { requestWorkflowCommit } = await jiti.import("./git-workflow-commit.ts");
const { captureGitCommitAuthority } = await jiti.import("./git-commit-invocation.ts");
const { prepareGitCommit, confirmGitCommit, GitCommitOperationError } = await jiti.import("./git-commit.ts");
const { createGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const { appendSessionGitWorkflow, readSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { snapshotManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { prepareIntegration, confirmIntegration, readGitIntegrationNativeOutcome, retireGitIntegrationPlan } = await jiti.import("./git-integration.ts");
const { captureLegacyIntegrationAuthority } = await jiti.import("./git-legacy-integration-authority.ts");
const { runGitVerification } = await jiti.import("./git-verification.ts");
const { reviewGitBranches } = await jiti.import("./git-review.ts");
const { gitExecEnv } = await jiti.import("./git-exec.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const { createGitSelectedOperationRuntime } = await jiti.import("./git-selected-operation-runtime.ts");

const authorEmail = "runtime-fixture@example.invalid";
const selected = ["alpha.txt", "added.txt", "nested/deleted.txt"];
const message = "Capture the exact selected changes";
const alpha = "ARTIFACT_ONLY_ALPHA\n";
const added = Array.from({ length: 60 }, (_, i) => `ARTIFACT_ONLY_ADDED_${i}\n`).join("");
const gitRaw = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], {
  encoding: "utf8", env: gitExecEnv(), stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
});
const git = (cwd, ...args) => gitRaw(cwd, ...args).trim();
const history = (id) => readGitAction(id, { includeArtifact: true }, agentDir);
const anchors = (manager) => manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === GIT_ACTION_ANCHOR_TYPE);

function fixture(t, { linked = false, legacy = false } = {}) {
  const dir = fs.mkdtempSync(join(root, "fixture-")), main = join(dir, "main");
  // Each test owns disposable diagnostics; no history can quarantine a checkout.
  agentDir = join(dir, "agent");
  fs.mkdirSync(agentDir, { mode: 0o700 });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // No inherited Git templates/hooks, signing, identities, or user configuration.
  const template = join(dir, "empty-template");
  fs.mkdirSync(template);
  git(dir, "init", "-q", "-b", "base", `--template=${template}`, main);
  git(main, "config", "user.name", "Runtime Fixture");
  git(main, "config", "user.email", authorEmail);
  git(main, "config", "core.autocrlf", "false");
  fs.mkdirSync(join(main, "nested"));
  fs.writeFileSync(join(main, "alpha.txt"), "old alpha\n");
  fs.writeFileSync(join(main, "nested", "deleted.txt"), "old deleted\n");
  fs.writeFileSync(join(main, "unselected.txt"), "unselected base\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "base");
  const cwd = linked ? join(dir, "feature") : main;
  if (linked) git(main, "worktree", "add", "-qb", "feature", cwd);
  allowFileRoot(main);
  allowFileRoot(cwd);

  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: "Review the selected changes.", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ready to propose a commit." }],
    api: "openai-responses", provider: "openai", model: "fixture", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  if (legacy) appendSessionGitWorkflow(manager, { mode: "current", onCreate: "stay", commits: "agent" });
  else snapshotManagedSessionGitWorkflow(manager, { ...DEFAULT_GIT_WORKFLOW_SETTINGS, commits: "ask" });
  assert.equal(manager.isPersisted(), true);
  assert.deepEqual(SessionManager.open(manager.getSessionFile()).getEntries().filter((e) => e.type === "message")
    .map((e) => e.message.role), ["user", "assistant"]);
  const append = (type, data) => manager.appendCustomEntry(type, data);
  const sink = gitActionSink(manager, append);
  // Use the production writer instrumentation on the actual saved SDK manager.
  // This disposable host has no running agent/jobs; its tool selection is real
  // mutable fixture state, not a static/no-op authority snapshot.
  let activeTools = ["read", "edit"];
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const inner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager, settingsManager,
    setActiveToolsByName: (names) => { activeTools = [...names]; }, getActiveToolNames: () => [...activeTools], dispose() {}, agent: { state: {} } };
  const host = new rpc.AgentSessionWrapper(inner);
  const registry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([...(registry ?? []), [manager.getSessionId(), host]]);
  t.after(() => { host.destroy(); globalThis.__piSessions = registry; });
  const trustedRuntime = { readSelectionRevisionSync: () => host.readGitCheckAuthorityRevisionSync() };
  let tool;
  createGitCommitExtension(cwd, () => readSessionGitWorkflow(manager.getEntries()), trustedRuntime).factory({
    getActiveTools: () => [...activeTools], registerTool: (value) => { tool = value; }, appendEntry: append,
  });
  const run = (params, ask = async () => assert.fail("Unexpected approval request"), signal) => tool.execute("call", params, signal, undefined,
    { cwd, hasUI: true, sessionManager: manager, ui: { gitAction: ask } });
  const captureAuthority = () => captureGitCommitAuthority({ scope: { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), cwd },
    agentDir, manager, effectiveTools: inner.getActiveToolNames, ...trustedRuntime });
  const request = async (overrides = {}) => {
    const authority = captureAuthority(); // BEFORE runtime/resource/permission awaits.
    const runtime = createGitSelectedOperationRuntime({ sessionCwd: cwd, agentDir, manager, effectiveTools: () => [...activeTools],
      ...trustedRuntime, appendEntry: append, ask: overrides.ask ?? (async () => true), isCancelled: () => !!overrides.signal?.aborted });
    try { return await requestWorkflowCommit({ cwd, paths: selected, message, sink, authority, agentDir, ask: async () => true, ...overrides,
      beforeApply: async () => {
        const extraGuard = await overrides.beforeApply?.();
        const source = await selectGitProjectResources(cwd), guard = runtime.captureAuthorityGuard(source);
        return () => { extraGuard?.(); guard(); };
      } });
    } finally { runtime.dispose(); }
  };
  return { dir, main, cwd, manager, settingsManager, inner, host, trustedRuntime, captureAuthority, sink, run, request, head: git(cwd, "rev-parse", "HEAD") };
}

function changeFiles(f) {
  fs.writeFileSync(join(f.cwd, "alpha.txt"), alpha);
  fs.writeFileSync(join(f.cwd, "added.txt"), added);
  fs.unlinkSync(join(f.cwd, "nested", "deleted.txt"));
  fs.writeFileSync(join(f.cwd, "unselected.txt"), "UNSELECTED_PRIVATE_BYTES\n");
}

function checkout(cwd) {
  const indexPath = normalize(git(cwd, "rev-parse", "--path-format=absolute", "--git-path", "index"));
  const files = gitRaw(cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  return {
    head: git(cwd, "rev-parse", "HEAD"), indexPath, index: fs.readFileSync(indexPath),
    files: Object.fromEntries([...new Set(files)].sort().map((file) => [file,
      fs.existsSync(join(cwd, file)) ? fs.readFileSync(join(cwd, file)) : null])),
  };
}

function assertNoPatch(value) {
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, /ARTIFACT_ONLY_|UNSELECTED_PRIVATE_BYTES|diff --git|"(?:diff|patch)":/);
}

function assertObject(cwd, intended, preview, exactMessage = message) {
  assert.equal(intended.tree, preview.tree);
  assert.deepEqual(intended.parents, [preview.head]);
  assert.equal(intended.authorEmail, authorEmail);
  assert.equal(git(cwd, "show", "-s", "--format=%ae", intended.commit), authorEmail);
  assert.equal(git(cwd, "show", "-s", "--format=%T", intended.commit), preview.tree);
  assert.equal(git(cwd, "show", "-s", "--format=%P", intended.commit), preview.head);
  assert.equal(gitRaw(cwd, "show", "-s", "--format=%B", intended.commit).trimEnd(), exactMessage);
  assert.doesNotMatch(gitRaw(cwd, "cat-file", "-p", intended.commit), /\ngpgsig /);
}

function assertOneCommit(f, oid) {
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), oid);
  assert.equal(git(f.cwd, "rev-list", "--count", `${f.head}..HEAD`), "1");
  assert.equal(git(f.cwd, "reflog", "show", "--format=%H", "HEAD").split("\n").filter((value) => value === oid).length, 1);
}

// Journal observers are deliberately non-transactional. Collect observations and
// assert afterwards: an assertion thrown inside a listener would be swallowed.
function observe(t, f) {
  const events = [];
  const stop = subscribeGitActionUpdates(f.manager.getSessionId(), (event) => {
    try {
      const observation = { event, checkout: checkout(f.cwd) }; events.push(observation);
      // Capture the genuine live projection now; disk history is never required
      // before intent/Ask and the controller retains it through terminal events.
      history(event.actionId).then(({ record, candidate }) => {
        observation.record = record; observation.artifact = candidate;
      }, error => { observation.error = error; });
    } catch (error) { events.push({ error }); }
  });
  t.after(stop);
  return events;
}

// Fail only a real bounded-v2 terminal publication in this disposable namespace.
// Native Git and the SDK writer remain real; assertions run outside storage catches.
function publicationFault(t, f, suffix = ".action") {
  const attempts = [], link = fs.linkSync, base = join(agentDir, "git-diagnostics-v2");
  const mock = t.mock.method(fs, "linkSync", (from, to, ...args) => {
    if (String(to).endsWith(suffix) && fs.realpathSync(dirname(String(to))) === base) {
      attempts.push({ head: git(f.cwd, "rev-parse", "HEAD"), to: String(to) });
      throw Object.assign(new Error("private diagnostic publication fault"), { code: "ENOSPC" });
    }
    return link(from, to, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  return attempts;
}
function loseNamespace() {
  const dir = join(agentDir, "git-diagnostics-v2");
  fs.renameSync(dir, `${dir}.unavailable`); fs.writeFileSync(dir, "not a directory");
}
function assertDiagnosticSuccess(f, result, preview) {
  assert.equal(result.isError, undefined); assert.equal(result.details.status, "committed");
  assert.equal(result.details.recoveryRequired, undefined);
  assert.equal(result.details.diagnosticsUnavailable, true);
  assert.deepEqual(result.details.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  assert.match(result.content[0].text, /diagnostics unavailable/i);
  assert.doesNotMatch(JSON.stringify(result), /uncertain|refresh|retry|ENOSPC|private diagnostic/);
  assertObject(f.cwd, result.details, preview); assertOneCommit(f, result.details.commit);
  assertNoPatch(result);
  assert.equal(fs.existsSync(`${checkout(f.cwd).indexPath}.lock`), false);
}

test("late native operation refusal remains blocked, not uncertain, after intent recording for Ask and legacy commits", async (t) => {
  for (const legacy of [false, true]) {
    const f = fixture(t, { legacy });
    changeFiles(f);
    const before = checkout(f.cwd);
    const preview = legacy ? (await f.run({ operation: "preview", paths: selected })).details.preview : undefined;
    let actionId, injected = false;
    const markerPath = normalize(git(f.cwd, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"));
    const stop = subscribeGitActionUpdates(f.manager.getSessionId(), (event) => {
      const record = readLiveGitAction(f.manager.getSessionId(), event.actionId, {}, agentDir)?.record;
      if (!record?.intended?.commit || injected) return;
      actionId = event.actionId; injected = true;
      fs.writeFileSync(markerPath, `${f.head}\n`);
    });
    let result;
    try {
      result = await f.run(legacy ? { operation: "confirm", preview, message } : { operation: "commit", paths: selected, message }, async () => true);
    } finally { stop(); }
    assert.equal(injected, true);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /merge is in progress/);
    assert.doesNotMatch(JSON.stringify(result), /uncertain|recoveryRequired/);
    const record = (await history(actionId)).record;
    assert.equal(record.state, "blocked");
    assert.match(record.reason, /merge is in progress/);
    assert.ok(record.intended.commit);
    assert.equal(record.outcome, undefined);
    assert.equal(record.decision, legacy ? undefined : "approved");
    if (legacy) assert.equal(record.revision, 3, "one native executing+intent publication, then one blocked settlement");
    assert.deepEqual(checkout(f.cwd), before);
    assert.equal(fs.existsSync(markerPath), true);
    assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  }
});

test("actual Ask commit captures a complete multi-file artifact and intended identity before moving the ref", async (t) => {
  const f = fixture(t);
  const capturedResource = await selectGitProjectResources(f.cwd);
  changeFiles(f);
  const before = checkout(f.cwd), events = observe(t, f);
  let card, captured;
  const result = await f.run({ operation: "commit", paths: selected, message }, async (candidate) => {
    card = structuredClone(candidate);
    captured = await history(card.actionId);
    assert.equal(captured.record.state, "awaiting-decision");
    assert.equal(captured.record.outcome, undefined);
    assert.equal(captured.record.intended, undefined);
    assert.deepEqual(checkout(f.cwd), before);
    const expectedPatch = gitRaw(f.cwd, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3",
      `${f.head}^{tree}`, candidate.preview.tree, "--");
    assert.equal(card.diff.patch, expectedPatch);
    assert.equal((expectedPatch.match(/^diff --git /gm) ?? []).length, 3);
    assert.match(expectedPatch, /\+ARTIFACT_ONLY_ALPHA/);
    assert.match(expectedPatch, /\+ARTIFACT_ONLY_ADDED_59/);
    assert.match(expectedPatch, /-old deleted/);
    assert.doesNotMatch(expectedPatch, /UNSELECTED_PRIVATE_BYTES|unselected.txt/);
    assert.deepEqual(captured.candidate, {
      kind: "commit", repositoryRoot: f.cwd, projectRoot: f.main, sourceCheckoutRoot: f.cwd,
      resourceAttribution: { version: 2, commonDir: capturedResource.commonDir,
        commonIdentity: capturedResource.identities.common, projectIdentity: capturedResource.identities.project },
      featureBranch: candidate.preview.branch, message,
      commitMode: "whole-file", paths: [...selected].sort(), parentOid: f.head, candidateTreeOid: candidate.preview.tree, diff: card.diff,
      workingWorkspaceVerification: { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false, requiredSavedIndexes: [], runs: [] },
    });
    const persisted = SessionManager.open(f.manager.getSessionFile());
    assert.deepEqual(anchors(persisted).map((entry) => entry.data), [{ version: 1, actionId: card.actionId }]);
    assertNoPatch(persisted.getEntries());
    return true;
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.details.status, "committed");
  assert.equal(result.details.actionId, card.actionId);
  assertNoPatch(result);
  assertNoPatch(await readGitAction(card.actionId, {}, agentDir));
  assert.equal(events.some((event) => event.error), false);
  const prepared = events.find(({ record }) => record.intended && !record.outcome);
  assert.ok(prepared, "genuine native intent must be displayed before the ref CAS, not treated as durable permission");
  assert.equal(prepared.record.state, "executing");
  assert.equal(prepared.record.decision, "approved");
  for (const event of events.filter(({ record }) => record.state !== "succeeded")) assert.deepEqual(event.checkout, before);
  assert.deepEqual(prepared.artifact, captured.candidate);
  assertObject(f.cwd, prepared.record.intended, card.preview);
  const completed = await history(card.actionId);
  assert.equal(completed.record.state, "succeeded");
  assert.equal(completed.record.decision, "approved");
  assert.deepEqual(completed.record.intended, prepared.record.intended);
  const outcome = completed.record.outcome;
  const { workingWorkspaceVerification, ...facts } = result.details;
  const { workingWorkspaceVerification: capturedEvidence, ...nativeOutcome } = outcome;
  assert.deepEqual(capturedEvidence, captured.candidate.workingWorkspaceVerification);
  assert.deepEqual(facts, { ...nativeOutcome, actionId: card.actionId });
  assert.equal(workingWorkspaceVerification.evidenceScope, "working-workspace");
  assert.equal(workingWorkspaceVerification.candidateTreeVerified, false);
  assert.equal(workingWorkspaceVerification.repositoryChecksWaived, false);
  assert.deepEqual(workingWorkspaceVerification.checkIndexes, []);
  assert.deepEqual(completed.candidate, captured.candidate);
  assertOneCommit(f, outcome.commit);
  assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "");
  assert.equal(git(f.cwd, "status", "--porcelain"), "M unselected.txt");
  assert.equal(git(f.cwd, "show", "HEAD:added.txt") + "\n", added);
  await assert.rejects(confirmGitCommit(card.preview, message), /stale preview|not in current status/);
  assertOneCommit(f, outcome.commit);
});

test("staged agent Ask journals only the selected index tree and refuses a changed index after approval", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(join(f.cwd, "alpha.txt"), "selected staged\n");
  git(f.cwd, "add", "alpha.txt");
  fs.writeFileSync(join(f.cwd, "alpha.txt"), "selected staged\nunstaged\n");
  fs.writeFileSync(join(f.cwd, "unselected.txt"), "unrelated staged\n");
  git(f.cwd, "add", "unselected.txt");
  const before = checkout(f.cwd);
  let card;
  await assert.rejects(f.request({ paths: ["alpha.txt"], mode: "staged", ask: async (candidate) => {
    card = candidate;
    assert.equal(candidate.preview.mode, "staged");
    assert.match(candidate.diff.patch, /selected staged/);
    assert.doesNotMatch(candidate.diff.patch, /unstaged|unrelated staged/);
    assert.deepEqual((await history(candidate.actionId)).candidate.paths, ["alpha.txt"]);
    fs.writeFileSync(join(f.cwd, "alpha.txt"), "changed staged\n");
    git(f.cwd, "add", "alpha.txt");
    return true;
  } }), /stale preview/);
  const saved = await history(card.actionId);
  assert.equal(saved.record.state, "blocked");
  assert.equal(saved.record.decision, "approved");
  assert.equal(saved.record.outcome, undefined);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), before.head);
  assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "alpha.txt\nunselected.txt");
  assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
});

test("declined Ask artifact survives real Git GC and fixture worktree/repository disappearance", async (t) => {
  const f = fixture(t, { linked: true });
  changeFiles(f);
  const before = checkout(f.cwd);
  let card;
  const result = await f.run({ operation: "commit", paths: selected, message }, async (value) => { card = value; return false; });
  assert.equal(result.details.approved, false);
  assertNoPatch(result);
  assert.deepEqual(checkout(f.cwd), before);
  const declined = await history(card.actionId), artifact = fs.readFileSync(join(agentDir, "git-diagnostics-v2", `${card.actionId}.artifact`));
  assert.equal(declined.record.state, "declined");
  assert.equal(declined.record.decision, "declined");
  assert.equal(declined.record.intended, undefined);
  assert.equal(declined.record.outcome, undefined);
  assert.equal(declined.candidate.diff.patch, card.diff.patch);
  git(f.main, "cat-file", "-e", card.preview.tree);
  // Test-fixture destruction, not an application worktree-cleanup operation.
  git(f.main, "worktree", "remove", "--force", f.cwd);
  git(f.main, "reflog", "expire", "--expire=now", "--all");
  git(f.main, "gc", "--prune=now");
  assert.throws(() => git(f.main, "cat-file", "-e", card.preview.tree));
  assert.deepEqual(await history(card.actionId), declined);
  fs.rmSync(f.main, { recursive: true });
  assert.deepEqual(await history(card.actionId), declined);
  assert.deepEqual(fs.readFileSync(join(agentDir, "git-diagnostics-v2", `${card.actionId}.artifact`)), artifact);
  await assert.rejects(transitionGitAction(card.actionId, declined.record.revision, { state: "executing" }, agentDir), /terminal|read-only/);
});

test("approval is not success: a candidate changed after approval remains captured but cannot commit", async (t) => {
  const f = fixture(t);
  changeFiles(f);
  let card, afterExternalEdit;
  const result = await f.run({ operation: "commit", paths: selected, message }, async (value) => {
    card = value;
    fs.writeFileSync(join(f.cwd, "alpha.txt"), "external edit after review\n");
    afterExternalEdit = checkout(f.cwd);
    return true;
  });
  assert.equal(result.isError, true);
  assertNoPatch(result);
  assert.deepEqual(checkout(f.cwd), afterExternalEdit);
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), f.head);
  const saved = await history(card.actionId);
  assert.equal(saved.record.decision, "approved");
  assert.equal(saved.record.state, "blocked");
  assert.equal(saved.record.intended, undefined);
  assert.equal(saved.record.outcome, undefined);
  assert.equal(saved.candidate.diff.patch, card.diff.patch);
  assert.doesNotMatch(saved.candidate.diff.patch, /external edit/);
});

test("native commit awaits a throwing beforeRefUpdate callback without changing HEAD, index or files", async (t) => {
  const f = fixture(t);
  changeFiles(f);
  const preview = await prepareGitCommit(f.cwd, selected), before = checkout(f.cwd);
  const failure = new Error("essential pre-ref authorization refused");
  let intended, calls = 0;
  await assert.rejects(confirmGitCommit(preview, message, async (value) => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    intended = value;
    assert.deepEqual(checkout(f.cwd), before);
    assertObject(f.cwd, intended, preview);
    throw failure;
  }), (error) => error instanceof GitCommitOperationError && error.cause === failure);
  assert.equal(calls, 1);
  assert.ok(intended.commit);
  assert.deepEqual(checkout(f.cwd), before);
  assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
});

test("a final Ask authorization failure retains prepared identity without claiming a committed outcome", async (t) => {
  const f = fixture(t);
  changeFiles(f);
  const before = checkout(f.cwd), failure = new Error("authorization revoked before ref update");
  let card, prepared, validations = 0;
  await assert.rejects(f.request({ ask: async (value) => { card = value; return true; }, beforeApply: async () => {
    if (++validations !== 3) return; // initial, pre-intent and native pre-ref permission checks
    prepared = await history(card.actionId);
    assert.equal(prepared.record.state, "executing");
    assert.equal(prepared.record.decision, "approved");
    assert.equal(prepared.record.outcome, undefined);
    assertObject(f.cwd, prepared.record.intended, card.preview);
    assert.deepEqual(checkout(f.cwd), before);
    throw failure;
  } }), (error) => error instanceof GitCommitOperationError && error.cause === failure);
  assert.equal(validations, 3);
  const saved = await history(card.actionId);
  assert.equal(saved.record.state, "blocked");
  assert.equal(saved.record.decision, "approved");
  assert.deepEqual(saved.record.intended, prepared.record.intended);
  assert.equal(saved.record.outcome, undefined);
  assert.deepEqual(checkout(f.cwd), before);
  await t.test("unrelated native pre-ref failure after Stop is not cancelled", async t => {
    const f = fixture(t); changeFiles(f); const before = checkout(f.cwd), abort = new AbortController();
    const reason = new Error("PRIVATE_CANCEL_REASON"), unrelated = new Error("unrelated authority failure", { cause: reason });
    let validations = 0;
    await assert.rejects(f.request({ signal: abort.signal, beforeApply: async () => {
      if (++validations === 3) { abort.abort(reason); throw unrelated; }
    } }), error => error instanceof GitCommitOperationError && error.cause === unrelated);
    assert.equal(validations, 3); assert.deepEqual(checkout(f.cwd), before);
    assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  });
  for (const mode of ["saved-deny", "saved-deny-restore", "tools-restore", "loaded-trust-restore", "source-replacement"]) await t.test(mode, async t => {
    const f = fixture(t); changeFiles(f); const before = checkout(f.cwd);
    const source = await selectGitProjectResources(f.cwd);
    const owner = { sessionId: f.manager.getSessionId(), sessionFile: f.manager.getSessionFile(), sessionCwd: f.cwd };
    const save = async decision => saveProjectAuthorization(source, owner, "session", "commit", decision,
      await readProjectAuthorization(source, owner, agentDir), agentDir);
    if (mode.startsWith("saved-deny")) await save("allow");
    let prompts = 0, swapped = false;
    const result = await f.run({ operation: "commit", paths: selected, message }, async () => {
      prompts++; await new Promise(resolve => setImmediate(resolve));
      if (mode.startsWith("saved-deny")) { await save("deny"); if (mode.endsWith("restore")) await save("allow"); }
      if (mode === "tools-restore") { f.inner.setActiveToolsByName(["read"]); f.inner.setActiveToolsByName(["read", "edit"]); }
      if (mode === "loaded-trust-restore") {
        const trusted = f.settingsManager.isProjectTrusted(); f.settingsManager.setProjectTrusted(!trusted); f.settingsManager.setProjectTrusted(trusted);
      }
      if (mode === "source-replacement") { fs.renameSync(f.cwd, `${f.cwd}.original`); fs.mkdirSync(f.cwd); swapped = true; }
      return true;
    });
    if (swapped) { fs.rmdirSync(f.cwd); fs.renameSync(`${f.cwd}.original`, f.cwd); }
    assert.equal(prompts, 1); assert.equal(result.isError, true, JSON.stringify(result));
    assert.equal(result.details.recoveryRequired, undefined); assert.equal(result.details.diagnosticsUnavailable, undefined);
    assert.doesNotMatch(JSON.stringify(result), /uncertain|Commit completed|diagnostics unavailable/);
    assert.deepEqual(checkout(f.cwd), before); assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  });
});

test("initial optional namespace failure preserves exact Ask, approval and native success with notice", async (t) => {
  const f = fixture(t); changeFiles(f);
  const before = checkout(f.cwd); let prompts = 0, card;
  fs.writeFileSync(join(agentDir, "git-diagnostics-v2"), "unavailable namespace");
  const result = await f.request({ ask: async value => {
    prompts++; card = structuredClone(value);
    assert.equal(value.diagnosticsUnavailable, true);
    assert.match(value.diff.patch, /ARTIFACT_ONLY_ADDED_59/);
    assert.equal((value.diff.patch.match(/^diff --git /gm) ?? []).length, 3);
    assert.deepEqual(checkout(f.cwd), before); return true;
  } });
  assert.equal(prompts, 1); assertDiagnosticSuccess(f, result, card.preview);
  assert.equal((await history(card.actionId)).record, null, "missing history is not fabricated from Git");
  await assert.rejects(f.request({ paths: ["../escape"] }));
  assertOneCommit(f, result.details.commit);
});

test("optional namespace loss at native intent preserves original exact approval and cannot revive it", async (t) => {
  const f = fixture(t); changeFiles(f); const before = checkout(f.cwd);
  let card, intended, observed;
  const stop = subscribeGitActionUpdates(f.manager.getSessionId(), ({ actionId }) => {
    const record = readLiveGitAction(f.manager.getSessionId(), actionId, {}, agentDir)?.record;
    if (!record?.intended || intended) return;
    intended = record.intended; observed = checkout(f.cwd); loseNamespace();
  });
  t.after(stop);
  const result = await f.request({ ask: async value => { card = value; return true; } });
  assert.deepEqual(observed, before); assertObject(f.cwd, intended, card.preview);
  assertDiagnosticSuccess(f, result, card.preview);
  assert.equal(result.details.commit, intended.commit);
  assert.equal((await history(card.actionId)).record, null);
  await assert.rejects(transitionGitAction(card.actionId, 1, { state: "executing", intended }, agentDir), /no longer live|read-only/);
  await assert.rejects(confirmGitCommit(card.preview, message), /stale preview|not in current status/);
  assertOneCommit(f, result.details.commit);
});

test("post-commit record publication failure preserves actual OID without uncertainty, recovery or replay", async (t) => {
  const f = fixture(t); changeFiles(f); const attempts = publicationFault(t, f);
  let card;
  const result = await f.request({ ask: async value => { card = value; return true; } });
  assert.equal(attempts.length, 1); assert.equal(attempts[0].head, result.details.commit);
  assertDiagnosticSuccess(f, result, card.preview);
  assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "");
  assert.equal((await history(card.actionId)).record, null);
  await assert.rejects(confirmGitCommit(card.preview, message), /stale preview|not in current status/);
  assertOneCommit(f, result.details.commit);
});

test("actual Ask tool keeps native success when optional completed artifact publication fails", async (t) => {
  const f = fixture(t); changeFiles(f); const attempts = publicationFault(t, f, ".artifact");
  let card;
  const result = await f.run({ operation: "commit", paths: selected, message }, async value => { card = value; return true; });
  assert.equal(attempts.length, 1); assert.equal(attempts[0].head, result.details.commit);
  assertDiagnosticSuccess(f, result, card.preview);
  const saved = await history(card.actionId);
  assert.equal(saved.record, null, "failed staging is left untouched; bounded retention may omit subsequent optional history");
  assert.equal(saved.candidate, undefined); assert.match(saved.unavailable, /unavailable|unreadable/i);
});

test("supported legacy preview/confirm also captures the patch before committing and returns only facts", async (t) => {
  const f = fixture(t, { legacy: true });
  changeFiles(f);
  const before = checkout(f.cwd), events = observe(t, f);
  const previewResult = await f.run({ operation: "preview", paths: selected });
  assertNoPatch(previewResult);
  const preview = previewResult.details.preview;
  assert.ok(preview);
  const result = await f.run({ operation: "confirm", preview, message });
  assert.equal(result.isError, undefined);
  assert.equal(result.details.status, "committed");
  assertNoPatch(result);
  assert.equal(events.some((event) => event.error), false);
  const prepared = events.find(({ record }) => record.intended && !record.outcome);
  assert.ok(prepared);
  assert.deepEqual(prepared.checkout, before);
  const saved = await history(result.details.actionId);
  assert.equal(saved.record.source, "legacy-agent");
  assert.equal(saved.record.state, "succeeded");
  assert.equal(saved.record.decision, undefined, "saved consent is not a fabricated approval");
  const { workingWorkspaceVerification, ...nativeOutcome } = saved.record.outcome;
  assert.deepEqual(workingWorkspaceVerification, { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false, requiredSavedIndexes: [], runs: [] });
  assert.deepEqual(result.details, { ...nativeOutcome, actionId: saved.record.id });
  assert.deepEqual(JSON.parse(result.content[0].text), nativeOutcome);
  assert.equal(saved.candidate.diff.patch, prepared.artifact.diff.patch);
  assert.match(saved.candidate.diff.patch, /ARTIFACT_ONLY_ADDED_59/);
  assert.equal((saved.candidate.diff.patch.match(/^diff --git /gm) ?? []).length, 3);
  assertObject(f.cwd, saved.record.outcome, preview);
  assertOneCommit(f, result.details.commit);
});

test("legacy cancellation at native intent remains a no-effect refusal even when optional storage disappears", async (t) => {
  const f = fixture(t, { legacy: true }); changeFiles(f);
  const preview = (await f.run({ operation: "preview", paths: selected })).details.preview;
  const before = checkout(f.cwd), abort = new AbortController(); let captured;
  const stop = subscribeGitActionUpdates(f.manager.getSessionId(), ({ actionId }) => {
    const record = readLiveGitAction(f.manager.getSessionId(), actionId, {}, agentDir)?.record;
    if (!record?.intended || captured) return;
    captured = record; loseNamespace(); abort.abort(new Error("PRIVATE_CANCEL_REASON"));
  });
  t.after(stop);
  const result = await f.run({ operation: "confirm", preview, message }, undefined, abort.signal);
  assert.ok(captured); assertObject(f.cwd, captured.intended, preview);
  assert.equal(result.isError, true); assert.equal(result.details.recoveryRequired, undefined);
  assert.deepEqual(checkout(f.cwd), before); assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  assert.equal((await history(captured.id)).record, null);
  assert.equal((await f.run({ operation: "confirm", preview, message })).isError, true);
  assert.deepEqual(checkout(f.cwd), before);
  // Assert last so the regression also verifies authentic no-effect/single-use.
  assert.doesNotMatch(JSON.stringify(result), /uncertain|PRIVATE_CANCEL_REASON|Commit completed/);
  assert.equal(result.content[0].text, "Commit cancelled; no commit was made");
  for (const nested of [false, true]) await t.test(nested ? "generic nested cause is not signal provenance" : "unrelated refusal while aborted", async t => {
    const f = fixture(t, { legacy: true }); changeFiles(f);
    const preview = (await f.run({ operation: "preview", paths: selected })).details.preview;
    const before = checkout(f.cwd), abort = new AbortController(), reason = new Error("PRIVATE_CANCEL_REASON");
    const unrelated = new Error("unrelated native index inspection failure", nested ? { cause: reason } : undefined);
    let armed = false, failures = 0;
    const stop = subscribeGitActionUpdates(f.manager.getSessionId(), ({ actionId }) => {
      if (readLiveGitAction(f.manager.getSessionId(), actionId, {}, agentDir)?.record.intended) armed = true;
    });
    t.after(stop);
    const lstat = fs.promises.lstat;
    const mock = t.mock.method(fs.promises, "lstat", async (path, ...args) => {
      if (armed && !failures && path === `${before.indexPath}.lock`) { failures++; abort.abort(reason); throw unrelated; }
      return lstat(path, ...args);
    });
    let result;
    try { result = await f.run({ operation: "confirm", preview, message }, undefined, abort.signal); }
    finally { mock.mock.restore(); }
    assert.equal(failures, 1);
    assert.equal(result.isError, true); assert.equal(result.content[0].text, unrelated.message);
    assert.doesNotMatch(JSON.stringify(result), /cancelled|PRIVATE_CANCEL_REASON|uncertain/);
    assert.equal(result.details.recoveryRequired, undefined);
    assert.deepEqual(checkout(f.cwd), before); assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  });
});

test("legacy signal cancellation before invocation binding never leaks its reason or fabricates execution", async (t) => {
  const f = fixture(t, { legacy: true }); changeFiles(f);
  const preview = (await f.run({ operation: "preview", paths: selected })).details.preview;
  const before = checkout(f.cwd), abort = new AbortController(); const seen = [];
  const stop = subscribeGitActionUpdates(f.manager.getSessionId(), ({ actionId }) => {
    const record = readLiveGitAction(f.manager.getSessionId(), actionId, {}, agentDir)?.record;
    if (record) { seen.push(record); abort.abort(new Error("PRIVATE_CANCEL_REASON_MUST_NOT_LEAK")); }
  });
  t.after(stop);
  const result = await f.run({ operation: "confirm", preview, message }, undefined, abort.signal);
  assert.ok(seen.length); assert.ok(seen.every(record => record.state === "proposed" && !record.intended && !record.outcome));
  // Cancellation during original-authority binding is a generic safe refusal,
  // not a fabricated native cancelled result or a recording exception.
  assert.equal(result.isError, true); assert.equal(result.details.recoveryRequired, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANCEL_REASON|uncertain|Commit completed/);
  assert.deepEqual(checkout(f.cwd), before); assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  assert.equal((await history(seen[0].id)).record, null, "unfinished released diagnostics are not native history");
});

test("legacy original intent survives diagnostic loss, succeeds once and never acquires quarantine", async (t) => {
  const f = fixture(t, { legacy: true }); changeFiles(f);
  const preview = (await f.run({ operation: "preview", paths: selected })).details.preview;
  const before = checkout(f.cwd); let captured, atIntent;
  const stop = subscribeGitActionUpdates(f.manager.getSessionId(), ({ actionId }) => {
    const record = readLiveGitAction(f.manager.getSessionId(), actionId, {}, agentDir)?.record;
    if (!record?.intended || captured) return;
    captured = record; atIntent = checkout(f.cwd); loseNamespace();
  });
  t.after(stop);
  const result = await f.run({ operation: "confirm", preview, message });
  assert.deepEqual(atIntent, before); assert.equal(captured.decision, undefined);
  assertObject(f.cwd, captured.intended, preview); assertDiagnosticSuccess(f, result, preview);
  assert.equal(result.details.commit, captured.intended.commit);
  assert.equal((await history(captured.id)).record, null);
  assert.equal((await f.run({ operation: "confirm", preview, message })).isError, true);
  assertOneCommit(f, result.details.commit);
});

test("legacy confirm reports actual native partial success after index installation failure without an artificial quarantine", async (t) => {
  const f = fixture(t, { legacy: true });
  changeFiles(f);
  const preview = (await f.run({ operation: "preview", paths: selected })).details.preview;
  const before = checkout(f.cwd);
  const rename = fs.renameSync;
  const abort = new AbortController(), reason = new Error("PRIVATE_POST_CAS_CANCEL_REASON");
  let failures = 0;
  const mock = t.mock.method(fs, "renameSync", (from, to) => {
    if (from === `${before.indexPath}.lock` && to === before.indexPath) {
      failures++; abort.abort(reason);
      throw reason; // Actual post-CAS installation failure, even though it IS the signal reason.
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const result = await f.run({ operation: "confirm", preview, message }, undefined, abort.signal);
  assert.equal(failures, 1); assert.equal(abort.signal.aborted, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_POST_CAS_CANCEL_REASON|cancelled|no commit was made/);
  assert.equal(result.isError, undefined);
  assert.equal(result.details.status, "partial-success");
  assert.equal(result.details.recoveryRequired, true);
  assert.equal(result.details.reason, "Commit created, but checkout finalization failed");
  assert.equal(result.details.diagnosticsUnavailable, undefined, "native partial success is not optional storage loss");
  assert.deepEqual(fs.readFileSync(before.indexPath), before.index, "failed installation preserves original index bytes");
  assert.deepEqual(JSON.parse(result.content[0].text), { status: "partial-success", commit: result.details.commit,
    tree: preview.tree, parents: [preview.head], authorEmail, reason: result.details.reason });
  assertOneCommit(f, result.details.commit);
  assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  const saved = await history(result.details.actionId);
  assert.equal(saved.record.state, "recovery-required");
  assert.equal(saved.record.decision, undefined);
  assert.equal(saved.record.intended.commit, result.details.commit);
  assert.equal(saved.record.outcome.commit, result.details.commit);
  assert.equal(saved.record.outcome.status, "partial-success");
  assertNoPatch(result);
});

test("legacy confirm preserves known commit facts when final recording fails", async (t) => {
  const f = fixture(t, { legacy: true });
  changeFiles(f);
  const preview = (await f.run({ operation: "preview", paths: selected })).details.preview;
  const attempts = publicationFault(t, f);
  const result = await f.run({ operation: "confirm", preview, message });
  assert.equal(attempts.length, 1, "the operation must not retry recording or applying");
  assert.equal(attempts[0].head, result.details.commit); assertDiagnosticSuccess(f, result, preview);
  assert.equal((await history(result.details.actionId)).record, null);
  assert.equal((await f.run({ operation: "confirm", preview, message })).isError, true);
  assertOneCommit(f, result.details.commit);
});

test("native integration retains original SDK authority, genuine required receipt and single-use pre-native refusal", async (t) => {
  for (const mode of ["essential-refusal", "change-and-restore"]) await t.test(mode, async t => {
    const f = fixture(t, { linked: true });
    fs.writeFileSync(join(f.cwd, "alpha.txt"), "integration candidate\n");
    git(f.cwd, "add", "alpha.txt"); git(f.cwd, "commit", "-qm", "feature");
    const policy = { mode: "worktree", baseBranch: "base", onCreate: "continue", commits: "manual",
      integration: { targetBranch: "base", method: "merge" },
      checks: [{ label: "Fixture check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
    appendSessionGitWorkflow(f.manager, policy); f.settingsManager.setProjectTrusted(true);
    const original = captureLegacyIntegrationAuthority({ sessionCwd: f.cwd, agentDir,
      ctx: { cwd: f.cwd, sessionManager: f.manager }, effectiveTools: f.inner.getActiveToolNames, ...f.trustedRuntime });
    // Original owner/monotonic writers captured BEFORE any resource/check await.
    const source = await selectGitProjectResources(f.cwd), target = await selectGitProjectResources(f.main);
    original.select(source, source, target);
    let applying = false, exactBinding, approved, plan, calls = 0;
    const refusal = new Error("essential permission revoked before native apply");
    const nativeAuthority = original.nativeAuthority(binding => {
      assert.deepEqual(readSessionGitWorkflow(f.manager.getEntries()), policy);
      assert.equal(f.settingsManager.isProjectTrusted(), true);
      if (!exactBinding) exactBinding = structuredClone(binding);
      assert.deepEqual(binding, exactBinding);
      if (applying) { assert.equal(approved, plan); calls++; throw refusal; }
    });
    const options = { sessionId: f.manager.getSessionId(), cwd: f.cwd, agentDir, featureBranch: "feature",
      getPolicy: () => readSessionGitWorkflow(f.manager.getEntries()), nativeAuthority,
      readAuthorityRevisionSync: original.readAuthorityRevisionSync };
    const receipt = await runGitVerification({ ...options, review: await reviewGitBranches(f.cwd, "feature", "base"), checkIndex: 0,
      isTrusted: () => f.settingsManager.isProjectTrusted(), testContainmentBackend: createTestContainmentBackend() });
    assert.equal(receipt.exitStatus, 0);
    plan = await prepareIntegration({ ...options, receiptIds: [receipt.id] });
    try {
      assert.deepEqual(plan.receiptIds, [receipt.id], "required real check is never dropped");
      assert.equal(retireGitIntegrationPlan({ ...plan }), false);
      const targetBefore = checkout(f.main), featureBefore = checkout(f.cwd);
      assert.equal(git(f.cwd, "show", "-s", "--format=%P", plan.mergeOid), `${plan.review.targetOid} ${plan.review.featureOid}`);
      let legacyCalls = 0;
      await assert.rejects(confirmIntegration(plan.planId, plan.planId, options.sessionId, () => { legacyCalls++; }), /legacy.*unsupported/);
      assert.equal(legacyCalls, 0, "legacy intent callback is not an authority provider");
      approved = plan; applying = true;
      await new Promise(resolve => setImmediate(resolve));
      if (mode === "change-and-restore") { f.inner.setActiveToolsByName(["read"]); f.inner.setActiveToolsByName(["read", "edit"]); }
      let originalError;
      await assert.rejects(confirmIntegration(plan.planId, plan.planId, options.sessionId), error => {
        originalError = error;
        if (mode === "essential-refusal") assert.equal(error, refusal);
        const facts = readGitIntegrationNativeOutcome(error);
        assert.equal(facts.status, "no-checkout-effect");
        for (const key of ["checkoutAttempted", "refPrepared", "refAcknowledged", "indexInstalled"]) assert.equal(facts[key], false);
        assert.equal(readGitIntegrationNativeOutcome({ ...error }), undefined);
        assert.equal(readGitIntegrationNativeOutcome(new Error(error.message)), undefined);
        return true;
      });
      assert.equal(calls, mode === "essential-refusal" ? 1 : 0);
      assert.deepEqual(checkout(f.main), targetBefore); assert.deepEqual(checkout(f.cwd), featureBefore);
      assert.equal(fs.existsSync(`${targetBefore.indexPath}.lock`), false);
      await assert.rejects(confirmIntegration(plan.planId, plan.planId, options.sessionId), /plan required/);
      assert.equal(readGitIntegrationNativeOutcome(originalError).status, "no-checkout-effect", "retirement keeps historical facts, never replay authority");
      assert.deepEqual(checkout(f.main), targetBefore);
    } finally { assert.equal(retireGitIntegrationPlan(plan), true); }
  });
});
