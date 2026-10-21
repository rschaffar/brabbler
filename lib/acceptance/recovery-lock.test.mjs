import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { fixture, until } from './test.fixture.mjs';
const jiti = createJiti(import.meta.url);
const { recoverAcceptanceState, recoveryScript } = await jiti.import('./recovery-lock.ts');
const { processIdentity } = await jiti.import('./process.ts');
function request(root) {
  const file = join(root, 'runs.json');
  return { token: 'recovery-fixture', process: processIdentity(process.pid),
    expectedLedgerDigest: existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null,
    ledger: JSON.stringify({ version: 1, runs: [] }) };
}
test('lock-owning recovery refuses changed ledgers and foreign live owners without replacing state', async (t) => {
  const f = fixture(t), input = request(f.root);
  await recoverAcceptanceState(f.root, input);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'controller.json'), 'utf8')).token, input.token);
  await assert.rejects(recoverAcceptanceState(f.root, input), /ledger changed/);
  await assert.rejects(recoverAcceptanceState(f.root, { ...request(f.root), token: 'another-server' }), /still alive/);
  const before = readFileSync(join(f.root, 'runs.json'), 'utf8');
  await assert.rejects(recoverAcceptanceState(f.root, { ...request(f.root), expectedLedgerDigest: 'wrong' }), /ledger changed/);
  assert.equal(readFileSync(join(f.root, 'runs.json'), 'utf8'), before);
});
test('helper loss releases exclusion only when that same critical mutator has stopped; no parent callback continues', async (t) => {
  const f = fixture(t), marker = join(f.root, 'entered');
  const input = request(f.root);
  const script = recoveryScript.replace('// Recovery owner is durable.', `fs.writeFileSync(${JSON.stringify(marker)},'entered');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000); // Recovery owner is durable.`);
  assert.notEqual(script, recoveryScript);
  const child = spawn('flock', ['--exclusive', '--nonblock', '--no-fork', join(f.root, 'recovery.flock'), process.execPath, '-e', script, f.root], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += data; }); child.stdout.resume();
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  child.stdin.end(JSON.stringify(input));
  try {
    await until(() => existsSync(marker));
    assert.equal(existsSync(join(f.root, 'runs.json')), false, errors);
    await assert.rejects(recoverAcceptanceState(f.root, input), /refused/);
    child.kill('SIGKILL'); assert.equal((await closed).signal, 'SIGKILL');
    assert.equal(existsSync(join(f.root, 'runs.json')), false, 'a surviving parent did not continue critical writes');
    await recoverAcceptanceState(f.root, input);
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'runs.json'), 'utf8')), { version: 1, runs: [] });
  } finally { child.kill('SIGKILL'); await closed; }
});
test('malformed recovery state is retained, not replaced by a claimed result', async (t) => {
  const f = fixture(t); writeFileSync(join(f.root, 'controller.json'), 'invalid');
  await assert.rejects(recoverAcceptanceState(f.root, request(f.root)), /refused/);
  assert.equal(readFileSync(join(f.root, 'controller.json'), 'utf8'), 'invalid');
});
