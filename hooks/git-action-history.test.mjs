import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readGitActionHistory, watchGitActionHistory, newestGitActionHistory, GIT_ACTION_RECONCILE_MS, watchGitActionsChanged, GIT_ACTIONS_CHANGED_EVENT } = await jiti.import("./git-action-history.ts");
const { GIT_ACTION_UPDATE_EVENT, projectGitActionUpdate, mergeGitActionTail, alignEntryIds, isGitActionUpdate } = await jiti.import("../lib/git-action-ui.ts");
const id = "12345678-1234-1234-1234-123456789abc";
const update = { type: "git_action_update", actionId: id, revision: 1, entryId: "anchor", timestamp: 1000 };
const response = (revision, extra = {}) => ({ record: { id, revision, sessionId: "deleted-owner", state: "succeeded" }, ...extra });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("SSE inserts once, keeps live ID placeholders aligned, and later revisions contain no patch", () => {
  const transcript = { messages: [{ role: "user", content: "saved" }, { role: "assistant", content: [] }], entryIds: ["user"] };
  const projected = projectGitActionUpdate(transcript, update);
  assert.deepEqual(projected.entryIds, ["user", "", "anchor"]);
  assert.deepEqual(projected.messages[2].details, { actionId: id });
  assert.equal(projected.messages[2].content, "");
  assert.equal(projectGitActionUpdate(projected, update), projected);
  assert.equal(projectGitActionUpdate(projected, { ...update, revision: 9, entryId: undefined }), projected);
  const diskWon = { ...projected, messages: [...projected.messages] };
  assert.equal(projectGitActionUpdate(diskWon, update), diskWon);
  assert.deepEqual(alignEntryIds(projected.messages, projected.entryIds), projected.entryIds);
  assert.equal(isGitActionUpdate(update), true);
  for (const bad of [{ actionId: "bad" }, { revision: NaN }, { entryId: "" }, { timestamp: "bad" }]) assert.equal(isGitActionUpdate({ ...update, ...bad }), false);
});

test("manual tail refresh retains loaded ancestors only for an exact same-branch suffix", () => {
  const transcript = (ids) => ({ entryIds: ids, messages: ids.map((id) => ({ role: "user", content: id })) });
  const current = transcript(["old", "compaction", "anchor", "last"]);
  const incoming = transcript(["anchor", "last", "new-card"]);
  incoming.messages[0] = { role: "custom", customType: "pi-web:git-action", content: "", display: true, details: { actionId: id } };
  const merged = mergeGitActionTail(current, incoming);
  assert.deepEqual(merged.entryIds, ["old", "compaction", "anchor", "last", "new-card"]);
  assert.equal(merged.messages[2], incoming.messages[0]);
  assert.equal(merged.messages.length, merged.entryIds.length);
  assert.equal(mergeGitActionTail(current, transcript(["old", "other-branch", "new-card"])), null, "a shared ancestor does not justify joining sibling branches");
  assert.equal(mergeGitActionTail(current, transcript(["unloaded", "new-card"])), null);
  assert.equal(mergeGitActionTail(current, transcript(["anchor"])), null, "an older short read must not splice a partial suffix");
  assert.equal(mergeGitActionTail(transcript(["", "anchor", "last"]), incoming), null, "do not retain unpersisted streaming rows");
  assert.equal(mergeGitActionTail(current, transcript([])), null);
});

test("git action SSE never changes run state or loads the agent wrapper", async () => {
  const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf('case "git_action_update"'), source.indexOf('case "connected"'));
  assert.match(handler, /setTranscript.*projectGitActionUpdate/);
  assert.match(handler, /sessionHookMountedRef/);
  assert.match(handler, /sessionId: sessionIdRef.current, actionId: event.actionId, revision: event.revision/);
  assert.doesNotMatch(handler, /dispatch\(|setAgentRunning|setAgentPhase|loadSession|sendAgentCommand|\bcandidate\b|\bpatch\b/);
});

test("history GET uses the current fork's anchor and fetches the artifact only explicitly", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => response(1) }; };
  try {
    await readGitActionHistory("current fork", id);
    await readGitActionHistory("current fork", id, true);
    assert.equal(calls[0].url, `/api/git/actions/${id}?sessionId=current+fork`);
    assert.equal(calls[1].url, `/api/git/actions/${id}?sessionId=current+fork&includeArtifact=1`);
    assert.ok(calls.every(({ options }) => options.cache === "no-store" && options.method === undefined));
  } finally { globalThis.fetch = original; }
});

test("mounted cards reconcile missed updates, visibility and online; stale reads/unmount cannot win", async () => {
  const old = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const window = new EventTarget();
  const document = new EventTarget();
  const requests = [];
  const seen = [];
  let interval;
  let cleared = false;
  document.hidden = false;
  window.setInterval = (callback, ms) => { assert.equal(ms, GIT_ACTION_RECONCILE_MS); interval = callback; return 1; };
  window.clearInterval = () => { cleared = true; };
  Object.assign(globalThis, { window, document, fetch: (url, options) => new Promise((resolve) => requests.push({ url, options, resolve })) });
  let dispose;
  const finish = (index, data) => requests[index].resolve({ ok: true, json: async () => data });
  const running = (revision) => ({ ...response(revision), record: { ...response(revision).record, state: "executing" } });
  const invalidate = (sessionId, revision) => window.dispatchEvent(new CustomEvent(GIT_ACTION_UPDATE_EVENT, { detail: { sessionId, actionId: id, revision } }));
  try {
    dispose = watchGitActionHistory("fork", id, (history) => seen.push(history), (error) => assert.fail(error));
    assert.equal(requests.length, 1);
    finish(0, running(1)); await tick();
    invalidate("other-chat", 2); invalidate("fork", 1);
    assert.equal(requests.length, 1);
    invalidate("fork", 2);
    assert.equal(requests.length, 2);
    interval(); // repairs a missed event and aborts the older flight
    assert.equal(requests[1].options.signal.aborted, true);
    finish(2, running(3)); await tick();
    finish(1, running(2)); await tick();
    assert.equal(seen.at(-1).record.revision, 3);
    document.hidden = true; interval(); invalidate("fork", 4);
    assert.equal(requests.length, 3);
    document.hidden = false; document.dispatchEvent(new Event("visibilitychange"));
    finish(3, running(2)); await tick();
    assert.equal(seen.at(-1).record.revision, 3);
    window.dispatchEvent(new Event("online"));
    dispose();
    finish(4, response(4)); await tick();
    assert.equal(seen.at(-1).record.revision, 3);
    assert.equal(requests[4].options.signal.aborted, true);
    assert.equal(cleared, true);
    invalidate("fork", 5); document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(requests.length, 5);
    assert.ok(requests.every(({ url }) => !url.includes("includeArtifact") && !url.includes("/api/agent")));
  } finally { dispose?.(); for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test("terminal cards stop interval polling but refresh on visibility to detect lost artifacts", async () => {
  const old = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const window = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  let interval, reads = 0, dispose;
  window.setInterval = (callback) => { interval = callback; return 1; };
  window.clearInterval = () => {};
  Object.assign(globalThis, { window, document, fetch: async () => {
    reads++;
    return { ok: true, json: async () => response(5) };
  } });
  try {
    dispose = watchGitActionHistory("fork", id, () => {}, (error) => assert.fail(error));
    await tick();
    interval(); await tick();
    assert.equal(reads, 1, "immutable completed cards need no periodic artifact rereads");
    document.dispatchEvent(new Event("visibilitychange")); await tick();
    assert.equal(reads, 2);
  } finally { dispose?.(); for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test("manual sidecar changes reconcile without SSE, coalesce, defer active streams and reject races", async () => {
  const old = { window: globalThis.window, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const window = new EventTarget();
  const timers = new Map();
  let timerId = 0;
  Object.assign(globalThis, { window, setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  let target = { sessionId: "current", busy: false, revision: 0 };
  const reads = [];
  const reload = (sid, shouldApply) => new Promise((resolve) => reads.push({ sid, shouldApply, finish: () => resolve(shouldApply() ? "applied" : "superseded") }));
  const changed = (sessionId) => window.dispatchEvent(new CustomEvent(GIT_ACTIONS_CHANGED_EVENT, { detail: { sessionId } }));
  const retry = async () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); await tick(); };
  let dispose;
  try {
    dispose = watchGitActionsChanged(() => target, reload);
    changed("other"); assert.equal(reads.length, 0);
    changed("current"); assert.equal(reads.length, 1);
    changed("current"); changed("current"); assert.equal(reads.length, 1);
    assert.equal(reads[0].shouldApply(), false, "new action overtook the GET");
    reads[0].finish(); await tick(); await retry();
    assert.equal(reads.length, 2);
    target = { ...target, busy: true, revision: 1 };
    assert.equal(reads[1].shouldApply(), false, "a new run must not be overwritten");
    reads[1].finish(); await tick(); await retry();
    assert.equal(reads.length, 2, "no reads during an active run");
    target = { ...target, busy: false, revision: 2 };
    await retry(); assert.equal(reads.length, 3);
    target = { ...target, revision: 3 }; // branch navigation / pagination
    reads[2].finish(); await tick(); await retry();
    assert.equal(reads.length, 4);
    assert.equal(reads[3].shouldApply(), true);
    reads[3].finish(); await tick(); assert.equal(timers.size, 0);
    changed("current"); assert.equal(reads.length, 5);
    target = { ...target, sessionId: "different" };
    assert.equal(reads[4].shouldApply(), false);
    reads[4].finish(); await tick(); await retry();
    assert.equal(reads.length, 5);
    changed("different"); assert.equal(reads.length, 6);
    dispose(); assert.equal(reads[5].shouldApply(), false);
    reads[5].finish(); await tick(); changed("different"); assert.equal(reads.length, 6);
    assert.equal(timers.size, 0);
  } finally { dispose?.(); for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test("manual invalidation uses the guarded existing session read, not force/reload/agent commands", async () => {
  const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("useEffect(() => watchGitActionsChanged"), source.indexOf("  const loadContext"));
  assert.match(effect, /loadSession\(sid, false, false, undefined, shouldApply\)/);
  assert.match(effect, /busy: agentRunningRef.current \|\| bashRunningRef.current/);
  assert.match(effect, /revision: transcriptRevisionRef.current/);
  assert.match(effect, /pendingHistoryReadsRef.current > 0/);
  assert.match(source, /if \(shouldApply && !revisionUnchanged\) \{[\s\S]*mergeGitActionTail[\s\S]*oldestEntryId: historyCursorRef.current, hasMore: hasEarlierMessagesRef.current/);
  assert.match(source, /if \(!revisionUnchanged && d.treeFormat === "summary" && d.snapshotRevision\)/);
  assert.match(source, /if \(shouldApply && !shouldApply\(\)\) return "superseded"/);
  assert.doesNotMatch(effect, /force:|sendAgentCommand|dispatch\(|setAgentRunning|maintainEvents/);
});

test("equal-revision replies cannot undo restart/artifact-loss liveness revocation", () => {
  for (const [terminal, active] of [["expired", "awaiting-decision"], ["recovery-required", "executing"]]) {
    const current = response(7);
    current.record.state = terminal;
    const stale = response(7);
    stale.record.state = active;
    assert.equal(newestGitActionHistory(current, stale), current);
    assert.equal(newestGitActionHistory(stale, current), current);
    assert.equal(newestGitActionHistory(current, response(8)).record.revision, 8);
  }
});

test("missing records are placeholders; stale artifact responses cannot roll back outcomes", () => {
  const current = response(7);
  assert.equal(newestGitActionHistory(current, response(6)), current);
  assert.deepEqual(newestGitActionHistory(current, { record: null, unavailable: "corrupt" }), { record: null, unavailable: "corrupt" });
});
