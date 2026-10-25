import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './highlighting-harness.fixture.mjs';

test('real grammar hook stays plain on external import failure, retries only on new enabled demand', async t => {
  const h = await harness(t, { failure: true, kind: 'grammar', enabled: false });
  assert.equal(h.ready('0'), false);
  assert.equal(h.grammarWorks.length, 0, 'disabled effects never demand the external chunk');
  const firstEnabledCommit = h.commits.length;
  await h.render({ enabled: true });
  assert.equal(h.commits[firstEnabledCommit][3], 0, 'grammar admission follows, never precedes, the layout commit');
  assert.equal(h.grammarWorks.length, 1, 'enabled commit admits one actual loader/handler operation');
  await h.joinGrammar();
  assert.equal(h.ready('0'), false);
  const before = h.commits.length;
  await h.render({ code: 'still plain' });
  assert.equal(h.commits.length, before + 1, 'failed import does not schedule a retry/render loop');
  assert.equal(h.grammarWorks.length, 1, 'unrelated rerender must not retry a rejected demand');
  assert.equal(h.ready('0'), false);
  await h.render({ enabled: false }); await h.render({ enabled: true });
  assert.equal(h.grammarWorks.length, 2, 'new enabled demand retries through the actual loader');
  await h.joinGrammar();
  assert.equal(h.ready('0'), false);
});

