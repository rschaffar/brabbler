import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discover, planFiles } from '../nix/test-runner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const audit = JSON.parse(fs.readFileSync(new URL('../nix/test-lanes-audit-2026-10-22.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../nix/test-lanes.json', import.meta.url), 'utf8'));

// Immutable evidence of the original revision. Do not reconcile its filenames,
// bytes, reasons, estimates or lanes against today's discovered files/manifest.
// A recorded source digest identifies evidence; it is not future isolation proof.
test('2026-10-22 historical audit retains its 192 distinct source-bound verdicts', () => {
  assert.equal(audit.version, 1);
  assert.equal(audit.files.length, 192);
  assert.equal(new Set(audit.files.map(file => file.path)).size, 192);
  const counts = { F: 0, N: 0, E: 0 };
  for (const file of audit.files) {
    assert.ok(typeof file.path === 'string' && file.path.endsWith('.test.mjs'));
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Object.hasOwn(counts, file.lane), file.path);
    counts[file.lane]++;
    assert.ok(file.reason.trim(), file.path);
    assert.ok(file.evidence.length > 0, file.path);
    if (file.lane !== 'E') assert.ok(Number.isSafeInteger(file.estimatedMs) && file.estimatedMs > 0, file.path);
  }
  assert.deepEqual(counts, { F: 86, N: 42, E: 64 });
  assert.deepEqual(audit.counts, counts);
});

test('live unresolved holds remain unreviewed exclusive warnings with their current reasons', () => {
  const inventory = discover(root);
  const paths = Object.keys(manifest.holds);
  assert.ok(paths.length > 0);
  const planned = planFiles(inventory, manifest, paths);
  assert.equal(planned.length, paths.length);
  for (const file of planned) {
    assert.equal(file.lane, 'E', file.path);
    assert.equal(file.reviewed, false, file.path);
    assert.equal(file.estimatedMs, 0, file.path);
    assert.match(file.reason, /UNREVIEWED HOLD: exclusive; still included;/, file.path);
    assert.ok(file.reason.endsWith(manifest.holds[file.path]), file.path);
  }
});

test('unresolved resource/runtime holds stay exclusive; reviewed PTY and SDK speed owners remain native', () => {
  const exclusive = [
    'plugins/git-workflow/large-operations.test.mjs',
    'plugins/session-launch/runtime.test.mjs',
    'lib/test-runner.test.mjs',
  ];
  const native = [
    'lib/terminal-manager.test.mjs',
    'lib/session-model-speed-lifecycle.test.mjs',
    'lib/session-model-speed-native-closure.test.mjs',
  ];
  const planned = planFiles(discover(root), manifest, [...exclusive, ...native]);
  assert.equal(planned.length, 6);
  for (const name of exclusive) {
    assert.equal(planned.find(file => file.path === name).lane, 'E', name);
  }
  for (const name of native) {
    const file = planned.find(entry => entry.path === name);
    assert.equal(file.lane, 'N', name);
    assert.equal(file.reviewed, true, name);
    assert.equal(Object.hasOwn(manifest.holds, name), false, name);
  }
  // Native completion, not requested kill/public-promise settlement, closed these
  // finite holds. The immutable historical census remains unchanged above.
  assert.match(planned.find(file => file.path === native[0]).reason, /node-pty.*actual onExit join/);
  assert.match(planned.find(file => file.path === native[1]).reason, /completion AND settled.*conditional root removal/);
  assert.match(planned.find(file => file.path === native[2]).reason, /original body\/abort\/idle\/shutdown\/restore identities/);
  const large = planned.find(file => file.path === exclusive[0]);
  assert.equal(large.reviewed, false);
  assert.match(large.reason, /UNREVIEWED.*exclusive/);
  assert.ok(Object.hasOwn(manifest.holds, large.path));
});
