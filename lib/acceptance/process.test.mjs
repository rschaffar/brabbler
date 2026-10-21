import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { fixture } from './test.fixture.mjs';
const { executeAcceptance, processIdentity } = await createJiti(import.meta.url).import('./process.ts');
test('real owned execution records exit status/logs and observes normal settlement', async (t) => {
  const f = fixture(t), logPath = join(f.root, 'output.log');
  const result = await executeAcceptance([process.execPath, '-e', 'console.log("real fixture output"); process.exitCode=7'], {
    cwd: f.cwd, env: { PATH: process.env.PATH }, logPath, signal: new AbortController().signal,
  });
  assert.equal(result.code, 7); assert.equal(result.settled, true);
  assert.match(readFileSync(logPath, 'utf8'), /real fixture output/);
});
test('missing executable fails honestly without an unsettled child', async (t) => {
  const f = fixture(t);
  const result = await executeAcceptance(['/no/such/acceptance-program'], { cwd: f.cwd, env: {}, logPath: join(f.root, 'missing.log'), signal: new AbortController().signal });
  assert.notEqual(result.code, 0); assert.equal(result.settled, true); assert.match(result.error, /ENOENT/);
});
test('explicit cancellation authenticates the owned process and waits for its closure', async (t) => {
  const f = fixture(t), controller = new AbortController(); let identity;
  const result = await executeAcceptance([process.execPath, '-e', 'setInterval(()=>{},1000)'], {
    cwd: f.cwd, env: {}, logPath: join(f.root, 'cancel.log'), signal: controller.signal, graceMs: 100,
    onSpawn(value) { identity = value; setTimeout(() => controller.abort(), 25); },
  });
  assert.ok(identity); assert.equal(result.interrupted, true); assert.equal(result.settled, true);
  assert.equal(processIdentity(identity.pid), undefined);
});
test('a detached descendant keeping a pipe open cannot manufacture successful settlement', async (t) => {
  const f = fixture(t);
  const source = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},1800)'],{detached:true,stdio:['ignore',process.stdout,process.stderr]});child.unref();`;
  const result = await executeAcceptance([process.execPath, '-e', source], { cwd: f.cwd, env: {}, logPath: join(f.root, 'pipe.log'), signal: new AbortController().signal });
  assert.equal(result.settled, false);
  // The fixture descendant is deliberately finite; wait for it, never broaden ownership by PID search.
  await new Promise((resolve) => setTimeout(resolve, 1900));
});
