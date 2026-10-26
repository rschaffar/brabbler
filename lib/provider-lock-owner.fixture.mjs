// Fixture-only N observation of one canonical private lock. No timer changes,
// alternate fs results, global native unguard API or credential-path fallback.
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
export function observePrivateProviderLock(file, { afterCallback } = {}) {
  const lockEntry = require.resolve('proper-lockfile');
  const fromLock = createRequire(lockEntry);
  const lockfile = require(lockEntry);
  const internals = fromLock('./lib/lockfile.js');
  const fs = fromLock('graceful-fs'); // Same object as the pinned module's const fs.
  const canonical = realpathSync(file), lockPath = `${canonical}.lock`;
  const pending = new Set(), records = [], failures = [], originals = new Map();
  let released = false, restored = false, enterJoin;
  const joinEntered = new Promise(resolve => { enterJoin = resolve; });
  const selected = path => typeof path === 'string' && resolve(path) === lockPath;
  const current = () => internals.getLocks()[canonical];
  const finish = record => { record.finished = true; pending.delete(record); record.resolve(); };
  const methods = ['mkdir', 'stat', 'utimes', 'rmdir'];
  try {
    for (const name of methods) {
      const descriptor = Object.getOwnPropertyDescriptor(fs, name), original = fs[name];
      assert.equal(typeof original, 'function');
      const wrapped = function (...args) {
        if (!selected(args[0])) return Reflect.apply(original, this, args);
        const callback = args.at(-1);
        assert.equal(typeof callback, 'function', 'selected lock operation uses the real callback API');
        let resolveDone;
        const done = new Promise(resolve => { resolveDone = resolve; });
        const record = { name, done, resolve: resolveDone, finished: false, callbackReturned: false,
          admittedAfterRelease: released, nativeError: undefined, lockAtAdmission: current(), lockReleasedAtCallback: false };
        records.push(record); pending.add(record);
        args[args.length - 1] = function (...values) {
          record.nativeError = values[0];
          record.lockReleasedAtCallback = record.lockAtAdmission?.released === true;
          let result;
          try {
            // Always immediate: no awaiting an observer, queued fake callback,
            // modified return value, native result or proper-lockfile decision.
            result = Reflect.apply(callback, this, values);
          } catch (error) {
            failures.push(error); throw error;
          } finally {
            record.callbackReturned = true;
            try {
              const work = afterCallback?.(Object.freeze({ name, error: values[0], released }));
              // This is explicit observer-owned child work, NOT a claim that the
              // native stat callback is still held after it has returned.
              Promise.resolve(work).then(() => finish(record), error => { failures.push(error); finish(record); });
            } catch (error) { failures.push(error); finish(record); }
          }
          return result;
        };
        try { return Reflect.apply(original, this, args); }
        catch (error) {
          failures.push(error);
          if (!record.callbackReturned) finish(record);
          throw error;
        }
      };
      originals.set(name, { descriptor, wrapped });
      Object.defineProperty(fs, name, { ...descriptor, value: wrapped });
    }
  } catch (error) {
    // Setup is before native lock admission; independently restore all touched
    // descriptors and preserve both setup and restoration errors.
    const errors = [error];
    for (const [name, { descriptor }] of originals) {
      try { Object.defineProperty(fs, name, descriptor); } catch (failure) { errors.push(failure); }
    }
    throw new AggregateError(errors, 'Private lock observer installation failed');
  }
  return {
    lockfile, lockEntry, lockPath, joinEntered,
    assertActiveIdentity() {
      const lock = current();
      assert.ok(lock, 'real proper-lockfile owns this exact canonical auth file');
      assert.equal(lock.options.fs, fs, 'actual pinned lock uses the observed graceful-fs object');
      assert.equal(lock.lockfilePath, lockPath);
      return Object.freeze({ update: lock.options.update, stale: lock.options.stale });
    },
    markReleased() {
      assert.equal(current(), undefined, 'public store/release finished and no future heartbeat is owned');
      released = true;
    },
    async joinAfterRelease() {
      enterJoin(); // Entry checkpoint only, never an idle/work certificate.
      // Future timers are NOT idle. A live lock is an error, not a loop draining
      // a future heartbeat; no timer callback is invoked/cancelled by this API.
      const active = current();
      while (pending.size) await Promise.all([...pending].map(record => record.done));
      if (active || current()) failures.push(new Error('Private lock still active; future heartbeat unjoined'));
      if (failures.length) throw new AggregateError([...failures], 'Private lock callback ownership failed');
    },
    restore() {
      assert.equal(pending.size, 0, 'restore only after actual callback and observer-child joins');
      assert.equal(current(), undefined, 'restore cannot revoke a future heartbeat');
      if (restored) return;
      const errors = [];
      for (const [name, { descriptor, wrapped }] of originals) {
        if (fs[name] !== wrapped) errors.push(new Error(`Private lock observer descriptor replaced: ${name}`));
        try { Object.defineProperty(fs, name, descriptor); } catch (error) { errors.push(error); }
      }
      restored = true;
      if (errors.length) throw new AggregateError(errors, 'Private lock observer restoration failed');
    },
    snapshot: () => Object.freeze(records.map(record => Object.freeze({ name: record.name, finished: record.finished,
      callbackReturned: record.callbackReturned, admittedAfterRelease: record.admittedAfterRelease,
      lockReleasedAtCallback: record.lockReleasedAtCallback, nativeError: record.nativeError }))),
  };
}
