import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { encodeFilePathForApi } from '../lib/file-paths.ts';
import { exact, click, button } from './navigation-runtime.fixture.mjs';
import { explorerHarness, explorerRoutes, entry } from './explorer-cases.fixture.mjs';

function uploadPorts(assertSend) {
  const sends = [];
  return { sends, setup(window, replace) {
    replace(globalThis, 'File', window.File); replace(globalThis, 'FormData', window.FormData);
    class UploadXHR {
      constructor() { this.upload = {}; this.aborted = false; }
      open(method, url) { assert.equal(method, 'POST'); this.url = new URL(url, 'https://fixture.invalid'); }
      send(form) {
        this.form = form; sends.push(this); // Own admission even if the external-port assertion throws.
        if (assertSend) assertSend(this, form, window);
        else {
          assert.deepEqual([...this.url.searchParams], [['type', 'upload'], ['conflict', 'error']]);
          assert.ok(form instanceof window.FormData);
          assert.deepEqual([...form.keys()], ['files']);
          assert.equal(form.get('files').name, 'note.txt');
        }
      }
      abort() { this.aborted = true; /* Deliberately ignore cancellation; late load still arrives. */ }
    }
    replace(globalThis, 'XMLHttpRequest', UploadXHR); replace(window, 'XMLHttpRequest', UploadXHR);
  }, async deliver(xhr, uploaded = ['note.txt'], extra = {}) {
    await act(async () => { xhr.finished = true; xhr.status = 200; xhr.responseText = JSON.stringify({ uploaded, ...extra }); xhr.onload(); });
  } };
}
async function choose(h, input = h.view.container.querySelector('input[type="file"]'), files = [new File(['body'], 'note.txt')]) {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await h.view.dispatch(input, new h.view.window.Event('change', { bubbles: true }));
}
function drop(view, target, dataTransfer) {
  if (!dataTransfer) {
    const file = new File(['body'], 'note.txt');
    dataTransfer = { types: ['Files'], files: [file], items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isFile: true, isDirectory: false }) }] };
  }
  const event = new view.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer }); return view.dispatch(target, event);
}

for (const phase of ['check', 'upload', 'conflict', 'picker']) test(`real Explorer controls discard old ${phase} owner when either checkout or chat context changes`, async t => {
  const xhr = uploadPorts(), checks = [];
  const data = new Map([['/old', [entry('nested', true)]], ['/old/nested', []], ['/new', [entry('deep', true)]], ['/new/deep', []]]);
  const route = explorerRoutes(data, request => {
    if (request.url.searchParams.get('type') === 'upload-check') {
      const directory = request.url.pathname.includes('/new') ? '/new/deep' : '/old/nested';
      exact(request, `/api/files/${encodeFilePathForApi(directory)}`, { type: 'upload-check' }, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { fileNames: ['note.txt'] }, signal: true });
      checks.push(request); return { handled: true, data: undefined };
    }
  });
  const h = await explorerHarness(t, { cwd: '/old', chat: 'a', listings: data, route, setup: xhr.setup });
  h.releaseOnClose(() => { for (const send of xhr.sends) if (!send.finished) { send.finished = true; send.status = 503; send.responseText = '{}'; send.onload?.(); } });
  await h.settled(); await click(h.view, button(h.view, 'Upload here… (/old/nested)'));
  const oldInput = h.view.container.querySelector('input[type="file"]');
  if (phase !== 'picker') {
    await choose(h, oldInput);
    if (phase !== 'check') await h.reply(checks[0], phase === 'conflict' ? { conflicts: ['note.txt'] } : {});
    assert.equal(button(h.view, 'Upload here… (/old/nested)').disabled, true);
    await drop(h.view, h.view.container.querySelector('[data-testid="file-explorer"]'));
    assert.equal(checks.length, 1, 'competing drop cannot replace active batch');
  }
  await h.update({ cwd: '/new', contextSessionId: 'b' });
  if (checks[0]) assert.equal(checks[0].options.signal.aborted, true);
  if (phase === 'upload') assert.equal(xhr.sends[0].aborted, true);
  // A detached old native input cannot route into the current component refs.
  await choose(h, oldInput);
  if (phase === 'check') await h.reply(checks[0], {});
  if (phase === 'upload') { xhr.sends[0].finished = true; await xhr.deliver(xhr.sends[0]); }
  assert.equal(checks.length, phase === 'picker' ? 0 : 1);
  assert.equal(xhr.sends.length, phase === 'upload' ? 1 : 0);
  assert.equal(h.view.container.querySelector('[data-testid="upload-destination"]') === null, true);
  await click(h.view, button(h.view, 'Upload here… (/new/deep)')); await choose(h);
  await h.reply(checks.at(-1), {});
  const current = xhr.sends.at(-1); assert.equal(current.url.pathname, '/api/files/new/deep');
  current.finished = true; await xhr.deliver(current); await h.settled();
  assert.match(h.view.container.querySelector('[data-testid="upload-destination"]').textContent, /\/new\/deep/);
  // Same cwd, another chat must also destroy the old immutable owner.
  await h.update({ contextSessionId: 'c' }); await h.settled();
  assert.equal(h.view.container.querySelector('[data-testid="upload-destination"]') === null, true);
});

test('closed folder refresh invalidates pending children and re-lists on opening, while search projection never lists unmatched children', async t => {
  let childVersion = 0, hold = false;
  const data = new Map([['/repo', [entry('folder', true)]], ['/repo/folder', [entry('old')]]]);
  const h = await explorerHarness(t, { listings: data, route: explorerRoutes(data, request => {
    if (request.url.pathname === '/api/files/repo/folder') {
      childVersion++;
      if (hold) return { handled: true, data: undefined };
    }
    if (request.url.pathname === '/api/file-index') {
      exact(request, '/api/file-index', { cwd: '/repo', q: 'match', refresh: '1' }, { signal: true }); return { handled: true, data: { matches: [{ path: 'folder/match', isDir: false }] } };
    }
  }) });
  await h.settled(); hold = true;
  await click(h.view, button(h.view, 'Expand folder (/repo/folder)')); const old = h.latest('/api/files/repo/folder'); await h.headers(old);
  await click(h.view, button(h.view, 'Collapse folder (/repo/folder)'));
  const reads = childVersion; await h.update({ refreshKey: 1 }); assert.equal(childVersion, reads, 'closed folder refresh performs no read');
  await h.body(old, { entries: [entry('obsolete')] });
  hold = false; data.set('/repo/folder', [entry('fresh')]);
  await click(h.view, button(h.view, 'Expand folder (/repo/folder)')); await h.settled();
  assert.equal(h.element('/repo/folder/obsolete') === null, true); assert.ok(h.element('/repo/folder/fresh'));
  await h.update({ fileSearchOpen: true });
  const { inputText } = await import('./navigation-runtime.fixture.mjs');
  await inputText(h.view, h.view.container.querySelector('input[aria-label="Search files"]'), 'match'); await h.fire(150); await h.settled();
  const projectionReads = childVersion;
  await click(h.view, button(h.view, 'Collapse folder (/repo/folder)')); await click(h.view, button(h.view, 'Expand folder (/repo/folder)'));
  // Join any actual newly admitted load before the unchanged projection witness;
  // a producer defect must not leave that work solely to failed-test teardown.
  await h.settled();
  assert.equal(childVersion, projectionReads); assert.ok(h.element('/repo/folder/match'));
});

// F-UPLOAD: existing real Explorer -> ExplorerUpload -> browserUploadTransport.
// FileList/DataTransfer are the EXISTING unsupported-input ports, not a native
// browser claim. Actual Window Files/FormData and the real input/drop handlers run.
test('literal Explorer upload rows, conflict choices, mixed entries and filtered refresh reach the default FormData transport', async t => {
  const { inputText } = await import('./navigation-runtime.fixture.mjs');
  const data = new Map([['/repo', [entry('uploads-1280', true), entry('uploads-390', true)]]]);
  for (const width of [1280, 390]) {
    data.set(`/repo/uploads-${width}`, [entry('nested', true)]);
    data.set(`/repo/uploads-${width}/nested`, [entry('existing.txt')]);
  }
  let h, checkPlan = null, sendPlan = null, changed = null, refresh = 0, searchPaths = [];
  const checks = [], indexReads = [], childReads = new Map(), readers = new Set();
  const xhr = uploadPorts((send, form, window) => h.check(() => {
    const expected = sendPlan;
    assert.equal(Boolean(expected), true, 'only the explicitly admitted batch may send');
    sendPlan = null;
    assert.equal(send.url.pathname, `/api/files/${encodeFilePathForApi(expected.directory)}`, 'literal destination, never cwd/file-row flattening');
    assert.deepEqual([...send.url.searchParams], [['type', 'upload'], ['conflict', expected.strategy]]);
    assert.equal(form instanceof window.FormData, true, 'PRODUCTION constructs actual FormData');
    const files = form.getAll('files');
    assert.deepEqual([...form.keys()], expected.pairs.map(() => 'files'));
    assert.deepEqual(files.map(file => file.name), expected.pairs.map(([name]) => name));
    assert.deepEqual(files.map(file => file.size), expected.pairs.map(([, content]) => Buffer.byteLength(content)));
    const bodies = files.map(file => {
      const reader = new window.FileReader(); readers.add(reader);
      const native = new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.onabort = () => reject(new window.DOMException('Owned upload body reader aborted', 'AbortError'));
        reader.readAsText(file);
      });
      const full = native.finally(() => {
        readers.delete(reader); reader.onload = reader.onerror = reader.onabort = null;
      });
      // Immediately own EACH original read/finally, including partial map failure.
      return h.work.observe(full);
    });
    send.bodyWork = h.work.observe(Promise.all(bodies).then(bodies => h.check(() => {
      assert.deepEqual(bodies, expected.pairs.map(([, content]) => content), 'actual FormData contains exact original literal bytes');
    })));
  }));
  const route = explorerRoutes(data, request => {
    if (request.url.searchParams.get('type') === 'upload-check') {
      checks.push(request);
      assert.equal(Boolean(checkPlan), true, 'no competing/unplanned preflight');
      const expected = checkPlan; checkPlan = null;
      exact(request, `/api/files/${encodeFilePathForApi(expected.directory)}`, { type: 'upload-check' }, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: true,
        body: { fileNames: expected.pairs.map(([name]) => name) },
      });
      return { handled: true, data: undefined }; // Real body is delivered explicitly below.
    }
    if (request.url.pathname === '/api/file-index') {
      indexReads.push(request);
      exact(request, '/api/file-index', { cwd: '/repo', q: 'existing', refresh: '1' }, { signal: true });
      return { handled: true, data: { matches: searchPaths.map(path => ({ path, isDir: false })) } };
    }
    if (request.url.pathname === '/api/git/status') {
      exact(request, '/api/git/status', { cwd: '/repo' });
      return { handled: true, data: changed ? { isGitRepository: true, repositoryRoot: '/repo',
        files: [{ filePath: changed, status: 'modified', code: 'M', indexStatus: ' ', worktreeStatus: 'M' }], additions: 1, deletions: 0 }
        : { isGitRepository: false, files: [] } };
    }
    if (request.url.searchParams.get('type') === 'list') childReads.set(request.url.pathname, (childReads.get(request.url.pathname) ?? 0) + 1);
  });
  h = await explorerHarness(t, { listings: data, route, setup: xhr.setup });
  // Installed BEFORE any upload/reader admission. Release ALL peers before the
  // existing owner independently joins original body/catch/finally/descendants.
  h.releaseOnClose(() => {
    const failures = [];
    for (const reader of readers) { try { reader.abort(); } catch (error) { failures.push(error); } }
    for (const send of xhr.sends) if (!send.finished) {
      try { send.finished = true; send.status = 503; send.responseText = '{}'; send.onload?.(); }
      catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Upload port peer release failed');
  });
  await h.settled();
  const input = () => h.view.container.querySelector('input[type="file"]');
  const explorer = () => h.view.container.querySelector('[data-testid="file-explorer"]');
  const filesOf = pairs => pairs.map(([name, content]) => new File([content], name, { type: 'text/plain' }));
  const transfer = files => ({ types: ['Files'], files, items: files.map(file => ({
    kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }),
  })) });
  const dropFiles = (target, files) => drop(h.view, target, transfer(files));
  const pickFiles = async (directory, files) => {
    await click(h.view, button(h.view, `Upload here… (${directory})`));
    await choose(h, input(), files);
    assert.equal(input().value, '', 'actual input change clears its value for the next native selection');
  };
  const begin = async (directory, pairs, dispatch) => {
    const before = checks.length;
    checkPlan = { directory, pairs };
    await dispatch(filesOf(pairs));
    assert.equal(checks.length, before + 1);
    const check = checks.at(-1);
    assert.equal(check.url.pathname, `/api/files/${encodeFilePathForApi(directory)}`);
    assert.equal(checkPlan, null); return check;
  };
  const finish = async (directory, pairs, dispatch, { strategy = 'error', uploaded = pairs.map(([name]) => name), skipped = [], install = () => {} } = {}) => {
    const before = xhr.sends.length;
    const check = await begin(directory, pairs, dispatch);
    if (strategy !== 'error') {
      await h.reply(check, { conflicts: ['existing.txt'], nonReplaceable: [] });
      assert.equal(xhr.sends.length, before, 'conflict requires an explicit actual control');
      sendPlan = { directory, pairs, strategy };
      await click(h.view, button(h.view, strategy === 'skip' ? 'Skip existing' : 'Replace'));
    } else {
      sendPlan = { directory, pairs, strategy };
      await h.reply(check, { conflicts: [], nonReplaceable: [] });
    }
    assert.equal(xhr.sends.length, before + 1);
    const send = xhr.sends.at(-1);
    assert.equal(send.url.searchParams.get('conflict'), strategy);
    await send.bodyWork; // Actual FormData bytes/finally, not an XHR send ACK.
    install(); // Declared external listing/index response, never a copied writer.
    await xhr.deliver(send, uploaded, { skipped, errors: [] });
    await h.settled();
    assert.equal(sendPlan, null);
    assert.equal(h.view.container.querySelector(`[title="${uploaded.length} uploaded"]`) !== null, true);
    assert.equal(h.mentioned.length, mentionsBefore, 'upload never inserts a mention automatically');
  };
  let mentionsBefore = 0;
  for (const width of [1280, 390]) {
    const folder = `/repo/uploads-${width}`, nested = `${folder}/nested`, existing = `${nested}/existing.txt`;
    await click(h.view, button(h.view, `Expand folder (${folder})`));
    await click(h.view, button(h.view, `Expand folder (${nested})`)); await h.settled();
    assert.equal(Boolean(h.element(existing)), true);
    await click(h.view, button(h.view, `Collapse folder (${nested})`));
    const childKey = `/api/files/${encodeFilePathForApi(nested)}`, beforeClosed = childReads.get(childKey);
    mentionsBefore = h.mentioned.length;
    await finish(nested, [['collapsed.txt', 'collapsed destination\n']], files => dropFiles(h.element(nested), files), {
      install() { data.set(nested, [entry('existing.txt'), entry('collapsed.txt')]); },
    });
    assert.equal(childReads.get(childKey), beforeClosed, 'closed cached folder is not read/expanded by upload');
    await click(h.view, button(h.view, `Expand folder (${nested})`)); await h.settled();
    assert.equal(Boolean(h.element(`${nested}/collapsed.txt`)), true, 'opening revalidates the real closed folder');
    await finish(nested, [['file-row.txt', 'containing folder\n']], files => dropFiles(h.element(existing), files), {
      install() { data.set(nested, [...data.get(nested), entry('file-row.txt')]); },
    });
    assert.equal(h.view.container.querySelector('[data-testid="upload-destination"]').textContent.endsWith(nested), true);
    await click(h.view, button(h.view, 'Add uploaded file to chat'));
    assert.deepEqual(h.mentioned.at(-1), [[`uploads-${width}/nested/file-row.txt`]], 'actual explicit mention uses captured nested destination');
    mentionsBefore = h.mentioned.length;
    const rootName = `root-${width}.txt`;
    await finish('/repo', [[rootName, 'root\n']], files => dropFiles(explorer(), files), {
      install() { data.set('/repo', [...data.get('/repo'), entry(rootName)]); },
    });

    const firstInput = input(), cancelSends = xhr.sends.length;
    const cancelled = await begin(nested, [['existing.txt', 'cancelled\n']], files => pickFiles(nested, files));
    await h.reply(cancelled, { conflicts: ['existing.txt'], nonReplaceable: [] });
    assert.equal(button(h.view, `Upload here… (${nested})`).disabled, true);
    const lockedChecks = checks.length;
    await dropFiles(explorer(), filesOf([['root-while-locked.txt', 'must not send']]));
    assert.equal(checks.length, lockedChecks, 'locked batch excludes competing drop');
    await click(h.view, button(h.view, 'Cancel')); await h.settled();
    assert.equal(xhr.sends.length, cancelSends, 'actual Cancel dispatches NO multipart upload');
    assert.equal(h.view.container.querySelector('[role="alert"]'), null);
    assert.equal(input() === firstInput, true);
    await finish(nested, [['existing.txt', 'skip\n'], ['new-with-skip.txt', 'new\n']], files => pickFiles(nested, files), {
      strategy: 'skip', uploaded: ['new-with-skip.txt'], skipped: ['existing.txt'],
      install() { data.set(nested, [...data.get(nested), entry('new-with-skip.txt')]); },
    });
    assert.equal(h.view.container.querySelector('[title="1 skipped"]') !== null, true);

    changed = existing;
    await h.update({ changesCollapsed: false, refreshKey: ++refresh }); await h.settled();
    const changedRow = h.view.container.querySelector('[data-upload-directory][title]');
    assert.equal(changedRow.getAttribute('title'), existing);
    assert.equal(changedRow.getAttribute('data-upload-directory'), nested);
    await finish(nested, [['changed-row.txt', 'changed row folder\n']], files => dropFiles(changedRow, files), {
      install() { data.set(nested, [...data.get(nested), entry('changed-row.txt')]); },
    });
    await h.update({ changesCollapsed: true });
    await finish(nested, [['mixed.txt', 'mixed file\n']], files => {
      const directory = new File([], 'folder-input');
      return drop(h.view, h.element(nested), { types: ['Files'], files: [directory, ...files], items: [
        { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true, name: 'folder-input' }), getAsFile: () => h.check(() => assert.fail('directory input must not be flattened')) },
        { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }), getAsFile: () => files[0] },
      ] });
    }, { install() { data.set(nested, [...data.get(nested), entry('mixed.txt')]); } });
    assert.match(h.view.container.textContent, /Folder uploads are not supported/);
    assert.equal(h.element(`${nested}/folder-input`) === null, true);
    const relative = new File(['nested'], 'nested.txt');
    Object.defineProperty(relative, 'webkitRelativePath', { value: 'tree/sub/nested.txt' });
    const beforeRelative = checks.length, sendsBeforeRelative = xhr.sends.length;
    await drop(h.view, h.element(nested), { types: ['Files'], files: [relative], items: [] });
    assert.equal(checks.length, beforeRelative, 'literal relative directory input causes NO preflight');
    assert.equal(xhr.sends.length, sendsBeforeRelative, 'literal relative directory input causes NO FormData');
    assert.match(h.view.container.textContent, /tree/);
    const nonfile = new h.view.window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(nonfile, 'dataTransfer', { value: { types: ['text/plain'], files: [], items: [{ kind: 'string' }] } });
    await h.view.dispatch(explorer(), nonfile);
    assert.equal(nonfile.defaultPrevented, false); assert.equal(checks.length, beforeRelative);

    searchPaths = [`uploads-${width}/nested/existing.txt`];
    await h.update({ fileSearchOpen: true });
    await inputText(h.view, h.view.container.querySelector('input[aria-label="Search files"]'), 'existing');
    await h.fire(150); await h.settled();
    // An already uploaded nonmatch exposes a corrupt projection before another
    // upload/preflight lifetime; retain the later post-upload witness as well.
    assert.equal(h.element(`${nested}/collapsed.txt`) === null, true, 'search projection excludes the original already uploaded nonmatch');
    assert.equal(Boolean(h.element(existing)), true);
    await finish(nested, [['not-a-search-match.txt', 'search destination\n']], files => pickFiles(nested, files), {
      install() { data.set(nested, [...data.get(nested), entry('not-a-search-match.txt')]); },
    });
    await h.fire(150); await h.settled();
    assert.equal(h.element(`${nested}/not-a-search-match.txt`) === null, true, 'search upload must not flatten the unfiltered directory into results');
    assert.equal(Boolean(h.element(existing)), true);
    await finish(nested, [['existing-copy.txt', 'matching search upload\n']], files => pickFiles(nested, files), {
      install() { data.set(nested, [...data.get(nested), entry('existing-copy.txt')]); searchPaths = [...searchPaths, `uploads-${width}/nested/existing-copy.txt`]; },
    });
    await h.fire(150); await h.settled();
    assert.equal(Boolean(h.element(`${nested}/existing-copy.txt`)), true);
    data.set(nested, [...data.get(nested), entry('existing-external.txt')]);
    searchPaths = [...searchPaths, `uploads-${width}/nested/existing-external.txt`];
    const beforeRefresh = indexReads.length;
    await h.update({ refreshKey: ++refresh }); await h.fire(150); await h.settled();
    assert.equal(indexReads.length, beforeRefresh + 1, 'actual refresh reruns bounded index, not an unfiltered projection');
    assert.equal(Boolean(h.element(`${nested}/existing-external.txt`)), true);
    assert.equal(h.element(`${nested}/not-a-search-match.txt`) === null, true);
    await h.update({ fileSearchOpen: false, changesCollapsed: true }); await h.settled();
  }
  assert.equal(checkPlan, null); assert.equal(sendPlan, null);
  assert.equal(readers.size, 0); assert.equal(xhr.sends.every(send => send.finished), true);
  h.assertHealthy();
});

// PRIVATE P2-1 support controls in the existing Explorer owner entry.
test('Navigation terminal cleanup releases peers, restores actual transport descriptors before close and retains original failures', async t => {
  const { navigationRuntime } = await import('./navigation-runtime.fixture.mjs');
  const { createElement } = await import('react');
  const contains = (root, wanted) => {
    const seen = new Set();
    const visit = (value, present) => {
      if (present && value === wanted) return true;
      if (!value || typeof value !== 'object' || seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value.errors) && value.errors.some(item => visit(item, true))) return true;
      return Object.hasOwn(value, 'cause') && visit(value.cause, true);
    };
    return visit(root, true);
  };
  for (const mode of ['primary', 'partial-setup', 'unmount-before-act']) {
    const beforeFetch = globalThis.fetch, beforeConsole = console.error;
    const primary = new Error(`Navigation primary ${mode}`), releaseError = new Error(`Navigation release ${mode}`);
    const restoreError = new Error(`Navigation restore ${mode}`), unmountError = new Error(`Navigation unmount ${mode}`);
    const closeError = new Error(`Navigation close event ${mode}`);
    let realmPorts = [];
    const bodyError = { originalNavigationBody: mode };
    const events = [], released = new Set(), finals = [], closes = [], sourceRefs = [], registered = [];
    const owner = { after(fn) { registered.push(fn); } };
    let r, windowRef, closeDescriptor, originalClose, guardFetch, guardConsole, complete = false;
    let primaryValue, primaryPresent = false;
    const firstWait = releaseSource => {
      events.push('first-owned-wait');
      assert.equal(releaseSource === r.releaseKnown, true, 'actual central/outer release source reference');
      assert.equal(released.has(0) && released.has(1), true, 'both HTTP peers released BEFORE FIRST owned wait');
    };
    r = await navigationRuntime(owner, request => {
      assert.equal(['/api/private-a', '/api/private-b'].includes(request.url.pathname), true);
      return undefined; // Existing real controlled transport holds its actual headers/body.
    }, (window, replaceRealm) => {
      windowRef = window;
      const marker = '__privateNavigationRealm';
      Object.defineProperty(window, marker, { configurable: true, value: 'before' });
      const proxy = new Proxy(window, { defineProperty(target, key, descriptor) {
        const result = Reflect.defineProperty(target, key, descriptor);
        if (key === marker && descriptor.value === 'before') {
          events.push('realm-restore'); throw restoreError; // REAL descriptor restored, fault retained.
        }
        return result;
      } });
      replaceRealm(proxy, marker, 'during');
      closeDescriptor = Object.getOwnPropertyDescriptor(window, 'close'); originalClose = window.close;
      Object.defineProperty(window, 'close', { configurable: true, value: function (...args) {
        closes.push({ released: released.size === 2, finallyDone: finals.length === 2,
          realmRestored: window[marker] === 'before', hostLive: globalThis.fetch === guardFetch,
          leafRestored: realmPorts.length === 8 && realmPorts.every(({ target, key, descriptor, value }) => {
            const current = Object.getOwnPropertyDescriptor(target, key);
            return target[key] === value && (descriptor === undefined ? current === undefined
              : current !== undefined && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable']
                .every(field => Object.hasOwn(current, field) === Object.hasOwn(descriptor, field) && current[field] === descriptor[field]));
          }),
          collectorLive: console.error === guardConsole, originalClose: originalClose === (closeDescriptor?.value ?? originalClose) });
        events.push('close-entry');
        const event = new window.Event('unhandledrejection');
        Object.defineProperty(event, 'reason', { value: closeError });
        window.dispatchEvent(event); // Exercise live collectors, not an unhandled Node rejection.
        try { return Reflect.apply(originalClose, this, args); }
        finally { events.push('close-finally'); }
      } });
      if (mode === 'partial-setup') throw primary;
    }, { beforeUnmount: firstWait, beforeSetup(window) {
      realmPorts = [...['XMLHttpRequest', 'EventSource', 'WebSocket', 'Worker', 'SharedWorker', 'fetch', 'open']
        .map(key => [window, key]), [window.navigator, 'sendBeacon']]
        .map(([target, key]) => ({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key), value: target[key] }));
    } });
    guardFetch = globalThis.fetch; guardConsole = console.error;
    assert.equal(registered[0] === r.dispose, true, 'actual outer t.after disposal source, not a detached replacement');
    const originals = ['/api/private-a', '/api/private-b'].map((url, index) => {
      const full = globalThis.fetch(url).then(response => response.json())
        .finally(() => { finals.push(index); events.push(`finally-${index}`); });
      assert.equal(r.work.observe(full) === full, true, 'SAME original full continuation/finally promise');
      return full;
    });
    const peers = [...r.requests]; assert.equal(peers.length, 2);
    const originalSources = peers.map(request => request.reply);
    r.releaseOnClose(() => { events.push('release-error'); throw releaseError; });
    const releases = peers.map((request, index) => {
      const originalReply = request.reply;
      const release = () => {
        sourceRefs.push({ actual: release, expected: releases[index], original: originalReply });
        released.add(index); events.push(`release-${index}`);
        request.body.reject(index ? undefined : bodyError);
        originalReply({ error: 'owned private release' }, 503);
      };
      r.releaseOnClose(release); return release;
    });
    t.after(async () => { if (!complete) await r.dispose(); });
    try {
      // Explicit arrangement enters BOTH real JSON consumers before teardown.
      await r.headers(peers[0]); await r.headers(peers[1]);
      assert.equal(peers.every(request => request.jsonCalls === 1), true);
      await r.render(createElement('div', null, 'private Navigation scope'));
      if (mode === 'unmount-before-act') r.view.unmount = () => {
        firstWait(r.releaseKnown); throw unmountError; // No React/global Promise replacement.
      };
      throw primary;
    } catch (error) { primaryValue = error; primaryPresent = true; }
    const cleanup = await Promise.allSettled([r.dispose()]);
    if (windowRef) {
      if (closeDescriptor) Object.defineProperty(windowRef, 'close', closeDescriptor);
      else delete windowRef.close;
    }
    const outcome = new AggregateError([...(primaryPresent ? [primaryValue] : []), ...cleanup.filter(result => result.status === 'rejected').map(result => result.reason)], 'Private captured Navigation exit');
    assert.equal(outcome.errors[0] === primaryValue, true);
    for (const expected of [primary, releaseError, restoreError, bodyError, undefined, closeError]) assert.equal(contains(outcome, expected), true, 'original primary/cleanup/UNKNOWN/close-event value retained as present');
    if (mode === 'unmount-before-act') assert.equal(contains(outcome, unmountError), true);
    const leaves = [], seen = new Set();
    const collect = value => {
      if (value && typeof value === 'object') {
        if (seen.has(value)) return; seen.add(value);
        if (Array.isArray(value.errors)) { value.errors.forEach(collect); if (Object.hasOwn(value, 'cause')) collect(value.cause); return; }
        if (Object.hasOwn(value, 'cause')) { collect(value.cause); return; }
      }
      leaves.push(value);
    };
    collect(outcome);
    assert.equal(leaves.every(value => [primary, releaseError, restoreError, bodyError, undefined, unmountError, closeError].includes(value)), true, 'unexpected original/cleanup values are NOT filtered away');
    const peerResults = await Promise.allSettled(originals);
    assert.equal(peerResults[0].status, 'rejected'); assert.equal(peerResults[0].reason === bodyError, true);
    assert.equal(peerResults[1].status, 'rejected'); assert.equal(Object.hasOwn(peerResults[1], 'reason'), true); assert.equal(peerResults[1].reason, undefined);
    assert.equal(sourceRefs.length, 2);
    assert.equal(sourceRefs.every(ref => ref.actual === ref.expected && ref.original === originalSources[releases.indexOf(ref.expected)]), true);
    assert.equal(events.indexOf('release-0') < events.indexOf('first-owned-wait'), true);
    assert.equal(events.indexOf('release-1') < events.indexOf('first-owned-wait'), true);
    assert.equal(events.indexOf('first-owned-wait') < events.indexOf('close-entry'), true, 'partial-mount handoff precedes close, not only later outer teardown');
    assert.equal(closes.length, 1);
    assert.equal(closes[0].leafRestored, true, 'all eight actual transport descriptors/functions restored before close');
    assert.equal(Object.values(closes[0]).every(value => value === true), true, 'original finally/REALM restoration/collectors before REAL close');
    assert.equal(events.includes('close-finally'), true);
    assert.equal(globalThis.fetch === beforeFetch && console.error === beforeConsole, true, 'HOST restored after actual close');
    if (r.view) assert.equal(r.view.container.childNodes.length, 0);
    complete = true;
  }
});

test('Navigation retains a sole HOST-restoration observation and restores collectors for the next actual mount', async t => {
  const { navigationRuntime } = await import('./navigation-runtime.fixture.mjs');
  const { createElement } = await import('react');
  const beforeTimeout = globalThis.setTimeout, beforeConsole = console.error, registered = [];
  const failure = new Error('original HOST-restoration observation');
  let entered = false, complete = false;
  const r = await navigationRuntime({ after(fn) { registered.push(fn); } }, () => assert.fail('no HTTP'), () => {}, {
    afterHostRestore() {
      assert.equal(globalThis.setTimeout === beforeTimeout, true, 'actual HOST timer restored');
      assert.equal(console.error !== beforeConsole, true, 'collector still live after HOST restoration');
      entered = true;
      console.error(failure); // Forwarded unchanged; no suppression or rejecting promise.
    },
  });
  t.after(async () => { if (!complete) await r.dispose(); });
  assert.equal(registered[0] === r.dispose, true);
  await r.render(createElement('div', null, 'HOST observation'));
  const contains = value => value === failure || Boolean(value && typeof value === 'object' &&
    ((Array.isArray(value.errors) && value.errors.some(contains)) || (Object.hasOwn(value, 'cause') && contains(value.cause))));
  await assert.rejects(r.dispose(), error => contains(error));
  assert.equal(entered, true);
  assert.equal(globalThis.setTimeout === beforeTimeout && console.error === beforeConsole, true);
  complete = true;
  const next = await navigationRuntime(t, () => assert.fail('no next HTTP'));
  await next.render(createElement('div', null, 'next real mount'));
  await next.dispose();
  assert.equal(globalThis.setTimeout === beforeTimeout && console.error === beforeConsole, true);
});

test('Navigation rolls back a partially failed leaf transport installation before real close', async t => {
  const { navigationRuntime } = await import('./navigation-runtime.fixture.mjs');
  const { createElement } = await import('react');
  const beforeFetch = globalThis.fetch, beforeConsole = console.error;
  let ports = [], closeEntered = false, restoredAtClose = false, complete = false;
  const r = await navigationRuntime({ after() {} }, () => assert.fail('no HTTP'), () => {}, {
    beforeSetup(window) {
      // Actual descriptor refusal AFTER five constructors and fetch were replaced.
      // No fake installer/React failure, and no change to production policy.
      Object.defineProperty(window, 'open', { value: window.open, configurable: false, writable: false });
      ports = [...['XMLHttpRequest', 'EventSource', 'WebSocket', 'Worker', 'SharedWorker', 'fetch', 'open']
        .map(key => [window, key]), [window.navigator, 'sendBeacon']]
        .map(([target, key]) => ({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key), value: target[key] }));
      const close = window.close;
      window.close = function (...args) {
        closeEntered = true;
        restoredAtClose = ports.every(({ target, key, descriptor, value }) => {
          const current = Object.getOwnPropertyDescriptor(target, key);
          return target[key] === value && (descriptor === undefined ? current === undefined
            : current !== undefined && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable']
              .every(field => Object.hasOwn(current, field) === Object.hasOwn(descriptor, field) && current[field] === descriptor[field]));
        });
        return Reflect.apply(close, this, args);
      };
    },
  });
  t.after(async () => { if (!complete) await r.dispose(); });
  const leaves = (root, out = [], seen = new Set()) => {
    if (root && typeof root === 'object') {
      if (seen.has(root)) return out;
      seen.add(root);
      if (Array.isArray(root.errors)) { root.errors.forEach(value => leaves(value, out, seen)); return out; }
      if (Object.hasOwn(root, 'cause')) return leaves(root.cause, out, seen);
    }
    out.push(root); return out;
  };
  let original;
  await assert.rejects(r.render(createElement('div', null, 'partial installation')), error => {
    const causes = leaves(error);
    original = causes.find(value => value?.name === 'TypeError');
    return original !== undefined && causes.every(value => value === original);
  });
  assert.equal(closeEntered && restoredAtClose, true, 'all eight actual originals present at failed-mount close');
  await assert.rejects(r.dispose(), error => {
    const causes = leaves(error);
    return causes.length > 0 && causes.every(value => value === original);
  });
  assert.equal(globalThis.fetch === beforeFetch && console.error === beforeConsole, true);
  complete = true;
});
