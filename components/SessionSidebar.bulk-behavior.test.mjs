import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { button, click, exact, select, inputText } from './browser-lower-runtime.fixture.mjs';
import { sidebar, session, IDS, ROOT, DEST } from './browser-lower-cases.fixture.mjs';

const row = (h, id) => { const value = [...h.view.container.querySelectorAll('[data-session-id]')].find(node => node.dataset.sessionId === id); assert.ok(value, `real family ${id}`); return value; };
const checkbox = (h, id) => row(h, id).querySelector('input[type="checkbox"]');
const bulk = h => button(h.view, 'Done').parentElement.nextElementSibling;
const checks = h => [...h.view.container.querySelectorAll('[data-session-id] input[type="checkbox"]')];
const bulkButton = (h, label) => button(h.view, label, bulk(h));
async function optIn(h) { await click(h.view, button(h.view, 'Select')); assert.equal(checks(h).length, 2); }

test('actual Sidebar two-family 409/200 archive keeps only failure selected, retries only failure, invalidates old catalogue, restores and confirmation-deletes', async t => {
  const writes = []; let holdCatalogue = false;
  const h = await sidebar(t, { override(r) {
    if (r.url.pathname === '/api/sessions' && holdCatalogue) return { handled: true, data: undefined };
    if (IDS.some(id => r.url.pathname === `/api/sessions/${id}`)) {
      writes.push(r);
      const deleting = r.options.method === 'DELETE';
      exact(r, r.url.pathname, {}, deleting ? { method: 'DELETE' } : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: { archived: writes.length < 4 } });
      return { handled: true, data: undefined };
    }
  } });
  assert.equal(checks(h).length, 0, 'checkboxes require opt-in'); await optIn(h);
  assert.equal(bulkButton(h, 'Archive').disabled, true);
  await click(h.view, checkbox(h, IDS[0])); await click(h.view, checkbox(h, IDS[1]));
  holdCatalogue = true;
  await h.command(c => c.navigation.handleSessionSettled());
  const oldReads = h.requests.filter(r => r.url.pathname === '/api/sessions' && !r.returned);
  for (const r of oldReads) await h.headers(r);
  await click(h.view, bulkButton(h, 'Archive'));
  assert.equal(writes.length, 1, 'per-family mutations are sequential');
  assert.equal(bulkButton(h, 'Archive').disabled, true);
  assert.equal(checkbox(h, IDS[0]).disabled, true);
  await h.reply(writes[0], {}, 409);
  assert.equal(writes.length, 2); assert.equal(writes[1].url.pathname, `/api/sessions/${IDS[1]}`);
  await h.reply(writes[1], {}, 200);
  assert.equal(checkbox(h, IDS[0]).checked, true);
  assert.equal(h.view.container.querySelector(`[data-session-id="${IDS[1]}"]`) === null, true);
  const canonical = [session(IDS[0]), session(IDS[1], ROOT, { archived: true })];
  const current = h.latest('/api/sessions'); assert.equal(oldReads.includes(current), false);
  await h.reply(current, { sessions: canonical, sessionListVersion: 2 });
  for (const old of oldReads) await h.body(old, { sessions: IDS.map(id => session(id)), sessionListVersion: 1 });
  await h.idle();
  assert.equal(h.view.container.querySelector(`[data-session-id="${IDS[1]}"]`) === null, true, 'obsolete JSON cannot undo accepted mutation');
  assert.match(bulk(h).textContent, /1 failed, 1 succeeded/);
  assert.equal(checkbox(h, IDS[0]).checked, true);
  await click(h.view, bulkButton(h, 'Archive'));
  assert.equal(writes.length, 3); assert.equal(writes[2].url.pathname, `/api/sessions/${IDS[0]}`);
  await h.reply(writes[2], {});
  const archived = IDS.map(id => session(id, ROOT, { archived: true }));
  h.setCatalogue(archived); holdCatalogue = false;
  await h.reply(h.latest('/api/sessions'), { sessions: archived, sessionListVersion: 3 }); await h.idle();
  assert.equal(checks(h).length, 0, 'all-success exits selection');
  await click(h.view, button(h.view, 'Archived sessions')); await optIn(h);
  await click(h.view, bulkButton(h, 'Select all'));
  assert.equal(checks(h).filter(node => node.checked).length, 2);
  await click(h.view, bulkButton(h, 'Clear selection'));
  assert.equal(checks(h).filter(node => node.checked).length, 0);
  holdCatalogue = true;
  await click(h.view, bulkButton(h, 'Select all')); await click(h.view, bulkButton(h, 'Restore'));
  await h.reply(writes[3], {}); await h.reply(writes[4], {});
  h.setCatalogue(IDS.map(id => session(id))); holdCatalogue = false;
  await h.reply(h.latest('/api/sessions'), { sessions: IDS.map(id => session(id)), sessionListVersion: 4 }); await h.idle();
  // The archive filter is still active, even though both canonical families restored.
  await click(h.view, button(h.view, 'Active sessions')); await optIn(h);
  await click(h.view, checkbox(h, IDS[0]));
  await click(h.view, bulkButton(h, 'Delete')); assert.equal(writes.length, 5, 'proposal is not consent');
  assert.match(bulk(h).textContent, /Permanently delete selected sessions \(1\)/);
  await click(h.view, bulkButton(h, 'Cancel')); assert.equal(writes.length, 5);
  assert.equal(checkbox(h, IDS[0]).checked, true);
  await click(h.view, bulkButton(h, 'Delete')); await click(h.view, bulkButton(h, 'Delete'));
  assert.equal(writes.length, 6); assert.equal(writes[5].url.pathname, `/api/sessions/${IDS[0]}`);
  h.setCatalogue([session(IDS[1])]); await h.reply(writes[5], {}); await h.idle();
  assert.equal(h.view.container.querySelector(`[data-session-id="${IDS[0]}"]`) === null, true);
  assert.ok(row(h, IDS[1])); assert.equal(checks(h).length, 0);
});

test('actual Sidebar archive/search/worktree/project scope transitions clear selection and pending delete consent', async t => {
  const inventory = { projectRoot: ROOT, mainCwd: ROOT, worktrees: [
    { path: ROOT, branch: 'main', isMain: true, state: 'present', sessionCount: 1, archivedCount: 0 },
    { path: DEST, branch: 'literal', isMain: false, state: 'missing', sessionCount: 1, archivedCount: 0 },
  ] };
  const h = await sidebar(t, { initial: [session(IDS[0]), session(IDS[1], DEST, { cwdState: 'missing' })], inventory,
    extraCwds: ['/another-project'], listings: path => ({ projectRoot: path === '/another-project' ? path : ROOT,
      projectKey: path === '/another-project' ? path : ROOT, isGit: true, isTopLevel: true, currentWorktreePath: path,
      worktrees: [{ path: ROOT, branch: 'main', isMain: true }, { path: DEST, branch: 'literal', isMain: false }], localBranches: [] }) });
  const enter = async () => {
    await click(h.view, button(h.view, 'Select')); assert.equal(checks(h).length, 2);
    await click(h.view, checkbox(h, IDS[0])); await click(h.view, bulkButton(h, 'Delete'));
  };
  await enter(); await click(h.view, button(h.view, 'Archived sessions'));
  assert.equal(checks(h).length, 0); await click(h.view, button(h.view, 'Active sessions')); await optIn(h);
  assert.equal(checks(h).some(node => node.checked), false); assert.equal(bulk(h).textContent.includes('Permanently delete'), false);
  await click(h.view, button(h.view, 'Done'));
  await enter(); await click(h.view, button(h.view, 'Search conversations'));
  // Opening an empty search is not an active result scope. Verify the exact
  // selected family/consent before entering the nonblank query that resets it.
  assert.equal(checks(h).length, 2);
  assert.equal(checkbox(h, IDS[0]).checked, true); assert.equal(checkbox(h, IDS[1]).checked, false);
  assert.match(bulk(h).textContent, /Permanently delete selected sessions \(1\)/);
  const search = h.view.container.querySelector('#session-search-input'); assert.ok(search);
  await inputText(h.view, search, 'scope-reset-sentinel');
  assert.equal(checks(h).length, 0); assert.equal(h.timerCount(300), 1);
  // Restore ordinary rows before checking reset, so hidden search children
  // alone cannot make the no-checkbox oracle pass. No search HTTP is admitted.
  await inputText(h.view, search, '');
  assert.equal(h.timerCount(300), 0); assert.equal(checks(h).length, 0);
  assert.equal(h.view.container.textContent.includes('Permanently delete selected sessions'), false);
  await click(h.view, button(h.view, 'Search conversations'));
  await optIn(h);
  assert.equal(checkbox(h, IDS[0]).checked, false); assert.equal(checkbox(h, IDS[1]).checked, false);
  await click(h.view, button(h.view, 'Done'));
  await enter(); await select(h.view, h.view.container.querySelector('#session-worktree-filter'), DEST);
  assert.equal(checks(h).length, 0);
  await select(h.view, h.view.container.querySelector('#session-worktree-filter'), '');
  await optIn(h); assert.equal(checks(h).some(node => node.checked), false); await click(h.view, button(h.view, 'Done'));
  await enter(); await h.command(c => c.navigation.handleSidebarSelectSession(session('scope-navigation-only', '/another-project', { projectRoot: '/another-project', projectKey: '/another-project' })));
  await h.idle(); assert.equal(checks(h).length, 0, 'project switch clears mode, selection and consent');
  await h.command(c => c.navigation.handleSidebarSelectSession(session(IDS[0]))); await h.idle();
  await optIn(h); assert.equal(checks(h).some(node => node.checked), false);
  assert.equal(bulk(h).textContent.includes('Permanently delete'), false);
  assert.equal(h.requests.some(r => r.options.method === 'DELETE'), false);
});
