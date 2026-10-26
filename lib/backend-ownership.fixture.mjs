// Backend-only whole-module capability loader. No source slicing, rewritten
// callbacks, filesystem transpiler cache, alternate production decisions or SDK.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { createJiti } from 'jiti';
import assert from 'node:assert/strict';
export { deferred } from './testing/async.fixture.mjs';

export async function loadBackend(url, capabilities, { actual = false, globals = {} } = {}) {
  const filename = fileURLToPath(url);
  const require = createRequire(url);
  const jiti = createJiti(url.href, { fsCache: false, moduleCache: false, alias: { '@': process.cwd() } });
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const loadedModule = { exports: {} };
  const preloaded = new Map();
  // Resolve retained static dependencies asynchronously (including ESM SDK
  // graphs), not via a synchronous require of an async module. Do not eagerly
  // load dynamic imports from uninvoked handler branches.
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true);
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const name = statement.moduleSpecifier.text;
    if (!compiled.includes(`require(${JSON.stringify(name)})`)) continue;
    if (Object.hasOwn(capabilities, name)) { preloaded.set(name, capabilities[name]); continue; }
    if (!actual) throw new Error(`Unadmitted backend capability: ${name}`);
    const target = name.startsWith('@/') ? name.replace('@/', `${process.cwd()}/`) : name;
    preloaded.set(name, await jiti.import(target));
  }
  const imports = name => {
    if (Object.hasOwn(capabilities, name)) return capabilities[name];
    if (preloaded.has(name)) return preloaded.get(name);
    if (!actual) throw new Error(`Unadmitted backend capability: ${name}`);
    // Only lazily invoked non-static external imports reach this branch.
    return require(name);
  };
  // Whole compiled module runs in the ordinary realm: native errors/objects keep
  // identity. Lexical capabilities override timers only for the loaded owner.
  const names = Object.keys(globals);
  const initialize = vm.runInThisContext(`(function(require,module,exports,__filename,__dirname,${names.join(',')}) {\n${compiled}\n})`, { filename });
  initialize(imports, loadedModule, loadedModule.exports, filename, fileURLToPath(new URL('.', url)), ...Object.values(globals));
  return loadedModule.exports;
}
export const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };

// Fixture-owned SDK-shaped children only; not product abort/retirement policy.
// Every peer gets both attempts, even if abort throws synchronously. Await a
// returned dispose promise too: invocation alone is not resource settlement.
export async function disposeFixtureChildren(children) {
  const results = await Promise.allSettled([...new Set(children)].map(async child => {
    const errors = [];
    try { await child.abort(); } catch (error) { errors.push(error); }
    try { await child.dispose(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Fixture child cleanup failed');
  }));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, 'Fixture children cleanup failed');
}

// waitUntilReady observes the actual binding/start continuation. Shutdown must
// still run after failed readiness; keep both causes and let backendCase retain
// the native root on any uncertainty. Never substitute destroy() or completion.
export async function settleFixtureRpc(wrapper) {
  const errors = [];
  try { await wrapper.waitUntilReady(); } catch (error) { errors.push(error); }
  try { await wrapper.shutdown(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'Fixture RPC cleanup failed');
}

// Track full handlers/response consumers, not a fetch-resolution marker. Expected
// errors must be asserted *inside* the tracked operation. Release all peers even
// after an assertion/release fails. after-hook reports cleanup alongside primary.
export function backendCase(t) {
  const joins = [], releases = [], failures = [], finals = [], removals = [];
  let closed = false;
  t.after(async () => {
    closed = true;
    const releaseResults = await Promise.allSettled(releases.map(fn => Promise.resolve().then(fn)));
    const results = await Promise.allSettled(joins.map(fn => Promise.resolve().then(fn)));
    const finalResults = await Promise.allSettled(finals.map(fn => Promise.resolve().then(fn)));
    const errors = [...failures, ...releaseResults, ...results, ...finalResults].flatMap(result => result?.status === 'rejected' ? [result.reason] : result instanceof Error ? [result] : []);
    // Uncertain cleanup retains private native roots; globals still restore.
    if (!errors.length) {
      const removed = await Promise.allSettled(removals.map(fn => Promise.resolve().then(fn)));
      errors.push(...removed.filter(result => result.status === 'rejected').map(result => result.reason));
    }
    if (errors.length) throw new AggregateError(errors, 'Backend cleanup/admission failures');
  });
  return {
    release(fn) { releases.push(fn); },
    final(fn) { finals.push(fn); },
    remove(fn) { removals.push(fn); },
    join(fn) { joins.push(fn); },
    work(promise) { const p = Promise.resolve(promise); void p.catch(() => {}); joins.push(() => p); return p; },
    // Finite JSON/text responses only. Tests await the actual json/text/byte body;
    // assertion failure before consumption must still close that unread body.
    response(promise) {
      const work = this.work(promise);
      joins.push(async () => { const response = await work; if (response.body && !response.bodyUsed) await response.body.cancel(); });
      return work;
    },
    unexpected(label) { return (...args) => { const error = new Error(`Unexpected capability: ${label} (${args.length} arguments)`); failures.push(error); throw error; }; },
    admit() {
      if (closed) { const error = new Error('no late backend admission'); failures.push(error); throw error; }
      assert.equal(closed, false);
    },
  };
}
