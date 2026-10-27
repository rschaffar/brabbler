// Fresh, bounded admission of whole-group Nix sandboxes. Never launch the app on the host.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { groups } from '../e2e/scenarios.mjs';
import { privateEnvironment, validateArgs } from './test.mjs';
import { workerBudget } from './vm-plan.mjs';
import { browserPlan, validateBrowserMetadata, validateNamespaces, requireBrowserPass } from './browser-plan.mjs';
import { assertEvidenceTree } from './vm-evidence.mjs';
import { runOwned } from './test-lifecycle.mjs';

export async function dispatchBrowserPlan(plan, execute, { signal, changed = () => {} } = {}) {
  let closed = false, persistenceError;
  const results = plan.jobs.map(job => ({ name: job.name, lane: job.lane, status: 'not-run' }));
  await Promise.allSettled(plan.lanes.map(async lane => {
    let result;
    try {
      for (const name of lane.groups) {
        if (closed || signal?.aborted) break;
        const job = plan.jobs.find(item => item.name === name);
        result = results[job.index];
        result.status = 'running'; changed(results);
        try { Object.assign(result, await execute(job)); result.status = 'passed'; }
        catch (error) { result.status = 'failed'; result.error = error.message; closed = true; }
        changed(results);
      }
    } catch (error) {
      closed = true; persistenceError ??= error;
      if (result?.status === 'running') { result.status = 'failed'; result.error = error.message; }
    }
  }));
  if (persistenceError) throw persistenceError;
  return results;
}

// Private definition wire format. Paths are dispatch identities, never verdicts.
export const BROWSER_DEFINITION_MAX_BYTES = 128 * 1024;
const storePath = /^\/nix\/store\/[0123456789abcdfghijklmnpqrsvwxyz]{32}-[A-Za-z0-9+._?=-]{1,211}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function exactKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Definition object required');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Exact definition keys required');
}
function definitionPath(value, drv = false) {
  assert.equal(typeof value, 'string');
  assert.match(value, storePath, 'Absolute canonical store path required');
  assert.equal(value.endsWith('.drv'), drv, 'Wrong definition/output path kind');
}
function definitionBindings(expected) {
  definitionPath(expected.source); definitionPath(expected.supportOutPath);
  assert.ok(['x86_64-linux', 'aarch64-linux'].includes(expected.system));
  assert.match(expected.runId, uuid, 'Fresh nonempty UUID required');
  assert.equal(typeof expected.sourceDigest, 'string');
  assert.ok(expected.sourceDigest === '' || /^[a-f0-9]{64}$/.test(expected.sourceDigest));
  validateNamespaces(expected.hostNamespaces);
  assert.ok(Array.isArray(expected.selected) && expected.selected.length > 0);
  assert.equal(new Set(expected.selected).size, expected.selected.length, 'Duplicate selected group');
  for (const group of expected.selected) assert.ok(typeof group === 'string' && Object.hasOwn(groups, group), 'Unknown selected group');
}
function definitionEntry(entry, group) {
  exactKeys(entry, ['drvPath', 'expectedOutputPath', 'outputName']);
  definitionPath(entry.drvPath, true); definitionPath(entry.expectedOutputPath);
  assert.equal(entry.outputName, 'out');
  if (group !== undefined) {
    // Bind the known group to the unchanged factory's names, not just a set of paths.
    const name = `-brabbler-browser-${group}-diagnostics`;
    assert.ok(entry.drvPath.endsWith(`${name}.drv`) && entry.expectedOutputPath.endsWith(name), 'Definition group/path differs');
  }
}

export function validateBrowserDefinitions(manifest, expected) {
  definitionBindings(expected);
  exactKeys(manifest, ['version', 'kind', 'backend', 'executionEvidence', 'source', 'system', 'runId',
    'sourceDigest', 'hostNamespaces', 'supportOutPath', 'selected', 'definitions']);
  assert.equal(manifest.version, 1); assert.equal(manifest.kind, 'fresh-capsule-definitions');
  assert.equal(manifest.backend, 'nix-build-sandbox'); assert.equal(manifest.executionEvidence, false);
  for (const key of ['source', 'system', 'runId', 'sourceDigest', 'hostNamespaces', 'supportOutPath', 'selected']) {
    assert.deepEqual(manifest[key], expected[key], `Definition binding differs: ${key}`);
  }
  exactKeys(manifest.definitions, expected.selected);
  const paths = new Set([expected.source, expected.supportOutPath]);
  for (const group of expected.selected) {
    const entry = manifest.definitions[group]; definitionEntry(entry, group);
    for (const value of [entry.drvPath, entry.expectedOutputPath]) {
      assert.ok(!paths.has(value), 'Duplicate or aliased definition path'); paths.add(value);
    }
    Object.freeze(entry);
  }
  Object.freeze(manifest.selected); Object.freeze(manifest.hostNamespaces); Object.freeze(manifest.definitions);
  return Object.freeze(manifest);
}

// Separate file reader permits ordinary-file negative tests without a daemon/store.
// Production calls it ONLY beneath the physically resolved immutable manifest output.
export function readBrowserDefinitionFile(file, expected) {
  assert.equal(fs.realpathSync(file), path.resolve(file), 'Physical manifest file required');
  const before = fs.lstatSync(file);
  const safe = st => st.isFile() && !(st.mode & 0o222) && st.size > 0 && st.size <= BROWSER_DEFINITION_MAX_BYTES;
  assert.ok(safe(before), 'Bounded regular immutable manifest file required');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    assert.ok(safe(opened) && opened.dev === before.dev && opened.ino === before.ino, 'Manifest file replaced');
    const buffer = Buffer.alloc(BROWSER_DEFINITION_MAX_BYTES + 1);
    let length = 0, count;
    while ((count = fs.readSync(fd, buffer, length, buffer.length - length, length)) > 0) {
      length += count;
      assert.ok(length <= BROWSER_DEFINITION_MAX_BYTES, 'Oversized definition manifest');
    }
    const after = fs.fstatSync(fd), current = fs.lstatSync(file);
    assert.ok(safe(after) && safe(current) && length === opened.size &&
      after.dev === opened.dev && after.ino === opened.ino && after.size === opened.size &&
      after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs &&
      current.dev === opened.dev && current.ino === opened.ino &&
      current.size === opened.size && current.mtimeMs === opened.mtimeMs && current.ctimeMs === opened.ctimeMs,
    'Manifest file changed while reading');
    const bytes = buffer.subarray(0, length), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    // Nix toJSON emits compact ASCII for this restricted schema. Requiring that
    // wire form also refuses duplicate JSON keys (JSON.parse alone hides them).
    assert.equal(JSON.stringify(value), text, 'Noncanonical or duplicate-key definition JSON');
    return { manifest: validateBrowserDefinitions(value, expected), file,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { fs.closeSync(fd); }
}

export function readBrowserDefinitions(outLink, expected) {
  const link = fs.lstatSync(outLink);
  assert.ok(link.isSymbolicLink() && link.uid === process.getuid(), 'Owned manifest out-link required');
  const target = fs.readlinkSync(outLink); definitionPath(target);
  const output = fs.realpathSync(outLink); assert.equal(output, target, 'Direct physical manifest output required');
  const st = fs.lstatSync(output);
  assert.ok(st.isDirectory() && !(st.mode & 0o222), 'Physical immutable manifest output required');
  const receipt = readBrowserDefinitionFile(path.join(output, 'manifest.json'), expected);
  const after = fs.lstatSync(outLink), directory = fs.lstatSync(output);
  assert.ok(after.isSymbolicLink() && after.dev === link.dev && after.ino === link.ino &&
    fs.readlinkSync(outLink) === target && directory.isDirectory() && !(directory.mode & 0o222) &&
    directory.dev === st.dev && directory.ino === st.ino, 'Manifest root replaced while reading');
  return { ...receipt, output };
}

export function requireBrowserOutput(output, definition) {
  definitionEntry(definition); definitionPath(output);
  assert.equal(output, definition.expectedOutputPath, 'Physical capsule output differs from selected definition');
  return output;
}

// Same owned Nix flags in every phase; direct clients never evaluate an expression.
export function browserBuildArgs({ source, system, offline = false, preparationBudget }, { mode, outLink, bindings, definition }) {
  definitionPath(source); assert.ok(['x86_64-linux', 'aarch64-linux'].includes(system));
  assert.ok(typeof outLink === 'string' && path.isAbsolute(outLink) && !outLink.includes('\0'));
  const common = ['build', '--extra-experimental-features', 'nix-command flakes', '--store', 'daemon', '--no-write-lock-file',
    '--option', 'accept-flake-config', 'false', '--option', 'sandbox', 'true', '--impure', '--keep-failed', '-L',
    ...(offline ? ['--offline'] : [])];
  if (mode === 'capsule') {
    definitionEntry(definition);
    return [...common, '--max-jobs', '1', '--cores', '2', '--out-link', outLink, `${definition.drvPath}^out`];
  }
  assert.ok(mode === 'support' || mode === 'definitions', 'Unknown browser build phase');
  for (const key of ['maxJobs', 'coresPerBuild']) assert.ok(Number.isInteger(preparationBudget?.[key]) && preparationBudget[key] > 0);
  const expression = [...common, '--file', path.join(source, 'nix/fresh-browser.nix'), '--argstr', 'system', system,
    '--max-jobs', String(preparationBudget.maxJobs), '--cores', String(preparationBudget.coresPerBuild), '--out-link', outLink];
  if (mode === 'support') return expression;
  definitionBindings(bindings);
  assert.equal(bindings.source, source); assert.equal(bindings.system, system);
  return [...expression, '--argstr', 'definitionGroups', JSON.stringify(bindings.selected),
    '--argstr', 'runId', bindings.runId, '--argstr', 'sourceDigest', bindings.sourceDigest,
    '--argstr', 'hostNamespaces', JSON.stringify(bindings.hostNamespaces)];
}

export function requireBrowserClient(execution, message) {
  if (execution?.code !== 0 || !execution.settled || execution.interrupted) throw new Error(message);
  return execution;
}

async function browserPhase(receipt, operation) {
  receipt.startedAt = new Date().toISOString();
  const start = process.hrtime.bigint();
  try { return await operation(); }
  catch (error) { receipt.error = error.message; throw error; }
  finally {
    receipt.finishedAt = new Date().toISOString();
    receipt.elapsedSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  }
}

// Actual production phase boundary, with only phase capabilities injectable for tests.
// Each phase is awaited before persistence/admission; the dispatcher joins lane peers.
export async function coordinateBrowserRun(report, { signal, save, prepare, define, execute }) {
  const admit = () => { if (signal?.aborted) throw new Error('Browser interrupted before admission'); };
  admit(); save(); admit();
  report.plan = await prepare(); admit(); save(); admit();
  const definitions = await define(report.plan); admit();
  report.definitions = definitions; save(); admit();
  report.groups = await dispatchBrowserPlan(report.plan, job => execute(job, definitions.definitions[job.name]), {
    signal, changed: rows => { report.groups = rows; save(); },
  });
  report.status = !signal?.aborted && report.groups.every(row => row.status === 'passed') ? 'passed' : 'failed';
}

export function browserPreparationBudget(budget) {
  const GiB = 1024 ** 3;
  const maxJobs = Math.max(1, Math.min(2, budget.workers, Math.floor(budget.resources.cpus / 4),
    Math.floor((budget.resources.memory - 2 * GiB) / (4 * GiB))));
  const coresPerBuild = Math.max(1, Math.min(4, Math.floor(budget.resources.cpus / maxJobs)));
  return { maxJobs, coresPerBuild, peakCpus: maxJobs * coresPerBuild, memoryBytes: maxJobs * 4 * GiB,
    scope: 'Preparation admission estimate; capped by effective resources, not a reservation' };
}

export async function runBrowser(source, system, args) {
  const parsed = validateArgs(['e2e', ...args]);
  if (parsed.help) throw new Error('Use nix run .#test -- --help');
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(source ?? '') || !['x86_64-linux', 'aarch64-linux'].includes(system)) {
    throw new Error('Pinned Nix source and native Linux system required');
  }
  const option = name => parsed.options.includes(name) ? parsed.options[parsed.options.indexOf(name) + 1] : undefined;
  const group = option('--group') ?? 'all';
  const budget = workerBudget({ requested: option('--workers') ? Number(option('--workers')) : group === 'all' ? undefined : 1 });
  const preparationBudget = browserPreparationBudget(budget);
  const sourceDigest = process.env.BRABBLER_SOURCE_DIGEST ?? '';
  if (sourceDigest && !/^[a-f0-9]{64}$/.test(sourceDigest)) throw new Error('Invalid verified source digest');
  const hostNamespaces = Object.fromEntries(['net', 'pid', 'mnt'].map(name => [name, fs.readlinkSync(`/proc/self/ns/${name}`)]));
  const mask = process.umask(0o077);
  const root = fs.mkdtempSync('/tmp/brabbler-test-browser.');
  const env = privateEnvironment(root, process.env);
  for (const name of ['home', 'config', 'cache', 'data', 'state', 'runtime', 'agent', 'tmp', 'nix-conf', 'groups']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  const controller = new AbortController();
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => controller.abort(signal)]));
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  const report = { version: 1, backend: 'nix-build-sandbox', fresh: true, source, sourceDigest, system, group, budget,
    runId: randomUUID(), hostNamespaces, preparationBudget, root, startedAt: new Date().toISOString(),
    sourceDigestProvenance: 'Outer-entrypoint value; pinned store source is independently matched, not an ambient authorization claim',
    containmentScope: 'Nix owns builder processes; host observations cover only the Nix clients' };
  const save = () => fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const build = { source, system, offline: parsed.offline, preparationBudget };
  report.phases = { support: {}, manifest: {} };
  console.log(`Fresh browser acceptance: group=${group}, concurrent sandboxes=${budget.workers}${group === 'all' ? '' : ' (selected-only, NOT full acceptance)'}\nArtifacts: ${root}`);
  let metadata, support;
  try {
    await coordinateBrowserRun(report, {
      signal: controller.signal, save,
      prepare: () => browserPhase(report.phases.support, async () => {
        const args = browserBuildArgs(build, { mode: 'support', outLink: path.join(root, 'support') });
        report.phases.support.args = args;
        report.preparation = await runOwned('nix', args,
          { cwd: root, env, signal: controller.signal, logPath: path.join(root, 'preparation.log') });
        requireBrowserClient(report.preparation, 'Browser prerequisite realization failed; stopped without retry');
        support = fs.realpathSync(path.join(root, 'support'));
        metadata = validateBrowserMetadata(JSON.parse(fs.readFileSync(path.join(support, 'browser.json'), 'utf8')));
        if (metadata.flakeSource !== source) throw new Error('Browser support source differs from pinned input');
        return browserPlan(metadata, group, budget.workers);
      }),
      define: plan => browserPhase(report.phases.manifest, async () => {
        const bindings = { source, system, runId: report.runId, sourceDigest, hostNamespaces,
          supportOutPath: support, selected: plan.selected };
        const outLink = path.join(root, 'definitions');
        const args = browserBuildArgs(build, { mode: 'definitions', outLink, bindings });
        Object.assign(report.phases.manifest, { args, outLink,
          rootRetention: 'Manifest out-link retained; original support and selected constant drv references, no GC operations' });
        const execution = await runOwned('nix', args,
          { cwd: root, env, signal: controller.signal, logPath: path.join(root, 'definitions.log') });
        report.phases.manifest.execution = execution;
        requireBrowserClient(execution, 'Browser definition publication failed; stopped before capsule admission without retry');
        const { manifest, ...receipt } = readBrowserDefinitions(outLink, bindings);
        Object.assign(report.phases.manifest, receipt);
        return manifest;
      }),
      execute: async (job, definition) => {
        const directory = path.join(root, 'groups', job.name); fs.mkdirSync(directory, { mode: 0o700 });
        const row = report.groups.find(item => item.name === job.name);
        row.clientPhase = {}; row.validationPhase = {};
        console.log(`START sandbox=${job.lane} group=${job.name}`);
        const args = browserBuildArgs(build, { mode: 'capsule', outLink: path.join(directory, 'result'), definition });
        row.clientPhase.args = args;
        const execution = await browserPhase(row.clientPhase, async () => {
          const result = await runOwned('nix', args,
            { cwd: root, env, signal: controller.signal, graceMs: 45_000, logPath: path.join(directory, 'driver.log') });
          row.execution = result;
          requireBrowserClient(result, `${job.name}: capsule realization failed or interrupted; Nix retains builder containment`);
          return result;
        });
        return browserPhase(row.validationPhase, async () => {
          const output = requireBrowserOutput(fs.realpathSync(path.join(directory, 'result')), definition);
          assertEvidenceTree(output);
          const result = JSON.parse(fs.readFileSync(path.join(output, 'result.json'), 'utf8'));
          row.output = output; row.capsule = result;
          requireBrowserPass(result, metadata, { group: job.name, runId: report.runId, sourceDigest, hostNamespaces }, output);
          console.log(`END sandbox=${job.lane} group=${job.name} seconds=${result.elapsedSeconds.toFixed(3)}`);
          return { output, capsule: result, execution };
        });
      },
    });
  } catch (error) {
    report.status = 'failed'; report.error = error.message; console.error(error.message);
  } finally {
    report.finishedAt = new Date().toISOString(); report.interrupted = controller.signal.aborted;
    try { save(); }
    catch (error) { report.status = 'failed'; report.error ??= error.message; console.error(`Cannot retain browser report: ${error.message}`); }
    finally {
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
      process.umask(mask);
    }
    process.exitCode = report.status === 'passed' ? 0 : 1;
    console.log(`Browser ${report.status}: ${root}/run.json`);
  }
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runBrowser(process.argv[2], process.argv[3], process.argv.slice(4)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
