import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { readSessionModelSpeed } = await jiti.import("./session-model-speed.ts");

function fixture() {
  const manager = SessionManager.inMemory("/fixture");
  const inner = { sessionId: manager.getSessionId(), sessionManager: manager,
    model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5" },
    agent: { state: { thinkingLevel: "high" } }, isStreaming: false, isCompacting: false, isBashRunning: false,
    getContextUsage: () => null, getSteeringMessages: () => [], getFollowUpMessages: () => [], dispose() {} };
  return { manager, inner, wrapper: new AgentSessionWrapper(inner) };
}

test("RPC speed defaults to Standard, persists independently, emits changes and leaves other sessions untouched", async () => {
  const a = fixture(); const b = fixture(); const events = [];
  a.wrapper.onEvent((event) => events.push(event));
  try {
    assert.equal((await a.wrapper.send({ type: "get_state" })).modelSpeed, "standard");
    assert.deepEqual(await a.wrapper.send({ type: "set_model_speed", modelSpeed: "fast" }), { modelSpeed: "fast" });
    assert.equal((await a.wrapper.send({ type: "get_state" })).modelSpeed, "fast");
    assert.equal(readSessionModelSpeed(a.manager.getEntries()), "fast");
    assert.equal(readSessionModelSpeed(b.manager.getEntries()), "standard");
    assert.equal(a.inner.agent.state.thinkingLevel, "high");
    assert.equal(events.filter((event) => event.type === "model_speed_change").length, 1);
    const entryCount = a.manager.getEntries().length;
    await a.wrapper.send({ type: "set_model_speed", modelSpeed: "fast" });
    assert.equal(a.manager.getEntries().length, entryCount);
  } finally { a.wrapper.destroy(); b.wrapper.destroy(); }
});

test("speed changes reject active runs, compaction, shell work and direct subagent preflight", async () => {
  const { inner, manager, wrapper } = fixture();
  try {
    for (const property of ["isStreaming", "isCompacting", "isBashRunning"]) {
      inner[property] = true;
      await assert.rejects(wrapper.send({ type: "set_model_speed", modelSpeed: "fast" }), /session is running/);
      inner[property] = false;
    }
    const release = wrapper.beginCheckoutPromptAdmission();
    await assert.rejects(wrapper.send({ type: "set_model_speed", modelSpeed: "fast" }), /session is running/);
    release();
    assert.equal(manager.getEntries().length, 0);
  } finally { wrapper.destroy(); }
});

test("invalid and unsupported Fast changes fail without erasing the retained session preference", async () => {
  const { inner, manager, wrapper } = fixture();
  try {
    await wrapper.send({ type: "set_model_speed", modelSpeed: "fast" });
    inner.model = { provider: "anthropic", api: "anthropic-messages", id: "fixture" };
    await assert.rejects(wrapper.send({ type: "set_model_speed", modelSpeed: "fast" }), /ChatGPT subscription/);
    assert.equal(readSessionModelSpeed(manager.getEntries()), "fast");
    for (const modelSpeed of ["ultrafast", "priority", null, {}]) {
      await assert.rejects(wrapper.send({ type: "set_model_speed", modelSpeed }), /Invalid model speed/);
    }
    await wrapper.send({ type: "set_model_speed", modelSpeed: "standard" });
    assert.equal(readSessionModelSpeed(manager.getEntries()), "standard");
  } finally { wrapper.destroy(); }
});
