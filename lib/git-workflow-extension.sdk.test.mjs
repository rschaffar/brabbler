import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { convertToLlm, createEventBus, createExtensionRuntime, ExtensionRunner, SessionManager } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url);
const { createGitWorkflowExtension, GIT_WORKFLOW_PROMPT_SECTION } = await jiti.import("./git-workflow-extension.ts");
const { createGitWorkflowContextFilterExtension } = await jiti.import("./git-workflow-context.ts");
const { createExactSystemPromptExtension } = await jiti.import("./exact-system-prompt.ts");
// SDK 0.87.1 helpers: the runner is public; the inline loader and prompt builders
// have only dist entry points. No services, model runtime, credentials or network.
const sdk = import.meta.resolve("@earendil-works/pi-coding-agent");
const { loadExtensionFromFactory } = await import(new URL("./core/extensions/loader.js", sdk));
const { buildSystemPrompt, buildSystemPromptState, buildSystemPromptSections, diffSystemPromptSections } = await import(new URL("./core/system-prompt.js", sdk));
const cwd = "/quiet-git-test";

async function runnerFor(t, inline, manager = SessionManager.inMemory(cwd)) {
  const runtime = createExtensionRuntime();
  runtime.getActiveTools = () => ["read", "write"];
  const bus = createEventBus();
  const extensions = [];
  for (const [index, extension] of inline.entries()) {
    extensions.push(await loadExtensionFromFactory(typeof extension === "function" ? extension : extension.factory, cwd, bus, runtime, `<inline:test-${index}>`));
  }
  const runner = new ExtensionRunner(extensions, runtime, cwd, manager, {});
  const errors = [];
  runner.onError((error) => errors.push(error));
  t.after(() => { assert.deepEqual(errors, []); runner.invalidate(); });
  return runner;
}

test("SDK runner composes named guidance with other prompt sections and emits no custom messages", async (t) => {
  let policy;
  let laterSawGuidance = false;
  const runner = await runnerFor(t, [
    (pi) => pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.before = "Earlier extension"; }),
    createGitWorkflowExtension(() => policy),
    (pi) => pi.on("before_agent_start", (event) => {
      laterSawGuidance = event.systemPrompt.includes(`<${GIT_WORKFLOW_PROMPT_SECTION}>`);
      event.systemPromptOptions.sections.after = "Later extension";
    }),
  ]);
  const base = {
    cwd, selectedTools: ["read", "write"], toolSnippets: { read: "Read tool" },
    promptGuidelines: ["Existing rule"], appendSystemPrompt: "Configured addendum",
    contextFiles: [{ path: "/repo/AGENTS.md", content: "Repository instructions" }],
    sections: { unrelated: "Other section" },
  };
  const first = await runner.emitBeforeAgentStart("Render a LaTeX example", undefined, base);
  assert.deepEqual(first.messages, []);
  assert.equal(laterSawGuidance, true);
  const prompt = buildSystemPrompt(first.systemPromptOptions);
  for (const preserved of ["Read tool", "Existing rule", "Configured addendum", "Repository instructions", "Other section", "Earlier extension", "Later extension"]) {
    assert.ok(prompt.includes(preserved));
  }
  assert.equal(prompt.split(`<${GIT_WORKFLOW_PROMPT_SECTION}>`).length, 2);
  const request = convertToLlm(await runner.emitContext([
    { role: "system", ...buildSystemPromptState(first.systemPromptOptions), toolsAdded: [tool("read"), tool("write")], timestamp: 1 },
    { role: "user", content: "Render a LaTeX example", timestamp: 2 },
  ]));
  assert.deepEqual(request.map((message) => message.role), ["system", "user"]);
  assert.equal(getCurrentSystemPrompt(request), prompt);
  assert.deepEqual(getCurrentTools(request).map((item) => item.name), ["read", "write"]);
  assert.equal(request.at(-1).content, "Render a LaTeX example");
  assert.deepEqual(base.sections, { unrelated: "Other section" }, "runner clones base options before mutation");
  const same = await runner.emitBeforeAgentStart("Fix this code", undefined, first.systemPromptOptions);
  assert.deepEqual(same.messages, []);
  assert.equal(diffSystemPromptSections(buildSystemPromptSections(first.systemPromptOptions), buildSystemPromptSections(same.systemPromptOptions)), undefined);
  policy = { mode: "current", branch: "feature", onCreate: "stay", commits: "manual" };
  const next = await runner.emitBeforeAgentStart("Fix this code", undefined, same.systemPromptOptions);
  const patch = diffSystemPromptSections(buildSystemPromptSections(same.systemPromptOptions), buildSystemPromptSections(next.systemPromptOptions));
  assert.deepEqual(Object.keys(patch), [GIT_WORKFLOW_PROMPT_SECTION]);
  assert.match(patch[GIT_WORKFLOW_PROMPT_SECTION], /on branch "feature"/);
});

test("SDK exact prompt composition remains exact, including empty, in either handler order", async (t) => {
  for (const exact of ["Only this profile", ""]) {
    for (const exactFirst of [true, false]) {
      const exactExtension = createExactSystemPromptExtension(() => exact);
      const guidance = createGitWorkflowExtension(() => undefined);
      const runner = await runnerFor(t, exactFirst ? [exactExtension, guidance] : [guidance, exactExtension]);
      const result = await runner.emitBeforeAgentStart("hello", undefined, { cwd });
      assert.deepEqual(result.messages, []);
      assert.equal(result.systemPromptOptions.forceSystemPrompt, exact);
      assert.equal(buildSystemPrompt(result.systemPromptOptions), exact);
      assert.deepEqual(buildSystemPromptState(result.systemPromptOptions), { content: exact });
      if (exactFirst) assert.equal(result.systemPromptOptions.sections[GIT_WORKFLOW_PROMPT_SECTION], undefined);
    }
  }
});

const legacyType = "pi-web:git-workflow-context";
const reminder = "OLD SYNTHETIC REMINDER: Use git_workflow status";
const tool = (name) => ({ name, description: name, parameters: { type: "object", properties: {} } });

function resumedBranch() {
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "system", content: "Original declaration", toolsAdded: [tool("read"), tool("edit")], timestamp: 1 });
  manager.appendMessage({ role: "user", content: "Earlier real request", timestamp: 2 });
  const legacyId = manager.appendCustomMessageEntry(legacyType, reminder, false);
  manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }], timestamp: 3 });
  manager.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "result" }], isError: false, timestamp: 4 });
  manager.appendMessage({ role: "system", content: "Later declaration", toolsAdded: [tool("write")], toolsRemoved: [{ name: "edit" }], timestamp: 5 });
  manager.appendCustomMessageEntry("unrelated-extension", "Keep the other extension", false);
  manager.appendMessage({ role: "user", content: `Explain this quotation: ${reminder}`, timestamp: 6 });
  const leaf = manager.appendMessage({ role: "user", content: "Render a LaTeX example", timestamp: 7 });
  manager.appendMessage({ role: "user", content: "Abandoned branch", timestamp: 8 });
  // Reload only fixture entries, then resume a non-tip branch; no live chat/files.
  const resumed = SessionManager.inMemory(cwd, undefined, [manager.getHeader(), ...manager.getEntries()]);
  resumed.branch(leaf);
  return { manager: resumed, legacyId };
}

test("SDK runner + convertToLlm filter resumed branch reminders without losing system declarations or raw history", async (t) => {
  for (const mode of ["ordinary", "chat-only"]) {
    const { manager, legacyId } = resumedBranch();
    const raw = structuredClone(manager.getEntries());
    const context = manager.buildSessionContext().messages;
    const before = structuredClone(context);
    const unfiltered = convertToLlm(context);
    assert.ok(unfiltered.some((message) => message.role === "user" && message.content?.[0]?.text === reminder), "SDK converts the old hidden reminder to a user message");
    const runner = await runnerFor(t, mode === "ordinary"
      ? [createGitWorkflowExtension(() => undefined)]
      : [createExactSystemPromptExtension(() => "Chat context only"), createGitWorkflowContextFilterExtension()], manager);
    const request = convertToLlm(await runner.emitContext(context));
    assert.equal(request[0].role, "system");
    // SDK 0.87.1 checkpoints the effective prompt/tools into one leading system
    // message when context changes. Preservation means replayed state, not placement.
    assert.deepEqual(request.filter((message) => message.role === "system"), [getCurrentSystemMessage(unfiltered)]);
    assert.equal(getCurrentSystemPrompt(request), getCurrentSystemPrompt(unfiltered));
    assert.deepEqual(getCurrentTools(request).map((item) => item.name), ["read", "write"]);
    assert.deepEqual(request.slice(1), unfiltered.filter((message) => message.role !== "system" && !(message.role === "user" && message.content?.[0]?.text === reminder)));
    const withoutReminder = context.filter((message) => !(message.role === "custom" && message.customType === legacyType));
    assert.deepEqual(await runner.emitContext(withoutReminder), withoutReminder, "no removal preserves original system deltas in place");
    assert.equal(request.filter((message) => message.role === "assistant").length, 1);
    assert.equal(request.filter((message) => message.role === "toolResult").length, 1);
    assert.match(JSON.stringify(request), /Explain this quotation: OLD SYNTHETIC REMINDER/);
    assert.doesNotMatch(JSON.stringify(request), /Abandoned branch/);
    assert.deepEqual(manager.getEntries(), raw);
    assert.deepEqual(context, before);
    assert.equal(manager.getEntry(legacyId).content, reminder);
  }
});

test("SDK summaries remain intact; this ordinary context hook does not scrub flattened reminders", async (t) => {
  const runner = await runnerFor(t, [createGitWorkflowExtension(() => undefined)]);
  const messages = [
    { role: "system", content: "Keep declarations", timestamp: 1 },
    { role: "compactionSummary", summary: reminder, tokensBefore: 1000, timestamp: 2 },
    { role: "branchSummary", summary: reminder, fromId: null, timestamp: 3 },
  ];
  assert.deepEqual(convertToLlm(await runner.emitContext(messages)), convertToLlm(messages));
});
