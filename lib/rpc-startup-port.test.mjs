import assert from 'node:assert/strict';
import test from 'node:test';
import { rpcStartup } from './rpc-startup.fixture.mjs';

// Private startup-fixture witnesses, not native MCP authority or SDK process proof.
// Proposed E: whole real startup/import graph with controlled external SDK ports.
test('startup native port records and delegates the actual registry callback before publication', async t => {
  let executions = 0;
  const execute = () => { executions++; throw new Error('opaque definition must not execute'); };
  const definitions = new Map([['port-probe', { execute }]]);
  const f = await rpcStartup(t, { nativeRegistryDefinitions: definitions });
  const { session } = await f.start(); await session.waitUntilReady();
  assert.equal(f.nativePorts.length, 1);
  const record = f.nativePorts[0];
  assert.equal(record.port.enabled, false);
  assert.equal(record.port.selection === record.input.selection, true, 'original effective selection object is preserved');
  assert.deepEqual(record.port.factories, []);
  assert.equal(record.bindings.length, 1, 'one constructor binding');
  assert.equal(record.registrySessionIds.includes(session.sessionId), false, 'actual registry did not publish this wrapper before its native port was bound');
  assert.equal(record.bindings[0]('port-probe') === execute, true, 'actual constructor callback forwards the SDK definition execute identity');
  assert.equal(record.bindings[0]('missing-port-probe'), undefined);
  assert.deepEqual(f.calls.filter(([name]) => name === 'tool-definition'), [
    ['tool-definition', session.sessionId, 'port-probe'],
    ['tool-definition', session.sessionId, 'missing-port-probe'],
  ]);
  assert.equal(executions, 0, 'lookup is not tool execution or admission');
  assert.throws(() => record.port.bindToolRegistry(() => undefined), /Native registry is already bound/);
  assert.equal(record.bindings.length, 1, 'duplicate binding cannot replace the original observer');
  const bound = f.calls.findIndex(([name]) => name === 'native-bind');
  const published = f.calls.findIndex(([name]) => name === 'subscribe');
  assert.ok(bound >= 0 && published >= 0 && bound < published, 'native binding precedes actual wrapper registry publication/start subscription');
  await f.settle();
  assert.equal(f.calls.filter(([name]) => name === 'dispose').length, 1);
  assert.equal(f.calls.some(([name]) => name === 'orphan-cleanup'), false, 'registered wrapper retains sole disposal ownership');
  assert.equal(f.rpc.getRpcSession(session.sessionId), undefined);
});

test('startup constructor-port failure joins the full start and explicitly disposes only its orphan inner', async t => {
  const failure = new Error('controlled native registry binding failure');
  const f = await rpcStartup(t, { holdServices: true, nativeBindFailure: failure });
  const rejected = f.startRejected(failure);
  await Promise.race([f.serviceEntered.promise, rejected.then(() => { throw new Error('startup ended before its held service capability'); })]);
  assert.equal(f.inners.length, 0, 'no SDK inner before services finish');
  f.serviceGate.resolve(); await rejected;
  assert.equal(f.inners.length, 1);
  const inner = f.inners[0];
  assert.equal(f.nativePorts[0].bindings.length, 1, 'failure follows actual callback receipt');
  assert.equal(globalThis.__piSessions.has(inner.sessionId), false, 'failed wrapper never published');
  assert.equal(globalThis.__piStartLocks.size, 0, 'actual start finally released its lock');
  assert.equal(globalThis.__piStartingSessionCwds.size, 0, 'actual start finally released its reservation');
  assert.equal(f.calls.some(([name]) => name === 'dispose'), false, 'orphan was constructed but not yet disposed by a wrapper');
  await f.settle(); await inner.disposed;
  assert.deepEqual(f.calls.filter(([name]) => ['orphan-cleanup', 'abort', 'dispose'].includes(name)), [
    ['orphan-cleanup', inner.sessionId], ['abort', inner.sessionId], ['dispose', inner.sessionId],
  ]);
  assert.equal(f.calls.some(([name]) => name === 'shutdown'), false, 'no fabricated wrapper shutdown for an unregistered inner');
  await f.settle();
  assert.equal(f.calls.filter(([name]) => name === 'dispose').length, 1, 'the registered after-hook shares the same completion, not a second disposal');
});
