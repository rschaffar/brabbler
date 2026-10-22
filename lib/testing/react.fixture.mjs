import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';

let activeMount;

// Real React/client effects in an emulated DOM, not proof of native layout,
// capture, media or networking. One fixture owns these realm globals at a time.
export async function mount(t, element, { strict = true, setup } = {}) {
  if (activeMount) throw new Error('A mounted DOM is already owned; render peers in one root or dispose it first');
  const owner = Symbol('mounted DOM');
  activeMount = owner;
  const previous = new Map();
  const installed = [];
  let window, root, active = false, unmounting, disposal;
  const unmount = () => {
    if (!unmounting) {
      unmounting = (async () => {
        if (active) { active = false; await act(() => root.unmount()); }
      })();
      void unmounting.catch(() => {});
    }
    return unmounting;
  };
  const dispose = () => {
    if (!disposal) {
      disposal = (async () => {
        const errors = [];
        try { await unmount(); } catch (error) { errors.push(error); }
        try { window?.close(); } catch (error) { errors.push(error); }
        for (const key of installed.toReversed()) {
          try {
            const descriptor = previous.get(key);
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
          } catch (error) { errors.push(error); }
        }
        if (activeMount === owner) activeMount = undefined;
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'Mounted cleanup failed');
      })();
      void disposal.catch(() => {});
    }
    return disposal;
  };
  const render = next => strict ? createElement(StrictMode, null, next) : next;
  let container;
  try {
    t.after(dispose);
    ({ window } = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://fixture.invalid/', pretendToBeVisual: true,
    }));
    const values = {
      window, document: window.document, navigator: window.navigator,
      Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
      Event: window.Event, KeyboardEvent: window.KeyboardEvent, PointerEvent: window.PointerEvent,
      MutationObserver: window.MutationObserver,
      getComputedStyle: window.getComputedStyle.bind(window),
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    for (const key of Object.keys(values)) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      if (descriptor && !descriptor.configurable) throw new Error(`Cannot own nonconfigurable global: ${key}`);
      previous.set(key, descriptor);
    }
    for (const [key, value] of Object.entries(values)) {
      installed.push(key);
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    await setup?.(window);
    // DOM must exist before react-dom performs browser capability detection.
    const { createRoot } = await import('react-dom/client');
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container); active = true;
    await act(() => root.render(render(element)));
  } catch (error) {
    try { await dispose(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Mount and cleanup failed'); }
    throw error;
  }
  return {
    window, container, unmount, dispose,
    async rerender(next) { if (!active) throw new Error('Mounted root is closed'); await act(() => root.render(render(next))); },
    async dispatch(target, event) {
      if (!active) throw new Error('Mounted root is closed');
      await act(() => { target.dispatchEvent(event); });
    },
  };
}

// Narrow double for an unsupported API. Real capture remains a Chromium proof.
export function pointerCaptureDouble(element) {
  const ids = new Set();
  element.setPointerCapture = id => ids.add(id);
  element.hasPointerCapture = id => ids.has(id);
  element.releasePointerCapture = id => ids.delete(id);
  return ids;
}
