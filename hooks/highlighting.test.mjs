import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './highlighting-harness.fixture.mjs';

test('real deferred hook admits after commit, cancels A/B/A and language/disabled/unmount generations', async t => {
  const h = await harness(t);
  assert.equal(h.ready('0'), false);
  assert.equal(h.commits[0][2], 0, 'first layout commit precedes idle admission');
  assert.equal(h.runtime.idleCount, 1, 'Strict replay cancels, then owns exactly one grant');
  await h.render({ code: 'B' }); assert.equal(h.ready('0'), false); assert.equal(h.runtime.idleCount, 1);
  await h.render({ code: 'A' }); assert.equal(h.ready('0'), false); assert.equal(h.runtime.idleCount, 1);
  await h.runtime.grantIdle(); assert.equal(h.ready('0'), true);
  await h.render({ language: 'js' }); assert.equal(h.ready('0'), false); assert.equal(h.runtime.idleCount, 1);
  await h.render({ enabled: false }); assert.equal(h.ready('0'), false); assert.equal(h.runtime.idleCount, 0);
  await h.render({ enabled: true }); assert.equal(h.runtime.idleCount, 1);
  await h.view.unmount(); assert.equal(h.runtime.idleCount, 0);
});

test('real selections block two fences; clearing requeues rather than publishing both', async t => {
  const h = await harness(t, { count: 2 });
  await h.select();
  await h.runtime.grantIdle(); await h.runtime.grantIdle();
  assert.equal(h.runtime.idleCount, 0);
  assert.deepEqual([h.ready('0'), h.ready('1')], [false, false]);
  await h.clear();
  assert.equal(h.runtime.idleCount, 1, 'one shared scheduled slice owns two requeued consumers');
  assert.deepEqual([h.ready('0'), h.ready('1')], [false, false]);
  await h.runtime.grantIdle();
  assert.equal(Number(h.ready('0')) + Number(h.ready('1')), 1, 'one grant is not a selection-release batch');
  await h.runtime.grantIdle();
  assert.deepEqual([h.ready('0'), h.ready('1')], [true, true]);
});

test('actual grammar registration defers publication during selection and cancels the unmounted listener', async t => {
  const h = await harness(t, { kind: 'grammar', enabled: false });
  await h.select(); await h.render({ enabled: true });
  assert.equal(h.grammarWorks.length, 1, 'only the real enabled effect starts registration');
  await h.joinGrammar();
  assert.equal(h.ready('0'), false, 'native selection keeps original text nodes plain');
  assert.equal(h.selection.pending, 1, 'one actual production listener beyond the React document baseline');
  const removedBeforeDisable = h.selection.removed;
  await h.render({ enabled: false });
  assert.equal(h.selection.pending, 0, 'disabled selected observer removes its exact production listener');
  assert.equal(h.selection.removed, removedBeforeDisable + 1);
  await h.render({ enabled: true });
  assert.equal(h.grammarWorks.length, 2);
  await h.joinGrammar();
  assert.equal(h.selection.pending, 1, 'warm selected observer delegates a new listener');
  await h.clear(); assert.equal(h.ready('0'), true);
  assert.equal(h.selection.pending, 0, 'selection-cleared listener removes itself');
  await h.render({ enabled: false }); assert.equal(h.ready('0'), false);
  // A fresh instance is plain even with warm grammars; the actual selected
  // root owns its pending publication, which unmount must cancel.
  await h.render({ enabled: false, incarnation: 1 });
  await h.select(); await h.render({ enabled: true });
  assert.equal(h.grammarWorks.length, 3);
  await h.joinGrammar();
  assert.equal(h.ready('0'), false, 'fresh selected observer has not acquired readiness');
  assert.equal(h.selection.pending, 1);
  const commits = h.commits.length, removedBeforeUnmount = h.selection.removed;
  await h.view.unmount();
  assert.equal(h.selection.pending, 0, 'unmount removes selected listener BEFORE any selection-clear event');
  assert.equal(h.selection.removed, removedBeforeUnmount + 1);
  await h.clear();
  assert.equal(h.commits.length, commits, 'selection release cannot publish into the removed observer');
});
