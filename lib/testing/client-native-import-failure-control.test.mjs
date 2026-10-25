// Separate N owner: deliberately DOES NOT import the F bootstrap/provisioner.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
function childControl(name, entryName, fatalMarker, receipt, requireNormalAfter = false) {
test(name, { timeout: 15000 }, async t => {
  let root, child, closed = false, accepted = false, timer;
  let closeWork = Promise.resolve();
  const failures = [];
  // Cleanup registered before allocation/admission; no root removal before the
  // actual child close and complete pipe transcript, even after assertion failure.
  t.after(async () => {
    if (child && !closed) {
      try { if (!child.kill('SIGKILL')) failures.push(Error('Child kill not accepted')); }
      catch (error) { failures.push(error); }
    }
    try { await closeWork; } catch (error) { failures.push(error); }
    clearTimeout(timer);
    if (root && accepted && failures.length === 0 && closed) {
      try { rmSync(root, { recursive: true, force: false }); } catch (error) { failures.push(error); }
    } else if (root) { failures.push(Error(`CNB_IMPORT_CHILD_UNCERTAIN root retained: ${root}`)); }
    if (failures.length) throw new AggregateError(failures.slice(0, 16), 'Native import-child cleanup/settlement failure');
  });
  const temp = resolve(tmpdir()), fromSource = relative(process.cwd(), temp);
  assert.equal(fromSource === '..' || fromSource.startsWith(`..${sep}`) || isAbsolute(fromSource), true);
  root = mkdtempSync(join(temp, 'pi-client-native-import-'));
  const entry = fileURLToPath(new URL(entryName, import.meta.url));
  const result = Promise.withResolvers();
  closeWork = result.promise;
  // No inherited credentials/options/NODE_TEST_CONTEXT, custom input or runner
  // allowlist changes. Absolute Node executable, no shell, IPC or grandchildren.
  try {
    child = spawn(process.execPath, [entry], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: { HOME: root, TMPDIR: root, TMP: root, TEMP: root, XDG_CACHE_HOME: root, JITI_FS_CACHE: '0', LANG: 'C.UTF-8' } });
  } catch (error) { result.resolve({ code: null, signal: null, transcript: '' }); throw error; }
  let transcript = '', bytes = 0;
  const receive = data => {
    bytes += data.length;
    if (bytes <= 32768) transcript += data.toString();
    else if (failures.length === 0) { failures.push(Error('Child transcript exceeded 32 KiB')); child.kill('SIGKILL'); }
  };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', receive);
    stream.on('error', error => failures.push(error));
  }
  child.on('error', error => failures.push(error));
  child.once('close', (code, signal) => { closed = true; result.resolve({ code, signal, transcript }); });
  timer = setTimeout(() => {
    failures.push(Error('Native import child deadline exceeded'));
    try { child.kill('SIGKILL'); } catch (error) { failures.push(error); }
  }, 10000);
  const outcome = await closeWork;
  clearTimeout(timer);
  t.diagnostic(outcome.transcript); // Actual bounded transcript, not invented result.
  assert.equal(failures.length, 0);
  assert.equal(outcome.signal, null);
  assert.equal(Number.isInteger(outcome.code) && outcome.code !== 0, true, 'actual dependency failure must be nonzero');
  assert.equal(outcome.transcript.includes(fatalMarker), true);
  assert.equal(outcome.transcript.includes(receipt), true,
    'actual synchronous descriptor/lifecycle receipt required, not an assumed root-after or exit');
  if (requireNormalAfter) {
    assert.equal(outcome.transcript.includes('CNB_ROOT_AFTER restored=true descriptors=true'), true);
  }
  accepted = true;
});
}
childControl('N child: fatal pre-root TLA requires actual synchronous fallback descriptor receipt',
  './client-native-import-child.fixture.mjs', 'CNB_TOP_LEVEL_IMPORT_FAILURE',
  'CNB_PRE_ROOT_FATAL admission=false phase=true descriptors=true clean=true complete=true');
childControl('N child: uncaught error after first per-test setup must NOT restore/unfence admitted work',
  './client-native-post-root-child.fixture.mjs', 'CNB_POST_ROOT_UNCAUGHT_CONTROL',
  'CNB_POST_ROOT_MONITOR admission=true active=true guarded=true restoredEarly=false', true);
