import "../lib/testing/client-native-boundary.fixture.mjs";
// UNEXECUTED bounded capability/cleanup witnesses, not product policy replicas.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { lowerFixture } from './lower-account-controls.fixture.mjs';

// The fixture's own negative must not fail the outer Node test via an after hook.
// Retain and independently run every registered cleanup even if a peer rejects.
async function privateFixture(callback) {
  const hooks = [], cleanupErrors = [];
  let primary;
  try { await callback(await lowerFixture({ after(dispose) { hooks.push(dispose); } })); }
  catch (error) { primary = error; }
  finally { for (const dispose of hooks) { try { await dispose(); } catch (error) { cleanupErrors.push(error); } } }
  if (primary) throw new AggregateError([primary, ...cleanupErrors], 'negative fixture witness failed');
  return cleanupErrors;
}

test('lower capability port: failed setup joins actual sendAgentCommand body/catch/finally before returning without a view', async () => {
  let caught = false, finalized = false;
  const errors = await privateFixture(async x => {
    const { f, graph: c } = x;
    f.route('POST', '/api/agent/synthetic-lifetime', { body: { type: 'reload' }, reply: { status: 503, data: { error: 'synthetic rejected reload' } } });
    const setupError = new Error('synthetic setup failure');
    await assert.rejects(x.mount(h('div'), { setup() {
      const work = c.sendAgentCommand('synthetic-lifetime', { type: 'reload' })
        .catch(() => { caught = true; }).finally(() => { finalized = true; });
      x.own('lifetime.actual-command', work);
      throw setupError;
    } }), error => error === setupError);
    assert.equal(caught, true); assert.equal(finalized, true);
    assert.equal(f.view, undefined);
    assert.equal(f.works.length, 1); assert.equal(f.works[0].settled, true);
    assert.equal(x.writes('/api/agent/synthetic-lifetime').length, 1);
    x.assertWrite('/api/agent/synthetic-lifetime', 0, { type: 'reload' });
  });
  assert.equal(errors.length, 0);
});

test('lower capability port: caught unexpected HTTP remains in live collector through failed setup and cleanup', async () => {
  const errors = await privateFixture(async x => {
    const setupError = new Error('synthetic setup failure after caught unexpected route');
    await assert.rejects(x.mount(h('div'), { setup() {
      x.own('lifetime.caught-unexpected-route', fetch('/api/not-admitted').catch(() => {}));
      throw setupError;
    } }), error => error === setupError);
    assert.throws(() => x.f.check(), /Settings fixture failures/);
  });
  assert.equal(errors.length, 1, 'cleanup retains admission defect caught by production');
  assert.match(errors[0].message, /Settings work\/cleanup failures/);
});
