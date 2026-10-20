import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { appendCompletedMessage } = await jiti.import("./live-transcript.ts");
const { userMessageKey } = await jiti.import("./prompt-recovery.ts");
const user = (content) => ({ role: "user", content });

test("an unchanged optimistic prompt gains its saved ID without another bubble", () => {
  const prompt = user("do this");
  const current = { messages: [user("prior"), prompt], entryIds: ["prior-id", ""] };
  const next = appendCompletedMessage(current, { ...prompt, timestamp: 100 }, "saved", userMessageKey(prompt));
  assert.equal(next.messages, current.messages);
  assert.deepEqual(next.entryIds, ["prior-id", "saved"]);
  assert.deepEqual(current.entryIds, ["prior-id", ""]);
});

test("transformed prompts and repeated queue deliveries retain distinct saved targets", () => {
  const prompt = user("original");
  const delivered = user("expanded");
  let next = appendCompletedMessage({ messages: [prompt], entryIds: [""] }, delivered, "first", userMessageKey(prompt));
  assert.deepEqual(next, { messages: [delivered], entryIds: ["first"] });
  next = appendCompletedMessage(next, delivered, "second");
  assert.deepEqual(next, { messages: [delivered, delivered], entryIds: ["first", "second"] });
  const other = user("not the optimistic prompt");
  assert.deepEqual(appendCompletedMessage({ messages: [other], entryIds: ["other"] }, delivered, "third", userMessageKey(prompt)),
    { messages: [other, delivered], entryIds: ["other", "third"] });
});

test("assistant/tool messages keep IDs aligned and unknown IDs stay non-navigable", () => {
  const assistant = { role: "assistant", content: [] };
  const tool = { role: "toolResult", toolCallId: "tool", content: [] };
  let next = appendCompletedMessage({ messages: [], entryIds: [] }, assistant, "answer");
  next = appendCompletedMessage(next, tool, "result");
  next = appendCompletedMessage(next, user("no saved target"), "");
  assert.deepEqual(next, { messages: [assistant, tool, user("no saved target")], entryIds: ["answer", "result", ""] });
});
