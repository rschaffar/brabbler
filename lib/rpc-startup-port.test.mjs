import assert from 'node:assert/strict';
import test from 'node:test';
import { rpcStartup } from './rpc-startup.fixture.mjs';
import { mkdtemp, writeFile, stat, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { backendCase, loadBackend } from './backend-ownership.fixture.mjs';
import { createRpcStartupPreparation } from './rpc-startup-preparation.fixture.mjs';

// Private startup-fixture witnesses, not native MCP authority or SDK process proof.
// Reviewed N: private roots and process-local startup graph; cases remain serial.
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

test('earlier real startup registry callbacks retain their own roots, work and errors after another row', async t => {
  let earlier;
  for (const row of ['first', 'second']) await t.test(row, async t => {
    const failure = new Error(`${row} original callback error`);
    let root, work;
    const execute = () => work;
    const fail = () => { throw failure; };
    const f = await rpcStartup(t, { nativeRegistryDefinitions: new Map([['work', { execute }], ['fail', { execute: fail }]]) });
    root = f.root; work = Promise.resolve({ root, failure });
    const { session } = await f.start(); await session.waitUntilReady();
    const inspect = f.nativePorts[0].bindings[0];
    assert.equal(inspect('work') === execute, true);
    assert.equal(inspect('work')() === work, true);
    assert.throws(inspect('fail'), error => error === failure);
    if (earlier) {
      assert.equal(earlier.inspect('work') === earlier.execute, true, 'not a current-row dispatcher');
      assert.equal(earlier.inspect('work')() === earlier.work, true);
      const result = await earlier.work;
      assert.equal(result.root, earlier.root); assert.equal(result.failure === earlier.failure, true);
      assert.notEqual(result.root, root);
      assert.throws(earlier.inspect('fail'), error => error === earlier.failure);
    }
    earlier = { inspect, execute, work, root, failure };
    await work; await f.settle();
  });
});

// Cases in this existing N file remain serial: private source writes and process
// globals are restored after fully awaited evaluation, before removing the root.
test('RPC dependency preparation preserves changed bytes, fresh evaluation and earlier capabilities', async t => {
  const owner = backendCase(t), root = await mkdtemp(join(tmpdir(), 'pi-web-rpc-preparation-'));
  owner.remove(() => rm(root, { recursive: true, force: true }));
  const previous = globalThis.__piRpcPreparationProbe;
  owner.final(() => { if (previous === undefined) delete globalThis.__piRpcPreparationProbe; else globalThis.__piRpcPreparationProbe = previous; });
  const dependency = join(root, 'dependency.ts'), url = pathToFileURL(join(root, 'owner.ts'));
  const original = `const probe = globalThis.__piRpcPreparationProbe;
probe.evaluations.push(probe.root);
if (probe.fail) throw probe.failure;
export const root = probe.root, failure = probe.failure;
export const state: string[] = [];
export class Marker {}
export const value = 'original';`;
  await writeFile(dependency, original);
  const timestamp = await stat(dependency);
  await writeFile(url, `import * as dependency from './dependency.ts';
import { callback } from 'fixture-port';
export const state: string[] = [];
export const token = Symbol('row');
export const lexical = lexicalRoot;
export function snapshot() { return dependency; }
export function dispatch() { return callback(lexicalRoot, dependency.root); }
export function fail() { throw dependency.failure; }`);
  const prepareDependencies = createRpcStartupPreparation(), evaluations = [];
  const load = async (row, { fail = false, failure = new Error(row) } = {}) => {
    globalThis.__piRpcPreparationProbe = { root: join(root, row), failure, fail, evaluations };
    const work = Promise.resolve(row);
    const loaded = await loadBackend(url, { 'fixture-port': { callback(lexical, captured) {
      assert.equal(lexical, row); assert.equal(captured, join(root, row)); return work;
    } } }, { actual: true, prepareDependencies, globals: { extra: row, lexicalRoot: row } });
    return { loaded, failure, work };
  };
  const a = await owner.work(load('a'));
  a.loaded.state.push('owner-a'); a.loaded.snapshot().state.push('dependency-a');
  const b = await owner.work(load('b'));
  assert.equal(a.loaded === b.loaded, false, 'fresh owner exports');
  assert.equal(a.loaded.token === b.loaded.token, false, 'fresh owner initialization');
  assert.deepEqual(b.loaded.state, []);
  assert.deepEqual(b.loaded.snapshot().state, []);
  assert.equal(a.loaded.snapshot().Marker === b.loaded.snapshot().Marker, false, 'fresh dependency class');
  assert.equal(a.loaded.snapshot().root, join(root, 'a'));
  assert.equal(b.loaded.snapshot().root, join(root, 'b'));
  assert.equal(a.loaded.dispatch() === a.work, true, 'earlier callback keeps original work and roots');
  assert.equal(b.loaded.dispatch() === b.work, true);
  assert.throws(a.loaded.fail, error => error === a.failure);
  assert.throws(b.loaded.fail, error => error === b.failure);
  await owner.work(Promise.all([a.work, b.work]));
  for (const [row, source, expected] of [['mutant', original.replace("'original'", "'mutated!'"), 'mutated!'], ['restored', original, 'original']]) {
    await writeFile(dependency, source); await utimes(dependency, timestamp.atime, timestamp.mtime);
    const result = await owner.work(load(row));
    assert.equal(result.loaded.snapshot().value, expected, `${row} bytes at same filename/mtime`);
  }
  await owner.work(assert.rejects(loadBackend(url, { './dependency.ts': {} }, { prepareDependencies }), /Unadmitted backend capability: fixture-port/));
  const failure = new Error('fresh dependency evaluation failure');
  await owner.work(assert.rejects(load('failed', { fail: true, failure }), error => error === failure));
  const recovered = await owner.work(load('recovered'));
  assert.equal(recovered.loaded.snapshot().root, join(root, 'recovered'));
  assert.deepEqual(evaluations, ['a', 'b', 'mutant', 'restored', 'failed', 'recovered'].map(row => join(root, row)));
  // Resolution and reads remain outside preparation; current aliases and a
  // missing file must not be replaced by a previously prepared/evaluated module.
  const left = join(root, 'left.ts'), right = join(root, 'right.ts');
  await writeFile(left, `export const value = 'left';`); await writeFile(right, `export const value = 'right';`);
  for (const [file, expected] of [[left, 'left'], [right, 'right']]) {
    const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, alias: { 'fixture-alias': file } });
    prepareDependencies(jiti);
    assert.equal((await jiti.import('fixture-alias')).value, expected);
  }
  await rm(left);
  const missing = createJiti(import.meta.url, { fsCache: false, moduleCache: false }); prepareDependencies(missing);
  await owner.work(assert.rejects(missing.import(left), /Cannot find module|ENOENT/));
});

test('RPC preparation matches pinned transformation options and does not retain mutable results or failures', () => {
  const prepare = createRpcStartupPreparation();
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
  const original = jiti.options.transform; prepare(jiti);
  const base = { source: 'import sample from "sample"; export const value: number = sample; export const location = import.meta.url;',
    filename: '/fixture/first.ts', ts: true, async: false, interopDefault: true, jsx: false, babel: {} };
  for (const change of [{}, { filename: '/fixture/second.ts' }, { async: true }, { interopDefault: false }, { retainLines: false }, { ts: false }]) {
    const options = { ...base, ...change }, expected = original(options);
    const first = jiti.options.transform(options), second = jiti.options.transform(options);
    assert.equal(first.code, expected.code); assert.equal(second.code, expected.code);
    assert.equal(first === second, false, 'no mutable result object is shared');
    first.code = 'poisoned caller result';
    assert.equal(jiti.options.transform(options).code, expected.code);
    if (expected.error) { assert.ok(first.error); assert.ok(second.error); assert.equal(first.error === second.error, false, 'parse errors are not cached'); }
  }
  const broken = { ...base, source: 'export const = ;' };
  const one = jiti.options.transform(broken), two = jiti.options.transform(broken);
  assert.ok(one.error); assert.ok(two.error); assert.equal(one.error === two.error, false);
  for (const source of ['export const value = 1;', 'export const value = 2;']) {
    const hidden = { ...base };
    Object.defineProperty(hidden, 'source', { value: source, enumerable: false });
    assert.equal(jiti.options.transform(hidden).code, original(hidden).code, 'non-enumerable source cannot collide in the preparation key');
  }
  // More than the fixed entry bound must still produce correct fresh text.
  for (let index = 0; index < 257; index++) {
    const options = { ...base, source: `export const value: number = ${index};` };
    assert.equal(jiti.options.transform(options).code, original(options).code);
  }
  assert.equal(jiti.options.transform(base).code, original(base).code);
});

test('RPC preparation delegates custom transformers, Babel effects, maps, JSX and diagnostic modes', t => {
  const prepare = createRpcStartupPreparation(), failure = new Error('custom transformer identity');
  const custom = () => { throw failure; };
  const special = createJiti(import.meta.url, { fsCache: false, moduleCache: false, transform: custom });
  prepare(special); assert.equal(special.options.transform === custom, true);
  assert.throws(() => special.options.transform({}), error => error === failure);
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
  const original = jiti.options.transform; prepare(jiti);
  const base = { source: 'export const value = 1;', filename: '/fixture/options.ts', ts: true, async: false, interopDefault: true, jsx: false, babel: {} };
  let visits = 0;
  const plugin = () => ({ visitor: { Program() { visits++; } } });
  const configured = { ...base, babel: { plugins: [plugin] } };
  jiti.options.transform(configured); jiti.options.transform(configured);
  assert.equal(visits, 2, 'stateful Babel plugins run on every request');
  let sourceReads = 0;
  const accessor = { ...base, get source() { sourceReads++; return base.source; } };
  jiti.options.transform(accessor); jiti.options.transform(accessor);
  assert.equal(sourceReads, 2, 'accessors delegate without key evaluation');
  for (const options of [{ ...base, source: `${base.source}\n//# sourceMappingURL=data:application/json;base64,e30=` },
    { ...base, jsx: true, source: 'export const view = <div />;' }, { ...base, babel: { sourceMaps: 'inline' } }]) {
    assert.equal(jiti.options.transform(options).code, original(options).code);
  }
  const throwing = { ...base, get source() { sourceReads++; throw failure; } };
  assert.equal(jiti.options.transform(throwing).error === failure, true);
  assert.equal(jiti.options.transform(throwing).error === failure, true);
  assert.equal(sourceReads, 4, 'default-transform getter failures retain the original error and execute again');
  const previous = Object.fromEntries(['DEBUG', 'BABEL_SHOW_CONFIG_FOR'].map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  jiti.options.transform(base); // Warm the eligible input before diagnostic configuration changes.
  process.env.BABEL_SHOW_CONFIG_FOR = '/pi-web-nonexistent-babel-config-target';
  assert.ok(original(base).error, 'the default diagnostic path fails on the missing synthetic target');
  assert.ok(jiti.options.transform(base).error, 'a warm code hit cannot hide current diagnostic failure');
  if (previous.BABEL_SHOW_CONFIG_FOR === undefined) delete process.env.BABEL_SHOW_CONFIG_FOR; else process.env.BABEL_SHOW_CONFIG_FOR = previous.BABEL_SHOW_CONFIG_FOR;
  process.env.DEBUG = 'pi-web-fixture-no-matching-debug-namespace';
  assert.equal(jiti.options.transform(base).code, original(base).code);
});
