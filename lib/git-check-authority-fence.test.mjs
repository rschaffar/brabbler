import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-web-human-authority-"));
let agentDir = join(home, "agent"); await mkdir(agentDir, { mode: 0o700 });
const previous = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { writeGitScopedAuthorityFile } = await jiti.import("./git-scoped-authority.ts");
beforeEach(async () => { agentDir = await mkdtemp(join(home, "authority-")); process.env.PI_CODING_AGENT_DIR = agentDir; });
const { createGitCheckAuthorityFence, registerGitCheckLiveAuthorityReader, advanceGitCheckProcessAuthorityRevision, bindHumanGitCheckReceiptAuthority } = await jiti.import("./git-check-authority-fence.ts");
const { allowFileRoot, getAllowedFileRoots } = await jiti.import("./file-access.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("./session-reader.ts");
const { AgentSessionWrapper, setRpcSessionTools, setRpcSessionAccount } = await jiti.import("./rpc-manager.ts");
const { advanceGitWorkflowWriteEpoch } = await jiti.import("./git-workflow-write-epoch.ts");
after(async () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true }); });
async function fixture(t) {
  const cwd = await mkdtemp(join(home, "checkout-"));
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], timestamp: Date.now() });
  const scope = { sessionId: sm.getSessionId(), sessionFile: sm.getSessionFile(), cwd };
  cacheSessionPath(scope.sessionId, scope.sessionFile); allowFileRoot(cwd);
  t.after(() => invalidateSessionPathCache(scope.sessionId));
  return { sm, scope, stamp: createGitCheckAuthorityFence({ scope, agentDir, checkouts: [cwd], projectRoots: [cwd] }) };
}
test("ordinary transcript/tool-result and action appends are neutral; owner workflow/tools/opt-out remain authority", async (t) => {
  const f = await fixture(t), initial = f.stamp();
  assert.equal(f.stamp(), initial);
  f.sm.appendCustomEntry("pi-web:git-action", { version: 1, actionId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(f.stamp(), initial, "recording evidence is not an authority change");
  f.sm.appendMessage({ role: "user", content: "changed transcript leaf", timestamp: Date.now() });
  assert.equal(f.stamp(), initial, "ordinary transcript progress is not a Git authority change");
  f.sm.appendMessage({ role: "toolResult", toolCallId: "fixture-check", toolName: "git_workflow", content: [{ type: "text", text: "actual check returned" }], isError: false, timestamp: Date.now() });
  assert.equal(f.stamp(), initial, "returning a check result must not invalidate that check");
  f.sm.appendCustomEntry("pi-web:tool-selection", { version: 1, toolNames: [] });
  assert.notEqual(f.stamp(), initial);
  const tools = f.stamp();
  f.sm.appendCustomEntry("pi-web:git-workflow", { version: 1, policy: null });
  assert.notEqual(f.stamp(), tools);
});
test("equal-value saved settings writes and changed-and-restored trust/grants fence the last async callback", async (t) => {
  const f = await fixture(t), initial = f.stamp();
  writeGitWorkflowSettingsDocument(readGitWorkflowSettingsDocument(agentDir), agentDir);
  assert.notEqual(f.stamp(), initial, "write epoch, not a fake constant or cached policy digest");
  const settings = f.stamp();
  writeGitWorkflowSettingsDocument(readGitWorkflowSettingsDocument(agentDir), agentDir);
  assert.notEqual(f.stamp(), settings);
  const file = join(agentDir, "trust.json");
  writeGitScopedAuthorityFile(agentDir, file, "{}", "trust"); f.stamp();
  await writeFile(file, '{"changed":true}'); await writeFile(file, "{}");
  assert.throws(f.stamp, /unaccounted/, "external restored bytes are unknown, never a new approval");
});
test("live tools and relevant allowed selection changes fence; unrelated root additions do not", async (t) => {
  const f = await fixture(t), old = globalThis.__piSessions;
  let tools = [], epoch = 0;
  const live = { isAlive: () => true, cwd: f.scope.cwd, sessionFile: f.scope.sessionFile,
    inner: { sessionManager: f.sm, getActiveToolNames: () => tools } };
  globalThis.__piSessions = new Map([[f.scope.sessionId, live]]);
  assert.throws(f.stamp, /monotonic authority adapter/, "unknown live mutation history is not a static approval");
  const unregister = registerGitCheckLiveAuthorityReader(live, () => String(epoch));
  try {
    const chatOnly = f.stamp(); epoch++; tools = ["read"]; assert.notEqual(f.stamp(), chatOnly);
    const readOnly = f.stamp(); epoch++; tools = []; epoch++; tools = ["read"];
    assert.notEqual(f.stamp(), readOnly, "in-memory change-and-restore is fenced even with identical tools");
    const before = f.stamp(); allowFileRoot(await mkdtemp(join(home, "unrelated-"))); assert.equal(f.stamp(), before);
    const roots = globalThis.__piAdditionalAllowedRoots, cache = globalThis.__piAllowedRootsCache;
    globalThis.__piAdditionalAllowedRoots = new Set(); globalThis.__piAllowedRootsCache = undefined;
    try { advanceGitCheckProcessAuthorityRevision("selection"); assert.notEqual(f.stamp(), before); }
    finally { globalThis.__piAdditionalAllowedRoots = roots; globalThis.__piAllowedRootsCache = cache; }
  } finally { unregister(); globalThis.__piSessions = old; }
});
test("P3: cache warming and redundant child roots are neutral, real permission loss/restore is monotonic", async (t) => {
  const f = await fixture(t), roots = globalThis.__piAdditionalAllowedRoots, cache = globalThis.__piAllowedRootsCache;
  try {
    globalThis.__piAdditionalAllowedRoots = new Set([home]);
    globalThis.__piAllowedRootsCache = undefined;
    const original = f.stamp();
    const anotherReader = createGitCheckAuthorityFence({ scope: f.scope, agentDir, checkouts: [f.scope.cwd], projectRoots: [f.scope.cwd] });
    assert.equal(anotherReader(), original, "equivalent readers/receipts share the original effective-root generation");
    invalidateSessionListCache(); await getAllowedFileRoots();
    assert.ok(globalThis.__piAllowedRootsCache.roots.has(f.scope.cwd), "actual cache warm discovers the persisted chat");
    f.sm.appendCustomEntry("pi-web:git-action", { version: 1, actionId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(f.stamp(), original, "parent already allows this chat; redundant discovered child is neutral");
    globalThis.__piAllowedRootsCache.expiresAt = 0;
    assert.equal(f.stamp(), original, "expiring only redundant cache entries is neutral");
    allowFileRoot(f.scope.cwd); assert.equal(f.stamp(), original);
    globalThis.__piAdditionalAllowedRoots = new Set(); globalThis.__piAllowedRootsCache = undefined;
    assert.notEqual(anotherReader(), original, "effective permission loss still fences");
    globalThis.__piAdditionalAllowedRoots = new Set([home]);
    assert.notEqual(f.stamp(), original, "deny observed by another reader then restore must not revive original authority");
    const restored = f.stamp();
    advanceGitCheckProcessAuthorityRevision("selection"); globalThis.__piAdditionalAllowedRoots = new Set();
    advanceGitCheckProcessAuthorityRevision("selection"); globalThis.__piAdditionalAllowedRoots = new Set([home]);
    assert.notEqual(f.stamp(), restored, "supported writer fences also catch an unobserved change-and-restore");
  } finally { globalThis.__piAdditionalAllowedRoots = roots; globalThis.__piAllowedRootsCache = cache; }
});

test("unproven original-cwd disappearance and restoration never waive the original fence or change saved cwd", async (t) => {
  const f = await fixture(t), original = f.stamp(), cwd = f.scope.cwd, moved = `${cwd}-removed`;
  await rename(cwd, moved);
  try {
    assert.notEqual(f.stamp(), original, "absence alone is not authenticated native cleanup progress");
    assert.equal(f.scope.cwd, cwd);
    assert.equal(f.sm.getCwd(), cwd);
    assert.equal(f.sm.getHeader().cwd, cwd);
  } finally { await rename(moved, cwd); }
  assert.notEqual(f.stamp(), original, "restoring the same directory identity cannot revive an observed revoked fence");
  assert.equal(f.sm.getCwd(), cwd);
});

test("unsafe/oversized files and thenable selection state are unknown, never synchronous approvals", async (t) => {
  const f = await fixture(t), file = join(agentDir, "trust.json");
  await rm(file, { force: true }); const target = join(home, "fake-trust"); await writeFile(target, "{}"); await symlink(target, file);
  assert.throws(f.stamp); await rm(file);
  await writeFile(file, "x".repeat(4 * 1024 * 1024 + 1)); assert.throws(f.stamp); await rm(file);
  assert.throws(createGitCheckAuthorityFence({ scope: f.scope, agentDir, checkouts: [f.scope.cwd], readSelectionStateSync: () => Promise.resolve(true) }));
  assert.throws(() => bindHumanGitCheckReceiptAuthority(f.scope, { id: "00000000-0000-0000-0000-000000000000", version: 3 }, "fabricated"), /actual native/);
});

test("saved owner-byte restore and identical live-wrapper replacement cannot resurrect an old stamp", async (t) => {
  const f = await fixture(t), { readFile } = await import("node:fs/promises"), bytes = await readFile(f.scope.sessionFile);
  const before = f.stamp();
  await writeFile(f.scope.sessionFile, bytes);
  assert.notEqual(f.stamp(), before, "an equal-byte rewrite is not an exact neutral journal append");
  const old = globalThis.__piSessions;
  const createLive = () => ({ isAlive: () => true, cwd: f.scope.cwd, sessionFile: f.scope.sessionFile,
    inner: { sessionManager: f.sm, getActiveToolNames: () => [] } });
  let revision = 0;
  const first = createLive(), second = createLive();
  const unregister = registerGitCheckLiveAuthorityReader(first, () => String(revision));
  const unregisterSecond = registerGitCheckLiveAuthorityReader(second, () => String(revision));
  try {
    globalThis.__piSessions = new Map([[f.scope.sessionId, first]]); const initial = f.stamp();
    revision++; globalThis.__piSessions.set(f.scope.sessionId, second); assert.notEqual(f.stamp(), initial);
    revision++; globalThis.__piSessions.set(f.scope.sessionId, first); assert.notEqual(f.stamp(), initial, "caller change-and-restore advances the actual writer epoch");
  } finally { unregister(); unregisterSecond(); globalThis.__piSessions = old; }
});

test("real RPC bootstrap reader follows actual SDK tool/branch writers, including failed and change-and-restore writes", async (t) => {
  const f = await fixture(t), old = globalThis.__piSessions;
  let tools = [], failNext = false;
  const inner = { sessionId: f.scope.sessionId, sessionFile: f.scope.sessionFile, sessionManager: f.sm, getActiveToolNames: () => tools,
    setActiveToolsByName(names) { if (failNext) { failNext = false; throw new Error("fixture writer failure"); } tools = [...names]; },
    settingsManager: SettingsManager.inMemory(), dispose() {}, agent: { state: {} } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
  // No test registration or made-up static stamp: the real wrapper constructor
  // registers its verified monotonic reader at the instrumented SDK writers.
  globalThis.__piSessions = new Map([[f.scope.sessionId, wrapper]]);
  try {
    const initial = f.stamp();
    inner.setActiveToolsByName(["read"]); inner.setActiveToolsByName([]);
    assert.notEqual(f.stamp(), initial);
    const beforeFailure = f.stamp(); failNext = true;
    assert.throws(() => inner.setActiveToolsByName([]), /fixture writer failure/);
    assert.notEqual(f.stamp(), beforeFailure);
    const branch = f.sm.getBranch(), beforeBranch = f.stamp();
    f.sm.branch(branch[0].id); f.sm.branch(branch.at(-1).id);
    assert.notEqual(f.stamp(), beforeBranch);
    const beforeHistory = f.stamp();
    f.sm.appendMessage({ role: "toolResult", toolCallId: "actual-check", toolName: "git_workflow", content: [{ type: "text", text: "actual measured result" }], isError: false, timestamp: Date.now() });
    assert.equal(f.stamp(), beforeHistory, "actual ordinary SDK history progression is neutral to the registered writer fence");
    const beforeAnchor = f.stamp(); f.sm.appendCustomEntry("pi-web:git-action", { version: 1, actionId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(f.stamp(), beforeAnchor, "the trusted actual action writer is neutral");
  } finally { wrapper.destroy(); globalThis.__piSessions = old; }
});

test("selection change-and-restore inside the final sync read cannot return the old revision", async (t) => {
  const f = await fixture(t); let revision = 0, mutate = false;
  const stamp = createGitCheckAuthorityFence({ scope: f.scope, agentDir, checkouts: [f.scope.cwd],
    readSelectionRevisionSync: () => String(revision), readSelectionStateSync: () => {
      if (mutate) { revision++; revision++; } return { checkout: f.scope.cwd };
    } });
  const initial = stamp(); mutate = true;
  assert.throws(stamp, /authority changed during synchronous observation/);
  mutate = false; assert.notEqual(stamp(), initial);
});

test("A survives B's actual tools/account writer, navigation, scoped settings and failed move epoch", async (t) => {
  const a = await fixture(t), b = await fixture(t), old = globalThis.__piSessions;
  const inner = { sessionId: b.scope.sessionId, sessionFile: b.scope.sessionFile, sessionManager: b.sm,
    settingsManager: SettingsManager.inMemory(), getActiveToolNames: () => ["read"], setActiveToolsByName() {}, dispose() {}, agent: { state: {} } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
  globalThis.__piSessions = new Map([[b.scope.sessionId, wrapper]]);
  const initial = a.stamp();
  wrapper.shutdown = async () => { assert.equal(a.stamp(), initial); throw new Error("fixture shutdown failure"); };
  try {
    const beforeTools = b.stamp();
    await assert.rejects(setRpcSessionTools(b.scope.sessionId, b.scope.sessionFile, undefined), /fixture shutdown failure/);
    assert.notEqual(b.stamp(), beforeTools); assert.equal(a.stamp(), initial);
    const beforeAccount = b.stamp();
    await assert.rejects(setRpcSessionAccount(b.scope.sessionId, b.scope.sessionFile, "test", null), /fixture shutdown failure/);
    assert.notEqual(b.stamp(), beforeAccount); assert.equal(a.stamp(), initial);
    const branch = b.sm.getBranch(); b.sm.branch(branch[0].id); b.sm.branch(branch.at(-1).id);
    assert.equal(a.stamp(), initial);
    const doc = readGitWorkflowSettingsDocument(agentDir); doc.projects[b.scope.cwd] = { enabled: false };
    writeGitWorkflowSettingsDocument(doc, agentDir, [{ kind: "project", projectRoot: b.scope.cwd }]);
    advanceGitWorkflowWriteEpoch(agentDir, [{ kind: "session", sessionId: b.scope.sessionId }]);
    assert.equal(a.stamp(), initial);
    advanceGitWorkflowWriteEpoch(agentDir, [{ kind: "session", sessionId: a.scope.sessionId }]);
    assert.notEqual(a.stamp(), initial);
  } finally { wrapper.destroy(); globalThis.__piSessions = old; }
});

test("foreign owner observations never evict the original invocation baseline", async (t) => {
  const a = await fixture(t), original = a.stamp();
  for (let i = 0; i < 135; i++) { const b = await fixture(t); b.stamp(); }
  assert.equal(a.stamp(), original);
});

test("actual ORIGINAL loaded SDK manager trust equal/false-to-true mutations and replacement are fenced", async (t) => {
  const f = await fixture(t), old = globalThis.__piSessions;
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
  const inner = { sessionId: f.scope.sessionId, sessionFile: f.scope.sessionFile, sessionManager: f.sm, settingsManager,
    getActiveToolNames: () => ["read"], setActiveToolsByName() {}, dispose() {}, agent: { state: {} } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
  globalThis.__piSessions = new Map([[f.scope.sessionId, wrapper]]);
  try {
    const initial = f.stamp(); settingsManager.setProjectTrusted(false); settingsManager.setProjectTrusted(true);
    assert.notEqual(f.stamp(), initial);
    const equal = f.stamp(); settingsManager.setProjectTrusted(true); assert.notEqual(f.stamp(), equal);
    inner.settingsManager = SettingsManager.inMemory(); assert.throws(f.stamp, /Original loaded/);
    inner.settingsManager = settingsManager;
    const stamp = createGitCheckAuthorityFence({ scope: f.scope, agentDir, projectRoots: [f.scope.cwd], checkouts: [f.scope.cwd],
      readSelectionRevisionSync: () => wrapper.readGitCheckAuthorityRevisionSync(), readSelectionStateSync: () => {
        settingsManager.setProjectTrusted(false); settingsManager.setProjectTrusted(true); return true;
      } });
    assert.throws(stamp, /authority changed during synchronous observation/);
  } finally { wrapper.destroy(); globalThis.__piSessions = old; }
});

test("unaccounted equal-byte grant rewrites fail closed and cannot be restored", async (t) => {
  const f = await fixture(t); f.stamp();
  const file = join(agentDir, "pi-web", "git-project-authorizations.json");
  writeGitScopedAuthorityFile(agentDir, file, "{}", "grants"); f.stamp();
  await writeFile(file, "{}"); assert.throws(f.stamp, /unaccounted/);
});
