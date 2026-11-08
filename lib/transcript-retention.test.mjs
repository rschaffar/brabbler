import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { retainTranscriptTail, LIVE_TRANSCRIPT_LIMITS } = await jiti.import('./transcript-retention.ts');
const { appendCompletedMessage } = await jiti.import('./live-transcript.ts');
const { buildSessionContext, deferMessageThinking, deferToolResultBase64Images } = await jiti.import('./session-context.ts');
const text = (value = 'body') => ({ role: 'assistant', content: [{ type: 'text', text: value }] });
const call = id => ({ role: 'assistant', content: [{ type: 'toolCall', toolCallId: id, toolName: 'bash', input: {} }] });
const result = id => ({ role: 'toolResult', toolCallId: id, content: [{ type: 'text', text: 'result' }] });
const transcript = messages => ({ messages, entryIds: messages.map((_, i) => `e${i}`) });

test('repeated completed live records retain a recent suffix, not every prior payload', () => {
  let current = transcript([]);
  for (let i = 0; i < 1200; i++) {
    current = retainTranscriptTail(appendCompletedMessage(current, text(`${i}:` + 'x'.repeat(20000)), `entry-${i}`));
    assert.equal(current.messages.length <= LIVE_TRANSCRIPT_LIMITS.maxMessages, true);
    assert.equal(current.messages.length, current.entryIds.length);
    if (i % 100 === 0) assert.equal(JSON.stringify(current.messages).length * 2 <= LIVE_TRANSCRIPT_LIMITS.maxBytes, true);
  }
  assert.equal(current.entryIds.at(-1), 'entry-1199');
  assert.equal(current.entryIds[0] === 'entry-0', false, 'old payloads are no longer owned');
});

test('byte budget applies below count limit, including UTF-16 surrogate pairs', () => {
  const original = transcript([text('😀'.repeat(200)), text('😀'.repeat(200)), text('😀'.repeat(200))]);
  const retained = retainTranscriptTail(original, new Set(), { maxMessages: 200, maxBytes: 2000 });
  assert.equal(retained.messages.length, 2);
  assert.equal(retained.messages[0] === original.messages[1], true, 'no payload copy');
  assert.equal(original.messages.length, 3, 'caller state remains immutable');
});

test('retention preserves transitive tool dependencies, active work and unreconciled records', () => {
  const original = transcript([text(), call('A'), call('B'), result('A'), result('B'), text()]);
  const retained = retainTranscriptTail(original, new Set(), { maxMessages: 3, maxBytes: 100000 });
  assert.deepEqual(retained.entryIds, ['e1', 'e2', 'e3', 'e4', 'e5'], 'a cut cannot strand either tool result');
  const active = transcript([text(), call('active'), text(), text()]);
  assert.deepEqual(retainTranscriptTail(active, new Set(['active']), { maxMessages: 1, maxBytes: 100000 }).entryIds, ['e1', 'e2', 'e3']);
  assert.deepEqual(retainTranscriptTail(active, new Set(), { maxMessages: 1, maxBytes: 100000 }, true).entryIds, ['e1', 'e2', 'e3'], 'unanswered calls remain pinned even after a missed start event');
  assert.deepEqual(retainTranscriptTail(active, new Set(), { maxMessages: 1, maxBytes: 100000 }, false).entryIds, ['e3'], 'authoritative settlement releases unanswered-call pins');
  active.entryIds[0] = '';
  assert.equal(retainTranscriptTail(active, new Set(), { maxMessages: 1, maxBytes: 1 }) === active, true, 'unreconciled live/optimistic content is never evicted');
  const huge = transcript([text(), text('x'.repeat(10000))]);
  assert.deepEqual(retainTranscriptTail(huge, new Set(), { maxMessages: 1, maxBytes: 100 }).entryIds, ['e1'], 'one indivisible oversize record remains accessible');
});

test('exclusive history cursor reloads the dropped prefix without loss or duplication', () => {
  const entries = Array.from({ length: 500 }, (_, i) => ({ type: 'message', id: `e${i}`, parentId: i ? `e${i - 1}` : null,
    timestamp: '2026-01-01T00:00:00Z', message: text(String(i)) }));
  const all = buildSessionContext(entries, 'e499');
  const retained = retainTranscriptTail(all, new Set(), { maxMessages: 100, maxBytes: 100000 });
  const cursor = retained.entryIds[0];
  const older = buildSessionContext(entries, cursor, { tail: 400, excludeLeaf: true });
  assert.deepEqual([...older.entryIds, ...retained.entryIds], entries.map(e => e.id));
});

test('persisted live thinking and images use reloadable history projections without changing originals', () => {
  const original = { role: 'assistant', content: [{ type: 'text', text: 'answer' }, { type: 'thinking', thinking: 'full thought '.repeat(10000) }] };
  const projected = deferMessageThinking(original);
  assert.equal(projected.content.length, original.content.length, 'stored block indices remain stable');
  assert.equal(projected.content[1].deferred, true);
  assert.equal(projected.content[1].thinking.length < 1000, true);
  assert.equal(original.content[1].thinking.length, 130000);
  assert.equal(deferMessageThinking(projected) === projected, true);
  const image = { role: 'toolResult', toolCallId: 'image', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] };
  const lazy = deferToolResultBase64Images(image, 'session', 'entry');
  assert.equal(lazy.content[0].source.url, '/api/sessions/session/entries/entry/tool-result-image?blockIndex=0');
  assert.equal(image.content[0].source.data, 'aGVsbG8=');
});
