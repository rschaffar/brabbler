// Ordinary owned Node child; no custom uncaughtException/rejection handlers.
import './client-native-import-snapshot.fixture.mjs';
import './client-native-boundary.fixture.mjs';
import './client-native-import-after.fixture.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { expectNativeDenial, clientNativeBoundaryStatus } from './client-native-boundary.fixture.mjs';

// Registered AFTER bootstrap: prove its first beforeEach signaled admission
// before any later per-test fixture setup, not merely before the body.
beforeEach(() => {
  const setup = clientNativeBoundaryStatus();
  assert.equal(setup.testBodyAdmission, true);
  assert.equal(setup.phase, 'active');
  assert.equal(setup.restored, 0);
});

test('actual caught denial then uncaught immediate after first per-test setup admission', async t => {
  const entered = clientNativeBoundaryStatus();
  assert.equal(entered.testBodyAdmission, true);
  assert.equal(entered.phase, 'active');
  // A caught, explicitly expected native-port denial must not restore anything.
  const error = expectNativeDenial('net.connect', () => net.connect(-1));
  assert.equal(error.code, 'PI_CLIENT_NATIVE_BOUNDARY_DENIED');
  assert.equal(clientNativeBoundaryStatus().restored, 0);
  const fired = Promise.withResolvers();
  let immediate;
  t.after(async () => {
    if (immediate !== undefined) {
      clearImmediate(immediate);
      immediate = undefined;
    }
    // An exact canceled handle has no future invocation. Release only its owned
    // completion gate too, including failed setup before scheduling that handle.
    // The real uncaught-path callback independently resolves in its finally.
    fired.resolve();
    await fired.promise;
  });
  immediate = setImmediate(() => {
    immediate = undefined;
    try { throw new Error('CNB_POST_ROOT_UNCAUGHT_CONTROL'); }
    finally { fired.resolve(); }
  });
  await fired.promise;
});
