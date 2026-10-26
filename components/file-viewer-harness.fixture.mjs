import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { filesRuntime } from './files-runtime.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
let composition;
export const defaults = { filePath: '/root/a.txt', cwd: '/root', sourceSessionId: 'session-a', watchEnabled: false };
export const denied = { edit: false, gitDiff: false }, editable = { edit: true, gitDiff: false }, eligible = { edit: true, gitDiff: true };
export function read(content, probeEligibility = denied, language = 'text') {
  return { content, language, size: content.length, nextOffset: content.length, truncated: false, probeEligibility };
}
export const expectRead = (runtime, props, offset) => runtime.expect({ type: 'read', path: props.filePath, sessionId: props.sourceSessionId, viewerCwd: props.cwd, ...(offset ? { offset } : {}) });
export const expectEdit = (runtime, props) => runtime.expect({ type: 'edit', path: props.filePath, sessionId: props.sourceSessionId });
export const expectGit = (runtime, props) => runtime.expect({ type: 'git', path: props.filePath, cwd: props.cwd });
export function button(root, text) {
  const node = [...root.querySelectorAll('button')].find(node => node.textContent === text);
  assert.equal(Boolean(node), true, `missing button ${text}`); return node;
}
export function reader(view, id = 'reader') {
  const node = view.container.querySelector(`[data-test-view="${id}"]`);
  assert.equal(Boolean(node), true, `missing reader ${id}`); return node;
}
export async function click(view, node, options = {}) {
  assert.equal(Boolean(node), true, 'click target must be mounted');
  await view.dispatch(node, new view.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
}
export async function type(view, field, value) {
  const setter = Object.getOwnPropertyDescriptor(view.window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(field, value);
  await view.dispatch(field, new view.window.Event('input', { bubbles: true }));
}
export async function open(t, overrides = {}, capabilities = {}) {
  const runtime = filesRuntime(capabilities);
  let view;
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  const graph = await (composition ??= jiti.import('./file-viewer-composition.fixture.tsx'));
  const store = new graph.FileEditSessions(), grammarWorks = [], diffWorks = [];
  capabilities.seed?.(store);
  const props = { ...defaults, ...overrides, onWork(work, kind) {
    runtime.onWork(work);
    if (kind === 'grammar') grammarWorks.push(work);
    if (kind === 'diff-highlighter') diffWorks.push(work);
    overrides.onWork?.(work, kind);
  } };
  const initial = [expectRead(runtime, props), expectRead(runtime, props)];
  const element = viewers => createElement(graph.FileViewerComposition, { store, viewers: viewers.map(props => ({ onWork: runtime.onWork, ...props })) });
  view = await runtime.mount(t, element([{ ...props, viewId: 'reader' }]), { beforeDispose: runtime.settle, setup(window) {
    runtime.setup(window); capabilities.setup?.(window);
  } });
  assert.equal(runtime.requests.length, 2, 'real Strict Effects admits replay plus current read');
  return { view, runtime, store, props, initial, grammarWorks, diffWorks,
    async joinGrammar() {
      assert.equal(grammarWorks.length > 0, true, 'grammar demand is production-owned');
      await act(async () => { await Promise.all(grammarWorks); }); runtime.assertHealthy();
    },
    async joinDiff() {
      assert.equal(diffWorks.length > 0, true, 'the real supported-Diff child must admit its native highlighter');
      await act(async () => { await Promise.all(diffWorks); }); runtime.assertHealthy();
    },
    async render(next, extra = []) {
      await view.rerender(element([{ ...next, viewId: 'reader' }, ...extra])); runtime.assertHealthy();
    },
  };
}
export function expectText(view, expected) {
  assert.equal(reader(view).querySelector('.file-source-line-content')?.textContent, expected);
}
