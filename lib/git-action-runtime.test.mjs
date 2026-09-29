import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, normalize, sep } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Set isolation before loading the SDK (including its default directory discovery).
// Tests in this file are sequential; every environment change and FS failpoint is restored.
const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "pi-web-action-runtime-")));
const agentDir = join(root, "agent"), home = join(root, "home"), temp = join(root, "tmp");
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

const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { GIT_ACTION_ANCHOR_TYPE } = await jiti.import("./git-action-types.ts");
const { readGitAction, transitionGitAction, subscribeGitActionUpdates } = await jiti.import("./git-action-journal.ts");
const { gitActionSink, GitActionRecordingError, gitActionFailureResult } = await jiti.import("./git-action-controller.ts");
const { requestWorkflowCommit } = await jiti.import("./git-workflow-commit.ts");
const { prepareGitCommit, confirmGitCommit } = await jiti.import("./git-commit.ts");
const { createGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const { appendSessionGitWorkflow, readSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { snapshotManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { prepareIntegration, confirmIntegration } = await jiti.import("./git-integration.ts");
const { runGitVerification } = await jiti.import("./git-verification.ts");
const { reviewGitBranches } = await jiti.import("./git-review.ts");
const { gitExecEnv } = await jiti.import("./git-exec.ts");

const authorEmail = "runtime-fixture@example.invalid";
const selected = ["alpha.txt", "added.txt", "nested/deleted.txt"];
const message = "Capture the exact selected changes";
const alpha = "ARTIFACT_ONLY_ALPHA\n";
const added = Array.from({ length: 60 }, (_, i) => `ARTIFACT_ONLY_ADDED_${i}\n`).join("");
const gitRaw = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], {
  encoding: "utf8", env: gitExecEnv(), stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
});
const git = (cwd, ...args) => gitRaw(cwd, ...args).trim();
const actionDir = (id) => join(agentDir, "pi-web", "git-actions", "v1", id);
const history = (id) => readGitAction(id, { includeArtifact: true }, agentDir);
const anchors = (manager) => manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === GIT_ACTION_ANCHOR_TYPE);

function fixture(t, { linked = false, legacy = false } = {}) {
  const dir = fs.mkdtempSync(join(root, "fixture-")), main = join(dir, "main");
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
  let tool;
  createGitCommitExtension(cwd, () => readSessionGitWorkflow(manager.getEntries())).factory({
    getActiveTools: () => ["read", "edit"], registerTool: (value) => { tool = value; }, appendEntry: append,
  });
  const run = (params, ask = async () => assert.fail("Unexpected approval request")) => tool.execute("call", params, undefined, undefined,
    { cwd, hasUI: true, sessionManager: manager, ui: { gitAction: ask } });
  const request = (overrides = {}) => requestWorkflowCommit({ cwd, paths: selected, message, sink,
    ask: async () => true, beforeApply: async () => {}, ...overrides });
  return { dir, main, cwd, manager, sink, run, request, head: git(cwd, "rev-parse", "HEAD") };
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
      events.push({ event, record: JSON.parse(fs.readFileSync(join(actionDir(event.actionId), "record.json"), "utf8")).record,
        artifact: fs.readFileSync(join(actionDir(event.actionId), "candidate.json")), checkout: checkout(f.cwd) });
    } catch (error) { events.push({ error }); }
  });
  t.after(stop);
  return events;
}

// Only journal publication in this disposable agent directory is intercepted.
// Native Git, the SDK session writer, and all other filesystem calls stay real.
function journalFault(t, method, intercept) {
  const original = fs[method];
  const base = join(agentDir, "pi-web", "git-actions", "v1") + sep;
  const mocked = t.mock.method(fs, method, (from, to, ...args) => {
    if (String(to).startsWith(base)) intercept(from, to);
    return original(from, to, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
}

function failRecord(t, predicate) {
  const attempts = [], error = new Error("injected disposable journal write failure");
  journalFault(t, "renameSync", (from, to) => {
    if (!String(to).endsWith(`${sep}record.json`)) return;
    const record = JSON.parse(fs.readFileSync(from, "utf8")).record;
    if (predicate(record)) { attempts.push(record); throw error; }
  });
  return { attempts, error };
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
      const record = JSON.parse(fs.readFileSync(join(actionDir(event.actionId), "record.json"), "utf8")).record;
      if (!record.intended?.commit || injected) return;
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
    assert.deepEqual(checkout(f.cwd), before);
    assert.equal(fs.existsSync(markerPath), true);
    assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  }
});

test("actual Ask commit captures a complete multi-file artifact and intended identity before moving the ref", async (t) => {
  const f = fixture(t);
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
      kind: "commit", repositoryRoot: f.cwd, featureBranch: candidate.preview.branch, message,
      paths: [...selected].sort(), parentOid: f.head, candidateTreeOid: candidate.preview.tree, diff: card.diff,
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
  assert.ok(prepared, "intended identity must be durable before the ref CAS");
  assert.equal(prepared.record.state, "executing");
  assert.equal(prepared.record.decision, "approved");
  for (const event of events.filter(({ record }) => record.state !== "succeeded")) assert.deepEqual(event.checkout, before);
  assert.deepEqual(JSON.parse(prepared.artifact).candidate, captured.candidate);
  assertObject(f.cwd, prepared.record.intended, card.preview);
  const completed = await history(card.actionId);
  assert.equal(completed.record.state, "succeeded");
  assert.equal(completed.record.decision, "approved");
  assert.deepEqual(completed.record.intended, prepared.record.intended);
  const outcome = completed.record.outcome;
  assert.deepEqual(result.details, { ...outcome, actionId: card.actionId });
  assert.deepEqual(completed.candidate, captured.candidate);
  assertOneCommit(f, outcome.commit);
  assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "");
  assert.equal(git(f.cwd, "status", "--porcelain"), "M unselected.txt");
  assert.equal(git(f.cwd, "show", "HEAD:added.txt") + "\n", added);
  await assert.rejects(confirmGitCommit(card.preview, message), /stale preview|not in current status/);
  assertOneCommit(f, outcome.commit);
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
  const declined = await history(card.actionId), artifact = fs.readFileSync(join(actionDir(card.actionId), "candidate.json"));
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
  assert.deepEqual(fs.readFileSync(join(actionDir(card.actionId), "candidate.json")), artifact);
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
  const failure = new Error("pre-ref recording refused");
  let intended, calls = 0;
  await assert.rejects(confirmGitCommit(preview, message, async (value) => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    intended = value;
    assert.deepEqual(checkout(f.cwd), before);
    assertObject(f.cwd, intended, preview);
    throw failure;
  }), (error) => error === failure);
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
    if (++validations !== 3) return; // initial gate, decision gate, native pre-ref gate
    prepared = await history(card.actionId);
    assert.equal(prepared.record.state, "executing");
    assert.equal(prepared.record.decision, "approved");
    assert.equal(prepared.record.outcome, undefined);
    assertObject(f.cwd, prepared.record.intended, card.preview);
    assert.deepEqual(checkout(f.cwd), before);
    throw failure;
  } }), (error) => error === failure);
  assert.equal(validations, 3);
  const saved = await history(card.actionId);
  assert.equal(saved.record.state, "blocked");
  assert.equal(saved.record.decision, "approved");
  assert.deepEqual(saved.record.intended, prepared.record.intended);
  assert.equal(saved.record.outcome, undefined);
  assert.deepEqual(checkout(f.cwd), before);
});

test("artifact publication failure prevents both the approval prompt and any Git mutation", async (t) => {
  const f = fixture(t);
  changeFiles(f);
  const before = checkout(f.cwd), failure = new Error("artifact publication failed");
  let writes = 0, prompts = 0;
  journalFault(t, "linkSync", (_from, to) => {
    if (String(to).endsWith(`${sep}candidate.json`)) { writes++; throw failure; }
  });
  await assert.rejects(f.request({ ask: async () => { prompts++; return true; } }), (error) => error === failure);
  assert.equal(writes, 1, "failed capture is not retried");
  assert.equal(prompts, 0);
  assert.deepEqual(anchors(SessionManager.open(f.manager.getSessionFile())), []);
  assert.deepEqual(checkout(f.cwd), before);
  assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
});

test("pre-ref intended-record write failure cannot mutate Git or revive the approved action", async (t) => {
  const f = fixture(t);
  changeFiles(f);
  const before = checkout(f.cwd);
  const fault = failRecord(t, (record) => record.state === "executing" && !!record.intended);
  let card;
  await assert.rejects(f.request({ ask: async (value) => { card = value; return true; } }), (error) => error === fault.error);
  assert.equal(fault.attempts.length, 1, "no journal or Git retry after publication failure");
  assertObject(f.cwd, fault.attempts[0].intended, card.preview);
  assert.deepEqual(checkout(f.cwd), before);
  assert.equal(fs.existsSync(`${before.indexPath}.lock`), false);
  const saved = await history(card.actionId);
  assert.equal(saved.record.state, "recovery-required");
  assert.equal(saved.record.decision, "approved");
  assert.equal(saved.record.intended, undefined, "failed write is not durable evidence");
  assert.equal(saved.record.outcome, undefined);
  assert.equal(saved.candidate.diff.patch, card.diff.patch);
  await assert.rejects(transitionGitAction(card.actionId, saved.record.revision, { state: "executing", intended: fault.attempts[0].intended }, agentDir), /no longer live|read-only/);
  assert.deepEqual(checkout(f.cwd), before);
});

test("post-commit journal failure carries the actual OID and requires recovery, never another mutation", async (t) => {
  const f = fixture(t);
  changeFiles(f);
  const fault = failRecord(t, (record) => record.state === "succeeded");
  let card, recordingError;
  await assert.rejects(f.request({ ask: async (value) => { card = value; return true; } }), (error) => {
    assert.ok(error instanceof GitActionRecordingError);
    recordingError = error;
    return true;
  });
  assert.equal(fault.attempts.length, 1);
  assert.equal(recordingError.actionId, card.actionId);
  assert.equal(recordingError.outcome.status, "committed");
  assertObject(f.cwd, recordingError.outcome, card.preview);
  assertOneCommit(f, recordingError.outcome.commit);
  assert.equal(git(f.cwd, "diff", "--cached", "--name-only"), "");
  const result = gitActionFailureResult(recordingError);
  assert.equal(result.isError, true);
  assert.equal(result.details.recoveryRequired, true);
  assert.deepEqual(result.details.outcome, recordingError.outcome);
  assert.match(result.content[0].text, /Do not retry/);
  assert.doesNotMatch(result.content[0].text, /no commit|nothing changed|refresh the preview/i);
  assertNoPatch(result);
  const saved = await history(card.actionId);
  assert.equal(saved.record.state, "recovery-required");
  assert.equal(saved.record.decision, "approved");
  assert.equal(saved.record.intended.commit, recordingError.outcome.commit);
  assert.equal(saved.record.outcome, undefined);
  assert.equal(saved.candidate.diff.patch, card.diff.patch);
  await assert.rejects(transitionGitAction(card.actionId, saved.record.revision, { state: "succeeded", outcome: recordingError.outcome }, agentDir), /no longer live|read-only/);
  await assert.rejects(confirmGitCommit(card.preview, message), /stale preview|not in current status/);
  assertOneCommit(f, recordingError.outcome.commit);
});

test("the actual Ask tool preserves known-commit recovery facts when the final journal write fails", async (t) => {
  const f = fixture(t);
  changeFiles(f);
  const fault = failRecord(t, (record) => record.state === "succeeded");
  const result = await f.run({ operation: "commit", paths: selected, message }, async () => true);
  assert.equal(fault.attempts.length, 1);
  assert.equal(result.isError, true);
  assert.equal(result.details.recoveryRequired, true);
  assert.equal(result.details.outcome.status, "committed");
  assertOneCommit(f, result.details.outcome.commit);
  assert.match(result.content[0].text, /Do not retry/);
  assert.doesNotMatch(result.content[0].text, /no commit|nothing changed|refresh the preview/i);
  assertNoPatch(result);
  const saved = await history(result.details.actionId);
  assert.equal(saved.record.state, "recovery-required");
  assert.equal(saved.record.intended.commit, result.details.outcome.commit);
  assert.equal(saved.record.outcome, undefined);
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
  assert.equal(saved.candidate.diff.patch, JSON.parse(prepared.artifact).candidate.diff.patch);
  assert.match(saved.candidate.diff.patch, /ARTIFACT_ONLY_ADDED_59/);
  assert.equal((saved.candidate.diff.patch.match(/^diff --git /gm) ?? []).length, 3);
  assertObject(f.cwd, saved.record.outcome, preview);
  assertOneCommit(f, result.details.commit);
});

test("native integration awaits throwing beforeApply before checkout mutation and consumes the plan once", async (t) => {
  const f = fixture(t, { linked: true });
  fs.writeFileSync(join(f.cwd, "alpha.txt"), "integration candidate\n");
  git(f.cwd, "add", "alpha.txt");
  git(f.cwd, "commit", "-qm", "feature");
  const policy = { mode: "worktree", baseBranch: "base", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "base", method: "merge" },
    checks: [{ label: "Fixture check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const options = { sessionId: f.manager.getSessionId(), cwd: f.cwd, agentDir, featureBranch: "feature", getPolicy: () => policy };
  const receipt = await runGitVerification({ ...options, review: await reviewGitBranches(f.cwd, "feature", "base"), checkIndex: 0, isTrusted: () => true });
  const plan = await prepareIntegration({ ...options, receiptIds: [receipt.id] });
  const targetBefore = checkout(f.main), featureBefore = checkout(f.cwd);
  let calls = 0, atCallback;
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, options.sessionId, async () => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    atCallback = { target: checkout(f.main), feature: checkout(f.cwd), parents: git(f.cwd, "show", "-s", "--format=%P", plan.mergeOid) };
    throw new Error("pre-apply journal refused");
  }), /pre-apply validation failed; checkout unchanged/);
  assert.equal(calls, 1);
  assert.deepEqual(atCallback, { target: targetBefore, feature: featureBefore, parents: `${plan.review.targetOid} ${plan.review.featureOid}` });
  assert.deepEqual(checkout(f.main), targetBefore);
  assert.deepEqual(checkout(f.cwd), featureBefore);
  assert.equal(fs.existsSync(`${targetBefore.indexPath}.lock`), false);
  for (const suffix of ["json", "index"]) assert.equal(fs.existsSync(join(agentDir, "pi-web", "git-integration-recovery", `${plan.planId}.${suffix}`)), false);
  await assert.rejects(confirmIntegration(plan.planId, plan.planId, options.sessionId), /unknown or expired plan/);
  assert.deepEqual(checkout(f.main), targetBefore);
});
