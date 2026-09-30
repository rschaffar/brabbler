import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { createGitWorkflowContextFilterExtension, filterGitWorkflowContext, isGitWorkflowContextMessage } = await createJiti(import.meta.url).import("./git-workflow-context.ts");
const customType = "pi-web:git-workflow-context";

test("the compatibility predicate matches only the custom role and exact legacy type", () => {
  for (const display of [false, true, undefined]) {
    assert.equal(isGitWorkflowContextMessage({ role: "custom", customType, display, content: "anything" }), true);
  }
  for (const role of ["user", "assistant", "toolResult", "system", "branchSummary", "compactionSummary", undefined]) {
    assert.equal(isGitWorkflowContextMessage({ role, customType, content: "[Pi Web managed Git task]" }), false);
  }
  for (const type of ["pi-web:git-workflow", "pi-web:git-workflow-context:extra", "pi-web:git-workflow-context ", "PI-WEB:git-workflow-context", "other-extension", undefined]) {
    assert.equal(isGitWorkflowContextMessage({ role: "custom", customType: type, content: customType }), false);
  }
  for (const value of [null, undefined, "pi-web:git-workflow-context", 1, { type: "custom_message", customType }]) {
    assert.equal(isGitWorkflowContextMessage(value), false);
  }
});

test("filtering preserves quotations, tool pairs, unrelated extensions, summaries and raw history", () => {
  const kept = [
    { role: "system", content: "declaration", toolsAdded: [{ name: "read" }] },
    { role: "user", customType, content: `Explain '${customType}: Use git_workflow status'` },
    { role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: customType }] },
    { role: "custom", customType: "other-extension", content: "[Pi Web managed Git task]" },
    { role: "compactionSummary", summary: `Flattened reminder: ${customType}` },
    { role: "branchSummary", summary: "Use git_workflow status" },
  ];
  const raw = Object.freeze([Object.freeze({ role: "custom", customType, content: "old reminder" }), ...kept.map(Object.freeze)]);
  const before = structuredClone(raw);
  const filtered = filterGitWorkflowContext(raw);
  assert.deepEqual(filtered, kept);
  assert.deepEqual(raw, before);
  assert.notEqual(filtered, raw);
  filtered.forEach((message, index) => assert.equal(message, kept[index]));
});

test("host filter registers only the ordinary context hook, with no prompt, tools or resources", async () => {
  const handlers = new Map();
  const extension = createGitWorkflowContextFilterExtension();
  extension.factory({ on: (name, handler) => { handlers.set(name, handler); } });
  assert.equal(extension.hidden, true);
  assert.deepEqual([...handlers.keys()], ["context"]);
  const messages = [{ role: "custom", customType }, { role: "user", content: "hi" }];
  assert.deepEqual(await handlers.get("context")({ messages }), { messages: [messages[1]] });
  assert.equal(messages.length, 2);
});

test("Chat-only host registration adds only the filter, while subagents do not load Git guidance", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const resources = source.slice(source.indexOf("resourceLoaderOptions: subagentResources"), source.indexOf("const { session: inner }", source.indexOf("resourceLoaderOptions: subagentResources")));
  const chatOnly = resources.slice(resources.indexOf("...CHAT_ONLY_RESOURCE_LOADER_OPTIONS"), resources.indexOf("createProjectCommandBashExtension"));
  assert.match(chatOnly, /createGitWorkflowContextFilterExtension\(\)/);
  assert.doesNotMatch(chatOnly, /createGitWorkflowExtension|createGitCommitExtension|createGitWorkspaceStartExtension/);
  const subagent = resources.slice(0, resources.indexOf("...CHAT_ONLY_RESOURCE_LOADER_OPTIONS"));
  assert.doesNotMatch(subagent, /createGitWorkflowExtension|createGitWorkflowContextFilterExtension|createGitCommitExtension|createGitWorkspaceStartExtension/);
  const runtime = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /createGitWorkflowExtension|createGitCommitExtension|createGitWorkspaceStartExtension/);
});
