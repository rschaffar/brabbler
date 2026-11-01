import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { packet, click, textButton } from './cards-git.fixture.mjs';
import { body } from './operation-review.fixture.mjs';
import { createTaskOwner } from '../lib/testing/async.fixture.mjs';
const patch = 'diff --git a/notes.txt b/notes.txt\n--- a/notes.txt\n+++ b/notes.txt\n@@ -1 +1 @@\n-Old text\n+New text\n';
const context = { oldFile: { name: 'notes.txt', contents: 'Old text\n', cacheKey: 'supplied-before' }, newFile: { name: 'notes.txt', contents: 'New text\n', cacheKey: 'supplied-after' } };
const handle = '12345678-1234-1234-1234-123456789abc';

test('real non-Git supplied PluginCard context forwards current observers and independently joins the queue worker after ignored-abort body', async t => {
  const h = await packet(t, { cardDescendants: true, suppliedContext: { pluginId: 'example', handle } });
  const highlighter = await h.load('./git-card-highlighter.fixture.mjs');
  h.addDomainRelease(() => { highlighter.hold(false); highlighter.releaseAll(); });
  h.addDomainJoin(async () => {
    const handlers = highlighter.calls.map(call => call.handler);
    const results = await Promise.allSettled([...highlighter.nativeOriginals, ...handlers.filter(Boolean)]);
    assert.equal(handlers.every(Boolean), true);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'supplied highlighter originals');
  });
  // Observe the actual queue's original full work independently of parent
  // forwarding. The native factory/policy/transport and returned promises are
  // unchanged; removing GitPatchStack's forwarding must still fail and teardown
  // must still release/join that worker rather than hiding it behind public Abort.
  const display = await h.load('../lib/git-patch-display.ts'), original = display.createPatchLoader, workers = [], queueOwner = createTaskOwner();
  h.addDomainJoin(() => queueOwner.join());
  t.mock.method(display, 'createPatchLoader', (load, limit, observer) => original(load, limit, work => {
    workers.push(queueOwner.track('complete supplied queue worker/finally', work));
    observer?.(work);
  }));
  const { PluginCard } = await h.load('./plugin-ui/PluginCard.tsx');
  const first = [], current = [], latest = [];
  const observe = list => work => { list.push(work); h.onReadWork(work); };
  const firstObserver = observe(first), currentObserver = observe(current), latestObserver = observe(latest);
  const request = { type: 'extension_ui_request', id: 'supplied', method: 'plugin_card', pluginId: 'example', title: 'Supplied review', patch,
    patchContext: handle, actions: [{ id: 'approve', label: 'Approve supplied patch', primary: true }] };
  const render = (id, observer) => h.render(createElement(PluginCard, { key: id, request: { ...request, id }, onReadWork: observer, onRespond: () => assert.fail('context is display only') }));
  await render('success', firstObserver); await h.settle();
  const firstCount = first.length, initialReads = h.requests.length;
  await render('success', currentObserver); assert.equal(first.length, firstCount); assert.equal(h.requests.length, initialReads);
  const from = h.work.length, workerFrom = workers.length;
  await click(h.view, textButton(h.view.container, 'Before'));
  const read = h.requests.at(-1), worker = workers[workerFrom];
  assert.ok(worker, 'actual context queue worker admitted');
  const forwarded = current.includes(worker), parentOwned = h.work.slice(from).some(entry => entry.promise === worker);
  assert.equal(first.length, firstCount);
  await body(h, read, context); await h.settle(from); await worker;
  assert.equal(forwarded, true, 'PluginCard forwards the SAME complete supplied-context worker');
  assert.equal(parentOwned, true);
  assert.ok(h.view.container.querySelector('[aria-label="Before file"]'));
  assert.ok(textButton(h.view.container, 'Approve supplied patch'));

  await h.render(null); await h.settle(); await render('held', currentObserver); await h.settle();
  const heldFrom = h.work.length, heldWorkerFrom = workers.length;
  await click(h.view, textButton(h.view.container, 'Before'));
  const held = h.requests.at(-1), heldWorker = workers[heldWorkerFrom];
  assert.ok(heldWorker); assert.equal(current.includes(heldWorker), true);
  const admitted = h.work.slice(heldFrom).map(entry => entry.promise), publicWork = admitted.filter(work => work !== heldWorker);
  assert.ok(publicWork.length, 'actual public context/action continuations are separately observed');
  await body(h, held, context, { holdBody: true }); await held.bodyEntered;
  const acceptedCount = h.requests.length, currentCount = current.length;
  await render('held', latestObserver); assert.equal(h.requests.length, acceptedCount); assert.equal(current.length, currentCount); assert.equal(latest.length, 0);
  let workerDone = false;
  // This marker observes the original; failure still belongs to the independent
  // allSettled worker join, not a fabricated public/worker rejection identity.
  void heldWorker.then(() => { workerDone = true; }, () => { workerDone = true; });
  await h.render(null); assert.equal(held.signal.aborted, true);
  const publicResults = await Promise.allSettled(publicWork);
  const rejected = publicResults.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 1); assert.equal(rejected[0].reason.name, 'AbortError'); h.expectFailure(rejected[0].reason);
  assert.equal(workerDone, false, 'public Abort/action settlement is not full queue-worker/finally settlement');
  await act(async () => { held.releaseBody(); await heldWorker; });
  assert.equal(workerDone, true); assert.equal(held.bodyCalls, 1); assert.equal(h.view.container.childNodes.length, 0);
  await h.settle(heldFrom); await h.cleanup();
});
