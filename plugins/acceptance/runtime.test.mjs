import assert from 'node:assert/strict';
import test from 'node:test';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { fixture } from '../../lib/acceptance/test.fixture.mjs';
const jiti = createJiti(import.meta.url);
const { acceptancePlugin } = await jiti.import('./index.ts');
const { acceptanceEnabled } = await jiti.import('./policy.ts');
const { updatePluginSettings } = await jiti.import('../../lib/plugins/settings.ts');
const { selectSubagentExtensionTools } = await jiti.import('../../lib/subagent-extension-selectors.ts');
const names = ['acceptance_run', 'acceptance_status', 'acceptance_cancel'];
const setEnabled = (enabled) => updatePluginSettings(acceptancePlugin.manifest, 'global', undefined, { enabled }, []);
async function native(t, f, { selectors, denied = [], loadExtensions = true } = {}) {
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  const services = await createAgentSessionServices({ cwd: f.cwd, agentDir: join(f.root, 'agent'), modelRuntime,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: loadExtensions ? [acceptancePlugin.extension(f.cwd)] : [] } });
  const extensions = services.resourceLoader.getExtensions().extensions;
  const selected = selectors === undefined ? undefined : selectSubagentExtensionTools(extensions, selectors, denied);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(f.cwd),
    ...(selected ? { tools: ['read', ...selected] } : {}) });
  t.after(async () => { try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); } finally { session.dispose(); } });
  await session.bindExtensions({ uiContext: { notify() {} }, mode: 'rpc' });
  return { session, extensions, selected };
}
test('one global switch defaults off; native tools withdraw and return live without changing coding tools', async (t) => {
  const f = fixture(t, { enabled: false }); unlinkSync(f.pluginSettingsPath);
  assert.equal(acceptancePlugin.manifest.fields.enabled.default, false);
  assert.equal(acceptancePlugin.manifest.fields.enabled.globalOnly, true);
  assert.equal(acceptanceEnabled(), false);
  const { session } = await native(t, f);
  assert.ok(session.getActiveToolNames().includes('read'));
  assert.ok(names.every(name => !session.getActiveToolNames().includes(name)));
  assert.ok(session.getAllTools().filter(tool => names.includes(tool.name)).every(tool => tool.exposure === 'hidden'));
  setEnabled(true);
  assert.ok(names.every(name => session.getActiveToolNames().includes(name)));
  assert.ok(session.getAllTools().filter(tool => names.includes(tool.name)).every(tool => tool.exposure === 'model-only'));
  setEnabled(false);
  assert.ok(names.every(name => !session.getActiveToolNames().includes(name)));
  assert.ok(session.getActiveToolNames().includes('read'));
  assert.throws(() => updatePluginSettings(acceptancePlugin.manifest, 'project', f.cwd, { enabled: true }, []), /Invalid setting/);
  writeFileSync(f.pluginSettingsPath, 'malformed'); await session.reload();
  assert.equal(acceptanceEnabled(), false); assert.ok(names.every(name => !session.getActiveToolNames().includes(name)));
});
test('disabled startup retains only selected child grants; live enable never widens restricted or extension-free loadouts', async (t) => {
  const f = fixture(t, { enabled: false });
  const allowed = await native(t, f, { selectors: ['ext:*'] });
  assert.deepEqual([...allowed.selected].sort(), [...names].sort(), 'hidden definitions preserve permitted selector identity');
  const path = allowed.extensions.find(extension => names.every(name => extension.tools.has(name))).path;
  const denied = await native(t, f, { selectors: ['ext:*'], denied: [`ext:${path}`] });
  assert.deepEqual(denied.selected, []);
  const noExtensions = await native(t, f, { selectors: ['ext:*'], loadExtensions: false });
  assert.deepEqual(noExtensions.selected, []);
  for (const enabled of [true, false, true]) {
    setEnabled(enabled);
    assert.ok(names.every(name => allowed.session.getActiveToolNames().includes(name) === enabled));
    assert.ok(names.every(name => !denied.session.getActiveToolNames().includes(name)));
    assert.ok(names.every(name => !noExtensions.session.getActiveToolNames().includes(name)));
    assert.deepEqual(denied.session.getActiveToolNames(), ['read']);
  }
  setEnabled(false);
});
