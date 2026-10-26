// Additive N witness: one natural, unchanged 15s heartbeat; NEW 25s case budget.
// No observer child gate: a real stat result is withheld before library delivery.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deferred, loadBackend } from './backend-ownership.fixture.mjs';
import { ownedBackendNativeRoot } from './backend-native-root.fixture.mjs';
import { observePrivateProviderLock } from './provider-lock-owner.fixture.mjs';
import { privateLockStatDelivery } from './provider-lock-delivery.fixture.mjs';

// Independent source fault removes ONLY this observer await. All real callback
// delivery, final joins and primitive native-admission observations remain.
async function removeAfterFullNativeJoin(observer, root, removed, state, port) {
  await observer.joinAfterRelease();
  assertOperationalStatuses(observer);
  await rm(root, { recursive: true, force: true });
  state.removedTooEarly = port.snapshot().holdingNativeResult;
  removed.resolve(); // Actual completed native rm checkpoint, not an idle token.
}

function assertOperationalStatuses(observer) {
  for (const record of observer.snapshot()) {
    if (record.nativeError == null) continue;
    // Exact native utimes error is an operational value handled by the actual
    // closed-lock callback, not a thrown fixture failure or blanket suppression.
    assert.equal(record.name, 'utimes');
    assert.equal(record.nativeError.code, 'ENOENT');
  }
}

test('actual natural heartbeat stat delivery stays owned across store release until native descendants join before rm', { timeout: 25000 }, async t => {
  const native = await ownedBackendNativeRoot(t);
  const root = await mkdtemp(join(native.root, 'delivery-')), file = join(root, 'auth.json');
  const updateEntered = deferred(), updateGate = deferred(), removed = deferred();
  const state = { removedTooEarly: undefined }, caseFailures = [];
  let observer, port, updating, removal, proved = false;
  // All cleanup/provisioning ownership precedes auth writes, fs interposition
  // and native lock admission. Failed/partial proof fails after-hook and retains.
  native.closeWith(async () => {
    updateGate.resolve();
    const errors = [...caseFailures];
    try { port?.releaseDelivery(); } catch (error) { errors.push(error); }
    for (const work of [updating, removal]) if (work) {
      try { await work; } catch (error) { errors.push(error); }
    }
    if (observer) {
      try { observer.markReleased(); } catch (error) { errors.push(error); }
      try { await observer.joinAfterRelease(); } catch (error) { errors.push(error); }
    }
    if (port) {
      try { await port.joinAfterRelease(); } catch (error) { errors.push(error); }
    }
    // Stack order: observer restores its captured lower port, then port restores
    // actual graceful-fs. Attempt both independently; keep original errors.
    try { observer?.restore(); } catch (error) { errors.push(error); }
    try { port?.restore(); } catch (error) { errors.push(error); }
    if (!proved) errors.push(new Error('Native delivery/root-lifetime proof incomplete'));
    if (errors.length) throw new AggregateError(errors);
  });
  try {
    await writeFile(file, '{}', { mode: 0o600 });
    port = privateLockStatDelivery(file, root); // Lower external-completion port first.
    observer = observePrivateProviderLock(file); // No afterCallback/observer child gate.
    assert.equal(port.lockfile, observer.lockfile);
    assert.equal(port.lockEntry, observer.lockEntry);
    assert.equal(port.lockPath, observer.lockPath);
    const store = await loadBackend(new URL('./provider-credential-store.ts', import.meta.url), {
      'proper-lockfile': observer.lockfile,
    }, { actual: true });
    updating = store.updateStoredCredentials(file, async credentials => {
      assert.deepEqual(observer.assertActiveIdentity(), { stale: 30000, update: 15000 });
      port.armHeartbeat(); updateEntered.resolve(); await updateGate.promise;
      credentials.synthetic = { type: 'api_key', key: 'SYNTHETIC-DELIVERY-WITNESS' };
      return { result: 'actual store/release complete', changed: true };
    });
    void updating.catch(() => {}); // Original outcome retained for independent owner join.
    await Promise.race([updateEntered.promise, updating.then(() => { throw new Error('Real locked update callback skipped'); })]);
    await Promise.race([port.statEntered, updating.then(() => { throw new Error('Store ended before actual native stat result'); })]);
    const held = port.snapshot(), heldStat = held.records.find(record => record.gated);
    assert.equal(held.registeredTimerObserved, true);
    assert.equal(held.holdingNativeResult, true);
    assert.equal(heldStat.timerFired, true, 'actual registered timer reached its real stat call');
    assert.equal(heldStat.nativeResultReceived, true);
    assert.equal(heldStat.nativeError == null, true);
    assert.equal(heldStat.delivered, false, 'library stat callback has NOT run');
    assert.equal(heldStat.callbackReturned, false);
    // Release the actual store lock while that real result is still undelivered.
    updateGate.resolve();
    assert.equal(await updating, 'actual store/release complete');
    observer.markReleased();
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      synthetic: { type: 'api_key', key: 'SYNTHETIC-DELIVERY-WITNESS' },
    });
    assert.equal(existsSync(port.lockPath), false, 'actual release removed its private lock directory');
    assert.equal(port.snapshot().holdingNativeResult, true);
    assert.equal(observer.snapshot().some(record => record.name === 'stat' && !record.callbackReturned && !record.finished), true,
      'real observer still owns the undelivered native callback, not an observer child');
    removal = removeAfterFullNativeJoin(observer, root, removed, state, port);
    void removal.catch(() => {});
    const checkpoint = await Promise.race([
      observer.joinEntered.then(() => 'join-entered'),
      removed.promise.then(() => 'removed'),
      removal.then(() => { throw new Error('Native cleanup missed its checkpoint'); }),
    ]);
    const beforeDelivery = {
      rootPresent: existsSync(root),
      libraryStatStillPending: observer.snapshot().some(record => record.name === 'stat' && !record.callbackReturned && !record.finished),
      realResultHeld: port.snapshot().holdingNativeResult,
      checkpoint,
    };
    // Preserve this held-checkpoint sample, then ALWAYS deliver/join the real
    // callback before checking red/green scalars. A mutant must demonstrate the
    // actual post-rm native utimes admission, not stop at an earlier assertion.
    port.releaseDelivery();
    await removal;
    await observer.joinAfterRelease(); // Independent fault-safe actual native join.
    await port.joinAfterRelease();
    const finished = port.snapshot(), delivered = finished.records.find(record => record.gated);
    const actualPostReleaseUtimes = finished.records.filter(record => record.name === 'utimes' && record.releasedAtNativeCall);
    assert.equal(delivered.delivered, true);
    assert.equal(delivered.callbackReturned, true);
    assert.equal(actualPostReleaseUtimes.length, 1, 'actual delayed stat callback admitted its real native utimes descendant');
    assert.equal(actualPostReleaseUtimes[0].nativeResultReceived, true);
    assert.equal(actualPostReleaseUtimes[0].callbackReturned, true);
    assert.equal(actualPostReleaseUtimes[0].nativeError?.code, 'ENOENT');
    assert.equal(finished.records.every(record => record.finished), true);
    assert.equal(observer.snapshot().every(record => record.finished), true);
    assert.equal(observer.snapshot().filter(record => record.name === 'rmdir').length, 1,
      'actual release rmdir callback is included in full native ownership');
    assertOperationalStatuses(observer);
    // The ONLY omission control must turn both primitive values true. Neither
    // value depends on a held observer child or an artificial filesystem error.
    assert.deepEqual({
      removedTooEarly: state.removedTooEarly,
      nativeCallAfterRoot: actualPostReleaseUtimes[0].rootAbsentAtNativeCall,
    }, { removedTooEarly: false, nativeCallAfterRoot: false });
    assert.deepEqual(beforeDelivery, {
      rootPresent: true, libraryStatStillPending: true, realResultHeld: true, checkpoint: 'join-entered',
    });
    assert.equal(existsSync(root), false);
    observer.restore(); port.restore();
    proved = true;
  } catch (error) {
    caseFailures.push(error); throw error;
  } finally {
    updateGate.resolve();
    // Do not replace a primary assertion/callback error with a finalizer error.
    // Independent owner after-hook retains both and still attempts every join.
    try { port?.releaseDelivery(); } catch (error) { caseFailures.push(error); }
  }
});
