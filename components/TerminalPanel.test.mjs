import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { terminalPanelFixture } from './terminal-panel.fixture.mjs';
import { createTerminalWriter, terminalRequest } from '../lib/terminal-client.ts';
import { createClientCompletion } from '../lib/client-completion.ts';

// Registration-only Node context for explicit composed disposal witnesses. All
// rendering/effects still use the actual central React fixture.
function fixtureOwner(t) {
  const hooks = [];
  let cleanup;
  const dispose = () => cleanup ??= (async () => {
    const errors = [];
    for (const hook of hooks) { try { await hook(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Registered fixture cleanup failed');
  })();
  t.after(dispose);
  return { t: { after(hook) { hooks.push(hook); } }, dispose };
}
function assertStyleDescriptor(before) {
  const after = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  assert.equal(after === undefined, before === undefined, 'style descriptor presence restored');
  if (before) for (const key of ['value', 'get', 'set', 'configurable', 'enumerable', 'writable']) {
    assert.equal(after[key] === before[key], true, `style descriptor ${key} identity restored`);
  }
}
function ownedCallbacks() {
  const handles = new Set(), gates = new Set();
  let closing = false;
  return {
    work(complete) {
      const done = deferred(); gates.add(done);
      if (closing) { done.resolve(); return done.promise; }
      // This callback IS admitted work with its own completion, not a turn used
      // to flush an unknown queue. Children get independent handles/promises.
      const handle = setImmediate(() => {
        handles.delete(handle);
        try { complete(); done.resolve(); }
        catch (error) { done.reject(error); throw error; }
      });
      handles.add(handle);
      return done.promise;
    },
    close() {
      closing = true;
      for (const handle of handles) clearImmediate(handle);
      handles.clear();
      for (const gate of gates) gate.resolve();
    },
  };
}

// Actual request/writer cases retained. settle observes the real queue without
// stopping it; no timer turn, mock writer or input retry is used.
test('terminal errors preserve server diagnostics and explain non-JSON responses', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const body of [null, '<html>Server error</html>', 'null']) {
    fetch.mock.mockImplementation(async () => new Response(body, { status: 500 }));
    await assert.rejects(terminalRequest('/api/terminal'), /HTTP 500.*brabbler server log/);
  }
  fetch.mock.mockImplementation(async () => Response.json({ error: 'Native module missing; run npm rebuild node-pty' }, { status: 500 }));
  await assert.rejects(terminalRequest('/api/terminal'), /Native module missing; run npm rebuild node-pty/);
});

test('a delayed input request cannot be overtaken by typing or resize', async t => {
  const received = [], first = deferred(), entered = deferred();
  let writer;
  t.after(async () => { first.resolve(); await writer?.stop(); });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    received.push(JSON.parse(options.body));
    if (received.length === 1) { entered.resolve(); await first.promise; }
    return Response.json({ success: true });
  });
  writer = createTerminalWriter('id', assert.fail);
  writer.write('a'); writer.resize(100, 30); writer.write('b\r');
  await entered.promise;
  assert.equal(received.length, 1);
  first.resolve(); await writer.settle();
  assert.deepEqual(received, [{ type: 'input', data: 'a' }, { type: 'resize', cols: 100, rows: 30 }, { type: 'input', data: 'b\r' }]);
  await writer.stop();
});

test('large Unicode pastes preserve characters while bounding input requests', async t => {
  const chunks = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { chunks.push(JSON.parse(options.body).data); return Response.json({ success: true }); });
  const writer = createTerminalWriter('id', assert.fail);
  t.after(() => writer.stop());
  const text = 'a'.repeat(32767) + '\u{1f600}'.repeat(40000);
  writer.write(text); await writer.settle();
  assert.equal(chunks.join(''), text);
  assert.equal(chunks.every(chunk => chunk.length <= 65536 && chunk.isWellFormed()), true);
  await writer.stop();
});

test('typing during a slow request is batched into the next ordered write', async t => {
  const received = [], first = deferred(), entered = deferred();
  let writer;
  t.after(async () => { first.resolve(); await writer?.stop(); });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    received.push(JSON.parse(options.body).data);
    if (received.length === 1) { entered.resolve(); await first.promise; }
    return Response.json({ success: true });
  });
  writer = createTerminalWriter('id', assert.fail); writer.write('first');
  await entered.promise;
  for (const character of 'a long command\r') writer.write(character);
  assert.deepEqual(received, ['first']);
  first.resolve(); await writer.settle();
  assert.deepEqual(received, ['first', 'a long command\r']);
  await writer.stop();
});

test('failed or stopped delivery discards queued input without retrying commands', async t => {
  const errors = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'gone' }, { status: 404 }));
  const writer = createTerminalWriter('id', error => errors.push(error.message));
  t.after(() => writer.stop());
  writer.write('first'); writer.write('second'); await writer.settle();
  assert.deepEqual(errors, ['gone']); assert.equal(fetch.mock.callCount(), 1);
  await writer.stop(); writer.write('third'); await writer.settle();
  assert.equal(fetch.mock.callCount(), 1);
});

test('client completion joins a detached callback child and finally-admitted grandchild', async t => {
  const completion = createClientCompletion(), parent = deferred(), callbacks = ownedCallbacks();
  let childCompleted = false, grandchildCompleted = false;
  t.after(async () => { callbacks.close(); parent.resolve(); await completion.settle(); });
  completion.track(parent.promise.then(() => {
    // Deliberately NOT returned/adopted by the parent promise.
    completion.track(callbacks.work(() => { childCompleted = true; }).finally(() => {
      completion.track(callbacks.work(() => { grandchildCompleted = true; }));
    }));
  }));
  const joining = completion.settle(); parent.resolve(); await joining;
  assert.deepEqual([childCompleted, grandchildCompleted], [true, true]);
});

test('client completion preserves original promise and immediate admission without caching later idle', async t => {
  const completion = createClientCompletion(), gate = deferred(), later = deferred(), events = [];
  t.after(async () => { gate.resolve(42); later.resolve(); await completion.settle(); });
  await completion.settle();
  const started = (async () => { events.push('started'); await gate.promise; return 42; })();
  assert.equal(completion.track(started) === started, true, 'original promise identity');
  const wrapped = completion.wrap(() => { events.push('wrapped immediately'); return started; });
  assert.equal(wrapped() === started, true, 'wrapper keeps original promise');
  events.push('caller'); assert.deepEqual(events, ['started', 'wrapped immediately', 'caller']);
  gate.resolve(42); assert.equal(await started, 42); await completion.settle();
  let completed = false;
  completion.track(later.promise.then(() => { completed = true; }));
  const joining = completion.settle(); assert.equal(completed, false);
  later.resolve(); await joining; assert.equal(completed, true);
});

test('named font completion is independent of a held client peer', async t => {
  const completion = createClientCompletion(), font = deferred(), client = deferred();
  let fontDone = false, clientDone = false;
  t.after(async () => { font.resolve(); client.resolve(); await completion.settle(); });
  completion.track(font.promise.then(() => { fontDone = true; }), 'font');
  completion.track(client.promise.then(() => { clientDone = true; }));
  font.resolve(); await completion.settle('font');
  assert.equal(fontDone, true); assert.equal(clientDone, false);
  client.resolve(); await completion.settle(); assert.equal(clientDone, true);
});

test('unexpected client rejection reports immediately without a join and retains held peers', async t => {
  const reported = deferred(), failed = deferred(), peer = deferred(), messages = [], failure = new Error('no-join client defect');
  const completion = createClientCompletion(error => { messages.push(error.message); reported.resolve(); });
  const expected = error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === failure;
  t.after(async () => { failed.reject(failure); peer.resolve(); await assert.rejects(completion.settle(), expected); });
  completion.track(failed.promise); completion.track(peer.promise);
  failed.reject(failure); await reported.promise; // no settle call before reporting witness
  assert.deepEqual(messages, ['no-join client defect']);
  let joined = false;
  const joining = assert.rejects(completion.settle().finally(() => { joined = true; }), expected);
  assert.equal(joined, false); peer.resolve(); await joining;
  await assert.rejects(completion.settle(), expected); assert.equal(messages.length, 1);
});

for (const kind of ['throws', 'rejects']) test(`client reporter that ${kind} retains both failures and drains held peers`, async t => {
  const reported = deferred(), failed = deferred(), peer = deferred();
  const failure = new Error('original client failure'), reporting = new Error('client reporter failure');
  let reports = 0, peerDone = false;
  const completion = createClientCompletion(() => {
    reports++; reported.resolve();
    if (kind === 'throws') throw reporting;
    return Promise.reject(reporting);
  });
  const expected = error => error instanceof AggregateError && error.errors.length === 2
    && error.errors.some(item => item === failure) && error.errors.some(item => item.cause === reporting);
  t.after(async () => { failed.reject(failure); peer.resolve(); await assert.rejects(completion.settle(), expected); });
  completion.track(failed.promise); completion.track(peer.promise.then(() => { peerDone = true; }));
  failed.reject(failure); await reported.promise; // reporter is independent of joins
  let joined = false;
  const joining = assert.rejects(completion.settle().finally(() => { joined = true; }), expected);
  assert.equal(joined, false); assert.equal(peerDone, false);
  peer.resolve(); await joining; assert.equal(peerDone, true);
  await assert.rejects(completion.settle(), expected); assert.equal(reports, 1);
});

test('client completion retains an unexpected failure and still joins accepted peers', async t => {
  const reports = [], completion = createClientCompletion(failure => reports.push(failure.message)), peer = deferred();
  const expected = failure => failure instanceof AggregateError && failure.errors.length === 1 && failure.errors[0].message === 'named client defect';
  t.after(async () => { peer.resolve(); await assert.rejects(completion.settle(), expected); assert.deepEqual(reports, ['named client defect']); });
  let completed = false;
  completion.track(Promise.reject(new Error('named client defect')));
  completion.track(peer.promise.then(() => { completed = true; }));
  const joined = completion.settle(); peer.resolve();
  await assert.rejects(joined, expected);
  assert.equal(completed, true); assert.deepEqual(reports, ['named client defect']);
});

test('live terminal theme/size and one-shot keys preserve PTY and stream ownership', async t => {
  const h = await terminalPanelFixture(t, { extraKeys: true });
  await h.connect();
  const terminal = h.terminal, source = h.sources.at(-1), count = h.terminals.length, fits = h.fits;
  await h.appearance(18, 'light');
  assert.equal(h.terminal === terminal, true, 'appearance retains the xterm instance before any possible new start can wait');
  await h.settle();
  assert.equal(terminal.options.fontSize, 17); assert.equal(terminal.options.theme.background, '#fbfbfc');
  assert.equal(h.fits > fits, true);
  await h.key('CTRL'); await h.key('Left');
  assert.equal(h.terminal === terminal, true, 'modifier changes retain the xterm instance');
  await h.settle();
  assert.deepEqual(h.inputs(), ['\x1b[1;5D']);
  await h.key('CTRL');
  await h.act(() => { terminal.emitData('c'); terminal.emitData('c'); }); await h.settle();
  // The real writer is allowed to batch adjacent input, unlike the old writer spy.
  assert.equal(h.inputs().slice(1).join(''), '\x03c');
  assert.equal(h.view.container.querySelector('button[aria-pressed="true"]') === null, true);
  assert.equal(h.terminal === terminal, true); assert.equal(h.terminals.length, count);
  assert.equal(h.sources.at(-1) === source, true); assert.deepEqual(h.afterInitial, []);
});

test('Nerd retains its bundled family, System follows shared mono, and both weights refit without replacing PTY/SSE', async t => {
  const h = await terminalPanelFixture(t); await h.connect();
  const terminal = h.terminal, source = h.sources.at(-1), fits = h.fits;
  assert.equal(terminal.options.fontWeight, 400);
  await h.fonts('Shared Mono', 600); await h.settle();
  assert.equal(terminal.options.fontFamily, '"Brabbler Nerd Font", monospace');
  assert.equal(terminal.options.fontWeight, 600); assert.equal(h.fits > fits, true);
  const weightFits = h.fits;
  await h.fonts('Shared Mono', 500); await h.settle();
  assert.equal(terminal.options.fontWeight, 500); assert.equal(h.fits > weightFits, true, 'weight-only changes refit');
  await h.fonts('Shared Mono', 600); await h.settle();
  await h.font('system'); await h.settle();
  assert.equal(terminal.options.fontFamily, '"Shared Mono", var(--font-mono-default)');
  const family = terminal.options.fontFamily;
  await h.hidden(true); const hiddenFits = h.fits;
  await h.fonts('Hidden Mono', 200); await h.settle();
  assert.equal(terminal.options.fontFamily, family); assert.equal(terminal.options.fontWeight, 600); assert.equal(h.fits, hiddenFits);
  await h.hidden(false); await h.settle();
  assert.equal(terminal.options.fontFamily, '"Hidden Mono", var(--font-mono-default)'); assert.equal(terminal.options.fontWeight, 200); assert.equal(h.fits > hiddenFits, true);
  await h.font('nerd'); await h.settle();
  assert.equal(terminal.options.fontFamily, '"Brabbler Nerd Font", monospace'); assert.equal(terminal.options.fontWeight, 200);
  assert.equal(h.view.window.localStorage.getItem('brabbler:terminal-font'), 'nerd');
  assert.equal(h.terminal === terminal, true); assert.equal(terminal.disposed, false);
  assert.equal(h.sources.at(-1) === source, true); assert.deepEqual(h.afterInitial, []);
});

test('late font readiness waits for visibility and cannot refit a disposed terminal', async t => {
  const h = await terminalPanelFixture(t, { deferFonts: true }); await h.connect();
  const terminal = h.terminal;
  await h.font('system'); await h.hidden(true); const fits = h.fits;
  await h.fonts('Delayed Mono', 500); await h.releaseFonts(); await h.settle();
  assert.equal(h.fits, fits); assert.equal(terminal.options.fontFamily, 'monospace');
  await h.hidden(false);
  assert.equal(terminal.options.fontFamily, '"Delayed Mono", var(--font-mono-default)'); assert.equal(terminal.options.fontWeight, 500);
  const visibleFits = h.fits, count = h.terminals.length, sources = h.sources.length;
  await h.view.unmount(); await h.releaseFonts(); await h.settle();
  assert.equal(terminal.disposed, true); assert.equal(h.fits, visibleFits);
  assert.equal(h.terminals.length, count); assert.equal(h.sources.length, sources);
});

for (const restored of [false, true]) test(`${restored ? 'restored' : 'new'} terminal connects to the reachable local endpoint when navigator reports offline`, async t => {
  const h = await terminalPanelFixture(t, { restored, online: false }); await h.connect();
  assert.equal(h.sources.length, 1); assert.equal(h.sources[0].url, `${h.path}/events`);
  assert.equal(h.terminal.options.disableStdin, false); assert.equal(h.status(), 'terminal-status-dot is-ready');
  assert.deepEqual(h.afterInitial, []);
});

test('a one-row mobile fit is clamped on open, resize and reconnect without disabling typing', async t => {
  const h = await terminalPanelFixture(t);
  h.terminal.cols = 1; h.terminal.rows = 1; await h.connect();
  assert.deepEqual(h.resizes().at(-1), { cols: 2, rows: 2 });
  await h.act(() => h.terminal.emitResize(80, 1)); await h.settle();
  assert.deepEqual(h.resizes().at(-1), { cols: 80, rows: 2 });
  await h.event('offline'); const count = h.resizes().length;
  await h.act(() => h.terminal.emitResize(80, 1)); await h.settle(); assert.equal(h.resizes().length, count);
  await h.event('online'); await h.act(() => h.sources.at(-1).open());
  await h.act(() => h.terminal.emitData('still typing\\r')); await h.settle();
  assert.deepEqual(h.resizes().at(-1), { cols: 2, rows: 2 }); assert.deepEqual(h.inputs(), ['still typing\\r']);
  assert.equal(h.terminal.options.disableStdin, false); assert.deepEqual(h.afterInitial, []);
});

test('closing during held creation never opens SSE and awaits creation and actual writer settlement before DELETE', async t => {
  const h = await terminalPanelFixture(t);
  await h.render({ closing: 'close' });
  assert.deepEqual(h.afterInitial, []); assert.equal(h.sources.length, 0); assert.equal(h.closed, 0);
  await h.act(() => { for (const request of h.admin) request.bodyGate.resolve({ id: h.id }); });
  await h.settle();
  assert.equal(h.sources.length, 0); assert.deepEqual(h.afterInitial, ['DELETE']);
  assert.equal(h.admin.at(-1).options.keepalive, true); assert.equal(h.closed, 1); assert.equal(h.closeErrors, 0);
  await h.render(); await h.settle(); assert.deepEqual(h.afterInitial, ['DELETE']);
});

test('closing disconnects immediately and joins chosen font work while input holds DELETE, using current callbacks', async t => {
  const h = await terminalPanelFixture(t, { deferFonts: true }); await h.connect();
  const source = h.sources.at(-1), terminal = h.terminal;
  const lateOpen = source.onopen, lateError = source.onerror, lateMessage = source.onmessage;
  h.holdInput(); await h.act(() => terminal.emitData('before close'));
  const input = h.writes.find(item => item.body.type === 'input'); await input.entered.promise;
  const resizeCount = h.resizes().length;
  await h.render({ closing: 'close' });
  assert.equal(source.closed, true); assert.equal(terminal.options.disableStdin, true);
  const status = h.status();
  await h.event('online'); await h.event('pageshow', { persisted: true });
  await h.act(() => {
    lateOpen({}); lateError({}); lateMessage({ data: JSON.stringify({ type: 'output', data: 'late', offset: 4 }) });
    terminal.emitData('must not send'); terminal.emitResize(100, 30);
  });
  assert.equal(h.sources.length, 1); assert.equal(terminal.options.disableStdin, true); assert.equal(h.status(), status);
  assert.deepEqual(h.inputs(), ['before close']); assert.equal(h.resizes().length, resizeCount); assert.equal(terminal.output.join(''), '');
  assert.deepEqual(h.afterInitial, []);
  let currentClosed = 0;
  await h.callbacks({ onClosed: () => { currentClosed++; }, onCloseError: assert.fail });
  // Fonts are independently best-effort, not a new prerequisite for native
  // termination. Join their actual full continuations while input still gates
  // DELETE, then release input and join the full explicit close.
  await h.releaseFonts(); await h.settle('font');
  assert.deepEqual(h.afterInitial, [], 'actual input body still gates DELETE');
  await h.act(() => input.bodyGate.resolve({ success: true })); await h.settle();
  assert.deepEqual(h.afterInitial, ['DELETE']); assert.equal(currentClosed, 1); assert.equal(h.closed, 0); assert.equal(h.closeErrors, 0);
});

for (const attached of [false, true]) test(`unmount ${attached ? 'after connection' : 'during held creation'} only disconnects and never deletes the terminal lease`, async t => {
  const h = await terminalPanelFixture(t);
  if (attached) await h.connect();
  const terminal = h.terminal, source = h.sources.at(-1);
  const late = source && [source.onopen, source.onerror, source.onmessage];
  await h.view.unmount(); assert.equal(terminal.disposed, true); assert.deepEqual(h.afterInitial, []);
  await h.act(() => { for (const item of h.admin) if (item.method === 'POST') item.bodyGate.resolve({ id: h.id }); });
  await h.event('online'); await h.event('pageshow', { persisted: true });
  if (late) await h.act(() => { late[0]({}); late[1]({}); late[2]({ data: JSON.stringify({ type: 'output', data: 'late', offset: 4 }) }); });
  await h.settle();
  assert.equal(h.sources.length, attached ? 1 : 0); if (source) assert.equal(source.closed, true);
  assert.equal(terminal.output.join(''), ''); assert.deepEqual(h.afterInitial, []); assert.equal(h.closed, 0); assert.equal(h.closeErrors, 0);
  assert.equal(h.observers.every(item => item.disconnected), true);
});

for (const reconnect of [false, true]) test(`failed DELETE keeps the tab available for ${reconnect ? 'same-id GET reconnect and close retry' : 'explicit close retry'}`, async t => {
  const h = await terminalPanelFixture(t, { deleteFailures: 1 }); await h.connect();
  const terminal = h.terminal;
  await h.render({ closing: 'close' }); await h.settle();
  assert.deepEqual(h.afterInitial, ['DELETE']); assert.equal(h.closed, 0); assert.equal(h.closeErrors, 1); assert.equal(terminal.disposed, false);
  assert.equal(h.view.container.querySelector('[role="alert"]')?.textContent, 'termination failed');
  await h.render({ closing: undefined });
  const button = h.view.container.querySelector('button[aria-label="Reconnect terminal"]');
  assert.equal(Boolean(button), true); assert.equal(button.disabled, false);
  if (reconnect) {
    await h.reconnect(); assert.deepEqual(h.afterInitial, ['DELETE', 'GET']);
    assert.equal(h.admin.at(-1).url.pathname, h.path); assert.equal(h.sources.length, 2);
    await h.act(() => h.sources.at(-1).open()); await h.settle(); assert.equal(h.terminal.options.disableStdin, false);
  }
  await h.render({ closing: 'close' }); await h.settle();
  assert.deepEqual(h.afterInitial, reconnect ? ['DELETE', 'GET', 'DELETE'] : ['DELETE', 'DELETE']);
  assert.equal(h.closed, 1); assert.equal(h.closeErrors, 1);
});

test('unmount does not undo an already explicit close; its late completion cannot call the removed observer', async t => {
  const h = await terminalPanelFixture(t);
  await h.render({ closing: 'close' }); await h.view.unmount();
  await h.act(() => { for (const request of h.admin) if (request.method === 'POST') request.bodyGate.resolve({ id: h.id }); });
  await h.settle();
  assert.deepEqual(h.afterInitial, ['DELETE']); assert.equal(h.sources.length, 0);
  assert.equal(h.closed, 0); assert.equal(h.closeErrors, 0);
});

test('held best-effort fonts do not gate DELETE or its callback; full font work still joins before disposal', async t => {
  const h = await terminalPanelFixture(t, { deferFonts: true }); await h.connect();
  assert.equal(h.fontLoads.some(gate => !gate.released), true);
  await h.render({ closing: 'close' }); await h.settle('client');
  assert.deepEqual(h.afterInitial, ['DELETE']); assert.equal(h.closed, 1); assert.equal(h.closeErrors, 0);
  assert.equal(h.fontLoads.some(gate => !gate.released), true, 'DELETE completed with font work pending');
  const fits = h.fits;
  await h.view.unmount(); await h.releaseFonts(); await h.settle('font');
  assert.equal(h.fits, fits, 'released full font callbacks cannot refit disposed xterm');
  await h.dispose();
});

test('composed Terminal disposal restores style identity after normal and failed setup, then permits another mount', async t => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  for (const scenario of ['normal', 'failed-setup', 'subsequent-mount']) {
    const owner = fixtureOwner(t);
    let lifetime;
    if (scenario === 'failed-setup') {
      await assert.rejects(terminalPanelFixture(owner.t, {
        captureLifetime: value => { lifetime = value; }, failSetup: true,
      }), /controlled terminal setup failure after style override/);
      await lifetime.dispose();
    } else {
      const h = await terminalPanelFixture(owner.t); await h.connect();
      assert.equal(globalThis.getComputedStyle === before?.value, false, 'local style override is actually installed');
      await h.dispose();
    }
    await owner.dispose(); assertStyleDescriptor(before);
  }
});

test('callbacks from a replaced SSE source cannot alter the current terminal', async t => {
  const h = await terminalPanelFixture(t); await h.connect();
  const old = h.sources.at(-1), late = [old.onopen, old.onerror, old.onmessage];
  await h.event('offline'); await h.event('online'); await h.act(() => h.sources.at(-1).open()); await h.settle();
  await h.act(() => { late[0]({}); late[1]({}); late[2]({ data: JSON.stringify({ type: 'exit', exitCode: 7 }) }); });
  assert.equal(h.status(), 'terminal-status-dot is-ready'); assert.equal(h.terminal.options.disableStdin, false);
  assert.equal(h.view.container.querySelector('.terminal-panel-exit') === null, true);
});
