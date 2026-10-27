import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "../sse-stream.fixture.mjs";

function fixture() {
  const state = { enabled: true, enabledById: new Map(), settingsError: false, content: "Current policy", reads: 0 };
  const listeners = new Set();
  const { createPluginExtension } = loadTsModule(new URL("./runtime.ts", import.meta.url), {
    "./settings": {
      readPluginSettings(manifest) {
        state.reads++;
        if (state.settingsError) throw new Error("Invalid settings");
        return { enabled: state.enabledById.get(manifest.id) ?? state.enabled };
      },
      onPluginSettingsChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
  }).exports;
  const create = (id = "first", policyContext = () => state.content) => {
    const handlers = new Map();
    createPluginExtension({ id }, "/fixture", [], policyContext).factory({
      on(event, handler) { handlers.set(event, handler); },
      registerTool() {}, getActiveTools: () => [], setActiveTools() {},
    });
    return { handlers, transform(messages) {
      // Exercise the old tail implementation too, so the prefix regression is red
      // before the fix rather than merely failing because a hook was renamed.
      const handler = handlers.get("context_with_system") ?? handlers.get("context");
      return handler({ messages }, { cwd: "/fixture" }).messages;
    } };
  };
  return { state, create };
}
const system = { role: "system", content: "Base instructions", toolsAdded: [{ name: "probe" }], timestamp: 0 };
const user = { role: "user", content: "Original request", timestamp: 1 };
const assistant = { role: "assistant", content: [{ type: "toolCall", id: "probe-1", name: "probe", arguments: {} }], timestamp: 2 };
const toolResult = { role: "toolResult", toolCallId: "probe-1", toolName: "probe", content: [{ type: "text", text: "Result" }], timestamp: 3 };
const isPolicy = (message, id) => message.role === "custom" && message.customType === `brabbler:plugin-policy:${id}`;
const serialized = (messages) => JSON.stringify(messages);

test("unchanged policy preserves request prefixes as assistant/tool turns append", () => {
  const { create } = fixture(), plugin = create();
  const history = [system, user];
  const first = plugin.transform(history);
  const second = plugin.transform([...history, assistant, toolResult]);
  assert.equal(serialized(second.slice(0, first.length)), serialized(first));
  assert.deepEqual(history, [system, user], "never mutate canonical history");
  assert.equal(first[0], system);
  assert.equal(first[1], user);
  assert.ok(isPolicy(first[2], "first"), "policy stays after the first user, not at the moving tail");
  assert.equal(first[2].timestamp, 0, "request-only metadata is deterministic too");
  assert.equal(second.at(-2), assistant);
  assert.equal(second.at(-1), toolResult);
  const third = plugin.transform([...history, assistant, toolResult, { ...user, content: "Next user turn" }]);
  assert.equal(serialized(third.slice(0, second.length)), serialized(second));
});

test("full-transcript hook preserves every system/tool anchor and original message object", () => {
  const { create } = fixture(), plugin = create();
  assert.ok(plugin.handlers.has("context_with_system"));
  assert.equal(plugin.handlers.has("context"), false, "do not trigger SDK system-message collapsing");
  const tools = { role: "system", content: "", toolsAdded: [{ name: "later-tool" }], timestamp: 4 };
  const history = [system, user, assistant, toolResult, tools];
  const transformed = plugin.transform(history);
  const originals = transformed.filter((message) => !isPolicy(message, "first"));
  assert.deepEqual(originals, history);
  originals.forEach((message, index) => assert.equal(message, history[index]));
});

test("each request replaces stale or duplicate snapshots with current policy", () => {
  const { state, create } = fixture(), plugin = create();
  const first = plugin.transform([system, user]);
  const stale = first.find((message) => isPolicy(message, "first"));
  state.content = "Changed policy: deny";
  const before = state.reads;
  const next = plugin.transform([...first, assistant, toolResult, stale]);
  const policies = next.filter((message) => isPolicy(message, "first"));
  assert.equal(state.reads, before + 1);
  assert.equal(policies.length, 1);
  assert.equal(policies[0].content, "Changed policy: deny");
  assert.ok(!serialized(next).includes("Current policy"));
  assert.equal(next[0], system);
});

test("disable, empty context and errors cannot retain an old permissive snapshot", () => {
  const { state, create } = fixture(), plugin = create();
  const history = plugin.transform([system, user]);
  state.enabled = false;
  assert.equal(serialized(plugin.transform(history)), serialized([system, user]));
  state.enabled = true; state.content = undefined;
  assert.equal(serialized(plugin.transform(history)), serialized([system, user]));
  state.settingsError = true;
  const unavailable = plugin.transform(history);
  assert.match(unavailable.find((message) => isPolicy(message, "first")).content, /current policy is unavailable/);
  assert.ok(!serialized(unavailable).includes("Current policy"));
  state.settingsError = false;
  const failing = create("failing", () => { throw new Error("Policy lookup failed"); });
  assert.match(failing.transform([system, user]).find((message) => isPolicy(message, "failing")).content, /current policy is unavailable/);
});

test("multiple plugins form a stable anchored block and replace only their own policy", () => {
  const { create } = fixture(), first = create("first"), second = create("second", () => "Second policy");
  const transform = (messages) => second.transform(first.transform(messages));
  const initial = transform([system, user]);
  const next = transform([system, user, assistant, toolResult]);
  assert.equal(serialized(next.slice(0, initial.length)), serialized(initial));
  assert.deepEqual(initial.slice(2, 4).map((message) => message.customType), ["brabbler:plugin-policy:first", "brabbler:plugin-policy:second"]);
  assert.equal(serialized(transform(initial)), serialized(initial), "repeated transforms are idempotent");
});

test("a disabled sibling removes only its own snapshots while another plugin stays active", () => {
  const { state, create } = fixture(), first = create("first"), second = create("second", () => "Second policy");
  const transform = (messages) => second.transform(first.transform(messages));
  const initial = transform([system, user]);
  state.enabledById.set("first", false);
  const disabled = transform([...initial, initial.find((message) => isPolicy(message, "first"))]);
  assert.equal(disabled.some((message) => isPolicy(message, "first")), false);
  assert.equal(disabled.filter((message) => isPolicy(message, "second")).length, 1);
  assert.equal(disabled[2].content, "Second policy");
  state.enabledById.set("first", true);
  assert.equal(serialized(transform([system, user])), serialized(initial));
});

test("malformed imported sibling types cannot suppress fresh policy or an unavailable-policy warning", () => {
  const { state, create } = fixture(), plugin = create();
  const stale = plugin.transform([system, user]).find((message) => isPolicy(message, "first"));
  for (const customType of [undefined, null, 42]) {
    const malformed = { role: "custom", customType, content: "Imported entry" };
    state.settingsError = true;
    const transformed = plugin.transform([system, user, malformed, stale]);
    const policies = transformed.filter((message) => isPolicy(message, "first"));
    assert.equal(policies.length, 1);
    assert.match(policies[0].content, /current policy is unavailable/);
    assert.equal(transformed[3], malformed);
    state.settingsError = false;
    assert.equal(plugin.transform(transformed).find((message) => isPolicy(message, "first")).content, "Current policy");
  }
});

test("fresh anchors handle empty, compacted and branched histories without splitting tool pairs", () => {
  const { state, create } = fixture(), plugin = create();
  for (const history of [[], [system], [assistant, toolResult],
    [system, { role: "compactionSummary", summary: "Saved summary", tokensBefore: 1000, timestamp: 4 }, assistant, toolResult],
    [system, { role: "branchSummary", summary: "Branch summary", fromId: "other", timestamp: 4 }, assistant, toolResult],
    [system, { ...user, content: "Other branch" }]]) {
    state.content = "Current policy for this request";
    const transformed = plugin.transform(history);
    assert.equal(transformed.filter((message) => isPolicy(message, "first")).length, 1);
    const original = transformed.filter((message) => !isPolicy(message, "first"));
    assert.deepEqual(original, history);
    if (history[0]?.role === "system") assert.equal(transformed[0], system);
    const anchor = history.findIndex((message) => ["user", "compactionSummary", "branchSummary"].includes(message.role));
    const expectedIndex = anchor < 0 ? (history[0]?.role === "system" ? 1 : 0) : anchor + 1;
    assert.ok(isPolicy(transformed[expectedIndex], "first"));
    const toolIndex = transformed.indexOf(toolResult);
    if (toolIndex >= 0) assert.equal(transformed[toolIndex - 1], assistant);
  }
});
