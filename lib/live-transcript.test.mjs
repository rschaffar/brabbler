import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { fsCache: false });
const { appendCompletedMessage, mergeCanonicalTranscript } = await jiti.import("./live-transcript.ts");
const { userMessageKey } = await jiti.import("./prompt-recovery.ts");
const user = (content) => ({ role: "user", content });

test("overlapping canonical recovery keeps the reader prefix and concurrent live suffix without swallowing statistics", () => {
  const current = { messages: ['older', 'shared', 'new-live'].map(content => ({ ...user(content), timestamp: 1 })), entryIds: ['a', 'b', 'd'] };
  const saved = { messages: [user('shared-authoritative'), user('missed SSE')], entryIds: ['b', 'c'] };
  const merged = mergeCanonicalTranscript(current, saved, true);
  assert.deepEqual(merged.transcript.entryIds, ['a', 'b', 'c', 'd']);
  assert.equal(merged.transcript.messages[0] === current.messages[0], true);
  assert.equal(merged.transcript.messages[1] === saved.messages[0], true);
  assert.deepEqual(merged.extraMessages.map(message => message.content), ['new-live'], 'only post-snapshot additions are a stats delta, not old loaded history');
});

test("canonical leading records fill a gap after an older reader prefix instead of being clipped as overshoot", () => {
  const current = { messages: [user('a'), user('c')], entryIds: ['a', 'c'] };
  const saved = { messages: [user('b'), user('c'), user('d')], entryIds: ['b', 'c', 'd'] };
  assert.deepEqual(mergeCanonicalTranscript(current, saved, false).transcript.entryIds, ['a', 'b', 'c', 'd']);
});

test("canonical reconciliation assigns optimistic IDs, preserves distinct queued text and retains newer pending input", () => {
  const sent = { ...user('same'), timestamp: 20 }, newer = { ...user('same'), timestamp: 40 };
  const saved = { messages: [{ ...sent, timestamp: 30 }, user('answer')], entryIds: ['sent', 'answer'] };
  const current = { messages: [sent, newer], entryIds: ['', ''] };
  const merged = mergeCanonicalTranscript(current, saved, true).transcript;
  assert.deepEqual(merged.entryIds, ['sent', 'answer', '']);
  assert.equal(merged.messages.at(-1) === newer, true);
  assert.deepEqual(mergeCanonicalTranscript(current, saved, false).transcript.entryIds, ['sent', 'answer'], 'settled authoritative recovery replaces unreconciled envelopes');
});

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
