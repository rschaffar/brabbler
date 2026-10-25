// Real HTTP handlers; doubles are only session/file/default/native metadata ports.
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { loadBackend, next, backendCase, deferred } from './backend-ownership.fixture.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false });
const native = await jiti.import('./session-native-resources.ts');
const speed = await jiti.import('./model-speed.ts');
export async function rpcRoutes(t, { warm = false, missing = false, preflightFailure = false, serializationFailure = false } = {}) {
  const owner = backendCase(t), entered = deferred(), release = deferred(), calls = [];
  owner.release(() => release.resolve());
  const state = { model: { provider: 'effective', id: 'effective-model' }, thinkingLevel: 'medium', modelSpeed: 'fast' };
  const session = {
    isAlive: () => true, hasNativeSessionTools: () => false,
    persistInitialSession: () => calls.push(['persist']),
    async send(command) {
      calls.push(['send', command]);
      if (command.type === 'get_state') return state;
      entered.resolve(command); await release.promise;
      if (preflightFailure) throw new Error('controlled preflight refusal');
      return serializationFailure ? 1n : { acceptedResult: true };
    },
  };
  const common = {
    'next/server': next,
    '@/lib/session-reader': { resolveSessionPath: async id => { calls.push(['path', id]); return missing ? null : '/fixture/saved.jsonl'; }, invalidateSessionListCache: () => calls.push(['invalidate']) },
    '@/lib/rpc-manager': {
      getRpcSession: id => { calls.push(['get', id]); return warm ? session : undefined; },
      waitForSessionAccountSwitch: async id => calls.push(['account-switch', id]),
      startRpcSession: async (...args) => { calls.push(['start', ...args]); return { session, realSessionId: 'actual-sdk-id' }; },
    },
    '@/lib/session-native-resources': native,
  };
  const fresh = await loadBackend(new URL('../app/api/agent/new/route.ts', import.meta.url), { ...common,
    fs: { existsSync: path => { calls.push(['exists', path]); return true; } },
    crypto: { randomUUID: () => 'request-id' },
    '@earendil-works/pi-coding-agent': { getAgentDir: () => '/synthetic-agent' },
    '@/lib/file-access': { allowFileRoot: path => calls.push(['allow', path]) },
    '@/lib/model-speed': speed,
    '@/lib/project-native-resources': { projectNativeResourceSelection: () => undefined },
  });
  const existing = await loadBackend(new URL('../app/api/agent/[id]/route.ts', import.meta.url), common);
  const post = (kind, body) => {
    owner.admit();
    return owner.work((async () => {
      const request = new Request(`http://localhost/api/agent/${kind === 'new' ? 'new' : 'session'}`, { method: 'POST', body: JSON.stringify(body) });
      const response = kind === 'new' ? await fresh.POST(request) : await existing.POST(request, { params: Promise.resolve({ id: 'session' }) });
      return { status: response.status, body: await response.json() };
    })());
  };
  return { post, calls, entered, release, state, session, owner, assertNoSetters() {
    assert.equal(calls.some(([name, command]) => name === 'send' && ['set_model', 'set_thinking_level'].includes(command.type)), false);
  } };
}
