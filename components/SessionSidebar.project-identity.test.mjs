import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { navigationRuntime, exact, session, click, button } from './navigation-runtime.fixture.mjs';
import { sidebarRoutes } from './navigation-cases.fixture.mjs';

for (const cwd of ['/canonical/wt', 'C:/Repo/Worktree', '\\\\host\\share\\Worktree']) test(`actual custom picker installs canonical identity before cwd notification and remembers exact picker path: ${cwd}`, async t => {
  const changes = [], root = '/canonical', key = 'server:canonical';
  const listings = new Map([['/repo', []], [cwd, []]]);
  const r = await navigationRuntime(t, sidebarRoutes([session('a')], request => {
    if (request.url.pathname === '/api/cwd/browse') { exact(request, '/api/cwd/browse', { path: '/prior' }); return { handled: true, data: { path: '/prior', directories: [], parentPath: '/' } }; }
    if (request.url.pathname === '/api/cwd/validate') {
      exact(request, '/api/cwd/validate', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { cwd: '/prior' } });
      return { handled: true, data: { cwd, projectRoot: root, projectKey: key } };
    }
    if (request.url.pathname === '/api/worktrees' && request.url.searchParams.get('cwd') === cwd) return { handled: true, data: { projectRoot: root, projectKey: key, isGit: false, worktrees: [] } };
    if (request.url.pathname === '/api/sessions/worktrees' && request.url.searchParams.get('project') === root) {
      exact(request, '/api/sessions/worktrees', { project: root }, { signal: true, cache: 'no-store' }); return { handled: true, data: { project: root, mainCwd: cwd, worktrees: [] } };
    }
  }, { listings }), (window) => { window.localStorage.setItem('pi-web:last-custom-cwd', '/prior'); });
  const controller = r.graph.createActivityClientController({ visible: () => false });
  r.releaseOnClose(() => controller.dispose());
  await r.render(createElement(r.graph.SessionSidebar, { selectedSessionId: null, selectedCwd: '/repo', onSelectSession() {}, activityController: controller,
    onCwdChange: (...args) => changes.push(args) }));
  await r.settled();
  await click(r.view, r.view.container.querySelector('button[title="/repo"]'));
  await click(r.view, button(r.view, 'Custom path…'));
  await r.settled();
  assert.equal(r.view.window.document.querySelector('#directory-path').value, '/prior');
  await click(r.view, button(r.view, 'Select this folder', r.view.window.document)); await r.settled();
  assert.ok(changes.some(value => value[0] === cwd && value[1] === root && value[2] === key));
  assert.equal(changes.some(value => value[0] === cwd && value[2] === cwd), false, 'no transient raw-path project switch');
  assert.equal(r.view.window.localStorage.getItem('pi-web:last-custom-cwd'), cwd);
  // Open the real picker again; its initialPath is the last validated spelling.
  await click(r.view, r.view.container.querySelector(`button[title="${root}"]`));
  // Reload is separately installed-browser-owned. Storage bytes above establish
  // the exact remembered input without inventing a second browser store.
});
