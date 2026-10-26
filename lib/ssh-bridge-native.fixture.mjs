// FIRST entry dependency: builtins only, before Jiti/SDK/application captures.
// Passive observation, not native cancellation or a replacement SSH engine.
import fs from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { after } from 'node:test';

const slots = [
  [fs, 'mkdtempSync'], [fs, 'rmdirSync'], [net.Server.prototype, 'listen'],
].map(([object, key]) => ({ object, key, original: Object.getOwnPropertyDescriptor(object, key) }));
const [makeDirectory, removeDirectory, listen] = slots.map(slot => slot.original.value);
const bootstrapErrors = [], owners = [];
let installed = false, current;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function replace(object, key, descriptor) {
  if (!Reflect.defineProperty(object, key, descriptor)) throw new Error(`Cannot restore/install SSH native observer: ${key}`);
}
function install() {
  if (installed) return;
  installed = true; // Partial installation is also owned by root-after.
  for (const slot of slots) replace(slot.object, slot.key, { ...slot.original, value: slot.wrapper });
  syncBuiltinESMExports();
}
function sameDescriptor(a, b) {
  if (!a || !b) return a === b;
  return ['value', 'writable', 'get', 'set', 'enumerable', 'configurable'].every(key =>
    Object.hasOwn(a, key) === Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}
function restoreBuiltins(errors) {
  if (!installed) return;
  for (const slot of slots.toReversed()) {
    try {
      if (!sameDescriptor(Object.getOwnPropertyDescriptor(slot.object, slot.key), { ...slot.original, value: slot.wrapper })) errors.push(new Error(`SSH observer descriptor drift: ${slot.key}`));
    } catch (error) { errors.push(error); }
    try {
      replace(slot.object, slot.key, slot.original);
      if (!sameDescriptor(Object.getOwnPropertyDescriptor(slot.object, slot.key), slot.original)) errors.push(new Error(`SSH observer restore mismatch: ${slot.key}`));
    } catch (error) { errors.push(error); }
  }
  try { syncBuiltinESMExports(); } catch (error) { errors.push(error); }
  installed = false;
}
function recordDirectory(owner, directory) {
  const record = { directory, path: join(directory, 'agent'), removals: [], calls: [], server: undefined,
    listenState: 'not-started', restored: false };
  owner.records.set(directory, record);
  owner.paths.set(record.path, record);
  if (owner.closing) owner.errors.push(new Error(`Late native bridge allocation: ${directory}`));
}
slots[0].wrapper = function (...args) {
  const result = Reflect.apply(makeDirectory, this, args);
  const owner = current;
  // Only the production's exact prefix and actual returned private directory.
  if (owner && args[0] === join(owner.tmp, 'pws-') && typeof result === 'string'
      && dirname(result) === owner.tmp && basename(result).startsWith('pws-')) recordDirectory(owner, result);
  return result;
};
slots[1].wrapper = function (...args) {
  const owner = current, record = owner?.records.get(args[0]);
  try {
    const result = Reflect.apply(removeDirectory, this, args);
    record?.removals.push({ status: 'fulfilled', value: result });
    return result;
  } catch (error) {
    if (record) {
      // Retain the ORIGINAL native error BEFORE BrowserSshAgent's catch swallows it.
      record.removals.push({ status: 'rejected', error });
      owner.errors.push(error);
    }
    throw error;
  }
};
function wrapClose(owner, record, server) {
  const previous = Object.getOwnPropertyDescriptor(server, 'close'), original = server.close;
  record.server = server;
  record.previousClose = previous;
  const wrapped = function (...args) {
    // Match ONLY this identified instance; wrong receivers remain native calls.
    if (this !== server) return Reflect.apply(original, this, args);
    const index = args.length - 1, callback = args[index];
    if (typeof callback !== 'function') {
      owner.errors.push(new Error(`Unsupported bridge close without original callback: ${record.directory}`));
      return Reflect.apply(original, this, args);
    }
    const done = deferred(), call = { done, returned: false, delivered: false };
    record.calls.push(call); // Before actual native close admission.
    const forwarded = [...args];
    forwarded[index] = function (...values) {
      call.delivered = true;
      call.receiver = this;
      call.args = values;
      if (values[0] !== undefined) owner.errors.push(values[0]);
      const deliver = () => {
        call.rootAtDelivery = fs.existsSync(owner.root);
        const finish = () => { call.returned = true; done.resolve(); };
        try {
          const result = Reflect.apply(callback, this, values);
          // Preserve the original callback return. Its full async return, if any,
          // belongs to this fixture too; the selected remove callback is sync.
          if (result && typeof result.then === 'function') {
            Promise.resolve(result).then(finish, error => { owner.errors.push(error); finish(); });
          } else finish();
          return result;
        } catch (error) { owner.errors.push(error); finish(); throw error; }
      };
      // Diagnostic only: native has ALREADY delivered this exact callback/args.
      // Normal cases delegate immediately and return the original callback value.
      return record.intercept ? record.intercept(deliver) : deliver();
    };
    try { return Reflect.apply(original, this, forwarded); }
    catch (error) {
      call.thrown = true; owner.errors.push(error);
      throw error; // Never convert a native close throw into synthetic completion.
    }
  };
  record.wrappedClose = wrapped;
  replace(server, 'close', previous ? { ...previous, value: wrapped } : { configurable: true, writable: true, value: wrapped });
}
slots[2].wrapper = function (...args) {
  const owner = current, record = typeof args[0] === 'string' ? owner?.paths.get(args[0]) : undefined;
  if (!record) return Reflect.apply(listen, this, args); // Router/all other servers untouched.
  try {
    if (record.server) throw new Error(`Duplicate native bridge listen: ${record.directory}`);
    wrapClose(owner, record, this);
    record.listenState = 'starting';
    const listening = () => { record.listenState = 'listening'; this.removeListener('error', failed); };
    const failed = error => { record.listenState = 'failed'; owner.errors.push(error); this.removeListener('listening', listening); };
    record.removeListeners = () => { this.removeListener('listening', listening); this.removeListener('error', failed); };
    this.once('listening', listening); this.once('error', failed);
  } catch (error) { owner.errors.push(error); }
  // The SAME Server, receiver, arguments and native return value; no listen gate.
  try { return Reflect.apply(listen, this, args); }
  catch (error) { record.listenState = 'threw'; owner.errors.push(error); throw error; }
};
function preOwnerFatal(error) {
  if (owners.length) return; // No async native owner exists before testcase admission.
  bootstrapErrors.push(error);
  try { restoreBuiltins(bootstrapErrors); } catch (cause) { bootstrapErrors.push(cause); }
}
process.on('uncaughtExceptionMonitor', preOwnerFatal); // Passive: preserve fatal policy.
after(() => {
  const errors = [...bootstrapErrors];
  try { process.off('uncaughtExceptionMonitor', preOwnerFatal); } catch (error) { errors.push(error); }
  for (const owner of owners) {
    if (!owner.joined) errors.push(new Error(`Unjoined SSH native owner; retain workspace: ${owner.root}`));
    if (!owner.errorsRead) errors.push(...owner.errors);
  }
  // An uncertain native callback must not lose its still-live fs/net collector.
  if (owners.every(owner => owner.joined)) restoreBuiltins(errors);
  if (errors.length) throw new AggregateError(errors, 'SSH native observer root cleanup failed');
});
install(); // Cleanup/monitor registered BEFORE patching or later dependency evaluation.

function observeBridges(root) {
  if (current && !current.joined) throw new Error('Prior native bridge owner is still unsettled');
  const tmp = resolve(tmpdir());
  if (dirname(root) !== tmp) throw new Error('SSH native case root must be directly inside this file process private tmpdir');
  install();
  const entered = deferred();
  const owner = { root, tmp, records: new Map(), paths: new Map(), errors: [], closing: false, joined: false, errorsRead: false };
  current = owner; owners.push(owner);
  let joining;
  return {
    joinEntered: entered.promise,
    snapshot() {
      return [...owner.records.values()].map(record => ({ directory: record.directory, path: record.path,
        listenState: record.listenState, callbackReturned: record.calls.length > 0 && record.calls.every(call => call.returned),
        nativeDelivered: record.calls.some(call => call.delivered), rootAtDelivery: record.calls.at(-1)?.rootAtDelivery,
        removals: record.removals.map(result => ({ ...result })), restored: record.restored }));
    },
    holdClose(directory) {
      const record = owner.records.get(directory);
      if (!record || record.calls.length || record.intercept) throw new Error('Hold requires one identified bridge before its actual close');
      const arrived = deferred();
      let released = false, waiting;
      record.intercept = deliver => { arrived.resolve(); if (released) return deliver(); waiting = deliver; };
      return { entered: arrived.promise, release() { released = true; const deliver = waiting; waiting = undefined; return deliver?.(); } };
    },
    join() {
      if (!joining) joining = (async () => {
        owner.closing = true; entered.resolve();
        let certain = true;
        // Retired bridges remain in this fixture Map, independent of engine Map deletion.
        for (const record of owner.records.values()) {
          if (record.server && (!record.calls.length || record.calls.some(call => call.thrown && !call.returned))) {
            certain = false;
            owner.errors.push(new Error(`No completed original native close callback for partial bridge: ${record.directory}`));
            continue; // Unsupported partial start: retain, never invent a close/join.
          }
          await Promise.all(record.calls.map(call => call.done.promise));
          if (!record.removals.length) {
            certain = false; owner.errors.push(new Error(`No actual native rmdir outcome for bridge: ${record.directory}`)); continue;
          }
          // Native close callback and its full original remove have completed,
          // including retained native failures. Only now restore instance descriptors.
          record.restored = !record.server;
          if (record.server) {
            try { record.removeListeners?.(); } catch (error) { owner.errors.push(error); }
            try {
              const expected = record.previousClose ? { ...record.previousClose, value: record.wrappedClose } : { configurable: true, writable: true, enumerable: false, value: record.wrappedClose };
              if (!sameDescriptor(Object.getOwnPropertyDescriptor(record.server, 'close'), expected)) owner.errors.push(new Error('Bridge close descriptor drift'));
            } catch (error) { owner.errors.push(error); }
            try {
              if (record.previousClose) replace(record.server, 'close', record.previousClose);
              else if (!Reflect.deleteProperty(record.server, 'close')) throw new Error('Cannot restore inherited bridge close');
              record.restored = sameDescriptor(Object.getOwnPropertyDescriptor(record.server, 'close'), record.previousClose);
              if (!record.restored) owner.errors.push(new Error('Bridge close restore mismatch'));
            } catch (error) { owner.errors.push(error); }
          }
        }
        if (certain) { restoreBuiltins(owner.errors); owner.joined = true; }
      })();
      return joining;
    },
    errors() { owner.errorsRead = true; return [...owner.errors]; },
  };
}

// Shared only by this actual route case and its contained native controls.
// No production algorithm, cancellation authority, timer or fake native port.
export function sshNativeCase(t, { root, pool = () => undefined, router = () => undefined, routerAttempted = () => false, restore = [] }) {
  const bridges = observeBridges(root);
  let closing;
  const close = () => {
    if (!closing) {
      closing = (async () => {
        const errors = [];
        try { await pool()?.dispose(); } catch (error) { errors.push(error); }
        try { await router()?.close(); } catch (error) { errors.push(error); }
        // G1-JOIN: full original native callback/remove, then descriptor restoration.
        try { await bridges.join(); } catch (error) { errors.push(error); }
        for (const fn of restore) { try { await fn(); } catch (error) { errors.push(error); } }
        errors.push(...bridges.errors()); // Original native errors, including swallowed rmdir.
        if (routerAttempted() && !router()) errors.push(new Error(`Router startup rejected; preserve private partial-start root: ${root}`));
        if (!errors.length) {
          try {
            if (router() && fs.existsSync(router().root)) throw new Error('Real router runtime remains after close');
            fs.rmSync(root, { recursive: true, force: true });
          } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, `SSH native route cleanup incomplete; retained ${root}`);
      })();
      void closing.catch(() => {}); // Retain the original cleanup result for its caller/hook.
    }
    return closing;
  };
  t.after(close); // Before application import/native bridge admission.
  return { bridges, close };
}

// Expected-error adapter for the COMPLETE original shared cleanup outcome.
// Never filter to the bridge ledger, reorder causes, clone Errors or replace an
// unexpected original rejection with a verification/length AssertionError.
export function acceptSshCleanupOutcome(outcome, expectedErrors) {
  if (outcome.status === 'rejected') {
    const reason = outcome.reason;
    if (expectedErrors.length > 0 && reason instanceof AggregateError && Array.isArray(reason.errors)
        && reason.errors.length === expectedErrors.length
        && reason.errors.every((error, index) => error === expectedErrors[index])) return outcome;
    throw reason;
  }
  if (outcome.status !== 'fulfilled' || expectedErrors.length) throw new Error('Expected full SSH cleanup rejection was not observed');
  return outcome;
}
