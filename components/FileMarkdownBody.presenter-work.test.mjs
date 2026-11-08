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
// Replace only chunk delivery and external frame transport. Finite SVG replies
// prove publication/cancellation, not Mermaid parsing, math, layout or iframe
// disposal: those remain installed-browser/controller-test obligations.
test('guided prose/assets and nested Mermaid source own complete held presenter work through observer swap, cancellation and realm teardown', async t => {
  const prismKey = Symbol.for('brabbler:test-prism-import-gate'), frameKey = Symbol.for('brabbler:test-mermaid-frame-transport');
  const descriptors = new Map([prismKey, frameKey].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const native = [], frames = [], observed = [], old = [], current = [], capabilityErrors = [];
  const controlledRenderError = new Error('Named Mermaid render capability failure');
  const proseCode = 'flowchart TD\nA --> B', assetCode = 'flowchart TD\nfixtureRenderError --> Result';
  const gate = (name, response) => ({ name, entered: deferred(), release: deferred(), ...response });
  const gates = {
    obsoleteProse: gate('obsolete prose success', { svg: '<svg xmlns="http://www.w3.org/2000/svg" data-presenter="obsolete-prose" />' }),
    currentProse: gate('current prose success', { svg: '<svg xmlns="http://www.w3.org/2000/svg" data-presenter="current-prose" />' }),
    obsoleteAsset: gate('obsolete mmd error', { error: controlledRenderError }),
    currentAsset: gate('mmd held through unmount', { svg: '<svg xmlns="http://www.w3.org/2000/svg" data-presenter="unmounted-mmd" />' }),
  };
  const activeGates = new Map([[proseCode, gates.obsoleteProse], [assetCode, gates.obsoleteAsset]]);
  const nativeJiti = createJiti(import.meta.url, { fsCache: false });
  let runtime, view, window, admitting = true, beforeRestore = false, controlledFailures = 0;
  const trackNative = promise => {
    const entry = { promise, done: false }; native.push(entry);
    promise.then(() => { entry.done = true; }, error => { entry.done = true; capabilityErrors.push(error); });
    return promise;
  };
  const prism = { entered: deferred(), release: deferred(), importActual: () => trackNative(nativeJiti.import('react-syntax-highlighter/dist/esm/prism')) };
  const transport = { render(input, signal) {
    const named = activeGates.get(input.code), entry = { named, signal, aborts: 0, done: false, error: null };
    frames.push(entry);
    const abort = () => { entry.aborts++; };
    entry.promise = (async () => {
      assert.equal(admitting, true, 'frame transport admission remains open');
      assert.equal(!!named, true, 'only declared diagram inputs are admitted');
      assert.equal(signal.aborted, false, 'new render receives a live cancellation signal');
      assert.equal(input.dark, false); assert.equal(input.allowImages, false);
      assert.equal(typeof input.isAllowed, 'function');
      signal.addEventListener('abort', abort, { once: true });
      named.entered.resolve();
      // Deliberately ignore abort: the actual component must suppress obsolete
      // success/catch publication even if the external capability completes late.
      await named.release.promise;
      assert.equal(globalThis.window === window, true, 'capability terminal still owns the installed realm');
      assert.equal(beforeRestore, false, 'capability cannot outlive realm restoration');
      if (named.error) throw named.error;
      return named.svg;
    })();
    entry.promise.then(value => {
      entry.done = true; entry.value = value; signal.removeEventListener('abort', abort);
    }, error => {
      entry.done = true; entry.error = error; signal.removeEventListener('abort', abort);
      if (named?.error === controlledRenderError && error === controlledRenderError) controlledFailures++;
      else capabilityErrors.push(error);
    });
    return entry.promise;
  } };
  const release = () => { admitting = false; prism.release.resolve(); for (const named of Object.values(gates)) named.release.resolve(); };
  const joinCapabilities = async () => {
    let nativeJoined = 0, framesJoined = 0;
    while (nativeJoined < native.length || framesJoined < frames.length) {
      const peers = [...native.slice(nativeJoined), ...frames.slice(framesJoined)]; nativeJoined = native.length; framesJoined = frames.length;
      await Promise.allSettled(peers.map(entry => entry.promise));
    }
  };
  // Registered before globals, imports or mounting. Independently restore every
  // boundary even when setup, assertions, React or presenter settlement fails.
  t.after(async () => {
    const failures = []; release();
    try { await runtime?.dispose(); } catch (error) { failures.push(error); }
    try { await joinCapabilities(); } catch (error) { failures.push(error); }
    for (const [key, descriptor] of descriptors) try {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    } catch (error) { failures.push(error); }
    failures.push(...capabilityErrors);
    if (failures.length) { const failure = new AggregateError(failures, 'Presenter ownership cleanup failed'); console.log(boundedErrors(failure)); throw failure; }
  });
  Object.defineProperty(globalThis, prismKey, { configurable: true, value: prism });
  Object.defineProperty(globalThis, frameKey, { configurable: true, value: transport });
  runtime = guidedRuntime(t, {
    releasePresenters: release,
    async joinPresenters() {
      await joinCapabilities();
      if (capabilityErrors.length) throw new AggregateError(capabilityErrors, 'Presenter capability failed');
    },
    setupPresenters(realm) { window = realm; },
    beforeRealmRestore() {
      assert.equal(observed.every(entry => entry.done), true, 'actual parent-observed import/render/catch/publication originals joined before realm restoration');
      assert.equal(native.every(entry => entry.done), true, 'all independently captured actual Prism imports settled');
      assert.equal(frames.every(entry => entry.done), true, 'all original controlled frame responses settled');
      beforeRestore = true;
    },
  });
  const frameFixture = fileURLToPath(new URL('./mermaid-frame-transport.fixture.mjs', import.meta.url));
  const jiti = createJiti(import.meta.url, { fsCache: false, tsconfigPaths: true, jsx: { runtime: 'automatic' }, alias: {
    'react-syntax-highlighter/dist/esm/prism': fileURLToPath(new URL('../hooks/prism-import-gate.fixture.mjs', import.meta.url)),
    '@/lib/mermaid-render-client': frameFixture,
    [fileURLToPath(new URL('../lib/mermaid-render-client', import.meta.url))]: frameFixture,
    [fileURLToPath(new URL('../lib/mermaid-render-client.ts', import.meta.url))]: frameFixture,
  } });
  const { GuidedReviewReader } = await jiti.import('./GuidedReviewReader.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const observer = list => promise => {
    const entry = { promise, done: false, error: null }; list.push(entry); observed.push(entry); runtime.onWork(promise);
    promise.then(() => { entry.done = true; }, error => { entry.done = true; entry.error = error; });
  };
  let onWork = observer(old);
  const element = () => createElement(I18nProvider, null, createElement(GuidedReviewReader, { indexPath: '/guide/index.md', onClose() {}, onWork }));
  const index = { version: 1, id: 'guide', title: 'Presenter work', chapters: [{ id: 'chapter', title: 'Chapter', path: 'chapter.md' }] };
  const source = { version: 1, kind: 'source', id: 'example', title: 'Literal example', cwd: '/repo', branch: 'main', oid: 'a'.repeat(40), path: 'code.ts', start: 1, end: 2 };
  const prose = '> ```brabbler-review\n> ' + JSON.stringify(source) + '\n> ```\n\n```mermaid\n' + proseCode + '\n```';
  const targets = [
    { version: 1, kind: 'web', id: 'web', title: 'Reference', url: 'https://example.test/reference' },
    ...['json', 'md', 'mmd'].map(ext => ({ version: 1, kind: 'file', id: ext, title: `Asset ${ext}`, path: `asset.${ext}` })),
  ];
  const notebook = { index, chapters: [{ ...index.chapters[0], steps: [{ id: 'step', title: 'Inspect presenters', markdown: prose, targets }] }] };
  const replay = runtime.expect('/api/review-notebook', { index: '/guide/index.md' }), folder = runtime.expect('/api/review-notebook', { index: '/guide/index.md' });
  view = await runtime.mount(element());
  await folder.deliver(notebook); await replay.deliver(notebook);
  assert.equal(frames.some(entry => entry.named === gates.obsoleteProse), true, 'guided prose reaches the declared frame capability');
  await Promise.all([prism.entered.promise, gates.obsoleteProse.entered.promise]);
  assert.equal(view.container.querySelector('[data-review-stop]') === null, true, 'quoted fence stays literal while its real CodeBlock grammar load is held');
  assert.equal(old.filter(entry => !entry.done).length >= 2, true, 'presenter terminal work, not only folder reads, reaches the parent');
  const oldCount = old.length, count = observed.length, frameCount = frames.length;
  onWork = observer(current); await view.rerender(element());
  assert.equal(observed.length, count, 'observer changes do not restart or replay admitted presenter work');
  assert.equal(frames.length, frameCount, 'observer changes do not restart frame transport');
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
  const directMermaid = await choose('mmd', assetCode);
  const toggle = async (scope, label) => {
    const button = [...view.container.querySelectorAll(`${scope} button`)].find(button => button.textContent === label);
    assert.equal(!!button, true, `${scope} exposes ${label}`);
    await view.dispatch(button, new window.MouseEvent('click', { bubbles: true }));
  };
  const beforeSource = current.length;
  await toggle('.guided-file-evidence', 'Source');
  assert.equal(current.length > beforeSource, true, 'nested Mermaid source CodeBlock forwards its grammar terminal');
  const obsoleteAsset = frames.filter(entry => entry.named === gates.obsoleteAsset);
  assert.equal(obsoleteAsset.length > 0, true);
  assert.equal(obsoleteAsset.every(entry => entry.signal.aborted && entry.aborts > 0 && !entry.done), true, 'Source requests cancellation without mistaking ignored abort for settlement');
  assert.equal(directMermaid.every(entry => !entry.done), true, 'Mermaid observer includes held response/catch/publication, not only admission');
  activeGates.set(assetCode, gates.currentAsset);
  const beforePreview = current.length;
  await toggle('.guided-file-evidence', 'Preview');
  const heldAssetWork = current.slice(beforePreview), heldAssetFrames = frames.filter(entry => entry.named === gates.currentAsset);
  assert.equal(heldAssetWork.length > 0 && heldAssetFrames.length > 0, true, 'current preview forwards its original terminal');
  await act(async () => { gates.obsoleteAsset.release.resolve(); await Promise.all(directMermaid.map(entry => entry.promise)); });
  assert.equal(obsoleteAsset.every(entry => entry.error === controlledRenderError), true, 'raw response preserves the SAME named Error');
  assert.equal(directMermaid.every(entry => entry.done && entry.error === null), true, 'actual component catch fulfills its original terminal');
  // Same code/key is deliberate: a key mismatch cannot hide a broken local
  // cancellation guard. The obsolete catch must not replace current loading.
  assert.equal(view.container.querySelector('.guided-file-evidence .mermaid-block-error') === null, true, 'obsolete error cannot replace current loading');
  assert.equal(view.container.querySelector('.guided-file-evidence .mermaid-block-loading') !== null, true, 'current held preview remains loading');
  assert.equal(heldAssetWork.every(entry => !entry.done), true);

  await toggle('.guided-prose', 'Source');
  const obsoleteProse = frames.filter(entry => entry.named === gates.obsoleteProse);
  assert.equal(obsoleteProse.every(entry => entry.signal.aborted && entry.aborts > 0 && !entry.done), true, 'prose Source also requests cancellation');
  activeGates.set(proseCode, gates.currentProse);
  const beforeProsePreview = current.length;
  await toggle('.guided-prose', 'Preview');
  const currentProseWork = current.slice(beforeProsePreview);
  assert.equal(currentProseWork.length > 0, true);
  assert.equal(frames.some(entry => entry.named === gates.currentProse), true);
  await act(async () => { gates.currentProse.release.resolve(); await Promise.all(currentProseWork.map(entry => entry.promise)); });
  const currentSvg = view.container.querySelector('.guided-prose svg[data-presenter="current-prose"]');
  assert.equal(currentSvg !== null, true, 'finite current SVG is published by the actual component');
  // Keep the real package-owned Prism import and all original old-observer
  // terminals, including its publication handlers, joined while the realm lives.
  await act(async () => { prism.release.resolve(); gates.obsoleteProse.release.resolve(); await Promise.all(old.map(entry => entry.promise)); });
  assert.equal(view.container.querySelector('.guided-prose svg[data-presenter="current-prose"]') === currentSvg, true, 'late same-key SVG cannot replace current SVG');
  assert.equal(view.container.querySelector('svg[data-presenter="obsolete-prose"]') === null, true, 'ignored-abort success is never published');
  assert.equal(native.length > 0 && native.every(entry => entry.done), true, 'actual Prism import joined');
  assert.equal(old.length, oldCount, 'newly admitted descendants use the current observer only');
  const pending = observed.filter(entry => !entry.done);
  assert.equal(pending.length > 0, true, 'production terminal includes the held frame response');
  assert.equal(pending.every(entry => [...native, ...frames].every(capability => capability.promise !== entry.promise)), true, 'observers receive original component terminal handlers, not raw capabilities');
  admitting = false;
  await view.unmount();
  assert.equal(heldAssetFrames.every(entry => entry.signal.aborted && entry.aborts > 0 && !entry.done), true, 'unmount requests cancellation while ignored-abort transport remains held');
  assert.equal(heldAssetWork.every(entry => !entry.done), true, 'unmount does not pretend the full wrapper has settled');
  assert.equal(beforeRestore, false, 'public unmount is not an I/O join or realm destruction');
  try { await runtime.dispose(); } // releases all peers, joins originals, THEN restores/closes realm
  catch (error) { console.log(boundedErrors(error)); throw error; }
  assert.equal(beforeRestore, true);
  assert.equal(observed.every(entry => entry.done && entry.error === null), true);
  assert.equal(observed.every(entry => entry.promise instanceof Promise), true);
  assert.equal(capabilityErrors.length, 0, 'only the named controlled frame refusal is expected');
  assert.equal(heldAssetFrames.every(entry => entry.done && entry.value === gates.currentAsset.svg), true, 'late finite transport reply joined after unmount, without claiming real Mermaid computation');
  assert.equal(controlledFailures > 0, true, 'named rejected response ran; production catch/publication terminal fulfilled');
  assert.equal(runtime.requests.every(request => request.path === '/api/review-notebook'), true, 'no hidden Git, media or network reads');
});
