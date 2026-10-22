import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discover, planFiles } from '../nix/test-runner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const audit = JSON.parse(fs.readFileSync(new URL('../nix/test-lanes-audit-2026-10-22.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../nix/test-lanes.json', import.meta.url), 'utf8'));
const inventory = discover(root);

test('default-exclusive audit retains 192 distinct source-bound verdicts including unresolved holds', () => {
  assert.equal(audit.version, 1);
  assert.equal(audit.files.length, 192);
  assert.equal(new Set(audit.files.map(file => file.path)).size, 192);
  const discovered = new Set(inventory.map(file => file.path));
  const counts = { F: 0, N: 0, E: 0 };
  for (const file of audit.files) {
    assert.ok(discovered.has(file.path), file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Object.hasOwn(counts, file.lane), file.path);
    counts[file.lane]++;
    assert.ok(file.reason.trim(), file.path);
    assert.ok(file.evidence.length > 0, file.path);
    if (file.lane !== 'E') {
      assert.ok(Number.isSafeInteger(file.estimatedMs) && file.estimatedMs > 0, file.path);
    }
  }
  assert.deepEqual(counts, { F: 86, N: 42, E: 64 });
  assert.deepEqual(audit.counts, counts);
  // sha256 records the audited revision, not an assertion that future test edits
  // have already been reviewed. Review relevant fixture/effect changes explicitly.
});

test('reviewed default-exclusive batches enter the pool with their exact file-specific classification', () => {
  const promoted = audit.files.filter(file => file.lane !== 'E');
  assert.equal(promoted.length, 128);
  const planned = planFiles(inventory, manifest, promoted.map(file => file.path));
  const expected = new Map(promoted.map(file => [file.path, file]));
  assert.equal(planned.length, 128);
  for (const file of planned) {
    const review = expected.get(file.path);
    assert.equal(file.reviewed, true, file.path);
    assert.equal(file.lane, review.lane, file.path);
    assert.equal(file.reason, review.reason, file.path);
    assert.equal(file.estimatedMs, review.estimatedMs, file.path);
  }
});

test('unresolved audited files and original lifecycle/resource holds remain exclusive', () => {
  const held = audit.files.filter(file => file.lane === 'E');
  const planned = planFiles(inventory, manifest, held.map(file => file.path));
  assert.equal(planned.length, 64);
  for (const file of planned) {
    assert.equal(file.lane, 'E', file.path);
    // The audit records the hold reason without admitting it to the pool or
    // changing the existing unknown-file/explicit lifecycle hold contracts.
    assert.equal(file.reviewed, false, file.path);
    assert.match(file.reason, /UNREVIEWED.*included/, file.path);
  }
  const oldHolds = planFiles(inventory, manifest, [
    'plugins/git-workflow/large-operations.test.mjs',
    'lib/session-model-speed-lifecycle.test.mjs',
    'plugins/session-launch/runtime.test.mjs',
    'lib/test-runner.test.mjs',
    'lib/terminal-manager.test.mjs',
  ]);
  assert.ok(oldHolds.every(file => file.lane === 'E'));
});
