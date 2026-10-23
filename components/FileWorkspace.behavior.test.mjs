import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, createRef } from 'react';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { markdownDom } from './markdown-dom.fixture.mjs';
import { filesRuntime } from './files-runtime.fixture.mjs';

const style = fileURLToPath(new URL('../lib/testing/style.fixture.mjs', import.meta.url));
const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false, alias: {
  './file-workspace.css': style,
  [fileURLToPath(new URL('./file-workspace.css', import.meta.url))]: style,
} });

async function workspace(t) {
  const runtime = filesRuntime();
  let view;
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  const { FileWorkspace } = await jiti.import('./FileWorkspace.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const ref = createRef(), statuses = [];
  let props = { workspaceKey: 'A', active: true, presented: true, gitRefreshKey: 0,
    onStatus: status => { statuses.push(status); }, onShowFiles() {}, onEmpty() {},
    onFocusWorkspace() {}, onMentionLines() {}, onAtMention() {} };
  const element = () => createElement(I18nProvider, null, createElement(FileWorkspace, { ...props, ref }));
  view = await mountWorkspace(element());
  async function mountWorkspace(element) {
    const { mount } = await import('../lib/testing/react.fixture.mjs');
    return mount(t, element, { setup: runtime.setup });
  }
  const canvas = view.container.querySelector('.file-workspace-canvas');
  // Numeric observer capability only: this selects the production wide branch,
  // not real CSS geometry, native scrolling or physical focus proof.
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0,
    right: 1200, bottom: 800, width: 1200, height: 800, toJSON() { return {}; } });
  await runtime.notifyResize(canvas);
  return { view, runtime, ref, statuses,
    async render(change) { props = { ...props, ...change }; await view.rerender(element()); runtime.assertHealthy(); },
    async open(location, disposition) { await act(() => { ref.current.open(location, disposition); }); runtime.assertHealthy(); },
  };
}
const readReply = content => ({ content, language: 'text', size: content.length,
  nextOffset: content.length, truncated: false, probeEligibility: { edit: false, gitDiff: false } });
const readPlan = (runtime, location) => runtime.expect({ type: 'read', path: location.filePath,
  sessionId: location.sourceSessionId, viewerCwd: location.cwd });

test('actual workspace mounts with its real stores and releases Strict Effects observers', async t => {
  const f = markdownDom(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const observers = [];
  class ResizeCapability {
    constructor(callback) { this.callback = callback; this.closed = false; observers.push(this); }
    observe(target) { this.target = target; this.callback([{ target, contentRect: { width: 1200, height: 800 } }]); }
    unobserve() {}
    disconnect() { this.closed = true; }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: ResizeCapability });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous);
    else delete globalThis.ResizeObserver;
  });
  const { FileWorkspace } = await jiti.import('./FileWorkspace.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const ref = createRef(), statuses = [];
  const view = await f.mount(createElement(I18nProvider, null, createElement(FileWorkspace, {
    ref, workspaceKey: 'A', active: true, presented: true, gitRefreshKey: 0,
    onStatus: status => { statuses.push(status); }, onShowFiles() {}, onEmpty() {},
    onFocusWorkspace() {}, onMentionLines() {}, onAtMention() {},
  })));
  assert.equal(typeof ref.current.open, 'function');
  const canvas = view.container.querySelector('.file-workspace-canvas');
  assert.equal(Boolean(canvas), true);
  assert.equal(statuses.at(-1).count, 0);
  assert.equal(f.requests.length, 0);
  const owned = observers.filter(observer => observer.target === canvas);
  assert.equal(owned.length, 2, 'real Strict Effects setup/cleanup/setup');
  assert.equal(owned.filter(observer => !observer.closed).length, 1);
  await view.unmount();
  assert.equal(ref.current === null, true);
  assert.ok(observers.every(observer => observer.closed));
  assert.equal(view.container.childNodes.length, 0);
});

test('selected reader identity survives repeat commands and panel hiding while watch admission follows active/presented', async t => {
  const h = await workspace(t), { view, runtime } = h;
  const location = { filePath: '/root/a.txt', label: 'a.txt', cwd: '/root', sourceSessionId: 'origin-A' };
  const replay = readPlan(runtime, location), current = readPlan(runtime, location);
  await h.open(location);
  await current.deliver(readReply('first\nsecond\nthird')); await replay.deliver(readReply('obsolete'));
  const host = view.container.querySelector('.file-workspace-view');
  const reader = host.querySelector('.file-viewer-content');
  assert.equal(Boolean(host && reader), true);
  assert.equal(host.hidden, false);
  assert.equal(runtime.liveSources.length, 1);
  const first = runtime.liveSources[0], admitted = runtime.requests.length;
  await h.open({ ...location, lineTarget: { line: 2 } });
  assert.ok(view.container.querySelector('.file-workspace-view') === host, 'new command does not rekey host');
  assert.ok(host.querySelector('.file-viewer-content') === reader, 'same reader receives the command');
  assert.equal(runtime.requests.length, admitted, 'repeat does not refetch/remount');
  await h.render({ active: false });
  assert.equal(first.closeCalls, 1);
  assert.equal(runtime.liveSources.length, 0);
  assert.equal(host.hidden, false, 'inactive and concealed are separate inputs');
  await h.render({ presented: false });
  assert.ok(view.container.querySelector('.file-workspace-view') === host);
  assert.ok(host.querySelector('.file-viewer-content') === reader);
  assert.equal(host.hidden, true);
  assert.equal(host.hasAttribute('inert'), true);
  assert.match(host.textContent, /second/);
  await h.render({ presented: true });
  assert.equal(runtime.liveSources.length, 0, 'showing alone cannot override inactive workspace');
  await h.render({ active: true });
  assert.equal(runtime.liveSources.length, 1);
  const replacement = runtime.liveSources[0];
  assert.ok(replacement !== first);
  const sync = readPlan(runtime, location);
  await replacement.connected(); await sync.deliver(readReply('current after reveal'));
  assert.match(host.textContent, /current after reveal/);
  assert.ok(host.querySelector('.file-viewer-content') === reader);
  assert.equal(host.hidden, false);
  const before = runtime.requests.length;
  await first.invokeRetained('connected'); await first.invokeRetained('change');
  assert.equal(runtime.requests.length, before);
  await view.unmount();
  assert.equal(replacement.closeCalls, 1);
  assert.equal(runtime.liveSources.length, 0);
  runtime.assertHealthy();
});
