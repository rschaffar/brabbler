import { providedRoot } from './client-native-control-provision.fixture.mjs';
import './client-native-boundary.fixture.mjs';
import { esmInitializationWriteProbe } from './client-native-esm-captured.fixture.mjs';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { writeFileSync, openSync, closeSync, existsSync, constants } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { connect, Socket } from 'node:net';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createJiti } from 'jiti';
import { NATIVE_DENIAL_CODE, expectNativeDenial, clientNativeBoundaryStatus } from './client-native-boundary.fixture.mjs';

// Dedicated N provisioning is the FIRST dependency, solely for this owner.
// It exports only a private path; the next dependency is the pure early fence.
// No custom environment input, runner CLI or ordinary-F native allow API.
assert.equal(isAbsolute(providedRoot), true);
const root = resolve(providedRoot);
assert.notEqual(root, resolve(sep));
const fromSource = relative(process.cwd(), root);
assert.equal(fromSource === '..' || fromSource.startsWith(`..${sep}`) || isAbsolute(fromSource), true,
  'owned N probe root must be outside source cwd');
const target = resolve(root, 'captured-write-probe.txt');
// The dedicated exclusive root contains no executable; this path remains absent.
// A disabled guard reaches only ENOENT, never a credential-bearing executable.
const nonexistentExecutable = resolve(root, 'MUST-NOT-EXIST-client-native-probe-executable');
assert.equal(existsSync(nonexistentExecutable), false, 'exact probe executable must not exist');
const capturedHostWrite = writeFileSync;
const capturedHostConnect = connect;
const capturedHostSocketConnect = Socket.prototype.connect;
const capturedHostSpawn = spawnSync;
const jiti = createJiti(import.meta.url, { fsCache: false });
const captured = await jiti.import('./client-native-captured.fixture.ts');
function marker(port, call) {
  const error = expectNativeDenial(port, call);
  assert.equal(error.code, NATIVE_DENIAL_CODE);
  assert.equal(error.port, port);
  assert.equal(error.message, `${NATIVE_DENIAL_CODE}: ${port}`);
}

test('actual ESM dependency-time capture proves first-import ordering, not a later installation', () => {
  marker('fs.writeFileSync', () => esmInitializationWriteProbe(target));
});
test('host captured write function is an exact early denial, not a private write success', () => {
  marker('fs.writeFileSync', () => capturedHostWrite(target, 'owned private control\n'));
});
test('real Jiti module captured write function sees the same early denial', () => {
  marker('fs.writeFileSync', () => captured.capturedWriteProbe(target));
});
test('host and Jiti captured connect contrast invalid port without making a network attempt', () => {
  marker('net.connect', () => capturedHostConnect(-1));
  marker('net.connect', () => captured.capturedConnectProbe());
});
test('actual Socket prototype connect is guarded, including its captured Jiti reference', () => {
  const socket = new Socket();
  try { marker('net.Socket.prototype.connect', () => capturedHostSocketConnect.call(socket, -1)); }
  finally { socket.destroy(); }
  marker('net.Socket.prototype.connect', () => captured.capturedSocketProbe());
});
test('host and Jiti spawnSync contrast one exact nonexistent executable', () => {
  marker('child_process.spawnSync', () => capturedHostSpawn(nonexistentExecutable, [], { timeout: 1000 }));
  marker('child_process.spawnSync', () => captured.capturedSpawnProbe(nonexistentExecutable));
});
test('write-capable open contrasts only the owned root, including numeric flags', () => {
  // A removed open guard can create only the supplied private control file;
  // close its real descriptor synchronously even in the missing-guard variant.
  marker('fs.openSync.writeFlags', () => {
    const fd = openSync(target, 'w');
    try { return fd; } finally { closeSync(fd); }
  });
  marker('fs.openSync.writeFlags', () => {
    const fd = openSync(target, constants.O_WRONLY);
    try { return fd; } finally { closeSync(fd); }
  });
});
test('actual read-only FileHandle remains readable but metadata/write methods are fenced', async () => {
  const handle = await fsPromises.open(resolve(root, 'read.txt'), 'r');
  try {
    assert.equal(await handle.readFile('utf8'), 'owned read control\n');
    // Even a missing-guard mutant must join any admitted real async operation
    // before closing the handle/root. These are private-root-only operations.
    for (const [port, call] of [
      ['FileHandle.chmod', () => handle.chmod(0o600)],
      ['FileHandle.writeFile', () => handle.writeFile('private control')],
    ]) {
      let admitted;
      try { marker(port, () => { admitted = call(); return admitted; }); }
      finally { if (admitted && typeof admitted.then === 'function') await admitted; }
    }
  } finally { await handle.close(); }
});
test('failed dependency import leaves the native fence and root collector installed', async () => {
  await assert.rejects(import('./client-native-import-failure.fixture.mjs'),
    error => error.message === 'CLIENT_NATIVE_BOUNDARY_CONTROLLED_IMPORT_FAILURE');
  marker('net.connect', () => capturedHostConnect(-1));
  assert.equal(clientNativeBoundaryStatus().phase, 'active');
});
test('expected probes cannot clear unrelated denials: positive owner has none', () => {
  const state = clientNativeBoundaryStatus();
  assert.equal(state.phase, 'active');
  assert.equal(state.unexpectedCount, 0);
  assert.equal(state.installed > 0, true);
});

// Registered after the bootstrap root hook. Tests' actual joins/handle closes
// precede both. The early hook itself independently verifies every descriptor;
// this observer is supplementary and never performs restoration/unguarding.
after(() => {
  const state = clientNativeBoundaryStatus();
  assert.equal(state.phase, 'restored');
  assert.equal(state.restored, state.installed);
  assert.equal(state.unexpectedCount, 0);
});
