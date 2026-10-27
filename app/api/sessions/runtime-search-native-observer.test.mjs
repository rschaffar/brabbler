import './runtime-search-native-observer.fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { backendCase, deferred, loadBackend } from '../../../lib/backend-ownership.fixture.mjs';
import { createNativeRouteOwner } from './runtime-native-owner.fixture.mjs';
import { createNativeCallbackDelivery, expectNativeFailures } from './runtime-native-error.fixture.mjs';

// Original two real-public/native controls, followed by two finite contained
// error controls. No product algorithm or public-result timing is replaced.
for (const mode of ['success', 'known', 'finalizer', 'callback']) {
  const contained = mode === 'finalizer' || mode === 'callback';
  const exceptional = mode === 'known' || mode === 'finalizer';
  const name = contained ? `native error retention: ${mode}`
    : `unmodified search public/native separation: ${exceptional ? 'exceptional retention' : 'native root vector'}`;
  test(name, { timeout: 10_000 }, async t => {
    const outerHooks = [], hooks = [], events = [];
    const outer = backendCase(contained ? { after: fn => outerHooks.push(fn) } : t);
    const fault = new Error('independent handler failure');
    const unexpected = new Error(mode === 'finalizer' ? 'unexpected native finalizer marker' : 'callback threw after real delegation');
    let root, dataRoot, stream, closeError, cleanup, retainedOuterError;
    // This is the actual backendCase cleanup, cached once. No alternate rm or
    // outer owner clears the intentionally retained uncertainty root afterward.
    const containedCleanup = () => cleanup ??= (async () => {
      const [result] = await Promise.allSettled([outerHooks[0]()]);
      retainedOuterError = result.status === 'rejected' ? result.reason : undefined;
      assert.equal(fs.existsSync(root), true, 'unexpected native error must retain enclosing Root');
      assert.equal(result.status, 'rejected');
      const error = result.reason;
      assert.equal(error instanceof AggregateError, true);
      assert.equal(closeError instanceof AggregateError, true);
      const intended = mode === 'finalizer' ? [fault, unexpected] : [unexpected];
      assert.equal(closeError.errors.length, intended.length);
      intended.forEach((cause, index) => assert.equal(closeError.errors[index], cause));
      // One inner-close join, plus the independent lower callback-return join
      // only in callback mode. No Set/deduplication hides extra causes.
      const outerCauses = mode === 'callback' ? [closeError, unexpected] : [closeError];
      assert.equal(error.errors.length, outerCauses.length);
      outerCauses.forEach((cause, index) => assert.equal(error.errors[index], cause));
      assert.equal(fs.existsSync(dataRoot), true);
      assert.equal(stream.closed, true);
      assert.equal(stream.fd, null);
      assert.equal(events.includes('independent native finalizer'), true);
      assert.equal(events.includes('outer finalizer'), true);
      if (mode === 'finalizer') assert.equal(await fsp.readFile(join(dataRoot, 'native.finalizerMarker'), 'utf8'), 'complete');
    })().catch(error => {
      // An unexpected cause must survive even a failed control verification.
      if (retainedOuterError) throw new AggregateError([retainedOuterError, error], 'Contained native error verification failed');
      throw error;
    });
    if (contained) t.after(containedCleanup);
    outer.remove(() => root && fsp.rm(root, { recursive: true, force: true }));
    root = await outer.work(fsp.mkdtemp(join(tmpdir(), 'brabbler-native-observer-')));
    dataRoot = join(root, 'data');
    await outer.work(fsp.mkdir(dataRoot));
    const path = join(dataRoot, 'message.jsonl');
    await outer.work(fsp.writeFile(path, JSON.stringify({ type: 'message', id: 'hit', message: {
      role: 'user', content: 'native needle',
    } }) + '\n'));
    const gate = deferred(), nativeResult = deferred(), streamClosed = deferred();
    const delivery = createNativeCallbackDelivery();
    outer.release(() => gate.resolve());
    let removedTooEarly = false, callbackDeliveredAfterRoot = false;
    const native = createNativeRouteOwner({ after: fn => hooks.push(fn) }, {
      failed: async () => { throw fault; },
    }, () => { throw new Error('this search control admits no index writer'); });
    native.root(dataRoot);
    native.remove(() => {
      removedTooEarly = !delivery.deliveryFinished;
      fs.rmSync(dataRoot, { recursive: true, force: true });
    });
    const expectedClose = () => (exceptional ? expectNativeFailures(hooks[0](), [fault]) : hooks[0]())
      .catch(error => { closeError = error; throw error; });
    outer.join(expectedClose); // sole outer inner-close join; no duplicate work registration
    // After real stream settlement, a completed delivery failure is still a
    // native finalizer error. This sample is NOT a replacement for stream close
    // or an early callback ACK wait that would mask the missing-stream-join fault.
    native.final(() => delivery.deliveryFinished ? delivery.callbackReturned : undefined);
    if (mode === 'finalizer') native.final(async () => {
      await fsp.writeFile(join(dataRoot, 'native.finalizerMarker'), 'complete');
      throw unexpected;
    });
    if (contained) {
      native.final(async () => {
        await fsp.writeFile(join(root, 'independent-finalizer'), 'complete');
        events.push('independent native finalizer');
      });
      outer.final(() => {
        assert.equal(stream.closed, true);
        assert.equal(stream.fd, null);
        events.push('outer finalizer');
      });
    }
    const search = await outer.work(loadBackend(new URL('../../../lib/session-search.ts', import.meta.url), {
      'node:readline': { createInterface },
      'node:fs': { createReadStream(file, options) {
        const real = fs.createReadStream(file, { ...options, fs: { ...fs, close(fd, callback) {
          fs.close(fd, function (...values) {
            nativeResult.resolve(); // real native close result, not delivery/return
            void gate.promise.then(() => {
              callbackDeliveredAfterRoot = !fs.existsSync(dataRoot);
              const forward = mode === 'callback' ? function (...args) {
                Reflect.apply(callback, this, args); // actual original callback first
                throw unexpected; // contained AFTER real delegation, never a fake close
              } : callback;
              delivery.deliver(forward, this, values);
            }).catch(delivery.reject);
          });
        } } });
        stream = real;
        real.once('close', () => streamClosed.resolve());
        // Register independent peers only after a real stream was admitted.
        // backendCase attempts all joins/finals despite callback-return rejection.
        outer.join(() => delivery.callbackReturned);
        outer.join(() => streamClosed.promise);
        return real; // same actual stream; earliest observer already registered
      } },
    }));
    const published = search.searchSessionContents([{ id: 'search', path, transient: false,
      name: '', firstMessage: '', modified: '2026-01-01T00:00:00.000Z' }], 'native needle');
    assert.equal(native.body(published), published, 'fixture observes SAME public promise');
    outer.work(published);
    const result = await published;
    assert.equal(result.results[0].entryId, 'hit');
    await nativeResult.promise;
    assert.equal(delivery.deliveryFinished, false, 'actual native callback delivery is held');
    if (exceptional) await assert.rejects(native.routes.failed(), error => error === fault);
    const closing = expectedClose();
    void closing.catch(() => {}); // actual cleanup is already independently registered
    await outer.work(fsp.writeFile(join(root, 'independent-peer'), 'complete'));
    assert.equal(await outer.work(fsp.readFile(join(root, 'independent-peer'), 'utf8')), 'complete');
    const rootHeldBeforeDelivery = fs.existsSync(dataRoot);
    gate.resolve();
    // Unlike fail-fast Promise.all, record all lower outcomes including actual
    // stream close even when callbackReturned rejected with its original error.
    const outcomes = await Promise.allSettled([closing, delivery.callbackReturned, streamClosed.promise]);
    if (!contained) {
      for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    } else if (mode === 'callback') {
      assert.equal(outcomes[1].status, 'rejected');
      assert.equal(outcomes[1].reason, unexpected, 'lower callbackReturned preserves original thrown identity');
    }
    assert.deepEqual({ removedTooEarly, callbackDeliveredAfterRoot }, {
      removedTooEarly: false, callbackDeliveredAfterRoot: false,
    }, 'actual native root vector, not public-search timing');
    assert.equal(rootHeldBeforeDelivery, true);
    assert.equal(stream.closed, true);
    assert.equal(stream.fd, null);
    if (contained) await containedCleanup();
    else assert.equal(fs.existsSync(dataRoot), exceptional, 'only verified successful inner closure removes dataRoot');
  });
}
