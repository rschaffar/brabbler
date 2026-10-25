// Test-file-local native descriptor observation. Import before application
// dependencies capture createReadStream; never wrap a public search promise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

const descriptor = Object.getOwnPropertyDescriptor(fs, 'createReadStream');
const original = fs.createReadStream;
const scopes = new Set();
const pathOf = path => resolve(path instanceof URL ? fileURLToPath(path) : Buffer.isBuffer(path) ? path.toString() : path);
const within = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
function observedCreateReadStream(...args) {
  // Delegate once with the identical receiver/arguments and return SAME stream.
  const stream = Reflect.apply(original, this, args);
  const file = args[0];
  if (typeof file !== 'string' && !Buffer.isBuffer(file) && !(file instanceof URL)) return stream;
  const path = pathOf(file);
  for (const scope of scopes) {
    if (!scope.roots.some(root => within(root, path))) continue;
    // Real close is observed before handing the stream to readline/iterator.
    // Do not consume data, add error handlers, destroy or replace callbacks.
    const closed = new Promise((resolveClose, rejectClose) => stream.once('close', () => {
      if (stream.fd !== null) rejectClose(new Error(`Native stream close left a descriptor: ${path}`));
      else resolveClose();
    }));
    void closed.catch(() => {});
    scope.closes.push(closed);
  }
  return stream;
}
Object.defineProperty(fs, 'createReadStream', { ...descriptor, value: observedCreateReadStream });
syncBuiltinESMExports();
after(() => {
  const errors = [];
  if (scopes.size) errors.push(new Error('Unsettled native search fixture scopes remain'));
  if (fs.createReadStream !== observedCreateReadStream) errors.push(new Error('Native stream observer identity changed'));
  Object.defineProperty(fs, 'createReadStream', descriptor);
  syncBuiltinESMExports();
  if (errors.length) throw new AggregateError(errors, 'Native search observer restoration failed');
});

export function createSearchStreamScope() {
  const scope = { roots: [], closes: [] };
  let finished = false;
  scopes.add(scope);
  return {
    root(path) {
      assert.equal(finished, false, 'native stream root admission closed');
      assert.equal(isAbsolute(path), true, 'native stream root must be absolute');
      const root = pathOf(path);
      assert.notEqual(root, resolve(sep), 'filesystem root is not a fixture root');
      scope.roots.push(root);
    },
    async settle() {
      assert.equal(fs.createReadStream, observedCreateReadStream, 'native stream observer identity changed before settlement');
      // Full selected handlers have already stopped admitting streams. A close
      // listener may synchronously admit another selected stream; join that too.
      let count;
      const errors = [];
      do {
        count = scope.closes.length;
        const results = await Promise.allSettled(scope.closes.slice());
        errors.push(...results.filter(result => result.status === 'rejected').map(result => result.reason));
      } while (scope.closes.length !== count);
      assert.equal(fs.createReadStream, observedCreateReadStream, 'native stream observer identity changed during settlement');
      if (errors.length) throw new AggregateError(errors, 'Native search descriptor settlement failed');
    },
    finish() { finished = true; scopes.delete(scope); },
  };
}
