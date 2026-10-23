import assert from 'node:assert/strict';
import { act } from 'react';
import { createTaskOwner, deferred } from './async.fixture.mjs';

// Controlled HTTP only: no React/state-machine double and no native/network proof.
// Register this BEFORE mounting. bind(view) lets teardown stop React admission,
// release every accepted response/body, join port work/React commits, then restore.
export function controlledLeafFetch(t, route) {
  const owner = createTaskOwner(), failures = [], requests = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let view, closing = false;
  function checked(run) {
    try { return run(); }
    catch (error) { failures.push(error); throw error; }
  }
  const fetch = (input, options = {}) => {
    try {
      return checked(() => {
        assert.equal(closing, false, 'request admitted during teardown');
        const url = new URL(String(input), 'https://fixture.invalid');
        const response = deferred(), body = deferred();
        const request = { url, options, response, body, jsonCalls: 0, answered: false };
        // Validate BEFORE recording/admitting the request, retaining caught failures.
        const automatic = route(request);
        requests.push(request);
        request.fetchWork = owner.track(`${options.method ?? 'GET'} ${url.pathname}`, response.promise);
        request.reply = (data, status = 200) => {
          request.answered = true;
          body.resolve(data);
          response.resolve({ ok: status >= 200 && status < 300, status,
            json() {
              request.jsonCalls++;
              return owner.track(`JSON body ${url.pathname}`, body.promise);
            },
          });
        };
        if (automatic !== undefined) request.reply(automatic);
        return request.fetchWork;
      });
    } catch (error) {
      // Production may catch this rejection. failures remains live through cleanup.
      return Promise.reject(error);
    }
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  t.after(async () => {
    const errors = [];
    closing = true;
    try { await view?.unmount(); } catch (error) { errors.push(error); }
    try {
      // Named admitted HTTP/body work only, not an idle/microtask-flush helper.
      // The leaf consumers have no further async boundary after these bodies;
      // act joins the resulting React cleanup/commits, not arbitrary background IO.
      await act(async () => {
        for (const request of requests) {
          if (!request.answered) request.reply({ error: 'fixture teardown' }, 503);
        }
        await Promise.allSettled(requests.map(request => request.fetchWork));
      });
      await owner.join();
    } catch (error) { errors.push(error); }
    try { await view?.dispose(); } catch (error) { errors.push(error); }
    try {
      if (previous) Object.defineProperty(globalThis, 'fetch', previous);
      else delete globalThis.fetch;
    } catch (error) { errors.push(error); }
    errors.push(...failures);
    if (errors.length) throw new AggregateError(errors, 'Leaf HTTP/React cleanup failed');
  });
  return {
    requests,
    bind(next) { view = next; return next; },
    check: checked,
    assertHealthy() { assert.deepEqual(failures, [], 'caught transport/callback failures'); },
    reply(request, data = {}, status = 200) {
      assert.ok(request, 'named request must have arrived before release');
      return owner.track('response release including body/React commits and failure check', (async () => {
        await act(async () => { request.reply(data, status); await request.fetchWork; });
        assert.deepEqual(failures, [], 'caught transport/callback failures');
      })());
    },
  };
}

export function buttonWithText(container, text) {
  const buttons = [...container.querySelectorAll('button')].filter(button => button.textContent.trim() === text);
  assert.equal(buttons.length, 1, `exactly one button: ${text}`);
  return buttons[0];
}

export async function click(view, element) {
  assert.ok(element, 'click target exists');
  await view.dispatch(element, new view.window.MouseEvent('click', { bubbles: true }));
}

export async function inputText(view, element, text) {
  assert.ok(element, 'input target exists');
  // Use the realm's native setter so React's real input/change plugin observes it.
  const prototype = element instanceof view.window.HTMLTextAreaElement
    ? view.window.HTMLTextAreaElement.prototype : view.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
  await view.dispatch(element, new view.window.Event('input', { bubbles: true }));
}
