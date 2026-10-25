// N candidate, self-provisioned beneath the ordinary runner's private TMPDIR.
// Outer removal requires complete actual domain proof, including expected faults.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
import { backendCase, deferred, settleFixtureRpc } from './backend-ownership.fixture.mjs';
import { subagentCreation } from './subagent-creation.fixture.mjs';
import { ownedBackendNativeRoot } from './backend-native-root.fixture.mjs';
function capturedCase() {
  const hooks = [];
  return { t: { after: hook => hooks.push(hook) }, hasHook: () => hooks.length > 0, close: async () => {
    assert.equal(hooks.length, 1); await hooks[0]();
  } };
}
function causes(error) {
  return error instanceof AggregateError ? error.errors.flatMap(causes) : [error];
}

test('actual child fixture: abort throw still disposes that child and joins held peer, retaining both original errors/root', { timeout: 10000 }, async t => {
  const native = await ownedBackendNativeRoot(t);
  const scope = capturedCase(), abortFailure = new Error('exact fixture abort fault'), disposeFailure = new Error('exact fixture dispose fault');
  const peerAbort = deferred(), peerGate = deferred();
  const children = [], disposed = [];
  let f, closing, proved = false;
  const executions = [];
  native.closeWith(async () => {
    peerGate.resolve(); f?.promptGate.resolve();
    if (!closing && scope.hasHook()) closing = scope.close();
    const result = closing ? await closing.then(() => ({ ok: true }), error => ({ error })) : undefined;
    if (!proved || !f || executions.length !== 2) throw new Error('Child domain proof incomplete');
    assert.deepEqual(causes(result?.error), [abortFailure, disposeFailure]);
    await Promise.all(executions.map(execution => execution.settled));
    assert.deepEqual(disposed, children);
    for (const child of children) assert.equal(await readFile(join(f.root, `${child.sessionId}.disposed`), 'utf8'), 'actual private write\n');
    // These are the fixture's entire actual abort/dispose peers and native writes;
    // expected error identities were asserted, not ignored as arbitrary failures.
  });
  try {
    f = await subagentCreation(scope.t, { privateRoot: native.root,
      abortChild(child) {
        if (child === children[0]) throw abortFailure;
        peerAbort.resolve(); return peerGate.promise;
      },
      async disposeChild(child) {
        disposed.push(child);
        await writeFile(join(f.root, `${child.sessionId}.disposed`), 'actual private write\n');
        if (child === children[0]) throw disposeFailure;
      },
    });
    const first = await f.start(); executions.push(first); children.push(f.child());
    const second = await f.start(); executions.push(second); children.push(f.child());
    assert.notEqual(children[0], children[1]);
    // Capture the real full cleanup hook, including release of both queue peers.
    closing = scope.close();
    const observed = closing.then(() => ({ ok: true }), error => ({ error }));
    await peerAbort.promise;
    let ended = false; void observed.then(() => { ended = true; });
    await Promise.resolve();
    assert.equal(ended, false, 'cleanup cannot fail-fast past the held peer');
    assert.equal(existsSync(f.root), true);
    peerGate.resolve();
    const result = await observed;
    assert.equal(result.ok, undefined);
    assert.deepEqual(causes(result.error), [abortFailure, disposeFailure]);
    assert.deepEqual(disposed, children);
    for (const child of children) assert.equal(await readFile(join(f.root, `${child.sessionId}.disposed`), 'utf8'), 'actual private write\n');
    await Promise.all([first.settled, second.settled]); // Not durable completion.
    assert.equal(existsSync(f.root), true, 'uncertain cleanup retains its native root');
    assert.throws(() => f.start(), /no late backend admission/);
    proved = true; // Outer owner independently rechecks all actual peers above.
  } finally {
    peerGate.resolve(); f?.promptGate.resolve();
    if (closing) await Promise.allSettled([closing]);
    else if (scope.hasHook()) { closing = scope.close(); await Promise.allSettled([closing]); }
  }
});

test('actual SDK empty file/wrapper: start binding and extension shutdown/disposal finish before native rm', { timeout: 10000 }, async t => {
  const native = await ownedBackendNativeRoot(t);
  const scope = capturedCase(), owner = backendCase(scope.t);
  const root = await mkdtemp(join(native.root, 'empty-rpc-'));
  const binding = deferred(), bound = deferred(), shutdown = deferred(), shuttingDown = deferred();
  const events = [];
  let disposed = false, closing, wrapper, proved = false;
  native.closeWith(async () => {
    binding.resolve(); shutdown.resolve();
    if (!closing) closing = scope.close();
    const results = await Promise.allSettled([
      closing,
      Promise.resolve().then(() => { assert.ok(wrapper); return wrapper.waitUntilReady(); }),
      Promise.resolve().then(() => { assert.ok(wrapper); return wrapper.shutdown(); }),
    ]);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (!proved || !disposed) errors.push(new Error('RPC domain proof incomplete'));
    if (errors.length) throw new AggregateError(errors);
  });
  const manager = SessionManager.create(root, join(root, 'sessions'));
  const { AgentSessionWrapper } = await createJiti(import.meta.url, { fsCache: false }).import('./rpc-manager.ts');
  wrapper = new AgentSessionWrapper({ sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(),
    sessionManager: manager, agent: { state: {} }, subscribe: () => () => {},
    async bindExtensions() { bound.resolve(); await binding.promise; events.push('binding-finished'); },
    extensionRunner: { async emit(event) {
      assert.equal(event.type, 'session_shutdown'); shuttingDown.resolve(); await shutdown.promise;
      await writeFile(join(root, 'shutdown-finished'), 'joined\n'); events.push('shutdown-finished');
    } },
    dispose() { disposed = true; events.push('disposed'); },
  });
  owner.join(() => settleFixtureRpc(wrapper));
  owner.remove(async () => {
    assert.equal(disposed, true);
    assert.deepEqual(events, ['binding-finished', 'shutdown-finished', 'disposed']);
    assert.equal(await readFile(join(root, 'shutdown-finished'), 'utf8'), 'joined\n');
    events.push('rm'); await rm(root, { recursive: true, force: true });
  });
  try {
    wrapper.start(); wrapper.beginExtensionBinding(); await bound.promise;
    manager.appendCustomEntry('empty-setup', { version: 1 }); wrapper.persistInitialSession();
    closing = scope.close();
    // Observe immediately, including mutants that settle too early or reject.
    const observed = closing.then(() => ({ ok: true }), error => ({ error }));
    assert.equal(existsSync(manager.getSessionFile()), true);
    assert.equal(disposed, false);
    assert.deepEqual(events, []);
    binding.resolve(); await shuttingDown.promise;
    assert.equal(existsSync(root), true); assert.equal(disposed, false);
    shutdown.resolve();
    const result = await observed;
    if (result.error) throw result.error;
    assert.equal(result.ok, true);
    assert.deepEqual(events, ['binding-finished', 'shutdown-finished', 'disposed', 'rm']);
    assert.equal(existsSync(root), false);
    proved = true;
  } finally {
    binding.resolve(); shutdown.resolve();
    if (closing) await Promise.allSettled([closing]);
    else { closing = scope.close(); await Promise.allSettled([closing]); }
    // Fault controls may remove the helper's await; independently join the same
    // real wrapper before leaving the witness (never grant rm on this fallback).
    await Promise.allSettled([wrapper.waitUntilReady(), wrapper.shutdown()]);
  }
});
