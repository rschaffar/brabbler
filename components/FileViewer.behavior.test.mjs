import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { filesRuntime } from './files-runtime.fixture.mjs';

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false,
});
let composition;
const defaults = { filePath: '/root/a.txt', cwd: '/root', sourceSessionId: 'session-a', watchEnabled: false };
const denied = { edit: false, gitDiff: false };
const editable = { edit: true, gitDiff: false };
const eligible = { edit: true, gitDiff: true };
function read(content, probeEligibility = denied, language = 'text') {
  return { content, language, size: content.length, nextOffset: content.length, truncated: false, probeEligibility };
}
function expectRead(runtime, props) {
  return runtime.expect({ type: 'read', path: props.filePath, sessionId: props.sourceSessionId, viewerCwd: props.cwd });
}
function expectEdit(runtime, props) {
  return runtime.expect({ type: 'edit', path: props.filePath, sessionId: props.sourceSessionId });
}
function expectGit(runtime, props) {
  return runtime.expect({ type: 'git', path: props.filePath, cwd: props.cwd });
}
function button(root, text) {
  const result = [...root.querySelectorAll('button')].find(node => node.textContent === text);
  assert.equal(Boolean(result), true, `missing button ${text}`);
  return result;
}
function reader(view, id = 'reader') {
  const result = view.container.querySelector(`[data-test-view="${id}"]`);
  assert.equal(Boolean(result), true, `missing reader ${id}`); return result;
}
async function click(view, node, options = {}) {
  assert.equal(Boolean(node), true, 'click target must be mounted');
  await view.dispatch(node, new view.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
}
async function type(view, field, value) {
  // Bypass React's value tracker, not its actual DOM input/onChange handling.
  const setter = Object.getOwnPropertyDescriptor(view.window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(field, value);
  await view.dispatch(field, new view.window.Event('input', { bubbles: true }));
}
async function open(t, overrides = {}) {
  const props = { ...defaults, ...overrides }, runtime = filesRuntime(t);
  let view;
  // Register BEFORE mount; keep collector alive through gate rejection and joins.
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  // Install capability denial before the first actual production graph import,
  // not only before effects mount. Ordinary module identity is shared thereafter.
  const { FileViewerComposition, FileEditSessions } = await (composition ??= jiti.import('./file-viewer-composition.fixture.tsx'));
  const store = new FileEditSessions();
  const initial = [expectRead(runtime, props), expectRead(runtime, props)];
  const element = viewers => createElement(FileViewerComposition, { store, viewers });
  view = await mount(t, element([{ ...props, viewId: 'reader' }]), { setup: runtime.setup });
  assert.equal(runtime.requests.length, 2, 'real Strict Effects admits replay plus current read');
  return {
    view, runtime, store, props, initial,
    async render(next, extra = []) {
      await view.rerender(element([{ ...next, viewId: 'reader' }, ...extra]));
      runtime.assertHealthy();
    },
  };
}
function expectText(view, expected) {
  assert.equal(reader(view).querySelector('.file-source-line-content')?.textContent, expected);
}

for (const dimension of ['filePath', 'sourceSessionId', 'cwd']) {
  test(`Strict A/B/A admits only the current ${dimension}, despite delivered obsolete JSON/catch/finally`, async t => {
    const h = await open(t);
    const { view, runtime, props, initial: [replay, a1] } = h;
    await replay.headers(); await a1.headers();
    const b = { ...props, [dimension]: { filePath: '/root/b.txt', sourceSessionId: 'session-b', cwd: '/other-root' }[dimension] };
    const b1 = expectRead(runtime, b);
    await h.render(b); await b1.headers();
    const a2 = expectRead(runtime, props);
    await h.render(props); await a2.headers();
    assert.equal(reader(view).textContent, 'Loading...');
    // Old success + its reset-effect finally run while the newest read is held.
    // Eligible poison must NOT admit any probes from an obsolete read.
    await a1.deliver(read('obsolete A', eligible));
    assert.equal(a1.jsonReturned, true);
    assert.equal(reader(view).textContent, 'Loading...', 'old finally cannot expose an empty/new reader early');
    assert.equal(runtime.requests.length, 4);
    await a2.deliver(read('current A'));
    expectText(view, 'current A');
    await b1.rejectBody(new Error('obsolete B body failed'));
    expectText(view, 'current A');
    await replay.deliver({ error: 'obsolete replay JSON error', probeEligibility: eligible });
    assert.equal(replay.jsonReturned, true);
    expectText(view, 'current A');
    assert.doesNotMatch(reader(view).textContent, /obsolete/);
    assert.equal(runtime.requests.length, 4, 'no edit or Git from obsolete hints');
    runtime.assertHealthy();
  });
}

test('current read failure survives late successes and rejected obsolete headers', async t => {
  const h = await open(t);
  const { view, runtime, props, initial: [replay, a1] } = h;
  const b = { ...props, filePath: '/root/missing.txt' };
  const b1 = expectRead(runtime, b); await h.render(b);
  await b1.deliver({ error: 'current missing file', probeEligibility: denied }, { status: 404 });
  assert.equal(reader(view).textContent, 'current missing file');
  await a1.deliver(read('stale success', eligible));
  await replay.rejectHeaders(new Error('obsolete headers failed'));
  assert.equal(reader(view).textContent, 'current missing file');
  assert.equal(runtime.requests.length, 3);
});

for (const [label, hint] of [
  ['missing', undefined], ['non-boolean', { edit: 'true', gitDiff: 1 }], ['false', denied],
]) {
  test(`${label} hints forbid edit/Save/Git through connected/change/reopen`, async t => {
    const h = await open(t);
    const { view, runtime, props, initial: [replay, current] } = h;
    await current.headers();
    assert.equal(runtime.requests.length, 2, 'no probes before a read hint');
    const payload = read('read-only');
    if (hint === undefined) delete payload.probeEligibility;
    else payload.probeEligibility = hint;
    await current.deliver(payload); await replay.deliver(read('obsolete', eligible));
    assert.equal(runtime.sources.length, 0, 'watch disabled admits no stream');
    for (let cycle = 0; cycle < 2; cycle++) {
      await h.render({ ...props, watchEnabled: true });
      assert.equal(runtime.liveSources.length, 1);
      const source = runtime.liveSources[0];
      assert.equal(source.url.pathname, '/api/files/root/a.txt');
      assert.deepEqual([...source.url.searchParams].sort(), [['sessionId', props.sourceSessionId], ['type', 'watch']]);
      const connected = expectRead(runtime, props);
      await source.connected(); await connected.deliver(payload);
      const changed = expectRead(runtime, props);
      await source.change(); await changed.deliver(payload);
      assert.equal(reader(view).querySelector('textarea') === null, true);
      assert.ok(![...reader(view).querySelectorAll('button')].some(node => ['Edit', 'Save', 'Diff'].includes(node.textContent)));
      await h.render(props);
      assert.equal(source.closeCalls, 1);
      assert.equal(runtime.liveSources.length, 0);
      const count = runtime.requests.length;
      await source.invokeRetained('connected'); await source.invokeRetained('change');
      assert.equal(runtime.requests.length, count, 'disposed text listener cannot start a read');
    }
    assert.ok(runtime.requests.every(request => request.match.type === 'read'));
    runtime.assertHealthy();
  });
}

for (const nextCwd of ['/new-checkout', '/old-checkout']) {
  test(`disposed connected-read cannot admit or invalidate current probes (${nextCwd})`, async t => {
    const h = await open(t, { filePath: '/file.txt', cwd: '/old-checkout', watchEnabled: true });
    const { view, runtime, props, initial: [replay, initial] } = h;
    assert.equal(runtime.sources.length, 2, 'Strict watcher replay is real');
    assert.equal(runtime.sources[0].closeCalls, 1);
    assert.equal(runtime.liveSources.length, 1);
    await initial.deliver(read('original')); await replay.deliver(read('obsolete replay'));
    const oldSource = runtime.liveSources[0], oldRead = expectRead(runtime, props);
    assert.equal(oldSource.url.pathname, '/api/files/file.txt');
    assert.deepEqual([...oldSource.url.searchParams].sort(), [['sessionId', props.sourceSessionId], ['type', 'watch']]);
    await oldSource.connected(); await oldRead.headers();
    assert.equal(Boolean(reader(view).querySelector('[aria-label="Live sync active"]')), true);
    const paused = { ...props, cwd: nextCwd, watchEnabled: false };
    // Different cwd resets content; same textual cwd is a *watch-only* new
    // lifetime and must still invalidate the old awaited continuation.
    const reset = nextCwd === props.cwd ? null : expectRead(runtime, paused);
    await h.render(paused);
    assert.equal(oldSource.closeCalls, 1);
    assert.equal(runtime.liveSources.length, 0);
    if (reset) await reset.deliver(read('reset checkout'));
    await h.render({ ...paused, watchEnabled: true });
    const source = runtime.liveSources[0];
    assert.equal(source !== oldSource, true);
    assert.equal(source.url.href, oldSource.url.href, 'watch endpoint captures path/session, not viewerCwd');
    const currentRead = expectRead(runtime, paused);
    await source.connected();
    const edit = expectEdit(runtime, paused), git = expectGit(runtime, paused);
    await currentRead.deliver(read('current eligible read', eligible));
    await edit.headers(); await git.headers();
    const count = runtime.requests.length;
    await oldRead.deliver(read('old connected result', eligible));
    assert.equal(runtime.requests.length, count, 'disposed continuation cannot start probes, even with same cwd');
    expectText(view, 'current eligible read');
    await edit.deliver({ content: 'current eligible read', revision: 'current-r', writable: true, editIdentity: 'current-file' });
    await git.deliver({ supported: false });
    assert.equal(button(reader(view), 'Edit').disabled, false, 'current edit generation remains admissible');
    await source.error();
    assert.equal(Boolean(reader(view).querySelector('[aria-label="Not watching"]')), true);
    const closingRead = expectRead(runtime, paused);
    await source.change(); await closingRead.headers();
    await view.unmount();
    assert.equal(source.closeCalls, 1);
    const atUnmount = runtime.requests.length;
    await closingRead.deliver(read('delivered after unmount', eligible));
    await source.invokeRetained('connected'); await source.invokeRetained('change');
    assert.equal(runtime.requests.length, atUnmount, 'no forbidden probes after observer cleanup');
    assert.equal(runtime.liveSources.length, 0);
    runtime.assertHealthy();
  });
}

test('watch reconnect captures the replacement file/session, not the previous reader', async t => {
  const h = await open(t, { watchEnabled: true });
  const { view, runtime, props, initial: [replay, initial] } = h;
  await initial.deliver(read('old reader')); await replay.deliver(read('obsolete'));
  const oldSource = runtime.liveSources[0];
  const next = { ...props, filePath: '/root/replacement.txt', sourceSessionId: 'replacement-session' };
  const reset = expectRead(runtime, next);
  await h.render(next); await reset.deliver(read('replacement reader'));
  assert.equal(oldSource.closeCalls, 1); assert.equal(runtime.liveSources.length, 1);
  const source = runtime.liveSources[0];
  assert.equal(source.url.pathname, '/api/files/root/replacement.txt');
  assert.deepEqual([...source.url.searchParams].sort(), [['sessionId', 'replacement-session'], ['type', 'watch']]);
  const connected = expectRead(runtime, next);
  await source.connected(); await connected.deliver(read('replacement connected read'));
  expectText(view, 'replacement connected read');
  const count = runtime.requests.length;
  await oldSource.invokeRetained('connected'); await oldSource.invokeRetained('change');
  assert.equal(runtime.requests.length, count);
  runtime.assertHealthy();
});

for (const outcome of ['unsupported JSON', 'JSON error', 'rejected body']) {
  test(`older Git ${outcome}/finally cannot finish current loading; read error still permits Git`, async t => {
    const h = await open(t, { initialDisplayMode: 'diff' });
    const { view, runtime, props, initial: [replay, current] } = h;
    const oldGit = expectGit(runtime, props);
    await current.deliver({ error: 'deleted working file', probeEligibility: { edit: false, gitDiff: true } }, { status: 404 });
    await oldGit.headers({ status: outcome === 'JSON error' ? 500 : 200 });
    assert.equal(reader(view).textContent, 'Loading...');
    assert.ok(runtime.requests.every(request => request.match.type !== 'edit'));
    const newGit = expectGit(runtime, props);
    await h.render({ ...props, gitRefreshKey: 1 }); await newGit.headers();
    if (outcome === 'rejected body') await oldGit.rejectBody(new Error('obsolete Git failed'));
    else await oldGit.deliver(outcome === 'JSON error' ? { error: 'obsolete Git error' } : { supported: false }, { status: outcome === 'JSON error' ? 500 : 200 });
    assert.equal(reader(view).textContent, 'Loading...', 'current gitDiffLoading is still true until its OWN finally');
    await newGit.deliver({ supported: false });
    assert.equal(reader(view).textContent, 'deleted working file');
    await replay.deliver(read('obsolete replay', eligible));
    assert.equal(reader(view).textContent, 'deleted working file');
    assert.equal(runtime.requests.length, 4);
    runtime.assertHealthy();
  });
}

test('late supported Git JSON cannot resurrect a resolved deleted-file diff', async t => {
  const h = await open(t, { initialDisplayMode: 'diff' });
  const { view, runtime, props, initial: [replay, current] } = h;
  const oldGit = expectGit(runtime, props);
  await current.deliver({ error: 'current missing file', probeEligibility: { edit: false, gitDiff: true } });
  await oldGit.headers();
  const currentGit = expectGit(runtime, props);
  await h.render({ ...props, gitRefreshKey: 1 });
  await currentGit.deliver({ supported: false });
  assert.equal(reader(view).textContent, 'current missing file');
  // A real valid patch is poison ONLY because this is an obsolete generation.
  // No fake Diff success child is installed; correct production never mounts it.
  await oldGit.deliver({ supported: true, status: 'deleted', revision: 'obsolete',
    patch: 'diff --git a/a.txt b/a.txt\ndeleted file mode 100644\nindex 7898192..0000000\n--- a/a.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n' });
  assert.equal(reader(view).textContent, 'current missing file');
  await replay.deliver(read('obsolete replay'));
  runtime.assertHealthy();
});

test('actual held PUT preserves typing back to old baseline, edit ownership and the new revision', async t => {
  const drafts = [], saving = [];
  const h = await open(t, {
    watchEnabled: true,
    onDraftChange: draft => drafts.push(draft), onSavingChange: value => saving.push(['initial', value]),
  });
  const { view, runtime, props, store, initial: [replay, initial] } = h;
  const edit = expectEdit(runtime, props);
  await initial.deliver(read('A', editable)); await replay.deliver(read('obsolete'));
  await edit.deliver({ content: 'A', revision: 'r1', writable: true, editIdentity: 'server-file-identity' });
  await click(view, button(reader(view), 'Edit'));
  const field = reader(view).querySelector('textarea'); assert.equal(Boolean(field), true); assert.equal(field.value, 'A');
  const source = runtime.liveSources[0], connected = expectRead(runtime, props);
  await source.connected();
  const oldEdit = expectEdit(runtime, props);
  await connected.deliver(read('A', editable)); await oldEdit.headers();
  await type(view, field, 'B');
  assert.equal(store.snapshot('reader').draft.content, 'B');
  const save = runtime.expect({ type: 'save', path: props.filePath, sessionId: props.sourceSessionId,
    body: { content: 'B', expectedRevision: 'r1', expectedEditIdentity: 'server-file-identity' } });
  await click(view, button(reader(view), 'Save')); await save.headers();
  assert.equal(store.snapshot('reader').saving, true);
  assert.equal(field.readOnly, false, 'original save owner stays writable');
  await type(view, field, 'A');
  const beforeOld = { content: 'A', baseline: 'A', revision: 'r1' };
  assert.deepEqual(store.snapshot('reader').draft, beforeOld);
  // This challenges fetchEditable's ENTRY savingRef guard, independently of
  // its redundant response-generation/saving guards. A/A looks clean, so the
  // actual watcher is allowed to read while PUT is held, but never to admit an
  // edit probe. No edit plan exists: even a swallowed fetch is a live failure.
  const duringSaveRead = expectRead(runtime, props), beforeWatch = runtime.requests.length;
  await source.change(); await duringSaveRead.deliver(read('A', editable));
  assert.equal(duringSaveRead.jsonReturned, true);
  assert.equal(runtime.requests.length, beforeWatch + 1, 'held Save watcher permits read only, not edit admission');
  assert.equal(store.snapshot('reader').saving, true);
  assert.deepEqual(store.snapshot('reader').draft, beforeOld);
  const reportsBefore = drafts.length;
  await oldEdit.deliver({ content: 'A', revision: 'obsolete-r', writable: true, editIdentity: 'server-file-identity' });
  assert.equal(reader(view).querySelector('textarea') === field, true, 'original textarea retained during Save');
  assert.equal(field.value, 'A');
  assert.deepEqual(store.snapshot('reader').draft, beforeOld, 'late edit cannot clear a clean-looking in-flight draft');
  assert.equal(drafts.length, reportsBefore);
  // Mount an actual duplicate through the SAME real provider/store while PUT is
  // held. It may read/probe; it must not acquire the writable editor.
  const duplicateProps = { ...defaults, watchEnabled: false, filePath: props.filePath };
  const duplicateReads = [expectRead(runtime, duplicateProps), expectRead(runtime, duplicateProps)];
  const currentProps = { ...props, onSavingChange: value => saving.push(['current', value]) };
  await h.render(currentProps, [{ ...duplicateProps, viewId: 'duplicate' }]);
  const duplicateEdit = expectEdit(runtime, duplicateProps);
  await duplicateReads[1].deliver(read('A', editable)); await duplicateReads[0].deliver(read('obsolete'));
  await duplicateEdit.deliver({ content: 'A', revision: 'r1', writable: true, editIdentity: 'server-file-identity' });
  assert.equal(Boolean(button(reader(view, 'duplicate'), 'Go to editor')), true);
  assert.equal(reader(view, 'duplicate').querySelector('textarea') === null, true);
  assert.equal(store.snapshot('reader').owner, 'reader');
  const afterSaveRead = expectRead(runtime, props);
  await save.deliver({ revision: 'r2' });
  assert.equal(save.jsonReturned, true);
  assert.equal(store.snapshot('reader').saving, false);
  assert.deepEqual(store.snapshot('reader').draft, { content: 'A', baseline: 'B', revision: 'r2' });
  assert.equal(reader(view).querySelector('textarea') === field, true, 'original textarea retained after Save'); assert.equal(field.value, 'A');
  assert.equal(button(reader(view), 'Save').disabled, false);
  assert.deepEqual(saving, [['initial', true], ['current', false]], 'settlement calls current callback');
  await afterSaveRead.deliver(read('B', editable));
  assert.equal(field.value, 'A', 'saved-content refresh does not replace a new draft');
  runtime.assertHealthy();
});

test('real Markdown default preview, current link callback and stable focused blocked trigger survive watcher reads', async t => {
  const oldOpened = [], opened = [];
  const markdown = '[blocked](../../escape.md)\n\n[chapter](chapter.md#L4-L7)\n\n[pdf](../manual.pdf#page=3)';
  const h = await open(t, { filePath: '/root/docs/guide.md', watchEnabled: true, onOpenFile: (...args) => oldOpened.push(args) });
  const { view, runtime, props, initial: [replay, initial] } = h;
  assert.equal(reader(view).textContent, 'Loading...');
  await initial.deliver(read(markdown, denied, 'markdown')); await replay.deliver(read('obsolete'));
  assert.equal(button(reader(view), 'Preview').getAttribute('aria-pressed'), 'true');
  const blocked = reader(view).querySelector('.blocked-file-link-trigger'); assert.equal(Boolean(blocked), true);
  assert.equal(blocked.hasAttribute('href'), false);
  await act(() => blocked.focus()); await click(view, blocked);
  assert.equal(blocked.getAttribute('aria-expanded'), 'true');
  const explanation = reader(view).querySelector('.blocked-file-link-explanation');
  assert.match(explanation.textContent, /absolute filesystem path/);
  const source = runtime.liveSources[0], unchanged = expectRead(runtime, props);
  await source.connected(); await unchanged.deliver(read(markdown, denied, 'markdown'));
  assert.equal(reader(view).querySelector('.blocked-file-link-trigger') === blocked, true, 'unchanged trigger retained');
  assert.equal(reader(view).querySelector('.blocked-file-link-explanation') === explanation, true, 'unchanged explanation retained');
  assert.equal(view.window.document.activeElement === blocked, true, 'trigger retains focus');
  assert.equal(blocked.getAttribute('aria-expanded'), 'true');
  const next = { ...props, onOpenFile: (...args) => opened.push(args) };
  await h.render(next);
  const link = label => [...reader(view).querySelectorAll('.markdown-file-preview a')].find(node => node.textContent === label);
  await click(view, link('chapter'));
  await click(view, link('chapter'), { ctrlKey: true });
  await click(view, link('chapter'), { metaKey: true });
  await click(view, link('pdf'));
  assert.deepEqual(oldOpened, []);
  assert.deepEqual(opened, [
    ['/root/docs/chapter.md', undefined, { line: 4, endLine: 7 }],
    ['/root/docs/chapter.md', undefined, { line: 4, endLine: 7 }],
    ['/root/docs/chapter.md', undefined, { line: 4, endLine: 7 }],
    ['/root/manual.pdf', 3, undefined],
  ]);
  // Current cwd also narrows the document's relative-link boundary. The old
  // PDF link is now blocked even though the document path did not change.
  const relocated = { ...next, cwd: '/root/docs' }, relocatedRead = expectRead(runtime, relocated);
  await h.render(relocated); await relocatedRead.deliver(read(markdown, denied, 'markdown'));
  assert.equal(link('pdf') === undefined, true);
  assert.ok([...reader(view).querySelectorAll('.blocked-file-link-trigger')].some(node => node.textContent === 'pdf'));
  await click(view, link('chapter'));
  assert.deepEqual(opened.at(-1), ['/root/docs/chapter.md', undefined, { line: 4, endLine: 7 }]);
  const currentSource = runtime.liveSources[0]; assert.equal(currentSource !== source, true);
  assert.equal(source.closeCalls, 1);
  await click(view, button(reader(view), 'Source'));
  const refresh = expectRead(runtime, relocated);
  await currentSource.change(); await refresh.deliver(read(markdown, denied, 'markdown'));
  assert.equal(button(reader(view), 'Source').getAttribute('aria-pressed'), 'true', 'manual mode is not overwritten by watcher data');
  assert.equal(reader(view).querySelector('.markdown-file-preview') === null, true);
  await click(view, button(reader(view), 'Preview'));
  const beforeChange = reader(view).querySelector('.blocked-file-link-trigger');
  await click(view, beforeChange);
  assert.equal(beforeChange.getAttribute('aria-expanded'), 'true');
  const changed = expectRead(runtime, relocated);
  await currentSource.change(); await changed.deliver(read(markdown.replace('../../escape.md', '../../../different.md'), denied, 'markdown'));
  const newBlocked = reader(view).querySelector('.blocked-file-link-trigger');
  assert.equal(newBlocked !== beforeChange, true, 'changed href replaces trigger');
  assert.equal(newBlocked.getAttribute('aria-expanded'), 'false', 'changed href resets rejection feedback');
  assert.equal(reader(view).querySelector('.blocked-file-link-explanation') === null, true);
  runtime.assertHealthy();
});

for (const rowCount of [1000, 1001]) {
  test(`${rowCount} real Source rows preserve escaping/cutoff/wrap and report to current callback through cleanup`, async t => {
    const first = [], currentReports = [];
    const h = await open(t, { onStateChange: (...args) => first.push(args) });
    const { view, runtime, props, initial: [replay, initial] } = h;
    const content = ['<img src=x onerror=bad()>', ...Array.from({ length: rowCount - 1 }, (_, i) => `row ${i + 2}`)].join('\n');
    await initial.deliver(read(content)); await replay.deliver(read('obsolete'));
    const root = reader(view), rows = root.querySelectorAll('.file-source-line');
    assert.equal(rows.length, rowCount);
    assert.equal(rows[0].dataset.lineNumber, '1'); assert.equal(rows[rowCount - 1].dataset.lineNumber, String(rowCount));
    assert.equal(rows[0].querySelector('.file-source-line-content').textContent.replace(/\n$/, ''), '<img src=x onerror=bad()>');
    assert.equal(root.querySelector('.file-source-view img') === null, true);
    assert.equal(Boolean(root.querySelector('.is-lightweight')), rowCount > 1000);
    const reportsAtRerender = first.length;
    await h.render({ ...props, onStateChange: (...args) => currentReports.push(args) });
    await click(view, root.querySelector('[aria-label="Enable word wrap"]'));
    assert.equal(currentReports.at(-1)[0].wrapLines, true);
    assert.equal(root.querySelector('.file-source-line-content').style.whiteSpace, 'pre-wrap');
    const pane = root.querySelector('.file-viewer-content');
    pane.scrollTop = 37; pane.scrollLeft = 11;
    await view.dispatch(pane, new view.window.Event('scroll', { bubbles: true }));
    assert.deepEqual(currentReports.at(-1)[0], { displayMode: 'source', wrapLines: true, scrollTop: 37, scrollLeft: 11 });
    await view.unmount();
    assert.deepEqual(currentReports.at(-1), [{ displayMode: 'source', wrapLines: true, scrollTop: 37, scrollLeft: 11 }, false]);
    assert.equal(first.length, reportsAtRerender, 'old callback is not used for event/cleanup reports');
    runtime.assertHealthy();
  });
}

test('explicit Source/restored mode beats automatic Markdown Preview; unavailable Diff falls back without a fake child', async t => {
  const h = await open(t, { filePath: '/root/docs/guide.md', initialDisplayMode: 'preview',
    initialState: { displayMode: 'source', wrapLines: false, scrollTop: 0, scrollLeft: 0 } });
  const { view, runtime, props, initial: [replay, initial] } = h;
  await initial.deliver(read('# heading', denied, 'markdown')); await replay.deliver(read('obsolete'));
  assert.equal(button(reader(view), 'Source').getAttribute('aria-pressed'), 'true');
  assert.equal(reader(view).querySelector('.markdown-file-preview') === null, true);
  // A new navigation command requests Diff. Hint explicitly denies it, so the
  // real fallback effect chooses Source; no dummy Diff/body renderer is mounted.
  await h.render({ ...props, navigationId: 1, initialDisplayMode: 'diff',
    initialState: { displayMode: 'diff', wrapLines: false, scrollTop: 0, scrollLeft: 0 } });
  assert.equal(button(reader(view), 'Source').getAttribute('aria-pressed'), 'true');
  runtime.assertHealthy();
});

for (const [filePath, language, content, selector] of [
  ['/root/large.html', 'html', '<h1>real html</h1>\n'.repeat(1000), 'iframe'],
  ['/root/large.csv', 'text', 'name,value\n' + 'actual,cell\n'.repeat(1000), '[role="table"]'],
]) {
  test(`${filePath} uses real Preview rather than the >1000-row Source fallback`, async t => {
    const h = await open(t, { filePath });
    const { view, runtime, initial: [replay, initial] } = h;
    await initial.deliver(read(content, denied, language)); await replay.deliver(read('obsolete'));
    assert.equal(button(reader(view), 'Preview').getAttribute('aria-pressed'), 'true');
    const preview = reader(view).querySelector(selector); assert.equal(Boolean(preview), true);
    assert.equal(reader(view).querySelector('.is-lightweight') === null, true);
    if (language === 'html') assert.equal(preview.getAttribute('srcdoc'), content);
    else assert.match(preview.textContent, /actual/);
    await click(view, button(reader(view), 'Source'));
    assert.equal(Boolean(reader(view).querySelector('.is-lightweight')), true);
    assert.equal(reader(view).querySelectorAll('.file-source-line').length, content.split('\n').length);
    runtime.assertHealthy();
  });
}

