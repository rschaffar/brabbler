import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { workspace, measurable } from './file-workspace-harness.fixture.mjs';
import { read, denied, editable, click, type, button, expectRead, expectEdit } from './file-viewer-harness.fixture.mjs';

// Intentionally retained shell/terminal composition. Child mounts below are NOT
// AppShell/router/PTY proof; the complete installed Files/terminal chains stay.
test('shell delegates to one retained workspace independently of terminal hosts', async () => {
  const shell = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
  assert.equal(shell.match(/<FileWorkspace /g)?.length, 1);
  assert.doesNotMatch(shell, /<FileViewer/);
  assert.match(shell, /terminalTabs\.map\(\(tab\) => \(/);
  assert.match(shell, /active=\{rightPanelOpen && tab\.id === activeFileTabId\}/);
});
const origin = { filePath: '/root/docs/guide.md', label: 'guide.md', cwd: '/root', sourceSessionId: 'origin-session' };
const hostFor = (view, path) => [...view.container.querySelectorAll('.file-workspace-view')].find(host => host.querySelector(`[title="${path}"]`));
async function load(h, location, content, hint = denied, language = 'text') {
  const replay = expectRead(h.runtime, location), current = expectRead(h.runtime, location);
  await h.open(location);
  const edit = hint.edit ? expectEdit(h.runtime, location) : null;
  await current.deliver(read(content, hint, language)); await replay.deliver(read('obsolete'));
  return edit;
}
async function menu(h, link) {
  await h.view.dispatch(link, new h.view.window.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  assert.equal(link.getAttribute('aria-expanded'), 'true');
  return link.closest('.local-file-link').querySelector('[role="toolbar"]');
}

test('real file link menu forwards disposition plus range/page and frozen cwd/session to actual destination viewers', async t => {
  const h = await workspace(t), markdown = '[chapter](chapter.txt#L2-L3)\n\n[pdf](../manual.pdf#page=3)';
  await load(h, origin, markdown, denied, 'markdown');
  await h.render({ mentionCwd: '/different-selected-checkout' });
  const guide = hostFor(h.view, origin.filePath);
  const link = label => [...guide.querySelectorAll('a')].find(node => node.textContent === label);
  const chapter = { filePath: '/root/docs/chapter.txt', cwd: origin.cwd, sourceSessionId: origin.sourceSessionId };
  const chapterReads = [expectRead(h.runtime, chapter), expectRead(h.runtime, chapter)];
  let toolbar = await menu(h, link('chapter'));
  await click(h.view, toolbar.querySelector('[aria-label="Open once in new pane right"]'));
  assert.equal(h.view.container.querySelectorAll('[data-file-pane]').length, 2, 'fourth argument creates a sibling, not Here');
  await chapterReads[1].deliver(read('one\ntwo\nthree')); await chapterReads[0].deliver(read('obsolete'));
  assert.equal(hostFor(h.view, origin.filePath) === guide, true);
  const target = hostFor(h.view, chapter.filePath), pane = target.querySelector('.file-viewer-content');
  measurable(pane); await h.runtime.notifyResize(pane);
  assert.deepEqual([...target.querySelectorAll('[data-file-line-target]')].map(node => node.dataset.lineNumber), ['2', '3']);
  assert.equal(target.hidden, false);
  toolbar = await menu(h, link('pdf'));
  const destination = [...toolbar.querySelectorAll('button')].find(node => node.textContent.startsWith('Open in Pane 2'));
  assert.equal(Boolean(destination), true, 'actual More pane choice');
  const pdf = { filePath: '/root/manual.pdf', sourceSessionId: origin.sourceSessionId };
  const meta = [h.runtime.expect({ type: 'meta', path: pdf.filePath, sessionId: pdf.sourceSessionId }), h.runtime.expect({ type: 'meta', path: pdf.filePath, sessionId: pdf.sourceSessionId })];
  await click(h.view, destination);
  await meta[1].deliver({ size: 30 }); await meta[0].deliver({ size: 1 });
  const pdfHost = [...h.view.container.querySelectorAll('.file-workspace-view')].find(host => host.querySelector('iframe'));
  const frame = pdfHost.querySelector('iframe'), url = new URL(frame.getAttribute('src'), 'https://fixture.invalid');
  assert.equal(url.pathname, '/api/files/root/manual.pdf');
  assert.equal(url.searchParams.get('sessionId'), origin.sourceSessionId); assert.equal(url.hash, '#page=3');
  assert.equal(hostFor(h.view, origin.filePath) === guide, true);
  h.runtime.assertHealthy();
});

for (const status of [200, 409]) test(`parked real Save ${status} retains its owner, blocks close, and releases one queued command only at settlement`, async t => {
  const h = await workspace(t);
  const file = { filePath: '/root/a.txt', label: 'a.txt', cwd: '/root', sourceSessionId: 'writer-session' };
  const edit = await load(h, file, 'A\nold', editable);
  await edit.deliver({ content: 'A\nold', revision: 'r1', writable: true, editIdentity: 'file-owner' });
  const owner = hostFor(h.view, file.filePath), pane = owner.querySelector('.file-viewer-content');
  measurable(pane); await h.runtime.notifyResize(pane);
  await click(h.view, button(owner, 'Edit'));
  const field = owner.querySelector('textarea'); await type(h.view, field, 'B\nnew');
  const unload = new h.view.window.Event('beforeunload', { cancelable: true });
  await h.view.dispatch(h.view.window, unload); assert.equal(unload.defaultPrevented, true);
  const save = h.runtime.expect({ type: 'save', path: file.filePath, sessionId: file.sourceSessionId,
    body: { content: 'B\nnew', expectedRevision: 'r1', expectedEditIdentity: 'file-owner' } });
  await click(h.view, button(owner, 'Save')); await save.headers();
  const close = [...h.view.container.querySelectorAll('[role="tab"] button')].find(node => node.getAttribute('aria-label').startsWith('Close a.txt'));
  assert.equal(close.disabled, true);
  await click(h.view, close);
  await h.open({ ...file, lineTarget: { line: 2 }, modeHint: 'source' });
  assert.equal(owner.querySelector('textarea') === field, true, 'queued line cannot remove the admitted writer');
  // Parking within one tab group is independent of parking its whole workspace.
  await load(h, { ...file, filePath: '/root/other.txt', label: 'other.txt' }, 'other tab');
  assert.equal(owner.hidden, true);
  assert.equal(owner.querySelector('textarea') === field, true, 'inactive saving tab retains its actual editor');
  const ownerTab = [...h.view.container.querySelectorAll('[role="tab"]')].find(node => node.getAttribute('aria-controls') === owner.id);
  assert.equal(Boolean(ownerTab), true);
  await click(h.view, ownerTab);
  assert.equal(owner.hidden, false);
  assert.equal(owner.querySelector('textarea') === field, true);
  assert.equal(owner.querySelector('[data-file-line-target]') === null, true);
  await h.render({ workspaceKey: 'B' });
  assert.equal(owner.hidden, true); assert.equal(owner.hasAttribute('inert'), true);
  assert.equal(owner.querySelector('textarea') === field, true); assert.equal(field.readOnly, false);
  assert.equal(h.runtime.liveSources.length, 0);
  const selector = h.view.container.querySelector('[aria-label="Unsaved editors"]');
  assert.equal(Boolean(selector), true);
  const duplicateEdit = await load(h, file, 'A\nold', editable);
  await duplicateEdit.deliver({ content: 'A\nold', revision: 'r1', writable: true, editIdentity: 'file-owner' });
  const duplicate = [...h.view.container.querySelectorAll('.file-workspace-view')].find(host => !host.hidden);
  assert.equal(duplicate.querySelector('textarea') === null, true);
  await click(h.view, button(duplicate, 'Go to editor'));
  assert.equal(h.focused.at(-1), 'A', 'foreign owner requests its original workspace, not a chat/session replacement');
  await h.render({ workspaceKey: 'A' });
  assert.equal(hostFor(h.view, file.filePath) === owner, true);
  assert.equal(owner.querySelector('textarea') === field, true);
  assert.equal(owner.querySelector('[data-file-line-target]') === null, true, 'still queued while PUT body is held');
  const after = status === 200 ? expectRead(h.runtime, file) : null;
  await save.deliver(status === 200 ? { revision: 'r2' } : { error: 'revision conflict' }, { status });
  if (after) await after.deliver(read('B\nnew', editable));
  assert.equal(owner.querySelector('textarea') === null, true, 'settlement, not unmount, applies the queued saved-line command');
  assert.equal(owner.querySelector('[data-file-line-target]')?.dataset.lineNumber, '2');
  const settledClose = [...h.view.container.querySelectorAll('[role="tab"]')]
    .find(node => node.getAttribute('aria-controls') === owner.id).querySelector('button');
  assert.equal(settledClose.disabled, false);
  const count = h.runtime.requests.length;
  pane.scrollTop = 123; await h.runtime.notifyResize(pane);
  assert.equal(pane.scrollTop, 123, 'queued command is not reapplied by a layout notification');
  assert.equal(h.runtime.requests.length, count);
  if (status === 409) {
    assert.match(owner.textContent, /changed|conflict/i);
    await click(h.view, button(owner, 'Edit'));
    assert.equal(owner.querySelector('textarea').value, 'B\nnew', 'failure retains the original unsaved draft');
  }
  h.runtime.assertHealthy();
});

test('parked Markdown lifetime rejects an obsolete workspace link event and the actual unsaved-editor selector recovers it', async t => {
  const h = await workspace(t), markdown = '[next](next.txt#L2)';
  const edit = await load(h, origin, markdown, editable, 'markdown');
  await edit.deliver({ content: markdown, revision: 'r1', writable: true, editIdentity: 'guide-owner' });
  const owner = hostFor(h.view, origin.filePath);
  await click(h.view, button(owner, 'Edit')); await type(h.view, owner.querySelector('textarea'), markdown + '\n\ndraft');
  await click(h.view, button(owner, 'Edit'));
  const link = owner.querySelector('.markdown-file-preview a'); await menu(h, link);
  await h.render({ workspaceKey: 'B' });
  assert.equal(owner.hidden, true); assert.equal(link.getAttribute('aria-expanded'), 'false', 'context change dismisses old menu');
  const count = h.runtime.requests.length;
  // Intentionally retained hidden DOM event, not a claim of browser accessibility.
  await click(h.view, link);
  assert.equal(h.runtime.requests.length, count, 'origin workspace cannot mutate the current workspace');
  assert.equal(h.statuses.at(-1).count, 0);
  const selector = h.view.container.querySelector('[aria-label="Unsaved editors"]');
  selector.value = selector.options[1].value;
  await h.view.dispatch(selector, new h.view.window.Event('change', { bubbles: true }));
  assert.equal(h.focused.at(-1), 'A');
  await h.render({ workspaceKey: 'A' });
  assert.equal(hostFor(h.view, origin.filePath) === owner, true);
  await click(h.view, button(owner, 'Edit'));
  assert.equal(owner.querySelector('textarea').value, markdown + '\n\ndraft');
});
