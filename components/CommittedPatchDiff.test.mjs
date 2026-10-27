import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useEffect, useLayoutEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { packet, click, choose, input, key, textButton } from './cards-git.fixture.mjs';
import { boundedErrors } from './files-diagnostics.fixture.mjs';

const modified = `diff --git a/notes.txt b/notes.txt
index 4824a54..d914290 100644
--- a/notes.txt
+++ b/notes.txt
@@ -1,2 +1,2 @@
 First line
-Old text
+New text
`;
const rootPatch = count => `diff --git a/notes.txt b/notes.txt\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1,${count} @@\n${Array.from({ length: count }, (_, i) => `+Line ${i + 1}`).join('\n')}\n`;

// A single owned realm per file keeps Pierre's real custom-element registration
// and application React identity in one physical graph. Subcases are serial;
// each unmounts its actual reader. There is no CodeView/renderer/hook double.
test('CommittedPatchDiff: actual SSR, CodeView bindings and controls', async t => {
  let h;
  t.after(async () => { try { await h?.cleanup(); } catch (error) { console.log(boundedErrors(error)); throw error; } });
  h = await packet(t); const api = await h.load('@pierre/diffs');
  const { CommittedPatchDiff } = await h.load('./CommittedPatchDiff.tsx');
  const { createDiffReview } = await h.load('../lib/git-diff-review.ts');
  const render = (patch, hasBinaryChanges = false, extra = {}) => renderToStaticMarkup(createElement(CommittedPatchDiff, {
    patch, hasBinaryChanges, before: 'parent', after: 'commit', ...extra,
  }));
  const show = props => h.render(createElement(CommittedPatchDiff, {
    hasBinaryChanges: false, before: 'parent', after: 'commit', onReadWork: h.onReadWork, ...props,
  }));
  const run = async (name, body) => t.test(name, async st => {
    st.after(async () => { await h.render(null); });
    await body(st);
  });

  await run('committed text patches keep the three view controls while highlighting loads', async () => {
    const html = render(modified);
    assert.match(html, /aria-label="Patch view"/); assert.match(html, /role="region" aria-label="Raw patch"/);
    for (const label of ['Side by side', 'Unified', 'Raw patch']) assert.equal(html.includes(`>${label}<`), true, label);
    assert.match(html, /aria-pressed="true"[^>]*>Raw patch/); assert.match(html, /-Old text/);
    assert.doesNotMatch(html, /<diffs-container/);
    const file = api.parsePatchFiles(modified, undefined, true)[0].files[0];
    assert.equal(file.hunks[0].hunkSpecs.trim(), '@@ -1,2 +1,2 @@');
    assert.deepEqual(file.deletionLines.map(line => line.trim()), ['First line', 'Old text']);
    assert.deepEqual(file.additionLines.map(line => line.trim()), ['First line', 'New text']);
  });
  await run('a stack can own the view without repeating per-file controls, retaining raw while highlighting loads', async () => {
    const html = render(modified, false, { view: 'unified' });
    assert.doesNotMatch(html, /aria-label="Patch view"/); assert.match(html, /role="region" aria-label="Raw patch"/);
    assert.match(html, /-Old text/);
  });
  await run('root commits parse additions next to an empty parent; raw fallback escapes contents', async () => {
    const root = 'diff --git a/base.txt b/base.txt\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/base.txt\n@@ -0,0 +1 @@\n+<script>alert(1)</script>\n';
    const file = api.parsePatchFiles(root, undefined, true)[0].files[0];
    assert.equal(file.type, 'new'); assert.deepEqual(file.deletionLines, []);
    assert.deepEqual(file.additionLines.map(line => line.trim()), ['<script>alert(1)</script>']);
    assert.match(render(root), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const raw = render(root.repeat(2));
    assert.match(raw, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(raw, /<script>/);
  });
  await run('large patches keep their complete raw text rather than creating thousands of DOM rows', async () => {
    const added = Array.from({ length: 2501 }, (_, index) => `+Line ${index}`).join('\n');
    const patch = `diff --git a/large b/large\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/large\n@@ -0,0 +1,2501 @@\n${added}\n`;
    const html = render(patch);
    assert.match(html, /Too many lines for the interactive diff/); assert.match(html, /Line 2500/);
    assert.doesNotMatch(html, /aria-label="Side-by-side diff"/);
  });
  await run('binary and metadata-only changes retain a truthful raw patch, never fake columns', async () => {
    const binary = render('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n', true);
    assert.match(binary, /Binary changes are summarized/); assert.match(binary, /Binary files a\/x.png and b\/x.png differ/);
    assert.doesNotMatch(binary, /Side-by-side diff|Side by side/);
    const metadata = render('diff --git a/tool b/tool\nold mode 100644\nnew mode 100755\n');
    assert.match(metadata, /metadata-only change/); assert.match(metadata, /new mode 100755/);
  });

  // Warm the actual highlighter for text, explicitly awaiting its real promise.
  // This is not an import/renderer double or a background-work flush. CodeView's
  // warm text rendering is synchronous; unexpected async renderer admission below
  // is observed and fails, rather than being presumed joined by preload alone.
  await act(async () => {
    const warm = api.preloadHighlighter({ themes: ['pierre-light', 'pierre-dark'], langs: ['text'] });
    h.onReadWork(warm); await warm;
  });
  const asyncRenders = [];
  for (const Type of [api.FileRenderer, api.DiffHunksRenderer]) {
    assert.equal(typeof Type, 'function', 'the actual renderer export exists');
    for (const method of ['asyncHighlight', 'initializeHighlighter']) {
      const original = Type.prototype[method];
      assert.equal(typeof original, 'function', `real renderer ${method} exists`);
      t.mock.method(Type.prototype, method, function (...args) {
        const promise = original.apply(this, args); asyncRenders.push(promise); h.onReadWork(promise); return promise;
      });
    }
  }
  const setups = [], moves = [], selections = [];
  let passive = false, scrollNotifications = 0;
  const originalSetup = api.CodeView.prototype.setup;
  t.mock.method(api.CodeView.prototype, 'setup', function (...args) {
    const value = originalSetup.apply(this, args); setups.push(this); return value;
  });
  const originalMove = api.CodeView.prototype.scrollTo;
  t.mock.method(api.CodeView.prototype, 'scrollTo', function (target) {
    moves.push({ instance: this, target: { ...target }, passive }); return originalMove.call(this, target);
  });
  const originalSelection = api.CodeView.prototype.setSelectedLines;
  t.mock.method(api.CodeView.prototype, 'setSelectedLines', function (selection, ...args) {
    selections.push({ id: selection?.id, range: selection?.range && { ...selection.range } });
    return originalSelection.call(this, selection, ...args);
  });
  const originalSubscribe = api.CodeView.prototype.subscribeToScroll;
  t.mock.method(api.CodeView.prototype, 'subscribeToScroll', function (callback) {
    return originalSubscribe.call(this, (...args) => { scrollNotifications++; callback(...args); });
  });
  const current = () => {
    const viewport = h.view.container.querySelector('.git-diff-code-view');
    assert.equal(Boolean(viewport), true, 'the real CodeView is mounted');
    const instance = setups.findLast(item => item.getContainerElement() === viewport);
    assert.equal(Boolean(instance), true, 'the real public CodeView instance owns this viewport');
    return { viewport, instance };
  };
  const awaitReads = async from => act(async () => { await h.settle(from); });

  for (const beforePassive of [false, true]) await run(`retained After position restores once ${beforePassive ? 'before' : 'after'} passive mount, without offset drift`, async () => {
    const model = createDiffReview(rootPatch(120)), anchor = { lineNumber: 50, side: 'additions', offset: -7 };
    model.reading = 'after'; model.anchors.after = anchor; model.scrollLeft = 19;
    const beforeBinding = [], startNotifications = scrollNotifications, startMoves = moves.length, from = h.work.length;
    function LayoutBoundary({ children }) {
      useLayoutEffect(() => {
        const { viewport } = current();
        // Actual CodeView's DOM scroll listener calls actual rememberPosition.
        viewport.dispatchEvent(new h.view.window.Event('scroll'));
        beforeBinding.push(model.anchors.after === anchor && model.scrollLeft === 19);
        if (beforePassive) h.frames.fireDuringLayout(h.frames.take());
      }, []);
      useEffect(() => { passive = true; return () => { passive = false; }; }, []);
      return children;
    }
    const tree = wrap => createElement(LayoutBoundary, null, createElement(CommittedPatchDiff, {
      patch: model.patch, reviewModel: model, hasBinaryChanges: false, before: 'empty tree', after: 'captured commit',
      view: 'split', wrap, onReadWork: h.onReadWork,
    }));
    await h.render(tree(false)); await awaitReads(from);
    assert.equal(scrollNotifications > startNotifications, true, 'real initial scroll notifications ran');
    assert.equal(beforeBinding.length > 0 && beforeBinding.every(Boolean), true, 'initial viewport notifications cannot replace a retained anchor before binding');
    await h.frames.fire(h.frames.take()); // actual post-render binding frame
    await h.frames.fire(h.frames.take()); // actual renderer applies the requested position
    const { viewport, instance } = current(), item = instance.getRenderedItems()[0];
    assert.equal(item?.type, 'file'); assert.equal(Boolean(item.element.shadowRoot), true, 'actual Pierre open shadow tree');
    const restored = moves.slice(startMoves).filter(move => move.instance === instance);
    assert.equal(restored.length, 1, 'one restoration per real viewer instance, not per notification');
    assert.deepEqual(restored[0].target, { type: 'line', id: 'after', lineNumber: 50, side: undefined, offset: -7, align: 'start', behavior: 'instant' });
    assert.equal(restored[0].passive, !beforePassive, 'binding phase uses the real live ref, not a fabricated mounted flag');
    assert.equal(viewport.scrollLeft, 19);
    const position = item.instance.getLinePosition(anchor.lineNumber).top - anchor.offset;
    assert.equal(instance.getScrollTop(), position);
    await h.view.dispatch(viewport, new h.view.window.Event('scroll'));
    const retained = model.anchors.after;
    // Pierre chooses the first visible numeric line. A negative-offset line 50
    // may canonically become line 51 with positive offset; the viewport point,
    // not a fabricated renderer's line identity, must remain exactly unchanged.
    assert.equal(item.instance.getLinePosition(retained.lineNumber).top - retained.offset, position);
    assert.equal(model.scrollLeft, 19);
    await h.render(tree(true)); await h.frames.fire(h.frames.take());
    assert.equal(current().instance === instance, true, 'layout options preserve the real viewer');
    assert.equal(moves.slice(startMoves).filter(move => move.instance === instance).length, 1, 'repeated binding cannot restore/drift again');
    await h.render(tree(false));
    const lateFrames = h.frames.take(), previousMoves = moves.length, previousNotifications = scrollNotifications;
    await h.render(null);
    await h.frames.fire(lateFrames); // really deliver queued post-render work after ref clear
    await h.view.dispatch(viewport, new h.view.window.Event('scroll'));
    assert.equal(moves.length, previousMoves, 'late frame cannot bind a disposed reader');
    assert.equal(scrollNotifications, previousNotifications, 'actual CodeView scroll subscription was removed');
    assert.equal(model.anchors.after === retained, true, 'unmounted callbacks preserve the retained anchor');
  });

  await run('public Pierre committed selections retain real range/side/quote and clear fences held context', async st => {
    const captured = [], model = createDiffReview(rootPatch(8)), from = h.work.length;
    await show({ patch: model.patch, reviewModel: model, onReviewSelection: value => captured.push(value) });
    await awaitReads(from); await h.frames.fire(h.frames.take());
    let start = h.work.length;
    await act(async () => current().instance.setSelectedLines({ id: 'diff', range: { start: 2, end: 3, side: 'additions' } }));
    await awaitReads(start);
    assert.deepEqual(captured.at(-1), { start: 2, end: 3, side: 'additions', quote: 'Line 2\nLine 3', context: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5', path: 'notes.txt' });
    await act(async () => current().instance.getRenderedItems()[0].instance.setSelectedLines(null)); assert.equal(captured.at(-1), null);
    const matchingContext = { oldFile: { name: 'notes.txt', contents: 'First line\nOld text\n', cacheKey: 'pinned:old' }, newFile: { name: 'notes.txt', contents: 'First line\nNew text\n', cacheKey: 'pinned:new' } };
    const gate = deferred(), entered = deferred(); st.after(() => gate.resolve(matchingContext));
    await h.render(null);
    const partial = createDiffReview(modified), before = h.work.length;
    await show({ patch: modified, reviewModel: partial, loadContext: async () => { entered.resolve(); return gate.promise; }, onReviewSelection: value => captured.push(value) });
    await awaitReads(before); await h.frames.fire(h.frames.take()); start = h.work.length;
    await act(async () => current().instance.setSelectedLines({ id: 'diff', range: { start: 2, end: 2, side: 'deletions' } }));
    await entered.promise;
    await act(async () => current().instance.getRenderedItems()[0].instance.setSelectedLines(null));
    gate.resolve(matchingContext);
    await awaitReads(start); assert.equal(partial.context === matchingContext, true, 'held original context validates and publishes');
    assert.equal(captured.at(-1), null, 'late full-file body cannot restore a cleared selection');
  });

  for (const outcome of ['success', 'rejection']) await run(`obsolete selection context ${outcome}/abort never clears a newer target selection`, async st => {
    const gate = deferred(), entered = deferred(), selected = [], matching = { oldFile: { name: 'notes.txt', contents: 'First line\nOld text\n', cacheKey: 'old' }, newFile: { name: 'notes.txt', contents: 'First line\nNew text\n', cacheKey: 'new' } };
    st.after(() => gate.resolve(matching));
    const a = createDiffReview(modified), from = h.work.length;
    await show({ patch: modified, reviewModel: a, loadContext: async () => { entered.resolve(); return gate.promise; }, onReviewSelection: value => selected.push({ owner: 'A', value }) });
    await awaitReads(from); await h.frames.fire(h.frames.take()); const pendingFrom = h.work.length;
    await act(async () => current().instance.setSelectedLines({ id: 'diff', range: { start: 2, end: 2, side: 'deletions' } })); await entered.promise;
    const contextOriginal = h.work[pendingFrom].promise;
    const terminal = contextOriginal.catch(error => { if (outcome === 'success') assert.equal(error.name, 'AbortError'); else assert.equal(error, rejection); h.expectFailure(error); }); h.onReadWork(terminal);
    await h.render(null); const b = createDiffReview(rootPatch(8)), bFrom = h.work.length;
    await show({ patch: b.patch, reviewModel: b, onReviewSelection: value => selected.push({ owner: 'B', value }) }); await awaitReads(bFrom); await h.frames.fire(h.frames.take());
    const selectionFrom = h.work.length; await act(async () => current().instance.setSelectedLines({ id: 'diff', range: { start: 3, end: 3, side: 'additions' } })); await awaitReads(selectionFrom);
    const rejection = new Error('Obsolete A selection body failed'); if (outcome === 'success') gate.resolve(matching); else gate.reject(rejection);
    await awaitReads(pendingFrom);
    assert.equal(selected.at(-1).owner, 'B'); assert.equal(selected.at(-1).value.quote, 'Line 3');
  });

  await run('gap controls bind actual shadow buttons once, handle Enter/Space and replay comparison-local expansion', async () => {
    const oldLines = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}\n`), newLines = [...oldLines];
    oldLines[49] = 'Old text\n'; newLines[49] = 'New text\n';
    const patch = 'diff --git a/notes.txt b/notes.txt\nindex 4824a54..d914290 100644\n--- a/notes.txt\n+++ b/notes.txt\n@@ -49,3 +49,3 @@\n Line 49\n-Old text\n+New text\n Line 51\n';
    const context = { oldFile: { name: 'notes.txt', contents: oldLines.join(''), cacheKey: 'immutable:before' },
      newFile: { name: 'notes.txt', contents: newLines.join(''), cacheKey: 'immutable:after' } };
    const model = createDiffReview(patch);
    // Real already-hydrated comparison state, like a reopened cached review.
    // Partial-object fetch/hydration remains in the installed diff-context chain;
    // no asynchronous third-party loader is fabricated or privately extracted.
    api.hydratePartialDiff('merge', model.file, context); model.context = context;
    const props = { patch, reviewModel: model, view: 'split', wrap: false };
    const from = h.work.length; await show(props); await awaitReads(from); await h.frames.fire(h.frames.take());
    const gapButtons = () => [...current().instance.getRenderedItems()[0].element.shadowRoot.querySelectorAll('[data-expand-button]')];
    const first = gapButtons(); assert.equal(first.length > 0, true, 'real omitted context has real gap controls');
    for (const button of first) {
      assert.equal(button.tabIndex, 0); assert.match(button.getAttribute('aria-label'), /^Expand (?:entire gap|previous context|following context|nearby context)$/);
    }
    const instance = current().instance.getRenderedItems()[0].instance, boundExpand = instance.expandHunk, expanded = [];
    t.mock.method(instance, 'expandHunk', function (...args) { expanded.push(args); return boundExpand.apply(this, args); });
    const near = first.find(button => !button.hasAttribute('data-expand-all-button')) ?? first[0];
    let workFrom = h.work.length;
    assert.equal(await key(h.view, near, 'Enter'), true); await awaitReads(workFrom);
    assert.equal(expanded.length, 1, 'one key creates one real native expansion');
    assert.equal(model.expansions.size > 0, true);
    await h.frames.fire(h.frames.take());
    await show({ ...props, wrap: true }); await h.frames.fire(h.frames.take());
    const remaining = gapButtons().find(button => !button.hasAttribute('data-expand-all-button')) ?? gapButtons()[0];
    assert.equal(Boolean(remaining), true, 'another real gap remains after bounded expansion');
    workFrom = h.work.length;
    assert.equal(await key(h.view, remaining, ' '), true); await awaitReads(workFrom);
    assert.equal(expanded.length, 2, 'rebinding must not duplicate keyboard listeners');
    const saved = [...model.expansions].map(([index, amount]) => [index, { ...amount }]);
    await h.render(null); const reopened = h.work.length; await show(props); await awaitReads(reopened); await h.frames.fire(h.frames.take());
    assert.deepEqual([...model.expansions], saved, 'replay does not count the saved expansion twice');
    assert.equal(model.context === context, true); assert.equal(h.requests.length, 0, 'local reading state cannot initiate Git mutation/transport');
  });

  await run('real version/search/line/change/wrap/wide controls bind the current immutable comparison', async () => {
    const model = createDiffReview(rootPatch(120)), from = h.work.length;
    await show({ patch: model.patch, reviewModel: model }); await awaitReads(from); await h.frames.fire(h.frames.take());
    const button = label => h.view.container.querySelector(`[aria-label="${label}"]`);
    await click(h.view, textButton(h.view.container, 'Unified'));
    assert.equal(Boolean(h.view.container.querySelector('[aria-label="Unified diff"]')), true);
    await click(h.view, textButton(h.view.container, 'Side by side'));
    assert.equal(Boolean(h.view.container.querySelector('[aria-label="Side-by-side diff"]')), true);
    await input(h.view, button('Search full file'), 'lInE 50');
    let workFrom = h.work.length;
    await click(h.view, button('Next match')); await awaitReads(workFrom);
    await h.frames.fire(h.frames.take()); await h.frames.fire(h.frames.take());
    assert.deepEqual(selections.at(-1), { id: 'diff', range: { start: 50, end: 50, side: 'additions' } });
    await choose(h.view, button('Search file version'), 'deletions');
    workFrom = h.work.length; await click(h.view, button('Next match')); await awaitReads(workFrom);
    assert.match(h.view.container.textContent, /No matches in this file version/);
    await click(h.view, textButton(h.view.container, 'After')); await awaitReads(h.work.length - 1);
    assert.equal(model.reading, 'after'); assert.equal(Boolean(h.view.container.querySelector('[aria-label="After file"]')), true);
    await input(h.view, button('Line number'), '75'); workFrom = h.work.length;
    await key(h.view, button('Line number'), 'Enter'); await awaitReads(workFrom);
    await h.frames.fire(h.frames.take()); await h.frames.fire(h.frames.take());
    assert.deepEqual(selections.at(-1), { id: 'after', range: { start: 75, end: 75 } });
    await click(h.view, textButton(h.view.container, 'Before')); await awaitReads(h.work.length - 1);
    assert.match(h.view.container.textContent, /does not exist in the before version/);
    await click(h.view, textButton(h.view.container, 'Changes')); await awaitReads(h.work.length - 1);
    await click(h.view, button('Next change'));
    await h.frames.fire(h.frames.take()); await h.frames.fire(h.frames.take());
    assert.equal(model.changeIndex, 0); assert.equal(selections.at(-1).id, 'diff');
    await click(h.view, textButton(h.view.container, 'Wrap lines'));
    assert.equal(textButton(h.view.container, 'Wrap lines').getAttribute('aria-pressed'), 'false');
    await click(h.view, textButton(h.view.container, 'Raw patch'));
    assert.equal(h.view.container.querySelector('[aria-label="Raw patch"]').textContent, model.patch);
    await click(h.view, textButton(h.view.container, 'Side by side')); await h.frames.fire(h.frames.take());
    const wide = textButton(h.view.container, 'Wide view'); wide.focus();
    await click(h.view, wide); const dialog = h.view.container.querySelector('dialog');
    assert.equal(dialog.open, true); assert.equal(dialog.contains(h.view.container.querySelector('.git-diff-code-view')), true);
    assert.equal(await key(h.view, dialog, 'Escape'), true); assert.equal(dialog.open, false);
    assert.equal(h.view.window.document.activeElement === textButton(h.view.container, 'Wide view'), true);
    const saved = JSON.parse(h.view.window.localStorage.getItem('brabbler:git-diff-preferences'));
    assert.deepEqual(saved, { view: 'split', wrap: false }, 'only presentation preferences persist, never contents or search/expansion authority');
    assert.equal(h.requests.length, 0);
  });

  await run('context failures/retry/current refresh and ignored-abort work settle through actual control continuations', async st => {
    const requests = [], closing = new Error('Owned context gate released during cleanup');
    h.expectFailure(closing);
    const release = () => { for (const request of requests) request.gate.reject(closing); };
    h.addDomainRelease(release);
    st.after(async () => { await h.render(null); release(); await awaitReads(0); });
    const loadContext = signal => { const gate = deferred(); requests.push({ gate, signal }); return gate.promise; };
    const context = { oldFile: { name: 'notes.txt', contents: 'First line\nOld text\n', cacheKey: 'captured:parent' },
      newFile: { name: 'notes.txt', contents: 'First line\nNew text\n', cacheKey: 'captured:commit' } };
    const model = createDiffReview(modified), refreshed = [], from = h.work.length;
    const props = { patch: modified, reviewModel: model, view: 'split', wrap: false, loadContext, onRefresh: () => refreshed.push('old') };
    await show(props); await awaitReads(from); assert.equal(requests.length, 0, 'context is lazy even with the real renderer');
    await click(h.view, textButton(h.view.container, 'After'));
    assert.equal(requests.length, 1); assert.equal(model.context, null);
    const failure = new Error('Captured context unavailable'); h.expectFailure(failure);
    let workFrom = from;
    await act(async () => { requests[0].gate.reject(failure); await h.settle(workFrom); });
    assert.match(h.view.container.querySelector('[role=alert]').textContent, /Captured context unavailable/);
    await show({ ...props, onRefresh: () => refreshed.push('current') });
    await click(h.view, textButton(h.view.container, 'Refresh diff')); assert.deepEqual(refreshed, ['current']);
    workFrom = h.work.length;
    await click(h.view, textButton(h.view.container, 'Retry context'));
    assert.equal(requests.length, 2);
    await act(async () => { requests[1].gate.resolve(context); await h.settle(workFrom); });
    assert.equal(model.context === context, true); assert.equal(h.view.container.querySelector('[role=alert]') === null, true);
    await click(h.view, textButton(h.view.container, 'After')); await awaitReads(h.work.length - 1);
    assert.equal(model.reading, 'after');
    assert.match(h.view.container.querySelector('[aria-label="After file"]').textContent, /After · commit/);
    // Admit a different comparison; its pending body outlives observation. Only
    // the exact aborted request may fail with the production-created AbortError.
    const oldModel = createDiffReview(modified), nextFrom = h.work.length;
    await show({ ...props, key: 'pending-old', reviewModel: oldModel }); await awaitReads(nextFrom);
    workFrom = h.work.length; await click(h.view, textButton(h.view.container, 'After'));
    const obsolete = requests.at(-1);
    await show({ patch: rootPatch(2), key: 'new-comparison', view: 'raw' });
    assert.equal(obsolete.signal.aborted, true);
    await act(async () => { obsolete.gate.resolve(context); await h.settle(workFrom); });
    const rejected = h.work.slice(workFrom).filter(entry => entry.error);
    assert.equal(rejected.length, 1); assert.equal(rejected[0].error.name, 'AbortError'); h.expectFailure(rejected[0].error);
    assert.equal(oldModel.context, null); assert.equal(oldModel.reading, 'diff');
    assert.equal(h.view.container.querySelector('[aria-label="Raw patch"]').textContent, rootPatch(2));
  });
  await act(async () => { await h.settle(); });
  assert.equal(asyncRenders.length, 0, 'the warm text fixture must not admit unjoined third-party async rendering');
});
