// Shared declared-input and verdict contracts. A realized diagnostic capsule is not a pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groups } from '../e2e/scenarios.mjs';
import { coverageIds, MAX_BROWSER_WORKERS } from './vm-plan.mjs';
import { assertEvidenceTree } from './vm-evidence.mjs';

// Whole-group elapsed seconds rounded up, including diagnostic export/settlement.
// Four-sandbox run d44f40e5 (2026-10-22), source digest 069bbf867047ce77bf495db9a009022fba6859dc08644c9f4425fab2dc06f204.
// Hints for packing only: never deadlines, admission budgets or coverage authority.
export const weights = Object.freeze({
  state: 8, history: 45, 'extension-dialogs': 22, 'mobile-sidebar': 15,
  worktrees: 97, 'session-launch': 16, 'running-forks': 14, 'model-speed': 32,
  trust: 9, 'git-plugin': 95, appearance: 60, timestamps: 7,
  'diff-context': 21, markdown: 153, 'file-edit': 47, archive: 4, privacy: 38,
  activity: 209, accounts: 17, questions: 71, 'session-links': 6, bulk: 8,
  move: 34, 'ssh-agent': 15, terminal: 33, 'native-tools': 16,
});

const store = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/;
const packageSuffix = '/lib/node_modules/@agegr/pi-web';
export function validateBrowserMetadata(metadata) {
  assert.equal(metadata?.version, 1);
  assert.equal(metadata.backend, 'nix-build-sandbox');
  for (const key of ['source', 'flakeSource']) assert.match(metadata[key], store);
  assert.ok(metadata.package.endsWith(packageSuffix));
  const prefix = metadata.package.slice(0, -packageSuffix.length);
  assert.match(prefix, store);
  assert.equal(metadata.launcher, `${prefix}/bin/pi-web`);
  for (const key of ['node', 'chromium', 'shell', 'tar']) assert.match(metadata[key], /^\/nix\/store\/[a-z0-9]{32}-[^/]+\/bin\/[^/]+$/);
  assert.match(metadata.fontconfig, store);
  assert.equal(typeof metadata.toolPath, 'string');
  assert.ok(metadata.toolPath.length > 0);
  for (const directory of metadata.toolPath.split(':')) assert.match(directory, /^\/nix\/store\/[a-z0-9]{32}-[^/]+\/bin$/);
  return metadata;
}

export function validateNamespaces(namespaces, allowEmpty = false) {
  assert.ok(namespaces && typeof namespaces === 'object' && !Array.isArray(namespaces), 'Namespace identity object required');
  const keys = Object.keys(namespaces).sort();
  if (allowEmpty && keys.length === 0) return namespaces;
  assert.deepEqual(keys, ['mnt', 'net', 'pid'], 'Complete observed namespace identities required');
  const patterns = { net: /^net:\[[0-9]+\]$/, pid: /^pid:\[[0-9]+\]$/, mnt: /^mnt:\[[0-9]+\]$/ };
  for (const name of keys) assert.match(namespaces[name], patterns[name]);
  return namespaces;
}

export function validateSchedulingWeights(reviewed = weights) {
  assert.deepEqual(Object.keys(reviewed).sort(), Object.keys(groups).sort(), 'Every group requires a reviewed scheduling weight');
  for (const [name, seconds] of Object.entries(reviewed)) assert.ok(Number.isFinite(seconds) && seconds > 0, `${name}: positive scheduling weight required`);
  return reviewed;
}

export function browserPlan(metadata, focus = 'all', workers = 1) {
  validateBrowserMetadata(metadata);
  validateSchedulingWeights();
  assert.ok(focus === 'all' || Object.hasOwn(groups, focus), 'Unknown browser group');
  assert.ok(Number.isInteger(workers) && workers >= 1 && workers <= MAX_BROWSER_WORKERS);
  const selected = focus === 'all' ? Object.keys(groups) : [focus];
  const lanes = Array.from({ length: workers }, (_, i) => ({ id: `b${i}`, groups: [], weightSeconds: 0 }));
  const jobs = selected.map((name, index) => ({ name, index, ...groups[name], scenarios: coverageIds(name), weightSeconds: weights[name] }));
  for (const job of [...jobs].sort((a, b) => b.weightSeconds - a.weightSeconds || a.index - b.index)) {
    const lane = [...lanes].sort((a, b) => a.weightSeconds - b.weightSeconds || a.id.localeCompare(b.id))[0];
    lane.groups.push(job.name); lane.weightSeconds += job.weightSeconds; job.lane = lane.id;
  }
  return { version: 1, backend: 'nix-build-sandbox', metadata, focus, workers, selected, lanes, jobs };
}

export function validateBrowserResult(result, metadata, expected, output) {
  validateBrowserMetadata(metadata);
  assert.equal(result?.version, 1); assert.equal(result.backend, 'nix-build-sandbox');
  for (const key of ['package', 'source', 'flakeSource']) assert.equal(result[key], metadata[key]);
  assert.ok(Object.hasOwn(groups, expected.group));
  assert.equal(result.group, expected.group);
  assert.equal(result.runId, expected.runId ?? '');
  assert.equal(result.sourceDigest, expected.sourceDigest ?? '');
  assert.deepEqual(result.hostNamespaces, expected.hostNamespaces ?? {});
  assert.equal(result.artifactsCollected, true);
  assert.equal(result.execution?.settled, true);
  assert.equal(result.execution?.interrupted, false);
  assert.equal(result.containmentOwner, 'nix-build');
  assert.equal(typeof result.passed, 'boolean');
  assert.ok(Number.isInteger(result.environment?.uid) && result.environment.uid > 0, 'Browser must run as an ordinary builder user');
  assert.deepEqual(result.environment.interfaces, ['lo']);
  validateNamespaces(result.environment.namespaces);
  validateNamespaces(expected.hostNamespaces ?? {}, !expected.runId);
  for (const [key, value] of Object.entries(expected.hostNamespaces ?? {})) {
    assert.notEqual(result.environment.namespaces[key], value, `Host ${key} namespace exposed`);
  }
  if (!result.passed) return result;
  assert.equal(result.execution.code, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.portClosed, true);
  const run = result.harness;
  assert.equal(run?.status, 'passed'); assert.equal(run.resourcesSettled, true);
  assert.equal(run.root, metadata.package); assert.equal(run.interrupted, false); assert.deepEqual(run.errors, []);
  assert.equal(run.fixtureRoot, result.fixtureRoot);
  assert.equal(run.artifacts, path.join(output, 'artifacts'));
  assert.equal(run.server?.scope, 'installed-package-process');
  assert.equal(run.server.settled, true); assert.equal(run.server.processGroup, 'absent');
  assert.equal(run.server.containmentOwner, 'nix-build');
  assert.equal(run.server.descendants, 'not-certified');
  assert.equal(run.server.settlementScope, 'Owned child/pipe closure and original POSIX group absence only; escaped descendants and Windows descendants are not certified');
  assert.equal(run.server.generation?.packageRoot, metadata.package);
  assert.equal(run.server.generation.launcher, metadata.launcher);
  assert.ok(Number.isSafeInteger(run.server.generation.pid) && run.server.generation.pid > 0);
  for (const key of ['unexpectedExit', 'error', 'logError']) assert.ok(!run.server[key], `Unexpected service ${key}`);
  const coverage = result.coverage;
  assert.equal(coverage?.version, 1); assert.equal(coverage.group, expected.group);
  assert.equal(coverage.status, 'passed'); assert.equal(coverage.active, null);
  assert.deepEqual(coverage.expected, coverageIds(expected.group));
  assert.deepEqual(coverage.completed, coverageIds(expected.group));
  return result;
}

export function requireBrowserPass(result, metadata, expected, output) {
  validateBrowserResult(result, metadata, expected, output);
  assert.equal(result.passed, true, result.error ?? `${expected.group}: browser acceptance failed`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, metadataFile, group, output] = process.argv.slice(2);
  if (mode !== 'check') throw new Error('Unknown browser evidence operation');
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  assertEvidenceTree(output); // Final immutable dependency, before reading through any entry.
  const result = JSON.parse(fs.readFileSync(path.join(output, 'result.json'), 'utf8'));
  requireBrowserPass(result, metadata, { group }, output);
}
