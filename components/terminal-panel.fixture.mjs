import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { browserClientFixture, exactHeaders } from '../lib/browser-client.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';

export async function terminalPanelFixture(t, { restored = false, online = true, extraKeys = false, deferFonts = false, deleteFailures = 0, captureLifetime = () => {}, failSetup = false, generalSettings = false } = {}) {
  const lifetime = browserClientFixture(t);
  captureLifetime(lifetime);
  const terminals = [], sources = [], fontLoads = [], observers = [];
  const sourceCreated = deferred();
  let visible = true, fits = 0, view, appearance, externalAdmission = false;
  let tab = { id: 'a'.repeat(32), cwd: '/workspace', restored };
  let closed = 0, closeErrors = 0, holdInput = false, closeAdmitted = false;
  let callbacks = { onClosed: () => { closed++; }, onCloseError: () => { closeErrors++; } };
  const path = `/api/terminal/${tab.id}`;
  const admin = [], writes = [];
  const port = { terminals, checked: lifetime.checked,
    admit() { lifetime.checked(() => assert.equal(externalAdmission, true, 'no xterm effects during graph import')); },
    get fits() { return fits; }, set fits(value) { fits = value; } };
  lifetime.replace(globalThis, Symbol.for('pi-web:test-terminal-port'), port);
  class Source {
    static CLOSED = 2;
    constructor(url) {
      lifetime.checked(() => assert.equal(url, `${path}/events`, 'same-id SSE endpoint'));
      this.url = url; this.readyState = 0; this.closed = false;
      sources.push(this); sourceCreated.resolve(this);
    }
    open() { this.readyState = 1; this.onopen?.({}); }
    close() { this.closed = true; this.readyState = Source.CLOSED; }
  }
  lifetime.route(request => {
    const { url, options, method, body } = request;
    assert.equal(request.closing && !(method === 'DELETE' && closeAdmitted), false,
      'unmount admits no new terminal operation; an already explicit close may finish');
    assert.deepEqual([...url.searchParams], []);
    if (url.pathname === '/api/terminal' && method === 'POST') {
      exactHeaders(options, { 'Content-Type': 'application/json' });
      assert.deepEqual(body, { id: tab.id, cwd: tab.cwd, cols: 80, rows: 24 });
      admin.push(request);
      return { hold: true, fallback: { id: tab.id } };
    }
    if (generalSettings && method === 'GET') {
      const settings = {
        '/api/web-auth': { enabled: false },
        '/api/tools/settings': { isWindows: false, powerShellEnabled: false },
        '/api/sessions/title-language': { language: 'auto' },
        '/api/sessions/title-model': { model: null },
      };
      if (Object.hasOwn(settings, url.pathname)) {
        assert.equal(request.closing, false);
        exactHeaders(options, {});
        assert.equal(body, undefined);
        return { data: settings[url.pathname] };
      }
    }
    assert.equal(url.pathname, path);
    if (method === 'POST') {
      exactHeaders(options, { 'Content-Type': 'application/json' });
      assert.ok(body.type === 'input' || body.type === 'resize');
      assert.deepEqual(Object.keys(body).sort(), body.type === 'input' ? ['data', 'type'] : ['cols', 'rows', 'type']);
      writes.push(request);
      return { hold: holdInput && body.type === 'input', data: { success: true }, fallback: { success: true } };
    }
    exactHeaders(options, {});
    assert.equal(body, undefined);
    assert.ok(method === 'GET' || method === 'DELETE');
    if (method === 'DELETE') {
      assert.equal(options.keepalive, true);
      assert.equal(admin.filter(item => item.method === 'POST').every(item => item.jsonReturned), true, 'creation body returned before DELETE');
      assert.equal(writes.every(item => item.jsonReturned), true, 'writer bodies returned before DELETE');
    }
    admin.push(request);
    if (method === 'DELETE' && deleteFailures-- > 0) return { status: 500, data: { error: 'termination failed' } };
    return { data: { id: tab.id } };
  });
  const xterm = fileURLToPath(new URL('./terminal-xterm.fixture.mjs', import.meta.url));
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true,
    alias: { '@xterm/xterm': xterm, '@xterm/addon-fit': xterm } });
  const graph = await jiti.import('./terminal-panel.fixture.tsx');
  const completion = graph.createClientCompletion(); lifetime.bindCompletion(completion);
  // Full Settings effect/catch/finally promises join the same owned domain.
  // No factory/delay/retry and no Settings observer when the branch is absent.
  const observeSettings = (_label, promise) => { completion.track(promise, 'settings'); };
  const settingsProps = {
    cwd: null, sessionId: null, sessions: [], trustStatus: null,
    quoteSelectionEnabled: false,
    onSessionReloaded() { throw new Error('Unexpected settings reload'); },
    onManageTrust() { throw new Error('Unexpected trust action'); },
    onQuoteSelectionChange() { throw new Error('Unexpected quote action'); },
    privacy: { keys: new Set(), error: false, pendingKey: null,
      refresh() { throw new Error('Unexpected privacy refresh'); },
      setHidden() { throw new Error('Unexpected privacy write'); } },
  };
  const element = () => createElement(graph.I18nProvider, null, createElement(Fragment, null,
    generalSettings && createElement(graph.SettingsWorkContext.Provider, { value: observeSettings },
      createElement(graph.GeneralSettings, settingsProps)),
    createElement(graph.TerminalAppearanceProbe, { observe: value => { appearance = value; } }),
    createElement(graph.TerminalPanel, { tab, active: visible, onRestart() {}, ...callbacks, completion })));
  view = await lifetime.mount(element(), window => {
    externalAdmission = true;
    lifetime.replace(globalThis, 'EventSource', Source); lifetime.replace(window, 'EventSource', Source);
    lifetime.replace(globalThis, 'ResizeObserver', class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    });
    lifetime.replace(window.navigator, 'onLine', online);
    lifetime.replace(window, 'matchMedia', () => ({ matches: extraKeys, addEventListener() {}, removeEventListener() {} }));
    lifetime.replace(window, 'innerWidth', 390); lifetime.replace(window, 'innerHeight', 844);
    lifetime.replace(window.HTMLElement.prototype, 'offsetWidth', undefined);
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => visible ? 800 : 0 });
    lifetime.replace(window.HTMLElement.prototype, 'offsetHeight', undefined);
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => visible ? 480 : 0 });
    // jsdom has no CSS inheritance/metrics guarantee. Read the actual store's CSS
    // variable at the explicit computed-style boundary, never a hook replacement.
    lifetime.replace(globalThis, 'getComputedStyle', () => ({ getPropertyValue: name => window.document.documentElement.style.getPropertyValue(name) }), true);
    lifetime.replace(window.document, 'fonts', { load() {
      const gate = lifetime.gate([]); fontLoads.push(gate);
      if (!deferFonts) gate.resolve([]);
      return gate.promise;
    } });
    if (failSetup) throw new Error('controlled terminal setup failure after style override');
  });
  await lifetime.act(() => { appearance.setFontSize(14); graph.setFontPreference('mono', ''); graph.setFontWeight('mono', 400); graph.setTerminalTheme('dark'); });
  const initialCount = admin.length;
  assert.ok(initialCount > 0);
  assert.equal(admin.every(item => item.method === (restored ? 'GET' : 'POST')), true, 'new POST versus restored GET');
  const render = async changes => {
    tab = { ...tab, ...changes };
    if (tab.closing) closeAdmitted = true;
    await view.rerender(element()); lifetime.healthy();
  };
  const releaseCreation = async () => {
    await lifetime.act(async () => {
      for (const item of admin) if (item.method === 'POST') item.bodyGate.resolve({ id: tab.id });
      await sourceCreated.promise;
    });
  };
  return {
    ...lifetime, view, terminals, sources, fontLoads, observers, admin, writes, path, initialCount, render,
    get terminal() { return terminals.at(-1); }, get closed() { return closed; }, get closeErrors() { return closeErrors; },
    get fits() { return fits; }, get id() { return tab.id; },
    get afterInitial() { return admin.slice(initialCount).map(item => item.method); },
    inputs() { return writes.filter(item => item.body.type === 'input').map(item => item.body.data); },
    resizes() { return writes.filter(item => item.body.type === 'resize').map(item => ({ cols: item.body.cols, rows: item.body.rows })); },
    holdInput() { holdInput = true; }, releaseCreation,
    async connect() { await releaseCreation(); await lifetime.act(() => sources.at(-1).open()); if (!deferFonts) await lifetime.settle(); },
    async releaseFonts() { await lifetime.act(() => { for (const gate of fontLoads) gate.resolve([]); }); },
    async fonts(family, weight) { await lifetime.act(() => { graph.setFontPreference('mono', family); graph.setFontWeight('mono', weight); }); },
    async appearance(size, theme) { await lifetime.act(() => { appearance.setFontSize(size); graph.setTerminalTheme(theme); }); },
    async hidden(hidden) { visible = !hidden; await view.rerender(element()); },
    async callbacks(next) { callbacks = next; await view.rerender(element()); },
    async event(type, props = {}) { await lifetime.act(() => { const event = new view.window.Event(type); Object.assign(event, props); view.window.dispatchEvent(event); }); },
    async font(value) { const select = view.container.querySelector('select'); select.value = value; await view.dispatch(select, new view.window.Event('change', { bubbles: true })); },
    async key(label) {
      const button = [...view.container.querySelectorAll('.terminal-extra-keys button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
      assert.equal(Boolean(button), true, `extra key ${label}`);
      await view.dispatch(button, new view.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      await view.dispatch(button, new view.window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
    },
    async reconnect() { const button = view.container.querySelector('button[aria-label="Reconnect terminal"]'); assert.equal(Boolean(button), true); assert.equal(button.disabled, false); await view.dispatch(button, new view.window.MouseEvent('click', { bubbles: true })); await lifetime.settle(); },
    status() { return view.container.querySelector('.terminal-status-dot')?.className; },
  };
}
