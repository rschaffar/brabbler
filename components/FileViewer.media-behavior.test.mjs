import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { filesRuntime } from './files-runtime.fixture.mjs';

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false,
});
let composition;
const kinds = [
  { ext: 'png', selector: 'img' },
  { ext: 'wav', selector: 'audio' },
  { ext: 'webm', selector: 'video' },
  { ext: 'pdf', selector: 'iframe' },
];
const meta = (runtime, props) => runtime.expect({ type: 'meta', path: props.filePath, sessionId: props.sourceSessionId });
const assertSize = (root, text) => assert.equal([...root.querySelectorAll('span')]
  .filter(node => node.textContent === text).length, 1, `exact metadata size ${text}`);

async function openMedia(t, kind) {
  const runtime = filesRuntime();
  let view;
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  // Host guards precede the real graph import, just as in the text owner.
  const { FileViewerComposition, FileEditSessions } = await (composition ??= jiti.import('./file-viewer-composition.fixture.tsx'));
  const store = new FileEditSessions();
  const props = { onWork: runtime.onWork, filePath: `/root/asset.${kind.ext}`, cwd: '/old-checkout', sourceSessionId: 'media-origin', watchEnabled: false };
  const initial = kind.ext === 'pdf' ? [meta(runtime, props), meta(runtime, props)] : [];
  const element = props => createElement(FileViewerComposition, { store, viewers: [{ ...props, viewId: 'reader' }] });
  view = await runtime.mount(t, element(props), { setup: runtime.setup, beforeDispose: runtime.settle });
  assert.equal(runtime.requests.length, initial.length, 'only PDF initial metadata is permitted with watching disabled');
  assert.equal(runtime.sources.length, 0, 'watchEnabled is forwarded to the actual selected branch');
  const root = () => view.container.querySelector('[data-test-view="reader"]');
  const src = () => {
    const preview = root().querySelector(kind.selector);
    assert.equal(Boolean(preview), true, `actual ${kind.selector} preview remains mounted`);
    return preview.getAttribute('src');
  };
  const checkSource = (source, context) => {
    assert.equal(source.url.pathname, `/api/files/${context.filePath.replace(/^\//, '')}`);
    assert.deepEqual([...source.url.searchParams].sort(), [['sessionId', context.sourceSessionId], ['type', 'watch']]);
  };
  return { view, runtime, props, initial, root, src, checkSource,
    async render(next) { await view.rerender(element(next)); runtime.assertHealthy(); },
  };
}

// Independent actual branch owners, not a fake generic media viewer. The cwd
// change is coupled to an explicit watch pause: media watcher identity is
// path/session/watchEnabled, NOT cwd. The equal-cwd case is a new incarnation.
// jsdom observes DOM attributes/React metadata only; no native src fetch, layout,
// decoder, PDF navigation, pause/load or resource-closure claim is made.
for (const kind of kinds) for (const nextCwd of ['/new-checkout', '/old-checkout']) {
  test(`actual ${kind.ext} watcher/metadata lifetime across pause and ${nextCwd}`, async t => {
    const h = await openMedia(t, kind);
    const { view, runtime, props, initial, root, src, checkSource } = h;
    if (initial.length) {
      await initial[1].deliver({ size: 10 });
      await initial[0].deliver({ error: 'obsolete PDF initial metadata' });
      assertSize(root(), '10 B');
      assert.doesNotMatch(root().textContent, /obsolete/);
    }
    const initialSrc = src();
    assert.equal(new URL(initialSrc, 'https://fixture.invalid').searchParams.get('sessionId'), props.sourceSessionId);
    assert.equal(new URL(initialSrc, 'https://fixture.invalid').searchParams.get('type'), 'read');
    await h.render({ ...props, watchEnabled: true });
    assert.equal(runtime.liveSources.length, 1);
    const oldSource = runtime.liveSources[0]; checkSource(oldSource, props);
    const obsolete = meta(runtime, props);
    await oldSource.connected(); await obsolete.headers();
    const disposedLatest = meta(runtime, props);
    await oldSource.connected(); await disposedLatest.headers();
    assert.match(root().textContent, /live/);
    const paused = { ...props, cwd: nextCwd, watchEnabled: false };
    const beforePause = runtime.requests.length;
    await h.render(paused);
    assert.equal(runtime.requests.length, beforePause, 'cwd/pause does not invent initial media metadata reads');
    assert.equal(oldSource.closeCalls, 1);
    assert.equal(runtime.liveSources.length, 0);
    assert.equal(src(), initialSrc, 'pausing preserves the actual preview src attribute');
    assert.match(root().textContent, /static/);
    // No newer request has advanced the generation yet: cleanup's active flag
    // itself must reject this latest body, not merely a later requestId check.
    await disposedLatest.deliver({ error: 'disposed latest metadata poison' });
    assert.equal(disposedLatest.jsonReturned, true);
    assert.equal(src(), initialSrc);
    assert.doesNotMatch(root().textContent, /poison/);
    await h.render({ ...paused, watchEnabled: true });
    assert.equal(runtime.liveSources.length, 1);
    const source = runtime.liveSources[0];
    assert.equal(source !== oldSource, true, 'new watcher incarnation even at the same textual cwd');
    checkSource(source, paused);
    const current = meta(runtime, paused);
    await source.connected(); await current.headers();
    const admitted = runtime.requests.length;
    await obsolete.deliver({ error: 'disposed connected metadata poison' });
    assert.equal(obsolete.jsonReturned, true);
    assert.equal(runtime.requests.length, admitted);
    assert.equal(src(), initialSrc, 'disposed completion cannot disturb the current pending preview');
    assert.doesNotMatch(root().textContent, /poison/);
    await current.deliver({ size: 21 });
    assertSize(root(), '21 B');
    assert.equal(new URL(src(), 'https://fixture.invalid').searchParams.get('v'), '1');

    // Active lifetime: a newer metadata body wins over an older SUCCESS body.
    const older = meta(runtime, paused); await source.connected(); await older.headers();
    const newer = meta(runtime, paused); await source.connected(); await newer.deliver({ size: 31 });
    const newestSrc = src();
    await older.deliver({ size: 9991 });
    assert.equal(older.jsonReturned, true);
    assert.equal(src(), newestSrc);
    assertSize(root(), '31 B');
    assert.doesNotMatch(root().textContent, /9991/);

    // A real change event invalidates an active metadata request, including its
    // catch path. change itself carries size and does not admit another fetch.
    const superseded = meta(runtime, paused); await source.connected(); await superseded.headers();
    const beforeChange = runtime.requests.length;
    await source.change({ size: 41 });
    assert.equal(runtime.requests.length, beforeChange);
    const changedSrc = src();
    assert.equal(changedSrc !== newestSrc, true);
    await superseded.rejectBody(new Error('superseded current metadata body'));
    assert.equal(src(), changedSrc);
    assertSize(root(), '41 B');
    assert.doesNotMatch(root().textContent, /superseded/);
    await source.error();
    assert.match(root().textContent, /static/);

    // Replacement path AND session exercise captured endpoint identity/reset.
    // PDF still owns a separate initial metadata request in this new identity.
    const replacement = { ...paused, filePath: `/root/replacement.${kind.ext}`, sourceSessionId: 'media-replacement', watchEnabled: true };
    const pendingOldIdentity = meta(runtime, paused); await source.connected(); await pendingOldIdentity.headers();
    const reset = kind.ext === 'pdf' ? meta(runtime, replacement) : null;
    await h.render(replacement);
    assert.equal(source.closeCalls, 1);
    if (reset) await reset.deliver({ size: 11 });
    assert.equal(runtime.liveSources.length, 1);
    const replacementSource = runtime.liveSources[0]; checkSource(replacementSource, replacement);
    const replacementMeta = meta(runtime, replacement);
    await replacementSource.connected(); await replacementMeta.deliver({ size: 51 });
    const replacementSrc = src();
    await pendingOldIdentity.deliver({ error: 'old identity metadata poison' });
    assert.equal(src(), replacementSrc);
    assertSize(root(), '51 B');
    assert.doesNotMatch(root().textContent, /poison/);
    const finalPaused = { ...replacement, watchEnabled: false };
    await h.render(finalPaused);
    assert.equal(replacementSource.closeCalls, 1);
    assert.equal(runtime.liveSources.length, 0);
    assert.equal(src(), replacementSrc);
    await view.unmount();
    assert.equal(runtime.sources.every(source => source.closeCalls === 1), true);
    runtime.assertHealthy();
    // Deliberately retained connected/change callbacks are NOT invoked here:
    // unlike TextFileViewer, these production branches have no entry disposal
    // guard. Stale BODY lifetime is covered; retained callback admission is not.
  });
}
