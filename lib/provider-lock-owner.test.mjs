// New N owner. Natural real 15s heartbeat; only this NEW case has a 25s bound.
// No manual callback invocation, shortened timers, private env input or SDK census.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deferred, loadBackend } from './backend-ownership.fixture.mjs';
import { ownedBackendNativeRoot } from './backend-native-root.fixture.mjs';
import { observePrivateProviderLock } from './provider-lock-owner.fixture.mjs';

// Named source-fault target. No assertions, callback release, restore or native
// operations are changed by the independent observer-join omission control.
async function removeAfterPrivateLockJoin(observer, root, removed) {
  await observer.joinAfterRelease();
  assertNativeStatuses(observer);
  await rm(root, { recursive: true, force: true });
  removed.resolve();
}

test('natural actual heartbeat callback child is joined after public release before private-root rm', { timeout: 25000 }, async t => {
  const native = await ownedBackendNativeRoot(t);
  const root = await mkdtemp(join(native.root, 'provider-lock-')), file = join(root, 'auth.json');
  const updateEntered = deferred(), updateGate = deferred(), heartbeat = deferred(), callbackGate = deferred(), removed = deferred();
  let observer, updating, removal, armed = false, selectedStat = false, callbackSawRoot, proved = false;
  // Domain collector registered before writing auth or admitting a lock; on any
  // incomplete proof it retains this owned root AND fails the test's after hook.
  native.closeWith(async () => {
    updateGate.resolve(); callbackGate.resolve();
    const errors = [];
    for (const work of [updating, removal]) if (work) {
      try { await work; } catch (error) { errors.push(error); }
    }
    if (observer) {
      try { observer.markReleased(); } catch (error) { errors.push(error); }
      try { await observer.joinAfterRelease(); } catch (error) { errors.push(error); }
      try { observer.restore(); } catch (error) { errors.push(error); }
    }
    if (!proved) errors.push(new Error('Natural heartbeat ownership proof incomplete'));
    if (errors.length) throw new AggregateError(errors);
  });
  try {
    await writeFile(file, '{}', { mode: 0o600 });
    observer = observePrivateProviderLock(file, { afterCallback(event) {
      if (!armed || selectedStat || event.name !== 'stat') return;
      selectedStat = true;
      // Real stat's original proper-lockfile callback has ALREADY returned and
      // admitted its native utimes child. This is a separate observation child,
      // not a fabricated still-pending native stat callback or native-idle seam.
      assert.equal(event.error, null);
      heartbeat.resolve();
      return (async () => {
        await callbackGate.promise;
        callbackSawRoot = existsSync(root); // Scalar even in early-rm control.
        if (callbackSawRoot) await writeFile(join(root, 'heartbeat-observer-child'), 'joined actual callback child\n');
      })();
    } });
    const store = await loadBackend(new URL('./provider-credential-store.ts', import.meta.url), {
      'proper-lockfile': observer.lockfile,
    }, { actual: true });
    updating = store.updateStoredCredentials(file, async () => {
      assert.deepEqual(observer.assertActiveIdentity(), { stale: 30000, update: 15000 });
      armed = true; updateEntered.resolve(); await updateGate.promise;
      return { result: 'actual-update-complete', changed: false };
    });
    void updating.catch(() => {}); // Retain the original outcome for the domain collector.
    await Promise.race([updateEntered.promise, updating.then(() => { throw new Error('Update skipped its real locked callback'); })]);
    await Promise.race([heartbeat.promise, updating.then(() => { throw new Error('Update ended before natural heartbeat'); })]);
    updateGate.resolve();
    assert.equal(await updating, 'actual-update-complete');
    observer.markReleased();
    assert.equal(observer.snapshot().some(record => record.name === 'stat' && record.callbackReturned && !record.finished), true,
      'release completed while real callback observation child remains owned');
    removal = removeAfterPrivateLockJoin(observer, root, removed);
    void removal.catch(() => {});
    // Positive enters the real collector and blocks on actual registered child
    // work. Omitted-join control reaches actual completed rm instead. Neither
    // checkpoint is an invented timer flush or an idle assertion.
    await Promise.race([observer.joinEntered, removed.promise, removal.then(() => { throw new Error('Removal lacked its checkpoint'); })]);
    callbackGate.resolve();
    await removal;
    // Independent real join protects fault cleanup too, without repairing the
    // earlier root-order predicate. Native original callback errors stay logged.
    await observer.joinAfterRelease();
    assert.equal(callbackSawRoot, true, 'actual heartbeat callback child ran before private-root removal');
    assert.equal(existsSync(root), false);
    assert.equal(observer.snapshot().every(record => record.finished), true);
    assertNativeStatuses(observer);
    observer.restore();
    proved = true;
  } finally {
    updateGate.resolve(); callbackGate.resolve();
    if (updating) await Promise.allSettled([updating]);
    if (removal) await Promise.allSettled([removal]);
    if (observer) await Promise.allSettled([observer.joinAfterRelease()]);
  }
});

function assertNativeStatuses(observer) {
  for (const record of observer.snapshot()) {
    if (record.nativeError == null) continue;
    // The unmodified SDK lock callback deliberately ignores utimes after its
    // own lock.released flag. Keep exact statuses; no generic ENOENT suppression.
    assert.equal(record.name, 'utimes');
    assert.equal(record.nativeError.code, 'ENOENT');
    assert.equal(record.lockReleasedAtCallback, true);
  }
}
