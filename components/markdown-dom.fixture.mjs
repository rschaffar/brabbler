import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { act } from 'react';
import { mount } from '../lib/testing/react.fixture.mjs';
import { createTaskOwner } from '../lib/testing/async.fixture.mjs';

// External boundaries only. No React hooks, Markdown decisions or media state
// are replaced. No real requests, native popovers, decoding or layout are used.
export function markdownDom(t, { media = false, initiallyHidden = false } = {}) {
  const failures = [], restores = [], requests = [], scrolls = [], mediaCalls = [];
  const visibilityListeners = new Set();
  const tasks = createTaskOwner();
  let view, closing, closed = false, hidden = initiallyHidden;
  let visibilityAdds = 0, visibilityRemoves = 0;
  const restoreProperty = (object, key, descriptor) => {
    const previous = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, ...descriptor });
    restores.push(() => {
      if (previous) Object.defineProperty(object, key, previous);
      else delete object[key];
    });
  };
  const replace = (object, key, value) => restoreProperty(object, key, { writable: true, value });
  const mock = (object, key, fn) => {
    const mocked = t.mock.method(object, key, fn);
    restores.push(() => mocked.mock.restore());
  };
  const denied = name => function (...args) {
    const error = new Error(`Unexpected ${name}${closed ? ' after admission closed' : ''}: ${inspect(args)}`);
    failures.push(error);
    throw error;
  };
  const noFetch = (...args) => {
    requests.push(args);
    const error = new Error(`Unexpected fetch${closed ? ' after admission closed' : ''}: ${inspect(args)}`);
    // Keep this failure live even if a production catch handles the rejection.
    failures.push(error);
    const work = Promise.reject(error);
    void work.catch(() => {});
    if (!closed) tasks.track('unexpected fetch rejection', work);
    return work;
  };
  const dispose = () => {
    if (!closing) {
      closed = true;
      closing = (async () => {
        try { await view?.unmount(); } catch (error) { failures.push(error); }
        try { await tasks.join(); } catch (error) { failures.push(error); }
        try { assert.equal(visibilityListeners.size, 0, 'all owned visibility listeners released'); }
        catch (error) { failures.push(error); }
        try { await view?.dispose(); } catch (error) { failures.push(error); }
        for (const restore of restores.toReversed()) {
          try { restore(); } catch (error) { failures.push(error); }
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, 'Markdown DOM fixture failed');
      })();
      void closing.catch(() => {});
    }
    return closing;
  };
  // Registered before mocks, production imports or mounting; no after-hook order
  // is needed for unmount -> fixture task join -> realm/global restoration.
  t.after(dispose);
  const consoleError = console.error;
  mock(console, 'error', (...args) => {
    failures.push(new Error(`Unexpected console.error: ${inspect(args)}`));
    consoleError.apply(console, args);
  });
  replace(globalThis, 'fetch', noFetch);
  // Imports precede realm creation: close host constructors now, not only in setup.
  for (const name of ['EventSource', 'WebSocket', 'XMLHttpRequest']) replace(globalThis, name, denied(name));
  // Same-millisecond activations must still get distinct sequence tokens.
  if (media) mock(Date, 'now', () => 1_700_000_000_000);

  const fixture = {
    requests, scrolls, mediaCalls, visibilityListeners,
    get view() { assert.ok(view, 'mount first'); return view; },
    get visibilityAdds() { return visibilityAdds; },
    get visibilityRemoves() { return visibilityRemoves; },
    dispose,
    async mount(element) {
      assert.equal(view, undefined, 'one mounted root per fixture');
      view = await mount(t, element, { setup(window) {
        const reportError = event => failures.push(event.error ?? event.reason ?? new Error(event.message ?? 'Window error'));
        window.addEventListener('error', reportError);
        window.addEventListener('unhandledrejection', reportError);
        restores.push(() => {
          window.removeEventListener('error', reportError);
          window.removeEventListener('unhandledrejection', reportError);
        });
        replace(window, 'fetch', noFetch);
        for (const name of ['EventSource', 'WebSocket', 'XMLHttpRequest']) {
          replace(window, name, denied(name));
        }
        // Only simple authored IDs are used here. Not a CSS.escape algorithm or
        // a test of arbitrary CSS selector escaping.
        const css = window.CSS?.escape ? window.CSS : { escape(value) {
          assert.match(value, /^[a-zA-Z0-9_-]+$/);
          return value;
        } };
        replace(globalThis, 'CSS', css);
        // These tests never open a popover. jsdom versions without this selector
        // still need to permit LocalFileLink's normal-click dismissal check.
        const matches = window.Element.prototype.matches;
        try { window.document.createElement('span').matches(':popover-open'); }
        catch {
          mock(window.Element.prototype, 'matches', function (selector) {
            return selector === ':popover-open' ? false : matches.call(this, selector);
          });
        }
        replace(window.HTMLElement.prototype, 'scrollIntoView', function (options) {
          scrolls.push({ element: this, options });
        });
        if (media) {
          restoreProperty(window.document, 'hidden', { get: () => hidden });
          const add = window.document.addEventListener, remove = window.document.removeEventListener;
          mock(window.document, 'addEventListener', function (type, listener, options) {
            if (type === 'visibilitychange') { visibilityAdds++; visibilityListeners.add(listener); }
            return add.call(this, type, listener, options);
          });
          mock(window.document, 'removeEventListener', function (type, listener, options) {
            if (type === 'visibilitychange') { visibilityRemoves++; visibilityListeners.delete(listener); }
            return remove.call(this, type, listener, options);
          });
          for (const method of ['pause', 'load']) {
            mock(window.HTMLMediaElement.prototype, method, function () {
              mediaCalls.push({ element: this, method, src: this.getAttribute('src') });
            });
          }
        }
      } });
      return view;
    },
    async click(element, options = {}) {
      assert.ok(element, 'click target exists');
      let reached = false, preventedByApplication;
      // React's root receives the event first. Intercept only the subsequent
      // browser default, so a genuine unhandled href cannot navigate jsdom.
      const browserDefault = event => {
        reached = true; preventedByApplication = event.defaultPrevented;
        event.preventDefault();
      };
      view.window.document.addEventListener('click', browserDefault);
      try {
        await view.dispatch(element, new view.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
      } finally { view.window.document.removeEventListener('click', browserDefault); }
      assert.equal(reached, true, 'event passed through the real React root');
      return preventedByApplication;
    },
    async setHidden(next) {
      assert.equal(media, true, 'visibility capability is enabled only for media tests');
      hidden = next;
      await act(() => { view.window.document.dispatchEvent(new view.window.Event('visibilitychange')); });
    },
  };
  return fixture;
}

export function byText(root, selector, text) {
  const matches = [...root.querySelectorAll(selector)].filter(node => node.textContent === text);
  assert.equal(matches.length, 1, `exactly one ${selector} named ${JSON.stringify(text)}`);
  return matches[0];
}

// pause/load are unsupported-API doubles on actual DOM media nodes. This proves
// production cleanup order/source detachment, NOT native playback or I/O closure.
export function assertMediaRelease(calls, element, src) {
  assert.deepEqual(calls.filter(call => call.element === element).map(({ method, src: value }) => [method, value]), [
    ['pause', src], ['load', null],
  ]);
  assert.equal(element.hasAttribute('src'), false);
}
