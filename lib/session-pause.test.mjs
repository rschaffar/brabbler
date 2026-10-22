import assert from "node:assert/strict";
import nodeTest, { after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";

const test = (name, run) => nodeTest(name, { timeout: 10_000 }, run);
const dir = mkdtempSync(join(tmpdir(), "pi-web-pause-test-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(dir, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { requestSessionPause, changeSessionPause, removeSessionPause, readSessionPauses, getSessionPause, sessionResumeMessage } = await jiti.import("./session-pause.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { applySessionModelDefinition, modelRuntimeRefreshState, pendingModelRuntimeRefresh } = await jiti.import("./session-model-refresh.ts");
const { getSessionPauseSnapshot, resumeManagedSession, pauseManagedSessions, runPauseOperation } = await jiti.import("./session-pause-runtime.ts");
const { cacheSessionPath } = await jiti.import("./session-reader.ts");
const { POST } = await jiti.import("../app/api/activity/pause/route.ts");
const pendingDefers = new Set();
const releaseGates = () => { for (const done of pendingDefers) done(); };
const deferred = () => {
  let done; const promise = new Promise((resolve) => { done = resolve; });
  const resolve = (value) => { pendingDefers.delete(resolve); done(value); };
  pendingDefers.add(resolve); return { promise, resolve };
};
const answer = (text) => fauxAssistantMessage([fauxText(text)]);
const toolAnswer = () => fauxAssistantMessage([fauxToolCall("effect", {}), fauxToolCall("effect", {})], { stopReason: "toolUse" });

async function fixture(t, effect = async () => {}, options = {}) {
  const root = mkdtempSync(join(dir, "native-")), cwd = join(root, "cwd"), agentDir = join(root, "agent");
  mkdirSync(cwd); mkdirSync(agentDir);
  const runtime = options.shared?.session.modelRuntime ?? await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), refreshOnCreate: false });
  const faux = options.shared?.faux ?? fauxProvider({ models: [{ id: "fixture" }] });
  if (!options.shared) runtime.registerNativeProvider(faux.provider);
  let attempts = 0;
  const stream = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (...args) => { attempts++; return stream(...args); };
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true,
    extensionFactories: [pi => {
      if (options.beforeSettle) pi.on("agent_before_settle", event => ({ entries: [...event.entries, { type: "custom_message", customType: "late", content: "continue", display: false }], continue: true }));
      if (options.afterSettle) pi.on("agent_settled", () => pi.sendMessage({ customType: "settled-report", content: "Do not wake", display: false }, { triggerTurn: true }));
      if (options.onInput) pi.on("input", options.onInput);
      if (options.onAgentStart) pi.on("agent_start", options.onAgentStart);
      if (options.onBeforeStart) pi.on("before_agent_start", options.onBeforeStart);
      if (options.onBeforeSettle) pi.on("agent_before_settle", options.onBeforeSettle);
    }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, settingsManager: settings, resourceLoader: loader,
    sessionManager: SessionManager.create(cwd, join(root, "sessions")), model: faux.getModel("fixture"),
    customTools: [{ name: "effect", label: "effect", description: "Synthetic effect", parameters: Type.Object({}), execute: async (_id, _args, signal) => {
      await effect(signal); return { content: [{ type: "text", text: "done" }], details: {} };
    } }] });
  await session.bindExtensions({ mode: "print" });
  if (options.beforePrepare) {
    const previousPrepare = session.agent.prepareRequest;
    session.agent.prepareRequest = async (...args) => { await options.beforePrepare(...args); return (await previousPrepare?.(...args)) ?? undefined; };
  }
  options.beforeWrap?.(session);
  const wrapper = new AgentSessionWrapper(session); wrapper.start();
  globalThis.__piSessions ??= new Map(); globalThis.__piSessions.set(session.sessionId, wrapper);
  cacheSessionPath(session.sessionId, session.sessionFile);
  const operations = new Set();
  const track = promise => { operations.add(promise); void promise.catch(() => {}); return promise; };
  t.signal.addEventListener("abort", releaseGates, { once: true });
  t.after(async () => {
    releaseGates(); t.signal.removeEventListener("abort", releaseGates);
    // A timeout response/destroy() is not an actual SDK settlement barrier.
    await pendingModelRuntimeRefresh(session.modelRuntime);
    await session.abort();
    await Promise.allSettled(operations);
    await session.waitForIdle();
    await wrapper.shutdown();
    if (globalThis.__piSessions.get(session.sessionId) === wrapper) globalThis.__piSessions.delete(session.sessionId);
    const row = getSessionPause(session.sessionId); if (row) removeSessionPause(session.sessionId, row.id);
  });
  return { session, wrapper, faux, track, attempts: () => attempts };
}

for (const outcome of ["success", "failure", "timeout"]) {
  test(`shared model refresh ${outcome} reconciles Pause only after actual settlement`, async t => {
    const held = deferred(), entered = deferred();
    // Own wrapper idle timers and teardown cancellation in the same clock domain.
    if (outcome === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] });
    let holdRefresh = false;
    const parent = await fixture(t, undefined, { beforeWrap(session) {
      const refresh = session.modelRuntime.refresh.bind(session.modelRuntime);
      session.modelRuntime.refresh = async options => {
        if (!holdRefresh) return refresh(options);
        entered.resolve(); await held.promise;
        if (outcome === "failure") throw new Error("Synthetic model refresh failure");
        return refresh(options);
      };
    } });
    const sibling = await fixture(t, undefined, { shared: parent });
    parent.wrapper.beginExtensionBinding(); sibling.wrapper.beginExtensionBinding();
    await Promise.all([parent.wrapper.waitUntilReady(), sibling.wrapper.waitUntilReady()]);
    const runtime = parent.session.modelRuntime;
    const entries = sibling.session.sessionManager.getEntries().length;
    holdRefresh = true;
    const applying = parent.track(applySessionModelDefinition(parent.session, parent.session.model.provider, parent.session.model.id));
    const result = outcome === "success" ? applying : assert.rejects(applying, outcome === "timeout" ? /timed out/ : /could not be applied/);
    void result.catch(() => {}); // Keep failed-assertion cleanup from leaving an unobserved request.
    await Promise.race([entered.promise, applying.then(() => { throw new Error("Refresh never entered"); })]);
    const settled = pendingModelRuntimeRefresh(runtime);
    assert.ok(settled);
    for (const f of [parent, sibling]) {
      f.wrapper.requestPause();
      assert.equal(getSessionPause(f.session.sessionId).state, "pausing");
    }
    sibling.wrapper.finishPause(true);
    assert.equal(getSessionPause(sibling.session.sessionId).state, "pausing", "child completion cannot certify an unsettled shared refresh");
    await assert.rejects(sibling.session.sendCustomMessage({ customType: "paused-report", content: "Do not run", display: false }, { triggerTurn: true }), /being applied/);
    assert.equal(sibling.session.sessionManager.getEntries().length, entries, "pause ingress must retain the inner model gate");
    if (outcome === "timeout") {
      t.mock.timers.tick(15_000); await result;
      for (const f of [parent, sibling]) assert.equal(getSessionPause(f.session.sessionId).state, "pausing");
      assert.equal(modelRuntimeRefreshState(runtime).refreshing, true);
    }
    held.resolve(); await result; await settled;
    for (const f of [parent, sibling]) {
      assert.equal(getSessionPause(f.session.sessionId).state, "paused");
      assert.equal(f.wrapper.isRunning(), false);
      assert.equal(f.attempts(), 0);
    }
    assert.equal(modelRuntimeRefreshState(runtime).refreshing, false);
    if (outcome !== "success") {
      await assert.rejects(sibling.session.sendCustomMessage({ customType: "paused-report", content: "Still blocked", display: false }, { triggerTurn: true }), /could not be applied/);
      assert.equal(sibling.session.sessionManager.getEntries().length, entries);
    }
  });
}

test("pause records are private, durable, idempotent and exact-generation guarded", () => {
  const path = join(dir, "store", "pauses.json");
  const row = requestSessionPause("main", undefined, path);
  assert.equal(requestSessionPause("main", undefined, path).id, row.id);
  changeSessionPause("main", row.id, record => { record.state = "paused"; record.waiting.push("question"); }, path);
  assert.equal(readSessionPauses(path)[0].state, "paused");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => changeSessionPause("main", "wrong", () => {}, path), /Pause changed/);
  removeSessionPause("main", "wrong", path); assert.equal(readSessionPauses(path).length, 1);
  removeSessionPause("main", row.id, path); assert.deepEqual(readSessionPauses(path), []);
  writeFileSync(path, "{broken");
  assert.throws(() => requestSessionPause("new", undefined, path));
  assert.equal(readFileSync(path, "utf8"), "{broken");
});

test("malformed/duplicate/unknown-version pause records are not replaced", () => {
  const path = join(dir, "invalid.json");
  for (const value of [{ version: 2, sessions: [] }, { version: 1, sessions: [null] }, { version: 1, sessions: [{ id: "id", sessionId: "../escape" }] }]) {
    writeFileSync(path, JSON.stringify(value)); assert.throws(() => readSessionPauses(path));
  }
});

test("main continuation contains paused child work and cancelled cards, never approval authority", () => {
  const root = { id: "pause", sessionId: "root", state: "pausing", requestedAt: 1, waiting: ["Exact question and options"], resumeId: "resume" };
  const text = sessionResumeMessage(root, [{ pause: { ...root, sessionId: "child", parentSessionId: "root" }, task: "Investigate", result: "Partial evidence", worktreePath: "/retained" }]);
  assert.match(text, /^\[Pi Web resume resume\]/);
  for (const phrase of ["unknown", "ask again", "never reuse an old approval", "child", "Investigate", "Partial evidence", "/retained", "not automatically resumed"]) assert.ok(text.includes(phrase), phrase);
});

test("all parallel tools finish uncancelled and persist before pause; no next request or completion", async t => {
  const entered = deferred(), release = deferred(); let started = 0;
  const f = await fixture(t, async signal => { if (++started === 2) entered.resolve(); await release.promise; assert.equal(signal.aborted, false); });
  f.faux.setResponses([toolAnswer(), answer("must not run")]);
  const run = f.session.prompt("Task"); await entered.promise;
  f.wrapper.requestPause();
  assert.equal(getSessionPause(f.session.sessionId).state, "pausing");
  await assert.rejects(f.wrapper.send({ type: "steer", message: "no implicit resume" }), /paused or pausing/);
  release.resolve(); await run;
  assert.equal(f.attempts(), 1);
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
  const saved = SessionManager.open(f.session.sessionFile).getEntries();
  assert.equal(saved.filter(entry => entry.type === "message" && entry.message.role === "toolResult").length, 2);
  assert.equal(saved.filter(entry => entry.type === "message" && entry.message.role === "assistant").length, 1);
});

test("accepted queues drain intact before pause instead of being lost at restart", async t => {
  const f = await fixture(t);
  f.faux.setResponses([async () => { await f.session.followUp("Already accepted follow-up"); f.wrapper.requestPause(); return answer("First"); }, answer("Queued response"), answer("must not run")]);
  await f.session.prompt("Task");
  assert.equal(f.attempts(), 2);
  assert.equal(f.session.pendingMessageCount, 0);
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
  assert.ok(f.session.messages.some(message => message.role === "user" && message.content.some(part => part.type === "text" && part.text === "Already accepted follow-up")));
});

test("one-at-a-time queues drain all accepted text/custom/image envelopes before Pause", async t => {
  const f = await fixture(t); f.session.agent.followUpMode = "one-at-a-time";
  const image = { type: "image", mimeType: "image/png", data: "synthetic-image-envelope" };
  f.faux.setResponses([async () => {
    await f.session.followUp("First accepted input"); await f.session.followUp("Second accepted input");
    await f.session.sendCustomMessage({ customType: "queued-image-report", content: [{ type: "text", text: "Image envelope" }, image], display: true }, { triggerTurn: true, deliverAs: "followUp" });
    f.wrapper.requestPause(); return answer("Initial response");
  }, answer("First input delivered"), answer("Second input delivered"), answer("Custom input delivered"), answer("must not run")]);
  await f.session.prompt("Task");
  assert.equal(f.attempts(), 4); assert.equal(f.session.agent.hasQueuedMessages(), false);
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
  const saved = f.session.sessionManager.getBranch().find(entry => entry.type === "custom_message" && entry.customType === "queued-image-report");
  assert.ok(saved.content.some(part => part.type === "image" && part.data === image.data));
});

test("pause suppresses SDK retry and before-settle continuation", async t => {
  const f = await fixture(t, undefined, { beforeSettle: true });
  f.faux.setResponses([() => { f.wrapper.requestPause(); return fauxAssistantMessage([fauxText("failed")], { stopReason: "error", errorMessage: "429 rate limit" }); }, answer("must not run")]);
  await f.session.prompt("Task");
  assert.equal(f.attempts(), 1);
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
});

test("pending question is saved before cancellation, then pause can finish without answering it", async t => {
  const f = await fixture(t);
  const ui = f.wrapper.createExtensionUiContext();
  const waiting = ui.askUser({ question: "Choose exactly", options: [{ title: "Option A" }], allowMultiple: false, allowFreeform: true, allowComment: true, contextExpanded: false });
  f.wrapper.requestPause();
  await assert.rejects(waiting, /cancelled by Pause/);
  const saved = getSessionPause(f.session.sessionId);
  assert.equal(saved.state, "paused");
  assert.ok(saved.waiting.some(payload => payload.includes("Choose exactly") && payload.includes("Option A")));
  assert.equal(f.wrapper.getPendingAttention(), null);
});

test("poll snapshot excludes exact card bodies and marks unconfirmed cold intent", () => {
  const record = requestSessionPause("cold-main");
  changeSessionPause(record.sessionId, record.id, row => { row.waiting = ["private exact card"]; });
  const snapshot = getSessionPauseSnapshot().find(row => row.sessionId === "cold-main");
  assert.equal(snapshot.interrupted, true);
  assert.equal("waiting" in snapshot, false);
  assert.equal("resumeId" in snapshot, false);
  removeSessionPause(record.sessionId, record.id);
});

test("main Resume sends one literal continuation and duplicate clicks cannot replay it", async t => {
  const f = await fixture(t);
  f.faux.setResponses([() => { f.wrapper.requestPause(); return answer("Saved progress"); }, answer("Continued")]);
  await f.session.prompt("Task");
  const row = getSessionPause(f.session.sessionId);
  await runPauseOperation(() => resumeManagedSession(f.session.sessionId, row.id));
  await f.session.waitForIdle();
  await runPauseOperation(() => resumeManagedSession(f.session.sessionId, row.id));
  assert.equal(f.attempts(), 2);
  assert.equal(getSessionPause(f.session.sessionId), undefined);
  const prompts = f.session.messages.filter(message => message.role === "user" && message.content.some(part => part.type === "text" && part.text.startsWith("[Pi Web resume ")));
  assert.equal(prompts.length, 1);
});

test("a persisted Resume marker reconciles both disk intent and the live wrapper gate", async t => {
  const f = await fixture(t); f.faux.setResponses([answer("Saved"), answer("Normal next task")]);
  await f.session.prompt("Task"); f.wrapper.requestPause(); const row = getSessionPause(f.session.sessionId);
  changeSessionPause(row.sessionId, row.id, item => { item.state = "resuming"; item.resumeId = "accepted-before-restart"; });
  f.session.sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "[Pi Web resume accepted-before-restart] Already saved" }], timestamp: Date.now() });
  await resumeManagedSession(row.sessionId, row.id); assert.equal(getSessionPause(row.sessionId), undefined);
  await f.wrapper.send({ type: "prompt", message: "Next task" }); await f.session.waitForIdle();
  assert.equal(f.attempts(), 2);
});

test("Resume refuses a different active branch and direct subsession resumes", async t => {
  const f = await fixture(t);
  f.faux.setResponses([answer("Saved")]); await f.session.prompt("Task");
  f.wrapper.requestPause();
  const row = getSessionPause(f.session.sessionId);
  changeSessionPause(row.sessionId, row.id, item => { item.leafId = "foreign-leaf"; });
  await assert.rejects(resumeManagedSession(row.sessionId, row.id), /branch changed/);
  changeSessionPause(row.sessionId, row.id, item => { item.parentSessionId = "main"; delete item.leafId; });
  await assert.rejects(resumeManagedSession(row.sessionId, row.id), /only available on the main/);
  assert.equal(f.attempts(), 1);
});

test("Pause all sees managed sessions independent of browser project/privacy filters", async t => {
  const entered = deferred(), release = deferred(); let count = 0;
  const f = await fixture(t, async () => { if (++count === 2) entered.resolve(); await release.promise; });
  f.faux.setResponses([toolAnswer(), answer("must not run")]);
  const run = f.session.prompt("A session not visible in this browser filter"); await entered.promise;
  const result = await runPauseOperation(() => pauseManagedSessions());
  assert.deepEqual(result.errors, []); assert.equal(getSessionPause(f.session.sessionId).state, "pausing");
  release.resolve(); await run;
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
});

test("settlement extension reports cannot start a fresh run while paused", async t => {
  const f = await fixture(t, undefined, { afterSettle: true });
  f.faux.setResponses([() => { f.wrapper.requestPause(); return answer("Paused"); }, answer("must not run")]);
  await f.session.prompt("Task");
  assert.equal(f.attempts(), 1);
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
  assert.ok(f.session.sessionManager.getEntries().some(entry => entry.type === "custom_message" && entry.customType === "settled-report"));
});

test("an input already in asynchronous steering admission drains before certification", async t => {
  const effectEntered = deferred(), effectRelease = deferred(), inputEntered = deferred(), inputRelease = deferred();
  let effects = 0;
  const f = await fixture(t, async () => { if (++effects === 2) effectEntered.resolve(); await effectRelease.promise; }, {
    onInput: async event => { if (event.text === "Late steering") { inputEntered.resolve(); await inputRelease.promise; } return { action: "continue" }; },
  });
  f.faux.setResponses([toolAnswer(), answer("Delivered steering"), answer("must not run")]);
  const run = f.session.prompt("Task"); await effectEntered.promise;
  const steering = f.track(f.wrapper.send({ type: "steer", message: "Late steering" })); await inputEntered.promise;
  f.wrapper.requestPause(); effectRelease.resolve();
  await new Promise(done => setImmediate(done));
  assert.equal(getSessionPause(f.session.sessionId).state, "pausing"); assert.equal(f.attempts(), 1);
  inputRelease.resolve(); await steering; await run;
  assert.equal(f.attempts(), 2); assert.equal(f.session.pendingMessageCount, 0);
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
});

test("Resume retains its record until the literal continuation is persisted after agent_start", async t => {
  const entered = deferred(), release = deferred(); let starts = 0;
  const f = await fixture(t, undefined, { onAgentStart: async () => { if (++starts === 2) { entered.resolve(); await release.promise; } } });
  f.faux.setResponses([() => { f.wrapper.requestPause(); return answer("Paused"); }, answer("Continued")]);
  await f.session.prompt("Task"); const row = getSessionPause(f.session.sessionId);
  const resume = f.track(resumeManagedSession(f.session.sessionId, row.id)); await entered.promise;
  assert.equal(getSessionPause(f.session.sessionId).state, "resuming");
  release.resolve(); await resume; await f.session.waitForIdle();
  assert.equal(getSessionPause(f.session.sessionId), undefined); assert.equal(f.attempts(), 2);
});

test("Pause can supersede Resume while an agent_start extension waits", async t => {
  const entered = deferred(), release = deferred(); let starts = 0;
  const f = await fixture(t, undefined, { onAgentStart: async () => { if (++starts === 2) { entered.resolve(); await release.promise; } } });
  f.faux.setResponses([() => { f.wrapper.requestPause(); return answer("Paused"); }, answer("Already submitted work finishes")]);
  await f.session.prompt("Task"); const row = getSessionPause(f.session.sessionId);
  const request = body => new Request("http://localhost/api/activity/pause", { method: "POST", headers: { Host: "localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const resume = f.track(POST(request({ action: "resume", sessionId: f.session.sessionId, pauseId: row.id }))); await entered.promise;
  assert.equal((await POST(request({ action: "pause", sessionId: f.session.sessionId }))).status, 200);
  assert.equal((await resume).status, 409);
  assert.notEqual(getSessionPause(f.session.sessionId).id, row.id);
  release.resolve(); await f.session.waitForIdle();
  await new Promise(done => setImmediate(done));
  assert.equal(getSessionPause(f.session.sessionId).state, "paused");
});

for (const mode of ["handled", "transform"]) test(`Resume ${mode} by an input extension retains recovery context`, async t => {
  const f = await fixture(t, undefined, { onInput: event => event.text.startsWith("[Pi Web resume ") ? mode === "handled" ? { action: "handled" } : { action: "transform", text: "Changed resume" } : { action: "continue" } });
  f.faux.setResponses([() => { f.wrapper.requestPause(); return answer("Paused"); }, answer("must not run")]);
  await f.session.prompt("Task"); const row = getSessionPause(f.session.sessionId);
  await assert.rejects(resumeManagedSession(f.session.sessionId, row.id), /intercepted|changed the Resume/);
  await f.session.waitForIdle(); await new Promise(done => setImmediate(done));
  assert.ok(getSessionPause(f.session.sessionId)); assert.equal(f.attempts(), 1);
});

test("Pause during before-settle continuation stops without another response", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, undefined, { onBeforeSettle: async event => { entered.resolve(); await release.promise; return { entries: [...event.entries, { type: "custom_message", customType: "late", content: "Continue", display: false }], continue: true }; } });
  f.faux.setResponses([answer("Finished response"), answer("must not run")]);
  const run = f.session.prompt("Task"); await entered.promise; f.wrapper.requestPause(); release.resolve(); await run;
  assert.equal(f.attempts(), 1); assert.equal(getSessionPause(f.session.sessionId).state, "paused");
});

test("Pause during next-request preparation prevents another provider call after a completed batch", async t => {
  const entered = deferred(), release = deferred(); let requests = 0;
  const f = await fixture(t, undefined, { beforePrepare: async () => { if (++requests === 2) { entered.resolve(); await release.promise; } } });
  f.faux.setResponses([toolAnswer(), answer("must not run")]);
  const run = f.session.prompt("Task"); await entered.promise; f.wrapper.requestPause(); release.resolve(); await run;
  assert.equal(f.attempts(), 1); assert.equal(getSessionPause(f.session.sessionId).state, "paused");
});

test("superseding Resume in before_agent_start leaves SDK idle and permits a later explicit Resume", async t => {
  const entered = deferred(), release = deferred(); let starts = 0;
  const f = await fixture(t, undefined, { onBeforeStart: async () => { if (++starts === 2) { entered.resolve(); await release.promise; } } });
  f.faux.setResponses([() => { f.wrapper.requestPause(); return answer("Paused"); }, answer("Continued")]);
  await f.session.prompt("Task"); const row = getSessionPause(f.session.sessionId);
  const resume = f.track(resumeManagedSession(row.sessionId, row.id)); await entered.promise;
  f.wrapper.requestPause(); await assert.rejects(resume, /superseded/);
  release.resolve(); await f.session.waitForIdle(); await new Promise(done => setImmediate(done));
  assert.equal(f.session.isIdle, true); assert.equal(f.attempts(), 1);
  const current = getSessionPause(row.sessionId); assert.equal(current.state, "paused");
  await resumeManagedSession(current.sessionId, current.id); await f.session.waitForIdle();
  assert.equal(f.attempts(), 2); assert.equal(getSessionPause(row.sessionId), undefined);
});

test("a new Pause supersedes a Resume claim before catalogue/resource awaits", async t => {
  const f = await fixture(t); f.faux.setResponses([answer("Saved")]); await f.session.prompt("Task"); f.wrapper.requestPause();
  const row = getSessionPause(f.session.sessionId);
  const resume = f.track(resumeManagedSession(row.sessionId, row.id));
  f.wrapper.requestPause(); await assert.rejects(resume, /Pause changed|superseded/);
  assert.notEqual(getSessionPause(row.sessionId).id, row.id); assert.equal(f.attempts(), 1);
});

test("branch navigation cannot race an in-progress Resume input hook", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, undefined, { onInput: async event => { if (event.text.startsWith("[Pi Web resume ")) { entered.resolve(); await release.promise; } return { action: "continue" }; } });
  f.faux.setResponses([() => { f.wrapper.requestPause(); return answer("Paused"); }, answer("Continued")]);
  await f.session.prompt("Task"); const row = getSessionPause(f.session.sessionId);
  const resume = f.track(resumeManagedSession(row.sessionId, row.id)); await entered.promise;
  await assert.rejects(f.wrapper.send({ type: "navigate_tree", targetId: "other" }), /Cannot change branches during Resume/);
  release.resolve(); await resume; await f.session.waitForIdle(); assert.equal(f.attempts(), 2);
});

test("lost paused-child notifications are durably reconciled on the main's next explicit prompt", async t => {
  const f = await fixture(t); f.faux.setResponses([answer("Main idle"), answer("Context received"), answer("Next explicit task"), answer("New branch task")]);
  await f.session.prompt("Bootstrap");
  const child = SessionManager.create(f.session.sessionManager.getCwd(), join(dir, "lost-child-sessions"));
  child.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: f.session.sessionId, parentSessionPath: f.session.sessionFile,
    profile: "explore", description: "Paused investigation", task: "Investigate partial facts", createdAt: new Date().toISOString(), runInBackground: true });
  child.appendMessage({ role: "user", content: "Child task", timestamp: Date.now() }); child.appendMessage(answer("Partial evidence"));
  child.appendCustomEntry("pi-web:subagent-result", { version: 1, status: "paused", result: "Partial evidence", completedAt: new Date().toISOString() });
  cacheSessionPath(child.getSessionId(), child.getSessionFile());
  const paused = requestSessionPause(child.getSessionId(), f.session.sessionId);
  changeSessionPause(paused.sessionId, paused.id, row => { row.state = "paused"; row.waiting = ["Saved child question"]; });
  t.after(() => removeSessionPause(paused.sessionId, paused.id));
  assert.equal(f.attempts(), 1);
  const beforeHandoff = f.session.sessionManager.getLeafId();
  await f.wrapper.send({ type: "prompt", message: "My next explicit task" }); await f.session.waitForIdle();
  await f.wrapper.send({ type: "prompt", message: "Another explicit task" }); await f.session.waitForIdle();
  const contexts = f.session.sessionManager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === "pi-web:paused-subsession-context");
  assert.equal(contexts.length, 1);
  for (const text of [child.getSessionId(), "Investigate partial facts", "Partial evidence", "Saved child question", "never reuse an old approval"]) assert.ok(JSON.stringify(contexts[0]).includes(text), text);
  assert.equal(f.attempts(), 3);
  await f.wrapper.send({ type: "navigate_tree", targetId: beforeHandoff });
  await f.wrapper.send({ type: "prompt", message: "Explicit task on the earlier branch" }); await f.session.waitForIdle();
  assert.equal(f.session.sessionManager.getEntries().filter(entry => entry.type === "custom_message" && entry.customType === "pi-web:paused-subsession-context").length, 2);
  assert.equal(f.session.sessionManager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === "pi-web:paused-subsession-context").length, 1);
  assert.equal(f.attempts(), 4);
});

test("a streaming follow-up admission reclassifies as a fresh run after the old run settles", async t => {
  const entered = deferred(), release = deferred(), responding = deferred(), finishResponse = deferred();
  const f = await fixture(t, undefined, { onInput: async event => { if (event.text === "Late follow-up") { entered.resolve(); await release.promise; } return { action: "continue" }; } });
  f.faux.setResponses([async () => { responding.resolve(); await finishResponse.promise; return answer("First response"); }, answer("Fresh follow-up response")]);
  const first = f.session.prompt("Initial task"); await responding.promise;
  const second = f.track(f.session.prompt("Late follow-up", { streamingBehavior: "followUp" }));
  await entered.promise; finishResponse.resolve(); await first; release.resolve(); await second;
  assert.equal(f.attempts(), 2); assert.equal(f.session.isIdle, true);
});

for (const method of ["steer", "followUp"]) test(`idle late ${method} preserves full accepted input before certifying Pause`, async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, undefined, { onInput: async event => { if (event.text === "Late accepted input") { entered.resolve(); await release.promise; } return { action: "continue" }; } });
  f.faux.setResponses([answer("Old run finished"), answer("Explicit continuation")]);
  const first = f.session.prompt("Initial task");
  const image = { type: "image", mimeType: "image/png", data: "synthetic-pending-image" };
  const queued = f.track(f.session[method]("Late accepted input", [image]));
  await entered.promise; await first; f.wrapper.requestPause(); release.resolve(); await queued;
  assert.equal(f.attempts(), 1); assert.equal(getSessionPause(f.session.sessionId).state, "paused");
  assert.equal(f.session.agent.hasQueuedMessages(), false); assert.equal(f.session.pendingMessageCount, 0);
  const saved = f.session.sessionManager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === "pi-web:undelivered-input");
  assert.equal(saved.length, 1); assert.ok(JSON.stringify(saved[0]).includes("Late accepted input")); assert.ok(JSON.stringify(saved[0]).includes(image.data));
  const row = getSessionPause(f.session.sessionId); await resumeManagedSession(row.sessionId, row.id); await f.session.waitForIdle();
  assert.equal(f.attempts(), 2);
});

test("terminal child settlement is retained until a late input admission finishes parking", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, undefined, { onInput: async event => { if (event.text === "Late child input") { entered.resolve(); await release.promise; } return { action: "continue" }; } });
  f.faux.setResponses([answer("Child partial progress")]);
  const first = f.session.prompt("Child task"); const late = f.track(f.session.steer("Late child input"));
  await entered.promise; await first;
  f.session.sessionManager.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: "main", parentSessionPath: "/synthetic/main.jsonl", profile: "explore", task: "Child task", description: "Child" });
  f.wrapper.requestPause("main"); f.wrapper.finishPause(true);
  assert.equal(getSessionPause(f.session.sessionId).state, "pausing");
  release.resolve(); await late;
  assert.equal(getSessionPause(f.session.sessionId).state, "paused"); assert.equal(f.attempts(), 1);
});

test("two queued main prompts share one pending paused-child handoff before the batch persists it", async t => {
  const entered = deferred(), release = deferred(); let effects = 0;
  const f = await fixture(t, async () => { if (++effects === 2) entered.resolve(); await release.promise; });
  f.session.agent.followUpMode = "one-at-a-time";
  f.faux.setResponses([toolAnswer(), answer("Natural result"), answer("First queued task"), answer("Second queued task")]);
  const first = f.session.prompt("Initial task"); await entered.promise;
  const child = SessionManager.create(f.session.sessionManager.getCwd(), join(dir, "pending-handoff-child"));
  child.appendCustomEntry("pi-web:subagent", { version: 1, parentSessionId: f.session.sessionId, parentSessionPath: f.session.sessionFile,
    profile: "explore", description: "Child report", task: "Task", createdAt: new Date().toISOString(), runInBackground: true });
  child.appendMessage({ role: "user", content: "Child task", timestamp: Date.now() }); child.appendMessage(answer("Partial child"));
  child.appendCustomEntry("pi-web:subagent-result", { version: 1, status: "paused", result: "Partial child", completedAt: new Date().toISOString() });
  cacheSessionPath(child.getSessionId(), child.getSessionFile());
  const pause = requestSessionPause(child.getSessionId(), f.session.sessionId); changeSessionPause(pause.sessionId, pause.id, row => { row.state = "paused"; });
  t.after(() => removeSessionPause(pause.sessionId, pause.id));
  await f.wrapper.send({ type: "prompt", message: "Queued first", streamingBehavior: "followUp" });
  await f.wrapper.send({ type: "prompt", message: "Queued second", streamingBehavior: "followUp" });
  release.resolve(); await first;
  assert.equal(f.session.sessionManager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === "pi-web:paused-subsession-context").length, 1);
  assert.equal(f.attempts(), 4);
});

test("Pause all supersedes a live cold Resume claim before an RPC wrapper exists", async t => {
  const f = await fixture(t); f.wrapper.requestPause();
  const old = getSessionPause(f.session.sessionId), pending = deferred();
  changeSessionPause(f.session.sessionId, old.id, row => { row.state = "resuming"; row.resumeId = "00000000-0000-4000-8000-000000000001"; });
  globalThis.__piSessions.delete(f.session.sessionId);
  const operations = globalThis.__piResumeOperations ??= new Map();
  const claim = { pauseId: old.id, promise: pending.promise }; operations.set(f.session.sessionId, claim);
  t.after(() => { pending.resolve(); if (operations.get(f.session.sessionId) === claim) operations.delete(f.session.sessionId); });
  assert.equal(getSessionPauseSnapshot().find(row => row.sessionId === f.session.sessionId).interrupted, undefined);
  assert.deepEqual(await pauseManagedSessions(), { errors: [] });
  const next = getSessionPause(f.session.sessionId);
  assert.notEqual(next.id, old.id); assert.equal(next.state, "paused"); assert.equal(f.attempts(), 0);
});

test("pause API rejects cross-origin, malformed and oversized commands without side effects", async () => {
  const request = (body, headers = {}) => new Request("http://localhost/api/activity/pause", { method: "POST", headers: { Host: "localhost", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const before = readSessionPauses();
  assert.equal((await POST(request({ action: "pause-all" }, { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request({ action: "unknown" }))).status, 400);
  assert.equal((await POST(request({ action: "pause", sessionId: "../escape" }))).status, 400);
  assert.equal((await POST(request({ action: "resume", sessionId: "main" }))).status, 400);
  assert.notEqual((await POST(request({ action: "pause-all", extra: "x".repeat(5000) }))).status, 200);
  assert.deepEqual(readSessionPauses(), before);
});
