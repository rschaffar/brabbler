import { act, createElement, createRef } from 'react';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { filesRuntime } from './files-runtime.fixture.mjs';

export async function workspace(t, capabilities = {}) {
  const runtime = filesRuntime({ menu: true, dialog: true, ...capabilities });
  let view;
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  const style = fileURLToPath(new URL('../lib/testing/style.fixture.mjs', import.meta.url));
  const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false,
    alias: { './file-workspace.css': style, [fileURLToPath(new URL('./file-workspace.css', import.meta.url))]: style } });
  const { FileWorkspace } = await jiti.import('./FileWorkspace.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const ref = createRef(), statuses = [], focused = [], reveals = [], mentions = [];
  let props = { workspaceKey: 'A', active: true, presented: true, gitRefreshKey: 0, onWork: runtime.onWork,
    // FileWorkspace's effect returns onStatus's value: never return push's number.
    onStatus(status) { statuses.push(status); }, onShowFiles() {}, onEmpty() {},
    onFocusWorkspace(key) { focused.push(key); }, onRevealFile(location) { reveals.push(location); },
    onMentionLines(...args) { mentions.push(args); }, onAtMention(...args) { mentions.push(args); } };
  const element = () => createElement(I18nProvider, null, createElement(FileWorkspace, { ...props, ref }));
  view = await runtime.mount(t, element(), { setup(window) { runtime.setup(window); capabilities.setup?.(window, runtime); }, beforeDispose: runtime.settle });
  const canvas = view.container.querySelector('.file-workspace-canvas');
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 });
  await runtime.notifyResize(canvas);
  return { view, runtime, ref, statuses, focused, reveals, mentions,
    async render(change) { props = { ...props, ...change }; await view.rerender(element()); runtime.assertHealthy(); },
    async open(location, disposition) { await act(async () => { ref.current.open(location, disposition); }); runtime.assertHealthy(); },
  };
}
export function measurable(pane) {
  Object.defineProperty(pane, 'clientWidth', { configurable: true, value: 640 });
  Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 400 });
}
