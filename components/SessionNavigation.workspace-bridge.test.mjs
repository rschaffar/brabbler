import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, createRef } from 'react';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { mount } from '../lib/testing/react.fixture.mjs';
import { filesRuntime } from './files-runtime.fixture.mjs';
import { session, click, inputText, button } from './navigation-runtime.fixture.mjs';

const plain = (content, edit = false) => ({ content, language: 'text', size: content.length,
  nextOffset: content.length, truncated: false, probeEligibility: { edit, gitDiff: false } });

test('actual project navigation hides Files without destroying its dirty host, editor or real edit-store owner; saved-session return uses its captured cwd', async t => {
  const runtime = filesRuntime();
  let view, work, restoreDraft = () => {}, settlement;
  const settle = () => settlement ??= (async () => {
    // Independently attempt both domains even if one reports a failure.
    const results = await Promise.allSettled([runtime.settle(), work?.settle()]);
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'navigation/Files domain joins');
  })();
  t.after(async () => {
    const errors = [];
    const attempt = async fn => { try { await fn(); } catch (error) { errors.push(error); } };
    try {
      await attempt(() => view?.unmount()); await attempt(settle);
      await attempt(() => runtime.dispose(async () => {}, () => view?.dispose()));
    } finally { await attempt(restoreDraft); }
    if (errors.length) throw new AggregateError(errors, 'workspace bridge cleanup');
  });
  const style = fileURLToPath(new URL('../lib/testing/style.fixture.mjs', import.meta.url));
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true,
    alias: { './file-workspace.css': style, [fileURLToPath(new URL('./file-workspace.css', import.meta.url))]: style } });
  const { NavigationWorkspaceComposition, NavigationWork, FileEditSessions } = await jiti.import('./navigation-workspace.fixture.tsx');
  work = new NavigationWork();
  // Observation only: forward the actual class method, never substitute an
  // edit algorithm/store/context. Capture the instance used by the REAL editor.
  const descriptor = Object.getOwnPropertyDescriptor(FileEditSessions.prototype, 'draft');
  const admittedDrafts = [];
  restoreDraft = () => Object.defineProperty(FileEditSessions.prototype, 'draft', descriptor);
  Object.defineProperty(FileEditSessions.prototype, 'draft', { ...descriptor, value: function (...args) {
    const result = descriptor.value.apply(this, args);
    admittedDrafts.push({ store: this, viewId: args[0] }); return result;
  } });
  let current;
  const workspaceRef = createRef();
  const props = { work, workspaceRef, onWork: runtime.onWork, router: { replace() {} }, onCommit: value => { current = value; } };
  view = await mount(t, createElement(NavigationWorkspaceComposition, props), { setup: runtime.setup, beforeDispose: settle });
  const canvas = view.container.querySelector('.file-workspace-canvas');
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 });
  await runtime.notifyResize(canvas);
  const saved = session('a');
  await act(async () => { current.navigation.handleSelectSession(saved); });
  const key = JSON.stringify(['a', '/repo']);
  assert.equal(current.fileBinding.currentFileWorkspaceKey, key);
  const match = { type: 'read', path: '/repo/a.txt', sessionId: 'a', viewerCwd: '/repo' };
  const replay = runtime.expect(match), initial = runtime.expect(match);
  await act(async () => { workspaceRef.current.open({ filePath: '/repo/a.txt', label: 'a.txt', cwd: '/repo', sourceSessionId: 'a' }); });
  const edit = runtime.expect({ type: 'edit', path: '/repo/a.txt', sessionId: 'a' });
  await initial.deliver(plain('saved text', true)); await replay.deliver(plain('obsolete replay'));
  await edit.deliver({ content: 'saved text', revision: 'r1', writable: true, editIdentity: 'server-file-identity' });
  const host = view.container.querySelector('.file-workspace-view'); assert.ok(host);
  await click(view, button(view, 'Edit', host));
  const editor = host.querySelector('textarea'); assert.ok(editor);
  await inputText(view, editor, 'literal dirty text');
  const owner = admittedDrafts.at(-1); assert.ok(owner);
  assert.equal(owner.store.dirty, true); assert.equal(owner.store.snapshot(owner.viewId).draft.content, 'literal dirty text');
  assert.equal(owner.store.snapshot(owner.viewId).owner, owner.viewId);
  const identity = owner.store.identity(owner.viewId), requests = runtime.requests.length;
  const watching = [...runtime.liveSources];
  await act(async () => { current.navigation.handleCwdChange('/other', '/other', '/other'); });
  assert.equal(current.rightPanelOpen, false, 'actual cross-project callback hides Files');
  assert.equal(current.state.selectedSession, null);
  assert.equal(current.fileBinding.currentFileWorkspaceKey, JSON.stringify([null, '/other']));
  assert.equal(view.container.querySelector('.file-workspace-view') === host, true, 'dirty host remains mounted across project switch');
  assert.equal(host.querySelector('textarea') === editor, true); assert.equal(host.hidden, true);
  assert.equal(editor.value, 'literal dirty text');
  assert.equal(owner.store.dirty, true); assert.equal(owner.store.identity(owner.viewId), identity);
  assert.ok(watching.every(source => source.closed));
  await act(async () => { current.navigation.handleSelectSession(saved); });
  assert.equal(current.state.activeCwd, '/other', 'saved conversation does not borrow Sidebar checkout');
  assert.equal(current.fileBinding.fileWorkspaceKey, key, 'file binding uses saved session cwd, not independent active cwd');
  assert.equal(current.rightPanelOpen, false, 'saved-session selection leaves the separately owned outer Files panel closed');
  // Outer presentation is a declared external input to this composition. Use
  // its captured REAL React state setter, not a copied outer-control callback.
  // FileWorkspace.focus() only requests DOM focus; it does not open AppShell.
  await act(async () => { current.setRightPanelOpen(true); });
  assert.equal(current.rightPanelOpen, true, 'external outer Files presentation input applied');
  assert.equal(view.container.querySelector('[data-navigation-files-panel]').hidden, false);
  await act(async () => { workspaceRef.current.focus(); });
  assert.equal(current.rightPanelOpen, true, 'real Workspace focus preserves the already-declared outer presentation');
  assert.equal(view.container.querySelector('.file-workspace-view') === host, true);
  assert.equal(host.querySelector('textarea') === editor, true); assert.equal(host.hidden, false);
  assert.equal(editor.value, 'literal dirty text'); assert.equal(owner.store.dirty, true);
  await inputText(view, editor, 'literal dirty text after return');
  assert.equal(admittedDrafts.at(-1).store === owner.store, true, 'returned editor writes through the same actual edit-store instance');
  assert.equal(admittedDrafts.at(-1).viewId, owner.viewId);
  assert.equal(owner.store.snapshot(owner.viewId).draft.content, 'literal dirty text after return');
  assert.equal(runtime.requests.length, requests, 'return did not replace dirty reader or retarget its file requests');
  runtime.assertHealthy();
  // This mount does not prove AppShell's actual outer Files/parked-return
  // controls. Feed that explicit hold, plus native security/save/layout inputs,
  // to the parent's file-edit/markdown/history browser-reduction audit. Browser
  // reduction is a separate required task, not forbidden forever by this case.
  // No native/browser input is changed here and no PUT is dispatched.
});
