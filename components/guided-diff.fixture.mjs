import assert from 'node:assert/strict';
import { act } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';

/** Transport-only domain for the existing Cards/Pierre real-renderer fixture. */
export function guidedReadDomain() {
  const plans = [], requests = [], bodies = [], failures = [];
  const closing = new Error('Guided domain closed'); let closed = false;
  return {
    requests, closing,
    expect(path, query) {
      const gate = deferred();
      const ticket = { path, query, gate, settled: false, bodyCalls: 0 };
      plans.push(ticket);
      ticket.deliver = async (payload, error) => {
        assert.equal(ticket.bodyCalls, 1, 'actual body must be entered');
        await act(async () => { ticket.settled = true; if (error) gate.reject(error); else gate.resolve(payload); });
      };
      return ticket;
    },
    async fetch(input, init = {}) {
      try {
        assert.equal(closed, false, 'domain read admission open');
        const url = new URL(String(input), 'https://fixture.invalid');
        const ticket = plans.shift(); assert.ok(ticket, `unplanned ${url.pathname} ${url.search}`);
        assert.equal(url.origin, 'https://fixture.invalid'); assert.equal(url.pathname, ticket.path);
        assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.body, undefined);
        assert.deepEqual([...url.searchParams].sort(), Object.entries(ticket.query).sort());
        assert.ok(init.signal); ticket.signal = init.signal; requests.push(ticket);
        return { status: 200, ok: true, json() {
          ticket.bodyCalls++;
          const body = ticket.gate.promise.finally(() => { ticket.bodyReturned = true; });
          // Domain owns body settlement; the parent fixture independently owns original
          // production continuations/errors. Expected body rejections stay distinct.
          body.catch(() => {}); bodies.push(body); return body;
        } };
      } catch (error) { failures.push(error); throw error; }
    },
    release() {
      closed = true;
      for (const request of requests) if (!request.settled) { request.settled = true; request.gate.reject(closing); }
    },
    async join() {
      await Promise.allSettled(bodies);
      if (failures.length) throw new AggregateError(failures, 'Guided transport failures');
    },
  };
}
