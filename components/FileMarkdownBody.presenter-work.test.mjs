import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { guidedRuntime } from './guided-reader.fixture.mjs';
import { boundedErrors } from './files-diagnostics.fixture.mjs';

// Actual guided/file Markdown, CodeBlock, MermaidBlock and default Prism loader.
// Hold only external chunk delivery and the actual Mermaid render capability.
// SVG measurements below supply unsupported APIs, NOT browser layout evidence.
test('guided prose/assets and nested Mermaid source own complete held presenter work through observer swap, unmount and realm teardown', async t => {
  const prismKey = Symbol.for('pi-web:test-prism-import-gate'), mermaidKey = Symbol.for('pi-web:test-mermaid-import-gate');
  const descriptors = new Map([prismKey, mermaidKey].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const native = [], observed = [], old = [], current = [], nativeErrors = [];
  const renderEntered = deferred(), releaseRender = deferred();
  const controlledRenderError = new Error('Named Mermaid render capability failure');
  const nativeJiti = createJiti(import.meta.url, { fsCache: false });
  let runtime, view, window, beforeRestore = false, completedSvgs = 0, controlledFailures = 0;
  const trackNative = (promise, expectedError) => {
    const entry = { promise, done: false }; native.push(entry);
    promise.then(() => { entry.done = true; }, error => {
      entry.done = true;
      if (expectedError === controlledRenderError && error === controlledRenderError) controlledFailures++;
      else nativeErrors.push(error);
    });
    return promise;
  };
  const prism = { entered: deferred(), release: deferred(), importActual: () => trackNative(nativeJiti.import('react-syntax-highlighter/dist/esm/prism')) };
  const mermaid = { entered: deferred(), release: deferred(), importActual: () => trackNative((async () => {
    const { default: api } = await import(import.meta.resolve('mermaid'));
    const render = api.render;
    t.mock.method(api, 'render', function (...args) {
      renderEntered.resolve();
      return trackNative(releaseRender.promise.then(async () => {
        assert.equal(globalThis.window === window, true, 'owned realm remains installed during native render');
        assert.equal(beforeRestore, false, 'renderer cannot outlive realm restoration');
        if (args[1].includes('fixtureRenderError')) throw controlledRenderError;
        const value = await render.apply(this, args); // genuine Mermaid renderer and SVG
        assert.match(value.svg, /<svg/); completedSvgs++;
        assert.equal(globalThis.window === window, true, 'actual render terminal still owns this realm');
        assert.equal(beforeRestore, false);
        return value;
      }), controlledRenderError);
    });
    return api;
  })()) };
  const release = () => { prism.release.resolve(); mermaid.release.resolve(); releaseRender.resolve(); };
  // Registered before globals, imports or mounting. Independently restore every
  // boundary even when setup, assertions, React or presenter settlement fails.
  t.after(async () => {
    const failures = []; release();
    try { await runtime?.dispose(); } catch (error) { failures.push(error); }
    try {
      let joined = 0;
      while (joined < native.length) { const peers = native.slice(joined); joined = native.length; await Promise.allSettled(peers.map(entry => entry.promise)); }
    } catch (error) { failures.push(error); }
    for (const [key, descriptor] of descriptors) try {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    } catch (error) { failures.push(error); }
    failures.push(...nativeErrors);
    if (failures.length) { const failure = new AggregateError(failures, 'Presenter ownership cleanup failed'); console.log(boundedErrors(failure)); throw failure; }
  });
  Object.defineProperty(globalThis, prismKey, { configurable: true, value: prism });
  Object.defineProperty(globalThis, mermaidKey, { configurable: true, value: mermaid });
  runtime = guidedRuntime(t, {
    releasePresenters: release,
    async joinPresenters() {
      let joined = 0;
      while (joined < native.length) { const peers = native.slice(joined); joined = native.length; await Promise.allSettled(peers.map(entry => entry.promise)); }
      if (nativeErrors.length) throw new AggregateError(nativeErrors, 'Actual presenter capability failed');
    },
    setupPresenters(realm, replace) {
      window = realm;
      replace(globalThis, 'SVGElement', realm.SVGElement);
      replace(globalThis, 'XMLSerializer', realm.XMLSerializer);
      replace(globalThis, 'CSSStyleSheet', realm.CSSStyleSheet);
      replace(realm.SVGElement.prototype, 'getBBox', () => ({ x: 0, y: 0, width: 120, height: 24 }));
      replace(realm.SVGElement.prototype, 'getComputedTextLength', () => 100);
    },
    beforeRealmRestore() {
      assert.equal(observed.every(entry => entry.done), true, 'actual parent-observed import/render/catch/publication originals joined before realm restoration');
      assert.equal(native.every(entry => entry.done), true, 'all independently captured native capabilities settled');
      beforeRestore = true;
    },
  });
  const jiti = createJiti(import.meta.url, { fsCache: false, tsconfigPaths: true, jsx: { runtime: 'automatic' }, alias: {
    'react-syntax-highlighter/dist/esm/prism': fileURLToPath(new URL('../hooks/prism-import-gate.fixture.mjs', import.meta.url)),
    mermaid: fileURLToPath(new URL('./mermaid-import-gate.fixture.mjs', import.meta.url)),
  } });
  const { GuidedReviewReader } = await jiti.import('./GuidedReviewReader.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const observer = list => promise => {
    const entry = { promise, done: false }; list.push(entry); observed.push(entry); runtime.onWork(promise);
    promise.then(() => { entry.done = true; }, () => { entry.done = true; });
  };
  let onWork = observer(old);
  const element = () => createElement(I18nProvider, null, createElement(GuidedReviewReader, { indexPath: '/guide/index.md', onClose() {}, onWork }));
  const index = { version: 1, id: 'guide', title: 'Presenter work', chapters: [{ id: 'chapter', title: 'Chapter', path: 'chapter.md' }] };
  const source = { version: 1, kind: 'source', id: 'example', title: 'Literal example', cwd: '/repo', branch: 'main', oid: 'a'.repeat(40), path: 'code.ts', start: 1, end: 2 };
  const prose = '> ```pi-review\n> ' + JSON.stringify(source) + '\n> ```\n\n```mermaid\nflowchart TD\nA --> B\n```';
  const targets = [
    { version: 1, kind: 'web', id: 'web', title: 'Reference', url: 'https://example.test/reference' },
    ...['json', 'md', 'mmd'].map(ext => ({ version: 1, kind: 'file', id: ext, title: `Asset ${ext}`, path: `asset.${ext}` })),
  ];
  const notebook = { index, chapters: [{ ...index.chapters[0], steps: [{ id: 'step', title: 'Inspect presenters', markdown: prose, targets }] }] };
  const replay = runtime.expect('/api/review-notebook', { index: '/guide/index.md' }), folder = runtime.expect('/api/review-notebook', { index: '/guide/index.md' });
  view = await runtime.mount(element());
  await folder.deliver(notebook); await replay.deliver(notebook);
  await Promise.all([prism.entered.promise, mermaid.entered.promise]);
  assert.equal(view.container.querySelector('[data-review-stop]') === null, true, 'quoted fence stays literal while its real CodeBlock grammar load is held');
  assert.equal(old.filter(entry => !entry.done).length >= 2, true, 'presenter terminal work, not only folder reads, reaches the parent');
  const oldCount = old.length, count = observed.length;
  onWork = observer(current); await view.rerender(element());
  assert.equal(observed.length, count, 'observer changes do not restart or replay admitted presenter work');
  const choose = async (id, content) => {
    const prior = runtime.expect('/api/review-notebook', { index: '/guide/index.md', asset: `asset.${id}` });
    const latest = runtime.expect('/api/review-notebook', { index: '/guide/index.md', asset: `asset.${id}` });
    const select = view.container.querySelector('select[aria-label="Evidence target"]'); select.value = id;
    await view.dispatch(select, new window.Event('change', { bubbles: true }));
    const before = current.length;
    await latest.deliver({ content }); await prior.deliver({ content: 'obsolete replay' });
    assert.equal(current.length > before, true, `${id} asset forwards newly admitted presenter work, not just its read`);
    return current.slice(before);
  };
  await choose('json', '{"asset":true}');
  await choose('md', '```json\n{"markdownAsset":true}\n```');
  const directMermaid = await choose('mmd', 'flowchart TD\nfixtureRenderError --> Result');
  const beforeSource = current.length;
  const sourceButton = [...view.container.querySelectorAll('.guided-file-evidence button')].find(button => button.textContent === 'Source');
  assert.equal(!!sourceButton, true);
  await view.dispatch(sourceButton, new window.MouseEvent('click', { bubbles: true }));
  assert.equal(current.length > beforeSource, true, 'nested Mermaid source CodeBlock forwards its grammar terminal');
  assert.equal(old.length, oldCount, 'newly admitted descendants use the current observer only');
  // Release actual package imports, but keep native Mermaid render work held.
  // The alternative is the finite captured original presenter set, not guessed
  // idle/microtasks: fail rather than hang if no actual render can be admitted.
  const originals = observed.map(entry => entry.promise);
  await act(async () => {
    prism.release.resolve(); mermaid.release.resolve();
    await Promise.race([renderEntered.promise, Promise.all(originals).then(() => { throw new Error('Actual Mermaid render was never admitted'); })]);
  });
  assert.equal(native.some(entry => !entry.done), true, 'actual native render is held');
  assert.equal(directMermaid.every(entry => !entry.done), true, 'Mermaid observer includes the held render/catch/publication terminal, not only its import');
  const pending = observed.filter(entry => !entry.done);
  assert.equal(pending.length > 0, true, 'production terminal includes render, not just module import');
  assert.equal(pending.every(entry => native.every(capability => capability.promise !== entry.promise)), true, 'observers receive original component terminal handlers, not raw renderer capabilities');
  await view.unmount();
  assert.equal(beforeRestore, false, 'public unmount is not an I/O join or realm destruction');
  try { await runtime.dispose(); } // releases peers, joins terminals, THEN restores/closes realm
  catch (error) { console.log(boundedErrors(error)); throw error; }
  assert.equal(beforeRestore, true);
  assert.equal(observed.every(entry => entry.done), true);
  assert.equal(observed.every(entry => entry.promise instanceof Promise), true);
  assert.equal(nativeErrors.length, 0, 'only the named controlled render refusal is expected');
  assert.equal(completedSvgs > 0, true, 'actual Mermaid render completed successfully before disposal');
  assert.equal(controlledFailures > 0, true, 'named rejected render really ran; production catch/publication terminal fulfilled');
  assert.equal(runtime.requests.every(request => request.path === '/api/review-notebook'), true, 'no hidden Git, media or network reads');
});
