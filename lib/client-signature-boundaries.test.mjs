import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { toClientAgentEvent } = await jiti.import("./agent-event-wire.ts");
const { buildSessionContext } = await jiti.import("./session-context.ts");
const { projectTreeForResponse } = await jiti.import("./project-tree.ts");

test("browser history, trees and start/end/tool events omit signatures without mutating either session", () => {
  for (const id of ["session-a", "session-b"]) {
    const signature = "synthetic-provider-replay-"+id;
    const block = Object.freeze({ type: "text", text: "Visible "+id, textSignature: signature });
    const message = Object.freeze({ role: "assistant", content: Object.freeze([block]), timestamp: 1, stopReason: "stop", usage: { input: 1, output: 1 } });
    const entry = Object.freeze({ id, parentId: null, type: "message", timestamp: "2026-01-01T00:00:00Z", message });
    for (const type of ["message_start", "message_end"]) {
      const projected = toClientAgentEvent({ type, message });
      assert.equal(projected.message.content[0].textSignature, undefined);
      assert.equal(projected.message.content[0].text, "Visible "+id);
    }
    const context = buildSessionContext([entry], id, { deferThinking: true });
    assert.equal(context.messages[0].content[0].textSignature, undefined);
    assert.equal(context.entryIds[0], id);
    const tree = projectTreeForResponse([{ entry, children: [] }], id);
    assert.equal(tree[0].entry.message.content[0].textSignature, undefined);
    assert.equal(entry.message.content[0].textSignature, signature, "raw replay/durable entry is untouched");
    assert.equal(message.content[0], block);
  }
  const toolCall = Object.freeze({ type: "toolCall", id: "tool", name: "read", arguments: { thoughtSignature: "user data" }, thoughtSignature: "synthetic-provider-signature" });
  const event = toClientAgentEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall } });
  assert.equal(event.assistantMessageEvent.toolCall.thoughtSignature, undefined);
  assert.equal(event.assistantMessageEvent.toolCall.arguments.thoughtSignature, "user data");
});
