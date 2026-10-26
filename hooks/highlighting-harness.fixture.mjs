import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { filesRuntime } from '../components/files-runtime.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { selectionListeners } from '../components/selection-listeners.fixture.mjs';

export async function harness(t, { failure = false, gated = false, kind = 'deferred', count = 1, enabled = true } = {}) {
  const runtime = filesRuntime({ idle: true });
  let view;
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  let importGate;
  if (gated) {
    const native = createJiti(import.meta.url, { fsCache: false });
    importGate = { entered: deferred(), release: deferred(),
      importActual: () => native.import('react-syntax-highlighter/dist/esm/prism') };
    runtime.installGlobal(Symbol.for('pi-web:test-prism-import-gate'), importGate);
    runtime.releaseOnSettle(() => importGate.release.resolve());
  }
  const alias = failure || gated ? { 'react-syntax-highlighter/dist/esm/prism': fileURLToPath(new URL(
    gated ? './prism-import-gate.fixture.mjs' : './prism-import-failure.fixture.mjs', import.meta.url)) } : {};
  const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false, alias });
  const graph = await jiti.import('./highlighting-composition.fixture.tsx');
  const commits = [], grammarWorks = [];
  let props = { kind, enabled, onCommit: (id, ready) => commits.push([id, ready, runtime.idleCount, grammarWorks.length]),
    onWork: work => { grammarWorks.push(work); runtime.onWork(work); } };
  const element = () => createElement('section', null, Array.from({ length: props.probeCount ?? count }, (_, i) => createElement(graph.HighlightProbe, { ...props, key: `${i}:${props.incarnation ?? 0}`, id: String(i) })));
  assert.equal(renderToStaticMarkup(element()).includes('data-ready="true"'), false, 'SSR/initial hydration is always plain');
  assert.equal(runtime.idleCount, 0, 'render does not schedule highlighting');
  let selection, baselineReady = false;
  view = await runtime.mount(t, element(), { setup(window) {
    runtime.setup(window);
    selection = selectionListeners(window.document, runtime.replaceCapability);
    runtime.assertOnSettle(() => {
      // A throwing mount has no established React baseline; do not mislabel its
      // document root listener as leaked production selection work.
      if (baselineReady) assert.equal(selection.pending, 0, 'production selection listeners released before realm disposal');
    });
  }, beforeDispose: runtime.settle });
  selection.markBaseline(); baselineReady = true;
  const ready = id => view.container.querySelector(`[data-probe="${id}"]`).dataset.ready === 'true';
  return { view, runtime, commits, ready, grammarWorks, importGate, selection,
    async joinGrammar() {
      assert.equal(grammarWorks.length > 0, true, 'production must admit grammar work before a join');
      await act(async () => { await Promise.all(grammarWorks); }); runtime.assertHealthy();
    },
    async render(change) { props = { ...props, ...change }; await view.rerender(element()); runtime.assertHealthy(); },
    async select() {
      const selection = view.window.document.getSelection(), range = view.window.document.createRange();
      range.selectNodeContents(view.container.querySelector('section')); selection.removeAllRanges(); selection.addRange(range);
      await act(async () => { view.window.document.dispatchEvent(new view.window.Event('selectionchange')); });
    },
    async clear() {
      view.window.document.getSelection().removeAllRanges();
      await act(async () => { view.window.document.dispatchEvent(new view.window.Event('selectionchange')); });
    },
  };
}

