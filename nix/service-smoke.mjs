// A bounded HTTP/native-PTY probe of the installed service, not a browser suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { setupInstalledAuth } from './auth-setup.fixture.mjs';
let authCookie;
const authPassword = 'synthetic-vm-local-passphrase';
import { createServicePlan, serviceCgroup, serviceEnvironment, validateServiceRegistry, validateWorkspace } from './service-plan.mjs';

export const diagnosticLimits = Object.freeze({ requests: 16, bodyBytes: 8192, transcriptBytes: 32768, errorBytes: 8192 });
export function createSmokeDiagnostics() {
  return { version: 1, requests: [], requestsOmitted: 0, pty: null };
}

function capturePrefix(limit) {
  const buffer = Buffer.alloc(limit);
  let kept = 0, total = 0;
  return {
    append(value) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += bytes.length;
      const size = Math.min(bytes.length, limit - kept);
      bytes.copy(buffer, kept, 0, size); kept += size;
    },
    text: () => new StringDecoder('utf8').write(buffer.subarray(0, kept)),
    get bytes() { return total; },
    get truncated() { return total > kept; },
  };
}

function boundedText(value, limit = diagnosticLimits.errorBytes) {
  const capture = capturePrefix(limit); capture.append(String(value)); return capture.text();
}

function errorDiagnostic(error) {
  return { name: boundedText(error?.name ?? 'Error', 128), message: boundedText(error?.message ?? error),
    stack: boundedText(error?.stack ?? error), ...(error?.code === undefined ? {} : { code: boundedText(error.code, 128) }) };
}

export function writePrivateEnvironment(file, contents) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600 && stat.nlink === 1,
      'Runtime environment must be an owned private single-link physical file');
    fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, contents);
  } finally { fs.closeSync(fd); }
}

function physical(file, mode, uid) {
  const stat = fs.lstatSync(file);
  assert.equal(fs.realpathSync(file), file); assert.equal(stat.uid, uid);
  assert.equal((stat.mode & 0o777).toString(8).padStart(4, '0'), mode);
  assert.ok(mode === '0600' ? stat.isFile() && stat.nlink === 1 : stat.isDirectory());
  return { path: file, uid, mode, physical: true, ...(mode === '0600' ? { links: stat.nlink } : {}) };
}

// Failure diagnostics are a separate private file, never a success-shaped mode
// receipt. An unsafe directory or failed diagnostic write cannot replace cause.
export async function recordSmokeMode(evidence, mode, action) {
  assert.ok(['seed', 'activation', 'permissions', 'http-write', 'restart-read', 'pty'].includes(mode));
  physical(evidence, '0700', process.getuid());
  const diagnostics = createSmokeDiagnostics();
  try {
    const result = await action(diagnostics);
    fs.writeFileSync(`${evidence}/${mode}.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    try {
      physical(evidence, '0700', process.getuid());
      const report = { version: 1, mode, status: 'failed', error: errorDiagnostic(error), diagnostics };
      fs.writeFileSync(`${evidence}/${mode}-failure.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (retentionError) {
      console.error(`Failure diagnostic retention failed: ${boundedText(retentionError?.message ?? retentionError)}`);
    }
    throw error;
  }
}

function endpoint(base, pathname) {
  const origin = new URL(base), target = new URL(pathname, origin);
  assert.equal(origin.protocol, 'http:'); assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(origin.origin, base); assert.equal(origin.username, ''); assert.equal(origin.password, '');
  assert.ok(pathname.startsWith('/') && !pathname.startsWith('//')); assert.equal(target.origin, base);
  return target;
}

// Completion still waits for request closure on all paths. A rejected status or
// header drains only a bounded body prefix within the ORIGINAL absolute deadline.
// No pooled sockets, redirects, subprocesses or background client acquisitions.
function ownedRequest(base, pathname, { method = 'GET', body, timeoutMs = 5000, signal, diagnostics, expectedStatus = 200, cookie = authCookie } = {}, consume) {
  const target = endpoint(base, pathname), payload = body === undefined ? undefined : JSON.stringify(body);
  if (signal?.aborted) return Promise.reject(new Error('HTTP probe aborted'));
  const captured = capturePrefix(diagnosticLimits.bodyBytes);
  const record = { method, path: pathname, status: null, contentType: '', body: '', bodyBytes: 0,
    bodyTruncated: false, bodyComplete: false, closed: false, error: null };
  if (diagnostics) {
    if (diagnostics.requests.length < diagnosticLimits.requests) diagnostics.requests.push(record);
    else diagnostics.requestsOmitted++;
  }
  return new Promise((resolve, reject) => {
    let response, finished = false, closed = false, delivered = false, failure, value, timer, pendingFailure, ended = false;
    const deliver = () => {
      if (!finished || !closed || delivered) return;
      delivered = true;
      record.body = captured.text(); record.bodyBytes = captured.bytes;
      record.bodyComplete = ended; record.bodyTruncated = captured.truncated || !ended;
      record.closed = true; record.error = failure ? errorDiagnostic(failure) : null;
      if (failure) reject(failure); else resolve(value);
    };
    const finish = (error, result) => {
      if (finished) return;
      finished = true; failure = pendingFailure ?? error; value = result;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      response?.destroy(); request.destroy(); deliver();
    };
    const abort = () => finish(new Error('HTTP probe aborted'));
    const request = http.request(target, { method, agent: false, headers: {
      ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
      }),
    } }, incoming => {
      response = incoming; incoming.pause(); incoming.setEncoding('utf8');
      record.status = incoming.statusCode ?? null;
      record.contentType = boundedText(incoming.headers['content-type'] ?? '', 256);
      incoming.on('error', error => finish(error));
      incoming.on('data', chunk => {
        captured.append(chunk);
        if (pendingFailure && captured.bytes >= diagnosticLimits.bodyBytes) finish(pendingFailure);
      });
      incoming.once('end', () => {
        ended = true;
        if (pendingFailure) finish(pendingFailure);
      });
      try {
        assert.equal(incoming.statusCode, expectedStatus, `HTTP ${incoming.statusCode}: ${pathname}`);
        consume(incoming, finish);
      } catch (error) {
        // Preserve this exact error even if draining later times out or resets.
        pendingFailure = error;
        if (ended || captured.bytes >= diagnosticLimits.bodyBytes) finish(error);
      }
      incoming.resume();
    });
    request.on('error', error => finish(error));
    request.once('close', () => {
      closed = true;
      if (!finished) finish(new Error('HTTP probe closed before its response completed'));
      deliver();
    });
    timer = setTimeout(() => finish(new Error('HTTP probe deadline exceeded')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    request.end(payload);
  });
}

export function requestJSON(base, pathname, options = {}) {
  return ownedRequest(base, pathname, options, (response, finish) => {
    let text = '', bytes = 0;
    response.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.limitBytes ?? 1024 * 1024)) return finish(new Error('HTTP response bound exceeded'));
      text += chunk;
    });
    response.once('end', () => {
      try { finish(null, JSON.parse(text)); } catch (error) { finish(error); }
    });
  });
}

export function parsePtyProof(output, workspace, registry, terminal) {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const normalized = output.replace(ansi, '').replace(/\r/g, '');
  const block = normalized.match(/\nBRABBLER_BEGIN\n([\s\S]*?)\nBRABBLER_END(?:\n|$)/)?.[1];
  assert.ok(block, 'Missing executed PTY proof (input echo is not proof)');
  const lines = block.split('\n');
  assert.equal(lines.length, 8);
  const keys = ['TTY', 'UID', 'PID', 'CWD', 'UNIT', 'FILE', 'OVERRIDE', 'SIZE'];
  const fields = Object.fromEntries(keys.map((key, i) => {
    assert.ok(lines[i].startsWith(`BRABBLER_${key}:`)); return [key, lines[i].slice(`BRABBLER_${key}:`.length)];
  }));
  assert.match(fields.TTY, /^\/dev\/pts\/[0-9]+$/); assert.match(fields.PID, /^[1-9][0-9]*$/);
  assert.equal(fields.UID, String(registry.service.uid)); assert.equal(fields.CWD, workspace);
  const environment = serviceEnvironment(registry);
  assert.equal(fields.UNIT, environment.BRABBLER_SERVICE_UNIT); assert.equal(fields.FILE, environment.BRABBLER_SERVICE_FILE);
  assert.equal(fields.OVERRIDE, environment.BRABBLER_SERVICE_OVERRIDE); assert.equal(fields.SIZE, `${terminal.rows} ${terminal.cols}`);
  return { id: terminal.id, tty: fields.TTY, uid: Number(fields.UID), pid: fields.PID, cwd: fields.CWD,
    environment: { BRABBLER_SERVICE_UNIT: fields.UNIT, BRABBLER_SERVICE_FILE: fields.FILE, BRABBLER_SERVICE_OVERRIDE: fields.OVERRIDE },
    cols: terminal.cols, rows: terminal.rows };
}

export async function terminalOutput(base, plan, workspace, signal, diagnostics) {
  const raw = capturePrefix(diagnosticLimits.transcriptBytes), transcript = capturePrefix(diagnosticLimits.transcriptBytes);
  let pending = '', output = '', bytes = 0;
  const record = { id: plan.terminal.id, rawSse: '', rawSseTruncated: false, output: '', outputTruncated: false,
    pending: '', lastFrame: '', bytes: 0, eventTypes: [], eventTypesOmitted: 0, error: null };
  if (diagnostics) diagnostics.pty = record;
  const remember = () => {
    record.rawSse = raw.text(); record.rawSseTruncated = raw.truncated;
    record.output = transcript.text(); record.outputTruncated = transcript.truncated;
    record.pending = boundedText(pending, diagnosticLimits.transcriptBytes); record.bytes = bytes;
  };
  try {
    return await ownedRequest(base, `/api/terminal/${plan.terminal.id}/events`, { timeoutMs: 20_000, signal, diagnostics }, (response, finish) => {
      assert.match(response.headers['content-type'] ?? '', /^text\/event-stream/);
      response.on('data', chunk => {
        try {
          raw.append(chunk); bytes += Buffer.byteLength(chunk);
          assert.ok(bytes <= 256 * 1024, 'PTY stream bound exceeded'); pending += chunk;
          for (;;) {
            const end = pending.indexOf('\n\n'); if (end < 0) break;
            const frame = pending.slice(0, end); pending = pending.slice(end + 2);
            record.lastFrame = boundedText(frame);
            const data = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
            if (!data) continue;
            const event = JSON.parse(data);
            if (record.eventTypes.length < 16) record.eventTypes.push(boundedText(event.type, 64));
            else record.eventTypesOmitted++;
            assert.equal(event.type, 'output', 'PTY exited/closed before live proof'); assert.equal(typeof event.data, 'string');
            transcript.append(event.data); output += event.data;
            if (output.replace(/\r/g, '').includes('\nBRABBLER_END\n')) {
              return finish(null, parsePtyProof(output, workspace, plan.registry, plan.terminal));
            }
          }
        } catch (error) { finish(error); }
      });
      response.once('end', () => finish(new Error('PTY stream ended before proof')));
    });
  } catch (error) {
    record.error = errorDiagnostic(error); throw error;
  } finally { remember(); }
}

async function sessionSnapshot(base, plan, diagnostics) {
  const list = await requestJSON(base, '/api/sessions?force=1', { diagnostics });
  const ids = list.sessions.map(session => session.id); assert.deepEqual(ids, [plan.session.id]);
  const detail = await requestJSON(base, `/api/sessions/${plan.session.id}?force=1`, { diagnostics });
  assert.equal(detail.sessionId, plan.session.id); assert.equal(detail.info?.name, plan.session.name);
  assert.equal(detail.filePath, plan.session.file);
  return { ids, id: detail.sessionId, name: detail.info.name, file: detail.filePath };
}

function seed(plan) {
  const service = plan.registry.service;
  const extensions = path.join(service.agentDir, 'extensions');
  fs.mkdirSync(extensions, { recursive: true, mode: 0o700 });
  // Only synthetic guest credentials: cold restoration requires configured auth
  // even though the faux provider never opens a network connection.
  fs.writeFileSync(path.join(service.agentDir, 'auth.json'), JSON.stringify({ 'vm-pause': { type: 'api_key', key: 'synthetic-unused' } }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(service.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'vm-pause', defaultModel: 'faux-1', enabledModels: ['vm-pause/**'] }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(extensions, 'vm-pause.js'), `import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(path.join(plan.registry.package, 'node_modules/@earendil-works/pi-ai/dist/providers/faux.js'))};
export default pi => {
  const faux = fauxProvider({ provider: 'vm-pause', api: 'vm-pause' });
  pi.registerProvider(faux.provider);
  pi.on('before_agent_start', (event, ctx) => {
    if (ctx.model?.provider !== 'vm-pause') return;
    faux.setResponses(event.prompt.startsWith('[Brabbler resume ')
      ? [fauxAssistantMessage('VM pause resumed')]
      : [fauxAssistantMessage([fauxToolCall('ask_user', { question: 'VM restart question', options: [{ title: 'Keep working' }], allowFreeform: true })], { stopReason: 'toolUse' }), fauxAssistantMessage('Must not run before Resume')]);
  });
};\n`, { flag: 'wx', mode: 0o600 });
  fs.mkdirSync(path.dirname(plan.session.file), { recursive: true, mode: 0o700 });
  writePrivateEnvironment(service.envFile, 'BRABBLER_SERVICE_FILE="runtime file $literal"\nBRABBLER_SERVICE_OVERRIDE=runtime-file-wins\n');
  const timestamp = '2026-10-15T00:00:00.000Z';
  const entries = [
    { type: 'session', version: 3, id: plan.session.id, timestamp, cwd: service.home },
    { type: 'model_change', id: 'model1', parentId: null, timestamp, provider: 'vm-pause', modelId: 'faux-1' },
    { type: 'message', id: 'm1', parentId: 'model1', timestamp,
      message: { role: 'user', content: [{ type: 'text', text: 'Private VM deployment fixture' }] } },
  ];
  fs.writeFileSync(plan.session.file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  return { seeded: true };
}

function activation(plan) {
  const unit = `${plan.registry.service.home}/.config/systemd/user/brabbler.service`;
  const link = `${path.dirname(unit)}/default.target.wants/brabbler.service`;
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'Home Manager must create the default.target link');
  const target = fs.realpathSync(link); assert.equal(target, fs.realpathSync(unit));
  assert.match(target, /^\/nix\/store\/[a-z0-9]{32}-[^/]+(?:\/[^/]+)*$/);
  const contents = fs.readFileSync(target, 'utf8');
  assert.ok(contents.includes(plan.registry.launcher)); assert.ok(contents.includes('WantedBy=default.target'));
  return { link, target, launcher: plan.registry.launcher };
}

function permissions(plan, pid) {
  assert.match(pid ?? '', /^[1-9][0-9]*$/);
  const registry = plan.registry, service = registry.service, proc = `/proc/${pid}`;
  const status = fs.readFileSync(`${proc}/status`, 'utf8');
  assert.deepEqual(status.match(/^Uid:\s+(.+)$/m)?.[1].trim().split(/\s+/), Array(4).fill(String(service.uid)));
  const umask = status.match(/^Umask:\s+([0-7]+)$/m)?.[1]; assert.equal(umask, '0077');
  const all = Object.fromEntries(fs.readFileSync(`${proc}/environ`, 'utf8').split('\0').filter(Boolean).map(entry => {
    const equal = entry.indexOf('='); return [entry.slice(0, equal), entry.slice(equal + 1)];
  }));
  const expected = serviceEnvironment(registry), environment = Object.fromEntries(Object.keys(expected).map(key => [key, all[key]]));
  assert.deepEqual(environment, expected); // Only synthetic/allowlisted values enter evidence.
  const cwd = fs.realpathSync(`${proc}/cwd`); assert.equal(cwd, service.home);
  const launcherScript = `${registry.package}/bin/brabbler.js`;
  assert.ok(fs.readFileSync(`${proc}/cmdline`, 'utf8').split('\0').includes(launcherScript));
  const paths = Object.fromEntries([
    ['home', service.home, '0700'], ['fixture', service.fixture, '0700'], ['agent', service.agentDir, '0700'],
    ['evidence', service.evidence, '0700'], ['environment', service.envFile, '0600'], ['session', plan.session.file, '0600'],
  ].map(([name, file, mode]) => [name, physical(file, mode, service.uid)]));
  return { uid: service.uid, umask, cwd, launcherScript, environment, paths };
}

async function productionPty(base, plan, group, diagnostics) {
  serviceCgroup(group);
  const file = `${plan.registry.service.evidence}/http-write.json`;
  physical(file, '0600', plan.registry.service.uid);
  const workspace = validateWorkspace(JSON.parse(fs.readFileSync(file, 'utf8')).workspace, plan.registry).path;
  const created = await requestJSON(base, '/api/terminal', { method: 'POST', body: { ...plan.terminal, cwd: workspace }, diagnostics });
  assert.equal(created.id, plan.terminal.id);
  // Split markers so the terminal's echo of this command cannot satisfy proof.
  const input = [
    String.raw`printf '\n%s%s\n' BRABBLER_ BEGIN`,
    String.raw`if test -t 0 && test -t 1; then printf '%s%s:%s\n' BRABBLER_ TTY "$(tty)"; fi`,
    String.raw`printf '%s%s:%s\n' BRABBLER_ UID "$(id -u)"`,
    String.raw`printf '%s%s:%s\n' BRABBLER_ PID "$$"`,
    String.raw`printf '%s%s:%s\n' BRABBLER_ CWD "$PWD"`,
    String.raw`printf '%s%s:%s\n' BRABBLER_ UNIT "$BRABBLER_SERVICE_UNIT"`,
    String.raw`printf '%s%s:%s\n' BRABBLER_ FILE "$BRABBLER_SERVICE_FILE"`,
    String.raw`printf '%s%s:%s\n' BRABBLER_ OVERRIDE "$BRABBLER_SERVICE_OVERRIDE"`,
    String.raw`printf '%s%s:%s\n' BRABBLER_ SIZE "$(stty size)"`,
    String.raw`printf '%s%s\n' BRABBLER_ END`,
  ].join('; ') + '\n';
  const controller = new AbortController();
  const output = terminalOutput(base, plan, workspace, controller.signal, diagnostics);
  const submission = requestJSON(base, `/api/terminal/${plan.terminal.id}`, {
    method: 'POST', body: { type: 'input', data: input }, signal: controller.signal, diagnostics,
  });
  let proof;
  try {
    const [observed, accepted] = await Promise.all([output, submission]); assert.equal(accepted.success, true); proof = observed;
  } finally {
    controller.abort(); await Promise.allSettled([output, submission]);
  }
  const proc = `/proc/${proof.pid}`, status = fs.readFileSync(`${proc}/status`, 'utf8');
  assert.match(status, /^State:\s+[RSID]\b/m, 'PTY shell must still be alive at final-stop handoff');
  assert.deepEqual(status.match(/^Uid:\s+(.+)$/m)?.[1].trim().split(/\s+/), Array(4).fill(String(plan.registry.service.uid)));
  assert.equal(fs.realpathSync(`${proc}/cwd`), workspace);
  assert.equal(fs.readFileSync(`${proc}/cgroup`, 'utf8').trim(), `0::${group}`);
  return { ...proof, controlGroup: group, alive: true, leftRunning: true };
}

function guestPlan(file) {
  assert.equal(fs.readFileSync('/etc/brabbler-acceptance-guest', 'utf8').trim(), 'brabbler-nixos-acceptance-v1');
  const real = fs.realpathSync(file), stat = fs.statSync(real);
  assert.match(real, /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/);
  assert.ok(stat.isFile() && stat.uid === 0 && !(stat.mode & 0o222), 'Immutable root-owned service registry required');
  const registry = validateServiceRegistry(JSON.parse(fs.readFileSync(real, 'utf8')));
  assert.equal(process.getuid(), registry.service.uid, 'Disposable service user required');
  return createServicePlan(registry);
}

async function pauseObservation(base, plan, diagnostics, predicate) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const snapshot = await requestJSON(base, '/api/agent/running', { diagnostics, timeoutMs: Math.max(1, Math.min(5000, deadline - Date.now())) });
    if (predicate(snapshot)) return snapshot;
    assert.ok(Date.now() < deadline, 'VM pause observation deadline exceeded');
    await new Promise(done => setTimeout(done, 50));
  }
}

async function pauseBeforeRestart(base, plan, diagnostics) {
  assert.equal((await requestJSON(base, `/api/agent/${plan.session.id}`, { method: 'POST', body: { type: 'prompt', message: 'Prepare VM restart' }, diagnostics })).success, true);
  await pauseObservation(base, plan, diagnostics, snapshot => snapshot.attention.some(row => row.sessionId === plan.session.id && row.summary === 'VM restart question'));
  assert.deepEqual((await requestJSON(base, '/api/activity/pause', { method: 'POST', body: { action: 'pause', sessionId: plan.session.id }, diagnostics })).errors, []);
  const snapshot = await pauseObservation(base, plan, diagnostics, value => value.pauses.some(row => row.sessionId === plan.session.id && row.state === 'paused') && !value.runningSessionIds.includes(plan.session.id));
  assert.equal(snapshot.attention.some(row => row.sessionId === plan.session.id), false);
  const file = path.join(plan.registry.service.agentDir, 'brabbler', 'session-pauses.json');
  physical(file, '0600', plan.registry.service.uid);
  const pause = JSON.parse(fs.readFileSync(file, 'utf8')).sessions.find(row => row.sessionId === plan.session.id);
  assert.ok(pause.waiting.some(value => value.includes('VM restart question')));
  assert.equal(fs.readFileSync(plan.session.file, 'utf8').includes('VM pause resumed'), false);
}

async function resumeAfterRestart(base, plan, diagnostics) {
  const snapshot = await requestJSON(base, '/api/agent/running', { diagnostics });
  const pause = snapshot.pauses.find(row => row.sessionId === plan.session.id);
  assert.equal(pause?.state, 'paused'); assert.equal(pause.interrupted, undefined);
  assert.equal(snapshot.runningSessionIds.includes(plan.session.id), false);
  assert.equal(snapshot.attention.some(row => row.sessionId === plan.session.id), false);
  assert.equal(fs.readFileSync(plan.session.file, 'utf8').includes('[Brabbler resume '), false, 'restart must not auto-continue');
  assert.deepEqual((await requestJSON(base, '/api/activity/pause', { method: 'POST', body: { action: 'resume', sessionId: plan.session.id, pauseId: pause.id }, diagnostics })).errors, []);
  await pauseObservation(base, plan, diagnostics, value => !value.runningSessionIds.includes(plan.session.id) && !value.pauses.some(row => row.sessionId === plan.session.id));
  const detail = await requestJSON(base, `/api/sessions/${plan.session.id}`, { diagnostics });
  assert.ok(JSON.stringify(detail).includes('VM pause resumed'));
  const entries = fs.readFileSync(plan.session.file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const resumes = entries.filter(entry => entry.type === 'message' && entry.message.role === 'user' && JSON.stringify(entry.message.content).includes('[Brabbler resume '));
  assert.equal(resumes.length, 1); assert.ok(JSON.stringify(resumes[0]).includes('VM restart question'));
}

async function loginAuth(base) {
  return ownedRequest(base, '/api/web-auth', { method: 'POST', body: { password: authPassword }, cookie: '' }, (response, finish) => {
    response.once('end', () => {
      const cookie = response.headers['set-cookie']?.[0]?.split(';')[0];
      if (!cookie?.startsWith('brabbler_session=')) return finish(new Error('Missing signed authentication cookie'));
      finish(null, cookie);
    });
  });
}
async function configureAuth(base, plan) {
  for (const path of ['/api/sessions', '/api/web-auth', '/api/ssh-agent']) {
    await ownedRequest(base, path, { expectedStatus: 503 }, (response, finish) => {
      assert.equal(response.headers['cache-control'], 'no-store');
      response.once('end', () => finish(null, true));
    });
  }
  const env = { ...process.env, HOME: plan.registry.service.home, PI_CODING_AGENT_DIR: plan.registry.service.agentDir };
  const cli = await setupInstalledAuth(plan.registry.package, env, authPassword);
  assert.equal(cli.hidden, true); assert.equal(cli.confirmed, true);
  authCookie = await loginAuth(base);
  // Private synthetic cookie bridges the REAL user-unit restart, not a re-created token.
  fs.writeFileSync(path.join(plan.registry.service.fixture, 'web-cookie'), authCookie, { flag: 'wx', mode: 0o600 });
}
async function main() {
  const [mode, file, extra] = process.argv.slice(2), plan = guestPlan(file);
  process.umask(0o077);
  const base = `http://127.0.0.1:${plan.registry.service.port}`;
  const result = await recordSmokeMode(plan.registry.service.evidence, mode, async diagnostics => {
    if (mode === 'seed') return seed(plan);
    if (mode === 'activation') return activation(plan);
    if (mode === 'permissions') return permissions(plan, extra);
    if (mode === 'restart-read' || mode === 'pty') {
      const file = path.join(plan.registry.service.fixture, 'web-cookie');
      physical(file, '0600', plan.registry.service.uid); authCookie = fs.readFileSync(file, 'utf8');
    }
    if (mode === 'restart-read') {
      const session = await sessionSnapshot(base, plan, diagnostics);
      // Stored key and verifier survive a new genuine systemd InvocationID.
      assert.ok(await loginAuth(base));
      await resumeAfterRestart(base, plan, diagnostics);
      return session;
    }
    if (mode === 'http-write') {
      await configureAuth(base, plan);
      const initial = await requestJSON(base, '/api/sessions', { diagnostics });
      assert.deepEqual(initial.sessions.map(session => session.id), [plan.session.id]);
      assert.equal((await requestJSON(base, `/api/sessions/${plan.session.id}`, {
        method: 'PATCH', body: { name: plan.session.name }, diagnostics,
      })).ok, true);
      const created = await requestJSON(base, '/api/default-cwd', { method: 'POST', diagnostics });
      const workspace = physical(created.cwd, '0700', plan.registry.service.uid);
      validateWorkspace(workspace, plan.registry);
      await pauseBeforeRestart(base, plan, diagnostics);
      return { session: await sessionSnapshot(base, plan, diagnostics), workspace };
    }
    return productionPty(base, plan, extra, diagnostics);
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
