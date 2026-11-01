import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { packet, click, input, textButton } from './cards-git.fixture.mjs';
import { operationId, review, overview, page, preview, live, deliver, body } from './operation-review.fixture.mjs';
const patch = 'diff --git a/notes.txt b/notes.txt\nindex 4824a54..d914290 100644\n--- a/notes.txt\n+++ b/notes.txt\n@@ -1 +1 @@\n-Old text\n+New text\n';
const top = ['node_modules', '.codegraph', '.next', 'test-results', 'next-env.d.ts'];
const nested = ['node_modules', 'src/meetings/__pycache__', 'src/other/__pycache__', 'next-env.d.ts', 'src/meetings/main.pyc'];
const requestFor = (id, title, roots = []) => ({ type: 'extension_ui_request', method: 'plugin_card', id, pluginId: 'git-workflow', title,
  operationId, review, fields: roots.length ? roots.map(label => ({ label, value: `Needs one-time approval · 1 entries · 14 bytes · SHA256 ${'b'.repeat(64)}` })) : [{ label: 'Checkout', value: '/selected' }, { label: 'Resource', value: id }],
  scope: 'Approves the entire selected operation, not just an expanded file or displayed page.',
  sections: [{ title: 'Operation notes', text: ['rebase', 'merge'].includes(id) ? 'Diffs show feature changes since the merge base, not a predicted rebase/merge result.' : 'Exact selected resources', notice: true }],
  actions: [{ id: 'reject', label: roots.length ? 'Keep resources' : 'Reject' }, { id: 'approve', label: 'Approve operation', primary: true }] });
async function highlighterOwner(h) {
  const highlighter = await h.load('./git-card-highlighter.fixture.mjs');
  const release = () => { highlighter.hold(false); highlighter.releaseAll(); };
  h.addDomainRelease(release);
  h.addDomainJoin(async () => {
    const handlers = highlighter.calls.map(call => call.handler);
    const results = await Promise.allSettled([...highlighter.nativeOriginals, ...handlers.filter(Boolean)]);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (handlers.some(work => !work)) errors.push(new Error('admitted highlighter lacks original handler'));
    if (errors.length) throw new AggregateError(errors, 'native highlighter closure');
  });
  return { highlighter, release };
}
test('seven real v2 card tuples preserve exact descendant promises, current callbacks, resource details and inert outcomes', { timeout: 30_000 }, async t => {
  const h = await packet(t, { review: true, cardDescendants: true }), { highlighter, release } = await highlighterOwner(h);
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx'), { OperationReceiptCard } = await h.load('./OperationReceiptCard.tsx');
  const oldRead = [], currentRead = [], oldObserver = work => { oldRead.push(work); h.onReadWork(work); }, observer = work => { currentRead.push(work); h.onReadWork(work); };
  for (const [kind, title] of [['rebase', 'Git rebase'], ['merge', 'Git merge'], ['createWorktree', 'Create Git worktree'], ['attachWorktree', 'Attach Git worktree'],
    ['removeWorktree', 'Remove Git worktree'], ['top', 'Clean up integrated Git feature'], ['nested', 'Clean up integrated Git feature']]) {
    const roots = kind === 'top' ? top : kind === 'nested' ? nested : [], hasFiles = ['rebase', 'merge'].includes(kind);
    const request = requestFor(kind, title, roots), old = [], current = [], from = h.work.length, callsFrom = highlighter.calls.length;
    highlighter.hold();
    await h.render(createElement(BlockingRequestCard, { request, sessionId: 'current', onReadWork: oldObserver, onRespond: (...args) => old.push(args) }));
    const metadata = overview(); metadata.hasFiles = hasFiles;
    if (!hasFiles) { metadata.views[0].available = false; metadata.views[0].reason = 'Resources, not a patch. Inspect metadata.'; }
    await deliver(h, 'overview', metadata);
    if (hasFiles) {
      await deliver(h, 'page', page('notes.txt')); await deliver(h, 'preview', preview(patch));
      const calls = highlighter.calls.slice(callsFrom); assert.ok(calls.length);
      for (const call of calls) assert.equal(h.work.some(entry => entry.promise === call.handler), true, 'parent owns SAME complete highlighter handler');
    } else assert.equal(highlighter.calls.length, callsFrom);
    const oldCount = oldRead.length, requestCount = h.requests.length, updated = { ...request, title: `${title} current` };
    await h.render(createElement(BlockingRequestCard, { request: updated, sessionId: 'current', onReadWork: observer, onRespond: (...args) => current.push(args) }));
    assert.equal(h.requests.length, requestCount); assert.equal(oldRead.length, oldCount);
    release(); await h.settle(from);
    assert.equal(Boolean(h.view.container.querySelector('.git-diff-code-view')), hasFiles, 'actual shared parsed reader, not copied decision logic');
    for (const path of roots) assert.equal([...h.view.container.querySelectorAll('dt')].some(node => node.textContent === path), true);
    assert.equal(h.requests.some(read => read.url.searchParams.get('op') === 'details'), false, 'full metadata remains lazy');
    await click(h.view, textButton(h.view.container, roots.length ? 'Keep resources' : 'Reject'));
    assert.equal(old.length, 0); assert.equal(current.length, 1); assert.equal(current[0][0], updated); assert.deepEqual(current[0][1], { action: 'reject' });
    await h.render(null); await h.settle(from);
    if (roots.length) for (let reload = 0; reload < 2; reload++) {
      const receipt = { version: 1, pluginId: 'git-workflow', sequence: 1, operationId, card: { ...request, actions: [] }, phase: 'succeeded', effectStarted: true, checks: [],
        authorization: { mode: 'ask', source: 'one-time artifacts (project allow)', revision: 'revision', decision: 'user-approved' } };
      await h.render(createElement(OperationReceiptCard, { receipt: JSON.parse(JSON.stringify(receipt)) }));
      await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
      assert.match(h.view.container.textContent, /Succeeded/);
      for (const path of roots) assert.equal([...h.view.container.querySelectorAll('dt')].some(node => node.textContent === path), true);
      for (const button of h.view.container.querySelectorAll('button')) assert.doesNotMatch(button.textContent, /Keep resources|Approve operation|Reject|Cancel/);
      await h.render(null);
    }
  }
  // An admitted selected body and native highlighter remain distinct owned work
  // across unmount; abort acknowledgements are not descendant settlement.
  highlighter.hold(); const callsFrom = highlighter.calls.length, from = h.work.length;
  const request = { ...requestFor('held', 'Held descendant'), patch };
  await h.render(createElement(BlockingRequestCard, { request, sessionId: 'current', onReadWork: observer, onRespond() {} }));
  const held = live(h, 'overview'), calls = highlighter.calls.slice(callsFrom); assert.ok(calls.length);
  await h.render(null); assert.equal(held.signal.aborted, true);
  await deliver(h, 'overview', overview()); assert.equal(highlighter.calls.length, callsFrom + calls.length);
  release(); await h.settle(from);
});

test('real session and historical v2 parents retain both original 5000-line reader tuples, lazy selected context, position, raw and error ownership', { timeout: 30_000 }, async t => {
  const h = await packet(t, { review: true, cardDescendants: true }), { release } = await highlighterOwner(h);
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx'), { InteractionReceiptCard } = await h.load('./InteractionReceiptCard.tsx'), { OperationReceiptCard } = await h.load('./OperationReceiptCard.tsx');
  const pierre = await import('@pierre/diffs'), setups = [], setup = pierre.CodeView.prototype.setup;
  t.mock.method(pierre.CodeView.prototype, 'setup', function (...args) { const value = setup.apply(this, args); setups.push({ instance: this, container: this.getContainerElement() }); return value; });
  const bindFrames = async () => { await h.frames.fire(h.frames.take()); await h.frames.fire(h.frames.take()); await h.frames.fire(h.frames.take()); };
  const phase = value => console.log(`[v2-reader] ${value}`);
  for (const width of [1280, 390]) {
    phase(`input:${width}`);
    const oldLines = Array.from({ length: 5000 }, (_, index) => `Plugin context ${index + 1}\n`);
    if (width === 390) { oldLines[49] = 'Plugin whole-file candidate allow-1280\n'; oldLines[4499] = 'Plugin distant candidate allow-1280\n'; }
    const newLines = [...oldLines]; newLines[49] = `Plugin whole-file candidate reconnect-${width}\n`; newLines[4499] = `Plugin distant candidate reconnect-${width}\n`;
    const firstPatch = `diff --git a/draft.txt b/draft.txt\nindex 4824a54..d914290 100644\n--- a/draft.txt\n+++ b/draft.txt\n@@ -47,7 +47,7 @@\n Plugin context 47\n Plugin context 48\n Plugin context 49\n-${oldLines[49].trimEnd()}\n+Plugin whole-file candidate reconnect-${width}\n Plugin context 51\n Plugin context 52\n Plugin context 53\n@@ -4497,7 +4497,7 @@\n Plugin context 4497\n Plugin context 4498\n Plugin context 4499\n-${oldLines[4499].trimEnd()}\n+Plugin distant candidate reconnect-${width}\n Plugin context 4501\n Plugin context 4502\n Plugin context 4503\n`;
    const secondPatch = width === 1280 ? `diff --git a/second-draft.txt b/second-draft.txt\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/second-draft.txt\n@@ -0,0 +1 @@\n+Second plugin candidate reconnect-${width}\n`
      : `diff --git a/second-draft.txt b/second-draft.txt\nindex 1111111..2222222 100644\n--- a/second-draft.txt\n+++ b/second-draft.txt\n@@ -1 +1 @@\n-Second plugin candidate allow-1280\n+Second plugin candidate reconnect-${width}\n`;
    const snapshot = { oldFile: { name: 'draft.txt', contents: oldLines.join(''), cacheKey: `old-${width}` }, newFile: { name: 'draft.txt', contents: newLines.join(''), cacheKey: `proposed-${width}` } };
    const request = { ...requestFor(`reader-${width}`, 'Git commit'), patchBefore: 'HEAD', patchAfter: 'Proposed', actions: [{ id: 'reject', label: 'Reject' }, { id: 'approve', label: 'Approve commit', primary: true }] };
    const first = () => h.view.container.querySelector('[aria-label="File changes: draft.txt"]');
    const control = name => first().querySelector(`[aria-label="${name}"]`);
    const reader = () => { const container = first().querySelector('.git-diff-code-view'), record = setups.findLast(item => item.container === container);
      assert.ok(record, 'real CodeView setup'); const item = record.instance.getRenderedItems()[0]; assert.ok(item?.element.shadowRoot); return { ...record, item }; };
    const expectLine = (number, text) => assert.equal([...reader().item.element.shadowRoot.querySelectorAll(`[data-line="${number}"]`)].some(row => row.textContent.trimEnd() === text), true, `selected renderer line ${number}`);
    const jump = async (number, text) => { await input(h.view, control('Line number'), String(number)); await click(h.view, textButton(first(), 'Go to line')); release(); await h.settle(); await bindFrames(); expectLine(number, text); };
    const start = h.requests.length, contextReads = () => h.requests.slice(start).filter(read => read.url.searchParams.get('op') === 'context');
    const hydrate = async () => {
      phase('hydrate:begin');
      await deliver(h, 'overview', overview(), undefined, start); await deliver(h, 'page', page('draft.txt', 'second-draft.txt'), undefined, start);
      await deliver(h, 'preview', preview(firstPatch), undefined, start); release(); await h.settle(); await bindFrames(); assert.ok(first()); phase('hydrate:end');
    };
    const showFull = async () => {
      phase('full:begin');
      await click(h.view, textButton(first(), 'Show full file')); await body(h, live(h, 'context'), snapshot); release(); await h.settle(); await bindFrames(); phase('full:end');
    };
    const responses = [];
    await h.render(createElement(BlockingRequestCard, { request, sessionId: 'current', onReadWork: h.onReadWork, onRespond: (...args) => responses.push(args) })); await hydrate();
    await click(h.view, textButton(h.view.container, 'Side by side')); assert.equal(contextReads().length, 0);
    await showFull(); await jump(2500, 'Plugin context 2500');
    await click(h.view, textButton(first(), 'Diff context')); await click(h.view, textButton(h.view.container, 'Unified'));
    await click(h.view, textButton(first(), 'Show full file')); await h.settle(); await bindFrames(); assert.equal(contextReads().length, 1);
    await jump(2500, 'Plugin context 2500'); phase('unified:end');
    await click(h.view, textButton(first(), 'Before')); await h.settle(); await bindFrames(); await jump(50, oldLines[49].trimEnd()); await jump(4500, oldLines[4499].trimEnd());
    await click(h.view, textButton(first(), 'After')); await h.settle(); await bindFrames(); await jump(50, newLines[49].trimEnd()); await jump(4500, newLines[4499].trimEnd());
    await input(h.view, control('Search full file'), 'plugin context 2500'); await click(h.view, control('Next match')); await h.settle(); await bindFrames(); expectLine(2500, 'Plugin context 2500');
    assert.equal(first().textContent.includes('1/1 matches'), true);
    const restoreMode = width === 1280 ? 'After' : 'Before';
    if (restoreMode === 'Before') { await click(h.view, textButton(first(), 'Before')); await h.settle(); await bindFrames(); await jump(2500, 'Plugin context 2500'); }
    await h.view.dispatch(reader().container, new h.view.window.Event('scroll')); await bindFrames(); const oldRenderer = reader().instance;
    phase('second:begin');
    await click(h.view, h.view.container.querySelector('[aria-label="Next file"]')); await deliver(h, 'preview', preview(secondPatch)); release(); await h.settle(); await bindFrames(); assert.equal(first() === null, true);
    const second = h.view.container.querySelector('[aria-label="File changes: second-draft.txt"]'); assert.equal(textButton(second, 'Show full file').getAttribute('aria-pressed'), 'false');
    phase('first:restore:begin'); const restoreFrom = h.work.length;
    await click(h.view, h.view.container.querySelector('[aria-label="Previous file"]')); await deliver(h, 'preview', preview(firstPatch));
    assert.ok(live(h, 'context'), 'only reselected file reloads released context for its saved reading intent');
    assert.doesNotMatch(first().textContent, /This file does not exist/, 'held restored context is not a known absent side');
    assert.match(first().textContent, /Loading/);
    assert.equal(first().querySelector('[aria-label="Raw patch"]').textContent, firstPatch, 'unchanged patch remains accessible while restoring');
    assert.ok(textButton(h.view.container, 'Approve commit'));
    await body(h, live(h, 'context'), { error: 'Restored context unavailable.' }, { status: 409 }); release(); await h.settle(); await bindFrames();
    for (const entry of h.work.slice(restoreFrom)) if (entry.error) {
      if (entry.error.name !== 'AbortError') assert.equal(entry.error.message, 'Restored context unavailable.');
      h.expectFailure(entry.error);
    }
    assert.doesNotMatch(first().textContent, /This file does not exist/);
    assert.match(first().querySelector('[role="alert"]').textContent, /Restored context unavailable/);
    await click(h.view, textButton(h.view.container, 'Raw patch'));
    assert.equal(first().querySelector('[aria-label="Raw patch"]').textContent, firstPatch);
    await click(h.view, textButton(first(), 'Retry context'));
    await body(h, live(h, 'context'), snapshot); await h.settle(); await bindFrames();
    phase('first:restore:end');
    assert.equal(reader().instance !== oldRenderer, true); assert.equal(textButton(first(), restoreMode).getAttribute('aria-pressed'), 'true'); assert.equal(control('Search full file').value, 'plugin context 2500'); expectLine(2500, 'Plugin context 2500');
    await click(h.view, textButton(first(), 'Changes')); await click(h.view, textButton(h.view.container, 'Unified')); await h.settle(); await bindFrames();
    await click(h.view, h.view.container.querySelector('[aria-label="Collapse"]')); await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
    await h.settle(); await bindFrames(); assert.ok(first().querySelector('[aria-label="Unified diff"]')); assert.equal(contextReads().length, 3);
    assert.equal(responses.length, 0);
    await h.render(null); await h.settle();
    // Serialized remount and a real context error keep the immutable patch and
    // current action callback. Error identity is observed through the full owner.
    await h.render(createElement(BlockingRequestCard, { request: JSON.parse(JSON.stringify(request)), sessionId: 'current', onReadWork: h.onReadWork, onRespond: (...args) => responses.push(args) })); await hydrate();
    await click(h.view, textButton(h.view.container, 'Side by side')); const from = h.work.length;
    await click(h.view, textButton(first(), 'Show full file'));
    await body(h, live(h, 'context'), { error: 'Captured objects unavailable.' }, { status: 409 }); await h.settle(from);
    const errors = h.work.slice(from).filter(entry => entry.error); assert.ok(errors.length);
    for (const entry of errors) { assert.equal(entry.error, errors[0].error); h.expectFailure(entry.error); }
    assert.match(first().querySelector('[role="alert"]').textContent, /Captured objects unavailable/);
    await click(h.view, textButton(h.view.container, 'Raw patch')); assert.equal(first().querySelector('[aria-label="Raw patch"]').textContent, firstPatch);
    const updated = { ...request, title: 'Current Git commit' }; await h.render(createElement(BlockingRequestCard, { request: updated, sessionId: 'current', onReadWork: h.onReadWork, onRespond: (...args) => responses.push(args) }));
    await click(h.view, textButton(h.view.container, 'Approve commit')); assert.equal(responses.length, 1); assert.equal(responses[0][0], updated); assert.deepEqual(responses[0][1], { action: 'approve' });
    await h.render(null); await h.settle();
    const decision = { version: 1, outcome: 'answered', request, response: { action: 'approve' } }, outcome = { version: 1, pluginId: 'git-workflow', sequence: 1, operationId, card: request,
      phase: 'succeeded', effectStarted: true, checks: [], authorization: { mode: 'ask', source: 'builtin', revision: 'reader-origin', decision: 'user-approved' } };
    for (const [Component, receipt] of [[InteractionReceiptCard, decision], [OperationReceiptCard, outcome]]) {
      const before = h.requests.length;
      await h.render(createElement(Component, { receipt: JSON.parse(JSON.stringify(receipt)), sessionId: 'current', onReadWork: h.onReadWork }));
      assert.equal(h.requests.length, before); await click(h.view, h.view.container.querySelector('.blocking-card-collapsed')); await hydrate();
      await click(h.view, textButton(h.view.container, 'Side by side')); await showFull();
      await click(h.view, textButton(first(), 'Before')); await h.settle(); await bindFrames(); await jump(50, oldLines[49].trimEnd());
      await click(h.view, textButton(first(), 'Changes'));
      await click(h.view, textButton(h.view.container, 'Raw patch')); assert.equal(first().querySelector('[aria-label="Raw patch"]').textContent, firstPatch);
      for (const button of h.view.container.querySelectorAll('button')) assert.doesNotMatch(button.textContent, /Approve commit|Reject|Cancel/);
      await click(h.view, h.view.container.querySelector('[aria-label="Collapse"]')); assert.equal(h.view.container.querySelector('.git-diff-code-view') === null, true);
      if (Component === InteractionReceiptCard) {
        await click(h.view, h.view.container.querySelector('.blocking-card-collapsed')); await hydrate();
        await click(h.view, textButton(h.view.container, 'Side by side'));
        const contextsBefore = contextReads().length, failedFrom = h.work.length;
        await click(h.view, textButton(first(), 'Show full file'));
        await body(h, live(h, 'context'), { error: 'Historical captured objects unavailable.' }, { status: 409 }); await h.settle(failedFrom);
        const failures = h.work.slice(failedFrom).filter(entry => entry.error); assert.ok(failures.length, 'historical parent forwards complete rejected reads');
        for (const entry of failures) { assert.equal(entry.error, failures[0].error); h.expectFailure(entry.error); }
        assert.match(first().querySelector('[role="alert"]').textContent, /Historical captured objects unavailable/);
        await click(h.view, textButton(h.view.container, 'Raw patch')); assert.equal(first().querySelector('[aria-label="Raw patch"]').textContent, firstPatch);
        assert.equal(contextReads().length, contextsBefore + 1, 'historical context failure never retries itself');
        const count = h.work.length, historicalObserver = [];
        await h.render(createElement(Component, { receipt, sessionId: 'current', onReadWork: work => { historicalObserver.push(work); h.onReadWork(work); } }));
        assert.equal(h.work.length, count); assert.equal(historicalObserver.length, 0, 'historical observer replacement does not replay accepted work');
        for (const button of h.view.container.querySelectorAll('button')) assert.doesNotMatch(button.textContent, /Approve commit|Reject|Cancel/);
      }
      await h.render(null); await h.settle();
    }
  }
  await h.cleanup();
});
