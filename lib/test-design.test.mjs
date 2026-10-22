import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discover, planFiles } from '../nix/test-runner.mjs';
import { auditLiveManifest, discoverDesignSources, inspectSource, MIGRATED_OWNERS, parseLiveManifest } from '../nix/test-design.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = (path, lane = 'F') => ({ path, lane, reason: 'Explicit synthetic isolation review' });
const inventory = ['lib/a.test.mjs', 'lib/b.test.mjs'].map(path => ({ path, sha256: 'not-authority' }));
const manifest = () => ({ version: 1, files: [entry(inventory[0].path)],
  holds: { [inventory[1].path]: 'Native worker close ownership is unresolved' } });
const rules = (name, source, options) => inspectSource(name, source, options).map(item => item.rule);
const migrated = 'lib/plugins/project-operations.test.mjs';

test('explicit holds warn and remain unreviewed E; unknown fallback still fails closed', () => {
  const plan = auditLiveManifest(inventory, manifest());
  assert.deepEqual(plan.map(file => [file.lane, file.reviewed]), [['F', true], ['E', false]]);
  assert.match(plan[1].reason, /UNREVIEWED HOLD: exclusive; still included; Native worker close/);
  assert.equal(plan[1].estimatedMs, 0);
  assert.deepEqual(planFiles(inventory, manifest(), [inventory[1].path]), [plan[1]]);
  const withoutHold = { version: 1, files: [entry(inventory[0].path)] };
  const fallback = planFiles(inventory, withoutHold)[1];
  assert.equal(fallback.lane, 'E'); assert.equal(fallback.reviewed, false);
  assert.match(fallback.reason, /UNREVIEWED.*included/);
  assert.throws(() => auditLiveManifest(inventory, withoutHold), /Missing explicit classification or unresolved hold.*lib\/b/);
});

test('missing, duplicate, unknown hold references and invalid reasons cannot hide behind a selection', () => {
  for (const reason of ['', '  \n ', null, false, 1, [], {}]) {
    assert.throws(() => planFiles(inventory, { ...manifest(), holds: { [inventory[1].path]: reason } }, [inventory[0].path]), /Invalid hold reason/);
  }
  for (const holds of [null, false, 1, 'reason', [], [[inventory[1].path, 'one'], [inventory[1].path, 'two']]]) {
    assert.throws(() => planFiles(inventory, { ...manifest(), holds }), /Invalid manifest holds/);
  }
  assert.throws(() => planFiles(inventory, { ...manifest(), holds: { 'lib/missing.test.mjs': 'unresolved' } }), /Unknown hold path/);
  assert.throws(() => planFiles(inventory, { ...manifest(), holds: { '': 'unresolved' } }), /Unknown hold path/);
  assert.throws(() => planFiles(inventory, { ...manifest(), holds: { [inventory[0].path]: 'duplicate reference' } }), /Duplicate manifest\/hold path/);
  assert.throws(() => planFiles(inventory, { ...manifest(), files: [entry(inventory[0].path), entry(inventory[0].path)] }), /Duplicate manifest path/);
  assert.throws(() => planFiles([...inventory, inventory[1]], manifest()), /Duplicate discovery path/);
  assert.throws(() => auditLiveManifest(inventory, { ...manifest(), holds: {} }), /Missing explicit/);
});

test('raw JSON cannot silently overwrite duplicate hold references', () => {
  assert.deepEqual(parseLiveManifest(JSON.stringify(manifest())), manifest());
  assert.throws(() => parseLiveManifest('{"version":1,"files":[],"holds":{"lib/a.test.mjs":"first","lib/a.test.mjs":"second"}}'), /Duplicate manifest JSON reference/);
  assert.throws(() => parseLiveManifest('{"version":1,"files":[],"holds":{},"holds":{}}'), /Duplicate manifest JSON reference/);
  assert.throws(() => parseLiveManifest('{not JSON}'), SyntaxError);
});

test('live review is independent of historical bytes, reasons, lanes and filename counts', () => {
  const live = { version: 1, files: [entry(inventory[0].path, 'N'), entry(inventory[1].path, 'E')], holds: {} };
  live.files[0].reason = 'Current native private-root review, not a historical reason';
  assert.deepEqual(auditLiveManifest(inventory, live).map(file => file.lane), ['N', 'E']);
  const changed = inventory.map(file => ({ ...file, sha256: 'different-current-bytes' }));
  assert.equal(auditLiveManifest(changed, live)[0].reviewed, true);
  // This only proves the architecture of policy/evidence separation. Changed
  // effects still need human review; neither of these arbitrary digests is proof.
});

test('production AST imports reject support via relative paths, root aliases and loader syntax', () => {
  const sources = [
    'import { x } from "@/lib/testing/async.fixture.mjs";',
    'import { JSDOM } from "jsdom";',
    'import test from "node:test";',
    'export { x } from "../lib/helper.fixture.mjs";',
    'const x = import(`../lib/a.test.mjs`);',
    'const x = require("@/lib/testing/async.fixture.mjs");',
    'const x = jiti.import("../lib/fixtures/reader.mjs");',
    'import x = require("../lib/a.test.mjs");',
    'type X = import("../lib/reader.fixture").X;',
    'import type { X } from "../lib/testing/types";',
    'import "@/lib/other/../testing/fixture.mjs";',
  ];
  for (const source of sources) assert.ok(rules('components/Owner.ts', source).includes('production-test-import'), source);
  assert.deepEqual(rules('components/Owner.tsx', `
    import { x } from "@/lib/policy";
    const text = 'import "@/lib/testing/async.fixture.mjs"';
    // import "../lib/a.test.mjs";
    export const view = <div>{text}</div>;
  `), []);
});

test('all typed modules including fixtures forbid registered test entrypoint imports', () => {
  const options = { registeredTests: inventory.map(file => file.path) };
  for (const name of ['lib/Owner.ts', 'lib/testing/owner.fixture.tsx', 'e2e/owner.mts', 'nix/owner.cts']) {
    for (const source of ['import "@/lib/a.test.mjs";', 'export * from "@/lib/a.test";',
      'type T = import("@/lib/a.test.mjs").T;', 'const x = import("@/lib/a.test.mjs");']) {
      assert.ok(rules(name, source, options).includes('typing-test-entrypoint'), `${name}: ${source}`);
    }
  }
  assert.deepEqual(rules('lib/testing/owner.fixture.tsx', 'import "./react.fixture.mjs"; export const view = <div/>;', options), []);
  assert.deepEqual(rules('e2e/owner.mts', 'import "@/lib/testing/async.fixture.mjs";', options), []);
  assert.deepEqual(rules('lib/testing/owner.fixture.mjs', 'import "../a.test.mjs";', options), []);
});

test('typed inputs cannot depend on live Node scheduling metadata', () => {
  for (const name of ['lib/Owner.ts', 'lib/testing/owner.fixture.tsx', 'nix/owner.mts']) {
    assert.ok(rules(name, 'import policy from "@/nix/test-lanes.json";').includes('typing-scheduling-policy'));
  }
  assert.deepEqual(rules('nix/owner.mjs', 'import policy from "./test-lanes.json";'), []);
});

test('browser calls, not comments/strings, require per-call elapsed-time proof rationales', () => {
  for (const source of ['await page.waitForTimeout(10);', 'page["waitForTimeout"](10);',
    'await page?.waitForTimeout(10);', 'const { waitForTimeout: nap } = page; await nap(10);']) {
    assert.deepEqual(rules('e2e/feature.mjs', source), ['browser-sleep'], source);
  }
  assert.deepEqual(rules('e2e/feature.mjs', '// waitForTimeout(10)\nconst text = "page.waitForTimeout(10)"; await arrival;'), []);
  assert.deepEqual(rules('lib/unmigrated.test.mjs', 'await page.waitForTimeout(10);'), []);
  assert.deepEqual(rules('e2e/feature.mjs', '// test-design-timing-proof: verifies the natural expiry boundary, not UI settlement\nawait page.waitForTimeout(1000);'), []);
  assert.deepEqual(rules('e2e/feature.mjs', '// test-design-timing-proof:   \nawait page.waitForTimeout(1000);'), ['browser-sleep']);
  assert.deepEqual(rules('e2e/feature.mjs', '// test-design-timing-proof: one comment cannot exempt two calls\nawait page.waitForTimeout(1); await page.waitForTimeout(2);'), ['browser-sleep', 'browser-sleep']);
});

test('migrated owners guard awaited settling delays without banning native watchdogs or owned outcomes', () => {
  assert.ok(MIGRATED_OWNERS.includes(migrated));
  for (const source of ['await delay(20);', 'await sleep(20);', 'await fixture.delay(20);',
    'import { setTimeout as nap } from "node:timers/promises"; await nap(20);',
    'import * as timers from "node:timers/promises"; await timers.setTimeout(20);',
    'await new Promise(resolve => setTimeout(resolve, 20));']) {
    assert.deepEqual(rules(migrated, source), ['settling-sleep'], source);
  }
  assert.deepEqual(rules(migrated, `
    const watchdog = setTimeout(() => reject(new Error('Native close missing')), 10000);
    await owner.fullySettled;
    await fixture.wait(operationId);
    clearTimeout(watchdog);
  `), []);
  assert.deepEqual(rules(migrated, '// test-design-timing-proof: retains the native deadline boundary assertion\nawait delay(1000);'), []);
  assert.deepEqual(rules('lib/unmigrated.test.mjs', 'await delay(20);'), []);
  assert.deepEqual(rules(migrated, 'const controlled = { setTimeout(callback) { return callback; } };'), []);
});

test('actual discovered tests have exactly one explicit live review or unresolved hold', () => {
  const current = parseLiveManifest(fs.readFileSync(new URL('../nix/test-lanes.json', import.meta.url), 'utf8'));
  const discovered = discover(root);
  const planned = auditLiveManifest(discovered, current);
  assert.deepEqual(planned.map(file => file.path), discovered.map(file => file.path));
});

test('actual source imports and bounded migration/browser calls obey architectural input guards', () => {
  const registeredTests = discover(root).map(file => file.path);
  const sources = discoverDesignSources(root);
  assert.ok(sources.has('lib/testing/mount-probe.fixture.tsx'), 'typed fixtures must not disappear from input dependency review');
  assert.ok(sources.has('hooks/useResizablePanel.ts'));
  const diagnostics = [...sources].flatMap(([name, source]) => inspectSource(name, source, { registeredTests }));
  assert.deepEqual(diagnostics, [], diagnostics.map(item => `${item.path}:${item.line}: ${item.rule}: ${item.message}`).join('\n'));
});
