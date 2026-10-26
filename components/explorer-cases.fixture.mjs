import assert from 'node:assert/strict';
import { createElement } from 'react';
import { encodeFilePathForApi } from '../lib/file-paths.ts';
import { navigationRuntime, exact } from './navigation-runtime.fixture.mjs';
export const entry = (name, isDir = false) => ({ name, isDir, size: 1, modified: '2026-01-01' });
export function explorerRoutes(listings, override) {
  return request => {
    const special = override?.(request);
    if (special?.handled) return special.data;
    for (const [path, entries] of listings) if (request.url.pathname === `/api/files/${encodeFilePathForApi(path)}`) {
      exact(request, request.url.pathname, { type: 'list' }); return { entries };
    }
    if (request.url.pathname === '/api/git/status') {
      const cwd = request.url.searchParams.get('cwd'); assert.ok(listings.has(cwd), `declared checkout ${cwd}`);
      exact(request, '/api/git/status', { cwd }); return { isGitRepository: false, files: [] };
    }
    assert.fail(`unplanned Explorer transport: ${request.url}`);
  };
}
export async function explorerHarness(t, { listings = new Map([['/repo', []]]), route, setup, cwd = '/repo', chat = 'a', props = {} } = {}) {
  const r = await navigationRuntime(t, route ?? explorerRoutes(listings), setup);
  const opened = [], mentioned = [], settled = [];
  let current = { cwd, contextSessionId: chat, onOpenFile: (...args) => opened.push(args), onAtMention: (...args) => mentioned.push(args),
    onAtMentions: (...args) => mentioned.push(args), onRevealSettled: id => settled.push(id), changesCollapsed: true, ...props };
  const render = () => r.render(createElement('div', { 'data-explorer-scroll': true }, createElement(r.graph.SessionFileExplorer, current)));
  await render();
  return { ...r, get view() { return r.view; }, opened, mentioned, revealSettled: settled,
    async update(next) { current = { ...current, ...next }; await render(); },
    element(path) { return [...r.view.container.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === path) ?? null; },
  };
}
