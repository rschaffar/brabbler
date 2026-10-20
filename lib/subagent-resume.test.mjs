import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { createSubagentExtension } = await createJiti(import.meta.url).import("./subagent-extension.ts");
const run = { sessionId: "child", runId: "run", parentSessionId: "parent", profile: "fixture", description: "fixture", task: "fixture", runInBackground: false, status: "completed", createdAt: "created", completedAt: "completed" };
async function toolsFor(runtime) {
  const tools = new Map();
  await createSubagentExtension(runtime, () => []).factory({ registerTool: tool => tools.set(tool.name, tool) });
  return tools;
}
test("resume rejects effective creation options before dispatch and retains compatible empty defaults", async () => {
  let resumes = 0;
  const tools = await toolsFor({ resume: async () => { resumes++; return { run, completion: Promise.resolve(run) }; } });
  const params = { resume: "child", prompt: "continue", description: "continue" };
  for (const override of [{ model: "provider/model:high" }, { input_files: ["fact.txt"] }, { thinking: "high" }, { max_turns: 1 }, { inherit_context: true }, { inherit_context: false }, { isolation: "worktree" }, { subagent_type: "explore" }]) {
    const result = await tools.get("Agent").execute("call", { ...params, ...override }, undefined, undefined, {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /only apply to new subagents/);
  }
  assert.equal(resumes, 0);
  const result = await tools.get("Agent").execute("call", { ...params, model: "", input_files: [], thinking: "", max_turns: 0, isolation: "", subagent_type: "" }, undefined, undefined, {});
  assert.equal(result.isError, undefined);
  assert.equal(resumes, 1);
  assert.ok(tools.get("Agent").parameters.properties.thinking, "fork's explicit thinking override remains exposed");
  assert.ok(tools.get("Agent").parameters.properties.max_turns);
});
test("get_subagent_result waits through a genuinely queued run", async () => {
  let reads = 0;
  const tools = await toolsFor({ get: async () => ++reads === 1 ? { ...run, status: "queued" } : run });
  const result = await tools.get("get_subagent_result").execute("call", { agent_id: "child", wait: true });
  assert.equal(reads, 2);
  assert.match(result.content[0].text, /completed/);
});
