import { sshNativeCase, acceptSshCleanupOutcome } from './ssh-bridge-native.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { fixture as generatedCredential } from './browser-ssh.fixture.mjs';

const reflect = work => work.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));

// One finite control: actual native callback -> held original remove -> original
// ENOTEMPTY. No service, SSH wire client, model, clock driving or copied controller.
test('native bridge callback/remove owns the case root and retains the original swallowed rmdir error', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ssh-bridge-closure-'));
  let engine, cleanup, hold, blockerWritten = false, closingOutcome, primaryError;
  const native = sshNativeCase({ after: callback => { cleanup = callback; } }, { root, pool: () => engine });
  const removalFailure = () => {
    const [record] = native.bridges.snapshot();
    assert.ok(record, 'the actual generated pws directory is identified');
    assert.equal(record.callbackReturned, true, 'the FULL original native callback returned');
    assert.equal(record.restored, true, 'instance descriptor restored only after that return');
    assert.equal(record.removals.length, 1, 'one actual production rmdir, no retry');
    const result = record.removals[0];
    assert.equal(result.status, 'rejected');
    const error = result.error;
    assert.equal(error.code, 'ENOTEMPTY');
    assert.equal(error.syscall, 'rmdir');
    assert.equal(error.path, record.directory);
    const retained = native.bridges.errors();
    assert.equal(retained.length, 1);
    assert.equal(retained[0], error, 'retain the exact original native error, not a synthetic diagnostic');
    return { record, error };
  };
  // Independently release, close and fallback-join before any verification throw.
  // Accept ONLY the expected FULL cleanup outcome, not just its bridge ledger.
  t.after(async () => {
    const errors = [];
    let outcome, expectedErrors, refusal;
    try { hold?.release(); } catch (error) { errors.push(error); }
    try { outcome = await (closingOutcome ?? reflect(cleanup())); } catch (error) { errors.push(error); }
    try { await native.bridges.join(); } catch (error) { errors.push(error); }
    try { expectedErrors = blockerWritten ? [removalFailure().error] : []; } catch (error) { errors.push(error); }
    try {
      if (!expectedErrors) {
        if (outcome?.status === 'rejected') throw outcome.reason;
        throw new Error('SSH cleanup expected-error verification failed');
      }
      acceptSshCleanupOutcome(outcome, expectedErrors);
    } catch (error) { refusal = error; }
    if (refusal && outcome?.status === 'rejected') {
      if (errors.length) throw new AggregateError([outcome.reason, ...errors], 'Original SSH cleanup rejection and independent verification failures');
      throw outcome.reason; // Preserve the COMPLETE original aggregate by identity.
    }
    if (refusal) errors.push(refusal);
    if (errors.length) {
      if (primaryError && outcome?.status === 'fulfilled' && errors.length === 1 && errors[0] === refusal) {
        // Omitted-join fault: report refusal without replacing the primary root scalar.
        t.diagnostic('Full SSH cleanup fulfillment refused; preserving the original body failure');
        throw primaryError;
      }
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'SSH diagnostic teardown failed');
    }
  });
  try {
    const jiti = createJiti(import.meta.url, { fsCache: false });
    const { BrowserSshAgent } = await jiti.import('./browser-ssh-agent.ts');
    engine = new BrowserSshAgent();
    const material = generatedCredential('http://localhost');
    const bridge = engine.create('synthetic-native-owner', material.credential, 'http://localhost');
    await engine.activate(bridge.token, 'synthetic-native-owner', 'http://localhost',
      material.assertion(Buffer.from(bridge.challenge, 'base64url')));
    const [record] = native.bridges.snapshot();
    assert.equal(native.bridges.snapshot().length, 1);
    // This actually makes native rmdirSync fail. Nothing throws a fake filesystem error.
    await writeFile(join(record.directory, 'owned-native-blocker'), 'intentional native ENOTEMPTY', { flag: 'wx', mode: 0o600 });
    blockerWritten = true;
    hold = native.bridges.holdClose(record.directory);
    engine.disconnect(bridge.token, 'synthetic-native-owner', 'http://localhost');
    await hold.entered; // Node has actually invoked its close callback; original args are saved.
    assert.equal(native.bridges.snapshot()[0].nativeDelivered, true);
    assert.equal(native.bridges.snapshot()[0].callbackReturned, false);
    assert.equal(native.bridges.snapshot()[0].removals.length, 0);

    let closeSettled = false;
    closingOutcome = reflect(cleanup()).then(outcome => { closeSettled = true; return outcome; });
    // A missing owner join takes the cleanup-result arm: no named-barrier hang.
    await Promise.race([native.bridges.joinEntered, closingOutcome]);
    assert.equal(existsSync(root), true, 'held ACTUAL close callback must prevent early case-root removal');
    assert.equal(closeSettled, false);
    const peer = join(root, 'independent-native-peer');
    await writeFile(peer, 'independent native write before callback delivery', { flag: 'wx', mode: 0o600 });
    assert.equal(await readFile(peer, 'utf8'), 'independent native write before callback delivery');
    assert.equal(native.bridges.snapshot()[0].callbackReturned, false);

    hold.release(); // SAME original callback, native receiver/args, exactly once.
    const outcome = await closingOutcome;
    assert.equal(existsSync(root), true, 'actual swallowed native rmdir failure must retain the case root');
    let expected;
    try { expected = removalFailure(); }
    catch (verification) {
      if (outcome.status === 'rejected') throw new AggregateError([outcome.reason, verification], 'Original SSH cleanup rejection and bridge verification failure');
      throw verification;
    }
    const { record: completed, error } = expected;
    acceptSshCleanupOutcome(outcome, [error]); // SAME complete-outcome adapter as after-hook.
    assert.equal(completed.rootAtDelivery, true, 'original remove ran with its case owner still present');
    assert.equal(existsSync(completed.directory), true);
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason instanceof AggregateError, true);
    assert.equal(outcome.reason.errors.length, 1);
    assert.equal(outcome.reason.errors[0], error, 'outer cleanup surfaces the identical original native rmdir error');
    // Intentional retention is contained only after exact native failure identity
    // and complete callback/join/restoration. Existing file-process W ownership is
    // the outer removal boundary; no recursive cleanup of uncertain pws directories.
  } catch (error) { primaryError = error; throw error; }
});

test('shared SSH cleanup adapter rejects the original non-bridge restore failure without losing its identity', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ssh-cleanup-error-'));
  const marker = new Error('intentional shared SSH owner restore failure');
  let cleanup, closingOutcome;
  const native = sshNativeCase({ after: callback => { cleanup = callback; } }, {
    root, restore: [() => { throw marker; }],
  });
  t.after(async () => {
    const errors = [];
    let outcome;
    try { outcome = await (closingOutcome ?? reflect(cleanup())); } catch (error) { errors.push(error); }
    try { await native.bridges.join(); } catch (error) { errors.push(error); }
    // Only THIS contained control intentionally owns this restore marker.
    // The normal bridge control's expected list remains nativeErr ONLY.
    try { acceptSshCleanupOutcome(outcome, [marker]); }
    catch (error) {
      if (errors.length) throw new AggregateError([error, ...errors], 'Original restore cleanup rejection and fallback failures');
      throw error;
    }
    if (errors.length) throw new AggregateError(errors, 'Restore control fallback failed');
  });
  const peer = join(root, 'actual-native-peer');
  await writeFile(peer, 'real native peer before shared-owner restore failure', { flag: 'wx', mode: 0o600 });
  assert.equal(await readFile(peer, 'utf8'), 'real native peer before shared-owner restore failure');
  const outcome = await (closingOutcome = reflect(cleanup()));
  assert.equal(existsSync(root), true, 'actual shared-owner restore failure retains its native root');
  assert.equal(native.bridges.snapshot().length, 0, 'no bridge is needed for the non-bridge error channel');
  assert.deepEqual(native.bridges.errors(), [], 'empty bridge ledger is not full cleanup success');
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.reason instanceof AggregateError, true);
  assert.equal(outcome.reason.errors.length, 1);
  assert.equal(outcome.reason.errors[0], marker, 'actual shared cleanup retains the ORIGINAL restore marker');
  const originalCleanupError = outcome.reason;
  await assert.rejects(async () => { acceptSshCleanupOutcome(outcome, []); },
    error => error === originalCleanupError,
    'unexpected non-bridge cleanup must reject the SAME original AggregateError');
  // No manual deletion/retry of this retained root: existing conditional W owner.
});
