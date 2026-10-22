import assert from 'node:assert/strict';
import { act } from 'react';
import { deferred } from './async.fixture.mjs';

// A transport-only double: real components still own effects, parsing and state.
// Headers arrive immediately; JSON deliberately remains readable after abort.
// No timers, real network, AbortController replacement or component imports.
export function ignoredAbortFetch(t, pathname) {
  const requests = [], bodies = [], tasks = [], failures = [];
  const closingError = new Error('Ignored-abort fetch fixture disposed before body delivery');
  let closed = false, disposal;
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    let url;
    try {
      assert.equal(closed, false, 'fixture fetch admission is closed');
      url = new URL(String(input), 'https://fixture.invalid/');
      assert.equal(url.pathname, pathname, 'unexpected request must not reach the network');
      assert.equal(init.method ?? 'GET', 'GET');
      assert.ok(init.signal instanceof AbortSignal, 'the production effect must supply its real signal');
    } catch (error) { failures.push(error); throw error; }
    const body = deferred();
    const jsonTasks = [];
    let delivered = false;
    bodies.push({ body, undelivered: () => !delivered });
    const request = {
      url, signal: init.signal, jsonCalls: 0, jsonReturned: false, jsonCompletions: 0,
      async deliver(payload) {
        assert.equal(closed, false, 'cannot deliver after fixture disposal starts');
        assert.equal(delivered, false, 'a response body can only be delivered once');
        assert.equal(request.jsonCalls, 1, 'production must have entered response.json() before delivery');
        await act(async () => {
          delivered = true;
          body.resolve(payload);
          await Promise.all(jsonTasks.map(task => task.work));
        });
        assert.equal(request.jsonReturned, true, 'JSON actually returned, rather than being cancelled');
      },
    };
    requests.push(request);
    return {
      ok: true, status: 200,
      json() {
        const completion = deferred();
        request.jsonCalls++;
        const work = (async () => {
          try {
            const payload = await body.promise;
            request.jsonReturned = true;
            return payload;
          } finally {
            request.jsonCompletions++;
            completion.resolve();
          }
        })();
        // Observe immediately without replacing the rejecting promise returned
        // to production. Completion is signalled only by the actual finally.
        void work.catch(() => {});
        const task = { work, completion: completion.promise };
        jsonTasks.push(task); tasks.push(task);
        return work;
      },
    };
  });
  return {
    requests,
    // One shared promise covers admission closure, owner unmount and joining.
    // The caller registers this before mount; no t.after ordering is assumed.
    dispose(unmount) {
      if (!disposal) {
        closed = true;
        disposal = Promise.resolve().then(async () => {
          try { await unmount(); } catch (error) { failures.push(error); }
          try {
            await act(async () => {
              for (const { body, undelivered } of bodies) {
                if (undelivered()) body.reject(closingError);
              }
              let joined = 0;
              while (joined < tasks.length) {
                const batch = tasks.slice(joined);
                joined = tasks.length;
                await Promise.all(batch.map(task => task.completion));
                const results = await Promise.allSettled(batch.map(task => task.work));
                for (const result of results) {
                  if (result.status === 'rejected' && result.reason !== closingError) failures.push(result.reason);
                }
              }
            });
          } catch (error) { failures.push(error); }
          if (failures.length === 1) throw failures[0];
          if (failures.length) throw new AggregateError(failures, 'Ignored-abort fixture disposal failed');
        });
        void disposal.catch(() => {});
      }
      return disposal;
    },
  };
}
