import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { reduceReview, emptyReviewState, currentAnswer, currentMark, feedbackItems, validateReply, validateOperation, batchPrompt } = await jiti.import('./notebook-review.ts');
const { normalizeSetAnswer } = await jiti.import('./question-set.ts');
const { parseNotebookChapter, stepProse } = await jiti.import('./guided-review.ts');
const { prepareReviewDraft } = await jiti.import('./review-handoff.ts');
const { parseReviewDraft, freshReviewDraft } = await jiti.import('./notebook-review-drafts.ts');
const hash = 'a'.repeat(64), nextHash = 'b'.repeat(64);
const q = { id: 'constructor', shortLabel: 'Q', question: 'Inspect?', type: 'text', required: true, options: [] };
const material = { stepId: 'toString', title: 'Step', chapterPath: 'one.md', prose: 'Prose', guidanceFingerprint: nextHash, fingerprint: hash, questions: [{ definition: q, fingerprint: hash }], targets: [], unavailable: [] };
test('actual reducer keeps required outcome presence separate from live validation and review state', () => {
  let state = emptyReviewState();
  assert.equal(normalizeSetAnswer({ id: q.id, kind: 'skipped' }, q), null);
  assert.throws(() => reduceReview(state, { kind: 'mark', stepId: 'toString', fingerprint: hash, mark: 'Reviewed' }, 'm0', material), /Required/);
  for (const kind of ['unsure', 'not-applicable', 'skip']) {
    state = reduceReview(state, { kind: 'answer', stepId: 'toString', questionId: 'constructor', fingerprint: hash, outcome: { kind } }, `a-${kind}`, material);
    assert.equal(currentAnswer(state, 'toString', 'constructor', hash).outcome.kind, kind);
    assert.equal(currentMark(state, 'toString', hash).mark, 'Not reviewed');
  }
  state = reduceReview(state, { kind: 'mark', stepId: 'toString', fingerprint: hash, mark: 'Reviewed' }, 'mark', material);
  assert.equal(currentMark(state, 'toString', nextHash).stale, true);
  assert.equal(currentMark(state, 'toString', null).stale, false, 'Unavailable does not invent a content change');
  assert.throws(() => reduceReview(state, { kind: 'mark', stepId: 'toString', fingerprint: nextHash, mark: 'Reviewed' }, 'fresh', { ...material, fingerprint: nextHash, questions: [{ definition: { ...q, question: 'New?' }, fingerprint: nextHash }] }), /Required/);
  assert.equal(state.events.length, 4);
});
test('frozen items, stale/partial replies, immutable deleted anchors and reviewer-only resolution', () => {
  const item = { id: 'constructor', version: 1, kind: 'finding', text: 'Concern', resolved: false, anchor: { stepId: 'toString', fingerprint: hash } };
  let state = reduceReview(emptyReviewState(), { kind: 'feedback', item }, 'f1', material);
  const batch = { id: 'batch', items: [item], materials: [material], destination: { id: 'session', label: 'Existing' }, replyPath: '/notebook/review-data/replies/batch.json' };
  state = reduceReview(state, { kind: 'prepare', batch }, 'b1', null);
  const reply = { version: 1, batchId: 'batch', items: [{ id: item.id, version: 1, fingerprint: hash, response: 'Investigated', evidence: 'Pinned object', proposedChanges: 'None' }] };
  for (const bad of [{ ...reply, resolved: true }, { ...reply, items: [reply.items[0], reply.items[0]] }]) assert.throws(() => validateReply(bad));
  assert.throws(() => reduceReview(state, { kind: 'import', batchId: 'batch', digest: hash, reply: { ...reply, items: [{ ...reply.items[0], version: 2 }] } }, 'bad', null), /stale/);
  state = reduceReview(state, { kind: 'import', batchId: 'batch', digest: hash, reply }, 'reply', null);
  assert.equal(feedbackItems(state)[0].resolved, false);
  state = reduceReview(state, { kind: 'feedback', item: { ...item, version: 2, text: 'Edited after step deleted' } }, 'f2', null);
  state = reduceReview(state, { kind: 'resolve', id: 'constructor', version: 2, resolved: true }, 'resolve', null);
  assert.equal(feedbackItems(state)[0].version, 3);
  assert.equal(feedbackItems(state)[0].resolved, true);
  state = reduceReview(state, { kind: 'resolve', id: 'constructor', version: 3, resolved: false }, 'reopen', null);
  assert.equal(feedbackItems(state)[0].resolved, false);
  assert.match(batchPrompt(batch), /Do not implement fixes/);
  assert.throws(() => validateOperation({ kind: 'resolve', id: 'constructor', version: 4, resolved: true, agent: true }));
});
test('strict authored question fences share question shapes without live lifecycle', () => {
  const source = '```pi-step\n{"version":1,"id":"constructor","title":"Step"}\n```\nProse\n```pi-question\n' + JSON.stringify({ version: 1, ...q, explanation: 'Author only' }) + '\n```';
  assert.equal(parseNotebookChapter(source)[0].questions[0].explanation, 'Author only');
  assert.equal(stepProse(parseNotebookChapter(source)[0].markdown).includes('pi-question'), false);
  assert.throws(() => parseNotebookChapter(source.replace('"version":1,"id":"constructor","shortLabel"', '"version":1,"version":1,"id":"constructor","shortLabel"')), /Duplicate/);
});
test('question/option IDs preserve the existing leading underscore/hyphen grammar for every notebook outcome', () => {
  for (const questionId of ['_q', '-q']) for (const option of ['_yes', '-yes']) {
    const definition = { ...q, id: questionId, type: 'single', options: [{ id: option, title: 'Yes' }] };
    const current = { ...material, questions: [{ definition, fingerprint: hash }] };
    let state = emptyReviewState();
    for (const kind of ['answer', 'unsure', 'not-applicable', 'skip']) {
      const outcome = kind === 'answer' ? { kind, answer: { id: questionId, kind: 'selection', selections: [option] } } : { kind };
      state = reduceReview(state, { kind: 'answer', stepId: current.stepId, questionId, fingerprint: hash, outcome }, `record-${kind}`, current);
      assert.equal(currentAnswer(state, current.stepId, questionId, hash).outcome.kind, kind);
    }
    assert.equal(normalizeSetAnswer({ id: questionId, kind: 'skipped' }, definition), null, 'live required skip remains rejected');
    assert.equal(reduceReview(state, { kind: 'mark', stepId: current.stepId, fingerprint: hash, mark: 'Reviewed' }, 'reviewed', current).events.at(-1).operation.mark, 'Reviewed');
  }
});
test('full recovery validation rejects malformed nested drafts and preserves batch-bound reply fields', () => {
  const fresh = freshReviewDraft();
  for (const invalid of [{ ...fresh, questions: [null] }, { ...fresh, questions: [{ key: 'constructor', draft: { selections: null }, outcome: 'answer' }] }, { ...fresh, anchor: { stepId: 'constructor' } }, { ...fresh, pending: { action: 'append', submissionId: 'pending', operation: { kind: 'import' } } }, { ...fresh, editing: {} }]) assert.throws(() => parseReviewDraft(JSON.stringify(invalid)));
  assert.throws(() => parseReviewDraft('{"questions":[],"questions":[]}'), /Duplicate/);
  assert.throws(() => parseReviewDraft(' '.repeat(2 * 1024 * 1024 + 1)), /exceeds/);
  const incomplete = { ...fresh, kind: 'finding', text: 'Unsaved classification draft', anchor: { stepId: 'toString', fingerprint: hash, basis: 'guidance' } };
  assert.equal(parseReviewDraft(JSON.stringify(incomplete)).text, incomplete.text, 'temporary unsaveable field combinations remain recoverable, not reviewer decisions');
  assert.throws(() => validateOperation({ kind: 'feedback', item: { id: 'draft', version: 1, kind: incomplete.kind, text: incomplete.text, anchor: incomplete.anchor, resolved: false } }), /Guidance-only feedback/);
  const restored = parseReviewDraft(JSON.stringify({ ...fresh, previewBatchId: 'batch-A', replies: [{ batchId: 'batch-A', text: 'Unimported A' }, { batchId: 'batch-B', text: 'Unimported B' }] }));
  assert.deepEqual(restored.replies.map(r => r.text), ['Unimported A', 'Unimported B']);
  assert.equal(restored.previewBatchId, 'batch-A');
});
test('current-chat handoff rejects switched/missing/unmounted destinations and appends without replacing draft', () => {
  const expected = { id: 'A', label: 'A' }, calls = [];
  const composer = { insertText: (...args) => calls.push(args) };
  assert.throws(() => prepareReviewDraft(expected, { id: 'B', label: 'B' }, composer, 'batch'), /changed/);
  assert.throws(() => prepareReviewDraft(expected, undefined, composer, 'batch'), /missing/);
  assert.throws(() => prepareReviewDraft(expected, expected, null, 'batch'), /mounted/);
  prepareReviewDraft(expected, expected, composer, 'batch');
  assert.deepEqual(calls, [['batch', { atEnd: true }]]);
});
