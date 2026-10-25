import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileDiffRealm, patches, snapshot, obsoleteSnapshot, oldContents, newContents, pressed, patchControls, click, textButton } from './file-diff-parity.fixture.mjs';

// ONE Cards mount, physical Window, custom-element registry and production import
// graph for the entire file. Actual parent remounts use new section keys, never a
// second closed Window with a cached Pierre constructor. No Git parent is used.
test('working FileViewer exact four-status tuple, revision snapshot and obsolete child continuations', async t => {
  const h = await fileDiffRealm(t);
  const source = () => {
    pressed(h.root(), 'Source', true); pressed(h.root(), 'Diff', false);
    assert.equal(h.root().querySelector('[aria-label="Patch view"]'), null, 'source has no patch controls');
  };
  const split = () => {
    patchControls(h.root(), 'Side by side');
    assert.ok(h.root().querySelector('[aria-label="Side-by-side diff"]'));
    assert.match(h.root().textContent, /Before · HEAD/); assert.match(h.root().textContent, /After · Working tree/);
    return h.current();
  };
  for (const status of ['modified', 'added', 'deleted', 'context']) {
    const { scenario, from } = await h.show(status, `tuple:${status}`);
    const admitted = h.requests.filter(r => r.scenario === scenario);
    const reads = admitted.filter(r => r.url.pathname.startsWith('/api/files/') && r.url.searchParams.get('type') === 'read');
    assert.ok(reads.length > 0);
    assert.ok(reads.every(r => r.status === (status === 'deleted' ? 404 : 200)));
    const git = admitted.filter(r => r.url.pathname === '/api/git/diff'); assert.ok(git.length > 0);
    for (const request of git) {
      assert.equal(request.status, 200);
      assert.deepEqual(request.payload, { supported: true, status: status === 'context' ? 'modified' : status,
        patch: patches[status], ...(status === 'context' ? { revision: 'a'.repeat(64) } : {}) }, 'exact original Git response body');
    }
    if (status !== 'deleted') { source(); await h.diff(from); pressed(h.root(), 'Source', false); pressed(h.root(), 'Diff', true); }
    else assert.equal([...h.root().querySelectorAll('button')].some(b => ['Source', 'Edit'].includes(b.textContent)), false, 'deleted Source/Edit absent');
    const { item } = split();
    assert.equal(item.type, 'diff');
    assert.equal(item.item.fileDiff.hunks.length, status === 'context' ? 2 : 1, 'valid exact supplied patch, not a fake child');
    assert.equal(h.contextReads(scenario).length, 0, 'all four statuses have zero eager context');
    if (status === 'context') {
      assert.equal(reads.at(-1).payload.content, newContents, 'full 5000-line source bytes, not a prefix/sample');
      assert.equal(oldContents.split('\n').length, 5001); assert.equal(newContents.split('\n').length, 5001);
      // Reading-mode activation is the lower-owner cold snapshot request. The
      // physical gap Enter/virtual scrolling iteration stays FULL in Chrome.
      const lazy = await h.admitContext();
      assert.equal(lazy.request.returned, false); assert.equal(lazy.request.init.signal.aborted, false);
      await h.deliver(lazy.request); await h.join(lazy.from);
      assert.equal(lazy.request.returned, true); assert.equal(lazy.request.finallyCount, 1);
      pressed(h.root(), 'After', true); pressed(h.root(), 'Changes', false);
      const retained = h.current().item.item.file;
      assert.equal(retained, snapshot.newFile); assert.equal(retained.contents, newContents);
      assert.equal(snapshot.oldFile.contents, oldContents);
      await click(h.view, textButton(h.root(), 'Source')); source();
      await h.diff(from); pressed(h.root(), 'Source', false); pressed(h.root(), 'Diff', true);
      pressed(h.root(), 'After', true);
      assert.equal(h.current().item.item.file, retained, 'Source/Diff retains the SAME validated revision-bound snapshot');
      assert.equal(h.contextReads(scenario).length, 1, 'one lazy read shared by the remounted child');
      await click(h.view, textButton(h.root(), 'Changes')); await h.join(lazy.from); split();
    }
    for (const [label, region] of [['Unified', 'Unified diff'], ['Raw patch', 'Raw patch'], ['Side by side', 'Side-by-side diff']]) {
      await click(h.view, textButton(h.root(), label)); await h.join(from);
      patchControls(h.root(), label); assert.ok(h.root().querySelector(`[aria-label="${region}"]`));
      if (label === 'Raw patch') assert.equal(h.root().querySelector('[aria-label="Raw patch"]').textContent, patches[status], `complete ${status} patch bytes`);
      else h.current();
      if (status !== 'deleted') { pressed(h.root(), 'Source', false); pressed(h.root(), 'Diff', true); }
    }
    if (status !== 'deleted') { await click(h.view, textButton(h.root(), 'Source')); source(); }
    else assert.equal([...h.root().querySelectorAll('button')].some(b => ['Source', 'Edit'].includes(b.textContent)), false);
    assert.equal(h.contextReads(scenario).length, status === 'context' ? 1 : 0);
    await h.render(null);
    await h.frames.fire(h.frames.take()); // genuinely late callbacks see cleared child refs
    await h.join(from); h.assertPromises();
  }

  // Two precise old-body outcomes against a CURRENT successful actual parent.
  // Do not settle the old gate ahead of replacement or use abort as cancellation.
  for (const outcome of ['late-success', 'late-body-failure']) {
    const old = await h.show('context', `obsolete:${outcome}`); await h.diff(old.from);
    const held = await h.admitContext(); const oldRoot = h.root();
    assert.equal(held.request.returned, false);
    const oldFrames = h.frames.take();
    await h.render(null);
    await h.frames.fire(oldFrames);
    assert.equal(held.request.init.signal.aborted, true, 'actual child cleanup aborts its real context signal');
    const live = await h.show('context', `current:${outcome}`); await h.diff(live.from);
    const currentRead = await h.admitContext();
    await h.deliver(currentRead.request); await h.join(currentRead.from);
    const currentRoot = h.root(), retained = h.current(); assert.notEqual(currentRoot, oldRoot);
    pressed(currentRoot, 'After', true); assert.equal(textButton(currentRoot, 'Before').disabled, false);
    assert.equal(retained.item.item.file, snapshot.newFile);
    if (outcome === 'late-success') await h.deliver(held.request, obsoleteSnapshot);
    else await h.failBody(held.request, new SyntaxError('owned obsolete context JSON failure'));
    await h.join(held.from);
    const rejected = held.work.filter(entry => entry.error);
    assert.equal(rejected.length, 1, 'only original ensureContext rejects; actual chooseReading catch also completes');
    if (outcome === 'late-success') {
      assert.equal(rejected[0].error.name, 'AbortError'); h.expectFailure(rejected[0].error);
      assert.equal(held.request.returned, true, 'ignored-abort body really returned before original child abort check');
      assert.equal(held.request.value, obsoleteSnapshot);
      assert.equal(held.request.value.oldFile.contents, oldContents.split('\n').slice(0, 4000).join('\n') + '\n', 'complete obsolete 4000-line old body bytes');
      assert.equal(held.request.value.newFile.contents, newContents.split('\n').slice(0, 4000).join('\n') + '\n', 'complete obsolete 4000-line new body bytes');
    } else {
      assert.equal(rejected[0].error.message, 'owned obsolete context JSON failure');
      assert.equal(held.request.returned, false);
    }
    assert.equal(held.request.finallyCount, 1, 'real rejected/fulfilled body finally completed');
    assert.equal(h.root(), currentRoot); assert.equal(h.current().instance, retained.instance);
    assert.equal(h.current().item.item.file, snapshot.newFile, 'old completion cannot replace current immutable snapshot');
    assert.equal(currentRoot.querySelector('[role="alert"]'), null);
    pressed(currentRoot, 'After', true); assert.equal(textButton(currentRoot, 'Before').disabled, false);
    assert.equal(h.contextReads(old.scenario).length, 1); assert.equal(h.contextReads(live.scenario).length, 1);
    await h.render(null); await h.frames.fire(h.frames.take());
    await h.join(old.from); h.assertPromises();
  }

  // Held actual child work survives unmount of the REAL ROOT, not just a fake
  // callback or an empty DOM check. Await both original production continuations.
  const closing = await h.show('context', 'held-across-root-unmount'); await h.diff(closing.from);
  const held = await h.admitContext();
  for (const entry of held.work) assert.ok(h.parentCalls.some(call => call.work === entry.promise), 'held work originated at actual parent onWork');
  const finalItem = h.current().item, target = finalItem.element, shadow = target.shadowRoot;
  const owner = h.frameOwner(finalItem.instance);
  const knownBindings = h.frames.admissionsSince(0).filter(event => event.owner === owner && event.label === 'diff-post:render');
  assert.ok(knownBindings.length > 0, 'actual final child emitted a binding before cleanup');
  const binding = knownBindings.at(-1).callback;
  assert.ok(knownBindings.every(event => event.callback === binding), 'final child retains its original binding identity');
  const readsBefore = h.requests.length, workBefore = h.work.length, parentBefore = h.parentCalls.length;
  const noNewReaderWork = () => {
    assert.equal(h.requests.length, readsBefore, 'no post-unmount HTTP/read admission');
    assert.equal(h.work.length, workBefore, 'no post-unmount preload/read/action promise admission');
    assert.equal(h.parentCalls.length, parentBefore, 'no post-unmount parent work admission');
  };
  const beforeUnmount = h.frames.mark(), closingFrames = h.frames.take();
  await h.view.unmount(); assert.equal(held.request.init.signal.aborted, true);
  const afterUnmount = h.frames.mark();
  // CodeView.cleanAllRenderedItems -> releaseRenderedItem -> FileDiff.cleanUp
  // emits onPostRender(..., 'unmount') while the item still has its option key.
  // The parent schedules its SAME bindViewer; the live ref is now cleared.
  // Capture exactly that finite synchronous cleanup set, not an idle queue.
  const cleanupBindings = h.frames.admissionsSince(beforeUnmount);
  assert.ok(cleanupBindings.length > 0, 'real mounted child emitted its cleanup binding');
  for (const event of cleanupBindings) assert.deepEqual(
    { callback: event.callback, label: event.label, owner: event.owner, parent: event.parent, status: event.status },
    { callback: binding, label: 'diff-post:unmount', owner, parent: null, status: 'queued' },
    `only the original child's synchronous cleanup binding may be admitted (frame ${event.id})`);
  noNewReaderWork();
  let mutations = 0;
  const observer = new h.view.window.MutationObserver(records => { mutations += records.length; });
  for (const node of [h.view.container, target, shadow]) observer.observe(node, { childList: true, subtree: true, attributes: true, characterData: true });
  try {
    await h.frames.fire(closingFrames);
    assert.equal(h.frames.mark(), afterUnmount, 'late previously admitted callbacks cannot create another frame');
    noNewReaderWork();
    const bodyFailure = new SyntaxError('owned context body failure after parent unmount');
    await h.failBody(held.request, bodyFailure); await h.join(held.from);
    assert.equal(held.work.filter(entry => entry.error).length, 1);
    assert.equal(held.work.find(entry => entry.error).error, bodyFailure);
    assert.equal(held.request.finallyCount, 1);
    assert.equal(h.frames.mark(), afterUnmount, 'held body/catch/finally cannot create a binding');
    noNewReaderWork();
    // ONE delivery of the already-classified cleanup notification callbacks.
    // No loop, count allowance, unknown callback or newly produced generation.
    await h.frames.fire(cleanupBindings.map(event => event.id));
    assert.equal(h.frames.mark(), afterUnmount, 'cleanup binding delivery cannot schedule descendant work');
    noNewReaderWork();
    await h.join(held.from); // preserve complete original promise/error joins
    assert.equal(h.frames.mark(), afterUnmount, 'promise join cannot hide a new binding');
    noNewReaderWork();
    const finalEvents = h.frames.admissionsSince(0);
    for (const id of closingFrames) assert.ok(['delivered', 'cancelled'].includes(finalEvents.find(event => event.id === id)?.status), 'each pre-unmount frame reached its own terminal port');
    for (const { id } of cleanupBindings) assert.equal(finalEvents.find(event => event.id === id)?.status, 'delivered', 'each cleanup binding really ran');
    assert.equal(h.frames.take().length, 0, 'all classified finite frame ports completed, with no unknown remainder');
    mutations += observer.takeRecords().length;
    assert.equal(mutations, 0, 'late callbacks/body completion cannot mutate the reader or detached Pierre shadow');
    assert.equal(h.view.container.childNodes.length, 0);
    h.assertPromises();
  } finally { observer.disconnect(); }
});
