import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, createRef } from 'react';
import { composerFixture, click } from './composer.fixture.mjs';

for (const answer of [false, true]) test(`actual completed turn starts process details ${answer ? 'collapsed with an answer' : 'expanded without an answer'}`, async t => {
  const messages = [{ role: 'user', content: 'question' }, { role: 'assistant', content: [
    { type: 'thinking', thinking: 'reasoning proof' }, ...(answer ? [{ type: 'text', text: 'final answer' }] : []),
  ] }];
  const f = composerFixture(t), c = await f.chat({ messages, entryIds: ['user', 'assistant'] });
  const button = [...c.view.container.querySelectorAll('button[aria-expanded]')].find(node => node.textContent.includes('Process details'));
  assert.ok(button); assert.equal(button.getAttribute('aria-expanded'), String(!answer));
  await click(c.view, button); assert.equal(button.getAttribute('aria-expanded'), String(answer));
  await click(c.view, button); assert.equal(button.getAttribute('aria-expanded'), String(!answer));
  assert.equal(c.view.container.textContent.includes('final answer'), answer);
});

for (const busy of ['idle', 'prompt', 'bash', 'compaction']) test(`actual first-user branch controls keep independent Fork available during ${busy}`, async t => {
  const forks = [], f = composerFixture(t), c = await f.chat({ messages: [{ role: 'user', content: 'first user prompt' }], entryIds: ['first-entry'],
    agentRunning: busy === 'prompt', bashRunning: busy === 'bash', isCompacting: busy === 'compaction',
    handleFork: id => forks.push(id), handleNavigate: async () => true });
  const first = c.view.container.querySelector('[data-entry-id="first-entry"]'); assert.ok(first);
  const fork = [...first.querySelectorAll('button')].find(node => node.textContent.trim() === 'New session'); assert.ok(fork);
  assert.equal(fork.disabled, false); await click(c.view, fork); assert.deepEqual(forks, ['first-entry']);
  const edit = [...first.querySelectorAll('button')].find(node => node.textContent.includes('Edit from here'));
  assert.equal(Boolean(edit), busy === 'idle' || busy === 'compaction');
  if (edit) { await click(c.view, edit); await f.frame(); assert.equal(c.view.container.querySelector('textarea').value, 'first user prompt'); }
  await c.update({ forkingEntryId: 'first-entry' }); assert.equal(fork.disabled, true);
  await c.update({ isNew: true }); assert.equal([...first.querySelectorAll('button')].some(node => node.textContent.trim() === 'New session'), false);
});

test('actual phase presentation withholds an empty phase and shows latest tool progress or pending Bash', async t => {
  const f = composerFixture(t), c = await f.chat({ agentRunning: true, agentPhase: null });
  const phase = () => c.view.container.querySelector('[class*="pulse_1.5s"]')?.textContent ?? '';
  assert.equal(phase(), '');
  await c.update({ agentPhase: { kind: 'running_tools', tools: [] } }); assert.equal(phase().includes('Running tool'), true);
  await c.update({ agentPhase: { kind: 'running_tools', tools: [{ name: 'read', progress: 'older progress' }, { name: 'bash', progress: 'latest progress' }] } });
  assert.equal(phase().includes('latest progress'), true); assert.equal(phase().includes('older progress'), false);
  await c.update({ agentRunning: false, agentPhase: null, bashRunning: true, pendingBash: null }); assert.equal(phase().includes('Running command'), true);
  await c.update({ pendingBash: { command: 'echo exact-pending-bash', excludeFromContext: true } });
  assert.equal(c.view.container.textContent.includes('echo exact-pending-bash'), true);
  assert.equal(phase(), '');
});

test('actual streaming store publishes committed content/current follow callback and merges live Bash results by exact ID', async t => {
  const followed = [], current = [], f = composerFixture(t), c = await f.chat({ agentRunning: true, followLiveOutput: () => { followed.push('commit'); } });
  const store = c.state.streamingStore;
  await act(async () => store.dispatch({ type: 'snapshot', message: { role: 'assistant', content: [
    { type: 'toolCall', toolCallId: 'live-bash-proof', toolName: 'bash', input: { command: 'echo scoped' } }, { type: 'text', text: 'streamed answer' },
  ] } }));
  assert.equal(c.view.container.textContent.includes('streamed answer'), true); assert.equal(followed.length > 0, true);
  const baseline = followed.length, row = c.view.container.querySelector('[data-tool-call-id="live-bash-proof"]'); assert.ok(row);
  const expand = row.querySelector('button[aria-expanded]'); if (expand.getAttribute('aria-expanded') === 'false') await click(c.view, expand);
  await c.update({ activeToolResults: new Map([['live-bash-proof', { role: 'toolResult', toolCallId: 'live-bash-proof', content: [{ type: 'text', text: 'live partial output' }] }]]) });
  assert.equal(row.textContent.includes('live partial output'), true); assert.equal(followed.length, baseline, 'metadata-only render does not claim a new streamed-message commit');
  await c.update({ followLiveOutput: () => { current.push('commit'); } }); const currentBaseline = current.length;
  await act(async () => store.dispatch({ type: 'delta', event: { type: 'text_delta', contentIndex: 1, delta: ' 世界' } }));
  assert.equal(c.view.container.textContent.includes('streamed answer 世界'), true); assert.equal(current.length, currentBaseline + 1); assert.equal(followed.length, baseline);
  await c.update({ messages: [{ role: 'toolResult', toolCallId: 'live-bash-proof', content: [{ type: 'text', text: 'committed Bash output' }] }], entryIds: ['saved-result'] });
  assert.equal(row.textContent.includes('committed Bash output'), true); assert.equal(row.textContent.includes('live partial output'), false);
});

test('actual extension-dialog adapter sounds each ID once, uses current playback and suppresses subagent dialogs', async t => {
  const first = [], current = [], f = composerFixture(t);
  const request = { type: 'extension_ui_request', method: 'confirm', id: 'dialog-one', title: 'Confirm exact request', message: 'test message' };
  const c = await f.chat({ extensionDialog: request }, { playDoneSound: () => first.push('sound') });
  assert.deepEqual(first, ['sound'], 'Strict replay does not duplicate one dialog');
  await c.update({ extensionDialog: { ...request, title: 'same ID, new render' } }, { playDoneSound: () => current.push('sound') });
  assert.deepEqual(current, []);
  await c.update({ extensionDialog: { ...request, id: 'dialog-two' } }); assert.deepEqual(current, ['sound']);
  await c.update({ extensionDialog: { ...request, id: 'child-dialog' } }, { session: { id: 'child', cwd: '', relation: { kind: 'subagent' } } });
  assert.deepEqual(current, ['sound']);
});

test('actual completion adapter respects current enabled/session/callback state while retaining completion notification', async t => {
  const f = composerFixture(t), p = await f.load(), api = createRef(), first = [], current = [], ended = [];
  let props = { session: null, enabled: true, play: () => first.push('tone'), end: () => ended.push('old'), api };
  const element = () => createElement(p.CompletionProbe, props);
  const view = await f.mount(element()); await act(async () => api.current()); assert.deepEqual(first, ['tone']);
  props = { ...props, play: () => current.push('tone'), end: () => ended.push('current') }; await view.rerender(element());
  await act(async () => api.current()); assert.deepEqual(current, ['tone']); assert.deepEqual(ended, ['old', 'current']);
  props = { ...props, enabled: false }; await view.rerender(element()); await act(async () => api.current()); assert.equal(current.length, 1);
  props = { ...props, enabled: true, session: { id: 'child', cwd: '', relation: { kind: 'subagent' } } }; await view.rerender(element());
  await act(async () => api.current()); assert.equal(current.length, 1); assert.equal(ended.length, 4);
});

function readingMessages() {
  const timestamp = Date.parse('2026-08-23T00:00:00.000Z');
  // The original message() seed supplies this even on the call assistant.
  const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  return [
    { role: 'user', content: 'Render **E2E markdown**', timestamp },
    { role: 'assistant', timestamp, usage: zeroUsage, content: [
      { type: 'thinking', thinking: '' },
      { type: 'thinking', thinking: 'E2E intermediate reasoning', deferred: true },
      { type: 'text', text: 'E2E process paragraph.\n\n'.repeat(20) },
      { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'echo E2E tool output' } },
    ] },
    { role: 'toolResult', toolCallId: 't1', toolName: 'bash', isError: false, timestamp,
      content: [{ type: 'text', text: 'E2E tool output' }] },
    { role: 'assistant', timestamp, provider: 'test', model: 'E2E Model',
      usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, cost: { total: 0.0123 } }, content: [
        { type: 'thinking', thinking: '' },
        { type: 'thinking', thinking: 'E2E follow-up reasoning', deferred: true },
        { type: 'text', text: 'E2E process note' },
        { type: 'thinking', thinking: 'E2E final reasoning', deferred: true },
        { type: 'text', text: 'E2E final answer' },
      ] },
  ];
}
const readingEntryIds = ['user', 'call', 'result', 'answer'];
const processButton = view => [...view.container.querySelectorAll('button[aria-expanded]')]
  .find(node => node.textContent.includes('Process details'));
async function disposeReading(f, failures) {
  try { await f.dispose(); } catch (error) { failures.push(error); }
  try { assert.equal(f.http.requests.length, 0, 'no HTTP admissions through timestamp teardown'); }
  catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Reading case and teardown failed');
}

test('actual ChatWindow timestamps ignore all four original browser locale and stored-locale tuples after split-final expansion', async t => {
  const inputs = [
    { id: 'en-desktop', width: 1280, height: 800, locale: 'en-US', piLocale: null, hasTouch: false, isMobile: false },
    { id: 'en-mobile-tall', width: 390, height: 844, locale: 'en-US', piLocale: null, hasTouch: true, isMobile: true },
    { id: 'legacy-desktop', width: 1280, height: 800, locale: 'zh-CN', piLocale: 'zh-CN', hasTouch: false, isMobile: false },
    { id: 'legacy-mobile', width: 390, height: 844, locale: 'zh-TW', piLocale: 'zh-TW', hasTouch: true, isMobile: true },
  ];
  for (const input of inputs) {
    // The real clock is untouched. Only the default-locale external port varies;
    // omitted locale must behave as in the original Chinese browser, not host en.
    const f = composerFixture(t, { mobile: input.isMobile, setup(window) {
      assert.equal(window.Date === Date, true, 'the production and realm Date share the owned default-locale port');
      f.replace(window, 'innerWidth', input.width); f.replace(window, 'innerHeight', input.height);
      f.replace(window.navigator, 'language', input.locale); f.replace(window.navigator, 'languages', [input.locale]);
      f.replace(window.navigator, 'maxTouchPoints', input.hasTouch ? 1 : 0);
      if (input.piLocale === null) window.localStorage.removeItem('pi-locale');
      else window.localStorage.setItem('pi-locale', input.piLocale);
    } });
    for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
      const native = Date.prototype[name];
      f.replace(Date.prototype, name, function(locales, options) { return native.call(this, locales ?? input.locale, options); });
    }
    const failures = [];
    try {
      // Exercise the existing production normalizer, not a test copy or a
      // raw-session/default-loader claim. Deferred previews are public inputs;
      // normalization must preserve their timestamp-relevant stored prefix.
      const { normalizeToolCalls } = await f.jiti.import('../lib/normalize.ts');
      const raw = readingMessages(), messages = raw.map(normalizeToolCalls);
      assert.equal(messages[1].usage === raw[1].usage, true, 'zero seed usage survives actual normalization');
      assert.deepEqual(messages[1].usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
      assert.deepEqual(messages[1].content[3], { type: 'toolCall', toolCallId: 't1', toolName: 'bash', input: { command: 'echo E2E tool output' } });
      for (const index of [1, 3]) {
        assert.equal(messages[index].timestamp, Date.parse('2026-08-23T00:00:00.000Z'));
        assert.equal(messages[index].content[0] === raw[index].content[0], true);
        assert.equal(messages[index].content[1] === raw[index].content[1], true);
        assert.equal(messages[index].content[1].deferred, true);
      }
      assert.equal(messages[3].content[3] === raw[3].content[3], true);
      assert.equal(messages[3].content[3].deferred, true);
      assert.equal(messages[3].usage === raw[3].usage, true);
      const c = await f.chat({ messages, entryIds: readingEntryIds });
      assert.deepEqual([c.view.window.innerWidth, c.view.window.innerHeight, navigator.language, navigator.maxTouchPoints > 0,
        c.view.window.localStorage.getItem('pi-locale'), c.view.window.matchMedia('(max-width: 640px)').matches],
      [input.width, input.height, input.locale, input.hasTouch, input.piLocale, input.isMobile], input.id);
      const timestamp = '2026-08-23T00:00:00.000Z', date = new Date(timestamp), now = new Date();
      const time = date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      const day = date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
      const visible = date.toDateString() === now.toDateString() ? time : `${day} ${time}`;
      const times = () => [...c.view.container.querySelectorAll('[data-message-role="assistant"] time')];
      const check = node => {
        assert.equal(node.getAttribute('datetime'), timestamp, input.id);
        assert.equal(node.textContent, visible, input.id); assert.equal(node.getAttribute('title'), date.toLocaleString('en'), input.id);
      };
      assert.equal(times().length, 1, input.id); check(times()[0]);
      assert.equal(times()[0].previousElementSibling?.textContent, '100 in · 20 out · 30 cache R · $0.0123', input.id);
      assert.equal(times()[0].nextElementSibling?.getAttribute('title'), 'Copy message', input.id);
      const process = processButton(c.view); assert.ok(process); assert.equal(process.getAttribute('aria-expanded'), 'false');
      await click(c.view, process); assert.equal(times().length, 2, input.id);
      for (const entry of ['call', 'answer']) {
        const canonicalTimes = c.view.container.querySelectorAll(`[data-message-role="assistant"][data-entry-id="${entry}"] time`);
        assert.equal(canonicalTimes.length, 1, `${input.id}:${entry}`); check(canonicalTimes[0]);
      }
      assert.equal(f.http.requests.length, 0, 'Process expansion never expands deferred thinking in this timestamp case');
      await click(c.view, process); assert.equal(times().length, 1); check(times()[0]);
    } catch (error) { failures.push(error); }
    finally { await disposeReading(f, failures); }
  }
});

test('actual composer partial setup preserves the primary and realm descriptors, completes manual plus registered cleanup, and permits the next realm', async t => {
  const primary = new Error('Expected partial composer setup failure');
  const registered = [], hostDate = Object.getOwnPropertyDescriptor(Date.prototype, 'toLocaleString'), hostConsole = console.error;
  let f, realmNavigator, realmLanguage, finalized = false;
  const finish = async () => {
    if (finalized) return;
    const failures = [];
    try { await f?.dispose(); } catch (error) { failures.push(error); }
    for (const hook of registered) {
      try { await hook(); } catch (error) { failures.push(error); }
    }
    finalized = true;
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Partial composer independent cleanup failed');
  };
  t.after(finish); // Registered before capability installation or imports.
  f = composerFixture({ after: hook => registered.push(hook) }, { setup(window) {
    realmNavigator = window.navigator;
    realmLanguage = Object.getOwnPropertyDescriptor(realmNavigator, 'language');
    f.replace(realmNavigator, 'language', 'partial-setup-locale');
    throw primary;
  } });
  const native = hostDate.value;
  const delegated = function(...args) { return native.apply(this, args); };
  f.replace(Date.prototype, 'toLocaleString', delegated);
  await assert.rejects(f.chat(), error => error === primary, 'the same original setup error must escape');
  assert.ok(realmNavigator);
  assert.deepEqual(Object.getOwnPropertyDescriptor(realmNavigator, 'language'), realmLanguage);
  assert.equal(Date.prototype.toLocaleString === delegated, true, 'host descriptor remains owned until outer cleanup');
  assert.equal(registered.length, 1);
  await finish(); // Manual disposal AND the original registered hook both complete.
  assert.deepEqual(Object.getOwnPropertyDescriptor(Date.prototype, 'toLocaleString'), hostDate);
  assert.equal(console.error === hostConsole, true);
  const next = composerFixture(t);
  const c = await next.chat({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'next realm ready' }] }], entryIds: ['next-entry'] });
  assert.equal(c.view.container.textContent.includes('next realm ready'), true);
  await next.dispose();
  assert.equal(next.http.requests.length, 0);
});

import { exactQuery as exactThinkingQuery, exactHeaders as exactThinkingHeaders } from './composer.fixture.mjs';

// FULL H-THINK remedy. Original browser seed literals are data, not a copied
// loader/reducer. No source extraction, alternate hook or fake React is used.
const richThinkingReads = [
  { entryId: 'call', blockIndex: '1', pathname: '/api/sessions/e2e-rich-session/entries/call/thinking',
    body: { thinking: 'E2E intermediate reasoning\nIntermediate thinking details.' } },
  { entryId: 'answer', blockIndex: '1', pathname: '/api/sessions/e2e-rich-session/entries/answer/thinking',
    body: { thinking: 'E2E follow-up reasoning\nFollow-up thinking details.' } },
  { entryId: 'answer', blockIndex: '3', pathname: '/api/sessions/e2e-rich-session/entries/answer/thinking',
    body: { thinking: 'E2E final reasoning\nFinal thinking details.' } },
];
const completeRichHistoryAnswer = "E2E final answer\n```js\nconsole.log('E2E code');\n```\n\n"
  + 'E2E answer paragraph.\n\n'.repeat(20)
  + '## E2E reading position\n\n'
  + 'E2E answer paragraph.\n\n'.repeat(20);
const fullThinkingButtons = view => [...view.container.querySelectorAll('button[aria-label]')]
  .filter(node => node.getAttribute('aria-label').startsWith('Thinking:'));

// One batched case: original three reads, held original JSON bodies, actual
// cached request/effect tails, current observer, cancellation and cache remount.
test('actual ChatWindow reads all three original deferred thinking bodies through production effects with current observers and cached full work', async t => {
  const failures = [], registered = [], ports = [], originals = new Map();
  const firstObserver = [], currentObserver = [], observedOwners = [];
  let f, realm, view, realmError, realmRejection, disposed = false, closing = false;
  const attempt = async callback => { try { await callback(); } catch (error) { failures.push(error); } };
  // This owns each supplied ORIGINAL promise. Its observing continuation is an
  // acknowledgement only, separately joined so even its error bookkeeping ends.
  const own = (label, promise) => {
    if (originals.has(promise)) return originals.get(promise);
    const record = { label, promise, settled: false, value: undefined, error: undefined };
    originals.set(promise, record);
    record.observation = promise.then(value => { record.value = value; record.settled = true; }, error => {
      record.error = error; record.settled = true; failures.push(error); // SAME Error, rethrown after independent cleanup.
    });
    return record;
  };
  const releaseBodies = () => {
    const releaseErrors = [];
    for (const port of ports) {
      try { port.request.body.resolve(port.expected.body); } catch (error) { releaseErrors.push(error); }
      try { port.request.response.resolve(port.response); } catch (error) { releaseErrors.push(error); }
    }
    if (releaseErrors.length) throw new AggregateError(releaseErrors, 'Independent thinking peer releases failed');
  };
  const joinOriginals = async () => {
    // Named admitted originals only, not a flush/idle or an act acknowledgement.
    // Newly observed descendant tails are included before this finite join ends.
    let joined = 0;
    while (joined < originals.size) {
      const batch = [...originals.values()].slice(joined); joined += batch.length;
      await Promise.allSettled(batch.map(record => record.promise));
      await Promise.allSettled(batch.map(record => record.observation));
    }
  };
  const hostRejection = error => failures.push(error), hostException = error => failures.push(error);
  const finish = async () => {
    if (disposed) return;
    disposed = true; closing = true;
    // Teardown releases ALL known peers before its FIRST owned wait, including
    // a failed unmount/act. Earlier deliberate cancel/reopen actions stay intact.
    await attempt(releaseBodies);
    await attempt(() => view?.unmount());
    // Existing composer disposal releases every known frame/HTTP/explicit peer
    // before independently invoking its actual composer/input and our tail joins.
    await attempt(() => f?.dispose());
    await attempt(joinOriginals); // Independent fallback if fixture/React cleanup failed.
    for (const hook of registered) await attempt(hook);
    if (realm) {
      await attempt(() => realm.removeEventListener('error', realmError));
      await attempt(() => realm.removeEventListener('unhandledrejection', realmRejection));
    }
    await attempt(() => process.off('unhandledRejection', hostRejection));
    await attempt(() => process.off('uncaughtExceptionMonitor', hostException));
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Full deferred-thinking case and independent cleanup failed');
  };
  t.after(finish); // Before installing any capability or importing production.
  process.on('unhandledRejection', hostRejection);
  process.on('uncaughtExceptionMonitor', hostException);
  try {
    f = composerFixture({ after: hook => registered.push(hook) }, { route(request) {
      try {
        assert.equal(closing, false, 'no thinking admission after case closure');
        const expected = richThinkingReads[ports.length] ?? richThinkingReads.find(item =>
          item.pathname === request.url.pathname && item.blockIndex === request.url.searchParams.get('blockIndex'));
        assert.ok(expected, 'only exact original deferred thinking identities');
        // Primitive wire receipt only; the SAME validator Error and complete
        // original aggregate still escape unchanged after independent cleanup.
        t.diagnostic('H-THINK ORIGINAL REQUEST ' + JSON.stringify([
          request.url.pathname, request.url.searchParams.get('blockIndex'), expected.pathname, expected.blockIndex,
        ]));
        assert.equal(request.url.origin, 'https://fixture.invalid');
        assert.equal(request.url.pathname, expected.pathname, 'original deferred entry pathname');
        assert.equal(request.url.searchParams.get('blockIndex'), expected.blockIndex, 'original deferred blockIndex');
        exactThinkingQuery(request, { blockIndex: expected.blockIndex });
        assert.equal(request.options.method ?? 'GET', 'GET');
        exactThinkingHeaders(request);
        assert.equal(request.options.body, undefined);
        assert.deepEqual(Object.keys(request.options), [], 'original fetch has no synthetic options');
        const port = { request, expected, response: null };
        ports.push(port);
        // A controlled external Response/JSON port, not a copy of the loader.
        // Production still checks status BEFORE calling this original JSON gate.
        port.response = { ok: true, status: 200, json() {
          return f.http.check(() => {
            assert.equal(ports.includes(port), true, 'JSON descendant belongs to its accepted original response');
            request.jsonCalls++;
            own(`original JSON ${expected.entryId}:${expected.blockIndex}`, request.body.promise);
            return request.body.promise;
          });
        } };
        // Preserve valid full bodies for failure cleanup; do not inject a second
        // invalid response when the existing fixture independently releases peers.
        request.answered = true; request.replyData = expected.body; request.replyStatus = 200;
        request.response.resolve(port.response);
        own(`original response ${expected.entryId}:${expected.blockIndex}`, request.response.promise);
        return undefined; // Intentionally hold only the original JSON body.
      } catch (error) { failures.push(error); throw error; }
    }, setup(window) {
      realm = window;
      realmError = event => failures.push(event.error ?? new Error(event.message || 'Realm thinking error'));
      realmRejection = event => failures.push(event.reason);
      window.addEventListener('error', realmError);
      window.addEventListener('unhandledrejection', realmRejection);
    } });
    f.release(releaseBodies);
    f.join(joinOriginals);
    // Establish fenced realm/independent collectors BEFORE importing this graph.
    view = await f.mount(null);
    const p = await f.load(), work = p.createComposerWork(), api = createRef();
    f.join(() => work.whenSettled());
    const observer = into => ({
      owners(owners) {
        observedOwners.push(owners);
        f.join(() => owners.whenMaintenanceSettled());
        f.join(() => owners.work.whenSettled());
      },
      started(name, started) { own(`original existing view work ${name}`, started); },
      thinking(observation) {
        into.push(observation);
        own(`original cached thinking request ${observation.entryId}:${observation.blockIndex}`, observation.request);
        own(`original thinking effect tail ${observation.entryId}:${observation.blockIndex}`, observation.tail);
      },
    });
    const { normalizeToolCalls } = await f.jiti.import('../lib/normalize.ts');
    const raw = readingMessages();
    raw[3].content[4] = { type: 'text', text: completeRichHistoryAnswer };
    const messages = raw.map(normalizeToolCalls);
    let props = { session: null, archivedRootSessionId: null, archiveActionBusy: false, onSessionRestored() {},
      newSessionCwd: null, newSessionDraftKey: null, chatInputRef: api, workObserver: observer(firstObserver) };
    const state = { data: null, loading: false, error: null, messages, entryIds: readingEntryIds, activeToolResults: new Map(),
      streamingStore: p.createStreamingStore(), agentRunning: false, bashRunning: false, isNew: false,
      modelNames: {}, modelList: [], modelThinkingLevels: {}, modelThinkingLevelMaps: {},
      notices: [], extensionStatuses: [], extensionWidgets: [], sessionIdRef: { current: 'e2e-rich-session' }, scrollContainerRef: { current: null },
      historyCursor: null, hasEarlierMessages: false, activeLeafId: 'answer' };
    const element = () => createElement(p.I18nProvider, null, createElement(p.ChatView, { ...props, state, work }));
    try { await view.rerender(element()); }
    finally { const input = api.current; if (input) f.join(() => input.whenSettled()); }
    const process = processButton(view);
    assert.ok(process);
    assert.equal(process.getAttribute('aria-expanded'), 'false');
    assert.equal(fullThinkingButtons(view).length, 0);
    assert.equal(ports.length, 0, 'collapsed original process makes no thinking reads');
    const finalMessage = [...view.container.querySelectorAll('[data-message-role="assistant"][data-entry-id="answer"]')]
      .find(node => node.querySelector('[data-message-text]'));
    assert.ok(finalMessage);
    assert.equal(finalMessage.textContent.split('test/E2E Model').length - 1, 1, 'original collapsed final answer has exactly one test/E2E Model label');
    assert.equal(finalMessage.querySelectorAll('button[aria-label^="Thinking"]').length, 0);
    assert.equal(finalMessage.textContent.includes('E2E final reasoning'), false);
    const renderedCode = finalMessage.querySelector('pre')?.cloneNode(true);
    assert.ok(renderedCode, 'complete original rich answer has the real code block');
    for (const gutter of renderedCode.querySelectorAll('.react-syntax-highlighter-line-number')) gutter.remove();
    assert.equal(renderedCode.textContent.trim(), "console.log('E2E code');", 'complete original code text is exact apart from the real line-number gutter');
    assert.equal(finalMessage.querySelector('h2')?.textContent, 'E2E reading position');
    assert.equal(messages[3].content[4].text, completeRichHistoryAnswer, 'complete original History answer input, without Markdown-only tails');
    await click(view, process);
    assert.equal(ports.length, 0, 'Process expansion alone leaves original reads deferred');
    const buttons = fullThinkingButtons(view);
    assert.deepEqual(buttons.map(node => node.textContent), ['E2E intermediate reasoning', 'E2E follow-up reasoning', 'E2E final reasoning']);
    assert.deepEqual(buttons.map(node => node.getAttribute('aria-expanded')), ['false', 'false', 'false']);
    for (const button of buttons) await click(view, button);
    assert.equal(ports.length, 3, 'three original deferred GET admissions');
    assert.equal(firstObserver.length, 3, 'three original full effect-tail observations');
    for (let index = 0; index < 3; index++) {
      const port = ports[index], observed = firstObserver[index], expected = richThinkingReads[index];
      assert.equal(port.request.jsonCalls, 1, 'each original JSON body is actually entered');
      assert.deepEqual([observed.sessionId, observed.entryId, observed.blockIndex], ['e2e-rich-session', expected.entryId, Number(expected.blockIndex)]);
      assert.equal(observed.request === port.request.fetchWork, false, 'cached loader promise is not a fetch acknowledgement');
      assert.equal(observed.tail === observed.request, false, 'full effect tail is separately owned');
      assert.equal(originals.get(observed.request).settled, false, 'full request remains pending on original JSON');
      assert.equal(originals.get(observed.tail).settled, false, 'effect tail remains pending on original JSON');
    }
    // Cancel one old effect while its real JSON is held. A callback-only change
    // must neither re-run the effect nor retain the old observer in memo props.
    await click(view, buttons[0]);
    props = { ...props, workObserver: observer(currentObserver) };
    await view.rerender(element());
    assert.equal(firstObserver.length, 3);
    assert.equal(currentObserver.length, 0, 'observer replacement is not an effect dependency');
    await click(view, buttons[0]);
    assert.equal(ports.length, 3, 'three deferred GETs after cache re-expansion');
    assert.equal(firstObserver.length, 3, 'obsolete observer receives no current effect');
    assert.equal(currentObserver.length, 1, 'latest observer receives the current effect');
    assert.equal(currentObserver[0].request === firstObserver[0].request, true, 'SAME original cached request across cancellation');
    assert.equal(currentObserver[0].tail === firstObserver[0].tail, false, 'distinct original effect tails across cancellation');
    await act(async () => {
      releaseBodies(); // ALL known original bodies before ANY original joins.
      await joinOriginals();
    });
    for (let index = 0; index < 3; index++) {
      assert.equal(buttons[index].nextElementSibling?.textContent, richThinkingReads[index].body.thinking,
        `full original thinking text ${richThinkingReads[index].entryId}:${richThinkingReads[index].blockIndex}`);
      assert.equal(originals.get(firstObserver[index].request).value, richThinkingReads[index].body.thinking);
      assert.equal(originals.get(ports[index].request.body.promise).value === richThinkingReads[index].body, true, 'same complete original JSON body value');
      assert.equal(ports[index].request.jsonCalls, 1);
    }
    assert.equal(originals.get(firstObserver[0].tail).settled, true, 'cancelled original effect tail is joined, not abandoned');
    assert.equal(originals.get(currentObserver[0].tail).settled, true, 'current original effect tail is joined');
    const processText = process.parentElement.textContent;
    const ordered = ['E2E intermediate reasoning', 'echo E2E tool output', 'E2E follow-up reasoning', 'E2E process note', 'E2E final reasoning'];
    for (const text of ordered) assert.equal(processText.indexOf(text) >= 0, true, `original process contains ${text}`);
    for (let index = 1; index < ordered.length; index++) assert.equal(processText.indexOf(ordered[index - 1]) < processText.indexOf(ordered[index]), true, 'expanded original process chronology');
    assert.equal(processText.split('E2E final reasoning').length - 1, 1, 'no duplicate final reasoning');
    assert.equal(finalMessage.textContent.includes('E2E final reasoning'), false, 'no copied final reasoning in final answer');
    assert.equal([...view.container.querySelectorAll('[data-message-text]')].filter(node => node.textContent.startsWith('E2E final answer')).length, 1, 'one complete original final answer');
    // Remount the actual Process children, then demand the same cached requests
    // and full originals, not new GETs or preview-only cache values.
    await click(view, process); await click(view, process);
    const reopened = fullThinkingButtons(view), previousCount = currentObserver.length;
    for (const button of reopened) await click(view, button);
    assert.equal(ports.length, 3, 'three deferred GETs after Process remount');
    assert.equal(currentObserver.length, previousCount + 3);
    await act(joinOriginals);
    for (let index = 0; index < 3; index++) {
      assert.equal(currentObserver[previousCount + index].request === firstObserver[index].request, true, 'SAME cached original request after Process remount');
      assert.equal(reopened[index].nextElementSibling?.textContent, richThinkingReads[index].body.thinking, 'cached full original thinking text after remount');
    }
    assert.equal(f.http.requests.length, 3, 'only the exact three current original GETs');
    assert.equal(observedOwners.length, 0, 'this case is the actual controlled view/effect graph, not a fabricated default-hook owner');
  } catch (error) { failures.push(error); }
  finally { await finish(); }
});
