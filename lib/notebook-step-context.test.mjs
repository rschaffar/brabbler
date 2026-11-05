import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { notebookStepPrompt, notebookStepContent, NOTEBOOK_CONTEXT_BYTES } = await jiti.import('./notebook-step-context.ts');
const target = { version: 1, id: 'source', title: 'Pinned source', kind: 'source', cwd: '/repo', branch: 'feature', oid: 'a'.repeat(40), path: 'code.ts', start: 2, end: 8 };
const step = { id: 'boundary', title: 'Boundary', markdown: 'Explain the boundary: α', targets: [target], questions: [] };
const context = { indexPath: '/guide/index.md', notebookId: 'guide', chapterPath: 'one.md', step };
const payload = text => JSON.parse(text.split('~~~json\n')[1].split('\n~~~')[0]);

test('step context identifies the displayed definition and pinned references without copying prose or granting edits', async () => {
  const original = structuredClone(context), text = await notebookStepPrompt(context), value = payload(text);
  assert.equal(value.indexPath, '/guide/index.md');
  assert.equal(value.stepId, 'boundary');
  assert.deepEqual(value.references, [target]);
  assert.equal(value.omittedReferences, 0);
  assert.equal(value.displayedStepSha256, createHash('sha256').update(notebookStepContent(step)).digest('hex'));
  assert.doesNotMatch(text, /Explain the boundary/);
  assert.match(text, /context alone does not request edits/);
  assert.deepEqual(context, original);
  const changed = payload(await notebookStepPrompt({ ...context, step: { ...step, markdown: 'Changed explanation' } }));
  assert.notEqual(changed.displayedStepSha256, value.displayedStepSha256);
  const repinned = payload(await notebookStepPrompt({ ...context, step: { ...step, targets: [{ ...target, oid: 'b'.repeat(40) }] } }));
  assert.notEqual(repinned.displayedStepSha256, value.displayedStepSha256);
});

test('context has an exact UTF-8 bound, labels omitted references, and rejects oversized identity instead of truncating it', async () => {
  const targets = Array.from({ length: 100 }, (_, i) => ({ ...target, id: `source-${i}`, path: `${'α'.repeat(3000)}.ts` }));
  const text = await notebookStepPrompt({ ...context, step: { ...step, targets } }), value = payload(text);
  assert.equal(Buffer.byteLength(text) <= NOTEBOOK_CONTEXT_BYTES, true);
  assert.equal(value.references.length > 0 && value.omittedReferences > 0, true);
  assert.equal(value.references.length + value.omittedReferences, targets.length);
  assert.deepEqual(value.references, targets.slice(0, value.references.length));
  await assert.rejects(notebookStepPrompt({ ...context, indexPath: 'x'.repeat(NOTEBOOK_CONTEXT_BYTES) }), /limit/);
});
