import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { scratchpadFixture, SCRATCHPAD_PROJECT_A as RICH, SCRATCHPAD_PROJECT_B as OTHER } from './scratchpad-panel.fixture.mjs';

// Canonical project IDs are scripted metadata inputs, not a copied resolver.
// ED and ES retain the original literal note corpus while scope changes to project.
const ED = 'scratch-en-desktop', ES = 'scratch-en-mobile-short';
const R0 = '0'.repeat(64), R1 = '1'.repeat(64), R2 = '2'.repeat(64), R3 = '3'.repeat(64);
const R4 = '4'.repeat(64), R5 = '5'.repeat(64), R6 = '6'.repeat(64), R7 = '7'.repeat(64);
// Controlled external wire revisions ONLY. Never filesystem/revision authority.
const note = (text, revision) => ({ text, revision });
const key = scope => `pi-web:scratchpad:${JSON.stringify(scope === null ? null : { projectId: scope })}`;
const draft = (f, scope) => {
  const raw = f.snapshotStorage().find(([name]) => name === key(scope))?.[1];
  return raw === undefined ? null : JSON.parse(raw);
};
async function replyReads(f, mark, global, local) {
  const reads = f.pendingOperationsSince(mark);
  assert.equal(reads.length, 2, 'two held original reads at this render boundary; Strict noops are not ports');
  // HTTP delivery without a handle is explicitly nonterminal. Supply BOTH read
  // bodies, then join the selected original reads, not an act/body idle surrogate.
  await f.reply(f.next('GET', null), global);
  await f.reply(f.next('GET', RICH), local);
  for (const read of reads) await f.joinOperation(read);
}
async function load(f, global, local) {
  f.read(null); f.read(RICH);
  const mark = f.markOperations();
  await f.render();
  await replyReads(f, mark, global, local);
}
async function editSaved(f, scope, projectId, text, revision, acknowledged) {
  f.save(projectId, text, revision);
  const mark = f.markOperations();
  await f.input(scope, text);
  assert.equal(f.editor(scope).value, text, 'actual editor receives the original literal input');
  const writer = f.onePendingOperation(mark, 'explicit editor change');
  await f.reply(f.next('PUT', projectId), note(text, acknowledged), 200, { operation: writer });
  assert.equal(f.status(scope), 'Saved to server');
}
async function select(f, projectId, text, revision, projectCwd = f.projectCwd(projectId)) {
  f.read(projectId);
  const mark = f.markOperations();
  await f.rerender({ projectCwd });
  const read = f.onePendingOperation(mark, 'selected-project refresh');
  await f.reply(f.next('GET', projectId), note(text, revision), 200, { operation: read });
}

test('NT-buttons: actual Global Undo/Redo after reopen preserve the original project note', async t => {
  const f = await scratchpadFixture(t);
  await load(f, note('', R0), note('', R0));
  await editSaved(f, 'Global', null, ED, R0, R1);
  await editSaved(f, 'Project', RICH, `${ED}-session`, R0, R2);
  await editSaved(f, 'Global', null, `${ED} xyz`, R1, R3);
  await f.rerender({ open: false });
  f.read(null); f.read(RICH);
  const reopened = f.markOperations();
  await f.rerender({ open: true });
  await replyReads(f, reopened, note(`${ED} xyz`, R3), note(`${ED}-session`, R2));
  f.save(null, ED, R3);
  const undo = f.markOperations();
  await f.click('Undo Global notes');
  assert.equal(f.editor().value, ED, 'NT-buttons: Undo Global button routes to actual global history');
  assert.equal(f.editor('Project').value, `${ED}-session`, 'Undo never touches the other scope');
  await f.reply(f.next('PUT', null), note(ED, R4), 200, { operation: f.onePendingOperation(undo, 'Undo button writer') });
  f.save(null, `${ED} xyz`, R4);
  const redo = f.markOperations();
  await f.click('Redo Global notes');
  assert.equal(f.editor().value, `${ED} xyz`, 'NT-buttons: Redo Global button restores the original xyz input');
  assert.equal(f.editor('Project').value, `${ED}-session`);
  await f.reply(f.next('PUT', null), note(`${ED} xyz`, R5), 200, { operation: f.onePendingOperation(redo, 'Redo button writer') });
  await f.complete();
});

test('NT-scope: OTHER is independent, global is shared, and switching back restores current project', async t => {
  const f = await scratchpadFixture(t);
  await load(f, note(`${ED} xyz`, R1), note(`${ED}-session`, R2));
  assert.equal(f.editor('Project').disabled, false, 'selected project works without any saved-chat prop');
  await editSaved(f, 'Project', RICH, `${ED}-project edit`, R2, R6);
  await select(f, RICH, `${ED}-project edit`, R6, '/worktrees/rich');
  assert.equal(f.button('Undo Project notes').disabled, false, 'same canonical project retains history across checkout changes');
  f.save(RICH, `${ED}-session`, R6);
  const projectUndo = f.markOperations();
  await f.click('Undo Project notes');
  await f.reply(f.next('PUT', RICH), note(`${ED}-session`, R2), 200, { operation: f.onePendingOperation(projectUndo, 'shared project Undo') });
  assert.equal(f.button('Redo Project notes').disabled, false);
  await select(f, OTHER, '', R0);
  assert.equal(f.editor().value, `${ED} xyz`, 'NT-scope: OTHER retains global notes');
  assert.equal(f.editor('Project').value, '', 'OTHER starts with its own server note');
  await editSaved(f, 'Project', OTHER, `${ED}-other`, R0, R3);
  await select(f, RICH, `${ED}-session`, R2);
  assert.equal(f.editor('Project').value, `${ED}-session`, 'NT-scope: switchback restores original project note');
  assert.equal(f.button('Redo Project notes').disabled, false, 'A/B/A preserves the original project history');
  assert.equal(f.editor().value, `${ED} xyz`);
  await select(f, OTHER, `${ED}-other`, R3);
  assert.equal(f.editor('Project').value, `${ED}-other`);
  await f.complete();
});

test('NT-project-metadata: obsolete success/error bodies after A/B/A cannot replace the current project context', async t => {
  for (const oldStatus of [200, 400]) {
    const f = await scratchpadFixture(t, { projects: {
      '/projects/rich': { projectId: RICH, root: '/projects/rich', hold: true },
      '/projects/other': { projectId: OTHER, root: '/projects/other' },
    } });
    f.read(null); await f.render();
    await f.reply(f.next('GET', null), note('global', R0));
    const obsolete = f.projectRequests('/projects/rich');
    assert.equal(obsolete.length > 0, true, 'original A metadata request entered');
    for (const request of obsolete) await f.headers(request, oldStatus);
    f.read(OTHER); await f.rerender({ projectCwd: '/projects/other' });
    await f.reply(f.next('GET', OTHER), note('project B', R1));
    f.read(RICH); await f.rerender({ projectCwd: '/projects/rich' });
    const current = f.projectRequests('/projects/rich').filter(request => !obsolete.includes(request));
    assert.equal(current.length > 0, true, 'new A metadata request entered independently');
    for (const request of current) await f.reply(request, { projectId: RICH, root: '/projects/rich/current' });
    await f.reply(f.next('GET', RICH), note('current project A', R2));
    for (const request of obsolete) await f.body(request, { projectId: RICH, root: '/projects/rich/obsolete' });
    assert.equal(f.editor('Project')?.value, 'current project A', 'obsolete metadata error cannot hide the current project editor');
    assert.equal(f.section('Project').querySelector('p[title]')?.getAttribute('title'), '/projects/rich/current', 'obsolete metadata success cannot replace current project context');
    await f.complete(); await f.dispose();
  }
});

test('NT-no-project: Global stays editable while no folder is selected; selecting a folder needs no chat', async t => {
  const f = await scratchpadFixture(t);
  f.read(null); await f.render({ projectCwd: null });
  await f.reply(f.next('GET', null), note('global', R0));
  assert.equal(f.editor('Project'), null);
  assert.equal(f.status('Project'), 'Select a project to keep notes shared across its chats.');
  f.read(RICH); await f.rerender({ projectCwd: '/projects/rich' });
  await f.reply(f.next('GET', RICH), note('', R0));
  await editSaved(f, 'Project', RICH, 'folder before chat', R0, R1);
  assert.equal(f.editor().value, 'global');
  await f.complete();
});

test('NT-project-retry: a current metadata refusal leaves Global available and retries the selected project without a chat', async t => {
  const f = await scratchpadFixture(t, { projects: {
    '/projects/rich': { projectId: RICH, root: '/projects/rich', hold: true },
  } });
  f.read(null); await f.render();
  await f.reply(f.next('GET', null), note('global remains', R0));
  const refused = f.projectRequests('/projects/rich');
  for (const request of refused) await f.reply(request, { error: 'unavailable' }, 400);
  assert.equal(f.editor('Project'), null);
  assert.equal(f.section('Project').querySelector('[role="alert"]').textContent, 'Could not resolve this project. Your notes are retained; select an available folder or retry.');
  assert.equal(f.editor().value, 'global remains');
  f.read(RICH); await f.click('Retry');
  const retried = f.projectRequests('/projects/rich').filter(request => !refused.includes(request));
  assert.equal(retried.length > 0, true);
  for (const request of retried) await f.reply(request, { projectId: RICH, root: '/projects/rich' });
  await f.reply(f.next('GET', RICH), note('', R0));
  await editSaved(f, 'Project', RICH, 'after explicit retry', R0, R1);
  assert.equal(f.editor().value, 'global remains');
  await f.complete();
});

test('NT-currentness: original short-input OTHER save completes after switchback without replacing current draft', async t => {
  const f = await scratchpadFixture(t);
  // The original ES context follows ED's persisted local/global/OTHER story.
  await load(f, note(`${ED}-local`, R1), note(`${ED}-session`, R2));
  await editSaved(f, 'Global', null, ES, R1, R3);
  await editSaved(f, 'Project', RICH, `${ES}-session`, R2, R4);
  await editSaved(f, 'Global', null, `${ES} xyz`, R3, R7);
  await select(f, OTHER, `${ED}-other`, R5);
  f.save(OTHER, `${ES}-other`, R5);
  const otherEdit = f.markOperations();
  await f.input('Project', `${ES}-other`);
  const otherWriter = f.onePendingOperation(otherEdit, 'OTHER save before switching');
  const held = f.next('PUT', OTHER);
  await f.headers(held); // Accepted original write/body continues while unobserved.
  await select(f, RICH, `${ES}-session`, R4);
  assert.equal(f.editor('Project').value, `${ES}-session`);
  await f.body(held, note(`${ES}-other`, R6), { operation: otherWriter });
  assert.equal(f.editor('Project').value, `${ES}-session`, 'NT-currentness: obsolete OTHER completion cannot replace current text');
  assert.equal(f.editor().value, `${ES} xyz`);
  assert.equal(f.status('Project'), 'Saved to server');
  await select(f, OTHER, `${ES}-other`, R6);
  assert.equal(f.editor('Project').value, `${ES}-other`);
  await select(f, RICH, `${ES}-session`, R4);
  await f.complete();
});

test('NT-conflict-reload: focused stale409 retains mine, reload recovers it, Save my version uses current revision, history resets', async t => {
  const f = await scratchpadFixture(t);
  await load(f, note(`${ED} xyz`, R3), note(`${ED}-session`, R2));
  await f.focus();
  const focused = f.editor();
  // Independent HTTP client uses the actual default production transport too.
  // Its external replies are scripted, not a fake route/revision algorithm.
  f.read(null);
  const priorWork = f.peer(() => f.transport.read(null));
  await f.reply(f.next('GET', null), note(`${ED} xyz`, R3), 200, { operation: f.operationFor(priorWork) });
  const prior = await priorWork;
  f.save(null, `${ED}-external`, prior.revision);
  const externalWork = f.peer(() => f.transport.save(null, `${ED}-external`, prior.revision));
  await f.reply(f.next('PUT', null), note(`${ED}-external`, R4), 200, { operation: f.operationFor(externalWork) });
  assert.equal((await externalWork).text, `${ED}-external`);
  f.save(null, `${ED}-local`, prior.revision);
  const staleEdit = f.markOperations();
  await f.input('Global', `${ED}-local`);
  const staleWriter = f.onePendingOperation(staleEdit, 'focused stale writer');
  const stale = f.next('PUT', null);
  assert.equal(stale.payload.revision, prior.revision, 'focused client still writes its original read revision');
  await f.headers(stale, 409);
  assert.equal(f.editor().value, `${ED}-local`, 'mine remains while the actual409 body is held');
  assert.deepEqual(draft(f, null), note(`${ED}-local`, R3), 'recovery is written immediately, before refusal JSON');
  await f.body(stale, { current: note(`${ED}-external`, R4) }, { operation: staleWriter });
  assert.equal(stale.status, 409);
  assert.equal(f.status(), 'Changed in another browser');
  assert.equal(f.editor().value, `${ED}-local`, 'NT-conflict: focused local mine survives409 instead of remote overwrite');
  assert.equal(f.view.window.document.activeElement === focused, true, 'focused editor survives conflict publication');
  assert.equal(f.section('Global').querySelector('pre').textContent, `${ED}-external`);
  assert.equal(f.editor('Project').value, `${ED}-session`);
  const recovery = f.snapshotStorage();
  await f.complete(); await f.dispose();

  const recovered = await scratchpadFixture(t, { storage: recovery });
  recovered.read(null); recovered.read(RICH);
  const recoveryReads = recovered.markOperations();
  await recovered.render();
  assert.equal(recovered.editor().value, `${ED}-local`, 'NT-recovery: original same-tab recovery bytes survive new panel/controller');
  await replyReads(recovered, recoveryReads, note(`${ED}-external`, R4), note(`${ED}-session`, R2));
  assert.equal(recovered.status(), 'Changed in another browser');
  assert.equal(recovered.editor().value, `${ED}-local`, 'NT-recovery: remote reload cannot replace recovered mine');
  assert.equal(recovered.requests.filter(request => request.method === 'PUT').length, 0, 'recovery does not automatically overwrite remote');
  recovered.save(null, `${ED}-local`, R4);
  const resolveEdit = recovered.markOperations();
  await recovered.click('Save my version');
  const resolution = recovered.next('PUT', null);
  assert.equal(resolution.payload.revision, R4, 'NT-resolution: explicit Save my version uses returned current revision');
  await recovered.reply(resolution, note(`${ED}-local`, R5), 200, { operation: recovered.onePendingOperation(resolveEdit, 'explicit recovered resolution') });
  assert.equal(recovered.status(), 'Saved to server');
  assert.equal(draft(recovered, null), null, 'only acknowledged current text clears recovery');
  const cleanStorage = recovered.snapshotStorage();
  await recovered.complete(); await recovered.dispose();

  const reloaded = await scratchpadFixture(t, { storage: cleanStorage });
  await load(reloaded, note(`${ED}-local`, R5), note(`${ED}-session`, R2));
  assert.equal(reloaded.editor().value, `${ED}-local`);
  assert.equal(reloaded.editor('Project').value, `${ED}-session`);
  for (const name of ['Undo Global notes', 'Redo Global notes', 'Undo Project notes', 'Redo Project notes']) {
    assert.equal(reloaded.button(name).disabled, true, `NT-history-reset: ${name} unavailable after reload`);
  }
  await reloaded.complete();
});

test('NT-short-recovery: actual pending short-input draft recovers stale and a second409 requires the next current revision', async t => {
  const f = await scratchpadFixture(t);
  await load(f, note(`${ES} xyz`, R1), note(`${ES}-session`, R2));
  f.save(null, `${ES}-local`, R1);
  await f.input('Global', `${ES}-local`);
  const recovery = f.snapshotStorage();
  assert.deepEqual(draft(f, null), note(`${ES}-local`, R1));
  // No fake saved success: teardown releases the admitted pending HTTP as an
  // operational rejection and joins its real catch/finally before realm close.
  await f.dispose();
  const r = await scratchpadFixture(t, { storage: recovery });
  await load(r, note(`${ES}-external`, R3), note(`${ES}-session`, R2));
  assert.equal(r.editor().value, `${ES}-local`);
  assert.equal(r.status(), 'Changed in another browser');
  r.save(null, `${ES}-local`, R3);
  const firstResolve = r.markOperations();
  await r.click('Save my version');
  await r.reply(r.next('PUT', null), { current: note(`${ES} xyz`, R4) }, 409, { operation: r.onePendingOperation(firstResolve, 'short first resolution') });
  assert.equal(r.editor().value, `${ES}-local`, 'NT-short-recovery: another conflict still preserves original local mine');
  assert.equal(r.status(), 'Changed in another browser');
  r.save(null, `${ES}-local`, R4);
  const nextResolve = r.markOperations();
  await r.click('Save my version');
  await r.reply(r.next('PUT', null), note(`${ES}-local`, R5), 200, { operation: r.onePendingOperation(nextResolve, 'short next-revision resolution') });
  assert.equal(r.status(), 'Saved to server');
  assert.equal(r.editor('Project').value, `${ES}-session`);
  await r.complete();
});

test('NT-visibility: actual subscriptions refresh clean notes only when visible, clear external history, and leave no listener on unmount', async t => {
  const f = await scratchpadFixture(t);
  await load(f, note(ED, R1), note(`${ED}-session`, R2));
  await editSaved(f, 'Global', null, `${ED} xyz`, R1, R3);
  assert.equal(f.button('Undo Global notes').disabled, false);
  const count = f.requests.length;
  await f.visibility(false);
  await f.storageEvent(key(null), JSON.stringify(note(`${ED}-external`, R4)));
  assert.equal(f.requests.length, count, 'no hidden refresh or invented storage-event refetch');
  assert.equal(f.editor().value, `${ED} xyz`);
  f.read(null); f.read(RICH);
  const visibleMark = f.markOperations();
  await f.visibility(true);
  const visibleReads = f.pendingOperationsSince(visibleMark);
  assert.equal(visibleReads.length, 2, 'two actual visible read operations');
  const global = f.next('GET', null), local = f.next('GET', RICH);
  await f.headers(global);
  await f.reply(local, note(`${ED}-session`, R2));
  assert.equal(f.editor().value, `${ED} xyz`, 'header-only completion is not read completion');
  await f.body(global, note(`${ED}-external`, R4));
  for (const read of visibleReads) await f.joinOperation(read);
  assert.equal(f.editor().value, `${ED}-external`);
  assert.equal(f.button('Undo Global notes').disabled, true, 'external text is not an undo step');
  assert.equal(f.button('Redo Global notes').disabled, true);
  const refreshed = f.requests.length;
  await f.rerender({ onWork: work => f.onWork(work) });
  assert.equal(f.requests.length, refreshed, 'observer-only rerender adds no effect/refetch');
  await f.view.unmount();
  assert.equal(f.subscriptions, 0);
  f.view.window.dispatchEvent(new f.view.window.Event('focus'));
  f.view.window.document.dispatchEvent(new f.view.window.Event('visibilitychange'));
  assert.equal(f.requests.length, refreshed, 'actual cleanup removes both refresh subscriptions');
  await f.complete();
});

test('NT-teardown: held write/body, read/body and independent peer/header all release before original-work joins', async t => {
  // A: a SUCCESSFUL coalescing loop owns two PUTs in the SAME original writer.
  const a = await scratchpadFixture(t);
  await load(a, note(ED, R1), note(`${ED}-session`, R2));
  a.save(null, `${ED} xyz`, R1);
  const firstEdit = a.markOperations();
  await a.input('Global', `${ED} xyz`);
  const writer = a.onePendingOperation(firstEdit, 'first coalescing writer');
  const first = a.next('PUT', null);
  await a.headers(first);
  assert.equal(writer.settled, false, 'original writer waits for first ACK');
  const newerEdit = a.markOperations();
  await a.input('Global', `${ED}-local`);
  assert.deepEqual(draft(a, null), note(`${ED}-local`, R1));
  const noop = a.operationsSince(newerEdit);
  assert.equal(noop.length, 1, 'new edit observes only its separate saving-guard noop');
  assert.equal(noop[0].settled, true);
  assert.equal(noop[0].promise === writer.promise, false, 'noop is not the original writer');
  assert.equal(a.requests.filter(request => request.method === 'PUT').length, 1, 'no concurrent second writer');
  a.save(null, `${ED}-local`, R3);
  const firstAck = a.markOperations();
  // Intentionally nonterminal: joining writer here would block second delivery.
  await a.body(first, note(`${ED} xyz`, R3));
  const second = a.next('PUT', null);
  assert.deepEqual(second.payload, { sessionId: null, text: `${ED}-local`, revision: R3 }, 'second actual PUT uses newer intent and first ACK revision');
  assert.equal(a.operationsSince(firstAck).length, 0, 'coalesced second PUT needs no new operation observation');
  assert.equal(writer.settled, false, 'SAME original writer remains pending at second PUT');
  assert.equal(a.requests.filter(request => request.method === 'PUT').length, 2, 'exactly two serial PUTs, no replay');
  await a.reply(second, note(`${ED}-local`, R4), 200, { operation: writer });
  assert.equal(writer.settled, true, 'SAME original writer joined after second ACK');
  assert.equal(a.editor().value, `${ED}-local`);
  assert.equal(a.status(), 'Saved to server');
  assert.equal(draft(a, null), null, 'successful latest ACK removes recovery');
  await a.complete(); await a.dispose();

  // B1: retain the original held-write/read/peer failure path and exact literals.
  // These recovery bytes come from the REAL controller, including its final persist.
  const f = await scratchpadFixture(t);
  await load(f, note(ED, R1), note(`${ED}-session`, R2));
  f.save(null, `${ED} xyz`, R1);
  const heldEdit = f.markOperations();
  await f.input('Global', `${ED} xyz`);
  const heldWriter = f.onePendingOperation(heldEdit, 'pending recovery source writer');
  const saving = f.next('PUT', null);
  await f.headers(saving);
  // New typing coalesces behind the admitted real write, with no debounce clock.
  await f.input('Global', `${ED}-local`);
  assert.deepEqual(draft(f, null), note(`${ED}-local`, R1));
  const recovery = f.snapshotStorage();
  f.read(RICH);
  const heldRefresh = f.markOperations();
  await f.visibility(true); // Saving global skips refresh; clean local really reads.
  const heldRead = f.onePendingOperation(heldRefresh, 'held clean-session refresh');
  await f.headers(f.next('GET', RICH));
  f.read(OTHER);
  const peer = f.peer(() => f.transport.read({ projectId: OTHER }));
  await f.dispose();
  const [result] = await Promise.allSettled([peer]);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason.message, 'owned Scratchpad HTTP shutdown');
  assert.equal(f.requests.every(request => request.headersSent && request.bodySent), true, 'every accepted header/body peer released');
  assert.equal(f.subscriptions, 0);
  assert.equal(f.phases.indexOf('release-all') < f.phases.indexOf('original-work-joined-in-realm'), true);
  assert.equal(f.phases.indexOf('original-work-joined-in-realm') < f.phases.indexOf('host-restored'), true);
  assert.equal(heldWriter.settled && heldRead.settled, true, 'original held operations really settled');
  assert.deepEqual(f.terminalStorage, recovery, 'source catch/finally retains the actual newer recovery bytes');

  // B2: same revision + DIFFERENT old server text enters a real nested drain,
  // not the conflict/noop branch used by the other reload cases.
  const r = await scratchpadFixture(t, { storage: f.terminalStorage });
  r.read(null); r.read(RICH);
  const renderMark = r.markOperations();
  await r.render();
  const reads = r.pendingOperationsSince(renderMark);
  assert.equal(reads.length, 2, 'held original reads in Global/current editor render order');
  const [globalRead, localRead] = reads;
  await r.reply(r.next('GET', RICH), note(`${ED}-session`, R2), 200, { operation: localRead });
  assert.equal(globalRead.settled, false, 'Global read is still held independently');
  r.save(null, `${ED}-local`, R1);
  const readTail = r.markOperations();
  await r.reply(r.next('GET', null), note(ED, R1), 200, { operation: globalRead });
  const nested = r.onePendingOperation(readTail, 'actual same-revision recovery drain');
  const nestedPUT = r.next('PUT', null);
  assert.deepEqual(nestedPUT.payload, { sessionId: null, text: `${ED}-local`, revision: R1 });
  assert.equal(r.editor().value, `${ED}-local`);
  assert.equal(r.status(), 'Saving…', 'same revision recovery starts saving, not conflict');
  assert.equal(globalRead.settled, true, 'baseline refresh does NOT await drain');
  assert.equal(nested.promise === globalRead.promise, false, 'nested drain has a separately observed ORIGINAL handle');
  assert.equal(nested.settled, false, 'actual nested write remains pending after read settles');
  await r.headers(nestedPUT); // Actual JSON consumer entered; body stays held.
  assert.equal(nestedPUT.jsonCalls, 1);
  assert.equal(nested.settled, false);
  await r.dispose();
  assert.equal(nested.settled, true, 'nested original catch/finally joined before realm restoration');
  assert.equal(r.terminalObserved, true, 'bounded observed join, NOT a future-idle certificate');
  assert.deepEqual(JSON.parse(r.terminalStorage.find(([name]) => name === key(null))[1]), note(`${ED}-local`, R1), 'nested final persist is observed while realm is live');
  assert.equal(r.requests.every(request => request.headersSent && request.bodySent), true);
  assert.equal(r.subscriptions, 0);
  assert.equal(r.phases.indexOf('release-all') < r.phases.indexOf('original-work-joined-in-realm'), true);
  assert.equal(r.phases.indexOf('original-work-joined-in-realm') < r.phases.indexOf('host-restored'), true);
});

test('NT-setup-failure: earliest disposer releases ALL independent HTTP peers even before graph/view escape', async t => {
  const primary = new Error('intentional Scratchpad external setup failure');
  const jobs = [];
  let trace, requests;
  const contains = error => error === primary || (error instanceof AggregateError && error.errors.some(contains));
  await assert.rejects(scratchpadFixture(t, {
    plans: [{ method: 'GET', projectId: null }, { method: 'GET', projectId: OTHER }],
    setup(window, domain) {
      trace = domain.phases; requests = domain.requests;
      for (const query of ['', `?projectId=${OTHER}`]) {
        jobs.push(domain.peer(async () => {
          const response = await window.fetch(`/api/scratchpad${query}`, { cache: 'no-store' });
          return response.json();
        }));
      }
      throw primary;
    },
  }), contains);
  const settled = await Promise.allSettled(jobs);
  assert.deepEqual(settled.map(result => result.status), ['rejected', 'rejected']);
  assert.deepEqual(settled.map(result => result.reason.message), ['owned Scratchpad HTTP shutdown', 'owned Scratchpad HTTP shutdown']);
  assert.equal(requests.every(request => request.headersSent && request.bodySent), true);
  assert.equal(trace.indexOf('release-all') < trace.indexOf('original-work-joined-in-realm'), true);
  assert.equal(trace.indexOf('original-work-joined-in-realm') < trace.indexOf('host-restored'), true);
});
