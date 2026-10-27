import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { composerFixture } from './composer.fixture.mjs';

test('actual mounted composer review append preserves unrelated selection, existing text/images and requires a separate Send', async t => {
  const f = composerFixture(t), p = await f.load();
  const { prepareReviewDraft } = await f.jiti.import('../lib/review-handoff.ts');
  const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=' };
  p.setDraft('review-chat', { value: 'Keep unsent prefix and suffix', images: [image] });
  const sends = [], c = await f.input({ draftKey: 'review-chat', onSend: (...args) => sends.push(args) });
  const imageNode = c.view.container.querySelector('img'); assert.equal(!!imageNode, true);
  c.ta.setSelectionRange(5, 11);
  await act(async () => prepareReviewDraft({ id: 'A', label: 'A' }, { id: 'A', label: 'A' }, c.api.current, '\n\n--- REVIEW BATCH ---\nConcern\n--- END ---\n'));
  assert.equal(c.ta.value.startsWith('Keep unsent prefix and suffix'), true);
  assert.match(c.ta.value, /suffix\s+--- REVIEW BATCH ---/);
  assert.equal(c.view.container.querySelector('img') === imageNode, true, 'same existing attachment node');
  assert.deepEqual(p.getDraft('review-chat').images, [image]);
  assert.deepEqual(sends, []);
  assert.throws(() => prepareReviewDraft({ id: 'A', label: 'A' }, { id: 'B', label: 'B' }, c.api.current, 'WRONG'), /changed/);
  assert.equal(c.ta.value.includes('WRONG'), false);
});
