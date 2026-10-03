import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const usage = await jiti.import("./git-workspace-usage.ts");
const rpc = await jiti.import("./rpc-manager.ts");
const paths = await jiti.import("./paths.ts");
const require = createRequire(import.meta.url);
const known = (entries = []) => ({ known: true, entries });
const empty = () => ({ sessions: known(), terminals: known(), checks: known(), inflight: known() });
const rpcSource = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(rpcSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-rpc-usage-")), child = join(root, "child"), sessions = join(root, "sessions");
  mkdirSync(child); mkdirSync(sessions);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, child, sessions };
}

test("cleanup new/reopen RPC placement fences BEFORE SDK open/create and holds across defaults loading", async (t) => {
  const f = fixture(t), trusted = usage.createTrustedWorkspaceUsage(empty);
  let creates = 0, opens = 0, rejectDefaults;
  const defaults = new Promise((_, reject) => { rejectDefaults = reject; });
  const stop = new Error("fixture stops before credentials/resources/model startup");
  const manager = { getCwd: () => f.child };
  const context = { exports: {}, process: { env: { PI_WEB_IDLE_TIMEOUT_MS: "0" }, once() {} }, AbortController, setTimeout, clearTimeout, console, require(id) {
    if (id === "./git-workspace-usage") return usage;
    if (id === "./paths") return paths;
    if (id === "@earendil-works/pi-coding-agent") return {
      Theme: class {}, SessionManager: {
        create() { creates++; assert.throws(() => trusted.acquireLease(f.root), (error) => error.code === "inflight"); return manager; },
        open() { opens++; assert.throws(() => trusted.acquireLease(f.root), (error) => error.code === "inflight"); throw stop; },
      },
    };
    if (id === "@earendil-works/pi-tui") return { KeybindingsManager: class {}, TUI_KEYBINDINGS: {} };
    if (id === "./subagent-runtime") return { createSubagentController: () => ({}) };
    if (id === "./git-workflow-settings-store") return { loadGitWorkflowSettings: () => defaults };
    if (id === "./session-reader") return { readSessionHeader: () => ({ cwd: f.child }) };
    if (["crypto", "fs", "path"].includes(id)) return require(id);
    return {};
  } };
  runInNewContext(outputText, context);
  let lease = trusted.acquireLease(f.root);
  await assert.rejects(context.exports.startRpcSession("fixture-new", "", f.child), (error) => error.code === "leased");
  await assert.rejects(context.exports.startRpcSession("fixture-open", join(f.sessions, "saved.jsonl")), (error) => error.code === "leased");
  assert.equal(creates, 0); assert.equal(opens, 0);
  lease.release();
  const starting = context.exports.startRpcSession("fixture-new", "", f.child);
  const rejected = assert.rejects(starting, (error) => error === stop);
  assert.equal(creates, 1);
  assert.throws(() => trusted.acquireLease(f.root), (error) => error.code === "inflight");
  rejectDefaults(stop); await rejected;
  await assert.rejects(context.exports.startRpcSession("fixture-open", join(f.sessions, "saved.jsonl")), (error) => error === stop);
  assert.equal(opens, 1);
  lease = trusted.acquireLease(f.root); lease.release();
});

test("cleanup fork/clone/fork_branch fences BEFORE extension waits; ordinary read commands are unaffected", async (t) => {
  const f = fixture(t), trusted = usage.createTrustedWorkspaceUsage(empty);
  const inner = { sessionId: "fixture", sessionManager: { getCwd: () => f.child }, agent: { state: {} }, getAllTools: () => [], getActiveToolNames: () => [], dispose() {} };
  const wrapper = new rpc.AgentSessionWrapper(inner);
  // Inject a BEFORE-start barrier; no SDK fork or session file is ever created.
  wrapper.shouldWaitForExtensions = () => true;
  t.after(() => wrapper.destroy());
  for (const type of ["fork", "clone", "fork_branch"]) {
    let rejectWait;
    wrapper.waitForExtensionsBound = () => new Promise((_, reject) => { rejectWait = reject; });
    const sending = wrapper.send({ type });
    const stop = new Error("fixture stops before SDK fork");
    const rejected = assert.rejects(sending, (error) => error === stop);
    assert.throws(() => trusted.acquireLease(f.root), (error) => error.code === "inflight");
    rejectWait(stop); await rejected;
    const lease = trusted.acquireLease(f.root);
    await assert.rejects(wrapper.send({ type }), (error) => error.code === "leased");
    wrapper.waitForExtensionsBound = async () => {};
    assert.deepEqual(await wrapper.send({ type: "get_tools" }), []);
    lease.release();
  }
  // No deletion lease/busy-chat check was added to ordinary Git gates.
  const guard = readFileSync(new URL("./git-checkout-gate.ts", import.meta.url), "utf8");
  assert.doesNotMatch(guard, /git-workspace-usage|DeletionLease|WorkspacePlacement/);
});

test("cleanup RPC inventory reads every persisted header AND idle/transient live SDK managers, fails unknown on incomplete metadata", (t) => {
  const f = fixture(t), saved = join(f.sessions, "saved.jsonl");
  writeFileSync(saved, JSON.stringify({ type: "session", id: "saved", cwd: f.child }) + "\n");
  const previous = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = previous; });
  const manager = { getHeader: () => ({ type: "session", id: "idle-transient", cwd: f.child }), getSessionId: () => "idle-transient", getCwd: () => f.child };
  globalThis.__piSessions = new Map([["idle-transient", { inner: { sessionManager: manager }, isRunning: () => false }]]);
  assert.deepEqual(rpc.readRpcWorkspaceSessionUsage(f.sessions), known([{ id: "saved", cwd: f.child }, { id: "idle-transient", cwd: f.child }]));
  const snapshot = empty(); snapshot.sessions = rpc.readRpcWorkspaceSessionUsage(f.sessions);
  assert.throws(() => usage.createTrustedWorkspaceUsage(() => snapshot).acquireLease(f.child), (error) => error.code === "used");
  manager.getCwd = () => f.root;
  assert.equal(rpc.readRpcWorkspaceSessionUsage(f.sessions).known, false);
  assert.equal(rpc.readRpcWorkspaceSessionUsage(join(f.root, "missing")).known, false);
});

test("cleanup direct subagent cwd placement is fenced before resource loads and SDK creation without changing provenance ordering", async (t) => {
  const f = fixture(t), trusted = usage.createTrustedWorkspaceUsage(empty);
  const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
  let registrations = 0;
  const controller = createSubagentController({
    isBuiltInSubagentsEnabled: () => true,
    getSession: () => ({ cwd: f.child, sessionFile: join(f.sessions, "parent.jsonl"), isAlive: () => true }),
    registerSession: () => { registrations++; },
    reopenSession: () => { throw new Error("must not start"); },
    resolveSessionPath: () => { throw new Error("must not resolve"); },
    invalidateSessionList() {},
  });
  const lease = trusted.acquireLease(f.root);
  await assert.rejects(controller.extensionRuntime.start({ parentContext: { sessionManager: { getSessionId: () => "parent" } } }), (error) => error.code === "leased");
  assert.equal(registrations, 0); lease.release();
  const subagent = readFileSync(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  assert.ok(subagent.indexOf("finishChildPlacement ??= beginGitWorkspacePlacement(childCwd)") < subagent.indexOf("const services = await createAgentSessionServices"));
  assert.ok(subagent.indexOf("finishChildPlacement = beginGitWorkspacePlacement(plannedCwd)") < subagent.indexOf("isolatedWorktree = await addWorktree"));
  assert.ok(rpcSource.indexOf("const finishPlacement = beginGitWorkspacePlacement(placementCwd)") < rpcSource.indexOf("sessionManager = SessionManager.open(sessionFile, undefined)"));
  assert.match(rpcSource, /restoreSessionGitWorkflowForRecreation\(sessionManager, recreatedWorkflowEntries\)/);
  assert.match(rpcSource, /const services = await createAgentSessionServices\([\s\S]*?const \{ session: inner \} = await createAgentSessionFromServices\(/);
});
