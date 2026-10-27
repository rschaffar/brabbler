import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function fixture(t, { enabled = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pi-acceptance-'));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  const pluginDirectory = join(root, 'agent', 'brabbler', 'plugins', 'acceptance');
  mkdirSync(pluginDirectory, { recursive: true, mode: 0o700 });
  const pluginSettingsPath = join(pluginDirectory, 'settings.json');
  writeFileSync(pluginSettingsPath, JSON.stringify({ version: 1, global: { enabled }, projects: {} }), { mode: 0o600 });
  const cwd = join(root, 'project'); mkdirSync(cwd);
  writeFileSync(join(cwd, 'test.mjs'), 'console.log("fixture");');
  const owners = new Set(), releases = new Set(), operations = new Set();
  const own = owner => { owners.add(owner); return owner; };
  const release = callback => { releases.add(callback); return callback; };
  const track = promise => { operations.add(promise); void promise.catch(() => {}); return promise; };
  const hold = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    release(resolve); return { promise, resolve };
  };
  t.after(async () => {
    // Stop admission/scheduling before releasing a held pump, capture or executor.
    // All owners share this one fixture cleanup, before env restoration/removal.
    const drains = [...owners].map(owner => owner.dispose());
    const errors = [];
    for (const done of releases) { try { done(); } catch (error) { errors.push(error); } }
    const drained = await Promise.allSettled(drains);
    await Promise.allSettled(operations);
    for (const result of drained) if (result.status === 'rejected') errors.push(result.reason);
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    if (errors.length) throw new AggregateError(errors, `Acceptance fixture cleanup failed; retained ${root}`);
    function writable(file) {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) return;
      chmodSync(file, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) for (const name of readdirSync(file)) writable(join(file, name));
    }
    writable(root); rmSync(root, { recursive: true, force: true });
  });
  return { root, cwd, pluginSettingsPath, own, release, track, hold };
}
export const profile = (name = 'full') => ({ name, label: 'Synthetic acceptance', coverage: 'full', argv: ['node', 'test.mjs'], inputs: ['test.mjs'], cpus: 1, memoryMiB: 128, permission: 'allow' });
export async function until(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Condition did not settle'); await new Promise((r) => setTimeout(r, 10)); }
}
