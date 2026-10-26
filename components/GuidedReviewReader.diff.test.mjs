import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { packet, click, input, textButton } from './cards-git.fixture.mjs';
import { guidedReadDomain } from './guided-diff.fixture.mjs';
import { boundedErrors } from './files-diagnostics.fixture.mjs';

const target = { version: 1, kind: 'compare', id: 'range-a', title: 'Feature range A', cwd: '/repo-a', branch: 'feature', base: 'a'.repeat(40), candidate: 'b'.repeat(40), path: 'changed.txt' };
const web = { version: 1, kind: 'web', id: 'web', title: 'External reference', url: 'https://example.test/reference' };
const indexPath = '/guide/index.md', identity = '1'.repeat(64);
const patch = 'diff --git a/changed.txt b/changed.txt\nindex 1234567..abcdef0 100644\n--- a/changed.txt\n+++ b/changed.txt\n@@ -2 +2 @@\n-old\n+new\n';
const context = { oldFile: { name: target.path, contents: 'first\nold\nlast\n', cacheKey: 'pinned-base' }, newFile: { name: target.path, contents: 'first\nnew\nlast\n', cacheKey: 'pinned-candidate' } };
const notebook = { index: { version: 1, id: 'guide', title: 'Guide', chapters: [{ id: 'one', title: 'First', path: 'one.md' }, { id: 'two', title: 'Second', path: 'two.md' }] }, chapters: [
  { id: 'one', title: 'First', path: 'one.md', steps: [{ id: 'first', title: 'First step', markdown: 'Inspect the range.', targets: [target, web] }] },
  { id: 'two', title: 'Second', path: 'two.md', steps: [{ id: 'last', title: 'Last step', markdown: 'Read freely.', targets: [{ ...web, id: 'last-web' }] }] },
] };
const pair = { cwd: target.cwd, branch: target.branch, head: target.candidate, base: target.base, candidate: target.candidate };

// Real CommittedPatchDiff / Pierre instance, context controls and target lifetime.
// Transport and missing DOM capabilities only are controlled; no renderer stub.
test('successful comparison loads exact patch/context, retains reading model across targets and Back/Next, and fences obsolete context work', async t => {
  const domain = guidedReadDomain(); let h;
  t.after(async () => {
    const errors = []; domain.release(); // close transport/release peers before any join
    // Pierre emits its documented unmount post-render callback while React detaches.
    // Unmount before Cards' terminal frame admission closes; its domain then cancels
    // those queued callbacks after joining work, as in the existing reader recipes.
    try { await h?.view.unmount(); } catch (error) { errors.push(error); }
    try { await h?.cleanup(); } catch (error) { errors.push(error); }
    if (errors.length) { const failure = new AggregateError(errors, 'Guided diff cleanup'); console.log(boundedErrors(failure)); throw failure; }
  });
  h = await packet(t, { readDomain: domain });
  h.expectFailure(domain.closing);
  const api = await h.load('@pierre/diffs');
  const warm = api.preloadHighlighter({ themes: ['pierre-light', 'pierre-dark'], langs: ['text'] }); h.onReadWork(warm); await warm;
  const { GuidedReviewReader } = await h.load('./GuidedReviewReader.tsx');
  const instances = [];
  const setup = api.CodeView.prototype.setup;
  t.mock.method(api.CodeView.prototype, 'setup', function (...args) { const result = setup.apply(this, args); instances.push(this); return result; });
  // Own actual optional native renderer promises too; warm text normally renders
  // synchronously. These are independent capability work, not invented reader idle.
  for (const Type of [api.FileRenderer, api.DiffHunksRenderer]) for (const method of ['asyncHighlight', 'initializeHighlighter', 'asyncRender']) {
    const original = Type.prototype[method];
    t.mock.method(Type.prototype, method, function (...args) { const work = original.apply(this, args); h.onReadWork(work); return work; });
  }
  const loadFiles = api.FileDiff.prototype.loadFilesForDiff;
  t.mock.method(api.FileDiff.prototype, 'loadFilesForDiff', function (...args) { const work = loadFiles.apply(this, args); h.onReadWork(work); return work; });
  const view = h.view;
  const choose = async value => { const select = view.container.querySelector('select[aria-label="Evidence target"]'); select.value = value; await view.dispatch(select, new view.window.Event('change', { bubbles: true })); };
  const join = async from => { await act(async () => { await h.settle(from); }); };
  const acquire = async action => {
    const replay = domain.expect('/api/git/explorer', { cwd: target.cwd, branch: target.branch, op: 'log' });
    const log = domain.expect('/api/git/explorer', { cwd: target.cwd, branch: target.branch, op: 'log' });
    await action();
    await replay.deliver({ head: target.candidate });
    const capture = domain.expect('/api/git/explorer', { ...pair, op: 'compare' });
    await log.deliver({ head: target.candidate });
    const read = domain.expect('/api/git/explorer', { ...pair, op: 'compare-patch', identity, path: target.path });
    await capture.deliver({ identity });
    const from = h.work.length; await read.deliver({ patch, hasBinaryChanges: false }); await join(from);
    // One named native render/ref-binding frame, not a drain-until-idle join.
    await h.frames.fire(h.frames.take());
  };
  const folderReplay = domain.expect('/api/review-notebook', { index: indexPath }), folder = domain.expect('/api/review-notebook', { index: indexPath });
  await h.render(createElement(GuidedReviewReader, { indexPath, onClose() {}, onWork: h.onReadWork }));
  await folderReplay.deliver(notebook);
  await acquire(() => folder.deliver(notebook));
  const viewport = view.container.querySelector('.git-diff-code-view');
  const instance = instances.findLast(value => value.getContainerElement() === viewport);
  assert.equal(!!instance?.getRenderedItems()[0]?.element.shadowRoot, true, 'genuine Pierre shadow renderer owns the comparison viewport');
  assert.equal(view.container.querySelector('[aria-label="File version"]') !== null, true);
  // Hold the actual JSON body after Show full file. Leave, then deliver success;
  // the exact original ensureContext rejection is expected only for this abort.
  let from = h.work.length;
  const obsoleteSuccess = domain.expect('/api/git/explorer', { ...pair, op: 'compare-context', identity, path: target.path });
  await click(view, textButton(view.container, 'Show full file'));
  const contextOperation = h.work[from].promise; let rejectedAbort = false;
  const abortReceipt = contextOperation.catch(error => {
    assert.equal(obsoleteSuccess.signal.aborted, true); assert.equal(error.name, 'AbortError'); rejectedAbort = true; h.expectFailure(error);
  }); h.onReadWork(abortReceipt);
  await choose('web');
  await obsoleteSuccess.deliver(context); await join(from);
  assert.equal(rejectedAbort, true, 'the exact context original rejects after ignored-abort JSON success');
  assert.equal(view.container.querySelector('.git-commit-diff') === null, true);
  await acquire(() => choose('range-a'));
  // A second obsolete body error is identified by SAME Error, not a blanket catch.
  from = h.work.length;
  const obsoleteError = domain.expect('/api/git/explorer', { ...pair, op: 'compare-context', identity, path: target.path });
  await click(view, textButton(view.container, 'Show full file'));
  const oldBodyError = new Error('obsolete JSON body failed'); h.expectFailure(oldBodyError);
  await choose('web'); await obsoleteError.deliver(undefined, oldBodyError); await join(from);
  await acquire(() => choose('range-a'));
  // Current refusal remains visible; only this exact original work/error is expected.
  from = h.work.length;
  const refusal = domain.expect('/api/git/explorer', { ...pair, op: 'compare-context', identity, path: target.path });
  await click(view, textButton(view.container, 'Show full file'));
  const refused = new Error('Current captured context refused'); h.expectFailure(refused);
  await refusal.deliver(undefined, refused); await join(from);
  assert.match(view.container.querySelector('[role="alert"]').textContent, /Current captured context refused/);
  from = h.work.length;
  const full = domain.expect('/api/git/explorer', { ...pair, op: 'compare-context', identity, path: target.path });
  await click(view, textButton(view.container, 'Retry context')); await full.deliver(context); await join(from);
  // Retry context loads the matching versions; Show full file then uses that exact
  // cached model context. No additional transport is admitted by Before/After.
  await click(view, textButton(view.container, 'Show full file')); await join(h.work.length - 1);
  await click(view, textButton(view.container, 'Before')); await join(h.work.length - 1);
  assert.equal(view.container.querySelector('[aria-label="Before file"]') !== null, true);
  await input(view, view.container.querySelector('input[aria-label="Search full file"]'), 'old');
  const count = domain.requests.length;
  await choose('web');
  await acquire(() => choose('range-a'));
  assert.equal(view.container.querySelector('[aria-label="Before file"]') !== null, true, 'same exact target retains Before mode after reauthorization');
  assert.equal(view.container.querySelector('input[aria-label="Search full file"]').value, 'old');
  assert.equal(textButton(view.container, 'Diff context').getAttribute('aria-pressed'), 'true');
  assert.equal(domain.requests.length, count + 4, 'reauthorize capture/patch only, do not reread retained exact context');
  await click(view, textButton(view.container, 'After')); await join(h.work.length - 1);
  assert.equal(view.container.querySelector('[aria-label="After file"]') !== null, true);
  await click(view, textButton(view.container, 'Next'));
  await acquire(() => click(view, textButton(view.container, 'Back')));
  assert.equal(view.container.querySelector('[aria-label="After file"]') !== null, true, 'cross-file Back restores per-target model');
  assert.equal(view.container.querySelector('input[aria-label="Search full file"]').value, 'old');
  await click(view, textButton(view.container, 'Changes')); await join(h.work.length - 1);
  assert.equal(view.container.querySelector('[aria-label="Side-by-side diff"]') !== null, true);
});
