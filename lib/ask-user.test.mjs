import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { coerceAskUserOption, normalizeAskUserAnswer, parseAskUserPreference } = await jiti.import("./ask-user.ts");
const { createAskUserExtension, preferPiWebAskUserExtension } = await jiti.import("./ask-user-extension.ts");
const question = { question: "Choose", options: [{ title: "One" }, { title: "Two" }], allowMultiple: false, allowFreeform: true, allowComment: true, contextExpanded: false };

function loadTool() {
  let tool;
  const events = [];
  createAskUserExtension().factory({
    registerTool(value) { tool = value; },
    events: { emit(name, payload) { events.push({ name, payload }); } },
  });
  return { tool, events };
}

test("option aliases and web answer validation preserve the installed answer contract", () => {
  assert.deepEqual(coerceAskUserOption({ label: " One ", description: "Details" }), { title: "One", description: "Details" });
  assert.deepEqual(coerceAskUserOption(" Two "), { title: "Two" });
  assert.equal(coerceAskUserOption({ title: " " }), null);
  assert.equal(parseAskUserPreference("yes"), true);
  assert.equal(parseAskUserPreference("junk"), undefined);
  assert.deepEqual(normalizeAskUserAnswer({ kind: "selection", selections: ["Two"], comment: " Note " }, question), { kind: "selection", selections: ["Two"], comment: "Note" });
  assert.deepEqual(normalizeAskUserAnswer({ kind: "freeform", text: " Reply " }, question), { kind: "freeform", text: "Reply" });
  for (const answer of [
    { kind: "selection", selections: ["Missing"] },
    { kind: "selection", selections: ["One", "Two"] },
    { kind: "selection", selections: ["One", "One"] },
    { kind: "selection", selections: [] },
    { kind: "freeform", text: "   " },
  ]) assert.equal(normalizeAskUserAnswer(answer, question), null);
  assert.deepEqual(normalizeAskUserAnswer({ kind: "selection", selections: ["One"], comment: "private" }, { ...question, allowComment: false }), { kind: "selection", selections: ["One"] });
});

test("web tool keeps sequential schema, redacted events, response details and cancellation", async () => {
  const { tool, events } = loadTool();
  assert.equal(tool.name, "ask_user");
  assert.equal(tool.executionMode, "sequential");
  assert.deepEqual(tool.parameters.properties.displayMode.enum, ["overlay", "inline"]);
  let received;
  const ui = { askUser: async (q, timeout, signal) => {
    received = { q, timeout, signal };
    return { kind: "selection", selections: ["Two"], comment: "Detail" };
  } };
  const controller = new AbortController();
  const result = await tool.execute("call", { question: "Choose", context: " Context ", options: [{ title: "One" }, { title: "Two" }], allowComment: true, timeout: 500 }, controller.signal, undefined, { hasUI: true, ui });
  assert.equal(received.q.context, "Context");
  assert.equal(received.timeout, 500);
  assert.equal(received.signal, controller.signal);
  assert.deepEqual(result.details.response, { kind: "selection", selections: ["Two"], comment: "Detail" });
  assert.match(result.content[0].text, /Two — Detail/);
  assert.deepEqual(events.find(({ name }) => name === "ask:answered")?.payload, { question: "Choose", response: { kind: "selection" } });
  ui.askUser = async () => null;
  const cancelled = await tool.execute("call2", { question: "Choose", options: [{ title: "One" }] }, undefined, undefined, { hasUI: true, ui });
  assert.equal(cancelled.details.cancelled, true);
  assert.deepEqual(events.find(({ name }) => name === "ask:cancelled")?.payload, { question: "Choose" });
});

test("context starts expanded unless the tool argument or environment overrides it", async () => {
  const { tool } = loadTool();
  const context = "More background. ".repeat(30);
  const previous = process.env.PI_ASK_USER_CONTEXT_EXPANDED;
  try {
    for (const [env, override, expected] of [
      [undefined, undefined, true], ["invalid", undefined, true],
      ["false", undefined, false], ["true", undefined, true],
      ["true", false, false], ["false", true, true],
      [undefined, false, false],
    ]) {
      if (env === undefined) delete process.env.PI_ASK_USER_CONTEXT_EXPANDED;
      else process.env.PI_ASK_USER_CONTEXT_EXPANDED = env;
      let received;
      await tool.execute("context", { question: "Choose", context, ...(override === undefined ? {} : { contextExpanded: override }) },
        undefined, undefined, { hasUI: true, ui: { askUser: async (q) => { received = q; return null; } } });
      assert.equal(received.contextExpanded, expected);
      assert.equal(received.context, context.trim());
    }
  } finally {
    if (previous === undefined) delete process.env.PI_ASK_USER_CONTEXT_EXPANDED;
    else process.env.PI_ASK_USER_CONTEXT_EXPANDED = previous;
  }
});

test("malformed lists fail without opening UI", async () => {
  const { tool } = loadTool();
  const failed = await tool.execute("call", { question: "Choose", options: [{ nope: true }] }, undefined, undefined, { hasUI: true, ui: { askUser: () => { throw new Error("must not call"); } } });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /malformed/);
});

test("recognized external package is replaced, unrelated tool collisions remain visible", () => {
  const host = { path: "<inline:pi-web-ask-user>", tools: new Map([["ask_user", {}]]) };
  const nix = { path: "/nix/store/abcdefghijklmnopqrstuvwxyz123456-pi-ask-user-0.15.0/index.ts", tools: new Map([["ask_user", {}]]) };
  const other = { path: "/custom/tool.ts", tools: new Map([["ask_user", {}]]) };
  const base = { extensions: [host, nix, other], errors: [
    { path: host.path, error: `Tool "ask_user" conflicts with ${nix.path}` },
    { path: host.path, error: `Tool "ask_user" conflicts with ${other.path}` },
  ] };
  const preferred = preferPiWebAskUserExtension(base);
  assert.deepEqual(preferred.extensions, [host, other]);
  assert.deepEqual(preferred.errors, [base.errors[1]]);
  assert.equal(preferPiWebAskUserExtension({ ...base, extensions: [nix] }).extensions[0], nix);
});
