import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
function wrapper(t, prompt, options = {}) {
  const session = new AgentSessionWrapper({ sessionId: "launch-admission", sessionManager: { getCwd: () => "/tmp", getSessionFile: () => "", getEntries: () => [] },
    agent: { state: {} }, isStreaming: false, isCompacting: false, isBashRunning: false, prompt, dispose() {} }, options);
  t.after(() => session.destroy()); return session;
}
test("guarded launches require actual final SDK admission, refusing late deferred callbacks", async (t) => {
  let callback, validations = 0;
  const session = wrapper(t, async (_text, options) => { callback = options.preflightResult; });
  await assert.rejects(session.send({ type: "prompt", message: "Task" }, { literal: true, validate: () => { validations++; } }), /did not confirm launch admission/);
  assert.equal(validations, 1, "early wrapper admission only");
  assert.throws(() => callback("started"), /already refused/);
  assert.equal(validations, 1, "a deferred callback cannot authorize the refused run");
  assert.equal(session.pendingPromptCount, 0);
});
test("unguarded user prompts retain the compatibility acknowledgement fallback", async (t) => {
  const session = wrapper(t, async () => {});
  assert.equal(await session.send({ type: "prompt", message: "Task" }), null);
  assert.equal(session.isAlive(), true);
});
test("guarded launches validate after SDK async preflight, before acknowledgement", async (t) => {
  let entered, release, policy = "allow";
  const ready = new Promise((resolve) => { entered = resolve; }), gate = new Promise((resolve) => { release = resolve; });
  const session = wrapper(t, async (_text, options) => { entered(); await gate; options.preflightResult("started"); });
  const pending = session.send({ type: "prompt", message: "Task" }, { validate: () => { if (policy !== "allow") throw new Error("policy changed"); } });
  const rejected = assert.rejects(pending, /policy changed/);
  await ready; policy = "deny"; release(); await rejected;
  assert.equal(session.pendingPromptCount, 0);
});

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
test("owned destination excludes ordinary mutations before and during delayed admission; success releases once", async (t) => {
  const owner = Symbol("owner"); let accept, finish, calls = 0;
  const session = wrapper(t, (_text, options) => {
    calls++;
    if (calls > 1) { options.preflightResult("queued"); return Promise.resolve(); }
    accept = () => options.preflightResult("started");
    return new Promise((resolve) => { finish = resolve; });
  }, { initialPromptOwner: owner });
  const ordinary = async () => {
    for (const type of ["prompt", "steer", "follow_up", "bash", "compact", "set_model", "set_thinking_level", "set_model_speed"]) {
      await assert.rejects(session.send({ type, message: "intruder" }), /exclusively owned/);
    }
  };
  assert.equal(session.isRunning(), true);
  await ordinary();
  await assert.rejects(session.send({ type: "prompt" }, { owner: Symbol("wrong"), validate() {} }), /Invalid/);
  assert.equal(session.refuseInitialPrompt(Symbol("wrong"), new Error("wrong")), false);
  const pending = session.send({ type: "prompt", message: "Task" }, { owner, validate() {} });
  await nextTurn();
  await ordinary();
  await assert.rejects(session.send({ type: "prompt" }, { owner, validate() {} }), /already submitted/);
  assert.equal(calls, 1);
  accept(); await pending;
  await assert.rejects(session.send({ type: "prompt" }, { owner, validate() {} }), /consumed/);
  assert.equal(session.refuseInitialPrompt(owner, new Error("creator Stop")), false);
  await session.send({ type: "prompt", message: "Queued", streamingBehavior: "followUp" });
  assert.equal(calls, 2);
  finish(); await nextTurn();
  assert.equal(session.isAlive(), true); assert.equal(session.isRunning(), false);
});

test("owned refusal promptly rejects acknowledgement even if SDK never settles; late callbacks preserve original failure", async (t) => {
  const owner = Symbol("owner"), failure = new Error("original policy refusal");
  const previous = process.env.PI_CODING_AGENT_DIR, agentDir = mkdtempSync(join(tmpdir(), "pi-owned-refusal-journal-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
  let callback, resolvePrompt;
  const completed = [], events = [];
  const session = wrapper(t, (_text, options) => {
    callback = options.preflightResult;
    return new Promise((resolve) => { resolvePrompt = resolve; });
  }, { initialPromptOwner: owner, onAgentRunComplete: () => completed.push("done") });
  session.inner.sessionId = "11111111-1111-4111-8111-111111111111";
  session.onEvent((event) => events.push(event.type));
  const rejected = assert.rejects(session.send({ type: "prompt", message: "Task" }, { owner, validate(disposition) { if (disposition) throw failure; } }), (error) => error === failure);
  await nextTurn();
  assert.throws(() => callback("started"), (error) => error === failure);
  await rejected;
  assert.equal(session.isAlive(), false); assert.equal(session.isRunning(), false);
  assert.equal(session.pendingPromptCount, 0);
  assert.equal(session.refuseInitialPrompt(owner, new Error("second")), false);
  assert.throws(() => callback("started"), (error) => error === failure);
  resolvePrompt(); await nextTurn();
  assert.deepEqual(events, ["session_shutdown"]); assert.deepEqual(completed, []);
  assert.equal(existsSync(join(agentDir, "brabbler", "run-journal", "v1")), false, "refused late SDK callbacks never journal acceptance");
  assert.equal(session.pendingPromptCount, 0);
});

test("owned Stop races unresolved binding and serialized admission without SDK abort", async (t) => {
  for (const phase of ["binding", "admission"]) await t.test(phase, async (st) => {
    const owner = Symbol("owner"); let release, calls = 0;
    const session = wrapper(st, async () => { calls++; }, { initialPromptOwner: owner });
    session.inner.abort = () => { assert.fail("must not await poisoned SDK abort"); };
    const gate = new Promise((resolve) => { release = resolve; });
    if (phase === "binding") { session.inner.bindExtensions = () => gate; session.beginExtensionBinding(); }
    else session.promptAdmissionTail = gate;
    const rejected = assert.rejects(session.send({ type: "prompt", message: "Task" }, { owner, validate() {} }), /cancelled by Stop/);
    await nextTurn(); await session.send({ type: "abort" }); await rejected;
    assert.equal(session.isAlive(), false); assert.equal(session.pendingPromptCount, 0);
    release(); await nextTurn(); assert.equal(calls, 0);
  });
});

test("early guarded SDK resolution retires owned launch and permanently blocks late admission", async (t) => {
  const owner = Symbol("owner"); let callback;
  const session = wrapper(t, async (_text, options) => { callback = options.preflightResult; }, { initialPromptOwner: owner });
  await assert.rejects(session.send({ type: "prompt", message: "Task" }, { owner, validate() {} }), /did not confirm/);
  assert.equal(session.isAlive(), false);
  assert.throws(() => callback("started"), /did not confirm/);
});

test("owned destroy/shutdown refuse binding and before-agent-start waits immediately, with bounded single disposal", async (t) => {
  for (const method of ["destroy", "shutdown"]) for (const phase of ["binding", "before_agent_start"]) await t.test(`${method}: ${phase}`, async (st) => {
    st.mock.timers.enable({ apis: ["setTimeout"] });
    st.mock.method(console, "error", () => {});
    const owner = Symbol("owner"); let release, callback, finishShutdown, dispatches = 0, disposals = 0;
    const previous = process.env.PI_CODING_AGENT_DIR, agentDir = mkdtempSync(join(tmpdir(), "pi-owned-lifecycle-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    st.after(() => {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(agentDir, { recursive: true, force: true });
    });
    const gate = new Promise((resolve) => { release = resolve; });
    const events = [], completed = [];
    const session = wrapper(st, async (_text, options) => {
      callback = options.preflightResult; await gate; callback("started"); dispatches++;
    }, { initialPromptOwner: owner, onAgentRunComplete: () => completed.push("done") });
    session.inner.sessionId = "22222222-2222-4222-8222-222222222222";
    session.inner.extensionRunner = { emit: () => new Promise((resolve) => { finishShutdown = resolve; }) };
    session.inner.dispose = () => { disposals++; };
    session.inner.abort = () => assert.fail("no SDK abort/idle wait");
    session.onEvent((event) => events.push(event.type));
    if (phase === "binding") { session.inner.bindExtensions = () => gate; session.beginExtensionBinding(); }
    const rejected = assert.rejects(session.send({ type: "prompt", message: "Task" }, { owner, validate() {} }), /cancelled by session/);
    await nextTurn();
    const retirement = session[method]();
    assert.equal(session.isAlive(), false); assert.equal(session.isRunning(), false);
    await rejected; assert.equal(session.pendingPromptCount, 0);
    await nextTurn();
    st.mock.timers.tick(1000); await nextTurn(); await retirement;
    assert.equal(disposals, 1);
    release(); finishShutdown(); await nextTurn();
    if (callback) assert.throws(() => callback("started"), /cancelled by session/);
    assert.equal(dispatches, 0); assert.equal(disposals, 1);
    assert.deepEqual(events, ["session_shutdown"]); assert.deepEqual(completed, []);
    assert.equal(existsSync(join(agentDir, "brabbler", "run-journal", "v1")), false);
  });
});

test("guard cannot accept after synchronous reentrant destruction in either validation stage", async (t) => {
  for (const stage of ["initial", "final"]) await t.test(stage, async (st) => {
    const owner = Symbol("owner"); let callback, calls = 0, dispatches = 0;
    const session = wrapper(st, (_text, options) => {
      calls++; callback = options.preflightResult; callback("started"); dispatches++; return Promise.resolve();
    }, { initialPromptOwner: owner });
    await assert.rejects(session.send({ type: "prompt", message: "Task" }, { owner, validate(disposition) {
      if ((disposition === undefined) === (stage === "initial")) session.destroy();
    } }), /cancelled by session destruction/);
    assert.equal(calls, stage === "initial" ? 0 : 1); assert.equal(dispatches, 0);
    if (callback) assert.throws(() => callback("started"), /cancelled by session destruction/);
    assert.equal(session.isAlive(), false); assert.equal(session.pendingPromptCount, 0);
    await session.shutdown();
  });
});

test("ordinary SDK authentication rejection retains its wrapper", async (t) => {
  const failure = new Error("Authentication failed");
  const session = wrapper(t, async () => { throw failure; });
  await assert.rejects(session.send({ type: "prompt", message: "Task" }), (error) => error === failure);
  assert.equal(session.isAlive(), true); assert.equal(session.pendingPromptCount, 0);
});
