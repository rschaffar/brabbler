import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
function wrapper(t, prompt) {
  const session = new AgentSessionWrapper({ sessionId: "launch-admission", sessionManager: { getCwd: () => "/tmp", getSessionFile: () => "", getEntries: () => [] },
    agent: { state: {} }, prompt, dispose() {} });
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
