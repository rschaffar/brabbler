import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { speedLifecycleNative } from "./session-model-speed-native.fixture.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const rpc = await jiti.import("./rpc-manager.ts");
const { addProviderAccount, accountCredentialStore } = await jiti.import("./provider-accounts.ts");
const { readSessionModelSpeed } = await jiti.import("./session-model-speed.ts");
const { readSessionAccounts } = await jiti.import("./session-accounts.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");

const credential = (accountId) => ({ type: "oauth", accountId, refresh: "fixture-not-real",
  access: `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.not-real`,
  expires: Date.now() + 86_400_000 });

test("real SDK wrapper recreation and child construction retain independent speed, thinking and account snapshots without model calls", async t => {
  const native = speedLifecycleNative(t);
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  const previousFetch = globalThis.fetch;
  native.restore(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  native.restore(() => { if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline; });
  native.restore(() => { globalThis.fetch = previousFetch; });
  try {
    const root = await native.provision();
    const agentDir = join(root, "agent"); const cwd = join(root, "project");
    await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_OFFLINE = "1";
    globalThis.fetch = async () => { throw new Error("Lifecycle fixtures must not call a provider"); };
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "openai-codex": credential("default-fixture") }), { mode: 0o600 });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "gpt-5.5",
      defaultThinkingLevel: "high", enabledModels: ["openai-codex/gpt-5.5"], cacheWarming: "off", enableInstallTelemetry: false }), { mode: 0o600 });
    let started = await native.operation("RPC start", () => rpc.startRpcSession(`__new__${randomUUID()}`, "", cwd, { toolNames: [], modelSpeed: "fast", thinkingLevel: "high" }), value => native.retain(value.session));
    assert.equal(existsSync(started.session.sessionFile), false, "Exercise the non-persisted recreation path");
    for (const tools of [["read"], []]) {
      // Every acknowledged change before recreation survives it. A change while
      // session_shutdown is delayed must be refused, not silently discarded.
      await started.session.send({ type: "set_model_speed", modelSpeed: "standard" });
      await started.session.send({ type: "set_model_speed", modelSpeed: "fast" });
      const runner = started.session.inner.extensionRunner;
      const originalEmit = runner.emit;
      const emit = runner.emit.bind(runner);
      let release, arrived;
      const gate = new Promise((resolve) => { release = resolve; });
      const seen = new Promise((resolve) => { arrived = resolve; });
      native.release(release);
      native.restore(() => { runner.emit = originalEmit; });
      runner.emit = async (event) => {
        if (event.type === "session_shutdown") { arrived(); await gate; }
        return emit(event);
      };
      const recreation = native.operation("RPC tools recreation", () => rpc.setRpcSessionTools(started.realSessionId, undefined, tools), value => native.retain(value.session));
      let changed;
      try {
        // A rejected/completed real start cannot strand the separate gate wait.
        await Promise.race([seen, recreation.then(() => { throw new Error("Recreation completed before shutdown admission"); })]);
        await assert.rejects(started.session.send({ type: "set_model_speed", modelSpeed: "standard" }), /shutting down/);
        assert.equal(readSessionModelSpeed(started.session.inner.sessionManager.getEntries()), "fast");
      } catch (error) { native.fail(error); throw error; }
      finally {
        release();
        changed = await recreation;
      }
      assert.equal(changed.recreated, true);
      started = { session: changed.session, realSessionId: changed.sessionId };
      native.retain(started.session);
      const state = await started.session.send({ type: "get_state" });
      assert.equal(state.modelSpeed, "fast"); assert.equal(state.thinkingLevel, "high");
      assert.equal(existsSync(started.session.sessionFile), false);
    }
    const account = await addProviderAccount("openai-codex", "Fixture selected account", "oauth");
    await accountCredentialStore({ "openai-codex": account.id }).modify("openai-codex", async () => credential("selected-fixture"));
    const switchedId = await native.operation("RPC account recreation", () => rpc.setRpcSessionAccount(started.realSessionId, undefined, "openai-codex", account.id), id => native.retain(rpc.getRpcSession(id)));
    const parent = rpc.getRpcSession(switchedId);
    assert.ok(parent); native.retain(parent);
    const state = await parent.send({ type: "get_state" });
    assert.equal(state.modelSpeed, "fast"); assert.equal(state.thinkingLevel, "high");
    assert.deepEqual(readSessionAccounts(parent.inner.sessionManager.getEntries()), { "openai-codex": account.id });
    assert.equal(existsSync(parent.sessionFile), false);

    // Persist a synthetic transcript, not a model run, so the real controller
    // can create its normal child file/header and session services.
    parent.inner.sessionManager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
    parent.inner.sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }],
      provider: "openai-codex", api: "openai-codex-responses", model: "gpt-5.5", stopReason: "stop", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    assert.equal(existsSync(parent.sessionFile), true);
    const children = new Map(); const prompts = [];
    const controller = createSubagentController({
      getSession: (id) => id === parent.sessionId ? parent : children.get(id),
      registerSession: (inner) => {
        // Stub only prompt execution. SDK child construction, snapshots and
        // runtime/account binding remain real; no response or model is invoked.
        inner.prompt = async (task) => { prompts.push(task); };
        const wrapper = native.construct(inner, value => new rpc.AgentSessionWrapper(value));
        children.set(inner.sessionId, wrapper); native.retain(wrapper);
      },
      reopenSession: async () => { throw new Error("Unexpected reopening"); },
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {}, isBuiltInSubagentsEnabled: () => true,
    });
    const execution = await native.operation("SDK child construction/start", () => controller.extensionRuntime.start({ parentContext: { sessionManager: parent.inner.sessionManager },
      parentToolCallId: "fixture-call", profile: "explore", task: "fixture child task", description: "Fixture child",
      runInBackground: false, inheritContext: false, maxTurns: 0 }), value => {
        native.work(value.completion);
        // Result publication precedes queue slot release/post-persist recovery.
        // Join the existing explicit full-tail observer as a separate original.
        native.work(value.settled);
      });
    assert.equal((await execution.completion).status, "completed");
    const child = children.get(execution.run.sessionId);
    assert.ok(child); assert.equal(prompts.length, 1);
    assert.equal(readSessionModelSpeed(child.inner.sessionManager.getEntries()), "fast");
    assert.deepEqual(readSessionAccounts(child.inner.sessionManager.getEntries()), { "openai-codex": account.id });
    assert.equal((await child.send({ type: "get_state" })).thinkingLevel, "high");
    await child.send({ type: "set_model_speed", modelSpeed: "standard" });
    assert.equal((await parent.send({ type: "get_state" })).modelSpeed, "fast");
    assert.equal(readSessionModelSpeed(child.inner.sessionManager.getEntries()), "standard");
  } catch (error) {
    native.fail(error); throw error;
  } finally {
    await native.finish();
  }
});
