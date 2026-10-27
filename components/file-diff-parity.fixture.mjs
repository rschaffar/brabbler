import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { packet, click, textButton } from './cards-git.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { read } from './file-viewer-harness.fixture.mjs';

// Frozen e2e/file-panel:162–166 and git-diff-context:3–8. These are input
// bytes, not an implementation of the production comparison/controller.
export const oldContents = Array.from({ length: 5000 }, (_, index) => `Context line ${index + 1}\n`).join('');
export const newContents = oldContents.replace('Context line 50\n', 'Explorer changed 50\n').replace('Context line 4500\n', 'Explorer changed 4500\n');
export const patches = {
  modified: 'diff --git a/editable.txt b/editable.txt\n--- a/editable.txt\n+++ b/editable.txt\n@@ -1 +1 @@\n-Old text\n+New text\n',
  added: 'diff --git a/editable.txt b/editable.txt\nnew file mode 100644\n--- /dev/null\n+++ b/editable.txt\n@@ -0,0 +1 @@\n+New text\n',
  deleted: 'diff --git a/editable.txt b/editable.txt\ndeleted file mode 100644\n--- a/editable.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-Old text\n',
  context: 'diff --git a/editable.txt b/editable.txt\n--- a/editable.txt\n+++ b/editable.txt\n' + [50, 4500].map(number =>
    `@@ -${number - 3},7 +${number - 3},7 @@\n` + [number - 3, number - 2, number - 1].map(line => ` Context line ${line}\n`).join('') +
    `-Context line ${number}\n+Explorer changed ${number}\n` + [number + 1, number + 2, number + 3].map(line => ` Context line ${line}\n`).join('')).join(''),
};
export const snapshot = {
  oldFile: { name: 'editable.txt', contents: oldContents, cacheKey: 'before' },
  newFile: { name: 'editable.txt', contents: newContents, cacheKey: 'after' },
};
// Deliberately obsolete 4000-line body: an ignored-abort completion must be
// rejected BEFORE validating it against the current 5000-line supplied patch.
export const obsoleteSnapshot = {
  oldFile: { name: 'editable.txt', contents: oldContents.split('\n').slice(0, 4000).join('\n') + '\n', cacheKey: 'obsolete-before' },
  newFile: { name: 'editable.txt', contents: newContents.split('\n').slice(0, 4000).join('\n') + '\n', cacheKey: 'obsolete-after' },
};
export const cwd = '/checkout/review #%.dir', path = `${cwd}/editable.txt`, revision = 'a'.repeat(64), session = 'source/session?#';
// Independent literal expectation: do not use the outgoing production encoder
// to compute the expected pathname (an encoder fault must not bless itself).
const fileEndpoint = '/api/files/checkout/review%20%23%25.dir/editable.txt';
const exactQuery = (url, query) => assert.deepEqual([...url.searchParams].sort(), Object.entries(query).sort(), 'exact API query multiset');

export async function fileDiffRealm(t) {
  // Create the independent collector BEFORE Cards, imports or fixture setup.
  // Its domain.join reports failures inside the actual owner's disposer, after
  // peer release. Do not put a throwing after-hook ahead of that disposer.
  const failures = [], requests = [], bodyWork = [], parentCalls = [];
  let scenario, closed = false;
  const closing = new Error('Owned working-context body released at teardown');
  const check = fn => { try { return fn(); } catch (error) { failures.push(error); throw error; } };
  const assertHealthy = () => { if (failures.length) throw new AggregateError(failures, 'independent FileViewer HTTP collector'); };
  const domain = {
    fetch(input, init = {}) {
      try { return check(() => {
        assert.equal(closed, false, 'no admission after domain close'); assert.ok(scenario, 'named parent lifetime');
        assert.equal(typeof input, 'string');
        const url = new URL(input, 'https://fixture.invalid');
        assert.equal(url.origin, 'https://fixture.invalid'); assert.equal(url.hash, '');
        assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.body, undefined);
        assert.deepEqual([...new Headers(init.headers)], []);
        const context = url.pathname === '/api/git/diff' && url.searchParams.has('op');
        assert.equal(init.cache, context ? 'no-store' : undefined);
        if (context) assert.ok(init.signal instanceof AbortSignal);
        else assert.equal(init.signal, undefined);
        let status = 200, payload;
        if (url.pathname === '/api/git/diff') {
          exactQuery(url, context ? { cwd, path, op: 'context', revision } : { cwd, path });
          payload = context ? undefined : { supported: true, status: scenario.status === 'context' ? 'modified' : scenario.status,
            patch: patches[scenario.status], ...(scenario.status === 'context' ? { revision } : {}) };
        } else {
          assert.equal(url.pathname, fileEndpoint, 'exact encoded file API pathname');
          const type = url.searchParams.get('type'); assert.ok(['read', 'edit'].includes(type));
          exactQuery(url, { type, sessionId: session, ...(type === 'read' ? { viewerCwd: cwd } : {}) });
          if (type === 'read') {
            status = scenario.status === 'deleted' ? 404 : 200;
            payload = status === 404 ? { error: 'deleted file', probeEligibility: { edit: false, gitDiff: true } }
              : read(scenario.status === 'context' ? newContents : 'New text\n', { edit: true, gitDiff: true });
          } else payload = { content: 'New text\n', revision: 'edit-revision', writable: true, editIdentity: 'e'.repeat(64) };
        }
        const gate = deferred();
        const record = { url, init, scenario, status, context, payload, gate, consumed: 0, returned: false, finallyCount: 0, released: !context };
        requests.push(record);
        // Context deliberately ignores a real production AbortSignal. Header and
        // body statuses are explicit; delivery never substitutes a successful UI.
        if (!context) gate.resolve(payload);
        return Promise.resolve({ ok: status === 200, status, json() {
          check(() => assert.equal(++record.consumed, 1, 'one JSON consumption'));
          const work = gate.promise.then(value => { record.value = value; record.returned = true; return value; }).finally(() => { record.finallyCount++; });
          void work.catch(() => {}); bodyWork.push(work); return work;
        } });
      }); } catch (error) { return Promise.reject(error); }
    },
    release() {
      closed = true;
      for (const request of requests) if (!request.released) { request.released = true; request.gate.reject(closing); }
    },
    async join() {
      let end = 0;
      while (end < bodyWork.length) { const batch = bodyWork.slice(end); end = bodyWork.length; await Promise.allSettled(batch); }
      assertHealthy();
    },
  };
  const h = await packet(t, { readDomain: domain, traceFrames: true });
  h.expectFailure(closing);
  // Cards.load owns the original module import promises. FileViewer and
  // CommittedPatchDiff import CodeView statically: no lazy Git parent here.
  const api = await h.load('@pierre/diffs');
  const graph = await h.load('./file-viewer-composition.fixture.tsx');
  const warm = api.preloadHighlighter({ themes: ['pierre-light', 'pierre-dark'], langs: ['text'] });
  h.onReadWork(warm); await act(async () => { await warm; });
  const unexpectedAsync = [], setups = [];
  const frameOwners = new WeakMap(); let nextOwner = 0;
  const frameOwner = instance => {
    let owner = frameOwners.get(instance);
    if (owner === undefined) { owner = ++nextOwner; frameOwners.set(instance, owner); }
    return owner;
  };
  // Observe the REAL synchronous emitter, including its documented unmount
  // notification. Do not replace options.onPostRender or the binding callback.
  for (const [Type, kind] of [[api.FileDiff, 'diff'], [api.File, 'file']]) {
    const emit = Type.prototype.emitPostRender; assert.equal(typeof emit, 'function');
    t.mock.method(Type.prototype, 'emitPostRender', function (unmount = false) {
      return h.frames.during(`${kind}-post:${unmount ? 'unmount' : 'render'}`, frameOwner(this), () => emit.call(this, unmount));
    });
  }
  for (const Type of [api.FileRenderer, api.DiffHunksRenderer]) for (const method of ['asyncHighlight', 'initializeHighlighter', 'asyncRender']) {
    const original = Type.prototype[method]; assert.equal(typeof original, 'function');
    t.mock.method(Type.prototype, method, function (...args) {
      const work = original.apply(this, args);
      unexpectedAsync.push({ method, work }); h.onReadWork(work); return work;
    });
  }
  // No actual gap expansion below Chrome. A warm text CodeView is synchronous;
  // fail if an unowned async widget chain is admitted, rather than blessing an
  // inner asyncHighlight promise as the complete .then/.finally continuation.
  const loadFiles = api.FileDiff.prototype.loadFilesForDiff;
  assert.equal(typeof loadFiles, 'function');
  t.mock.method(api.FileDiff.prototype, 'loadFilesForDiff', function (...args) {
    const work = loadFiles.apply(this, args); unexpectedAsync.push({ method: 'loadFilesForDiff', work }); h.onReadWork(work); return work;
  });
  const setup = api.CodeView.prototype.setup;
  t.mock.method(api.CodeView.prototype, 'setup', function (...args) { const value = setup.apply(this, args); setups.push(this); return value; });
  const store = new graph.FileEditSessions();
  const onWork = (work, kind) => { parentCalls.push({ work, kind }); h.onReadWork(work); };
  const root = () => { const node = h.view.container.querySelector('[data-test-view]'); assert.ok(node); return node; };
  const current = () => {
    const viewport = root().querySelector('.git-diff-code-view'); assert.ok(viewport, 'supported default CodeView, not raw fallback');
    const instance = setups.findLast(value => value.getContainerElement() === viewport); assert.ok(instance, 'actual CodeView owns viewport');
    const item = instance.getRenderedItems()[0]; assert.ok(item?.element.shadowRoot, 'actual Pierre open shadow descendant');
    return { viewport, instance, item };
  };
  const join = async (from = 0) => {
    await act(async () => { await h.settle(from); });
    assertHealthy(); assert.equal(unexpectedAsync.length, 0, 'warm text fixture must not admit an unowned widget async chain');
  };
  return { ...h, requests, parentCalls, root, current, join, frameOwner,
    async show(status, id) {
      scenario = { status, id };
      const from = h.work.length;
      h.view.window.localStorage.setItem('brabbler:git-diff-preferences', JSON.stringify({ view: 'split', wrap: true }));
      await h.render(createElement(graph.FileViewerComposition, { store, viewers: [{ viewId: id, filePath: path, cwd, sourceSessionId: session, watchEnabled: false, onWork }] }));
      await join(from); return { scenario, from };
    },
    async diff(from) {
      await click(h.view, textButton(root(), 'Diff')); await join(from);
      // Deliver this mount's admitted post-render/ref-binding frame once. This
      // is a named browser callback delivery, never an until-idle work join.
      await h.frames.fire(h.frames.take()); return current();
    },
    contextReads(lifetime = scenario) { return requests.filter(request => request.scenario === lifetime && request.context); },
    async admitContext() {
      const from = h.work.length;
      await click(h.view, textButton(root(), 'After'));
      const reads = requests.filter(request => request.scenario === scenario && request.context);
      assert.equal(reads.length, 1, 'one cold explicit context request');
      const request = reads[0]; assert.equal(request.status, 200); assert.equal(request.consumed, 1);
      const work = h.work.slice(from); assert.equal(work.length, 2, 'original ensureContext and complete chooseReading action are both observed');
      return { request, from, work };
    },
    async deliver(request, value = snapshot) {
      assert.equal(request.released, false); request.released = true;
      await act(async () => { request.gate.resolve(value); });
    },
    async failBody(request, error) {
      assert.equal(request.released, false); request.released = true;
      h.expectFailure(error);
      await act(async () => { request.gate.reject(error); });
    },
    assertPromises() {
      for (const { work } of parentCalls) assert.ok(h.work.some(entry => entry.promise === work), 'Cards retains the SAME original parent promise');
      const highlighters = parentCalls.filter(call => call.kind === 'diff-highlighter'); assert.ok(highlighters.length > 0);
      for (const { work } of highlighters) {
        assert.equal(parentCalls.filter(call => call.work === work && call.kind === undefined).length, 1, 'child onWork/onReadWork forward the SAME highlighter promise');
        assert.equal(h.work.filter(entry => entry.promise === work).length, 2);
      }
    },
  };
}

export function pressed(root, label, expected) { assert.equal(textButton(root, label).getAttribute('aria-pressed'), String(expected), `${label} explicit aria-pressed`); }
export function patchControls(root, selected) {
  const group = root.querySelector('[aria-label="Patch view"]'); assert.ok(group);
  for (const label of ['Side by side', 'Unified', 'Raw patch']) pressed(group, label, label === selected);
}
export { click, textButton };
