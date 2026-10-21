import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-acceptance-'));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  const cwd = join(root, 'project'); mkdirSync(cwd);
  writeFileSync(join(cwd, 'test.mjs'), 'console.log("fixture");');
  t.after(() => {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    function writable(file) {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) return;
      chmodSync(file, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) for (const name of readdirSync(file)) writable(join(file, name));
    }
    writable(root); rmSync(root, { recursive: true, force: true });
  });
  return { root, cwd };
}
export const profile = (name = 'full') => ({ name, label: 'Synthetic acceptance', coverage: 'full', argv: ['node', 'test.mjs'], inputs: ['test.mjs'], cpus: 1, memoryMiB: 128, permission: 'allow' });
export async function until(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Condition did not settle'); await new Promise((r) => setTimeout(r, 10)); }
}
