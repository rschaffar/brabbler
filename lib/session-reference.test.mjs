import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sessionDeepLink, referencedSessionIds } = await jiti.import("./session-reference.ts");
const { sessionReferenceExcerpt, createSessionReferenceExtension } = await jiti.import("./session-reference-extension.ts");
const ID = "aabbccdd-1234-5678-9abc-1234567890ab";
const OTHER = "bbccddee-1234-5678-9abc-1234567890ab";

function entry(role, content, index) {
  return { type: "message", id: String(index), parentId: null, message: { role, content } };
}

test("copied URL is an existing Pi Web deep link and pasted URLs resolve only explicit session IDs", () => {
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
  assert.equal(await handler({ prompt: `Just a UUID ${ID}` }), undefined);
  const result = await handler({ prompt: `Compare /?session=${ID} with /?session=${OTHER} and /?session=${ID}` });
  assert.deepEqual(requested, [ID, OTHER]);
  assert.equal(result.message.display, false);
  assert.equal(result.message.customType, "pi-web:session-references");
  assert.match(result.message.content, /excerpt for aabbccdd/);
  assert.match(result.message.content, /excerpt for bbccddee/);
  assert.deepEqual(await createHandler(async () => { throw new Error("private path"); })({ prompt: `/?session=${ID}` }), {
    message: { customType: "pi-web:session-references", display: false, content: `Referenced local session ${ID} could not be read.` },
  });
});

function createHandler(load) {
  let handler;
  createSessionReferenceExtension(load).factory({ on: (_name, fn) => { handler = fn; } });
  return handler;
}

test("default handler resolves a saved local session and reports a missing one", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-reference-"));
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
    const result = await createHandler()({ prompt: `Read /?session=${ID} and /?session=${OTHER}` });
    assert.match(result.message.content, /user: original question[\s\S]*assistant: saved reply/);
    assert.match(result.message.content, new RegExp(`Referenced local session ${OTHER} is unavailable`));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("host reference handler is available in normal and Chat-only sessions, without user extensions", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /CHAT_ONLY_RESOURCE_LOADER_OPTIONS, extensionFactories: \[checkoutGuard, exactSystemPromptExtension, createSessionReferenceExtension\(\), createGitWorkflowContextFilterExtension\(\)\]/);
  assert.match(source, /extensionFactories: \[\s*checkoutGuard,\s*createSessionReferenceExtension\(\),\s*createProjectCommandBashExtension/);
});
