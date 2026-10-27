// Actual installed launcher + native controlling PTY; no copied credential algorithm.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
export async function setupInstalledAuth(root, env, password, { replace = false, confirmation = password, expectedCode = 0, command, prefixArgs = [] } = {}) {
  const require = createRequire(`${root}/package.json`);
  const pty = require('node-pty');
  const launcher = command ?? `${root.slice(0, root.indexOf('/lib/node_modules/'))}/bin/brabbler`;
  let output = '', first = false, second = false, timedOut = false, leaked = false;
  const child = pty.spawn(launcher, [...prefixArgs, 'auth', 'setup', ...(replace ? ['--replace'] : [])],
    { name: 'xterm', cols: 80, rows: 24, cwd: env.HOME, env });
  const code = await new Promise(resolve => {
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10_000);
    const data = child.onData(chunk => {
      const combined = output + chunk;
      leaked ||= combined.includes(password) || combined.includes(confirmation);
      output = combined.slice(-8192);
      if (!first && output.includes('New passphrase (hidden):')) { first = true; child.write(password + '\r'); }
      if (!second && output.includes('Confirm passphrase (hidden):')) { second = true; child.write(confirmation + '\r'); }
    });
    child.onExit(({ exitCode }) => { clearTimeout(timer); data.dispose(); resolve(exitCode); });
  });
  assert.equal(leaked, false, 'PTY must never echo passphrase or confirmation');
  assert.equal(timedOut, false, 'installed auth CLI deadline');
  assert.equal(code, expectedCode, 'installed auth CLI exit status');
  return { hidden: true, confirmed: first && second, exitCode: code };
}
