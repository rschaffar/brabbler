import assert from 'node:assert/strict';
import { act } from 'react';
import { createJiti } from 'jiti';
import { settingsFixture } from './settings.fixture.mjs';

// Capability wrapper, NOT a second DOM/HTTP/work controller. Parent fixture owns
// failure collectors, full work joins, ignored-abort bodies and failed setup.
export async function lowerFixture(t) {
  const sources = [], sourceAdmissions = [], popups = [], copies = [];
  let install, fail, observe, registerSettle, stopping = false, copyError = null;
  const capture = callback => {
    try { return callback(); } catch (error) { fail(error); throw error; }
  };
  class Source {
    readyState = 0;
    closeCount = 0;
    onmessage = null;
    onerror = null;
    constructor(url, init) {
      capture(() => {
        assert.equal(stopping, false, 'no source after disposal admission closes');
        assert.equal(init, undefined);
        assert.equal(sourceAdmissions.shift(), url, 'one required exact OAuth source admission');
      });
      this.url = url;
      sources.push(this);
    }
    close() { this.readyState = 2; this.closeCount++; }
  }
  const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
  const f = await settingsFixture(t, {
    loadGraph: () => jiti.import('./lower-account-controls.fixture.tsx'),
    capabilities(port) {
      install = port.save; fail = port.fail; observe = port.observe;
      registerSettle = callback => port.onSettle(callback);
      install(globalThis, 'EventSource', Source);
      port.onSettle(() => {
        stopping = true;
        const errors = [];
        for (const source of sources) { try { source.close(); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'OAuth source settlement');
      });
    },
  });
  const graph = await f.load();
  const api = {
    f, graph, sources, copies, popups,
    onSettle(callback) { registerSettle(callback); },
    own(label, work) { observe(label, work); return work; },
    allowSource(url) { sourceAdmissions.push(url); },
    rejectCopy(error) { copyError = error; },
    node(selector) {
      const node = f.view.window.document.body.querySelector(selector);
      assert.equal(node !== null, true, `node ${selector}`); return node;
    },
    text() { return f.view.window.document.body.textContent; },
    button(text, root = f.view.window.document.body) { return f.button(text, root); },
    async mount(element, options = {}) {
      return f.mount(element, { ...options, setup: async window => {
        install(window, 'EventSource', Source);
        install(window, 'open', (url, target, features) => capture(() => {
          assert.equal(new URL(url).protocol, 'https:');
          assert.equal(target, '_blank'); assert.equal(features, 'noopener,noreferrer');
          popups.push(url); return null; // explicitly blocked popup
        }));
        install(window.navigator, 'clipboard', { async writeText(value) {
          copies.push(value); if (copyError) throw copyError;
        } });
        install(window.HTMLDialogElement.prototype, 'showModal', function () { this.open = true; });
        install(window.HTMLDialogElement.prototype, 'close', function () {
          this.open = false; this.dispatchEvent(new window.Event('close'));
        });
        await options.setup?.(window);
      } });
    },
    async event(source, data) {
      assert.equal(sources.includes(source), true, 'owned source only');
      // Deliberately permits ignored-close delivery to exercise actual identity guards.
      await act(async () => { source.onmessage?.({ data: JSON.stringify(data) }); await f.join(); });
      f.check();
    },
    async error(source) { await act(async () => { source.onerror?.(); await f.join(); }); f.check(); },
    writes(path) { return f.requests.filter(r => r.method !== 'GET' && (!path || r.path === path)); },
    assertWrite(path, index, body, method = 'POST') {
      const request = api.writes(path)[index];
      assert.equal(Boolean(request), true, `required ${method} ${path} #${index + 1}`);
      assert.equal(request.method, method);
      assert.deepEqual(request.body, body);
      assert.equal(request.serializedBody, JSON.stringify(body), 'actual serialized body');
    },
  };
  return api;
}
