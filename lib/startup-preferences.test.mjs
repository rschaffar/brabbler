import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const { readStartupPreferences, saveStartupPreferences } = await jiti.import("./startup-preferences.ts");
const defaults = await jiti.import("../app/api/models/defaults/route.ts");

async function withSettings(run) {
  const root = await mkdtemp(join(tmpdir(), "brabbler-startup-preferences-"));
  const cwd = join(root, "cwd"), agentDir = join(root, "agent"), settingsPath = join(agentDir, "settings.json");
  const before = process.env.PI_CODING_AGENT_DIR;
  try {
    await mkdir(join(cwd, '.pi'), { recursive: true }); await mkdir(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await run({ cwd, agentDir, settingsPath, settings: () => SettingsManager.create(cwd, agentDir) });
  } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
}

test("explicit shared defaults use native global persistence and retain project precedence and unrelated patterns", async () => {
  await withSettings(async ({ cwd, settings, settingsPath }) => {
    const siblings = { enabledModels: ['synthetic/*:high', 'signed-out/missing:low'], modelThinkingLevels: { 'synthetic/one': 'low' }, unrelated: { keep: true } };
    await writeFile(settingsPath, JSON.stringify(siblings));
    await writeFile(join(cwd, '.pi/settings.json'), JSON.stringify({ defaultProvider: 'project', defaultModel: 'project-model', defaultThinkingLevel: 'off' }));
    await saveStartupPreferences(settings(), { model: { provider: 'synthetic', modelId: 'one' }, thinkingLevel: 'high' });
    assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), { ...siblings, defaultProvider: 'synthetic', defaultModel: 'one', defaultThinkingLevel: 'high' });
    const fresh = settings();
    assert.deepEqual(readStartupPreferences(fresh), { model: { provider: 'synthetic', modelId: 'one' }, thinkingLevel: 'high' });
    assert.equal(fresh.getDefaultModel(), 'project-model', 'existing native project precedence remains effective');
    assert.equal(fresh.getDefaultThinkingLevel(), 'off');
  });
});

test("partial default changes leave unedited fields untouched and native storage failures do not report Saved", async () => {
  await withSettings(async ({ settings, settingsPath }) => {
    await saveStartupPreferences(settings(), { model: { provider: 'synthetic', modelId: 'one' }, thinkingLevel: 'medium' });
    await saveStartupPreferences(settings(), { thinkingLevel: 'off' });
    assert.deepEqual(readStartupPreferences(settings()), { model: { provider: 'synthetic', modelId: 'one' }, thinkingLevel: 'off' });
    await writeFile(settingsPath, '{ invalid synthetic settings');
    await assert.rejects(saveStartupPreferences(settings(), { thinkingLevel: 'high' }), /Could not save/);
    assert.equal(await readFile(settingsPath, 'utf8'), '{ invalid synthetic settings');
    await rm(settingsPath);
    const loaded = settings();
    await mkdir(settingsPath); // A real storage failure after successful native load.
    await assert.rejects(saveStartupPreferences(loaded, { thinkingLevel: 'low' }), /Could not save/);
  });
});

test("default HTTP save validates scope and returns durable native global values", async () => {
  await withSettings(async ({ settingsPath }) => {
    const request = body => new Request('http://localhost/api/models/defaults', { method: 'PUT', body: JSON.stringify(body) });
    for (const body of [null, [], { thinkingLevel: 'invalid' }, { model: { provider: '', modelId: 'one' } }, { accounts: {} }, { cwd: '/project' }]) {
      const response = await defaults.PUT(request(body)); const result = await response.json();
      assert.equal(response.status, 400); assert.equal(typeof result.error, 'string');
    }
    const expected = { model: { provider: 'synthetic', modelId: 'one' }, thinkingLevel: 'xhigh' };
    const response = await defaults.PUT(request(expected)); const result = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(result, expected);
    assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).defaultThinkingLevel, 'xhigh');
    assert.deepEqual(await (await defaults.GET()).json(), expected);
    await writeFile(settingsPath, '{ broken');
    const refused = await defaults.PUT(request({ thinkingLevel: 'high' })); const failure = await refused.json();
    assert.equal(refused.status, 500); assert.equal(typeof failure.error, 'string');
  });
});
