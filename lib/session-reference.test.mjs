import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sessionDeepLink, referencedSessionIds } = await jiti.import("./session-reference.ts");
const { sessionReferenceExcerpt, createSessionReferenceExtension } = await jiti.import("./session-reference-extension.ts");
const ID = "aabbccdd-1234-5678-9abc-1234567890ab";
const OTHER = "bbccddee-1234-5678-9abc-1234567890ab";

function entry(role, content, index) {
  return { type: "message", id: String(index), parentId: null, message: { role, content } };
}

test("copied URL is an existing Brabbler deep link and pasted URLs resolve only explicit session IDs", () => {
  const link = sessionDeepLink("https://example.test:30141/other?cwd=/tmp", ID);
  assert.equal(link, `https://example.test:30141/?session=${ID}`);
  assert.deepEqual(referencedSessionIds(`See [this](${link}), /?session=${OTHER} and ${link}`), [ID, OTHER]);
  assert.deepEqual(referencedSessionIds(`https://example.test/foo?session=${ID} /?cwd=x&session=${ID} ${ID} https://example.test/?session=not-a-uuid`), []);
  assert.deepEqual(referencedSessionIds(`/?session=${ID} /?session=${OTHER}`, 1), [ID]);
});

test("session excerpt contains bounded active-branch conversation text, not tools, images or thinking", () => {
  const entries = [
    entry("system", "secret system prompt", 0),
    entry("user", [{ type: "text", text: "question" }, { type: "image", data: "base64secret" }], 1),
    entry("assistant", [{ type: "thinking", thinking: "private reasoning" }, { type: "toolCall", name: "read", arguments: {} }, { type: "text", text: "answer" }], 2),
    entry("toolResult", [{ type: "text", text: "tool secret" }], 3),
  ];
  const excerpt = sessionReferenceExcerpt(entries, ID);
  assert.match(excerpt, /user: question[\s\S]*assistant: answer/);
  assert.match(excerpt, /quoted conversation data/);
  for (const secret of ["secret system prompt", "base64secret", "private reasoning", "tool secret"]) {
    assert.doesNotMatch(excerpt, new RegExp(secret));
  }
  const long = Array.from({ length: 60 }, (_, n) => entry("user", `message${n} ${"x".repeat(2000)}`, n));
  const bounded = sessionReferenceExcerpt(long, ID);
  assert.ok(bounded.length < 34000);
  assert.doesNotMatch(bounded, /message0 /);
  assert.match(bounded, /message59 /);
  assert.match(bounded, /Earlier messages or long text may be omitted/);
});

test("explicit links inject a hidden bounded context message without rewriting the user prompt", async () => {
  const handlers = new Map();
  const requested = [];
  const extension = createSessionReferenceExtension(async (id) => { requested.push(id); return `excerpt for ${id}`; });
  extension.factory({ on: (name, fn) => handlers.set(name, fn) });
  const handler = handlers.get("before_agent_start");
  assert.equal(await handler({ messageType: "user", prompt: `Just a UUID ${ID}` }), undefined);
  const result = await handler({ messageType: "user", prompt: `Compare /?session=${ID} with /?session=${OTHER} and /?session=${ID}` });
  assert.deepEqual(requested, [ID, OTHER]);
  assert.equal(result.message.display, false);
  assert.equal(result.message.customType, "brabbler:session-references");
  assert.match(result.message.content, /excerpt for aabbccdd/);
  assert.match(result.message.content, /excerpt for bbccddee/);
  assert.deepEqual(await createHandler(async () => { throw new Error("private path"); })({ messageType: "user", prompt: `/?session=${ID}` }), {
    message: { customType: "brabbler:session-references", display: false, content: `Referenced local session ${ID} could not be read.` },
  });
});

test("custom-triggered runs do not interpret notification content as explicit user references", async () => {
  let loads = 0;
  const handler = createHandler(async () => { loads++; return "must not load"; });
  assert.equal(await handler({ messageType: "custom", message: {
    role: "custom", customType: "brabbler:subagent-complete", content: `/?session=${ID}`, display: true, timestamp: 1,
  } }), undefined);
  assert.equal(loads, 0);
});

function createHandler(load) {
  let handler;
  createSessionReferenceExtension(load).factory({ on: (_name, fn) => { handler = fn; } });
  return handler;
}

test("default handler resolves a saved local session and reports a missing one", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "brabbler-reference-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const sessionsDir = join(agentDir, "sessions", "project");
    await mkdir(sessionsDir, { recursive: true });
    const entries = [
      { type: "session", version: 3, id: ID, timestamp: "2026-01-01T00:00:00Z", cwd: agentDir },
      { ...entry("user", "original question", 1), timestamp: "2026-01-01T00:00:00Z" },
      { ...entry("assistant", [{ type: "text", text: "saved reply" }], 2), parentId: "1", timestamp: "2026-01-01T00:00:01Z" },
    ];
    await writeFile(join(sessionsDir, `2026-01-01T00-00-00Z_${ID}.jsonl`), entries.map((item) => JSON.stringify(item)).join("\n") + "\n");
    const result = await createHandler()({ messageType: "user", prompt: `Read /?session=${ID} and /?session=${OTHER}` });
    assert.match(result.message.content, /user: original question[\s\S]*assistant: saved reply/);
    assert.match(result.message.content, new RegExp(`Referenced local session ${OTHER} is unavailable`));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("host reference handler is available in normal and Chat-only sessions, without user extensions", async () => {
  const source = ts.createSourceFile("rpc-manager.ts", await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const options = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "resourceLoaderOptions") options.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(options.length, 1);
  assert.ok(ts.isConditionalExpression(options[0]));
  assert.equal(options[0].condition.getText(source), "subagentResources");
  const ordinary = options[0].whenFalse;
  assert.ok(ts.isConditionalExpression(ordinary));
  assert.equal(ordinary.condition.getText(source), "chatOnly");
  for (const [mode, branch] of [["chat-only", ordinary.whenTrue], ["normal", ordinary.whenFalse]]) {
    assert.ok(ts.isObjectLiteralExpression(branch));
    const factories = branch.properties.find((node) => ts.isPropertyAssignment(node) && node.name.getText(source) === "extensionFactories")?.initializer;
    assert.ok(factories && ts.isArrayLiteralExpression(factories));
    // It must be an unconditional host factory, not nested under
    // user-extension eligibility, and need not occupy a particular array slot.
    const calls = factories.elements.filter(ts.isCallExpression).map((node) => node.expression.getText(source));
    assert.equal(calls.filter((name) => name === "createSessionReferenceExtension").length, 1);
    if (mode === "chat-only") {
      assert.ok(factories.elements.some((node) => ts.isIdentifier(node) && node.text === "exactSystemPromptExtension"));
      assert.ok(!calls.includes("createBrabblerSourceExtension"));
    } else {
      assert.ok(calls.includes("createProjectCommandBashExtension"));
      assert.equal(calls.filter((name) => name === "createBrabblerSourceExtension").length, 1);
    }
  }
  assert.ok(ordinary.whenTrue.properties.some((node) => ts.isSpreadAssignment(node) && node.expression.getText(source) === "CHAT_ONLY_RESOURCE_LOADER_OPTIONS"));
  const { CHAT_ONLY_RESOURCE_LOADER_OPTIONS } = await jiti.import("./chat-only.ts");
  assert.equal(CHAT_ONLY_RESOURCE_LOADER_OPTIONS.noExtensions, true);
  assert.equal(ordinary.whenTrue.properties.some((node) => ts.isPropertyAssignment(node) && node.name.getText(source) === "noExtensions"), false, "Chat-only must not override user-extension suppression");
});
