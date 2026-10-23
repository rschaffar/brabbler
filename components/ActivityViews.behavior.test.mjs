import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const { ActivityFeatureFixture } = await jiti.import('./ActivityViews.behavior.fixture.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
const session = (id, parent, project = '/alpha') => ({
  id, name: id, cwd: project, projectRoot: project, projectKey: project,
  created: '2026-01-01T00:00:00Z', modified: '2026-01-02T00:00:00Z',
  ...(parent ? { relation: { kind: 'subagent', parentSessionId: parent, profile: 'explore' } } : {}),
});
const completion = (sessionId, at = 100) => ({ sessionId, at });
const attention = (sessionId, requestId = 'question-one') => ({ sessionId, requestId, method: 'ask_user', summary: `Question for ${sessionId}`, since: 1 });
const privacy = (keys = []) => ({ keys: new Set(keys), error: false, pendingKey: null, refresh() {}, setHidden() {} });
const pause = (sessionId, parentSessionId) => ({ id: `pause-${sessionId}`, sessionId, state: 'paused', requestedAt: 1, ...(parentSessionId ? { parentSessionId } : {}) });

// Only external HTTP/time/visibility boundaries are scripted. No Activity decision
// or React callback algorithm is reproduced here; all feature wiring is production.
async function fixture(t, options = {}) {
  const timers = new Map(), listeners = new Set(), requests = [], holds = [], bodyTasks = [], failures = [];
  const selected = [], snapshots = [];
  let owner, view, closed = false, visible = true, nextTimer = 0, closeCount = 0, sounds = 0, catalogueRefreshes = 0;
  let running = { sessionListVersion: 1, completedRuns: [], reviewedRuns: [], laterRuns: [], laterRequests: [], ...options.running };
  let stars = { ids: [], projectKeys: [], ...options.stars };
  let interrupted = options.interrupted ?? [];
  let pauseReply = { status: 200, payload: {} };
  const closing = new Error('Activity feature fixture closed before body delivery');
  const hold = kind => {
    const body = deferred(), entered = deferred();
    const entry = { kind, body, entered, used: false, settled: false, jsonReturned: false,
      async deliver(payload) {
        assert.equal(entry.used, true, `${kind} request must have arrived`);
        await entered.promise;
        await act(async () => { entry.settled = true; body.resolve(payload); });
        assert.equal(entry.jsonReturned, true, 'ignored-abort JSON genuinely returned');
      },
      async reject(error) {
        await entered.promise;
        await act(async () => { entry.settled = true; body.reject(error); });
      },
    };
    holds.push(entry); return entry;
  };
  const reply = (kind, payload, init, status = 200) => {
    const held = holds.find(item => item.kind === kind && !item.used);
    if (!held) return Response.json(payload, { status });
    held.used = true; held.signal = init.signal;
    return { ok: status >= 200 && status < 300, status, json() {
      held.entered.resolve();
      const task = held.body.promise.then(value => { held.jsonReturned = true; return value; });
      void task.catch(() => {}); bodyTasks.push(task); return task;
    } };
  };
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    try {
      assert.equal(closed, false, 'no external request after fixture admission closes');
      const path = new URL(String(input), 'https://fixture.invalid/').pathname;
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ path, body, method: init.method ?? 'GET', signal: init.signal });
      if (path === '/api/agent/running') return reply('running', structuredClone(running), init);
      if (path === '/api/sessions/interrupted') return reply('journal', { interruptedSessionIds: interrupted }, init);
      if (path === '/api/activity/review') {
        assert.equal(init.method, 'POST');
        if (body.op === 'ack') running.reviewedRuns = body.entries;
        else if (body.op === 'later') running.laterRuns = body.entries;
        else if (body.op === 'later-request') running.laterRequests = body.entries;
        else assert.equal(body.op, 'import');
        return reply('review', structuredClone(running), init);
      }
      if (path === '/api/activity/pause') return reply('pause', pauseReply.payload, init, pauseReply.status);
      if (path === '/api/starred-sessions') {
        if (body?.op === 'import') stars.ids = [...new Set([...stars.ids, ...body.ids])];
        else if (body?.op === 'set') stars.ids = body.starred ? [...stars.ids, body.id] : stars.ids.filter(id => id !== body.id);
        else if (body) assert.fail(`Unexpected stars operation ${body.op}`);
        return reply('stars', structuredClone(stars), init);
      }
      assert.fail(`Unexpected request ${path}`);
    } catch (error) { failures.push(error); throw error; }
  });
  const ports = {
    request: (...args) => fetch(...args), visible: () => visible,
    schedule(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    cancel(id) { timers.delete(id); },
    listen(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    legacy: { read: () => [], clear() {} },
  };
  let props = {
    ports, sessions: options.sessions ?? [session('root')], view: 'activity', privacy: privacy(),
    onOwner(value) { owner = value; }, onSnapshot(value) { snapshots.push(value); },
    onSelect(...args) { selected.push(args); }, onClose() { closeCount++; },
    refreshCatalogue() { catalogueRefreshes++; }, onBackgroundTaskDone() { sounds++; }, ...options.props,
  };
  const element = () => createElement(I18nProvider, null, createElement(ActivityFeatureFixture, props));
  t.after(async () => {
    closed = true;
    // Keep the live collector: admission violations can arrive while joining
    // released bodies, after cleanup has already started.
    const errors = failures;
    try { await view?.unmount(); } catch (error) { errors.push(error); }
    try {
      await act(async () => {
        for (const entry of holds) if (!entry.settled) { entry.settled = true; entry.body.reject(closing); }
        await Promise.allSettled(bodyTasks);
        await owner?.dispose();
      });
    } catch (error) { errors.push(error); }
    try { assert.equal(timers.size, 0); assert.equal(listeners.size, 0); } catch (error) { errors.push(error); }
    try { await view?.dispose(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Activity feature teardown failed');
  });
  view = await mount(t, element(), { setup(window) { options.setup?.(window); } });
  await act(() => owner.whenIdle());
  return {
    get owner() { return owner; }, get view() { return view; }, get snapshot() { return owner.getSnapshot(); },
    get closeCount() { return closeCount; }, get sounds() { return sounds; }, get catalogueRefreshes() { return catalogueRefreshes; },
    requests, selected, snapshots, timers, listeners, hold,
    posts(path = '/api/activity/review') { return requests.filter(request => request.path === path && request.method === 'POST'); },
    async render(next, { join = true } = {}) { props = { ...props, ...next }; await view.rerender(element()); if (join) await act(() => owner.whenIdle()); },
    async poll(next = {}, { join = true } = {}) { running = { ...running, ...next }; await act(async () => { owner.refresh(); }); if (join) await act(() => owner.whenIdle()); },
    async visibility(next) { visible = next; await act(async () => { for (const callback of listeners) callback(); }); if (next) await act(() => owner.whenIdle()); },
    pauseReply(status, payload) { pauseReply = { status, payload }; },
    setInterrupted(ids) { interrupted = ids; },
    button(label) { const found = [...view.container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label); assert.ok(found, `Missing button ${label}`); return found; },
    row(id) { return [...view.container.querySelectorAll('button.activity-item')].find(row => row.querySelector('.activity-item-title')?.textContent === id); },
    async click(button) { await view.dispatch(button, new view.window.MouseEvent('click', { bubbles: true })); },
    async choose(selector, value) { const select = view.container.querySelector(selector); assert.ok(select); select.value = value; await view.dispatch(select, new view.window.Event('change', { bubbles: true })); return select; },
  };
}

test('StrictMode production owner and Activity/Starred consumers share one loop across panel closure and visibility', async t => {
  const f = await fixture(t, { running: { runningSessionIds: ['root'] }, stars: { ids: ['root'] } });
  assert.equal(f.posts().filter(request => request.body.op === 'import').length, 1);
  assert.equal(f.listeners.size, 1);
  assert.deepEqual([...f.timers.values()].map(timer => timer.ms), [2500]);
  const owner = f.owner;
  assert.match(f.row('root').getAttribute('aria-label'), /Working/);
  await f.render({ view: null });
  assert.equal(f.owner, owner); assert.equal(f.listeners.size, 1); assert.equal(f.timers.size, 1);
  await f.render({ view: 'starred' });
  assert.equal(f.owner, owner);
  assert.match(f.row('root').getAttribute('aria-label'), /Working/);
  await f.visibility(false); assert.equal(f.timers.size, 0);
  await f.visibility(true); assert.equal(f.timers.size, 1); assert.equal(f.listeners.size, 1);
  const held = f.hold('running');
  await act(async () => { owner.refresh(); }); await held.entered.promise;
  const before = f.snapshots.length;
  await f.view.unmount();
  assert.equal(held.signal.aborted, true);
  let settled = false;
  const disposal = owner.dispose().then(() => { settled = true; });
  await act(async () => {}); assert.equal(settled, false, 'final disposal joins complete ignored-abort body');
  await held.deliver({ sessionListVersion: 1, runningSessionIds: ['obsolete'] }); await disposal;
  assert.equal(f.snapshots.length, before); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

test('failure cleanup releases and joins a still-gated ignored-abort request before restoring the DOM and transport', async t => {
  const f = await fixture(t);
  const held = f.hold('running');
  await act(async () => { f.owner.refresh(); });
  await held.entered.promise;
  assert.equal(held.signal.aborted, false);
  assert.equal(held.jsonReturned, false);
  // Intentionally leave the body gated. The fixture must close admission,
  // unmount, reject it and join the complete controller before restoring globals.
});

test('real Read/Later events use displayed identities; replacing a question never inherits its old Later token', async t => {
  const f = await fixture(t, { sessions: [session('ready'), session('question')], running: {
    completedRuns: [completion('ready')], runningSessionIds: ['question'], attention: [attention('question')],
  } });
  await f.click(f.row('ready'));
  assert.equal(f.selected[0][0].id, 'ready'); assert.equal(f.selected[0][1], 'ready');
  assert.equal(f.posts().filter(request => request.body.op === 'ack').length, 0, 'navigation is not Read');
  await f.click(f.button('Review question later')); await act(() => f.owner.whenIdle());
  assert.deepEqual(f.posts().at(-1).body, { op: 'later-request', entries: [{ sessionId: 'question', requestId: 'question-one' }] });
  assert.match(f.row('question').getAttribute('aria-label'), /Later.*Needs you.*Open & answer/);
  assert.equal(f.row('question').parentElement.querySelector('[aria-label="Mark question as read"]'), null);
  await f.poll({ attention: [attention('question', 'question-two')] });
  assert.match(f.row('question').getAttribute('aria-label'), /Needs you/);
  assert.ok(!f.row('question').classList.contains('activity-item-later'));
  await f.click(f.button('Review ready later')); await act(() => f.owner.whenIdle());
  assert.deepEqual(f.posts().at(-1).body, { op: 'later', entries: [completion('ready')] });
  await f.click(f.button('Mark ready as read')); await act(() => f.owner.whenIdle());
  assert.deepEqual(f.posts().at(-1).body, { op: 'ack', entries: [completion('ready')] });
  assert.equal(f.row('ready'), undefined);
});

test('render-captured callbacks cannot Read or defer a newer completion or a replacement question', async t => {
  const actions = [];
  const f = await fixture(t, { sessions: [session('ready'), session('question')], props: { onActions(value) { actions.push(value); } },
    running: { completedRuns: [completion('ready')], attention: [attention('question')], runningSessionIds: ['question'] } });
  const obsolete = actions.at(-1);
  await f.poll({ completedRuns: [completion('ready', 200)], attention: [attention('question', 'replacement')] });
  const before = f.posts().length;
  await act(async () => { obsolete.markRead('ready'); obsolete.markLater('ready'); obsolete.markLater('question', 'question-one'); });
  await act(() => f.owner.whenIdle());
  assert.equal(f.posts().length, before);
  assert.ok(f.row('ready')); assert.ok(!f.row('question').classList.contains('activity-item-later'));
  await f.click(f.button('Mark ready as read')); await act(() => f.owner.whenIdle());
  assert.deepEqual(f.posts().at(-1).body, { op: 'ack', entries: [completion('ready', 200)] });
});

test('ignored-abort obsolete poll JSON cannot replace newer rendered state after catalogue/privacy rerenders', async t => {
  const f = await fixture(t, { sessions: [session('root'), session('private', undefined, '/secret')],
    props: { privacy: privacy(['/secret']) }, running: { completedRuns: [completion('root')] } });
  const old = f.hold('running');
  await act(async () => { f.owner.refresh(); }); await old.entered.promise;
  await f.render({ sessions: [session('root', undefined, '/beta'), session('private', undefined, '/secret')] }, { join: false });
  await f.poll({ completedRuns: [completion('root', 200)] }, { join: false });
  assert.equal(old.signal.aborted, true);
  assert.match(f.row('root').getAttribute('aria-label'), /beta.*Ready to review/);
  await old.deliver({ sessionListVersion: 1, runningSessionIds: ['root'], attention: [attention('root', 'obsolete-secret-request')] });
  await act(() => f.owner.whenIdle());
  assert.match(f.row('root').getAttribute('aria-label'), /beta.*Ready to review/);
  assert.doesNotMatch(f.view.container.innerHTML, /obsolete-secret-request|Question for root|>private</);
});

test('ambiguous durable Later success renders unavailable then recovers on confirmation without another POST', async t => {
  const f = await fixture(t, { running: { completedRuns: [completion('root')] } });
  const held = f.hold('review');
  await f.click(f.button('Review root later')); await held.entered.promise;
  assert.ok(f.row('root').classList.contains('activity-item-later'));
  await held.reject(new SyntaxError('Lost durable response body'));
  assert.match(f.view.container.textContent, /Live status unavailable\. Showing the last known state\./);
  const writes = f.posts().length;
  await f.poll();
  assert.equal(f.posts().length, writes, 'confirmation precedes retry admission');
  assert.ok(f.row('root').classList.contains('activity-item-later'));
  assert.doesNotMatch(f.view.container.textContent, /Live status unavailable\. Showing the last known state\./);
});

test('bulk Read dispatches only eligible ready children in the current project and drains B queued during A', async t => {
  const sessions = [session('parent'), session('a', 'parent'), session('b', 'parent'), session('live', 'parent'),
    session('question', 'parent'), session('queued', 'parent'), session('paused', 'parent'), session('interrupted', 'parent'),
    session('later', 'parent'), session('other', undefined, '/beta'), session('other-child', 'other', '/beta'),
    session('private', undefined, '/private'), session('private-child', 'private')];
  const f = await fixture(t, { sessions, interrupted: ['interrupted'], props: { privacy: privacy(['/private']) }, running: {
    completedRuns: sessions.map(item => completion(item.id)), runningSessionIds: ['live', 'question'], queuedSessionIds: ['queued'],
    attention: [attention('question')], pauses: [pause('paused', 'parent')], laterRuns: [completion('later')],
  } });
  await f.choose('#activity-project', '/alpha');
  const held = f.hold('review');
  await f.click(f.button('Mark all subagents as read')); await held.entered.promise;
  assert.deepEqual(f.posts().filter(request => request.body.op === 'ack').map(request => request.body.entries), [[completion('a')]]);
  assert.equal(f.row('a'), undefined); assert.equal(f.row('b'), undefined, 'both clicks update optimistically while A is held');
  await held.deliver({ reviewedRuns: [completion('a')], laterRuns: [] }); await act(() => f.owner.whenIdle());
  assert.deepEqual(f.posts().filter(request => request.body.op === 'ack').map(request => request.body.entries), [[completion('a')], [completion('b')]]);
  for (const id of ['parent', 'live', 'question', 'queued', 'paused', 'interrupted', 'later']) assert.ok(f.row(id), id);
  assert.equal(f.button('Mark all subagents as read').disabled, true);
  await f.choose('#activity-project', '/beta'); assert.ok(f.row('other-child'));
  assert.equal(f.posts().some(request => request.body.entries?.some(entry => ['parent', 'live', 'question', 'queued', 'paused', 'interrupted', 'later', 'other-child', 'private-child'].includes(entry.sessionId))), false);
});

test('privacy loading/failure, inherited concealment and unresolved identity remain fail closed through current-prop rerenders', async t => {
  let refreshed = 0;
  const secret = session('secret-title', undefined, '/secret-path');
  const child = session('secret-child', 'secret-title', '/other-path');
  const unresolved = { ...session('unresolved-secret', undefined, '/secret-worktree'), projectRoot: undefined, projectKey: undefined };
  const f = await fixture(t, { sessions: [secret, child, unresolved, session('public')], running: { runningSessionIds: ['secret-title', 'secret-child', 'unresolved-secret', 'public'] },
    props: { privacy: { ...privacy(), keys: null } } });
  assert.doesNotMatch(f.view.container.innerHTML, /secret-title|secret-child|secret-path|other-path|secret-worktree|unresolved-secret|>public</);
  assert.equal(f.view.container.querySelector('#activity-project').disabled, true);
  await f.render({ privacy: { ...privacy(), keys: null, error: true, refresh() { refreshed++; } } });
  await f.click(f.button('Retry')); assert.equal(refreshed, 1);
  await f.render({ privacy: privacy(['/secret-path']) });
  assert.ok(f.row('public'));
  assert.doesNotMatch(f.view.container.innerHTML, /secret-title|secret-child|secret-path|other-path|secret-worktree|unresolved-secret/);
  await f.click(f.button('Show hidden projects'));
  assert.ok(f.row('secret-title')); assert.ok(f.row('secret-child'));
  await f.choose('#activity-project', '/secret-path');
  await f.click(f.button('Conceal hidden projects'));
  assert.equal(f.view.container.querySelector('#activity-project').value, '');
  assert.doesNotMatch(f.view.container.innerHTML, /secret-title|secret-child|secret-path|other-path/);
});

test('Pause/Resume controls preserve exact IDs, pending double-submit protection, main navigation and partial/error feedback', async t => {
  const f = await fixture(t, { sessions: [session('main'), session('child', 'main'), session('working')], running: {
    pauses: [pause('main'), pause('child', 'main')], runningSessionIds: ['working'],
  } });
  assert.equal(f.view.container.querySelector('[aria-label="Resume child"]'), null);
  const child = f.row('child');
  await f.click([...child.parentElement.querySelectorAll('button')].find(button => button.textContent === 'Open main session'));
  assert.equal(f.selected.at(-1)[0].id, 'main');
  const held = f.hold('pause');
  await f.click(f.button('Resume main')); await held.entered.promise;
  assert.equal(f.button('Resume main').disabled, true);
  await f.click(f.button('Resume main'));
  assert.deepEqual(f.posts('/api/activity/pause').map(request => request.body), [{ action: 'resume', sessionId: 'main', pauseId: 'pause-main' }]);
  await held.deliver({ errors: ['one child refused'] });
  assert.match(f.view.container.querySelector('[role="alert"]').textContent, /1/);
  assert.equal(f.button('Resume main').disabled, false);
  f.pauseReply(409, { error: 'Exact pause generation changed' });
  await f.click(f.button('Resume main'));
  assert.match(f.view.container.querySelector('[role="alert"]').textContent, /Exact pause generation changed/);
  assert.equal(f.posts('/api/activity/pause').length, 2, 'refusal is not silently retried');
});

test('global native control intents do not substitute the rendered project/privacy filter as server scope', async t => {
  const f = await fixture(t, { sessions: [session('public'), session('secret', undefined, '/secret')],
    props: { privacy: privacy(['/secret']) }, running: { runningSessionIds: ['public', 'secret'], pauses: [pause('secret')] } });
  await f.choose('#activity-project', '/alpha');
  await f.click(f.button('Pause all'));
  await f.click(f.button('Resume all'));
  assert.deepEqual(f.posts('/api/activity/pause').map(request => request.body), [{ action: 'pause-all' }, { action: 'resume-all' }]);
  assert.equal(f.row('secret'), undefined);
});

test('actual Starred owner imports legacy IDs, shares status, filters and unstars without acknowledging navigation', async t => {
  const f = await fixture(t, { sessions: [session('root'), session('legacy', undefined, '/beta')],
    props: { view: 'starred' }, stars: { ids: ['root'] }, running: { completedRuns: [completion('root')] },
    setup(window) { window.localStorage.setItem('pi-web:starred-sessions', JSON.stringify(['legacy'])); } });
  assert.equal(f.view.window.localStorage.getItem('pi-web:starred-sessions'), null);
  assert.deepEqual(f.posts('/api/starred-sessions').map(request => request.body), [{ op: 'import', ids: ['legacy'] }]);
  assert.ok(f.row('legacy')); assert.match(f.row('root').getAttribute('aria-label'), /Ready to review/);
  await f.click(f.row('root'));
  assert.equal(f.posts().filter(request => request.body.op === 'ack').length, 0);
  const filter = await f.choose('#starred-project', '/alpha');
  assert.equal(f.row('legacy'), undefined);
  await f.click(f.button('Unstar session'));
  assert.deepEqual(f.posts('/api/starred-sessions').at(-1).body, { op: 'set', id: 'root', starred: false });
  assert.equal(filter.value, '/alpha', 'an emptied filter remains selected instead of silently widening');
  assert.equal(f.row('root'), undefined);
  await f.render({ view: 'activity' });
  assert.ok(f.row('root'), 'unstarring is not Read and cannot remove its Activity completion');
});

test('journal demand stays separate from running polling and ignored-abort old bodies cannot revive a hidden view', async t => {
  const f = await fixture(t, { props: { hidden: true } });
  const journalCount = () => f.requests.filter(request => request.path === '/api/sessions/interrupted').length;
  assert.equal(journalCount(), 0);
  await f.poll(); assert.equal(journalCount(), 0);
  const old = f.hold('journal');
  // Do not join all controller work: the journal belongs to the demand-scoped view.
  await f.render({ hidden: false }); await old.entered.promise;
  await f.render({ hidden: true }); assert.equal(old.signal.aborted, true);
  await f.render({ hidden: false });
  await old.deliver({ interruptedSessionIds: ['root'] });
  assert.equal(f.row('root'), undefined, 'obsolete interrupted history must not publish after a newer activation');
  assert.equal(journalCount(), 2);
});

test('actual Sidebar notification adapter excludes selected, suppressed, child, paused and acknowledged completions', async t => {
  const sessions = [session('selected'), session('background'), session('child', 'selected'), session('suppressed'), session('paused'), session('reviewed')];
  const ids = sessions.map(item => item.id);
  const f = await fixture(t, { sessions, props: { selectedId: 'selected' }, running: {
    runningSessionIds: ids, completionNotificationSuppressedSessionIds: ['suppressed'],
    completedRuns: [completion('paused', 10)],
  } });
  await f.poll({ runningSessionIds: [], completedRuns: [completion('selected'), completion('child'), completion('suppressed'), completion('paused', 10), completion('reviewed')],
    reviewedRuns: [completion('reviewed')], pauses: [pause('paused')] });
  assert.equal(f.sounds, 0, 'Pause must not turn its older unread completion into a new completion sound');
  assert.equal(f.catalogueRefreshes, 1, 'settled background work refreshes metadata even when silent');
  await f.poll({ runningSessionIds: ['background'], pauses: [] });
  await f.poll({ runningSessionIds: [], completedRuns: [completion('background', 200)] });
  assert.equal(f.sounds, 1, 'one actual unreviewed background completion notification');
  assert.equal(f.catalogueRefreshes, 2);
  await f.poll(); await f.render({ sessions: [...sessions] });
  assert.equal(f.sounds, 1, 'unchanged polling/catalogue rerenders cannot replay a completion sound');
  await f.poll({ runningSessionIds: ['unlisted'] });
  assert.equal(f.catalogueRefreshes, 3, 'new running IDs demand external catalogue hydration');
  assert.equal(f.posts().some(request => request.body.op !== 'import'), false, 'notifications never acknowledge work');
});

test('rerendered navigation and close callbacks remain current without marking Ready as Read', async t => {
  const f = await fixture(t, { running: { completedRuns: [completion('root')] } });
  const calls = [];
  await f.render({ onSelect: (...args) => calls.push(args), onClose: () => calls.push('closed') });
  await f.click(f.row('root')); await f.click(f.button('Close Activity'));
  assert.equal(f.selected.length, 0); assert.equal(f.closeCount, 0);
  assert.equal(calls[0][0].id, 'root'); assert.equal(calls[0][1], 'ready'); assert.equal(calls[1], 'closed');
  assert.ok(f.row('root'));
  assert.equal(f.posts().filter(request => request.body.op === 'ack').length, 0);
});
