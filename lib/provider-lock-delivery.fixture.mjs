// N-only controlled external completion port, installed UNDER the ordinary
// observer. Only one real heartbeat stat result's delivery is withheld. Native
// calls/results/this/arguments and proper-lockfile/timer policy remain actual.
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
export function privateLockStatDelivery(file, root) {
  const lockEntry = require.resolve('proper-lockfile'), fromLock = createRequire(lockEntry);
  const lockfile = require(lockEntry), internals = fromLock('./lib/lockfile.js'), fs = fromLock('graceful-fs');
  const canonical = realpathSync(file), privateRoot = realpathSync(root), lockPath = `${canonical}.lock`;
  assert.equal(dirname(canonical), privateRoot, 'completion port targets only this owned private auth file');
  const originals = new Map(), pending = new Set(), records = [], failures = [];
  let armedLock, registeredTimer, selected = false, opened = false, held, restored = false, enterStat;
  const statEntered = new Promise(resolve => { enterStat = resolve; });
  const current = () => internals.getLocks()[canonical];
  const selectedPath = path => typeof path === 'string' && resolve(path) === lockPath;
  const finish = record => {
    try { record.finished = true; pending.delete(record); record.resolve(); }
    catch (error) { failures.push(error); throw error; }
  };
  try {
    for (const name of ['stat', 'utimes']) {
      const descriptor = Object.getOwnPropertyDescriptor(fs, name), original = fs[name];
      assert.equal(typeof original, 'function');
      const wrapped = function (...args) {
        if (!selectedPath(args[0])) return Reflect.apply(original, this, args);
        const callback = args.at(-1);
        assert.equal(typeof callback, 'function');
        const gateThisResult = name === 'stat' && armedLock && !selected && current() === armedLock;
        if (gateThisResult) selected = true;
        let resolveDone;
        const done = new Promise(resolve => { resolveDone = resolve; });
        const record = { name, done, resolve: resolveDone, gated: Boolean(gateThisResult), finished: false,
          nativeResultReceived: false, delivered: false, callbackReturned: false, nativeError: undefined,
          timerFired: Boolean(gateThisResult && armedLock.updateTimeout === null),
          rootAbsentAtNativeCall: false, releasedAtNativeCall: armedLock?.released === true };
        records.push(record); pending.add(record);
        try { record.rootAbsentAtNativeCall = !existsSync(privateRoot); }
        catch (error) { failures.push(error); } // Recorder failure never replaces native delegation.
        args[args.length - 1] = function (...nativeValues) {
          const deliver = () => {
            if (record.delivered) return;
            record.delivered = true;
            if (held?.record === record) held = undefined;
            try {
              // Exactly the native values and callback receiver; no synthetic
              // Stats, error conversion, copied lock decision or callback child.
              return Reflect.apply(callback, this, nativeValues);
            } catch (error) { failures.push(error); throw error; }
            finally { record.callbackReturned = true; finish(record); }
          };
          try {
            record.nativeResultReceived = true; record.nativeError = nativeValues[0];
            if (gateThisResult && !opened) {
              held = { record, deliver };
              enterStat(); // Actual native-result checkpoint, BEFORE library delivery.
              return;
            }
          } catch (error) { failures.push(error); return deliver(); }
          return deliver();
        };
        try {
          // Issued immediately, with original method receiver and all original
          // arguments except the completion wrapper. No native call is gated.
          return Reflect.apply(original, this, args);
        } catch (error) {
          failures.push(error);
          if (!record.nativeResultReceived) finish(record);
          throw error;
        }
      };
      originals.set(name, { descriptor, wrapped });
      Object.defineProperty(fs, name, { ...descriptor, value: wrapped });
    }
  } catch (error) {
    const errors = [error];
    for (const [name, { descriptor }] of originals) {
      try { Object.defineProperty(fs, name, descriptor); } catch (failure) { errors.push(failure); }
    }
    throw new AggregateError(errors, 'Private completion-port installation failed');
  }
  return {
    lockfile, lockEntry, lockPath, statEntered,
    armHeartbeat() {
      assert.equal(armedLock, undefined, 'only one heartbeat delivery is selected');
      const lock = current();
      assert.ok(lock); assert.equal(lock.options.fs, fs); assert.equal(lock.lockfilePath, lockPath);
      assert.equal(lock.options.stale, 30000); assert.equal(lock.options.update, 15000);
      assert.ok(lock.updateTimeout, 'unmodified library already registered its real heartbeat');
      // Read-only pinned Node timer diagnostic, never assigning/invoking it.
      assert.equal(lock.updateTimeout._idleTimeout, 15000, 'actual registered native timer uses the original duration');
      armedLock = lock; registeredTimer = lock.updateTimeout;
    },
    releaseDelivery() {
      opened = true; // Also handles exceptional cleanup before native result arrival.
      return held?.deliver();
    },
    async joinAfterRelease() {
      const active = current();
      while (pending.size) await Promise.all([...pending].map(record => record.done));
      if (active || current()) failures.push(new Error('Completion port still owns a future live-lock heartbeat'));
      if (failures.length) throw new AggregateError([...failures], 'Private completion-port callback/recorder/finalizer failures');
    },
    restore() {
      assert.equal(pending.size, 0); assert.equal(held, undefined); assert.equal(current(), undefined);
      if (restored) return;
      const errors = [];
      // Outer observer must restore first, exposing these exact lower wrappers.
      for (const [name, { descriptor, wrapped }] of originals) {
        if (fs[name] !== wrapped) errors.push(new Error(`Completion-port descriptor replaced: ${name}`));
        try { Object.defineProperty(fs, name, descriptor); } catch (error) { errors.push(error); }
      }
      restored = true;
      if (errors.length) throw new AggregateError(errors, 'Private completion-port restoration failed');
    },
    snapshot: () => Object.freeze({
      selected, holdingNativeResult: Boolean(held), registeredTimerObserved: Boolean(registeredTimer),
      records: Object.freeze(records.map(record => Object.freeze({ name: record.name, gated: record.gated,
        finished: record.finished, nativeResultReceived: record.nativeResultReceived, delivered: record.delivered,
        callbackReturned: record.callbackReturned, timerFired: record.timerFired, nativeError: record.nativeError,
        rootAbsentAtNativeCall: record.rootAbsentAtNativeCall, releasedAtNativeCall: record.releasedAtNativeCall }))),
    }),
  };
}
