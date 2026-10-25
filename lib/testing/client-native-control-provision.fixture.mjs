// N-ONLY: first dependency ONLY of client-native-boundary.test.mjs.
// No dependency on the F bootstrap, and no exported native functions/allow API.
import { after } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';
import process from 'node:process';
const nativeRemove = rmSync, nativeWrite = writeFileSync;
const get = Object.getOwnPropertyDescriptor, define = Reflect.defineProperty, remove = Reflect.deleteProperty;
const writeDiagnostic = process.stderr.write.bind(process.stderr);
const initialWrite = get(fs, 'writeFileSync'), initialChdir = get(process, 'chdir');
const envKeys = ['TMPDIR', 'TMP', 'TEMP'];
const previous = new Map(envKeys.map(key => [key, get(process.env, key)]));
let ownRoot, complete = false, testLevelJoined = false, uncertainty = false;
const errors = [];
function same(a, b) {
  if (!a || !b) return a === b;
  return ['value', 'writable', 'get', 'set', 'enumerable', 'configurable'].every(key =>
    Object.hasOwn(a, key) === Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}
const monitor = () => { uncertainty = true; };
// Register ALL cleanup/observation BEFORE allocation. No handler suppresses an
// exception/rejection. Exit cleanup is synchronous and closed over only ownRoot.
process.on('uncaughtExceptionMonitor', monitor);
after(() => { testLevelJoined = true; });
process.once('exit', code => {
  // Root after hooks (including bootstrap restoration and its later witness)
  // have finished before normal exit. Fatal/forced exit is never clean evidence.
  for (const [key, descriptor] of previous) {
    try {
      if (!(descriptor ? define(process.env, key, descriptor) : remove(process.env, key))) throw Error(`Cannot restore ${key}`);
      if (!same(get(process.env, key), descriptor)) throw Error(`Wrong restored ${key}`);
    } catch (error) { errors.push(error); uncertainty = true; }
  }
  const restored = same(get(fs, 'writeFileSync'), initialWrite) && same(get(process, 'chdir'), initialChdir);
  if (ownRoot && complete && testLevelJoined && code === 0 && !uncertainty && restored) {
    try { nativeRemove(ownRoot, { recursive: true, force: false }); }
    catch (error) { errors.push(error); uncertainty = true; }
  } else if (ownRoot) { uncertainty = true; }
  process.off('uncaughtExceptionMonitor', monitor);
  if (uncertainty || errors.length) {
    process.exitCode = 1;
    writeDiagnostic(`CNB_N_ROOT_RETAINED ${ownRoot ?? '(allocation incomplete)'} errors=${errors.length}\n`);
  }
});
try {
  const base = resolve(tmpdir());
  const fromSource = relative(process.cwd(), base);
  if (!(fromSource === '..' || fromSource.startsWith(`..${sep}`) || isAbsolute(fromSource))) {
    throw Error('Native control temp base must be outside source cwd');
  }
  ownRoot = mkdtempSync(join(base, 'pi-client-native-control-'));
  // tmpdir privacy alone is not ownership; mkdtemp creates the exclusive root.
  for (const key of envKeys) process.env[key] = ownRoot;
  nativeWrite(join(ownRoot, 'read.txt'), 'owned read control\n', { flag: 'wx', mode: 0o600 });
  complete = true;
} catch (error) { uncertainty = true; throw error; }
export const providedRoot = ownRoot;
