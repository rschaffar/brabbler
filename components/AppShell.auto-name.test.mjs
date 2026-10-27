import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { click, button, exact } from './navigation-runtime.fixture.mjs';
import { shellHarness, session } from './navigation-cases.fixture.mjs';

test('actual auto-name button admits compacted persisted history and trims acknowledged title', async t => {
  const h = await shellHarness(t, { route(request) {
    exact(request, '/api/sessions/a/auto-name', {}, { method: 'POST' }); return undefined;
  } });
  await h.select(session('a', '/repo', { messageCount: 7 }));
  await h.command(c => c.setSessionStats({ sessionId: 'a', userMessages: 0 }));
  assert.equal(button(h.view, 'Generate title').disabled, false);
  await click(h.view, button(h.view, 'Generate title'));
  assert.equal(button(h.view, 'Generating...').disabled, true);
  const request = h.latest('/api/sessions/a/auto-name', 'POST');
  await h.reply(request, { title: '  saved title  ' }); await h.settled();
  assert.equal(h.current.state.selectedSession.name, 'saved title');
  assert.equal(h.current.stats.sessionName, 'saved title');
  assert.equal(h.current.naming.autoNameStatus.kind, 'success');
  await h.fire(1800);
  assert.equal(h.current.naming.autoNameStatus.kind, 'idle');
});

test('transient and truly empty sessions refuse the real control; server hydration clears transient before naming', async t => {
  const h = await shellHarness(t, { route(request) {
    exact(request, '/api/sessions', { compact: '1' }, { cache: 'no-store' }); return { sessions: [session('a', '/repo', { messageCount: 3 })] };
  } });
  await h.select(session('a', '/repo', { transient: true, messageCount: 3 }));
  assert.equal(button(h.view, 'Generate title').disabled, true);
  await click(h.view, button(h.view, 'Generate title'));
  assert.equal(h.requests.length, 0);
  await h.command(c => c.navigation.handleSessionSettled());
  await h.settled();
  assert.equal(h.current.state.selectedSession.transient, false);
  assert.equal(button(h.view, 'Generate title').disabled, false);
  await h.select(session('empty', '/repo', { messageCount: 0 }));
  assert.equal(button(h.view, 'Generate title').disabled, true);
  await h.command(c => c.setSessionStats({ sessionId: 'empty', userMessages: 1 }));
  assert.equal(button(h.view, 'Generate title').disabled, false);
});

test('obsolete name success and HTTP error do not replace a different active session; current failure remains visible', async t => {
  const h = await shellHarness(t, { route(request) {
    const id = request.url.pathname.split('/')[3];
    assert.ok(['a', 'b'].includes(id)); exact(request, `/api/sessions/${id}/auto-name`, {}, { method: 'POST' }); return undefined;
  } });
  await h.select(session('a')); await click(h.view, button(h.view, 'Generate title'));
  const old = h.latest('/api/sessions/a/auto-name', 'POST');
  await h.select(session('b')); await click(h.view, button(h.view, 'Generate title'));
  const current = h.latest('/api/sessions/b/auto-name', 'POST');
  await h.reply(old, { title: 'obsolete title' });
  assert.equal(h.current.state.selectedSession.id, 'b');
  assert.notEqual(h.current.state.selectedSession.name, 'obsolete title');
  assert.equal(h.current.naming.autoNameStatus.kind, 'naming');
  await h.reply(current, { error: 'controlled naming refusal' }, 409); await h.settled();
  assert.deepEqual(h.current.naming.autoNameStatus, { kind: 'error', message: 'controlled naming refusal' });
  await h.fire(5000); assert.equal(h.current.naming.autoNameStatus.kind, 'idle');
});
