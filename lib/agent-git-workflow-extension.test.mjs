import assert from "node:assert/strict";
import childProcess, { execFile } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import fs, { renameSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
import { writeLegacyGitActionFixture } from "./git-action-legacy-fixture.mjs";

const historyDir = await mkdtemp(path.join(os.tmpdir(), "agent-action-history-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousGitHome = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
await mkdir(path.join(historyDir, "home"));
Object.assign(process.env, { HOME: path.join(historyDir, "home"), XDG_CONFIG_HOME: path.join(historyDir, "home/.config") });
process.env.PI_CODING_AGENT_DIR = historyDir;
after(async () => {
  for (const [key, value] of Object.entries(previousGitHome)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(historyDir, { recursive: true, force: true });
});
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { interopDefault: false });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const managers = new Map(), fixtureWriters = new Map();
function fixtureWriter(cwd) {
  let state = fixtureWriters.get(cwd);
  if (!state) { state = { id: randomUUID(), revision: 1 }; fixtureWriters.set(cwd, state); }
  return { readSelectionRevisionSync: () => `${state.id}:${state.revision}` };
}
function sessionFixture(cwd, entries = []) {
  const persisted = SessionManager.create(cwd, path.join(historyDir, "sessions"));
  persisted.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
  persisted.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const id = persisted.getSessionId(); fixtureWriter(cwd);
  for (const entry of entries) if (entry.type === "custom") persisted.appendCustomEntry(entry.customType, entry.data);
  const manager = { getSessionId: () => id, getSessionFile: () => persisted.getSessionFile(), getCwd: () => cwd, getHeader: () => persisted.getHeader(),
    getEntries: () => persisted.getEntries(), getBranch: () => persisted.getBranch(), getLeafId: () => persisted.getLeafId(),
    isPersisted: () => persisted.isPersisted(), appendCustomEntry: (customType, data) => {
      if (customType !== "pi-web:git-action") fixtureWriters.get(cwd).revision++;
      return persisted.appendCustomEntry(customType, data);
    } };
  managers.set(cwd, manager);
  return manager;
}
const managerFor = (cwd) => managers.get(cwd) ?? sessionFixture(cwd);
const appendFor = (cwd) => (type, data) => managerFor(cwd).appendCustomEntry(type, data);
const exec = promisify(execFile);
// Keep named exports live for scoped fault injection; jiti's default interop
// proxy caches property reads and would conceal or retain mocked dependencies.
const { createAgentGitWorkflowExtension: createNativeAgentGitWorkflowExtension } = await jiti.import("./agent-git-workflow-extension.ts");
const createAgentGitWorkflowExtension = (cwd, agentDir, manager) => createNativeAgentGitWorkflowExtension(cwd, agentDir, manager, fixtureWriter(cwd));
const fileAccess = await jiti.import("./file-access.ts");
const { allowFileRoot } = fileAccess;
const hasNativeIndexLock = async cwd => fs.existsSync(path.join(await git(cwd, "rev-parse", "--absolute-git-dir"), "index.lock"));
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
const journal = await jiti.import("./git-action-journal.ts");
const { createGitAction, readGitAction, releaseGitAction } = journal;
const projectResources = await jiti.import("./git-project-resources.ts");
const sessionReader = await jiti.import("./session-reader.ts");
const { appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { resolveGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
const { appendAgentGitPreferences } = await jiti.import("./agent-git-preferences.ts");
// Pre-invocation persisted fixture setup, never an auto-save inside run/approval.
const saveFixturePreferences = (cwd, checks) => appendAgentGitPreferences(managerFor(cwd), {
  targetBranch: "target", method: "merge", checks: structuredClone(checks), cleanup: "retain", mode: "current",
});

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

// These registered-tool fixtures have no Git repository at all. A live resource
// selection, policy gate, UI wait, wrapper start or write is always a test failure.
async function artifactFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-artifact-tool-")), cwd = path.join(root, "checkout");
  await mkdir(cwd);
  const manager = SessionManager.create(cwd, path.join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: 2 });
  const ids = [], forbidden = [];
  const previousCache = globalThis.__piAllowedRootsCache, previousRoots = globalThis.__piAdditionalAllowedRoots;
  globalThis.__piAllowedRootsCache = undefined;
  globalThis.__piAdditionalAllowedRoots = new Set();
  allowFileRoot(cwd); // Trusted existing admission, NOT the request/header authorizing itself.
  const roots = globalThis.__piAdditionalAllowedRoots;
  t.after(async () => {
    globalThis.__piAllowedRootsCache = previousCache;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    for (const spy of forbidden) spy.mock.restore();
    syncBuiltinESMExports();
    for (const id of ids) {
      releaseGitAction(id);
      await rm(path.join(historyDir, "pi-web/git-actions/v1", id), { recursive: true, force: true });
      // Remove ONLY this fixture's own publications, especially its deliberately
      // corrupt envelope: unknown retention items correctly block later writes.
      for (const suffix of ["action", "artifact"]) await rm(path.join(historyDir, "git-diagnostics-v2", `${id}.${suffix}`), { force: true });
    }
    await rm(root, { recursive: true, force: true });
  });
  // Exercise the real cold-cache file-access snapshot. Tripwires cover every
  // subprocess API and the full session scan; do not mock away authorization.
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    forbidden.push(t.mock.method(childProcess, method, () => { throw new Error(`Unexpected subprocess ${method}`); }));
  }
  forbidden.push(t.mock.method(childProcess.ChildProcess.prototype, "spawn", () => { throw new Error("Unexpected native spawn"); }));
  syncBuiltinESMExports();
  for (const [module, method] of [[access, "assertManagedGitAction"], [selector, "selectGitWorkspace"],
    [sessionReader, "listAllSessions"], [fileAccess, "isExistingFilePathAllowed"],
    [projectResources, "selectGitProjectResources"], [projectResources, "revalidateGitProjectResources"],
    [actions, "beginGitAction"], [rpc, "startRpcSession"], [verification, "runGitVerification"],
    [integration, "prepareIntegration"], [integration, "confirmIntegration"]]) {
    forbidden.push(t.mock.method(module, method, () => { throw new Error(`Unexpected ${method}`); }));
  }
  const tools = new Map(), getActiveTools = t.mock.fn(() => ["read"]), appendEntry = t.mock.fn(() => { throw new Error("Unexpected transcript write"); });
  // Neither the injected mutation root nor manager can redirect a historical read.
  createAgentGitWorkflowExtension(cwd, path.join(root, "wrong-mutation-root"), {
    getEntries: () => { throw new Error("Unexpected injected-manager history read"); },
  }).factory({ registerTool: (tool) => tools.set(tool.name, tool), getActiveTools, appendEntry });
  const tool = tools.get("git_workflow"), ctx = { cwd, sessionManager: manager, hasUI: false };
  const uiAccess = t.mock.fn(() => { throw new Error("Unexpected UI access"); });
  Object.defineProperty(ctx, "ui", { get: uiAccess });
  const from = "a".repeat(40), to = "b".repeat(40), target = "c".repeat(40);
  const create = async (patch = "+captured\n", { anchor = true, diff = true, binary = false } = {}) => {
    const record = await createGitAction({ sessionId: manager.getSessionId(), source: "agent", candidate: {
      kind: "review", repositoryRoot: cwd, featureBranch: "feature", targetBranch: "target", featureOid: from, targetOid: target,
      selection: { kind: "commits", commitOids: [from, to] },
      ...(diff ? { diff: { fromTreeOid: from, toTreeOid: to, patch, hasBinaryChanges: binary } } : {}),
    } });
    ids.push(record.id);
    if (anchor) manager.appendCustomEntry("pi-web:git-action", { version: 1, actionId: record.id });
    return record;
  };
  const run = (params, caller = ctx, signal) => tool.execute("artifact-call", params, signal, undefined, caller);
  const assertReadOnly = () => {
    for (const spy of [...forbidden, getActiveTools, appendEntry, uiAccess]) assert.equal(spy.mock.callCount(), 0);
  };
  const retain = async record => {
    const completed = await journal.transitionGitAction(record.id, record.revision, { state: "succeeded" });
    releaseGitAction(record.id); // Force actual lazy retained reads, not the live map.
    assert.equal(completed.decision, undefined, "captured review is not human approval");
    assert.equal((await readGitAction(record.id)).candidate, undefined);
    assert.ok((await readGitAction(record.id, { includeArtifact: true })).candidate);
    assert.equal(fs.existsSync(path.join(historyDir, "pi-web/git-actions/v1", record.id)), false);
  };
  const legacy = async record => {
    const { candidate } = await readGitAction(record.id, { includeArtifact: true });
    const files = writeLegacyGitActionFixture(historyDir, record, candidate); releaseGitAction(record.id); return files;
  };
  return { root, cwd, manager, tool, ctx, roots, create, retain, legacy, run, assertReadOnly, from, to, target };
}

function assertArtifactError(response, status) {
  assert.equal(response.isError, true);
  assert.equal(response.details.status, status);
  assert.deepEqual(Object.keys(response.details).sort(), ["error", "status"]);
  assert.deepEqual(JSON.parse(response.content[0].text), response.details);
  assert.doesNotMatch(JSON.stringify(response), /agent-artifact-tool-|wrong-mutation-root|private|secret|candidate.json|ENOENT/);
}

test("artifact registered tool requires strict bounded arguments; selectors and other operation fields cannot be ignored", async (t) => {
  const f = await artifactFixture(t), a = await f.create("é😀x"), request = { operation: "artifact", actionId: a.id, offset: 0 };
  assert.ok(f.tool.parameters.properties.operation.enum.includes("artifact"));
  assert.equal(f.tool.parameters.properties.limitBytes.maximum, 24 * 1024);
  assert.match(f.tool.description, /artifact.*nextOffset.*SHA-256.*completePatch/);
  const extraFields = ["repositoryPath", "checkoutPath", "workspaceBranch", "targetBranch", "commitOids", "paths", "mode", "message",
    "confirmation", "checks", "scope", "changes", "sessionId", "sessionID", "sessionFile", "fileRoot", "cwd", "agentDir", "authorizeRoot", "callback", "filename", "includeArtifact", "receiptId", "grant"];
  for (const field of extraFields) for (const value of [undefined, "secret"]) {
    assertArtifactError(await f.run({ ...request, [field]: value }), "invalid-request");
  }
  for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", 1, 3, 4, 5, 8]) {
    assertArtifactError(await f.run({ ...request, offset }), "invalid-request");
  }
  for (const limitBytes of [-1, 0, 3, 4.5, NaN, Infinity, 24577, "4", undefined]) {
    assertArtifactError(await f.run({ ...request, limitBytes }), "invalid-request");
  }
  for (const input of [{ operation: "artifact", offset: 0 }, { operation: "artifact", actionId: a.id },
    { ...request, actionId: "../secret" }, { ...request, [Symbol("extra")]: true },
    Object.defineProperty({ ...request }, "secret", { value: true }), Object.create(request),
    Object.defineProperty({ ...request }, "actionId", { enumerable: true, get() { throw new Error("secret"); } })]) {
    assertArtifactError(await f.run(input), "invalid-request");
  }
  const wrongOperation = await f.run({ operation: "status", actionId: a.id, offset: 0 },
    { cwd: f.cwd, sessionManager: f.manager, hasUI: false, ui: {} });
  assert.equal(wrongOperation.isError, true);
  assert.match(wrongOperation.details.error, /Unsupported Git workflow arguments/);
  f.assertReadOnly();
});

test("artifact registered tool paginates exact Unicode and binary captured text without UI, settings gates or mutation authority", async (t) => {
  const f = await artifactFixture(t);
  appendManagedSessionGitWorkflow(f.manager, {}, { kind: "managed", settings: resolveGitWorkflowSettings({ enabled: false, commits: "off" }).values });
  const patch = "a".repeat(24575) + "😀é漢\r\n".repeat(6000), a = await f.create(patch, { binary: true });
  await f.retain(a);
  const recordPath = path.join(historyDir, "git-diagnostics-v2", `${a.id}.action`), before = await readFile(recordPath);
  const artifactPath = path.join(historyDir, "git-diagnostics-v2", `${a.id}.artifact`), artifactBefore = await readFile(artifactPath);
  const entries = JSON.stringify(f.manager.getEntries());
  let offset = 0, reconstructed = "", pages = 0;
  for (;;) {
    const response = await f.run({ operation: "artifact", actionId: a.id, offset }), details = response.details, p = details.patch;
    assert.equal(response.isError, undefined, JSON.stringify(response));
    assert.equal(details.status, "ok"); assert.deepEqual(JSON.parse(response.content[0].text), details);
    assert.ok(p.returnedBytes <= 24576); assert.equal(p.returnedBytes, Buffer.byteLength(p.text));
    assert.equal(p.text, Buffer.from(p.text).toString("utf8"));
    assert.equal(p.sha256, createHash("sha256").update(patch).digest("hex"));
    assert.equal(p.totalBytes, Buffer.byteLength(patch)); assert.equal(p.hasBinaryChanges, true);
    assert.equal(p.fromTreeOid, f.from); assert.equal(p.toTreeOid, f.to);
    assert.equal(p.completePatch, offset === 0 && p.end);
    assert.equal(details.attribution.sessionId, a.sessionId);
    assert.equal(details.candidate.featureOid, f.from); assert.equal(details.candidate.targetOid, f.target);
    assert.deepEqual(details.candidate.selection, { kind: "commits", commitOids: [f.from, f.to] });
    for (const key of ["record", "intended", "outcome", "grant", "receipt", "decision", "processId"]) assert.equal(details[key], undefined);
    reconstructed += p.text; pages++;
    if (p.end) { assert.equal(p.nextOffset, null); break; }
    assert.equal(p.nextOffset, offset + p.returnedBytes); assert.ok(p.nextOffset > offset);
    offset = p.nextOffset;
  }
  assert.ok(pages > 1); assert.equal(reconstructed, patch);
  const short = await f.run({ operation: "artifact", actionId: a.id, offset: 0, limitBytes: 4 });
  assert.equal(short.details.patch.text, "aaaa"); assert.equal(short.details.patch.completePatch, false);
  assert.deepEqual(await readFile(recordPath), before); assert.deepEqual(await readFile(artifactPath), artifactBefore);
  assert.equal(JSON.stringify(f.manager.getEntries()), entries);
  f.assertReadOnly();
});

test("artifact registered tool denies guessed/unreferenced/foreign actions and unauthorized or mismatched current sessions", async (t) => {
  const f = await artifactFixture(t), a = await f.create(), unreferenced = await f.create("secret", { anchor: false });
  const request = { operation: "artifact", actionId: a.id, offset: 0 };
  assertArtifactError(await f.run({ ...request, actionId: randomUUID() }), "denied");
  assertArtifactError(await f.run({ ...request, actionId: unreferenced.id }), "denied");
  const other = SessionManager.create(f.cwd, path.join(f.root, "other-sessions"));
  other.appendMessage({ role: "user", content: "other", timestamp: 1 });
  other.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: 2 });
  assertArtifactError(await f.run(request, { cwd: f.cwd, hasUI: false, sessionManager: other }), "denied");
  f.roots.clear();
  assert.equal(fileAccess.getKnownAllowedFileRoots().size, 0, "cold unadmitted cwd cannot self-authorize from its saved header");
  assertArtifactError(await f.run(request), "denied");
  f.roots.add(f.cwd);
  assertArtifactError(await f.run(request, { cwd: "/wrong", sessionManager: f.manager }), "denied");
  assertArtifactError(await f.run(request, { cwd: f.cwd, sessionManager: SessionManager.inMemory(f.cwd) }), "denied");
  const mismatched = { getHeader: () => ({ id: "wrong", cwd: f.cwd }), getSessionId: () => f.manager.getSessionId(),
    getCwd: () => f.cwd, isPersisted: () => true, getSessionFile: () => f.manager.getSessionFile(), getEntries: () => f.manager.getEntries() };
  assertArtifactError(await f.run(request, { cwd: f.cwd, sessionManager: mismatched }), "denied");
  const valid = await f.run(request);
  assert.equal(valid.details.patch.text, "+captured\n"); assert.equal(valid.details.patch.completePatch, true);
  // The actual SDK tool context has ReadonlySessionManager, not isPersisted().
  const facade = Object.fromEntries(["getHeader", "getSessionId", "getCwd", "getSessionFile", "getEntries", "getLeafId"]
    .map((name) => [name, f.manager[name].bind(f.manager)]));
  const readonly = await f.run(request, { cwd: f.cwd, sessionManager: facade, hasUI: false });
  assert.deepEqual(readonly.details, valid.details);
  assertArtifactError(await f.run(request, { cwd: f.cwd, sessionManager: { ...facade, getSessionFile: () => undefined } }), "denied");
  assertArtifactError(await f.run(request, { cwd: f.cwd, sessionManager: { ...facade, isPersisted: () => false } }), "denied");
  f.assertReadOnly();
});

test("artifact registered tool reads active raw/fork anchors after source checkout and origin session deletion", async (t) => {
  const f = await artifactFixture(t), first = f.manager.getLeafId(), a = await f.create(), anchor = f.manager.getLeafId();
  await f.retain(a);
  const kept = f.manager.appendMessage({ role: "user", content: "kept", timestamp: 3 });
  f.manager.appendCompaction("summary without any patch or action ID", kept, 100);
  const request = { operation: "artifact", actionId: a.id, offset: 0 };
  assert.equal((await f.run(request)).details.patch.text, "+captured\n");
  f.manager.branch(first);
  f.manager.appendMessage({ role: "user", content: "sibling without anchor", timestamp: 4 });
  await rm(f.cwd, { recursive: true });
  releaseGitAction(a.id);
  assertArtifactError(await f.run(request), "denied"); // Off-branch anchors do not grant reads.
  f.manager.branch(anchor);
  const original = await f.run(request);
  assert.equal(original.details.patch.text, "+captured\n");
  assert.equal(original.details.candidate.repositoryRoot, f.cwd);
  const originalFile = f.manager.getSessionFile();
  f.manager.createBranchedSession(anchor);
  assert.notEqual(f.manager.getSessionId(), a.sessionId);
  await rm(originalFile);
  const fork = await f.run(request);
  assert.deepEqual(fork.details, original.details);
  assert.equal(fork.details.attribution.sessionId, a.sessionId, "fork gets read-only origin attribution, never a new action/grant");
  f.assertReadOnly();
});

test("artifact registered tool rejects same-header session file switches/replacements during artifact I/O", async (t) => {
  for (const change of ["filename", "replacement"]) await t.test(change, async (t) => {
    const f = await artifactFixture(t), a = await f.create(), file = f.manager.getSessionFile();
    let selectedFile = file, changed = false;
    const manager = Object.fromEntries(["getHeader", "getSessionId", "getCwd", "getEntries", "getLeafId"]
      .map((name) => [name, f.manager[name].bind(f.manager)]));
    manager.getSessionFile = () => selectedFile;
    const originalRead = journal.readGitAction;
    t.mock.method(journal, "readGitAction", async (...args) => {
      const history = await originalRead(...args); // actual private artifact I/O, not a fabricated candidate
      changed = true;
      const backup = path.join(f.root, "same-header.jsonl");
      if (change === "filename") { fs.copyFileSync(file, backup); selectedFile = backup; }
      else { fs.renameSync(file, backup); fs.copyFileSync(backup, file); }
      return history; // change within the held-FD I/O window, before the helper's post-read recapture
    });
    assertArtifactError(await f.run({ operation: "artifact", actionId: a.id, offset: 0 },
      { cwd: f.cwd, sessionManager: manager, hasUI: false }), "denied");
    assert.equal(changed, true);
    f.assertReadOnly();
  });
});

test("artifact registered tool redacts missing/corrupt candidate and malformed anchors, and reports a missing captured diff honestly", async (t) => {
  const f = await artifactFixture(t), a = await f.create("secret captured patch"), b = await f.create(), noDiff = await f.create("", { diff: false });
  const oldA = await f.legacy(a), oldB = await f.legacy(b);
  const recordBefore = await readFile(oldA.record);
  assert.equal((await readGitAction(a.id)).record.state, "expired", "unfinished old history never reconstructs live authority");
  await rm(oldA.artifact);
  assertArtifactError(await f.run({ operation: "artifact", actionId: a.id, offset: 0 }), "unavailable");
  assert.deepEqual(await readFile(oldA.record), recordBefore);
  await writeFile(oldB.artifact, "secret malformed artifact");
  assertArtifactError(await f.run({ operation: "artifact", actionId: b.id, offset: 0 }), "unavailable");
  assert.equal(await readFile(oldB.artifact, "utf8"), "secret malformed artifact", "legacy reads never repair old corruption");
  await f.legacy(noDiff);
  const missingDiff = await f.run({ operation: "artifact", actionId: noDiff.id, offset: 0 });
  assert.equal(missingDiff.isError, undefined); assert.equal(missingDiff.details.patch, null);
  assert.match(missingDiff.details.unavailable, /No patch was captured/);
  const c = await f.create();
  f.manager.appendCustomEntry("pi-web:git-action", { version: 1, actionId: c.id, receipt: "secret" });
  assertArtifactError(await f.run({ operation: "artifact", actionId: c.id, offset: 0 }), "denied");
  f.assertReadOnly();
});

test("artifact registered tool reports actual v2 retention expiry and corruption without reconstructing checkout content", async t => {
  const f = await artifactFixture(t), a = await f.create("+original captured only\n"); await f.retain(a);
  const { openGitDiagnosticStore } = await jiti.import("./git-diagnostic-retention.ts");
  const store = openGitDiagnosticStore(historyDir, { application: true, existingOnly: true, budgets: { artifactBytes: 0 } });
  assert.equal(store.status, "stored");
  try { assert.ok(store.store.retain().removed.artifact > 0); } finally { store.store.close(); }
  const metadata = await readGitAction(a.id), lazy = await readGitAction(a.id, { includeArtifact: true });
  assert.equal(metadata.record.id, a.id); assert.equal(metadata.candidate, undefined); assert.match(lazy.unavailable, /expired/);
  assertArtifactError(await f.run({ operation: "artifact", actionId: a.id, offset: 0 }), "unavailable");
  const b = await f.create("+another original\n"); await f.retain(b);
  const artifact = path.join(historyDir, "git-diagnostics-v2", `${b.id}.artifact`);
  await writeFile(artifact, "secret corrupt finalized envelope");
  assertArtifactError(await f.run({ operation: "artifact", actionId: b.id, offset: 0 }), "unavailable");
  assert.equal(await readFile(artifact, "utf8"), "secret corrupt finalized envelope", "reads do not repair corrupted history");
  assert.equal((await readGitAction(b.id)).record.id, b.id, "metadata does not eagerly require the artifact");
  f.assertReadOnly();
});

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

test("read-only merge and commit comparisons capture private diffs without UI, decisions or ref effects", async (t) => {
  const { dir, tool } = await fixture(t);
  await git(dir, "checkout", "-qb", "feature");
  await writeFile(path.join(dir, "a"), "private-comparison-marker\n");
  await git(dir, "add", "a");
  await git(dir, "commit", "-qm", "one");
  const featureOid = await git(dir, "rev-parse", "HEAD"), targetOid = await git(dir, "rev-parse", "target");
  let prompts = 0;
  for (const selection of [undefined, [featureOid]]) {
    const response = await tool.execute("call", { operation: "review", targetBranch: "target", ...(selection ? { commitOids: selection } : {}) },
      undefined, undefined, { ...context(dir, async () => { prompts++; throw new Error("unexpected prompt"); }), hasUI: false });
    assert.equal(response.isError, undefined, JSON.stringify(response));
    assert.equal(response.details.status, "captured");
    assert.equal(response.details.featureOid, featureOid);
    assert.equal(response.details.targetOid, targetOid);
    assert.equal(response.details.selection.kind, selection ? "commits" : "merge");
    if (selection) assert.deepEqual(response.details.selection, { kind: "commits", count: 1, firstOid: featureOid, lastOid: featureOid });
    assert.equal(response.details.fromTreeOid.length, 40);
    assert.equal(response.details.toTreeOid.length, 40);
    assert.doesNotMatch(JSON.stringify(response), /private-comparison-marker|diff --git|reviewed|approved|patch|viewed/);
    const { record, candidate } = await readGitAction(response.details.actionId, { includeArtifact: true });
    assert.equal(record.state, "succeeded");
    assert.equal(record.decision, undefined);
    assert.equal(record.revision, 2, "no awaiting-decision step");
    assert.equal(record.summary.diff, undefined);
    assert.match(candidate.diff.patch, /private-comparison-marker/);
    assert.equal(await git(dir, "rev-parse", "HEAD"), featureOid);
    assert.equal(await git(dir, "rev-parse", "target"), targetOid);
  }
  assert.equal(prompts, 0);
});

test("review action-recording failures do not claim completion, disclose patches or request approval", async (t) => {
  const { dir, tool } = await fixture(t);
  await git(dir, "checkout", "-qb", "feature");
  await writeFile(path.join(dir, "a"), "secret-review-patch\n");
  await git(dir, "add", "a"); await git(dir, "commit", "-qm", "change");
  const head = await git(dir, "rev-parse", "HEAD"), target = await git(dir, "rev-parse", "target");
  const before = managerFor(dir).getEntries().filter((e) => e.customType === "pi-web:git-action").length;
  let prompts = 0;
  const ctx = { ...context(dir, async () => { prompts++; return true; }), hasUI: false };
  const originalBegin = actions.beginGitAction;
  t.mock.method(actions, "beginGitAction", async (...args) => {
    const handle = await originalBegin(...args);
    return { get record() { return handle.record; }, release: () => handle.release(),
      update: (state, extra) => state === "succeeded" ? Promise.reject(new Error("private record write failed")) : handle.update(state, extra) };
  });
  const failed = await tool.execute("call", { operation: "review", targetBranch: "target" }, undefined, undefined, ctx);
  assert.equal(failed.isError, true);
  assert.equal(failed.details.status, "recording-unconfirmed");
  assert.match(failed.details.error, /inspect private history/i);
  assert.equal(failed.details.fromTreeOid.length, 40);
  assert.equal(failed.details.toTreeOid.length, 40);
  assert.equal(failed.details.featureOid, head);
  assert.equal(failed.details.targetOid, target);
  assert.doesNotMatch(JSON.stringify(failed), /secret-review-patch|diff --git|reviewed|approved/);
  const { record } = await readGitAction(failed.details.actionId);
  assert.equal(record.state, "blocked");
  assert.equal(record.decision, undefined);
  assert.equal(prompts, 0);
  assert.equal(await git(dir, "rev-parse", "HEAD"), head);
  assert.equal(await git(dir, "rev-parse", "target"), target);
  assert.equal(managerFor(dir).getEntries().filter((e) => e.customType === "pi-web:git-action").length, before + 1);
});

test("a post-publication review journal error reports unconfirmed recording, not a false failure or success", async (t) => {
  const { dir, tool } = await fixture(t);
  await git(dir, "checkout", "-qb", "feature");
  await writeFile(path.join(dir, "a"), "private-post-publication\n");
  await git(dir, "add", "a"); await git(dir, "commit", "-qm", "change");
  const head = await git(dir, "rev-parse", "HEAD"), target = await git(dir, "rev-parse", "target");
  const originalBegin = actions.beginGitAction;
  t.mock.method(actions, "beginGitAction", async (...args) => {
    const handle = await originalBegin(...args);
    return { get record() { return handle.record; }, release: () => handle.release(),
      update: async (state, extra) => {
        await handle.update(state, extra);
        if (state === "succeeded") throw new Error("sync failed after publication");
      } };
  });
  const response = await tool.execute("call", { operation: "review", targetBranch: "target" }, undefined, undefined,
    { ...context(dir, async () => { throw new Error("unexpected prompt"); }), hasUI: false });
  assert.equal(response.isError, true);
  assert.equal(response.details.status, "recording-unconfirmed");
  assert.equal(response.details.targetOid, target);
  assert.equal(response.details.featureOid, head);
  assert.doesNotMatch(JSON.stringify(response), /private-post-publication|diff --git|sync failed/);
  const { record } = await readGitAction(response.details.actionId);
  assert.equal(record.state, "succeeded", "a successful publication is not rolled back or falsified");
  assert.equal(record.decision, undefined);
  assert.equal(await git(dir, "rev-parse", "HEAD"), head);
  assert.equal(await git(dir, "rev-parse", "target"), target);
});

test("unavailable review journal refuses without prompting or creating a history anchor", async (t) => {
  const { dir, tool } = await fixture(t);
  await git(dir, "checkout", "-qb", "feature");
  const head = await git(dir, "rev-parse", "HEAD"), target = await git(dir, "rev-parse", "target");
  t.mock.method(actions, "gitActionSink", () => { throw new Error("private store unavailable: secret"); });
  let prompts = 0;
  const response = await tool.execute("call", { operation: "review", targetBranch: "target" }, undefined, undefined,
    { ...context(dir, async () => { prompts++; return true; }), hasUI: false });
  assert.equal(response.isError, true);
  assert.doesNotMatch(JSON.stringify(response), /private store unavailable: secret/);
  assert.equal(prompts, 0);
  assert.equal(managerFor(dir).getEntries().some((entry) => entry.customType === "pi-web:git-action"), false);
  assert.equal(await git(dir, "rev-parse", "HEAD"), head);
  assert.equal(await git(dir, "rev-parse", "target"), target);
});

async function integrationFixture(t, { savedChecks = true } = {}) {
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
  // All optional diagnostics and saved fixture preferences use disposable state.
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
  if (savedChecks) for (const cwd of [feature, target]) saveFixturePreferences(cwd, checks);
  const params = { operation: "integrate", targetBranch: "target", checks };
  const run = (ui, signal) => tool.execute("call", params, signal, undefined, {
    cwd: feature, hasUI: true, sessionManager: managerFor(feature), ui: { gitAction: ui },
  });
  return { home, feature, target, agentDir, params, run };
}

test("legacy execution cannot introduce unsaved commands or replace saved recipes, and never autosaves", async t => {
  const f = await integrationFixture(t, { savedChecks: false }), noExecution = forbidExecution(t); let prompts = 0;
  const manager = managerFor(f.feature), initial = JSON.stringify(manager.getEntries()), ask = async () => { prompts++; return true; };
  const unsaved = await f.run(ask); assert.equal(unsaved.isError, true); assert.match(unsaved.details.error, /already-saved/);
  delete f.params.checks;
  assert.equal((await f.run(ask)).isError, true, "no implicit zero-check waiver without saved recipes");
  assert.equal(JSON.stringify(manager.getEntries()), initial);
  const saved = [{ label: "original", argv: [process.execPath, "-e", "process.exit(0)"] }];
  saveFixturePreferences(f.feature, saved); const before = JSON.stringify(manager.getEntries());
  for (const checks of [[], [{ ...saved[0], argv: [process.execPath, "-e", "process.exit(27)"] }],
    [{ ...saved[0], label: "new label" }], [{ ...saved[0], env: { PRIVATE_SENTINEL: "secret" } }],
    [...saved, { label: "new sibling", argv: [process.execPath, "-e", "process.exit(0)"] }]]) {
    f.params.checks = checks; const result = await f.run(ask); assert.equal(result.isError, true); assert.match(result.details.error, /already-saved/);
    assert.equal(JSON.stringify(manager.getEntries()), before); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL|secret|process.exit/);
  }
  delete f.params.checks;
  for (const key of ["argv", "env", "guard", "nativeAuthority", "proof"]) {
    f.params[key] = "untrusted"; assert.equal((await f.run(ask)).isError, true); delete f.params[key];
  }
  saveFixturePreferences(f.feature, []);
  assert.equal((await f.run(ask)).isError, true, "saved empty recipes cannot waive verification");
  assert.equal(prompts, 0); noExecution();
});

test("legacy saved recipes work with omitted payload commands and remain exact across pending approval", async t => {
  const f = await integrationFixture(t), noExecution = forbidExecution(t), original = structuredClone(f.params.checks); delete f.params.checks;
  let prompts = 0;
  const declined = await f.run(async candidate => { prompts++; assert.deepEqual(candidate.checks, original); return false; });
  assert.equal(declined.details.approved, false); assert.equal(prompts, 1);
  const revoked = await f.run(async candidate => {
    prompts++; assert.deepEqual(candidate.checks, original);
    saveFixturePreferences(f.feature, [{ label: "replacement", argv: [process.execPath, "-e", "process.exit(1)"] }]);
    saveFixturePreferences(f.feature, original); return true;
  });
  assert.equal(revoked.isError, true); assert.equal(prompts, 2); noExecution();
});

test("unresolved foreign integration history never blocks own exact checks or native integration", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const foreign = await actions.beginGitAction(actions.gitActionSink(managerFor(f.target), appendFor(f.target)), "agent", {
    kind: "checks", repositoryRoot: f.feature, featureBranch: "feature", targetBranch: "target", checks: f.params.checks }, f.agentDir);
  await foreign.update("executing", { decision: "approved" }); t.after(() => foreign.release());
  const cards = [];
  const result = await f.run(async candidate => { cards.push(candidate.kind); return true; });
  assert.deepEqual(cards, ["checks", "integration"]);
  assert.equal(result.details.status, "integrated", JSON.stringify(result));
  assert.equal(result.details.nativeOutcome.refAcknowledged, true);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), result.details.mergeOid);
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
  saveFixturePreferences(f.target, checks);
  const previous = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = previous; });
  let otherCwd = f.feature, otherRunning = false;
  const other = { sessionId: "other", get cwd() { return otherCwd; }, isAlive: () => true, isRunning: () => otherRunning };
  globalThis.__piSessions = new Map([[other.sessionId, other]]);
  let tool;
  createAgentGitWorkflowExtension(f.target, f.agentDir).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: caller.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const cards = [];
  const ctx = context(f.target, async (candidate) => {
    cards.push(candidate);
    assert.equal(await hasNativeIndexLock(f.feature), false);
    assert.equal(await hasNativeIndexLock(f.target), false);
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
  assert.equal(record.summary.projectRoot, f.target);
  assert.equal(record.summary.sourceCheckoutRoot, f.feature);
  assert.equal(record.summary.targetCheckoutRoot, f.target);
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
    { name: "trust lookup throws synchronously at original owner capture", phase: "caller", install: (t, f, fail) => t.mock.method(trust, "getProjectTrustStatus", fail) },
    { name: "dynamic trust status getter throws at original owner capture", phase: "caller", install: (t, f, fail) => t.mock.method(trust, "getProjectTrustStatus", () => ({ get trusted() { return fail(); } })) },
    { name: "journal sink throws", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "gitActionSink", fail) },
    { name: "candidate snapshot throws", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "snapshotGitActionCandidate", fail) },
    { name: "journal creation throws synchronously", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "beginGitAction", fail) },
    { name: "journal creation rejects", phase: "journal", install: (t, f, fail) => t.mock.method(actions, "beginGitAction", async () => fail()) },
    { name: "awaiting-decision journal update rejects", phase: "journal", install: (t, f, fail) => {
      const begin = actions.beginGitAction;
      t.mock.method(actions, "beginGitAction", async (...args) => {
        const handle = await begin(...args);
        return { get record() { return handle.record; }, get candidate() { return handle.candidate; },
          get diagnostics() { return handle.diagnostics; }, get diagnosticsUnavailable() { return handle.diagnosticsUnavailable; },
          release: () => handle.release(), update: async (state, ...rest) => state === "awaiting-decision" ? fail() : handle.update(state, ...rest) };
      });
    } },
  ];
  for (const { name, phase, install } of cases) await t.test(name, async (t) => {
    const f = await integrationFixture(t);
    const noExecution = forbidExecution(t);
    const before = await git(f.target, "rev-parse", "HEAD");
    f.params.checks = [{ label: "PRIVATE_LABEL_SENTINEL", argv: ["npm", "PRIVATE_ARGV_SENTINEL"] }];
    saveFixturePreferences(f.feature, f.params.checks);
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
    assert.equal(await hasNativeIndexLock(f.feature), false);
    assert.equal(await hasNativeIndexLock(f.target), false);
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
    assert.match(result.details.error, /already-saved preferences/);
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
  assert.equal(comparison.details.status, "captured");
  assert.equal(comparison.details.cwd, f.feature);
  assert.equal(cards.length, 0, "comparison never prompts");
  const refused = await tool.execute("id", { operation: "review", workspaceBranch: "absent", targetBranch: "target" }, undefined, undefined, context);
  assert.equal(refused.isError, true);
  const result = await tool.execute("id", { ...f.params, workspaceBranch: "feature" }, undefined, undefined, context);
  assert.equal(result.details.status, "integrated");
  assert.equal(cards[0].featureCwd, f.feature);
  assert.equal(cards[0].targetCwd, f.target);
  assert.equal(cards[1].featureCwd, f.feature);
  assert.equal(cards[1].targetCwd, f.target);
  assert.equal(await hasNativeIndexLock(f.feature), false);
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
  assert.equal(recorded.record.summary.integrationMethod, "ff");
  assert.equal(recorded.record.summary.projectRoot, f.target);
  assert.equal(recorded.record.summary.sourceCheckoutRoot, f.feature);
  assert.equal(recorded.record.summary.targetCheckoutRoot, f.target);
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
  assert.equal(manager.getEntries().filter((e) => e.customType === "pi-web:agent-git-preferences").length, 0);
  const invalid = await tool.execute("call", choose, undefined, undefined, ctx(async () => ({ targetBranch: "evil", method: "merge", checks: [], cleanup: "retain", mode: "current" })));
  assert.equal(invalid.isError, true);
  assert.equal(manager.getEntries().filter((e) => e.customType === "pi-web:agent-git-preferences").length, 0);
  const saved = await tool.execute("call", choose, undefined, undefined, ctx(async () => ({ targetBranch: "target", method: "merge", checks: card.checks, cleanup: "offer", mode: "worktree" })));
  assert.equal(saved.details.preferences.cleanup, "offer");
  assert.deepEqual(card.targets, ["target"]);
  assert.equal(manager.getEntries().filter((e) => e.customType === "pi-web:agent-git-preferences").length, 1);
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
  assert.equal(overridden.isError, true); assert.match(overridden.details.error, /already-saved preferences/);
  assert.equal(cards.length, 1, "execution payload cannot replace the saved recipe or request another Ask");
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

test("agent merge uses saved preferences then separately asks for checks and an exact plan", async (t) => {
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
  assert.equal(await hasNativeIndexLock(f.target), false); // no native locks during UI wait
  const approved = await f.run(async () => {
    assert.equal(await hasNativeIndexLock(f.target), false);
    return true;
  });
  assert.equal(approved.details.status, "integrated");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), approved.details.mergeOid);
  assert.equal(await git(f.target, "rev-list", "--parents", "-n", "1", "HEAD").then((s) => s.split(" ").length), 3);
});

test("agent integration returns authentic pre-apply no-checkout facts for target movement, without retry",  async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const response = await f.run(async (candidate) => {
    if (candidate.kind === "integration") await git(f.target, "commit", "--allow-empty", "-qm", "concurrent target");
    return true;
  });
  assert.equal(response.isError, true);
  assert.equal(response.details.nativeOutcome.status, "no-checkout-effect");
  assert.equal(response.details.nativeOutcome.checkoutAttempted, false);
  assert.match(response.details.error, /No automatic retry/);
  assert.equal(await git(f.target, "show", "-s", "--format=%s", "HEAD"), "concurrent target");
  assert.equal(await hasNativeIndexLock(f.target), false);
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
  saveFixturePreferences(f.feature, f.params.checks);
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

test("Stop during an authorized check leaves no native locks and never integrates", async (t) => {
  testVerification(t);
  const f = await integrationFixture(t);
  const before = await git(f.target, "rev-parse", "HEAD");
  const marker = path.join(f.home, "actual-check-started");
  f.params.checks = [{ label: "slow", argv: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');setTimeout(() => {}, 30000)`] }];
  saveFixturePreferences(f.feature, f.params.checks);
  const controller = new AbortController();
  const poll = setInterval(() => { if (fs.existsSync(marker)) controller.abort(); }, 20);
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const result = await f.run(async () => true, controller.signal);
    assert.equal(fs.existsSync(marker), true, "cancel the actual owned command, not just preview discovery");
    assert.equal(result.isError, true);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), before);
    assert.equal(await hasNativeIndexLock(f.feature), false);
    assert.equal(await hasNativeIndexLock(f.target), false);
  } finally { clearTimeout(timer); clearInterval(poll); }
});

test("legacy integration captures its actual owner before the first awaited policy read", async t => {
  const f = await integrationFixture(t), noExecution = forbidExecution(t), real = access.assertManagedGitAction;
  let changed = false, prompts = 0;
  t.mock.method(access, "assertManagedGitAction", async (...args) => {
    const result = await real(...args);
    if (!changed) { changed = true; fixtureWriters.get(f.feature).revision += 2; }
    return result;
  });
  const result = await f.run(async () => { prompts++; return true; });
  assert.equal(changed, true); assert.equal(result.isError, true); assert.equal(prompts, 0); noExecution();
});

test("legacy integration requires actual monotonic SDK selection wiring with no live RPC fallback", async t => {
  const f = await integrationFixture(t), noExecution = forbidExecution(t); let tool, prompts = 0;
  createNativeAgentGitWorkflowExtension(f.feature, f.agentDir).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.feature), registerTool: value => { tool = value; } });
  const result = await tool.execute("missing-adapter", f.params, undefined, undefined, context(f.feature, async () => { prompts++; return true; }));
  assert.equal(result.isError, true); assert.equal(prompts, 0); noExecution();
});

test("legacy original authority change-and-restore during each Ask denies without recapture", async t => {
  const settings = await jiti.import("./git-workflow-settings-store.ts");
  for (const stage of ["checks", "integration"]) await t.test(stage, async t => {
    testVerification(t); const f = await integrationFixture(t), head = await git(f.target, "rev-parse", "HEAD"); let prompts = 0;
    const doc = settings.readGitWorkflowSettingsDocument(f.agentDir);
    const result = await f.run(async candidate => {
      prompts++;
      if (candidate.kind === stage) {
        settings.writeGitWorkflowSettingsDocument({ ...doc, projects: { ...doc.projects, [f.target]: { enabled: false } } }, f.agentDir, [{ kind: "project", projectRoot: f.target }]);
        settings.writeGitWorkflowSettingsDocument(doc, f.agentDir, [{ kind: "project", projectRoot: f.target }]);
      }
      return true;
    });
    assert.equal(result.isError, true); assert.equal(prompts, stage === "checks" ? 1 : 2); assert.equal(await git(f.target, "rev-parse", "HEAD"), head);
  });
});

test("legacy required siblings use one genuine original cohort while unrelated project updates stay neutral", async t => {
  testVerification(t); const f = await integrationFixture(t), unrelated = await integrationFixture(t);
  f.params.checks.push({ label: "second", argv: [process.execPath, "-e", "process.exit(0)"] });
  saveFixturePreferences(f.feature, f.params.checks);
  const settings = await jiti.import("./git-workflow-settings-store.ts"), doc = settings.readGitWorkflowSettingsDocument(f.agentDir);
  const result = await f.run(async candidate => {
    if (candidate.kind === "checks") settings.writeGitWorkflowSettingsDocument({ ...doc, projects: { ...doc.projects, [unrelated.target]: { commits: "manual" } } }, f.agentDir,
      [{ kind: "project", projectRoot: unrelated.target }]);
    return true;
  });
  assert.equal(result.details.status, "integrated", JSON.stringify(result));
  const runs = verification.runGitVerification.mock.calls.map(call => call.arguments[0]);
  assert.equal(runs.length, 2); assert.ok(runs[0].cohort); assert.equal(runs[0].cohort, runs[1].cohort);
  assert.deepEqual(runs.map(r => r.checkIndex), [0, 1]);
});

test("legacy final check publication await cannot restore original authority after diagnostics", async t => {
  const f = await integrationFixture(t), head = await git(f.target, "rev-parse", "HEAD"), backend = createTestContainmentBackend(); let prompts = 0, changed = false;
  t.mock.method(verification, "runGitVerification", options => runRealVerification({ ...options, testContainmentBackend: backend,
    testBeforeReceiptRegistration: async () => { changed = true; fixtureWriters.get(f.feature).revision += 2; } }));
  const result = await f.run(async () => { prompts++; return true; });
  assert.equal(changed, true); assert.equal(prompts, 1); assert.equal(result.isError, true); assert.equal(await git(f.target, "rev-parse", "HEAD"), head);
});

test("legacy exact declined native plan is retired by its original identity, never an action/history ID", async t => {
  testVerification(t); const f = await integrationFixture(t), prepare = integration.prepareIntegration; let original;
  t.mock.method(integration, "prepareIntegration", async options => original = await prepare(options));
  const result = await f.run(async candidate => candidate.kind === "checks");
  assert.equal(result.details.approved, false); assert.ok(original);
  assert.equal(integration.retireGitIntegrationPlan(structuredClone(original)), false);
  assert.equal(integration.retireGitIntegrationPlan(original), true);
  let error; try { await integration.confirmIntegration(original.planId, original.planId, managerFor(f.feature).getSessionId()); } catch (cause) { error = cause; }
  assert.ok(error); assert.equal(integration.readGitIntegrationNativeOutcome(error).status, "no-checkout-effect");
  assert.equal(integration.readGitIntegrationNativeOutcome(new Error(error.message)), undefined);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), original.review.targetOid);
});

test("legacy optional anchor and terminal history failures preserve genuine native success with bounded warnings", async t => {
  for (const fault of ["anchor", "terminal-store"]) await t.test(fault, async t => {
    testVerification(t); const f = await integrationFixture(t), root = path.join(f.agentDir, "git-diagnostics-v2"), backup = root + "-legacy-fixture";
    if (fault === "anchor") t.mock.method(managerFor(f.feature), "appendCustomEntry", () => { throw new Error("private optional anchor error"); });
    let blocked = false, result;
    try { result = await f.run(async candidate => {
      if (fault === "terminal-store" && candidate.kind === "integration") { await rename(root, backup); await writeFile(root, "blocked fixture diagnostics"); blocked = true; }
      return true;
    }); } finally { if (blocked) { await rm(root); await rename(backup, root); } }
    assert.equal(result.details.status, "integrated", JSON.stringify(result)); assert.equal(result.details.nativeOutcome.refAcknowledged, true);
    assert.equal(result.details.diagnosticsUnavailable, true); assert.equal(result.details.diagnostics.reason, "storage-unavailable");
    assert.equal(result.details.recoveryRequired, undefined); assert.doesNotMatch(JSON.stringify(result), /private optional/);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), result.details.mergeOid);
  });
});

test("legacy actual native partial checkout is never classified as a stale no-effect retry", async t => {
  testVerification(t); const f = await integrationFixture(t), prepare = integration.prepareIntegration, head = await git(f.target, "rev-parse", "HEAD");
  t.mock.method(integration, "prepareIntegration", options => prepare({ ...options, afterCheckout: () => { throw new Error("private partial fault"); } }));
  const result = await f.run(async () => true);
  assert.equal(result.isError, true); assert.equal(result.details.recoveryRequired, true); assert.equal(result.details.nativeOutcome.checkoutAttempted, true);
  assert.equal(result.details.nativeOutcome.refAcknowledged, false); assert.equal(await git(f.target, "rev-parse", "HEAD"), head);
  assert.equal(await readFile(path.join(f.target, "a"), "utf8"), "feature\n"); assert.equal(await hasNativeIndexLock(f.target), false);
  assert.doesNotMatch(JSON.stringify(result), /private partial|fresh review|before checkout effects/);
});

test("legacy lost or copied original native completion stays unknown, even when the native transaction really succeeded", async t => {
  for (const fault of ["lost", "copied"]) await t.test(fault, async t => {
    testVerification(t); const f = await integrationFixture(t), confirm = integration.confirmIntegration; let original;
    t.mock.method(integration, "confirmIntegration", async (...args) => {
      original = await confirm(...args);
      if (fault === "lost") throw new Error("private post-transaction transport error");
      return structuredClone(original);
    });
    const result = await f.run(async () => true);
    assert.equal(original.status, "integrated"); assert.equal(await git(f.target, "rev-parse", "HEAD"), original.mergeOid);
    assert.equal(result.isError, true); assert.equal(result.details.status, "partial-state"); assert.equal(result.details.recoveryRequired, true);
    assert.equal(result.details.nativeOutcome, undefined); assert.match(result.details.error, /do not retry/);
    assert.doesNotMatch(JSON.stringify(result), /private post-transaction|fresh review|before checkout effects/);
  });
});

test("legacy simultaneous same-candidate native integrations have one winner and a no-effect loser", async t => {
  testVerification(t); const f = await integrationFixture(t); let ready = 0, release;
  const barrier = new Promise(resolve => { release = resolve; }), timeout = setTimeout(release, 60_000); let result;
  try { result = await Promise.all([0, 1].map(() => f.run(async candidate => {
    if (candidate.kind === "integration") { if (++ready === 2) release(); await barrier; }
    return true;
  }))); } finally { clearTimeout(timeout); }
  assert.equal(ready, 2); const winners = result.filter(r => r.details.status === "integrated"), losers = result.filter(r => r.isError);
  assert.equal(winners.length, 1, JSON.stringify(result)); assert.equal(losers.length, 1);
  assert.equal(losers[0].details.nativeOutcome.status, "no-checkout-effect"); assert.equal(losers[0].details.nativeOutcome.checkoutAttempted, false);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), winners[0].details.mergeOid); assert.equal(await git(f.target, "status", "--porcelain"), "");
});

test("legacy extended recipe refusal is explicit and never drops stage:none or required siblings", async t => {
  const f = await integrationFixture(t), noExecution = forbidExecution(t); let prompts = 0;
  for (const extended of [{ requiredStage: "none" }, { requiredStage: "integration" }, { cwd: "." }, { env: {} }]) {
    f.params.checks = [{ label: "extended", argv: [process.execPath, "-e", "process.exit(0)"], ...extended }];
    saveFixturePreferences(f.feature, f.params.checks);
    const result = await f.run(async () => { prompts++; return true; }); assert.equal(result.isError, true); assert.match(result.details.error, /Extended check recipes/);
  }
  f.params.checks = [{ label: "ordinary", argv: [process.execPath, "-e", "process.exit(0)"] }]; f.params.confirmation = "none";
  const none = await f.run(async () => { prompts++; return true; }); assert.equal(none.isError, true);
  assert.equal(prompts, 0); noExecution();
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
  const ctx = { cwd: a.home, hasUI: false, sessionManager: caller, ui: { gitAction: async (candidate) => { shown.push(candidate); throw new Error("unexpected prompt"); } } };
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
    assert.equal(review.details.status, "captured", JSON.stringify(review));
    assert.equal(review.details.targetBranch, "target", "B's target wins; unqualified caller preferences are ignored");
    assert.equal(shown.length, 0);
    assert.equal(review.details.resources.projectRoot, b.target);
    const bHistory = await readGitAction(review.details.actionId, { includeArtifact: true });
    assert.equal(bHistory.record.summary.projectRoot, b.target);
    assert.equal(bHistory.candidate.sourceCheckoutRoot, b.feature);
    assert.equal(bHistory.candidate.targetCheckoutRoot, b.target);
    const aReview = await tool.execute("id", { operation: "review", repositoryPath: a.target,
      checkoutPath: a.feature, workspaceBranch: "feature", targetBranch: "target" }, undefined, undefined, ctx);
    assert.equal(aReview.details.status, "captured", JSON.stringify(aReview));
    const aHistory = await readGitAction(aReview.details.actionId, { includeArtifact: true });
    assert.equal(aHistory.record.summary.projectRoot, a.target);
    assert.equal(aHistory.candidate.sourceCheckoutRoot, a.feature);
    assert.equal(aHistory.candidate.targetCheckoutRoot, a.target);
    assert.equal(aHistory.candidate.featureBranch, bHistory.candidate.featureBranch);
    assert.equal(aHistory.candidate.targetBranch, bHistory.candidate.targetBranch);
  } else {
    assert.equal(review.details.code, "unsupported-platform");
    assert.equal(shown.length, 0);
  }
  assert.equal(caller.getCwd(), a.home);
  assert.equal(caller.getSessionId(), callerId);
  assert.deepEqual(await Promise.all([a.target, b.target].map((cwd) => git(cwd, "rev-parse", "HEAD"))), before);
  assert.equal(caller.getEntries().filter((e) => e.customType === "pi-web:git-action").length, process.platform === "linux" ? 2 : 0, "read-only history belongs to the unchanged caller");
});

test("selected integration rejects legacy command arguments; explicit preferences stay unavailable before UI or commands", async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  let tool, prompts = 0;
  createAgentGitWorkflowExtension(a.target).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(a.target), registerTool: (value) => { tool = value; } });
  const before = await git(b.target, "rev-parse", "HEAD");
  for (const operation of ["integrate", "preferences"]) {
    const response = await tool.execute("id", { operation, repositoryPath: b.target, workspaceBranch: "feature",
      targetBranch: "target", checks: b.params.checks, paths: ["a"], message: "Not supported yet" }, undefined, undefined,
      context(a.target, async () => { prompts++; return true; }));
    assert.equal(response.isError, true);
    if (operation === "integrate") assert.equal(response.details.code, "invalid-request");
    else assert.match(response.details.error, /project-scoped managed action is unavailable/);
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

test("fresh selected-project commit asks by default on saved Allow, supports explicit none, then honors live Deny", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { snapshotFreshManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
  const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
  const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
  snapshotFreshManagedSessionGitWorkflow(manager, resolveGitWorkflowSettings({ commits: "ask" }).values);
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
  assert.equal(journal.record.summary.projectRoot, b.target);
  assert.equal(journal.record.summary.sourceCheckoutRoot, b.feature);
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

test("selected-project none cannot upgrade old/unmarked/copied/pinned/legacy or absent callers, nor caller live Off/Manual", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
  const { snapshotFreshManagedSessionGitWorkflow, appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
  const { appendSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
  const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
  const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const selected = await selectGitProjectResources(b.target, "feature", b.feature);
  const policy = (caller = "ask") => writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {
    [a.target]: { commits: caller }, [b.target]: { commits: "ask", commitConfirmation: "none" },
  } }, historyDir);
  policy();
  await saveProjectAuthorization(selected, undefined, "project", "commit", "allow",
    await readProjectAuthorization(selected, undefined, historyDir), historyDir);
  await writeFile(path.join(b.feature, "a"), "must not be auto-committed\n");
  const before = await git(b.feature, "rev-parse", "HEAD");
  for (const kind of ["old-ask", "copied", "pinned", "legacy", "absent", "caller-off", "caller-manual"]) {
    policy(kind === "caller-off" ? "off" : kind === "caller-manual" ? "manual" : "ask");
    let manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
    const task = { kind: "managed", settings: resolveGitWorkflowSettings({ commits: "ask" }).values };
    if (["copied", "pinned", "caller-off", "caller-manual"].includes(kind)) snapshotFreshManagedSessionGitWorkflow(manager, task.settings);
    if (kind === "old-ask") appendManagedSessionGitWorkflow(manager, {}, task);
    if (kind === "legacy") appendSessionGitWorkflow(manager, { mode: "current", onCreate: "stay", commits: "agent" });
    manager.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
    if (kind === "copied") manager = SessionManager.open(SessionManager.open(manager.getSessionFile(), undefined).createBranchedSession(manager.getLeafId()), undefined);
    if (kind === "pinned") appendManagedSessionGitWorkflow(manager, {}, task);
    const current = manager;
    t.after(async () => {
      for (const entry of current.getEntries()) if (entry.customType === "pi-web:git-action") {
        await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
      }
    });
    let tool, prompts = 0;
    createAgentGitWorkflowExtension(a.target, historyDir, manager).factory({ getActiveTools: () => ["read", "edit"],
      appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
    const params = { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature, paths: ["a"], message: "exact" };
    const context = { cwd: a.target, hasUI: true, sessionManager: manager, ui: { gitAction: async () => { prompts++; return false; } } };
    const none = await tool.execute("none", { ...params, confirmation: "none" }, undefined, undefined, context);
    assert.equal(none.isError, true, `${kind}: ${JSON.stringify(none)}`);
    assert.equal(prompts, 0, kind);
    assert.equal(await git(b.feature, "rev-parse", "HEAD"), before);
    const ask = await tool.execute("ask", params, undefined, undefined, context);
    if (["old-ask", "copied", "pinned", "absent"].includes(kind)) {
      assert.equal(ask.details.approved, false, `${kind}: ${JSON.stringify(ask)}`);
      assert.equal(prompts, 1, "no prompt upgrade does not remove the eligible exact Ask route");
    } else {
      assert.equal(ask.isError, true, kind);
      assert.equal(prompts, 0, kind);
    }
    assert.equal(await git(b.feature, "rev-parse", "HEAD"), before);
  }
});

test("selected-project Ask and none preserve canonical caller Chat×A clamps, including nested cwd and late saves", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  const { snapshotFreshManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
  const { appendGitProjectSessionSettings } = await jiti.import("./git-project-session.ts");
  const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
  const native = await jiti.import("./git-commit.ts");
  const confirm = native.confirmGitCommit;
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {
    [a.target]: { enabled: true, commits: "ask" }, [b.target]: { enabled: true, commits: "ask", commitConfirmation: "none" },
  } }, historyDir);
  const selected = await selectGitProjectResources(b.target, "feature", b.feature);
  await saveProjectAuthorization(selected, undefined, "project", "commit", "allow",
    await readProjectAuthorization(selected, undefined, historyDir), historyDir);
  await writeFile(path.join(b.feature, "a"), "retain the refused candidate\n");
  const heads = [await git(a.target, "rev-parse", "HEAD"), await git(b.feature, "rev-parse", "HEAD")];
  const nested = path.join(a.target, "nested-caller");
  await mkdir(nested);
  for (const cwd of [a.target, nested]) {
    const manager = SessionManager.create(cwd, path.join(historyDir, "sessions"));
    snapshotFreshManagedSessionGitWorkflow(manager, resolveGitWorkflowSettings({ commits: "ask" }).values);
    manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
    // B's explicit permissive exception must not replace the caller's A clamp.
    appendGitProjectSessionSettings(manager, b.target, { enabled: true, commits: "ask", commitConfirmation: "none" });
    t.after(async () => {
      for (const entry of manager.getEntries()) if (entry.customType === "pi-web:git-action") {
        await rm(path.join(historyDir, "pi-web/git-actions/v1", entry.data.actionId), { recursive: true, force: true });
      }
    });
    let tool;
    createAgentGitWorkflowExtension(cwd, historyDir, manager).factory({ getActiveTools: () => ["read", "edit"],
      appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
    const params = { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature, paths: ["a"], message: "refused" };
    for (const restriction of [{ commits: "off" }, { commits: "manual" }, { enabled: false }]) {
      const save = () => appendGitProjectSessionSettings(manager, a.target, restriction);
      for (const confirmation of ["ask", "none"]) {
        save();
        let prompts = 0;
        const ctx = { cwd, sessionManager: manager, hasUI: true, ui: { gitAction: async () => { prompts++; return true; } } };
        const result = await tool.execute("initial", { ...params, confirmation }, undefined, undefined, ctx);
        assert.equal(result.isError, true, `${cwd}/${JSON.stringify(restriction)}/${confirmation}: ${JSON.stringify(result)}`);
        assert.match(result.details.error, /disabled|manual/i);
        assert.equal(prompts, 0, "caller clamp refuses before capture/approval even with B Allow");
      }
      for (const boundary of ["approval", "pre-cas"]) for (const confirmation of boundary === "approval" ? ["ask"] : ["ask", "none"]) {
        appendGitProjectSessionSettings(manager, a.target, {});
        let prompts = 0, reached = 0;
        const mock = boundary === "pre-cas" ? t.mock.method(native, "confirmGitCommit", (preview, message, beforeRef, invocation) =>
          confirm(preview, message, async (intended, ownedLock) => { reached++; save(); return beforeRef(intended, ownedLock); }, invocation)) : undefined;
        const ctx = { cwd, sessionManager: manager, hasUI: confirmation === "ask", ui: { gitAction: async () => {
          prompts++; if (boundary === "approval") save(); return true;
        } } };
        try {
          const result = await tool.execute("late", { ...params, confirmation }, undefined, undefined, ctx);
          assert.equal(result.isError, true, `${cwd}/${boundary}/${JSON.stringify(restriction)}/${confirmation}: ${JSON.stringify(result)}`);
          assert.match(result.details.error, /disabled|manual|stale|revoked/i);
          assert.equal(prompts, confirmation === "ask" ? 1 : 0, "no re-prompt after late caller revocation");
          assert.equal(reached, boundary === "pre-cas" ? 1 : 0);
        } finally { mock?.mock.restore(); }
      }
      assert.deepEqual([await git(a.target, "rev-parse", "HEAD"), await git(b.feature, "rev-parse", "HEAD")], heads);
      assert.equal(await git(b.feature, "diff", "--cached", "--name-only"), "", "refusals retain the index");
    }
  }
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

test("selected-project commit ignores foreign active diagnostics before and after its own approval", { skip: process.platform !== "linux" }, async (t) => {
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
  let tool, prompted = 0;
  const foreign = [];
  const recordForeign = async () => {
    const action = await actions.beginGitAction(actions.gitActionSink(managerFor(b.target), appendFor(b.target)), "agent", {
      kind: "checks", repositoryRoot: b.feature, featureBranch: "feature", targetBranch: "target", checks: b.params.checks }, historyDir);
    await action.update("executing", { decision: "approved" }); foreign.push(action);
  };
  t.after(() => foreign.forEach(action => action.release()));
  createAgentGitWorkflowExtension(a.target, historyDir, manager).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: manager.appendCustomEntry.bind(manager), registerTool: (value) => { tool = value; } });
  const params = { operation: "commit", repositoryPath: b.target, checkoutPath: b.feature, paths: ["a"], message: "writer test" };
  let blockAfterApproval = false;
  const ctx = { cwd: a.target, hasUI: true, sessionManager: manager, ui: { gitAction: async () => {
    prompted++;
    if (blockAfterApproval) await recordForeign();
    return true;
  } } };
  await recordForeign();
  {
    const result = await tool.execute("id", params, undefined, undefined, ctx);
    assert.equal(result.details.status, "committed", JSON.stringify(result));
  }
  assert.equal(prompted, 1);
  await writeFile(path.join(b.feature, "a"), "second independent approval\n");
  blockAfterApproval = true;
  {
    const result = await tool.execute("id", params, undefined, undefined, ctx);
    assert.equal(result.details.status, "committed", JSON.stringify(result));
    assert.equal(await git(b.feature, "rev-parse", "HEAD"), result.details.commit);
  }
  assert.equal(prompted, 2);
  assert.equal(await hasNativeIndexLock(b.feature), false);
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
  const { snapshotFreshManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
  const manager = SessionManager.create(a.target, path.join(historyDir, "sessions"));
  snapshotFreshManagedSessionGitWorkflow(manager, resolveGitWorkflowSettings({ commits: "ask" }).values);
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
  t.mock.method(commit, "confirmGitCommit", (preview, message, beforeRef, invocation) => confirm(preview, message, async (intended, ownedLock) => {
    reached++;
    await saveProjectAuthorization(selected, undefined, "project", "commit", "deny",
      await readProjectAuthorization(selected, undefined, historyDir), historyDir);
    return beforeRef(intended, ownedLock);
  }, invocation));
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
  const ledger = path.join(historyDir, "pi-web/git-operation-admission/v1", createHash("sha256").update(selected.commonDir).digest("hex"));
  assert.equal(fs.existsSync(ledger), false, "a commit owns no application reservation or durable quarantine");
});

test("inspecting B while an A comparison is captured cannot retarget A or later omitted selection", { skip: process.platform !== "linux" }, async (t) => {
  const a = await integrationFixture(t), b = await integrationFixture(t);
  await git(a.target, "branch", "only-in-A");
  let tool, prompts = 0;
  createAgentGitWorkflowExtension(a.feature).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(a.feature), registerTool: (value) => { tool = value; } });
  const ctx = { ...context(a.feature, async () => { prompts++; return true; }), hasUI: false };
  const reviewModule = await jiti.import("./git-review.ts");
  const originalDiff = reviewModule.getGitReviewDiff;
  t.mock.method(reviewModule, "getGitReviewDiff", async (...args) => {
    const other = await tool.execute("other", { operation: "status", repositoryPath: b.target, workspaceBranch: "feature" }, undefined, undefined, ctx);
    assert.equal(other.details.selection.cwd, b.feature);
    const implicit = await tool.execute("implicit", { operation: "status" }, undefined, undefined, ctx);
    assert.equal(implicit.details.cwd, a.feature);
    return originalDiff(...args);
  });
  const response = await tool.execute("review", { operation: "review", repositoryPath: a.target, workspaceBranch: "feature", targetBranch: "target" }, undefined, undefined, ctx);
  assert.equal(response.isError, undefined, JSON.stringify(response));
  assert.equal(response.details.resources.cwd, a.feature);
  const missing = await tool.execute("missing", { operation: "review", repositoryPath: b.target, workspaceBranch: "feature", targetBranch: "only-in-A" }, undefined, undefined, ctx);
  assert.equal(missing.isError, true);
  assert.equal(prompts, 0);
});

test("selected review refuses a vanished physical source before publishing an action", { skip: process.platform !== "linux" }, async (t) => {
  const f = await integrationFixture(t);
  let tool;
  createAgentGitWorkflowExtension(f.target).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const originalSnapshot = actions.snapshotGitActionCandidate;
  t.mock.method(actions, "snapshotGitActionCandidate", (...args) => {
    const snapshot = originalSnapshot(...args);
    renameSync(f.feature, path.join(f.home, "feature-removed"));
    return snapshot;
  });
  const response = await tool.execute("id", { operation: "review", repositoryPath: f.target,
    checkoutPath: f.feature, targetBranch: "target" }, undefined, undefined,
  { ...context(f.target, async () => { throw new Error("unexpected prompt"); }), hasUI: false });
  assert.equal(response.isError, true);
  assert.notEqual(response.details.status, "captured");
  assert.equal(managerFor(f.target).getEntries().some((entry) => entry.customType === "pi-web:git-action"), false);
});

test("selected review records a blocker when its source path becomes a different repository after anchoring", { skip: process.platform !== "linux" }, async (t) => {
  const f = await integrationFixture(t);
  let tool;
  createAgentGitWorkflowExtension(f.target).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const originalBegin = actions.beginGitAction;
  t.mock.method(actions, "beginGitAction", async (...args) => {
    const handle = await originalBegin(...args);
    await rename(f.feature, path.join(f.home, "original-feature"));
    await git(f.home, "init", "-q", "-b", "feature", f.feature);
    return handle;
  });
  const response = await tool.execute("id", { operation: "review", repositoryPath: f.target,
    checkoutPath: f.feature, targetBranch: "target" }, undefined, undefined,
  { ...context(f.target, async () => { throw new Error("unexpected prompt"); }), hasUI: false });
  assert.equal(response.isError, true);
  assert.notEqual(response.details.status, "captured");
  const anchor = managerFor(f.target).getEntries().findLast((entry) => entry.customType === "pi-web:git-action");
  assert.ok(anchor);
  const { record } = await readGitAction(anchor.data.actionId);
  assert.equal(record.state, "blocked");
  assert.equal(record.summary.projectRoot, f.target, "captured history never retargets to the new repository");
  assert.equal(record.summary.sourceCheckoutRoot, f.feature);
});

test("explicit review detects selection changing after capture without inventing a review decision", { skip: process.platform !== "linux" }, async (t) => {
  const f = await integrationFixture(t);
  let tool;
  createAgentGitWorkflowExtension(f.target).factory({ getActiveTools: () => ["read", "edit"], appendEntry: appendFor(f.target), registerTool: (value) => { tool = value; } });
  const originalBegin = actions.beginGitAction;
  t.mock.method(actions, "beginGitAction", async (...args) => {
    const handle = await originalBegin(...args);
    await git(f.feature, "branch", "-m", "changed");
    return handle;
  });
  const response = await tool.execute("id", { operation: "review", repositoryPath: f.target, workspaceBranch: "feature", targetBranch: "target" }, undefined, undefined,
    { ...context(f.target, async () => { throw new Error("unexpected prompt"); }), hasUI: false });
  assert.equal(response.isError, true);
  assert.equal(response.details.code, "selection-changed");
  const anchor = managerFor(f.target).getEntries().findLast((entry) => entry.customType === "pi-web:git-action");
  const { record } = await readGitAction(anchor.data.actionId);
  assert.equal(record.state, "blocked");
  assert.equal(record.decision, undefined);
});
