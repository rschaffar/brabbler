// One complete browser/terminal group in one ordinary Nix build sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { groups } from '../e2e/scenarios.mjs';
import { assertEvidenceTree, assertPortClosed } from './vm-evidence.mjs';
import { runOwned, directoryIdentity } from './test-lifecycle.mjs';
import { validateBrowserMetadata, validateBrowserResult, validateNamespaces } from './browser-plan.mjs';

export function sandboxEnvironment(readNamespace = name => fs.readlinkSync(`/proc/self/ns/${name}`), interfaces = os.networkInterfaces()) {
  const names = Object.keys(interfaces).sort();
  assert.deepEqual(names, ['lo'], 'Browser acceptance requires an isolated loopback-only Nix sandbox');
  const uid = process.getuid();
  assert.ok(uid > 0, 'Browser acceptance must not run as namespace/host root');
  return { uid, interfaces: names, namespaces: Object.fromEntries(['net', 'pid', 'mnt'].map(name => [name, readNamespace(name)])) };
}

export async function runCapsule(metadataFile, configurationFile, output, root) {
  const metadata = validateBrowserMetadata(JSON.parse(fs.readFileSync(metadataFile, 'utf8')));
  const config = JSON.parse(fs.readFileSync(configurationFile, 'utf8'));
  const { group, runId = '', sourceDigest = '', hostNamespaces = {} } = config;
  assert.ok(Object.hasOwn(groups, group), 'Unknown group before fixture allocation');
  assert.ok(runId === '' || /^[a-f0-9-]{36}$/.test(runId));
  assert.ok(sourceDigest === '' || /^[a-f0-9]{64}$/.test(sourceDigest));
  validateNamespaces(hostNamespaces, !runId);
  assert.equal(path.dirname(fileURLToPath(import.meta.url)), path.join(path.dirname(metadataFile), 'nix'));
  directoryIdentity(output); directoryIdentity(root);
  const environment = sandboxEnvironment();
  validateNamespaces(environment.namespaces);
  for (const [key, value] of Object.entries(hostNamespaces)) {
    assert.notEqual(environment.namespaces[key], value, `Host ${key} namespace exposed`);
  }
  const fixtureRoot = path.join(root, 'f');
  const artifacts = path.join(output, 'artifacts');
  for (const directory of [fixtureRoot, artifacts, path.join(fixtureRoot, 'tmp'), path.join(root, 'home')]) fs.mkdirSync(directory, { mode: 0o700 });
  const result = { version: 1, backend: 'nix-build-sandbox', group, runId, sourceDigest, hostNamespaces,
    package: metadata.package, source: metadata.source, flakeSource: metadata.flakeSource,
    environment, fixtureRoot, startedAt: new Date().toISOString(), passed: false, artifactsCollected: false,
    containmentOwner: 'nix-build',
    containmentScope: 'Nix owns builder containment; inner observations do not certify unobserved escaped descendants' };
  const controller = new AbortController();
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => controller.abort(signal)]));
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  // Same bound as the former VM's transient suite runner; browser deadlines are unchanged.
  const watchdog = setTimeout(() => controller.abort('SIGTERM'), 1_800_000);
  const env = { PATH: metadata.toolPath, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', HOME: path.join(root, 'home'),
    FONTCONFIG_FILE: metadata.fontconfig,
    SHELL: metadata.shell, E2E_PACKAGE_ROOT: metadata.package, E2E_BASE_URL: 'http://127.0.0.1:30141',
    E2E_SERVICE_BACKEND: 'process', PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: metadata.chromium,
    BRABBLER_TEST_FIXTURES: fixtureRoot, BRABBLER_TEST_ARTIFACTS: artifacts, BRABBLER_TEST_TMP: path.join(fixtureRoot, 'tmp') };
  if (groups[group].selector) env[groups[group].selector] = '1';
  const started = performance.now();
  try {
    result.execution = await runOwned(metadata.node, [path.join(path.dirname(metadataFile), 'e2e', `${groups[group].suite}-suite.mjs`)],
      { cwd: root, env, signal: controller.signal, logPath: path.join(output, 'suite.log'), graceMs: 45_000 });
    for (const [key, name] of [['harness', 'run.json'], ['coverage', 'coverage.json']]) {
      try { result[key] = JSON.parse(fs.readFileSync(path.join(artifacts, name), 'utf8')); }
      catch (error) { result.error ??= `${key}: ${error.message}`; }
    }
    if (!result.execution.settled || result.execution.interrupted || result.harness && !result.harness.resourcesSettled) {
      throw new Error('Inner settlement uncertain; retain the failed Nix builder, not a successful capsule');
    }
    try { await assertPortClosed(30141); result.portClosed = true; }
    catch (error) { result.error ??= error.message; }
    result.passed = result.execution.code === 0 && result.harness?.status === 'passed' && !result.error && result.portClosed === true;
    result.artifactsCollected = true;
    try { validateBrowserResult(result, metadata, { group, runId, sourceDigest, hostNamespaces }, output); }
    catch (error) { result.passed = false; result.error ??= error.message; }
    if (!result.passed) {
      const archive = spawnSync(metadata.tar, ['-czf', path.join(output, 'failed-fixture.tar.gz'), '-C', root, 'f'],
        { env: { PATH: metadata.toolPath }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
      if (archive.error || archive.status !== 0) throw new Error(`Fixture evidence archive failed: ${archive.error?.message ?? archive.stderr}`);
    }
    assertEvidenceTree(output);
  } finally {
    clearTimeout(watchdog);
    for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
    result.elapsedSeconds = (performance.now() - started) / 1000;
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(`Diagnostic capsule ${group}: ${result.passed ? 'PASSED' : 'FAILED'} (${result.elapsedSeconds.toFixed(3)}s); ${output}/result.json`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runCapsule(...process.argv.slice(2)); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
