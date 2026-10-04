import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { existsSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: true });
const { POST } = await jiti.import("./route.ts");
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { readGitAction, readLiveGitAction, createGitAction, subscribeGitActionUpdates, transitionGitAction, releaseGitAction } = await jiti.import("../../../../lib/git-action-journal.ts");
const { beginGitAction, gitActionSink } = await jiti.import("../../../../lib/git-action-controller.ts");
const { AgentSessionWrapper } = await jiti.import("../../../../lib/rpc-manager.ts");
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
  // Each disposable repository owns its journal/ledger; no live data touched.
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
  const actions = () => Promise.all(["pi-web/git-actions/v1", "git-diagnostics-v2"].map((relative) =>
    readdir(join(agentDir, relative)).then((names) => names.sort()).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })));
  const before = await actions();
  try { assert.equal((await post(previewRequest(id))).status, 403); }
  finally { globalThis.__piAllowedRootsCache = old; }
  assert.deepEqual(await actions(), before);
});
test("initial optional namespace or real anchor failure preserves the full browser preview and native commit with notice", async (t) => {
  for (const fault of ["namespace", "anchor"]) await t.test(fault, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "exact preview without optional history\n");
    const before = (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim();
    const index = await readFile(join(f.cwd, ".git/index"));
    let attempts = 0, mock;
    if (fault === "namespace") await writeFile(join(agentDir, "git-diagnostics-v2"), "not a directory");
    else {
      const append = fs.appendFileSync;
      mock = t.mock.method(fs, "appendFileSync", (file, data, ...args) => {
        if (file === f.sm.getSessionFile() && String(data).includes("pi-web:git-action")) {
          attempts++; throw Object.assign(new Error("private anchor storage failure"), { code: "ENOSPC" });
        }
        return append(file, data, ...args);
      });
      syncBuiltinESMExports();
    }
    let candidate;
    try {
      const preview = await post(previewRequest(f.id));
      assert.equal(preview.status, 200, await preview.clone().text()); candidate = await preview.json();
    } finally { mock?.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(candidate.preview.head, before); assert.match(candidate.candidateDiff.patch, /\+exact preview without optional history/);
    assert.equal(candidate.candidateDiff.toTreeOid, candidate.preview.tree);
    assert.equal(candidate.diagnosticsUnavailable, true);
    assert.deepEqual(candidate.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
    assert.match(candidate.diagnosticWarning, /preview captured; diagnostics unavailable/i);
    assert.equal(candidate.recoveryRequired, undefined);
    assert.deepEqual(await readFile(join(f.cwd, ".git/index")), index);
    if (fault === "anchor") { assert.equal(attempts, 1); assert.equal(anchors(f.sm).length, 0); }
    const response = await post(confirmRequest(f.id, candidate));
    assert.equal(response.status, 200, await response.clone().text()); const result = await response.json();
    assert.equal(result.status, "committed"); assert.equal(result.diagnosticsUnavailable, true);
    assert.equal(result.diagnostics.reason, "storage-unavailable", "storage failure outranks any retention omission");
    assert.equal(result.recoveryRequired, undefined); assert.doesNotMatch(JSON.stringify(result), /uncertain|refresh|retry|ENOSPC|private anchor/);
    assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
    assert.equal(result.tree, candidate.preview.tree); assert.deepEqual(result.parents, [before]);
    assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
  });
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

test("another active session does not veto an exact browser commit, consumed once", async (t) => {
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
  assert.equal((await (await post(confirmRequest(f.id, candidate))).json()).status, "committed");
  assert.equal((await history(candidate.actionId)).record.state, "succeeded");
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409, "the same exact candidate is consumed once");
  emit({ type: "tool_execution_end", toolCallId: "unsafe" });
});

test("another unresolved check ledger does not veto an eligible commit; own stale native candidate still rejects", async (t) => {
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
  const legacy = join(agentDir, "pi-web/git-operation-admission/v1", createHash("sha256").update(resource).digest("hex"));
  await mkdir(legacy, { recursive: true, mode: 0o700 });
  const oldFile = join(legacy, `${randomUUID()}.json`), oldBytes = JSON.stringify({ state: "unresolved", kind: "checks", service: "old-service" });
  await writeFile(oldFile, oldBytes, { mode: 0o600 });
  const first = await post(confirmRequest(f.id, a));
  assert.equal(first.status, 200, await first.clone().text());
  const result = await first.json();
  assert.equal(result.status, "committed");
  const stale = await post(confirmRequest(second.getSessionId(), b));
  assert.equal(stale.status, 409, "the other old HEAD candidate cannot reuse its approval on the new HEAD");
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
  assert.equal(await readFile(oldFile, "utf8"), oldBytes, "inert legacy data is neither a veto nor rewritten");

});

test("released old executing diagnostics cannot veto or authorize a fresh candidate", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "uncommitted\n");
  const original = await (await post(previewRequest(f.id))).json();
  const snapshot = readLiveGitAction(f.id, original.actionId, { includeArtifact: true }).candidate;
  // Explicit legacy low-level history fixture: never a native invocation proof.
  const old = await createGitAction({ sessionId: f.id, source: "human", candidate: snapshot });
  await transitionGitAction(old.id, old.revision, { state: "executing", decision: "approved" });
  releaseGitAction(old.id); // simulate a prior process exiting without a ledger
  const next = await (await post(previewRequest(f.id))).json();
  const response = await post(confirmRequest(f.id, next));
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.status, "committed");
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
  assert.equal((await history(old.id)).record, null, "released unfinished display is not reconstructed as native evidence");
});

test("malformed legacy ledger cannot veto an otherwise eligible browser commit", async (t) => {
  const f = await fixture(t);
  const common = realpathSync(join(f.cwd, ".git"));
  const ledger = join(agentDir, "pi-web/git-operation-admission/v1", createHash("sha256").update(common).digest("hex"));
  await mkdir(ledger, { recursive: true, mode: 0o700 });
  await writeFile(join(ledger, `${randomUUID()}.json`), "not a ledger", { mode: 0o600 });
  await writeFile(join(f.cwd, "a"), "eligible despite malformed unrelated history\n");
  const preview = await post(previewRequest(f.id));
  assert.equal(preview.status, 200, await preview.clone().text());
  const candidate = await preview.json();
  const response = await post(confirmRequest(f.id, candidate));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).status, "committed");
});

test("first allowed-roots await cannot rebaseline real wrapper authority for preview or confirmation", async (t) => {
  const f = await fixture(t), previousSessions = globalThis.__piSessions;
  let tools = ["read", "edit"];
  const inner = { sessionId: f.id, sessionFile: f.sm.getSessionFile(), sessionManager: f.sm,
    settingsManager: SettingsManager.create(f.cwd, agentDir), getActiveToolNames: () => tools,
    setActiveToolsByName: (names) => { tools = [...names]; }, dispose() {}, agent: { state: {} } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
  globalThis.__piSessions = new Map([[f.id, wrapper]]);
  const hookKey = Symbol.for("pi-web:test-commit-first-roots-await");
  const previousHook = globalThis[hookKey];
  const shim = join(agentDir, "commit-first-roots-await.ts");
  const realAccess = new URL("../../../../lib/file-access.ts", import.meta.url).pathname;
  // Intercept only the route's awaited roots lookup. All root validation and
  // authority readers remain real; no guard or revision is replaced.
  await writeFile(shim, `export * from ${JSON.stringify(realAccess)};
import { getAllowedFileRoots as read } from ${JSON.stringify(realAccess)};
export async function getAllowedFileRoots() {
  const roots = await read();
  await globalThis[Symbol.for("pi-web:test-commit-first-roots-await")]?.();
  return roots;
}
`);
  const injectedJiti = createJiti(import.meta.url, { alias: { "@/lib/file-access": shim, "@": process.cwd() }, interopDefault: true, moduleCache: false });
  try {
    const { POST: injectedPOST } = await injectedJiti.import("./route.ts");
    const request = (body) => injectedPOST(new Request("http://localhost/api/git/commit", { method: "POST", body: JSON.stringify(body) }));
    await writeFile(join(f.cwd, "a"), "original preview authority\n");
    const head = (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim();
    const index = await readFile(join(f.cwd, ".git/index"));
    let calls = 0, mutations = 0;
    const injectFirst = () => {
      calls = 0;
      globalThis[hookKey] = async () => {
        if (++calls !== 1) return;
        const before = wrapper.readGitCheckAuthorityRevisionSync();
        inner.setActiveToolsByName(["read"]);
        await Promise.resolve();
        inner.setActiveToolsByName(["read", "edit"]);
        assert.notEqual(wrapper.readGitCheckAuthorityRevisionSync(), before);
        mutations++;
      };
    };
    const unchanged = async () => {
      assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), head);
      assert.deepEqual(await readFile(join(f.cwd, ".git/index")), index);
      assert.equal(existsSync(join(f.cwd, ".git/index.lock")), false);
    };
    injectFirst();
    const refusedPreview = await request(previewRequest(f.id));
    assert.equal(mutations, 1, "the first route roots await used the real monotonic writer");
    assert.equal(refusedPreview.status, 409, await refusedPreview.clone().text());
    assert.equal(anchors(f.sm).length, 0, "a revoked request must not publish a new preview");
    await unchanged();

    delete globalThis[hookKey];
    const previewResponse = await request(previewRequest(f.id));
    assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
    const candidate = await previewResponse.json();
    injectFirst();
    const refusedConfirm = await request(confirmRequest(f.id, candidate));
    assert.equal(mutations, 2);
    assert.equal(refusedConfirm.status, 409, await refusedConfirm.clone().text());
    await unchanged();
    delete globalThis[hookKey];
    assert.equal((await request(confirmRequest(f.id, candidate))).status, 409, "restored values cannot revive the original preview");
    await unchanged();
  } finally {
    if (previousHook === undefined) delete globalThis[hookKey]; else globalThis[hookKey] = previousHook;
    wrapper.destroy(); globalThis.__piSessions = previousSessions;
  }
});

test("real mutable wrapper change-and-restore during human wait or awaited intent revokes the ORIGINAL authority", async (t) => {
  for (const phase of ["human-wait", "native-intent"]) {
    const f = await fixture(t), previous = globalThis.__piSessions;
    let tools = ["read", "edit"];
    const inner = { sessionId: f.id, sessionFile: f.sm.getSessionFile(), sessionManager: f.sm,
      settingsManager: SettingsManager.create(f.cwd, agentDir), getActiveToolNames: () => tools, setActiveToolsByName: (names) => { tools = [...names]; },
      dispose() {}, agent: { state: {} } };
    const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
    globalThis.__piSessions = new Map([[f.id, wrapper]]);
    let off;
    try {
      await writeFile(join(f.cwd, "a"), `original ${phase}\n`);
      const response = await post(previewRequest(f.id));
      assert.equal(response.status, 200, await response.clone().text());
      const candidate = await response.json();
      const changeAndRestore = () => { inner.setActiveToolsByName(["read"]); inner.setActiveToolsByName(["read", "edit"]); };
      if (phase === "human-wait") changeAndRestore();
      else off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
        if (actionId !== candidate.actionId) return;
        const record = readLiveGitAction(f.id, actionId)?.record;
        if (record?.state === "executing") changeAndRestore();
      });
      const refused = await post(confirmRequest(f.id, candidate));
      assert.equal(refused.status, 409, await refused.clone().text());
      assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
      off?.(); off = undefined;
      const fresh = await (await post(previewRequest(f.id))).json();
      assert.equal((await (await post(confirmRequest(f.id, fresh))).json()).status, "committed");
    } finally { off?.(); wrapper.destroy(); globalThis.__piSessions = previous; }
  }
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
    const record = readLiveGitAction(f.id, actionId)?.record;
    if (!record?.intended?.commit) return;
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
  const expired = await history(candidate.actionId);
  assert.ok(!expired.record || expired.record.state === "expired", "released optional history cannot revive approval");
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
    const record = readLiveGitAction(f.id, actionId)?.record;
    if (record?.state === "executing" && record.intended) { observed = record.intended; controller.abort(new Error("PRIVATE_CANCEL_REASON")); }
  });
  try {
    const response = await post(confirmRequest(f.id, candidate), controller.signal);
    assert.equal(response.status, 409);
    const result = await response.json();
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANCEL_REASON|uncertain/);
    assert.equal(result.error, "Commit cancelled; no commit was made");
    assert.equal(result.recoveryRequired, undefined);
  }
  finally { off(); }
  assert.ok(observed.commit);
  assert.equal(observed.tree, candidate.preview.tree);
  assert.equal((await history(candidate.actionId)).record.state, "cancelled");
  assert.equal((await history(candidate.actionId)).record.outcome, undefined);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
});

test("optional final recording storage failure reports native success and a warning without retry or quarantine", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "native success despite optional storage failure\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const actionDir = join(agentDir, "git-diagnostics-v2");
  const savedDir = `${actionDir}.storage-fault`;
  const bin = await mkdtemp(join(tmpdir(), "pi-web-commit-recording-fault-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  // Real ENOTDIR in record(), AFTER successful native CAS, not a mocked
  // success/error receipt. The original diagnostic directory is restored only
  // after the HTTP response; no native effect or proof is reconstructed.
  await writeFile(join(bin, "git"), `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; mv "${actionDir}" "${savedDir}" && printf '%s' 'unavailable diagnostic storage' > "${actionDir}"; exit $? ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(join(bin, "git"), 0o755);
  const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirmRequest(f.id, candidate)); }
  finally {
    process.env.PATH = oldPath;
    if (existsSync(savedDir)) { await rm(actionDir, { force: true }); await rename(savedDir, actionDir); }
  }
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.status, "committed"); assert.equal(result.diagnosticsUnavailable, true);
  assert.match(result.recoveryWarning, /diagnostics unavailable.*do not repeat/i);
  assert.equal(result.recoveryRequired, undefined, "missing diagnostics are not native uncertainty or quarantine");
  assert.doesNotMatch(JSON.stringify(result), /refresh|retry|ENOTDIR|storage-fault/);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD^{tree}"])).stdout.trim(), candidate.preview.tree);
  assert.deepEqual(result.parents, [candidate.preview.head]);
  assert.equal((await history(candidate.actionId)).record, null, "lost optional output is not reconstructed from current Git state");
  assert.deepEqual(result.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  assert.equal(existsSync(join(f.cwd, ".git/index.lock")), false);
  assert.equal(existsSync(join(agentDir, "pi-web/git-operation-admission")), false);
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409, "never repeat the consumed invocation");
  await writeFile(join(f.cwd, "a"), "new independently approved candidate\n");
  const next = await (await post(previewRequest(f.id))).json();
  const nextResult = await (await post(confirmRequest(f.id, next))).json();
  assert.equal(nextResult.status, "committed"); assert.equal(nextResult.diagnosticsUnavailable, undefined);
});

test("missing optional candidate diagnostics and post-apply recording failure preserve actual native success", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "journal failure\n");
  await writeFile(join(agentDir, "git-diagnostics-v2"), "optional namespace unavailable");
  const unavailable = await (await post(previewRequest(f.id))).json();
  assert.equal(unavailable.diagnosticsUnavailable, true);
  assert.deepEqual(unavailable.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  assert.match(unavailable.candidateDiff.patch, /\+journal failure/);
  const confirmed = await post(confirmRequest(f.id, unavailable));
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  const measured = await confirmed.json();
  assert.equal(measured.status, "committed");
  assert.equal(measured.recoveryRequired, undefined);
  assert.equal(measured.diagnosticsUnavailable, true);
  assert.match(measured.recoveryWarning, /do not repeat/i);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), measured.commit);
  assert.equal((await post(confirmRequest(f.id, unavailable))).status, 409);
  const clean = await fixture(t);
  await writeFile(join(clean.cwd, "a"), "journal failure\n");
  const candidate = await (await post(previewRequest(clean.id))).json();
  // Fault actual POST-CAS recording: the outcome must still be native success.
  const bin = await mkdtemp(join(tmpdir(), "pi-web-post-cas-journal-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim(), wrapper = join(bin, "git");
  const recordPath = join(agentDir, "git-diagnostics-v2");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; mv "${recordPath}" "${recordPath}.unavailable"; printf '%s' 'injected journal failure' > "${recordPath}"; exit 0 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirmRequest(clean.id, candidate)); }
  finally { process.env.PATH = oldPath; }
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "committed");
  assert.equal(result.actionId, candidate.actionId);
  assert.equal(result.recoveryRequired, undefined);
  assert.equal(result.diagnosticsUnavailable, true);
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

test("optional intent diagnostics failure permits CAS but late access revocation prevents it", async (t) => {
  for (const fault of ["journal", "revocation"]) {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), `${fault}\n`);
    const candidate = await (await post(previewRequest(f.id))).json();
    const roots = globalThis.__piAllowedRootsCache;
    let injected = false;
    const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
      if (actionId !== candidate.actionId || injected) return;
      const record = readLiveGitAction(f.id, actionId)?.record;
      if (record?.state !== "executing") return;
      // Execution is now first recorded with the native prepared intent. Fault
      // the captured artifact at that actual callback, not a removed premature
      // executing-without-intent UI bookkeeping phase.
      if (fault === "journal" && record.intended) {
        const root = join(agentDir, "git-diagnostics-v2");
        renameSync(root, `${root}.unavailable`); writeFileSync(root, "unavailable diagnostic namespace");
        injected = true;
      } else if (fault === "revocation" && record.intended) {
        globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
        injected = true;
      }
    });
    let response;
    try { response = await post(confirmRequest(f.id, candidate)); }
    finally { off(); globalThis.__piAllowedRootsCache = roots; }
    assert.equal(injected, true);
    const result = await response.json();
    const head = (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim();
    if (fault === "revocation") {
      assert.equal(response.status, 409); assert.equal(head, candidate.preview.head);
      assert.equal((await history(candidate.actionId)).record.state, "blocked");
    } else {
      assert.equal(response.status, 200); assert.equal(result.status, "committed"); assert.equal(head, result.commit);
      assert.equal(result.recoveryRequired, undefined); assert.equal(result.diagnosticsUnavailable, true);
      assert.match(result.recoveryWarning, /do not repeat/i);
    }
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

async function duringInitialDiagnosticProbe(t, mutate, run) {
  const mkdir = fs.mkdirSync; let injected = false;
  const mock = t.mock.method(fs, "mkdirSync", (dir, ...args) => {
    const result = mkdir(dir, ...args);
    if (!injected && String(dir).endsWith("/git-diagnostics-v2")) { injected = true; mutate(); }
    return result;
  });
  syncBuiltinESMExports();
  try { const result = await run(); assert.equal(injected, true); return result; }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
}

test("anchor follows ordinary transcript progress, but a replacement live owner cannot refresh commit authority", async (t) => {
  const registry = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = registry; });
  for (const mode of ["disk", "new-live-wrapper"]) {
    globalThis.__piSessions = registry;
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "fresh anchor parent\n");
    let latest;
    let expectedParent;
    const response = await duringInitialDiagnosticProbe(t, () => {
      latest = SessionManager.open(f.sm.getSessionFile());
      latest.appendMessage({ role: "user", content: "ordinary concurrent transcript", timestamp: Date.now() });
      expectedParent = latest.getLeafId();
      if (mode === "new-live-wrapper") globalThis.__piSessions = new Map([...(registry ?? []), [f.id, {
        sessionId: f.id, sessionFile: f.sm.getSessionFile(), cwd: f.cwd, isAlive: () => true, isRunning: () => false,
        inner: { sessionManager: latest },
      }]]);
    }, () => post(previewRequest(f.id)));
    assert.equal(response.status, mode === "disk" ? 200 : 409, await response.clone().text());
    const candidate = await response.json();
    const [anchor] = anchors(f.sm);
    if (mode === "disk") assert.equal(anchor.data.actionId, candidate.actionId);
    else assert.equal(candidate.actionId, undefined, "unknown replacement wrapper cannot publish a fresh authority baseline");
    assert.equal(anchor.parentId, expectedParent, "append must not branch from the pre-artifact manager's parent");
    assert.equal(entries(f.sm).filter((e) => e.type === "message" && e.message.content === "ordinary concurrent transcript").length, 1);
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
    const head = (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim();
    const index = await readFile(join(f.cwd, ".git/index"));
    const file = f.sm.getSessionFile();
    const moved = `${file}.moved`;
    const source = await readFile(file, "utf8");
    if (mode === "disk-ahead-live") {
      let tools = ["read", "edit"];
      const inner = { sessionId: f.id, sessionFile: file, sessionManager: f.sm,
        settingsManager: SettingsManager.create(f.cwd, agentDir), getActiveToolNames: () => tools,
        setActiveToolsByName: names => { tools = [...names]; }, dispose() {}, agent: { state: {} } };
      const live = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
      t.after(() => live.destroy());
      globalThis.__piSessions = new Map([...(registry ?? []), [f.id, live]]);
    }
    let actionId;
    const off = subscribeGitActionUpdates(f.id, event => { actionId = event.actionId; });
    let response;
    try {
      response = await duringInitialDiagnosticProbe(t, () => {
        if (mode === "disk-ahead-live") SessionManager.open(file).appendCustomEntry("test:external", { keep: true });
        else { renameSync(file, moved); if (mode === "replaced") writeFileSync(file, source); }
      }, () => post(previewRequest(f.id)));
    } finally { off(); }
    assert.equal(response.status, 409);
    assert.ok(actionId, "fault injected after exact live capture, before anchor append");
    assert.notEqual((await history(actionId)).record?.state, "succeeded", "optional anchor warning never grants authority");
    assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), head);
    assert.deepEqual(await readFile(join(f.cwd, ".git/index")), index);
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
