import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const helpers = await jiti.import("../lib/interaction-receipts.ts");
const operations = await jiti.import("../lib/operation-receipts.ts");
function runCase(type, next, bindings, event) {
  bindings = { sessionIdRef: { current: "session" }, clearQuestionDraft() {}, ...bindings };
  const body = source.slice(source.indexOf(`case "${type}"`), source.indexOf(`case "${next}"`, source.indexOf(`case "${type}"`)));
  const js = ts.transpileModule(`switch (event.type) { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("event", ...Object.keys(bindings), js)(event, ...Object.values(bindings));
}
const entry = { type: "custom", customType: helpers.INTERACTION_RECEIPT_TYPE, id: "entry", parentId: null,
  timestamp: "2026-10-06T10:00:00.000Z", data: { version: 1, outcome: "answered", response: { confirmed: true },
    request: { type: "extension_ui_request", id: "request", method: "confirm", title: "Continue?", message: "Context" } } };

test("receipt events append aligned deduplicated history and close only their own live dialog", () => {
  let transcript = { messages: [], entryIds: [] };
  let dialog = { id: "other-request" };
  const bindings = {
    activeLeafIdRef: { current: null }, dataRef: { current: { leafId: null } },
    interactionReceiptMessage: helpers.interactionReceiptMessage,
    appendInteractionReceipt: helpers.appendInteractionReceipt,
    setTranscript: (update) => { transcript = update(transcript); },
    setExtensionDialog: (update) => { dialog = update(dialog); },
  };
  const run = (value = entry) => runCase("interaction_receipt", "extension_ui_request", bindings, { type: "interaction_receipt", entry: value });
  run();
  assert.equal(dialog.id, "other-request");
  assert.deepEqual(transcript.entryIds, ["entry"]);
  assert.equal(transcript.messages.length, 1);
  dialog = { id: "request" };
  run(); assert.equal(dialog, null);
  assert.equal(transcript.messages.length, 1);
  run({ ...entry, data: { version: 2 } });
  assert.equal(transcript.messages.length, 1);
});

const operation = (id, sequence, phase) => ({ ...entry, id, customType: operations.OPERATION_RECEIPT_TYPE,
  data: operations.snapshotOperationReceipt("example", { version: 1, operationId: "a046677d-8293-4445-9a2b-558317345abc",
    card: { title: "Operation", actions: [] }, phase, authorization: { mode: "allow", source: "session", revision: "r1", decision: "policy-authorized" },
    checks: [], effectStarted: phase === "succeeded" }, sequence) });

test("operation SSE updates and deduplicates stages with aligned IDs, rejects malformed entries and verifies branch ancestry", () => {
  let transcript = { messages: [], entryIds: [] };
  const activeLeafIdRef = { current: null };
  const reads = [];
  const bindings = {
    activeLeafIdRef, dataRef: { current: { leafId: null } }, sessionIdRef: { current: "session" },
    operationReceiptMessage: operations.operationReceiptMessage,
    appendOperationReceipt: operations.appendOperationReceipt,
    setTranscript: (update) => { transcript = update(transcript); },
    reconcileInteractionReceipts: (...args) => reads.push(args),
  };
  const run = (entry) => runCase("operation_receipt", "interaction_receipt", bindings, { type: "operation_receipt", entry });
  run(operation("prepared", 1, "prepared"));
  const terminal = operation("terminal", 2, "succeeded");
  run(terminal); run(terminal); run(operation("prepared", 1, "prepared"));
  assert.deepEqual(transcript.entryIds, ["terminal"]);
  assert.equal(transcript.messages.length, 1);
  run({ ...terminal, data: { ...terminal.data, version: 2 } });
  assert.deepEqual(transcript.entryIds, ["terminal"]);
  activeLeafIdRef.current = "other-branch";
  run(operation("failed", 3, "failed"));
  assert.deepEqual(transcript.entryIds, ["terminal"]);
  activeLeafIdRef.current = null;
  run({ ...terminal, parentId: "remote-ancestor" });
  assert.equal(reads.length, 1);
  assert.equal(reads[0][1].parentId, "remote-ancestor");
});

test("connecting reconciles persisted receipts even when the agent is idle", () => {
  const loads = [];
  runCase("connected", "agent_start", {
    dispatch() {}, sessionIdRef: { current: "session" }, reconcileInteractionReceipts: (id) => loads.push(id),
  }, { type: "connected", isStreaming: false });
  assert.deepEqual(loads, ["session"]);
});

test("reconnect closes a settled batch and reconciles only the selected session's drafts", () => {
  let dialog = { id: "settled", method: "ask_user_batch" };
  const snapshots = [];
  const bindings = { dispatch() {}, sessionIdRef: { current: "session" }, reconcileInteractionReceipts() {},
    reconcileQuestionDrafts: (...args) => snapshots.push(args),
    setExtensionDialog: (update) => { dialog = update(dialog); } };
  runCase("connected", "agent_start", bindings, { type: "connected", pendingQuestionSetIds: ["pending"], isStreaming: false });
  assert.equal(dialog, null);
  assert.deepEqual(snapshots, [["session", ["pending"]]]);
  dialog = { id: "pending", method: "ask_user_batch" };
  runCase("connected", "agent_start", bindings, { type: "connected", pendingQuestionSetIds: ["pending"], isStreaming: false });
  assert.equal(dialog.id, "pending");
});

test("a live receipt never enters an independently browsed branch", () => {
  let transcript = { messages: [], entryIds: [] };
  let dialog = { id: "request" };
  runCase("interaction_receipt", "extension_ui_request", {
    activeLeafIdRef: { current: "browsed" }, dataRef: { current: { leafId: "live" } },
    interactionReceiptMessage: helpers.interactionReceiptMessage,
    appendInteractionReceipt: helpers.appendInteractionReceipt,
    setTranscript: (update) => { transcript = update(transcript); },
    setExtensionDialog: (update) => { dialog = update(dialog); },
  }, { type: "interaction_receipt", entry });
  assert.equal(transcript.messages.length, 0);
  assert.equal(dialog, null, "the live request still settles while browsing elsewhere");
});

test("remote descendant receipts require server ancestry validation even if local live refs agree", () => {
  let transcript = { messages: [], entryIds: [] };
  const reads = [];
  runCase("interaction_receipt", "extension_ui_request", {
    activeLeafIdRef: { current: "a" }, dataRef: { current: { leafId: "a" } },
    sessionIdRef: { current: "session" },
    interactionReceiptMessage: helpers.interactionReceiptMessage,
    appendInteractionReceipt: helpers.appendInteractionReceipt,
    setTranscript: (update) => { transcript = update(transcript); },
    setExtensionDialog() {}, reconcileInteractionReceipts: (...args) => reads.push(args),
  }, { type: "interaction_receipt", entry: { ...entry, parentId: "b" } });
  assert.equal(transcript.messages.length, 0);
  assert.equal(reads.length, 1);
  assert.equal(reads[0][0], "session");
  assert.equal(reads[0][1].parentId, "b");
});

function reconnectHarness(history, ok = true) {
  let transcript = { messages: [], entryIds: [] };
  let finishRead;
  const requests = [];
  const activeLeafIdRef = { current: "live" };
  const dataRef = { current: { leafId: "live" } };
  const bindings = {
    useCallback: (fn) => fn, activeLeafIdRef, dataRef, messagesRef: { current: [] },
    branchViewRevisionRef: { current: 0 },
    sessionHookMountedRef: { current: true }, sessionIdRef: { current: "session" },
    fetch: async (url) => {
      requests.push(url);
      return { ok, json: () => new Promise((resolve) => { finishRead = () => resolve({ context: history }); }) };
    },
    setTranscript: (update) => { transcript = update(transcript); },
    mergeInteractionReceiptHistory: helpers.mergeInteractionReceiptHistory,
    appendInteractionReceipt: helpers.appendInteractionReceipt,
  };
  const callback = source.slice(source.indexOf("  const reconcileInteractionReceipts ="), source.indexOf("  const loadContext ="));
  const js = ts.transpileModule(callback + "\nreturn reconcileInteractionReceipts;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const reconcile = new Function(...Object.keys(bindings), js)(...Object.values(bindings));
  return { reconcile, activeLeafIdRef, dataRef, requests, finish: () => finishRead(),
    get: () => transcript, update: (next) => { transcript = next; } };
}

test("slow reconnect merges receipts without erasing newer cards or preloading ordinary SSE messages", async () => {
  const savedReceipt = helpers.interactionReceiptMessage(entry);
  const ordinary = { role: "user", content: "SSE message", timestamp: savedReceipt.timestamp + 1000 };
  const harness = reconnectHarness({ messages: [savedReceipt, ordinary], entryIds: ["entry", "ordinary"] });
  const pending = harness.reconcile("session");
  await Promise.resolve();
  const newer = { ...entry, id: "newer", timestamp: "2026-10-06T10:00:02.000Z", data: {
    ...entry.data, request: { ...entry.data.request, id: "newer-request" },
  } };
  harness.update(helpers.appendInteractionReceipt(harness.get(), newer));
  harness.finish(); await pending;
  assert.deepEqual(harness.get().entryIds, ["entry", "newer"]);
  assert.equal(new URL(harness.requests[0], "http://localhost").searchParams.get("ancestorId"), "live");
  assert.equal(harness.get().messages.some((message) => message === ordinary), false,
    "ordinary message_end remains the sole live delivery path");
});

test("slow reconnect history cannot downgrade terminal operations; missed terminal delivery reconciles on reconnect", async () => {
  const prepared = operation("prepared", 1, "prepared");
  const terminal = operation("terminal", 2, "succeeded");
  const harness = reconnectHarness({ messages: [operations.operationReceiptMessage(prepared)], entryIds: ["prepared"] });
  const pending = harness.reconcile("session");
  await Promise.resolve();
  harness.update(operations.appendOperationReceipt(harness.get(), terminal));
  harness.finish(); await pending;
  assert.deepEqual(harness.get().entryIds, ["terminal"]);
  const replay = reconnectHarness({ messages: [operations.operationReceiptMessage(terminal)], entryIds: ["terminal"] });
  replay.update(operations.appendOperationReceipt(replay.get(), prepared));
  const replaying = replay.reconcile("session");
  await Promise.resolve(); replay.finish(); await replaying;
  assert.deepEqual(replay.get().entryIds, ["terminal"]);
});

test("canonical branch advancement revalidates a newer live receipt instead of dropping it", async () => {
  const harness = reconnectHarness({ messages: [], entryIds: [] });
  const pending = harness.reconcile("session", entry);
  await Promise.resolve();
  harness.activeLeafIdRef.current = "new-canonical-leaf";
  harness.dataRef.current = { leafId: "new-canonical-leaf" };
  harness.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.requests.length, 2);
  const params = new URL(harness.requests[1], "http://localhost").searchParams;
  assert.equal(params.get("ancestorId"), "new-canonical-leaf");
  assert.equal(params.get("leafId"), "entry");
  harness.finish(); await pending;
  assert.deepEqual(harness.get().entryIds, ["entry"]);
});

test("live receipt branch verification is bound to its exact entry and fails closed", async () => {
  const harness = reconnectHarness({ messages: [helpers.interactionReceiptMessage(entry)], entryIds: ["entry"] }, false);
  await harness.reconcile("session", entry);
  const params = new URL(harness.requests[0], "http://localhost").searchParams;
  assert.equal(params.get("leafId"), "entry");
  assert.equal(params.get("ancestorId"), "live");
  assert.equal(harness.get().messages.length, 0);
});

test("branch changes discard in-flight reconnect receipt history", async () => {
  const harness = reconnectHarness({ messages: [helpers.interactionReceiptMessage(entry)], entryIds: ["entry"] });
  const pending = harness.reconcile("session");
  await Promise.resolve();
  harness.activeLeafIdRef.current = "browsed";
  harness.finish(); await pending;
  assert.deepEqual(harness.get(), { messages: [], entryIds: [] });
});

test("delayed canonical reads are discarded before installing a newer branch's data or transcript", async () => {
  const begin = source.indexOf("      const d = await res.json() as SessionData;");
  const code = source.slice(begin, source.indexOf("      // Freshness check:", begin));
  const js = ts.transpileModule(code + "\nreturn 'apply';", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const bindings = {
    res: { json: async () => ({ leafId: "old-live" }) }, shouldApply: undefined,
    branchViewRevisionRef: { current: 1 }, viewRevisionAtRead: 0,
    sessionIdRef: { current: "session" }, sid: "session",
  };
  assert.equal(await new AsyncFunction(...Object.keys(bindings), js)(...Object.values(bindings)), "superseded");
  bindings.branchViewRevisionRef.current = 0;
  assert.equal(await new AsyncFunction(...Object.keys(bindings), js)(...Object.values(bindings)), "apply");
});

test("warm cache restoration updates live refs before starting its canonical freshness read", () => {
  const begin = source.indexOf("      if (cached) {", source.indexOf("  // Load session on mount"));
  const code = source.slice(begin, source.indexOf("      loadSession(session.id", begin));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const bindings = {
    cached: { leafId: "cached-leaf", messages: [], entryIds: [], thinkingLevel: "off", model: null },
    session: { id: "session" }, dataRef: { current: null }, activeLeafIdRef: { current: null },
    modelSpeedRef: { current: "standard" }, setModelSpeed() {},
    setData() {}, setActiveLeafId() {}, setMessages() {}, setEntryIds() {},
    setHistoryCursor() {}, setHasEarlierMessages() {}, setError() {}, setLoading() {},
  };
  new Function(...Object.keys(bindings), js)(...Object.values(bindings));
  assert.equal(bindings.dataRef.current.leafId, "cached-leaf");
  assert.equal(bindings.activeLeafIdRef.current, "cached-leaf");
});

test("slow canonical snapshot preserves newly emitted receipts without carrying them across branch views", () => {
  const begin = source.indexOf("        const preserveRecentReceipts =");
  const code = source.slice(begin, source.indexOf("        setHistoryCursor(", begin));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const saved = { role: "user", content: "Before", timestamp: Date.parse(entry.timestamp) - 1000 };
  for (const view of ["live", "browsed"]) {
    let transcript = helpers.appendInteractionReceipt({ messages: [saved], entryIds: ["user"] }, entry);
    const bindings = {
      followsLiveAtRead: true, branchViewRevisionRef: { current: view === "live" ? 0 : 1 }, viewRevisionAtRead: 0, viewLeafAtRead: "live",
      persistedMessages: [saved], d: { context: { entryIds: ["user"] }, tree: [], leafId: "live" },
      alignEntryIds: (messages, ids) => messages.map((_, i) => ids[i] ?? ""),
      mergeInteractionReceiptHistory: helpers.mergeInteractionReceiptHistory,
      receiptBranchContains: helpers.receiptBranchContains,
      setTranscript: (update) => { transcript = update(transcript); },
    };
    new Function(...Object.keys(bindings), js)(...Object.values(bindings));
    assert.deepEqual(transcript.entryIds, view === "live" ? ["user", "entry"] : ["user"]);
  }
});
