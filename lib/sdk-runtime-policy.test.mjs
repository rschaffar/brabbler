import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSdkRuntimePolicy, applySdkRuntimePolicy, preflightSdkRuntimePolicy } from '../bin/sdk-runtime-policy.js';
const require = createRequire(import.meta.url);
const sdkManifest = readFileSync(join(require('../bin/patch-sdk-command-env.js').resolveInstalledSdkRoot(), 'package.json'));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sdk-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'brabbler', private: true }));
  const sdk = join(root, 'node_modules/@earendil-works/pi-coding-agent');
  mkdirSync(join(sdk, 'dist'), { recursive: true });
  writeFileSync(join(sdk, 'package.json'), sdkManifest);
  const undici = join(root, 'node_modules/undici'); mkdirSync(undici);
  writeFileSync(join(undici, 'package.json'), JSON.stringify({ name: 'undici', version: '8.12.2' }));
  return { root, sdk, undici };
}

test('realized SDK uses fixed modular Undici and has no standalone bundle/CLI', () => {
  assert.deepEqual(checkSdkRuntimePolicy(), { packageVersion: '1.4.0', undiciVersion: '8.12.2', standaloneBundles: 'excluded' });
});
test('an already excluded owned installation is idempotent and read-only checks agree', t => {
  const { root } = fixture(t);
  assert.deepEqual(preflightSdkRuntimePolicy(root), { owned: true, packageVersion: '1.4.0' });
  assert.equal(applySdkRuntimePolicy(root).changed, false);
  assert.equal(applySdkRuntimePolicy(root).changed, false);
  assert.equal(checkSdkRuntimePolicy(root).standaloneBundles, 'excluded');
});
test('unknown bundle bytes refuse before removing files or the CLI link', t => {
  const { root, sdk } = fixture(t);
  const bundle = join(sdk, 'dist/bundle'); mkdirSync(bundle);
  const cli = join(bundle, 'cli.js'); writeFileSync(cli, 'synthetic unknown implementation');
  const bin = join(root, 'node_modules/.bin'); mkdirSync(bin);
  symlinkSync('../@earendil-works/pi-coding-agent/dist/bundle/cli.js', join(bin, 'pi'));
  assert.throws(() => checkSdkRuntimePolicy(root), /SDK_RUNTIME_NOT_EXCLUDED/);
  assert.throws(() => applySdkRuntimePolicy(root), /SDK_RUNTIME_BUNDLE_UNKNOWN/);
  assert.equal(readFileSync(cli, 'utf8'), 'synthetic unknown implementation');
  assert.equal(existsSync(join(bin, 'pi')), true);
});
test('wrong versions and interrupted unknown staging refuse without cleanup', t => {
  const { root, sdk, undici } = fixture(t);
  writeFileSync(join(undici, 'package.json'), JSON.stringify({ version: '8.10.2' }));
  assert.throws(() => applySdkRuntimePolicy(root), /SDK_RUNTIME_UNDICI/);
  writeFileSync(join(undici, 'package.json'), JSON.stringify({ version: '8.12.2' }));
  const staged = join(sdk, 'dist/.brabbler-excluded-bundle'); mkdirSync(staged);
  writeFileSync(join(staged, 'partial.js'), 'synthetic interrupted state');
  assert.throws(() => checkSdkRuntimePolicy(root), /SDK_RUNTIME_NOT_EXCLUDED/);
  assert.throws(() => applySdkRuntimePolicy(root), /SDK_RUNTIME_BUNDLE_UNKNOWN/);
  assert.equal(existsSync(join(staged, 'partial.js')), true);
});
test('shared dependency or bin-directory aliases cannot redirect installation removal', t => {
  const { root, sdk } = fixture(t);
  const outside = join(root, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'pi'), 'keep');
  symlinkSync(outside, join(root, 'node_modules/.bin'));
  assert.throws(() => preflightSdkRuntimePolicy(root), /SDK_RUNTIME_SHARED_INSTALL/);
  assert.throws(() => applySdkRuntimePolicy(root), /SDK_RUNTIME_SHARED_INSTALL/);
  assert.equal(readFileSync(join(outside, 'pi'), 'utf8'), 'keep');
  rmSync(join(root, 'node_modules/.bin'));
  rmSync(sdk, { recursive: true }); symlinkSync(outside, sdk);
  assert.throws(() => applySdkRuntimePolicy(root), /SDK_RUNTIME_SHARED_INSTALL/);
});
