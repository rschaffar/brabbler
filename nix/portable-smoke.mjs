// Additional release-artifact verification on ordinary Linux/macOS Node, not a
// replacement for Nix acceptance. Never builds the application or uses live state.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { setupInstalledAuth } from './auth-setup.fixture.mjs';
import { verifySourceVersion } from './collect-notices.mjs';

export function verifyArchive(file, expected, extension = '.tgz') {
  assert.match(expected ?? '', /^[a-f0-9]{64}$/, 'exact tarball SHA-256 required');
  assert.ok(file.endsWith(extension) && statSync(file).isFile(), 'regular release archive required');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), expected, 'tarball identity');
}
export function smokeEnvironment(root, executablePath = process.env.PATH) {
  return {
    PATH: executablePath, HOME: root, TMPDIR: root, TMP: root, TEMP: root,
    PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1', BRABBLER_SKIP_VERSION_CHECK: '1', TERM: 'xterm', SHELL: '/bin/sh',
    npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: join(root, 'npm-cache'),
    npm_config_userconfig: join(root, 'user.npmrc'), npm_config_globalconfig: join(root, 'global.npmrc'),
  };
}
async function command(command, args, env, cwd, timeout = 180_000) {
  const child = spawn(command, args, { env, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const capture = chunk => { output = (output + chunk).slice(-128 * 1024); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  let expired = false, timer;
  const exit = once(child, 'close');
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Final bounded close still decides settlement. */ }
      }
      reject(new Error(`Command deadline: ${command}\n${output}`));
    }, timeout);
  });
  try {
    const [code] = await Promise.race([exit, deadline]);
    assert.equal(code, 0, `command failed: ${command}\n${output}`);
    return output;
  } catch (error) {
    if (!expired) throw error;
    return preserveFailure(() => { throw error; }, async () => {
      if (!(await boundedClose(exit, 5_000))) {
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        throw new Error('Command pipe settlement uncertain');
      }
    });
  } finally { clearTimeout(timer); }
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  const closed = once(server, 'close'); server.close(); await closed;
  return port;
}
async function boundedClose(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export async function preserveFailure(action, cleanup) {
  let value, primary, failed = false;
  try { value = await action(); } catch (error) { failed = true; primary = error; }
  try { await cleanup(); } catch (error) {
    if (failed) throw new AggregateError([primary, error], 'Operation and cleanup both failed');
    throw error;
  }
  if (failed) throw primary;
  return value;
}
export function ownLauncher(child, logs, { wait = boundedClose, signalGroup = (pid, signal) => process.kill(-pid, signal) } = {}) {
  let closed = false, requested = false, unexpected = false, status, stopping;
  child.once('exit', (code, signal) => { status = { code, signal }; unexpected ||= !requested; });
  const exit = new Promise(resolve => child.once('close', (code, signal) => {
    closed = true; status = { code, signal }; unexpected ||= !requested; resolve();
  }));
  const alive = () => child.pid && child.exitCode === null && child.signalCode === null;
  return {
    snapshot: () => ({ closed, requested, unexpected, status }),
    stop() {
      stopping ??= (async () => {
        requested = true;
        if (!closed && alive()) child.kill('SIGTERM');
        let settled = closed || await wait(exit, 10_000), forced = false;
        if (!settled) {
          // Never signal a possibly recycled group after its leader has exited.
          if (alive()) { signalGroup(child.pid, 'SIGKILL'); forced = true; }
          settled = await wait(exit, 5_000);
        }
        if (!settled) {
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          throw new Error(`Launcher/pipe settlement uncertain; retain the smoke root\n${logs()}`);
        }
        assert.equal(unexpected, false, `Launcher exited unexpectedly: ${JSON.stringify(status)}\n${logs()}`);
        assert.equal(forced, false, `Launcher needed forced shutdown\n${logs()}`);
        assert.ok(status?.code === 0 || status?.code === 143 || status?.signal === 'SIGTERM', `Unexpected shutdown: ${JSON.stringify(status)}\n${logs()}`);
        assert.doesNotMatch(logs(), /\[brabbler\] (?:owner (?:cleanup|admission shutdown) failed|Next\.js exited unexpectedly|could not run the Next\.js process)/);
      })();
      return stopping;
    },
  };
}
async function start(root, env, args = []) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(root, 'bin/brabbler.js'), '--port', String(port), '--no-open', ...args],
    { env, cwd: env.HOME, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '', spawnError;
  child.stdout.on('data', b => { logs = (logs + b).slice(-256 * 1024); });
  child.stderr.on('data', b => { logs = (logs + b).slice(-256 * 1024); });
  child.once('error', error => { spawnError = error; });
  const owner = ownLauncher(child, () => logs), stop = () => owner.stop();
  try {
    const until = Date.now() + 45_000;
    while (Date.now() < until) {
      if (spawnError) throw spawnError;
      assert.equal(owner.snapshot().closed, false, `launcher exited before readiness\n${logs}`);
      try {
        const response = await fetch(base + '/api/web-auth', { signal: AbortSignal.timeout(1000) });
        const status = response.status; await response.text();
        if ([200, 503].includes(status)) return { base, stop, logs: () => logs, termination: owner.snapshot };
      } catch { /* Only startup connection/readiness errors are polled. */ }
      await delay(100);
    }
    throw new Error(`Launcher readiness deadline\n${logs}`);
  } catch (error) { return preserveFailure(() => { throw error; }, stop); }
}
async function request(server, path, { cookie, body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  const response = await fetch(server.base + path, {
    method, headers: { Origin: server.base, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
}
async function login(server, password) {
  const response = await request(server, '/api/web-auth', { body: { password } });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  return cookie;
}
async function terminal(server, cookie, cwd) {
  const response = await request(server, '/api/terminal', { cookie, body: { cwd, cols: 80, rows: 24 } });
  assert.equal(response.status, 200, response.text);
  const { id } = JSON.parse(response.text), controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 10_000);
  let reader;
  await preserveFailure(async () => {
    const stream = await fetch(`${server.base}/api/terminal/${id}/events`, { headers: { Cookie: cookie }, signal: controller.signal });
    assert.equal(stream.status, 200); reader = stream.body.getReader();
    assert.equal((await request(server, `/api/terminal/${id}`, { cookie, body: { type: 'input', data: "printf 'BRABBLER_SMOKE_%s\\n' 'TERMINAL_OK'\r" } })).status, 200);
    let output = '';
    for (;;) {
      const chunk = await reader.read(); assert.equal(chunk.done, false, 'PTY exited before proof');
      output += new TextDecoder().decode(chunk.value); assert.ok(output.length < 128 * 1024);
      if (output.includes('BRABBLER_SMOKE_TERMINAL_OK')) break;
    }
  }, async () => {
    clearTimeout(deadline); controller.abort();
    await preserveFailure(async () => {
      try { await reader?.cancel(); } catch (error) { if (error.name !== 'AbortError') throw error; }
    }, async () => {
      assert.equal((await request(server, `/api/terminal/${id}`, { cookie, method: 'DELETE' })).status, 200);
    });
  });
}
export async function main(args) {
  assert.equal(args.length, 3, 'Usage: node nix/portable-smoke.mjs /absolute/brabbler.tgz SHA256 /absolute/third-party-sources.tar.gz');
  assert.ok(['linux', 'darwin'].includes(process.platform), 'Linux/macOS smoke only');
  const archive = resolve(args[0]); verifyArchive(archive, args[1]);
  process.umask(0o077);
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'brabbler-portable-'))), env = smokeEnvironment(work);
  writeFileSync(env.npm_config_userconfig, ''); writeFileSync(env.npm_config_globalconfig, '');
  const report = { version: 1, archiveSha256: args[1], node: process.version, os: process.platform, arch: process.arch,
    startedAt: new Date().toISOString(), checks: [], status: 'running' };
  const save = () => writeFileSync(join(work, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Portable smoke evidence: ${work}`); save();
  let server, primaryFailure;
  try {
    const app = join(work, 'application'); mkdirSync(app);
    await command('tar', ['-xzf', archive, '-C', app, '--strip-components=1'], env, work);
    for (const entry of ['.next/trace', '.next/trace-build', '.next/diagnostics', '.next/cache', '.next/dev']) assert.equal(existsSync(join(app, entry)), false, `No build-only artifact: ${entry}`);
    const sourceInfo = JSON.parse(readFileSync(join(app, 'public/third-party/SOURCE-AVAILABILITY.json'), 'utf8'));
    const sourceArchive = resolve(args[2]);
    verifyArchive(sourceArchive, sourceInfo.sha256, '.tar.gz');
    const sourceManifest = JSON.parse(await command('tar', ['-xOf', sourceArchive, 'elkjs-0.9.3-source-materials/MANIFEST.json'], env, work));
    assert.equal(sourceManifest.elkjs_gitHead, 'a8304cf79fde75bc2ab1a89d28320f53f8637436');
    assert.equal(sourceManifest.patch_series.length, 7);
    assert.ok(sourceManifest.source_trees.elk.files > 0);
    const dependencyNotices = JSON.parse(readFileSync(join(app, 'public/third-party/DEPENDENCIES.json'), 'utf8'));
    assert.ok(dependencyNotices.components.length > 0);
    for (const component of dependencyNotices.components) for (const notice of component.notices) {
      assert.equal(createHash('sha256').update(readFileSync(join(app, 'public/third-party', notice.file))).digest('hex'), notice.sha256);
    }
    report.source = sourceInfo;
    report.checks.push('matching-source-archive-and-preserved-dependency-notices');
    // Run as the application root, not an npm dependency: only the root's
    // overrides are honored by npm. Never install over another app's modules.
    await command('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], env, app);
    const cli = join(app, 'bin/brabbler.js');
    const require = createRequire(join(app, 'package.json'));
    const sdkPolicy = require('./bin/sdk-runtime-policy.js'); sdkPolicy.checkSdkRuntimePolicy();
    require('./bin/patch-sdk-command-env.js').checkSdkCommandEnvironment();
    assert.equal(require('./package.json').version, '0.1.0');
    assert.equal(sourceInfo.applicationVersion, require('./package.json').version);
    verifySourceVersion(join(app, 'node_modules'), sourceInfo);
    report.checks.push('production-install-sdk-policy');
    server = await start(app, env);
    assert.equal((await request(server, '/api/sessions')).status, 503);
    await setupInstalledAuth(app, env, 'synthetic portable passphrase', { command: process.execPath, prefixArgs: [cli] });
    assert.equal(statSync(join(env.PI_CODING_AGENT_DIR, 'brabbler/auth/credentials.json')).mode & 0o777, 0o600);
    const cookie = await login(server, 'synthetic portable passphrase');
    assert.equal((await request(server, '/api/sessions', { cookie })).status, 200);
    const noticePage = await request(server, '/third-party/NOTICE.md', { cookie });
    assert.equal(noticePage.status, 200); assert.match(noticePage.text, /Corresponding ELK sources/);
    const servedSource = await request(server, '/third-party/SOURCE-AVAILABILITY.json', { cookie });
    assert.equal(servedSource.status, 200); assert.deepEqual(JSON.parse(servedSource.text), sourceInfo);
    assert.match((await request(server, '/', { cookie })).text, /rel="license"/);
    report.checks.push('http-notice-discovery-and-versioned-source-locator');
    const workspace = await request(server, '/api/default-cwd', { cookie, body: {} });
    assert.equal(workspace.status, 200, workspace.text);
    const { cwd } = JSON.parse(workspace.text);
    assert.ok(cwd.startsWith(work + '/'), 'workspace stays inside the synthetic HOME');
    await terminal(server, cookie, cwd); report.checks.push('default-lock-hidden-setup-login-http-pty');
    assert.equal((await request(server, '/api/sessions', { cookie, headers: { 'x-prerender-revalidate': 'synthetic' } })).status, 400);
    await server.stop(); server = await start(app, env);
    assert.equal((await request(server, '/api/sessions', { cookie })).status, 200);
    await setupInstalledAuth(app, env, 'synthetic replacement passphrase', { command: process.execPath, prefixArgs: [cli], replace: true });
    assert.equal((await request(server, '/api/sessions', { cookie })).status, 401);
    const nextCookie = await login(server, 'synthetic replacement passphrase');
    report.checks.push('restart-persistence-rotation-revocation-header-guard');
    await server.stop(); server = await start(app, env, ['--no-auth']);
    assert.equal((await request(server, '/api/sessions')).status, 200);
    assert.equal((await request(server, '/api/ssh-agent', { cookie: nextCookie, body: { action: 'status' } })).status, 403);
    assert.match(server.logs(), /authentication is DISABLED/);
    assert.equal((await request(server, '/api/terminal', { body: {}, headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    report.checks.push('explicit-no-auth-warning-retained-origin-and-ssh-boundaries');
    report.status = 'passed';
  } catch (error) {
    primaryFailure = error;
    report.status = 'failed'; report.error = String(error.stack ?? error); throw error;
  } finally {
    try { await server?.stop(); } catch (error) {
      report.status = 'failed'; report.shutdownError = String(error);
      if (primaryFailure && primaryFailure !== error) throw new AggregateError([primaryFailure, error], 'Smoke and launcher shutdown both failed');
      throw error;
    } finally {
      if (server) { report.launcher = server.termination(); report.launcherLog = server.logs(); }
      report.finishedAt = new Date().toISOString(); save();
    }
  }
  console.log(JSON.stringify(report));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
