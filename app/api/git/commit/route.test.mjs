import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-web-commit-route-home-"));
let agentDir = join(home, "agent");
await mkdir(agentDir);
const original = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { readGitAction, subscribeGitActionUpdates, transitionGitAction, releaseGitAction } = await jiti.import("../../../../lib/git-action-journal.ts");
const { beginGitOperationIntent, inspectGitOperationAdmission } = await jiti.import("../../../../lib/git-operation-admission.ts");
const { beginGitAction, gitActionSink } = await jiti.import("../../../../lib/git-action-controller.ts");
const { AgentSessionWrapper } = await jiti.import("../../../../lib/rpc-manager.ts");
const { acquireGitCheckoutGate } = await jiti.import("../../../../lib/git-checkout-gate.ts");
const { registerGitCheckLiveAuthorityReader } = await jiti.import("../../../../lib/git-check-authority-fence.ts");
const { selectGitProjectResources } = await jiti.import("../../../../lib/git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("../../../../lib/git-project-authorization.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("../../../../lib/git-workflow-settings-store.ts");
const git = promisify(execFile);
after(async () => {
  const pending = globalThis[Symbol.for("pi-web:git-action-human:v1")]?.pending;
  for (const item of pending?.values() ?? []) { clearTimeout(item.timer); item.handle.release(); }
  pending?.clear();
  for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
});
function post(body, signal) { return POST(new Request("http://localhost/api/git/commit", { method: "POST", body: JSON.stringify(body), signal })); }
const previewRequest = (id, message = "approved", paths = ["a"]) => ({ sessionId: id, operation: "preview", paths, message });
const confirmRequest = (id, candidate, message = "approved") => ({ sessionId: id, operation: "confirm", preview: candidate.preview, actionId: candidate.actionId, message });
const history = (id) => readGitAction(id, { includeArtifact: true });
const entries = (sm) => SessionManager.open(sm.getSessionFile()).getEntries();
const anchors = (sm) => entries(sm).filter((e) => e.type === "custom" && e.customType === "pi-web:git-action");
async function fixture(t, sharedAgent = false) {
  // Each disposable repository also owns its journal/ledger. A corrupt old
  // journal is deliberately a global blocker when its resource cannot be read.
  if (!sharedAgent) agentDir = await mkdtemp(join(home, "agent-fixture-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const dir = await mkdtemp(join(tmpdir(), "pi-web-commit-route-"));
  const cwd = join(dir, "repo");
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.name", "Route Tester"]);
  await git("git", ["-C", cwd, "config", "user.email", "route@example.invalid"]);
  await writeFile(join(cwd, "a"), "first\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await git("git", ["-C", cwd, "commit", "-qm", "initial"]);
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const id = sm.getSessionId();
  cacheSessionPath(id, sm.getSessionFile());
  allowFileRoot(cwd);
  t.after(async () => { invalidateSessionPathCache(id); invalidateSessionListCache(); await rm(dir, { recursive: true, force: true }); });
  return { cwd, id, sm };
}
test("missing session, invalid cwd input and unauthorized persisted checkout", async (t) => {
  assert.equal((await post(previewRequest("missing"))).status, 404);
  const { cwd, id } = await fixture(t);
  assert.equal((await post({ ...previewRequest(id), cwd })).status, 400);
  const old = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
  const actions = () => readdir(join(agentDir, "pi-web/git-actions/v1")).catch(() => []);
  const before = await actions();
  try { assert.equal((await post(previewRequest(id))).status, 403); }
  finally { globalThis.__piAllowedRootsCache = old; }
  assert.deepEqual(await actions(), before);
});
test("manual commit permits an active chat but rejects checkout mismatch and stale preview", async (t) => {
  const { cwd, id } = await fixture(t);
  const previous = globalThis.__piSessions;
  const live = { cwd, sessionId: id, isAlive: () => false, isRunning: () => true };
  globalThis.__piSessions = new Map([[id, live]]);
  t.after(() => { globalThis.__piSessions = previous; });
  await writeFile(join(cwd, "a"), "second\n");
  assert.equal((await post(previewRequest(id))).status, 200);
  live.isRunning = () => false;
  const denied = await post(previewRequest(id, "approved", ["https://user:secret@example.invalid/repo"]));
  assert.equal(denied.status, 409);
  assert.doesNotMatch(await denied.text(), /secret/);
  const response = await post(previewRequest(id));
  assert.equal(response.status, 200);
  const candidate = await response.json();
  const { preview, actionId, candidateDiff, candidateDiffUnavailable } = candidate;
  assert.equal(candidateDiffUnavailable, undefined);
  assert.equal(candidateDiff.fromTreeOid, (await git("git", ["-C", cwd, "rev-parse", `${preview.head}^{tree}`])).stdout.trim());
  assert.equal(candidateDiff.toTreeOid, preview.tree);
  assert.match(candidateDiff.patch, /\+second/);
  assert.equal(candidateDiff.hasBinaryChanges, false);
  assert.equal((await post({ ...confirmRequest(id, candidate), preview: { ...preview, repositoryRoot: agentDir } })).status, 409);
  await writeFile(join(cwd, "a"), "third\n");
  assert.equal((await post(confirmRequest(id, candidate))).status, 409);
  assert.equal((await history(actionId)).record.state, "blocked");
  assert.match((await history(actionId)).candidate.diff.patch, /\+second/);
  const freshCandidate = await (await post(previewRequest(id))).json();
  const fresh = freshCandidate.preview;
  const committed = await post(confirmRequest(id, freshCandidate));
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.status, "committed");
  assert.equal(result.authorEmail, "route@example.invalid");
  assert.deepEqual(result.parents, [fresh.head]);
  assert.equal(result.tree, fresh.tree);
  assert.equal((await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
});

test("zero-defined, default-integration and manual-only profiles commit without optional check execution permission", async (t) => {
  for (const [name, stage] of [["zero-defined", null], ["default-integration", undefined], ["manual-only", "none"]]) {
    for (const restriction of ["deny", "disabled"]) await t.test(`${name} / checks ${restriction}`, async (t) => {
      const f = await fixture(t);
      f.sm.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: [] });
      const marker = join(f.cwd, "must-not-execute");
      const recipe = { label: "optional only", argv: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'wrong')`],
        ...(stage ? { requiredStage: stage } : {}) };
      writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: { [f.cwd]: {
        commits: "manual", checks: stage === null ? [] : [recipe], ...(restriction === "disabled" ? { checkConfirmation: "disabled" } : {}) } } }, agentDir);
      if (restriction === "deny") {
        const source = await selectGitProjectResources(f.cwd), status = await readProjectAuthorization(source, undefined, agentDir);
        await saveProjectAuthorization(source, undefined, "project", "checks", "deny", status, agentDir);
      }
      await writeFile(join(f.cwd, "a"), "optional checks must not be run\n");
      const response = await post(previewRequest(f.id));
      assert.equal(response.status, 200, await response.clone().text());
      const candidate = await response.json();
      assert.equal(candidate.verification.status, stage === null ? "no-defined" : "no-required");
      assert.deepEqual(candidate.verification.receiptIds, []); assert.equal(candidate.verification.repositoryChecksWaived, false);
      assert.equal(candidate.verification.candidateTreeVerified, false);
      const confirmed = await post(confirmRequest(f.id, candidate));
      assert.equal(confirmed.status, 200, await confirmed.clone().text()); assert.equal((await confirmed.json()).status, "committed");
      assert.equal(existsSync(marker), false, "discovery/commit must never execute an optional recipe");
      assert.equal(anchors(f.sm).length, 1, "no check execution action or passing check evidence was manufactured");
    });
  }
});

test("browser staged candidate commits only selected index entries and authenticates the mode", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "a"), "selected staged\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await writeFile(join(cwd, "a"), "selected staged\nunstaged\n");
  await writeFile(join(cwd, "other"), "other staged\n");
  await git("git", ["-C", cwd, "add", "other"]);
  assert.equal((await post({ ...previewRequest(id), mode: "unknown" })).status, 400);
  const response = await post({ ...previewRequest(id), mode: "staged" });
  assert.equal(response.status, 200);
  const candidate = await response.json();
  assert.equal(candidate.preview.mode, "staged");
  assert.match(candidate.candidateDiff.patch, /selected staged/);
  assert.doesNotMatch(candidate.candidateDiff.patch, /other staged|unstaged/);
  assert.equal((await post({ ...confirmRequest(id, candidate), preview: { ...candidate.preview, mode: "whole-file" } })).status, 409);
  const committed = await post(confirmRequest(id, candidate));
  assert.equal(committed.status, 200);
  assert.equal((await git("git", ["-C", cwd, "show", "HEAD:a"])).stdout.trim(), "selected staged");
  assert.equal((await git("git", ["-C", cwd, "diff", "--cached", "--name-only"])).stdout.trim(), "other");
  assert.equal((await git("git", ["-C", cwd, "diff", "--name-only"])).stdout.trim(), "a");
});

test("staged browser approval fails closed if index bytes change while awaiting confirmation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "staged original\n");
  await git("git", ["-C", f.cwd, "add", "a"]);
  const candidate = await (await post({ ...previewRequest(f.id), mode: "staged" })).json();
  assert.equal(candidate.preview.mode, "staged");
  await writeFile(join(f.cwd, "a"), "staged replacement\n");
  await git("git", ["-C", f.cwd, "add", "a"]);
  const response = await post(confirmRequest(f.id, candidate));
  assert.equal(response.status, 409);
  const saved = await history(candidate.actionId);
  assert.equal(saved.record.state, "blocked");
  assert.equal(saved.record.decision, "approved");
  assert.equal(saved.record.outcome, undefined);
  assert.match(saved.candidate.diff.patch, /staged original/);
  assert.doesNotMatch(saved.candidate.diff.patch, /staged replacement/);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
});

test("saved Project/Chat Deny blocks browser preview and live revocation blocks confirmation; Allow does not skip preview", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "candidate\n");
  const selection = await selectGitProjectResources(f.cwd);
  const owner = { sessionId: f.id, sessionFile: f.sm.getSessionFile(), sessionCwd: f.cwd };
  const status = () => readProjectAuthorization(selection, owner, agentDir);
  const set = async (scope, decision) => saveProjectAuthorization(selection, scope === "session" ? owner : undefined,
    scope, "commit", decision, scope === "session" ? await status() : await readProjectAuthorization(selection, undefined, agentDir), agentDir);
  await set("project", "deny");
  assert.equal((await post(previewRequest(f.id))).status, 409);
  await set("session", "allow");
  const candidate = await (await post(previewRequest(f.id))).json();
  assert.ok(candidate.preview, "a narrower allow does not commit without the legacy preview/confirmation");
  await set("session", "deny");
  const blocked = await post(confirmRequest(f.id, candidate));
  assert.equal(blocked.status, 409);
  assert.equal((await history(candidate.actionId)).record.state, "awaiting-decision");
  await set("session", "inherit");
  assert.equal((await post(previewRequest(f.id))).status, 409, "project Deny resumes after removing the chat override");
  await set("project", "inherit");
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409, "changed-and-restored authority never revives an old exact preview");
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
  const renewed = await (await post(previewRequest(f.id))).json();
  assert.equal((await (await post(confirmRequest(f.id, renewed))).json()).status, "committed");
});

test("another active session permits browser commit; a Git transaction blocks confirmation without consuming approval", async (t) => {
  const f = await fixture(t);
  const previous = globalThis.__piSessions;
  let emit;
  const inner = { sessionId: "other-chat", isStreaming: true, isCompacting: false, isBashRunning: false,
    sessionManager: { getCwd: () => f.cwd }, agent: { state: {} }, dispose: () => {},
    getAllTools: () => ["read", "grep", "find", "ls"].map((name) => ({ name, sourceInfo: { source: "builtin", path: `<builtin:${name}>` } })),
    resourceLoader: { getExtensions: () => ({ extensions: [{ path: "<inline:pi-web-checkout-operation-guard>" }], errors: [] }) },
    subscribe: (listener) => { emit = listener; return () => {}; } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
  wrapper.start();
  globalThis.__piSessions = new Map([[wrapper.sessionId, wrapper]]);
  t.after(() => { wrapper.destroy(); globalThis.__piSessions = previous; });
  await writeFile(join(f.cwd, "a"), "candidate\n");
  emit({ type: "tool_execution_start", toolCallId: "safe", toolName: "read" });
  const candidateResponse = await post(previewRequest(f.id));
  assert.equal(candidateResponse.status, 200, await candidateResponse.clone().text());
  const candidate = await candidateResponse.json();
  emit({ type: "tool_execution_start", toolCallId: "unsafe", toolName: "edit" });
  const release = acquireGitCheckoutGate([f.cwd]);
  try { assert.equal((await post(confirmRequest(f.id, candidate))).status, 409); }
  finally { release(); }
  assert.equal((await history(candidate.actionId)).record.state, "awaiting-decision", "A concurrent transaction must not consume approval");
  assert.equal((await (await post(confirmRequest(f.id, candidate))).json()).status, "committed");
  emit({ type: "tool_execution_end", toolCallId: "unsafe" });
});

test("an unresolved check child quarantines the physical resource across browser sessions without touching HEAD", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "uncommitted\n");
  const second = SessionManager.create(f.cwd);
  second.appendMessage({ role: "user", content: "second", timestamp: Date.now() });
  second.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  cacheSessionPath(second.getSessionId(), second.getSessionFile());
  t.after(() => invalidateSessionPathCache(second.getSessionId()));
  const a = await (await post(previewRequest(f.id))).json();
  const b = await (await post(previewRequest(second.getSessionId()))).json();
  const resource = realpathSync(join(f.cwd, ".git"));
  const orphan = beginGitOperationIntent(agentDir, resource, randomUUID(), "checks",
    `pi-web-git-check-${randomUUID()}.service`);
  const before = (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim();
  for (const [id, candidate] of [[f.id, a], [second.getSessionId(), b]]) {
    const response = await post(confirmRequest(id, candidate));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).recoveryRequired, true);
    assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), before);
  }
  assert.deepEqual(inspectGitOperationAdmission(agentDir, resource).actionIds, [orphan.actionId]);
  assert.equal(inspectGitOperationAdmission(agentDir, resource).reason, "unresolved");
  // A check intent without a real invocation/proof must not be cleared just to
  // continue a fixture. Its private test directory is removed by test teardown.

});

test("old journal-only executing history is not cleared by a fresh candidate", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "uncommitted\n");
  const old = await (await post(previewRequest(f.id))).json();
  const record = (await history(old.actionId)).record;
  await transitionGitAction(old.actionId, record.revision, { state: "executing", decision: "approved" });
  releaseGitAction(old.actionId); // simulate a prior process exiting without a ledger
  const next = await (await post(previewRequest(f.id))).json();
  const response = await post(confirmRequest(f.id, next));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).recoveryRequired, true);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), next.preview.head);
});

test("operation preflight has a safe actionable diagnostic without leaking arbitrary Git policy keys", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "candidate\n");
  const head = (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim();
  await writeFile(join(f.cwd, ".git", "MERGE_HEAD"), `${head}\n`);
  const blocked = await post(previewRequest(f.id));
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /merge is in progress/);
  await rm(join(f.cwd, ".git", "MERGE_HEAD"));
  await git("git", ["-C", f.cwd, "config", "filter.PRIVATE_SENTINEL.clean", "cat"]);
  const policy = await post(previewRequest(f.id));
  assert.equal(policy.status, 409);
  assert.doesNotMatch(await policy.text(), /PRIVATE_SENTINEL|filter\./i);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), head);
});

test("a late operation marker after durable intent records a definite blocked manual commit", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "candidate\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const indexPath = join(f.cwd, ".git", "index");
  const beforeIndex = await readFile(indexPath);
  let injected = false;
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionId !== candidate.actionId || injected) return;
    const record = JSON.parse(readFileSync(join(agentDir, "pi-web/git-actions/v1", actionId, "record.json"), "utf8")).record;
    if (!record.intended?.commit) return;
    injected = true;
    writeFileSync(join(f.cwd, ".git", "MERGE_HEAD"), `${candidate.preview.head}\n`);
  });
  let response;
  try { response = await post(confirmRequest(f.id, candidate)); }
  finally { off(); }
  assert.equal(injected, true);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /merge is in progress/);
  const record = (await history(candidate.actionId)).record;
  assert.equal(record.state, "blocked");
  assert.equal(record.decision, "approved");
  assert.match(record.reason, /merge is in progress/);
  assert.equal(record.outcome, undefined);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
  assert.deepEqual(await readFile(indexPath), beforeIndex);
});

test("candidate patch is from server-derived trees even if caller supplies other OIDs", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "a"), "only approved contents\n");
  const response = await post({ ...previewRequest(id), head: "0".repeat(40), tree: "f".repeat(40) });
  assert.equal(response.status, 200);
  const { preview, candidateDiff } = await response.json();
  assert.notEqual(preview.tree, "f".repeat(40));
  assert.equal(candidateDiff.toTreeOid, preview.tree);
  assert.match(candidateDiff.patch, /\+only approved contents/);
  assert.equal(candidateDiff.fromTreeOid, (await git("git", ["-C", cwd, "rev-parse", `${preview.head}^{tree}`])).stdout.trim());
});

test("binary candidate patch is a summary; oversized patch has explicit unavailability, not partial output", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 255]));
  const binary = await post(previewRequest(id, "approved", ["binary.bin"]));
  assert.equal(binary.status, 200);
  const binaryBody = await binary.json();
  assert.equal(binaryBody.candidateDiff.hasBinaryChanges, true);
  assert.match(binaryBody.candidateDiff.patch, /Binary files .* differ/);
  assert.equal(binaryBody.candidateDiffUnavailable, undefined);
  await writeFile(join(cwd, "large.txt"), "x".repeat(1024 * 1024 + 100) + "\n");
  const large = await post(previewRequest(id, "approved", ["large.txt"]));
  assert.equal(large.status, 200);
  const body = await large.json();
  assert.ok(body.preview.reviewToken);
  assert.match(body.candidateDiffUnavailable, /1 MB limit/);
  assert.equal(body.candidateDiff, undefined);
  assert.equal((await history(binaryBody.actionId)).candidate.diff.hasBinaryChanges, true);
  assert.equal((await history(body.actionId)).candidate.diffUnavailable, body.candidateDiffUnavailable);
  assert.equal((await history(body.actionId)).candidate.diff, undefined);
});

test("unexpected tree diff failure fails preview rather than returning a token alone", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "a"), "updated\n");
  const bin = await mkdtemp(join(tmpdir(), "pi-web-git-fail-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" --no-pager diff --no-color "*) exit 1 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  try {
    const response = await post(previewRequest(id));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).preview, undefined);
  } finally { process.env.PATH = oldPath; }
});

test("durable human candidate uses the shared agent contract, metadata anchors only, and survives checkout removal", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "captured private patch\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  let stored = await history(candidate.actionId);
  assert.equal(stored.record.source, "human");
  assert.equal(stored.record.state, "awaiting-decision");
  assert.equal(stored.record.outcome, undefined);
  assert.equal(stored.candidate.message, "approved");
  assert.equal(stored.candidate.parentOid, candidate.preview.head);
  assert.equal(stored.record.summary.projectRoot, f.cwd);
  assert.equal(stored.candidate.sourceCheckoutRoot, f.cwd);
  assert.match(stored.candidate.diff.patch, /captured private patch/);
  assert.doesNotMatch(JSON.stringify(stored), /reviewToken|planId|receiptIds/);
  assert.equal(stored.record.summary.diff, undefined);
  assert.deepEqual(anchors(f.sm).map((e) => e.data), [{ version: 1, actionId: candidate.actionId }]);
  assert.doesNotMatch(await readFile(f.sm.getSessionFile(), "utf8"), /captured private patch|reviewToken/);
  const manager = SessionManager.open(f.sm.getSessionFile());
  const agent = await beginGitAction(gitActionSink(manager, (type, data) => manager.appendCustomEntry(type, data)), "agent", stored.candidate);
  try {
    await agent.update("awaiting-decision");
    assert.deepEqual((await history(agent.record.id)).candidate, stored.candidate);
    await agent.update("declined", { decision: "declined" });
  } finally { agent.release(); }
  const result = await (await post(confirmRequest(f.id, candidate))).json();
  assert.equal(result.status, "committed");
  assert.doesNotMatch(JSON.stringify(result), /patch|captured private patch/);
  stored = await history(candidate.actionId);
  assert.equal(stored.record.state, "succeeded");
  assert.equal(stored.record.decision, "approved");
  assert.equal(stored.record.intended.commit, result.commit);
  assert.equal(stored.record.outcome.commit, result.commit);
  assert.equal(stored.record.outcome.authorEmail, "route@example.invalid");
  assert.deepEqual(stored.record.outcome.parents, [candidate.preview.head]);
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
  assert.equal((await history(candidate.actionId)).record.revision, stored.record.revision);
  await rm(f.cwd, { recursive: true, force: true });
  assert.deepEqual((await history(candidate.actionId)).candidate, stored.candidate);
});

test("only the same live session, exact message and native candidate can be confirmed; legacy and historical IDs are not executable", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "approved content\n");
  assert.equal((await post({ sessionId: f.id, operation: "preview", paths: ["a"] })).status, 400);
  assert.equal(anchors(f.sm).length, 0);
  const candidate = await (await post(previewRequest(f.id, "exact message"))).json();
  const other = await fixture(t, true);
  const sm = SessionManager.create(f.cwd);
  sm.appendMessage({ role: "user", content: "fork", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  sm.appendCustomEntry("pi-web:git-action", { version: 1, actionId: candidate.actionId });
  cacheSessionPath(sm.getSessionId(), sm.getSessionFile());
  t.after(() => invalidateSessionPathCache(sm.getSessionId()));
  for (const id of [other.id, sm.getSessionId()]) assert.equal((await post(confirmRequest(id, candidate, "exact message"))).status, 409);
  assert.equal((await post(confirmRequest(f.id, candidate, "different message"))).status, 409);
  assert.equal((await post({ ...confirmRequest(f.id, candidate, "exact message"), preview: { ...candidate.preview, tree: "f".repeat(40) } })).status, 409);
  assert.equal((await post({ ...confirmRequest(f.id, candidate, "exact message"), actionId: undefined })).status, 409);
  assert.equal((await post({ ...confirmRequest(f.id, candidate, "exact message"), actionId: "00000000-0000-0000-0000-000000000000" })).status, 409);
  assert.equal((await history(candidate.actionId)).record.state, "awaiting-decision");
  assert.equal((await post(confirmRequest(f.id, candidate, "exact message"))).status, 200);
});

test("expired association cannot be revived even with an otherwise authentic native token", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "expired\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const now = Date.now;
  Date.now = () => candidate.expiresAt + 1;
  try { assert.equal((await post(confirmRequest(f.id, candidate))).status, 409); }
  finally { Date.now = now; }
  assert.equal((await history(candidate.actionId)).record.state, "expired");
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
});

test("callback journals intended identity before ref CAS; cancellation after that write prevents mutation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "cancelled\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const controller = new AbortController();
  let observed;
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionId !== candidate.actionId) return;
    const record = JSON.parse(readFileSync(join(agentDir, "pi-web/git-actions/v1", actionId, "record.json"), "utf8")).record;
    if (record.state === "executing" && record.intended) { observed = record.intended; controller.abort(); }
  });
  try { assert.equal((await post(confirmRequest(f.id, candidate), controller.signal)).status, 409); }
  finally { off(); }
  assert.ok(observed.commit);
  assert.equal(observed.tree, candidate.preview.tree);
  assert.equal((await history(candidate.actionId)).record.state, "cancelled");
  assert.equal((await history(candidate.actionId)).record.outcome, undefined);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
});

test("missing durable candidate prevents mutation, and post-apply recording failure preserves actual result with recovery warning", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "journal failure\n");
  const unavailable = await (await post(previewRequest(f.id))).json();
  await rm(join(agentDir, "pi-web/git-actions/v1", unavailable.actionId, "candidate.json"));
  assert.equal((await post(confirmRequest(f.id, unavailable))).status, 409);
  assert.equal((await history(unavailable.actionId)).record.state, "expired", "an unapproved preview cannot move a ref");
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), unavailable.preview.head);
  // A fresh independently captured approval may proceed: the expired old
  // preview was never an executing operation and cannot be replayed.
  const reviewed = await (await post(previewRequest(f.id))).json();
  assert.equal((await post(confirmRequest(f.id, reviewed))).status, 200);
  const clean = await fixture(t);
  await writeFile(join(clean.cwd, "a"), "journal failure\n");
  const candidate = await (await post(previewRequest(clean.id))).json();
  // Fault actual POST-CAS recording, not the pre-CAS intent callback. The new
  // durable-review guard correctly blocks journal corruption before effects.
  const bin = await mkdtemp(join(tmpdir(), "pi-web-post-cas-journal-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim(), wrapper = join(bin, "git");
  const recordPath = join(agentDir, "pi-web/git-actions/v1", candidate.actionId, "record.json");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; printf '%s' 'injected journal failure' > "${recordPath}"; exit 0 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirmRequest(clean.id, candidate)); }
  finally { process.env.PATH = oldPath; }
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "committed");
  assert.equal(result.actionId, candidate.actionId);
  assert.equal(result.recoveryRequired, true);
  assert.match(result.recoveryWarning, /do not repeat/i);
  assert.doesNotMatch(JSON.stringify(result), /refresh|no mutation|injected journal failure/i);
  assert.equal((await git("git", ["-C", clean.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
  assert.equal((await post(confirmRequest(clean.id, candidate))).status, 409);
});

test("native post-ref partial success is recovery-required with actual OIDs, never an ordinary failed commit", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "partial\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const bin = await mkdtemp(join(tmpdir(), "pi-web-git-partial-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; rm "${f.cwd}/.git/index.lock"; exit 0 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirmRequest(f.id, candidate)); }
  finally { process.env.PATH = oldPath; }
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "partial-success");
  const stored = await history(candidate.actionId);
  assert.equal(stored.record.state, "recovery-required");
  assert.equal(stored.record.outcome.commit, result.commit);
  assert.equal(stored.record.outcome.reason, undefined);
  assert.deepEqual(stored.record.outcome.parents, [candidate.preview.head]);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
});

test("callback intent-write failure and late access revocation both prevent the ref CAS", async (t) => {
  for (const fault of ["journal", "revocation"]) {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), `${fault}\n`);
    const candidate = await (await post(previewRequest(f.id))).json();
    const roots = globalThis.__piAllowedRootsCache;
    let injected = false;
    const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
      if (actionId !== candidate.actionId || injected) return;
      const record = JSON.parse(readFileSync(join(agentDir, "pi-web/git-actions/v1", actionId, "record.json"), "utf8")).record;
      if (record.state !== "executing") return;
      // Execution is now first recorded with the native prepared intent. Fault
      // the captured artifact at that actual callback, not a removed premature
      // executing-without-intent UI bookkeeping phase.
      if (fault === "journal" && record.intended) {
        writeFileSync(join(agentDir, "pi-web/git-actions/v1", actionId, "candidate.json"), "invalid candidate");
        injected = true;
      } else if (fault === "revocation" && record.intended) {
        globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
        injected = true;
      }
    });
    try { assert.equal((await post(confirmRequest(f.id, candidate))).status, 409); }
    finally { off(); globalThis.__piAllowedRootsCache = roots; }
    assert.equal(injected, true);
    assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
    if (fault === "revocation") assert.equal((await history(candidate.actionId)).record.state, "blocked");
  }
});

test("unknown error after the ref boundary reports uncertain execution with intended facts, never stale-preview guidance", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "uncertain update\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const bin = await mkdtemp(join(tmpdir(), "pi-web-git-uncertain-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; echo 'secret unknown error' >&2; exit 1 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirmRequest(f.id, candidate)); }
  finally { process.env.PATH = oldPath; }
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.recoveryRequired, true);
  assert.match(result.recoveryWarning, /uncertain execution result/);
  assert.match(result.error, /do not retry/);
  assert.doesNotMatch(JSON.stringify(result), /refresh|new preview|secret unknown error/);
  assert.equal(result.outcome, undefined);
  assert.equal(result.intended.commit, (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim());
  assert.equal((await history(candidate.actionId)).record.state, "recovery-required");
});

test("anchor resolves the latest disk parent or newly-created live manager after awaited artifact work", async (t) => {
  const registry = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = registry; });
  for (const mode of ["disk", "new-live-wrapper"]) {
    globalThis.__piSessions = registry;
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "fresh anchor parent\n");
    let latest;
    let expectedParent;
    const off = subscribeGitActionUpdates(f.id, ({ revision }) => {
      if (revision !== 1 || latest) return;
      latest = SessionManager.open(f.sm.getSessionFile());
      latest.appendCustomEntry("test:concurrent-metadata", { mode });
      expectedParent = latest.getLeafId();
      if (mode === "new-live-wrapper") globalThis.__piSessions = new Map([...(registry ?? []), [f.id, {
        sessionId: f.id, sessionFile: f.sm.getSessionFile(), cwd: f.cwd, isAlive: () => true, isRunning: () => false,
        inner: { sessionManager: latest },
      }]]);
    });
    let response;
    try { response = await post(previewRequest(f.id)); }
    finally { off(); }
    assert.equal(response.status, 200, await response.clone().text());
    const candidate = await response.json();
    const [anchor] = anchors(f.sm);
    assert.equal(anchor.data.actionId, candidate.actionId);
    assert.equal(anchor.parentId, expectedParent, "append must not branch from the pre-artifact manager's parent");
    assert.equal(entries(f.sm).filter((e) => e.customType === "test:concurrent-metadata").length, 1);
    if (mode === "new-live-wrapper") assert.equal(latest.getLeafId(), anchor.id, "the live SDK manager receives the anchor too");
  }
});

test("disk-ahead live manager and moved/replaced source file are refused at anchor append, never recreated or overwritten", async (t) => {
  const registry = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = registry; });
  for (const mode of ["disk-ahead-live", "moved", "replaced"]) {
    globalThis.__piSessions = registry;
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "do not recreate source\n");
    const file = f.sm.getSessionFile();
    const moved = `${file}.moved`;
    const source = await readFile(file, "utf8");
    let authorityEpoch = 0;
    if (mode === "disk-ahead-live") {
      const live = { sessionId: f.id, sessionFile: file, cwd: f.cwd, isAlive: () => true, isRunning: () => false,
        inner: { sessionManager: f.sm, getActiveToolNames: () => [] } };
      registerGitCheckLiveAuthorityReader(live, () => String(authorityEpoch));
      globalThis.__piSessions = new Map([...(registry ?? []), [f.id, live]]);
    }
    let actionId;
    const off = subscribeGitActionUpdates(f.id, (event) => {
      if (event.revision !== 1) return;
      actionId = event.actionId;
      if (mode === "disk-ahead-live") { authorityEpoch++; SessionManager.open(file).appendCustomEntry("test:external", { keep: true }); }
      else {
        renameSync(file, moved);
        if (mode === "replaced") writeFileSync(file, source);
      }
    });
    let response;
    try { response = await post(previewRequest(f.id)); }
    finally { off(); }
    assert.equal(response.status, 409);
    assert.ok(actionId, "fault injected after durable artifact creation, before anchor append");
    assert.equal((await history(actionId)).record.state, "blocked");
    if (mode === "moved") {
      assert.equal(existsSync(file), false, "SDK must not recreate a removed source file");
      assert.equal(await readFile(moved, "utf8"), source);
    } else {
      assert.equal(anchors(f.sm).length, 0);
      if (mode === "replaced") assert.equal(await readFile(file, "utf8"), source);
      else assert.equal(entries(f.sm).at(-1).customType, "test:external");
    }
  }
});
