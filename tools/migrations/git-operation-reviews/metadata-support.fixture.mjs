// Synthetic owner and real synchronous child helpers; no converter-policy replacement.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function metadataFixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'git-review-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessions = join(root, 'sessions'), legacy = join(root, 'legacy');
  for (const p of [sessions, legacy]) fs.mkdirSync(p, { mode: 0o700 });
  const timestamp = '2026-01-01T00:00:00.000Z', operationId = randomUUID();
  const rows = [
    { type: 'session', version: 3, id: randomUUID(), cwd: '/synthetic/repository', timestamp },
    { type: 'custom', id: 'prepared', parentId: null, timestamp, customType: 'brabbler:operation-receipt', data: {
      version: 1, pluginId: 'git-workflow', operationId, sequence: 1, phase: 'prepared', toolCallId: 'call',
      authorization: { mode: 'allow', source: 'project', revision: 'saved', decision: 'policy-authorized' },
      checks: [], effectStarted: false, card: { title: 'Git', operationId, patch: 'synthetic old inline patch', actions: [] },
    } },
  ];
  const file = join(sessions, 'owner.jsonl');
  fs.writeFileSync(file, rows.map(v => JSON.stringify(v)).join('\n') + '\n', { mode: 0o640 });
  return { root, sessions, legacy, file, output: join(root, 'output') };
}
export function ownerSnapshot(f) {
  const s = fs.statSync(f.file);
  return { bytes: fs.readFileSync(f.file).toString('hex'), mode: s.mode & 0o777, ino: s.ino, uid: s.uid, gid: s.gid };
}
export function nodeChild(script, args = [], { blocked = false, denied = false, env = process.env } = {}) {
  const argv = [process.execPath, '--input-type=module', '-e', script, '--', ...args];
  if (denied) argv.unshift('--permission-denied');
  return spawnSync(blocked || denied ? 'brabbler-test-deny-xattrs' : argv.shift(), argv, { env, encoding: 'utf8', maxBuffer: 64 * 1024 });
}
export const guardScript = `import fs from 'node:fs'; import {assertNoAttributes} from ${JSON.stringify(new URL('./io.mjs', import.meta.url).href)};
const fd=fs.openSync(process.argv[1],'r');
try { try { assertNoAttributes(fd); console.log(JSON.stringify({accepted:true})); } catch(e) { console.log(JSON.stringify({reason:e.reason})); } }
finally { fs.closeSync(fd); }`;
export const cliScript = `const {main}=await import(${JSON.stringify(new URL('./cli.mjs', import.meta.url).href)});process.exitCode=await main(process.argv.slice(1));`;
export const dryRunArgs = f => ['dry-run', '--sessions', f.sessions, '--operations', 'none', '--legacy', f.legacy, '--output', f.output];
