import { settingsFixture } from './settings.fixture.mjs';

// Supplied empty metadata limits real privacy/SSH branches; no child replacement.
export async function generalFixture(t, overrides = {}, { family = 'all', ...capabilities } = {}) {
  const f = await settingsFixture(t, capabilities), graph = await f.load(family);
  const data = {
    shell: { isWindows: false, powerShellEnabled: false },
    auth: { enabled: true },
    language: { language: 'auto' },
    title: { model: null },
    models: { modelList: [{ provider: 'one', id: 'shared:id', name: 'One' }, { provider: 'two', id: 'shared:id', name: 'Two' }] },
  };
  const props = {
    cwd: '/project', sessionId: 'session-A', initialSection: 'general',
    trustStatus: null, quoteSelectionEnabled: false, sessions: [],
    privacy: { keys: new Set(), error: false, pendingKey: null, refresh() { throw new Error('Unexpected privacy refresh'); }, setHidden() { throw new Error('Unexpected privacy write'); } },
    sshController: {},
    onClose() {}, onSessionReloaded() {}, onManageTrust() {}, onQuoteSelectionChange() {}, ...overrides,
  };
  f.route('GET', '/api/web-auth', { reply: () => ({ data: data.auth }) });
  f.route('GET', '/api/tools/settings', { reply: () => ({ data: data.shell }) });
  f.route('GET', '/api/sessions/title-language', { reply: () => ({ data: data.language }) });
  f.route('GET', '/api/sessions/title-model', { reply: () => ({ data: data.title }) });
  data.query = { cwd: '/project', sessionId: props.sessionId };
  f.route('GET', '/api/models', { query: () => data.query, reply: () => ({ data: data.models, ...(data.modelsGate ? { gate: data.modelsGate } : {}), ...(data.modelsBodyError ? { bodyError: data.modelsBodyError } : {}) }) });
  return { f, graph, props, data };
}
