// Whole rpc-manager startup/composition with real policy, model scope, prompt
// factories, runtime-access/speed adapters and SDK in-memory SessionManagers.
// Only SDK construction, settings/catalogue/credential IO and timers are supplied.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
import { loadBackend, backendCase, deferred, disposeFixtureChildren } from './backend-ownership.fixture.mjs';

export async function rpcStartup(t, options = {}) {
  const owner = backendCase(t);
  const acceptedWork = new Set();
  const trackWork = owner.work.bind(owner);
  owner.work = promise => { const work = Promise.resolve(promise); acceptedWork.add(work); return trackWork(work); };
  const root = await mkdtemp(join(tmpdir(), 'pi-web-rpc-composition-'));
  const cwd = join(root, 'project'), agentDir = join(root, 'agent');
  owner.remove(() => rm(root, { recursive: true, force: true }));
  await mkdir(cwd); await mkdir(agentDir);
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  owner.final(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  const globalNames = ['__piSessions', '__piStartLocks', '__piStartingSessionCwds', '__piOwnedRetirements', '__piAccountSwitchLocks'];
  const previousGlobals = Object.fromEntries(globalNames.map(name => [name, globalThis[name]]));
  for (const name of globalNames) globalThis[name] = new Map();
  owner.final(() => { for (const name of globalNames) globalThis[name] = previousGlobals[name]; });
  const jiti = createJiti(import.meta.url, { fsCache: false });
  const accounts = await jiti.import('./session-accounts.ts');
  const tools = await jiti.import('./session-tool-selection.ts');
  const subagents = await jiti.import('./subagents.ts');
  const calls = [], inners = [], wrappers = new Set(), timers = new Map(), captures = [], starts = [], nativePorts = [];
  const disposedInners = new WeakSet();
  const nativeRegistryDefinitions = options.nativeRegistryDefinitions ?? new Map();
  const providerAccounts = await jiti.import('./provider-accounts.ts');
  const model = { id: 'fixture', provider: 'synthetic', name: 'Fixture', api: 'openai-completions', baseUrl: 'https://example.invalid',
    reasoning: true, input: ['text'], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const runtime = {
    getAvailable: async () => { calls.push(['models']); return [model]; },
    getModel: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
    getError: () => undefined, hasConfiguredAuth: () => true,
    streamSimple: owner.unexpected('provider simple transport'), stream: owner.unexpected('provider transport'),
    refresh: async () => ({ aborted: false, errors: new Map() }),
  };
  const settings = {
    getEnabledModels: () => options.patterns ?? ['synthetic/*:high'],
    getDefaultProvider: () => 'synthetic', getDefaultModel: () => 'fixture', getDefaultTools: () => ['read'],
    setDefaultModelAndProvider: (...args) => calls.push(['save-model', ...args]),
    setDefaultThinkingLevel: level => calls.push(['save-thinking', level]),
    flush: async () => calls.push(['settings-flushed']),
    getShellPath: () => undefined, setProjectTrusted: trusted => calls.push(['trusted', trusted]),
  };
  const managers = [];
  const manager = sdk.SessionManager.inMemory(cwd); managers.push(manager);
  manager.buildSessionContext = owner.unexpected('startup must not project the full transcript');
  options.seed?.(manager, { accounts, tools, subagents });
  const serviceEntered = deferred(), serviceGate = deferred(), bindingEntered = deferred(), bindingGate = deferred();
  const shutdownEntered = deferred(), shutdownGate = deferred();
  if (!options.holdServices) serviceGate.resolve(); if (!options.holdBinding) bindingGate.resolve(); if (!options.holdShutdown) shutdownGate.resolve();
  owner.release(() => serviceGate.resolve()); owner.release(() => bindingGate.resolve()); owner.release(() => shutdownGate.resolve());
  const listInvalidations = [], modelInvalidations = [];
  const reader = await jiti.import('./session-reader.ts');
  const rpc = await loadBackend(new URL('./rpc-manager.ts', import.meta.url), {
    '@earendil-works/pi-coding-agent': { ...sdk, getAgentDir: () => agentDir, initTheme: () => calls.push(['theme']),
      SettingsManager: { create: (directory, agent) => { assert.equal(directory, cwd); assert.equal(agent, agentDir); return settings; } },
      SessionManager: { ...sdk.SessionManager,
        open: (file) => { calls.push(['open', file]); return manager; },
        create: (directory, ...args) => { calls.push(['create', directory, ...args]); const next = managers.length === 1 && !inners.length ? manager : sdk.SessionManager.inMemory(directory); if (next !== manager) managers.push(next); return next; },
      },
      createAgentSession: owner.unexpected('retired one-step SDK constructor'),
      async createAgentSessionServices(input) {
        calls.push(['services', input]); serviceEntered.resolve(input); await serviceGate.promise;
        // This is supplied SDK discovery, not a replacement of host startup rules.
        const resourceLoader = { getAgentsFiles: () => ({ agentsFiles: [{ path: join(cwd, 'AGENTS.md'), content: 'Exact context' }] }),
          getExtensions: () => ({ extensions: [], runtime: {} }) };
        const services = { modelRuntime: input.modelRuntime ?? runtime, settingsManager: settings, resourceLoader };
        captures.push({ input, services }); return services;
      },
      async createAgentSessionFromServices(input) {
        calls.push(['construct', input]); const sm = input.sessionManager;
        let active = input.tools ?? ['read'];
        const disposed = deferred();
        const allTools = [{ name: 'read', label: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } }, promptSnippet: 'Read files', customField: 17 }, { name: 'external', description: 'Extension' }];
        const inner = { sessionId: sm.getSessionId(), sessionFile: sm.getSessionFile(), sessionManager: sm,
          modelRuntime: input.services.modelRuntime, model: input.model ?? model, thinkingLevel: input.thinkingLevel ?? 'off',
          settingsManager: settings, resourceLoader: input.services.resourceLoader,
          agent: { state: { thinkingLevel: input.thinkingLevel ?? 'off' } },
          isStreaming: false, isCompacting: false, isBashRunning: false,
          supportsThinking: () => true, getContextUsage: () => null, getSteeringMessages: () => [], getFollowUpMessages: () => [],
          getAllTools: () => allTools,
          getActiveToolNames: () => active, setActiveToolsByName: names => { calls.push(['active', names]); active = names; },
          setModel: owner.unexpected('startup setModel replay'), setThinkingLevel: owner.unexpected('startup thinking replay'),
          subscribe(listener) { calls.push(['subscribe', inner.sessionId]); inner.notify = listener; return () => calls.push(['unsubscribe', inner.sessionId]); },
          async bindExtensions(bindings) { inner.bindings = bindings; bindingEntered.resolve(bindings); await bindingGate.promise; },
          extensionRunner: {
            getToolDefinition(name) { calls.push(['tool-definition', inner.sessionId, name]); return nativeRegistryDefinitions.get(name); },
            async emit(event) { calls.push(['shutdown', event]); shutdownEntered.resolve(); await shutdownGate.promise; },
          },
          async reload() { calls.push(['reload']); if (options.reloadFailure) throw options.reloadFailure; },
          async prompt(message, promptOptions) {
            if (!options.prompt) throw new Error('Unadmitted SDK prompt capability');
            return options.prompt(message, promptOptions, inner);
          },
          abort: async () => { calls.push(['abort', inner.sessionId]); },
          dispose() {
            assert.equal(disposedInners.has(inner), false, 'fixture inner must not be disposed twice');
            disposedInners.add(inner); calls.push(['dispose', inner.sessionId]); disposed.resolve();
          }, disposed: disposed.promise,
        };
        inners.push(inner); return { session: inner };
      },
    },
    './provider-accounts': { getProjectAccounts: async () => { calls.push(['project-accounts']); return {}; }, validateAccountSelection: providerAccounts.validateAccountSelection },
    './account-model-runtime': { createAccountModelRuntime: async selection => { calls.push(['account-runtime', structuredClone(selection)]); return runtime; } },
    './native-session-tools': { createNativeSessionTools: async input => {
      calls.push(['native', input]);
      const record = { input, bindings: [], registrySessionIds: [], port: undefined };
      const port = {
        enabled: false, selection: input.selection, factories: [], retire() {}, status: () => [],
        bindToolRegistry(inspect) {
          assert.equal(typeof inspect, 'function', 'native port receives the actual registry inspection callback');
          if (record.bindings.length) throw new Error('Native registry is already bound');
          record.bindings.push(inspect);
          record.registrySessionIds = [...globalThis.__piSessions.keys()];
          calls.push(['native-bind', record]);
          // Controlled external-port fault, after recording the real constructor
          // callback. This option never enters production startup inputs.
          if (options.nativeBindFailure) throw options.nativeBindFailure;
        },
      };
      record.port = port; nativePorts.push(record); return port;
    } },
    './session-reader': { ...reader,
      readSessionHeader: () => ({ id: manager.getSessionId(), cwd: options.headerCwd ?? cwd }),
      cacheSessionPath: (...args) => calls.push(['cache-path', ...args]),
      invalidateSessionListCache: () => listInvalidations.push(true),
    },
    './models-cache': { invalidateModelsCache: () => modelInvalidations.push(true) },
    './settings-listing-runtime': { invalidateSettingsListingRuntime: () => calls.push(['listing-invalidated']) },
    './web-push': { notifySessionComplete: async id => calls.push(['push', id]) },
    './context-file-changes': { haveContextFilesChanged: () => false },
  }, { actual: true, globals: {
    setTimeout(callback, ms) { const token = { callback, ms, unref() {} }; timers.set(token, token); return token; },
    clearTimeout(token) { timers.delete(token); },
    console: { ...console, error: owner.unexpected('RPC asynchronous runtime diagnostic') },
  } });
  let admissionClosed = false, settling;
  const settle = () => settling ??= (async () => {
    admissionClosed = true;
    // Complete accepted public commands/start chains before classifying ownership.
    // The real startup locks include starts admitted through internal recreation.
    let acceptedCount, startCount;
    do {
      acceptedCount = acceptedWork.size; startCount = starts.length;
      await Promise.allSettled([...acceptedWork, ...starts, ...globalThis.__piStartLocks.values()]);
    } while (acceptedWork.size !== acceptedCount || starts.length !== startCount || globalThis.__piStartLocks.size);
    const ownedWrappers = [...new Set([...wrappers, ...globalThis.__piSessions.values()])];
    const wrapperOwnedInners = new Set(ownedWrappers.map(wrapper => wrapper.inner).filter(Boolean));
    const results = await Promise.allSettled(ownedWrappers.map(wrapper => Promise.resolve().then(() => wrapper.shutdown())));
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    const orphans = inners.filter(inner => !wrapperOwnedInners.has(inner) && !disposedInners.has(inner));
    for (const inner of orphans) calls.push(['orphan-cleanup', inner.sessionId]);
    try { await disposeFixtureChildren(orphans); } catch (error) { errors.push(error); }
    // A failed shutdown/dispose must not leave cleanup awaiting an acknowledgment
    // that can no longer arrive. Retain the root and report the specific inner.
    for (const inner of inners) if (!disposedInners.has(inner)) errors.push(new Error(`Fixture inner disposal unconfirmed: ${inner.sessionId}`));
    const disposals = await Promise.allSettled(inners.filter(inner => disposedInners.has(inner)).map(inner => inner.disposed));
    errors.push(...disposals.filter(result => result.status === 'rejected').map(result => result.reason));
    if (errors.length) throw new AggregateError(errors, 'RPC fixture lifecycle failed');
  })();
  owner.join(settle);
  const admitStart = (file = '', opts = {}) => {
    owner.admit();
    assert.equal(admissionClosed, false, 'startup fixture admission is closed');
    const work = rpc.startRpcSession(file ? 'url-alias' : `fresh-${managers.length}`, file, file ? '/ignored-url-cwd' : cwd, opts).then(result => { wrappers.add(result.session); return result; });
    starts.push(work); return work;
  };
  const start = (file = '', opts = {}) => owner.work(admitStart(file, opts));
  const startRejected = (expected, file = '', opts = {}) => owner.work(assert.rejects(admitStart(file, opts), error => error === expected));
  return { rpc, owner, root, cwd, agentDir, calls, manager, managers, model, runtime, settings, inners, captures, timers,
    serviceEntered, serviceGate, bindingEntered, bindingGate, shutdownEntered, shutdownGate, start, startRejected, settle, nativePorts, accounts, tools, subagents, listInvalidations, modelInvalidations };
}
