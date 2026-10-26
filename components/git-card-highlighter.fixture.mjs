import { deferred } from '../lib/testing/async.fixture.mjs';

// The public root is import-only. Native ESM resolution selects its import
// condition; the resulting file URL bypasses the bare-specifier Jiti alias.
// Parser, file types and React's CodeView retain the genuine package identity.
const actual = await import(import.meta.resolve('@pierre/diffs'));
export const parsePatchFiles = actual.parsePatchFiles;
export const SPLIT_WITH_NEWLINES = actual.SPLIT_WITH_NEWLINES;
export const getFiletypeFromFileName = actual.getFiletypeFromFileName;
export const FileRenderer = actual.FileRenderer;
export const DiffHunksRenderer = actual.DiffHunksRenderer;
export const calls = [];
// Independent external-capability receipts, including unheld admissions. Never
// register these as parent read work: forwarding remains production's obligation.
export const nativeOriginals = [];
let held = false;
export function hold(value = true) { held = value; }
export function releaseAll() { for (const call of calls) call.release(); }
export function preloadHighlighter(...args) {
  const native = actual.preloadHighlighter(...args);
  nativeOriginals.push(native);
  if (!held) return native;
  const gate = deferred();
  // This gate delays only the external capability result. Production still owns
  // its unchanged .then(success, failure) handler, captured below by identity.
  const promise = Promise.all([native, gate.promise]).then(([value]) => value);
  const call = { promise, handler: undefined, release: () => gate.resolve() };
  const then = promise.then;
  Object.defineProperty(promise, 'then', { configurable: true, value: function (...handlers) {
    const work = then.apply(this, handlers);
    call.handler ??= work;
    return work;
  } });
  calls.push(call);
  return promise;
}
