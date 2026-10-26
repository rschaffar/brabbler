import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './highlighting-harness.fixture.mjs';

test('actual successful import joins a disabled observer and removed peer without stale publication', async t => {
  const h = await harness(t, { gated: true, kind: 'grammar', count: 2 });
  assert.equal(h.grammarWorks.length, 4, 'two real Strict observers own handlers for one shared import');
  // Assert admission BEFORE waiting: omitted demand fails a bounded count, not
  // a wait for an operation that never started.
  await h.importGate.entered.promise;
  assert.deepEqual([h.ready('0'), h.ready('1')], [false, false]);
  await h.render({ enabled: false, probeCount: 1 });
  const commits = h.commits.length;
  h.importGate.release.resolve();
  await h.joinGrammar();
  const { refractor } = await import('refractor/core');
  assert.equal(refractor.registered('tsx'), true, 'the real package registered grammars');
  assert.equal(h.commits.length, commits, 'obsolete handlers neither render the disabled observer nor publish to the removed peer');
  const before = h.commits.length;
  await h.render({ enabled: true });
  assert.equal(h.grammarWorks.length, 5, 'only current demand gets a new completion owner');
  assert.equal(h.commits[before][1], false, 'old success cannot pregrant a newly enabled lifetime');
  await h.joinGrammar();
  assert.equal(h.ready('0'), true);
  h.runtime.assertHealthy();
});
