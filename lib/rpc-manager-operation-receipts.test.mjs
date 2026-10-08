import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-operation-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, hasBusyRpcSessionWithin, hasBusyRpcSessionForCwd } = await jiti.import("./rpc-manager.ts");
const { hasActiveTerminalWithin } = await jiti.import("./terminal-manager.ts");
const receipt = { version: 1, operationId: "a046677d-8293-4445-9a2b-558317345abc", toolCallId: "tool-call",
  card: { title: "Perform operation", text: "Exact candidate", actions: [] }, phase: "prepared",
  authorization: { mode: "allow", source: "session", revision: "policy-revision", decision: "policy-authorized" },
  checks: [{ name: "tests", status: "pending" }], effectStarted: false };

function setup(t, inMemory = false) {
  const directory = mkdtempSync(join(agentDir, "session-"));
  const manager = inMemory ? SessionManager.inMemory(directory) : SessionManager.create(directory, directory);
  let boundUi;
  const inner = {
    sessionId: manager.getSessionId(), sessionManager: manager,
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    agent: { state: {}, abort() {} }, abortRetry() {}, abortCompaction() {}, abortBranchSummary() {}, dispose() {},
    extensionRunner: {}, bindExtensions: async ({ uiContext }) => { boundUi = uiContext; },
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, ui: wrapper.createExtensionUiContext(), manager, events, boundUi: () => boundUi };
}

test("production extension binding exposes synchronous operationReceipt and observed directory use", async (t) => {
  const fixture = setup(t);
  fixture.wrapper.beginExtensionBinding();
  await fixture.wrapper.waitUntilReady();
  assert.equal(typeof fixture.boundUi().operationReceipt, "function");
  assert.equal(typeof fixture.boundUi().isDirectoryInUse, "function");
  assert.equal(typeof fixture.boundUi().reserveDirectory, "function");
});

test("operation snapshots persist before SSE, remain append-only after reload, and never enter SDK context", (t) => {
  const { wrapper, ui, manager } = setup(t);
  const observed = [];
  wrapper.onEvent((event) => {
    if (event.type !== "operation_receipt") return;
    const disk = SessionManager.open(manager.getSessionFile());
    assert.deepEqual(disk.getEntry(event.entry.id), event.entry, "emission only after persistence");
    assert.deepEqual(disk.buildSessionContext().messages, [], "custom entries never become LLM user messages");
    observed.push(event.entry);
  });
  const input = structuredClone(receipt);
  assert.equal(ui.operationReceipt("example", input), undefined);
  const initial = readFileSync(manager.getSessionFile(), "utf8");
  input.card.text = "Changed afterwards";
  input.checks[0].status = "failed";
  assert.equal(manager.getEntries()[0].data.card.text, "Exact candidate");
  ui.operationReceipt("example", { ...receipt, phase: "executing", effectStarted: true });
  // An already-aborted extension channel must not suppress the result of an effect.
  wrapper.extensionUiAbortController.abort(new Error("Stopped"));
  ui.operationReceipt("example", { ...receipt, phase: "succeeded", effectStarted: true, summary: "Done" });
  assert.ok(readFileSync(manager.getSessionFile(), "utf8").startsWith(initial));
  assert.deepEqual(observed.map((entry) => entry.data.phase), ["prepared", "executing", "succeeded"]);
  assert.deepEqual(observed.map((entry) => entry.data.sequence), [1, 2, 3]);
  assert.equal(observed[0].data.card.operationId, receipt.operationId);
  assert.deepEqual(SessionManager.open(manager.getSessionFile()).getEntries(), observed);
});

test("validation, append errors, first flush failures and non-persisting sessions fail closed without SSE", (t) => {
  const { ui, manager, events } = setup(t);
  assert.throws(() => ui.operationReceipt("example", { ...receipt, version: 2 }), /Invalid operation receipt/);
  assert.equal(manager.getEntries().length, 0);
  const append = manager.appendCustomEntry.bind(manager);
  manager.appendCustomEntry = () => { throw new Error("append failed"); };
  assert.throws(() => ui.operationReceipt("example", receipt), /append failed/);
  manager.appendCustomEntry = append;
  // Removing the private session directory forces the wrapper's initial flush to fail.
  rmSync(manager.getSessionDir(), { recursive: true, force: true });
  assert.throws(() => ui.operationReceipt("example", receipt), /ENOENT/);
  assert.equal(events.some((event) => event.type === "operation_receipt"), false);
  const memory = setup(t, true);
  assert.throws(() => memory.ui.operationReceipt("example", receipt), /persistent session/);
  assert.equal(memory.manager.getEntries().length, 0);
});

test("managed directory-use callback checks physical descendants, starts, running wrappers and live terminals only", (t) => {
  const directory = mkdtempSync(join(agentDir, "use-"));
  const child = join(directory, "child");
  const sibling = `${directory}-sibling`;
  const alias = `${directory}-alias`;
  mkdirSync(child); mkdirSync(sibling); symlinkSync(directory, alias, "dir");
  t.after(() => { rmSync(alias, { force: true }); rmSync(sibling, { recursive: true, force: true }); });
  const previous = [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__piWebTerminals];
  const sessions = globalThis.__piSessions = new Map();
  const starts = globalThis.__piStartingSessionCwds = new Map();
  const terminals = globalThis.__piWebTerminals = new Map();
  t.after(() => { [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__piWebTerminals] = previous; });
  const { ui } = setup(t);
  let destroyed = 0;
  const idle = { cwd: child, sessionId: "idle", isRunning: () => false, destroy: () => { destroyed++; } };
  sessions.set("idle", idle);
  assert.equal(ui.isDirectoryInUse(directory), false);
  sessions.set("running", { ...idle, sessionId: "running", cwd: join(alias, "child"), isRunning: () => true });
  assert.equal(hasBusyRpcSessionWithin(directory), true);
  assert.equal(hasBusyRpcSessionForCwd(directory), false, "existing exact-cwd semantics unchanged");
  assert.equal(ui.isDirectoryInUse(directory), true);
  assert.equal(ui.isDirectoryInUse(sibling), false);
  sessions.delete("running");
  starts.set(join(alias, "child", "not-created-yet"), 1);
  assert.equal(ui.isDirectoryInUse(directory), true, "starting sessions resolve physical existing ancestors");
  starts.clear();
  terminals.set("terminal", { cwd: join(alias, "child"), exited: false });
  assert.equal(hasActiveTerminalWithin(directory), true);
  assert.equal(ui.isDirectoryInUse(directory), true);
  assert.equal(hasActiveTerminalWithin(child), true);
  assert.equal(hasActiveTerminalWithin(sibling), false);
  terminals.get("terminal").exited = true;
  assert.equal(ui.isDirectoryInUse(directory), false, "exited terminals do not block cleanup");
  assert.equal(destroyed, 0, "observations never destroy idle wrappers");
});
