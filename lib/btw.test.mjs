import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { BTW_META_TYPE, BTW_CONTEXT_LIMIT, readBtwMetadata, btwQuestionText, captureBtwSnapshot } = await jiti.import('./btw.ts');
const { familyMembers, getSessionFamily, getAgentsBadge } = await jiti.import('./session-family.ts');
const { sessionFamiliesForWorktree } = await jiti.import('./session-worktree-filter.ts');
const { sessionFamilyGraph, effectiveSessionArchived } = await jiti.import('./session-worktrees-plan.ts');
const { encodeSessionCatalogue, decodeSessionCatalogue } = await jiti.import('./session-catalogue-wire.ts');
const { hiddenActivitySessionIds, getActivitySections } = await jiti.import('./activity.ts');
const info = (id, relation) => ({ id, path: `/saved/${id}`, cwd: '/repo', projectRoot: '/repo', projectKey: '/repo', firstMessage: 'Repeated contextual conversation reference '.repeat(10), created: '2026-01-01', modified: '2026-01-02', messageCount: 2, ...(relation ? { relation } : {}) });
const message = (role, content, id = role) => ({ type: 'message', id, message: { role, content } });

test('BTW metadata belongs only to its exact child and cannot attach a fork or self-cycle', () => {
  const data = { version: 1, sessionId: 'child', parentSessionId: 'parent', sourceLeafId: 'anchor', createdAt: 'now' };
  const entries = [{ type: 'custom', customType: BTW_META_TYPE, data }];
  assert.deepEqual(readBtwMetadata(entries, 'child'), data);
  assert.equal(readBtwMetadata(entries, 'fork'), null);
  assert.equal(readBtwMetadata([{ ...entries[0], data: { ...data, parentSessionId: 'child' } }], 'child'), null);
  assert.equal(readBtwMetadata([{ ...entries[0], data: { ...data, version: 2 } }], 'child'), null);
});

test('BTW reference is bounded inert text, excludes system/thinking/raw tool calls and request authority', () => {
  const question = btwQuestionText({ id: 'authority-id', method: 'ask_user_batch', title: 'Choose', questions: [{ id: 'q', question: 'Which?', type: 'text' }], responseToken: 'not-a-real-token' });
  const entries = [message('system', 'system-private'), message('user', 'Original task'), message('assistant', [
    { type: 'thinking', thinking: 'hidden-thinking' }, { type: 'toolCall', name: 'ask_user', id: 'tool-authority' }, { type: 'text', text: 'Please choose' },
  ]), message('toolResult', [{ type: 'text', text: 'completed reference output' }])];
  const before = JSON.stringify(entries);
  const snapshot = captureBtwSnapshot('parent', 'anchor', entries, question, 'fixed');
  assert.equal(snapshot.sourceLeafId, 'anchor'); assert.equal(snapshot.capturedAt, 'fixed');
  assert.match(snapshot.text, /Original task/); assert.match(snapshot.text, /Please choose/); assert.match(snapshot.text, /Which\?/);
  for (const forbidden of ['system-private', 'hidden-thinking', 'tool-authority', 'authority-id', 'responseToken']) assert.equal(snapshot.text.includes(forbidden), false, forbidden);
  assert.equal(JSON.stringify(entries), before, 'projection never modifies the source');
  const bounded = captureBtwSnapshot('parent', 'anchor', [message('user', 'x'.repeat(BTW_CONTEXT_LIMIT * 2))], question);
  assert.equal(bounded.truncated, true); assert.ok(bounded.text.length <= BTW_CONTEXT_LIMIT); assert.match(bounded.text, /Which\?/);
});

test('compacted BTW context includes its retained pre-compaction tail and inert approval text', () => {
  const snapshot = captureBtwSnapshot('parent', 'later', [message('user', 'Old omitted', 'old'), message('user', 'Retained question', 'kept'),
    { type: 'compaction', id: 'compact', summary: 'Earlier summary', firstKeptEntryId: 'kept' }, message('assistant', 'Later answer', 'later')]);
  assert.match(snapshot.text, /Earlier summary/); assert.match(snapshot.text, /Retained question/); assert.match(snapshot.text, /Later answer/); assert.doesNotMatch(snapshot.text, /Old omitted/);
  const question = btwQuestionText({ method: 'plugin_card', operationId: 'not-authority', title: 'Approve change', fields: [{ label: 'Effect', value: 'Change files' }], actions: [{ id: 'execute-capability', label: 'Approve' }] });
  assert.match(question, /Change files/); assert.match(question, /Approve/); assert.doesNotMatch(question, /not-authority|execute-capability/);
});

test('mixed family discovery retains BTW without agent counts, includes search/archive/move closure and privacy ancestry', () => {
  const root = { ...info('root'), archived: true };
  const sub = info('sub', { kind: 'subagent', parentSessionId: 'root', profile: 'explore', description: 'Explore', status: 'completed' });
  const btw = info('btw', { kind: 'btw', parentSessionId: 'sub', sourceLeafId: 'anchor' });
  const fork = info('fork', { kind: 'fork', originSessionId: 'root' });
  const rows = [root, sub, btw, fork], family = getSessionFamily(rows, 'btw');
  assert.equal(family.root.id, 'root'); assert.deepEqual(family.subagents.map(row => row.id), ['sub']); assert.deepEqual(family.btws.map(row => row.id), ['btw']);
  assert.deepEqual(familyMembers(family).map(row => row.id), ['root', 'sub', 'btw']);
  assert.deepEqual(getAgentsBadge(family.subagents, new Set(['btw'])), { count: 1, running: false });
  assert.deepEqual(sessionFamilyGraph(rows).family('root'), ['btw', 'root', 'sub']);
  assert.equal(effectiveSessionArchived(btw, new Map(rows.map(row => [row.id, row]))), true);
  assert.deepEqual(sessionFamiliesForWorktree(rows, null, null, 'archived').flatMap(familyMembers).map(row => row.id), ['root', 'sub', 'btw']);
  assert.equal(hiddenActivitySessionIds(rows, new Set(['/repo'])).has('btw'), true);
  const sections = getActivitySections(rows, new Set(['btw']), [], new Set());
  assert.equal(sections.working[0].parentName, 'Explore');
});

test('compact catalogue preserves BTW IDs, anchors and isolated relation objects', () => {
  const rows = Array.from({ length: 30 }, (_, index) => info(`child-${index}`, { kind: 'btw', parentSessionId: 'root', sourceLeafId: 'anchor' }));
  const wire = encodeSessionCatalogue(rows); assert.equal(wire.format, 1);
  const decoded = decodeSessionCatalogue(wire); assert.deepEqual(decoded, rows);
  decoded[0].relation.parentSessionId = 'changed'; assert.equal(wire.rows[0].relation.parentSessionId, 'root');
  wire.rows[0].relation.parentSessionId = 1;
  assert.throws(() => decodeSessionCatalogue(wire));
});
