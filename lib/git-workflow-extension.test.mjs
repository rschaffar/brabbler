import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createGitWorkflowExtension, GIT_WORKFLOW_PROMPT_SECTION } = await jiti.import("./git-workflow-extension.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS, resolveGitWorkflowSettings } = await jiti.import("./git-workflow-settings.ts");
const { buildSystemPrompt, normalizeBuildSystemPromptOptions } = await import(
  new URL("./core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent"))
);

function load(getPolicy = () => undefined, getState, getActiveTools = () => ["read", "bash", "edit", "write"]) {
  const handlers = new Map();
  const extension = createGitWorkflowExtension(getPolicy, getState);
  extension.factory({
    on: (event, handler) => { handlers.set(event, handler); },
    getActiveTools,
  });
  assert.equal(extension.hidden, true);
  assert.deepEqual([...handlers.keys()].sort(), ["before_agent_start", "context"]);
  return handlers.get("before_agent_start");
}

function event(prompt = "hello", options = {}) {
  return {
    type: "before_agent_start", prompt,
    systemPromptOptions: normalizeBuildSystemPromptOptions({ cwd: "/repo", sections: { unrelated: "Keep this section" }, ...options }),
  };
}

async function guidance(handler, input = event()) {
  assert.equal(await handler(input), undefined, "mutate sections in place; return neither message nor prompt options");
  return input.systemPromptOptions.sections[GIT_WORKFLOW_PROMPT_SECTION];
}

function state(taskSettings = {}, liveSettings = {}) {
  const resolution = resolveGitWorkflowSettings(liveSettings);
  return {
    revision: "test", paused: false, global: {}, project: {}, session: {}, sessionEditable: true,
    resolved: { global: resolution, project: resolution, session: resolution },
    task: { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, ...taskSettings } },
  };
}

const policy = {
  mode: "worktree", baseBranch: "rst-main", onCreate: "continue", commits: "agent",
  integration: { targetBranch: "rst-main", method: "merge" },
};

function assertConditional(text) {
  assert.match(text, /^Conditional Git guidance, not a request to do work\./);
  assert.match(text, /ordinary question, rendered example, or explanation directly/);
  assert.match(text, /without Git setup, status checks, or approval questions/);
  assert.doesNotMatch(text, /Use git_workflow status|Captured task settings:|configure early choices/i);
}

test("live policy replaces one named system section without synthetic messages or duplicate sections", async () => {
  let current;
  const handler = load(() => current);
  const input = event();
  const sections = input.systemPromptOptions.sections;
  assert.match(GIT_WORKFLOW_PROMPT_SECTION, /^[a-z][a-z0-9_-]*$/);
  assertConditional(await guidance(handler, input));
  current = policy;
  const text = await guidance(handler, input);
  assert.match(text, /continue this chat/);
  assert.match(text, /exact-state human approval/);
  assert.match(text, /stricter repository\/user instructions/);
  assert.match(text, /git_workflow status is optional/);
  assert.equal(input.systemPromptOptions.sections, sections);
  assert.equal(sections.unrelated, "Keep this section");
  assert.deepEqual(Object.keys(sections), ["unrelated", GIT_WORKFLOW_PROMPT_SECTION]);
  assert.equal(buildSystemPrompt(input.systemPromptOptions).split(`<${GIT_WORKFLOW_PROMPT_SECTION}>`).length, 2);
  current = null;
  assert.match(await guidance(handler, input), /No session Git workflow preferences are saved/);
  assert.doesNotMatch(sections[GIT_WORKFLOW_PROMPT_SECTION], /rst-main|continue this chat/);
});

test("LaTeX and coding prompts receive the same conditional guidance without classification", async () => {
  for (const handler of [load(() => policy), load(() => undefined, async () => state())]) {
    const latex = await guidance(handler, event("Show a rendered LaTeX example of the quadratic formula."));
    const coding = await guidance(handler, event("Implement a parser fix in this repository."));
    assert.equal(latex, coding);
    assertConditional(latex);
    const unreadPrompt = event();
    Object.defineProperty(unreadPrompt, "prompt", { get: () => { throw new Error("must not classify prompts"); } });
    assert.equal(await guidance(handler, unreadPrompt), latex);
  }
});

test("managed guidance keeps concise captured facts, not settings JSON, commands, or a live Ask grant", async () => {
  const saved = state({ workspace: "worktree", baseBranch: "rst-main", targetBranch: "release", checks: [{ label: "check", argv: ["do-not-dump-this-command"] }] });
  const text = await guidance(load(() => { throw new Error("must use managed state"); }, async () => saved));
  assertConditional(text);
  assert.match(text, /linked worktree from local branch "rst-main"/);
  assert.match(text, /Captured commit preference: Ask .*not a live grant/);
  assert.match(text, /integration target: "release"; method: merge; configured checks: 1/);
  assert.match(text, /Changed defaults do not retarget a captured task/);
  assert.doesNotMatch(text, /do-not-dump-this-command|"enabled"|"checks"|"onCreate"/);
  assert.match(text, /Creation requires exact confirmation; captured after-create preference: continue/);
  assert.doesNotMatch(text, /CREATE-ONLY|may supply baseBranch/);
});

test("missing base permits only a requested explicit creation proposal, while mismatches stay blockers", async () => {
  let current = state({ workspace: "worktree", baseBranch: null });
  const handler = load(() => undefined, async () => current);
  const text = await guidance(handler);
  assert.match(text, /If the current request needs worktree creation, git_workspace_start may supply baseBranch as one explicit creation proposal only for this missing-base managed worktree/);
  assert.match(text, /Creation requires exact confirmation and is CREATE-ONLY: no chat movement and no settings write/);
  assert.match(text, /cannot override a captured base; mismatches remain blockers/);
  current = state({ workspace: "current", branch: "feature" });
  const currentText = await guidance(handler);
  assert.match(currentText, /on branch "feature"; a branch mismatch blocks the operation/);
  assert.doesNotMatch(currentText, /may supply baseBranch/);
});

test("live state selects legacy or absent task preferences without falling back to changed defaults", async () => {
  let current = { ...state(), task: { kind: "legacy", policy: { ...policy, onCreate: "fork" } } };
  const handler = load(() => { throw new Error("must use the live state"); }, async () => current);
  const input = event();
  assert.match(await guidance(handler, input), /fork this chat into it/);
  current = { ...state({}, { commits: "off" }), task: current.task };
  assert.match(await guidance(handler, input), /Live commit restriction: off/);
  for (const task of [{ kind: "legacy", policy: null }, { kind: "none" }]) {
    current = { ...state(), task };
    const text = await guidance(handler, input);
    assertConditional(text);
    assert.match(text, /No session Git workflow preferences are saved/);
    assert.doesNotMatch(text, /rst-main|fork this chat|Captured commit preference/);
  }
});

test("pause, session/project disablement and captured-task disablement refresh on each run", async () => {
  let current = state();
  const handler = load(() => undefined, async () => current);
  const input = event();
  assert.match(await guidance(handler, input), /Captured commit preference: Ask/);
  for (const [next, expected] of [
    [{ ...state(), paused: true }, /actions are paused/],
    [state({}, { enabled: false }), /disabled for this project\/chat/],
    [{ ...state(), projectSessionRestrictions: { enabled: false } }, /disabled for this project\/chat/],
    [state({ enabled: false }), /captured managed Git task is disabled/],
    [{ ...state(), sessionScope: "project" }, /Explicit-project scope is read-only/],
  ]) {
    current = next;
    const text = await guidance(handler, input);
    assertConditional(text);
    assert.match(text, expected);
    assert.match(text, /Do not invoke managed Git mutation tools or bypass/);
    assert.doesNotMatch(text, /Captured commit preference: Ask/);
  }
  current = state();
  assert.match(await guidance(handler, input), /Captured commit preference: Ask/);
});

test("captured Ask does not conceal live commit restrictions or manual/off captured choices", async () => {
  for (const current of [state({}, { commits: "off" }), { ...state(), projectSessionRestrictions: { commits: "manual" } }]) {
    const text = await guidance(load(() => undefined, async () => current));
    assert.match(text, /Captured commit preference: Ask .*not a live grant/);
    assert.match(text, /Live commit restriction: (off|manual)\. Agent commits are blocked/);
  }
  for (const commits of ["manual", "off"]) {
    const text = await guidance(load(() => undefined, async () => state({ commits })));
    assert.match(text, new RegExp(`Captured commit preference: ${commits}\\. Agent commits are blocked`));
  }
});

test("live active tools determine read-only guidance, without changing tools or loading settings", async () => {
  let tools = ["read", "write"];
  let reads = 0;
  const handler = load(() => policy, async () => { reads++; return state(); }, () => tools);
  assert.match(await guidance(handler), /Captured commit preference: Ask/);
  for (const selection of [[], ["read", "grep", "find", "ls"], ["git_commit", "custom_tool"]]) {
    tools = selection;
    const text = await guidance(handler);
    assertConditional(text);
    assert.match(text, /read-only tool selection/);
    assert.match(text, /Do not invoke managed Git mutation tools or bypass/);
    assert.equal(reads, 1);
  }
  tools = ["powershell"];
  assert.match(await guidance(handler), /Captured commit preference: Ask/);
  assert.equal(reads, 2);
});

test("unavailable guidance catches rejected and synchronously throwing loaders and tool lookup", async () => {
  const fail = () => { throw new Error("private failure detail"); };
  for (const handler of [load(fail), load(() => policy, fail), load(() => policy, async () => fail()), load(() => policy, undefined, fail)]) {
    const text = await guidance(handler);
    assertConditional(text);
    assert.match(text, /unavailable or unsupported\. Managed Git actions are blocked/);
    assert.match(text, /Do not invoke managed Git mutation tools or bypass/);
    assert.doesNotMatch(text, /private failure detail/);
  }
});

test("an exact system prompt, including empty, is untouched and skips preference/tool lookup", async () => {
  const fail = () => { throw new Error("not needed for exact prompts"); };
  const handler = load(fail, fail, fail);
  for (const exact of ["Exact profile prompt", ""]) {
    const input = event("hi", { forceSystemPrompt: exact });
    const before = structuredClone(input.systemPromptOptions);
    assert.equal(await handler(input), undefined);
    assert.deepEqual(input.systemPromptOptions, before);
    assert.equal(buildSystemPrompt(input.systemPromptOptions), exact);
  }
});
