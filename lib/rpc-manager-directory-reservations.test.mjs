import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const agentDir = mkdtempSync(join(tmpdir(), "pi-reservation-admission-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
const { assertDirectoryAdmissionAllowed } = await jiti.import("./directory-reservations.ts");
const { createTerminal } = await jiti.import("./terminal-manager.ts");
const { samePath } = await jiti.import("./paths.ts");
const source = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, options = {}) {
  const directory = mkdtempSync(join(agentDir, "directory-"));
  const descendant = join(directory, "child");
  const alias = `${directory}-alias`;
  mkdirSync(descendant);
  symlinkSync(directory, alias, "dir");
  t.after(() => rmSync(alias, { force: true }));
  const old = [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__piWebTerminals, globalThis.__piStartLocks];
  globalThis.__piSessions = new Map();
  globalThis.__piStartingSessionCwds = new Map();
  globalThis.__piWebTerminals = new Map();
  globalThis.__piStartLocks = new Map();
  t.after(() => {
    [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__piWebTerminals, globalThis.__piStartLocks] = old;
  });
  const calls = [];
  const manager = SessionManager.inMemory(descendant);
  const inner = {
    sessionId: "reservation-test", sessionManager: manager,
    isStreaming: false, isCompacting: false, isBashRunning: false, agent: { state: {} },
    settingsManager: { getShellPath: () => undefined },
    prompt: async (message, options) => { calls.push(message); options.preflightResult(); },
    executeBash: async (command) => { calls.push(command); return { output: "ok", exitCode: 0 }; },
    dispose() {}, abortBash() { calls.push("abort-bash"); },
  };
  const wrapper = new AgentSessionWrapper(inner, options);
  globalThis.__piSessions.set(inner.sessionId, wrapper);
  t.after(() => wrapper.destroy());
  return { directory, descendant, alias, wrapper, inner, calls, ui: wrapper.createExtensionUiContext() };
}

test("compact, steer and follow-up reserve admission before SDK await and release after success/failure", async (t) => {
  for (const [type, method] of [["compact", "compact"], ["steer", "steer"], ["follow_up", "followUp"]]) await t.test(type, async (st) => {
    const { directory, wrapper, inner, ui } = setup(st); let called = 0, settle;
    inner[method] = () => { called++; return new Promise((resolve) => { settle = resolve; }); };
    const release = ui.reserveDirectory(directory);
    await assert.rejects(wrapper.send({ type, message: "blocked" }), /reserved/);
    assert.equal(called, 0); assert.equal(wrapper.isRunning(), false); release();
    const execution = wrapper.send({ type, message: "admitted" });
    await nextTurn(); // steer/follow-up first await the existing extension-binding gate.
    assert.equal(called, 1); assert.equal(wrapper.isRunning(), true);
    assert.throws(() => ui.reserveDirectory(directory), /in use/);
    settle(); await execution; assert.equal(wrapper.isRunning(), false);
    inner[method] = async () => { throw new Error("SDK settlement failure"); };
    await assert.rejects(wrapper.send({ type, message: "failure" }), /SDK settlement failure/);
    assert.equal(wrapper.isRunning(), false);
    const finalRelease = ui.reserveDirectory(directory); finalRelease();
  });
});
test("exclusive pending launch blocks directory retirement even before SDK busy; refused poison releases ownership", async (t) => {
  const owner = Symbol("owner");
  const { directory, wrapper, inner, ui } = setup(t, { initialPromptOwner: owner });
  assert.equal(inner.isStreaming, false); assert.equal(wrapper.isRunning(), true);
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  await assert.rejects(wrapper.send({ type: "prompt", message: "ordinary" }), /exclusively owned/);
  inner.isStreaming = true;
  wrapper.refuseInitialPrompt(owner, new Error("refused"));
  assert.equal(wrapper.isRunning(), false);
  const release = ui.reserveDirectory(directory); release();
});

test("host reservation checks managed running, starting and live terminal descendants without cancellation", (t) => {
  const { directory, descendant, alias, inner, ui, calls } = setup(t);
  inner.isStreaming = true;
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  inner.isStreaming = false;
  globalThis.__piStartingSessionCwds.set(join(alias, "child"), 1);
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  globalThis.__piStartingSessionCwds.clear();
  const terminal = { cwd: descendant, exited: false };
  globalThis.__piWebTerminals.set("terminal", terminal);
  assert.throws(() => ui.reserveDirectory(alias), /in use/);
  terminal.exited = true;
  const release = ui.reserveDirectory(directory);
  assert.throws(() => ui.reserveDirectory(alias), /overlaps/);
  release(); release();
  assert.deepEqual(calls, [], "observation does not abort or destroy managed work");
});

test("reservation rejects idle-wrapper prompts, shell commands, direct subagent admission and terminal creation", async (t) => {
  const { directory, descendant, alias, wrapper, ui, calls } = setup(t);
  const release = ui.reserveDirectory(alias);
  t.after(release);
  await assert.rejects(wrapper.send({ type: "prompt", message: "blocked" }), /reserved/);
  await assert.rejects(wrapper.send({ type: "bash", command: "blocked" }), /reserved/);
  assert.throws(() => wrapper.beginCheckoutPromptAdmission(), /reserved/);
  assert.throws(() => createTerminal(descendant, 80, 24, "blocked"), /reserved/);
  assert.equal(globalThis.__piWebTerminals.size, 0);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(calls, []);
  await nextTurn();
  assert.throws(() => assertDirectoryAdmissionAllowed(directory), /reserved/, "lease spans asynchronous work");
  release();
  await wrapper.send({ type: "prompt", message: "allowed" });
  await nextTurn();
  await wrapper.send({ type: "bash", command: "allowed shell" });
  assert.deepEqual(calls, ["allowed", "allowed shell"]);
});

test("prompt rechecks after extension and serialized admission waits, before calling the SDK", async (t) => {
  const { directory, wrapper, inner, ui, calls } = setup(t);
  let finishBinding;
  inner.bindExtensions = () => new Promise((resolve) => { finishBinding = resolve; });
  wrapper.beginExtensionBinding();
  const prompt = wrapper.send({ type: "prompt", message: "delayed binding" });
  await nextTurn();
  const release = ui.reserveDirectory(directory);
  t.after(release);
  const rejected = assert.rejects(prompt, /reserved/);
  finishBinding();
  await rejected;
  release();
  let finishAdmission;
  wrapper.promptAdmissionTail = new Promise((resolve) => { finishAdmission = resolve; });
  const queued = wrapper.send({ type: "prompt", message: "delayed admission" });
  await nextTurn();
  const releaseNext = ui.reserveDirectory(directory);
  t.after(releaseNext);
  const queuedRejected = assert.rejects(queued, /reserved/);
  finishAdmission();
  await queuedRejected;
  assert.deepEqual(calls, []);
});

test("admitted prompts and bash remain busy through actual settlement even before native busy flags", async (t) => {
  const { directory, wrapper, inner, ui } = setup(t);
  let finishPrompt;
  inner.prompt = (_message, options) => new Promise((resolve) => { finishPrompt = resolve; options.preflightResult(); });
  await wrapper.send({ type: "prompt", message: "running" });
  assert.equal(wrapper.isRunning(), true);
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  finishPrompt(); await nextTurn();
  let finishBash;
  inner.executeBash = () => new Promise((resolve) => { finishBash = resolve; });
  const bash = wrapper.send({ type: "bash", command: "running shell" });
  assert.equal(inner.isBashRunning, false, "simulates SDK async hooks before native launch");
  assert.equal(wrapper.isRunning(), true);
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  finishBash({ output: "ok", exitCode: 0 }); await bash;
  const admission = wrapper.beginCheckoutPromptAdmission();
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  admission(); admission();
  inner.executeBash = () => { throw new Error("shell setup failed"); };
  await assert.rejects(wrapper.send({ type: "bash", command: "throws" }), /shell setup failed/);
  assert.equal(wrapper.isRunning(), false);
  const release = ui.reserveDirectory(directory);
  t.after(release);
  wrapper.destroy();
  assert.throws(() => assertDirectoryAdmissionAllowed(directory), /reserved/, "teardown must not release a caller's in-flight native lease");
  release();
});

test("startRpcSession rejects reserved new, resumed and idle-wrapper sessions before resource creation", async (t) => {
  const { directory, descendant, wrapper, ui } = setup(t);
  const manager = SessionManager.create(descendant, agentDir);
  manager.appendMessage({ role: "user", content: "saved", timestamp: Date.now() });
  const release = ui.reserveDirectory(directory);
  t.after(release);
  await assert.rejects(startRpcSession("new-session", "", descendant), /reserved/);
  await assert.rejects(startRpcSession(manager.getSessionId(), manager.getSessionFile(), undefined), /reserved/);
  await assert.rejects(startRpcSession(wrapper.sessionId, "", undefined), /reserved/);
  assert.equal(globalThis.__piStartingSessionCwds.size, 0);
  assert.equal(globalThis.__piStartLocks.size, 0);
  release();
  assert.equal((await startRpcSession(wrapper.sessionId, "", undefined)).session, wrapper);
});

// Exercise the actual startup/admission implementation with only expensive SDK and
// account construction stubbed. The first async lookup must already publish startup.
function startupHarness(directory) {
  let rejectAccounts;
  let accountReads = 0;
  let managerCreates = 0;
  const accounts = new Promise((_, reject) => { rejectAccounts = reject; });
  const track = source.slice(source.indexOf("function trackStartingSession("), source.indexOf("export function getRpcSession("));
  const startup = source.slice(source.indexOf("export async function startRpcSession("));
  const bindings = {
    assertDirectoryAdmissionAllowed,
    getStartingSessionCwds: () => globalThis.__piStartingSessionCwds,
    getRegistry: () => globalThis.__piSessions, getLocks: () => globalThis.__piStartLocks,
    getOwnedRetirements: () => globalThis.__piOwnedRetirements ??= new Map(),
    SessionManager: { create: () => { managerCreates++; return { getCwd: () => directory, getEntries: () => [] }; } },
    samePath, readSessionToolSelection: () => undefined, readSessionAccounts: () => undefined,
    getProjectAccounts: () => { accountReads++; return accounts; },
  };
  const js = ts.transpileModule((track + startup).replace(/^export /gm, "") + "\nreturn startRpcSession;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return { start: new Function(...Object.keys(bindings), js)(...Object.values(bindings)),
    reject: rejectAccounts, accountReads: () => accountReads, managerCreates: () => managerCreates };
}

test("startup is busy before async account lookup, shares in-flight admission and releases on failure", async (t) => {
  const { directory, descendant, ui } = setup(t);
  const startup = startupHarness(descendant);
  const first = startup.start("new", "", descendant);
  const firstRejected = assert.rejects(first, /account lookup failed/);
  assert.equal(globalThis.__piStartingSessionCwds.size, 1);
  assert.equal(globalThis.__piStartLocks.size, 1);
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  const second = startup.start("new", "", descendant);
  const secondRejected = assert.rejects(second, /account lookup failed/);
  assert.equal(startup.accountReads(), 1);
  assert.equal(startup.managerCreates(), 1);
  await nextTurn();
  assert.throws(() => ui.reserveDirectory(directory), /in use/);
  startup.reject(new Error("account lookup failed"));
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(globalThis.__piStartingSessionCwds.size, 0);
  assert.equal(globalThis.__piStartLocks.size, 0);
  const release = ui.reserveDirectory(directory);
  release();
});
