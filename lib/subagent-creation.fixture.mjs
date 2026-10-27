import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
import { backendCase, deferred, disposeFixtureChildren, loadBackend } from './backend-ownership.fixture.mjs';

export async function subagentCreation(t, { loadExtensions = false, loadSkills = false, promptMode = 'append', failPrompt = false, privateRoot = tmpdir(), abortChild, disposeChild } = {}) {
  const owner = backendCase(t), root = await mkdtemp(join(privateRoot, 'brabbler-child-composition-'));
  const cwd = join(root, 'project'), agentDir = join(root, 'agent');
  owner.remove(() => rm(root, { recursive: true, force: true }));
  await mkdir(cwd); await mkdir(agentDir);
  await writeFile(join(agentDir, 'settings.json'), '{}');
  const previousDir = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agentDir;
  owner.final(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  const previous = ['__piSubagentRuns', '__piSubagentQueue', '__piSubagentNotifications'].map(name => [name, globalThis[name]]);
  globalThis.__piSubagentRuns = new Map(); globalThis.__piSubagentQueue = undefined; globalThis.__piSubagentNotifications = new Map();
  owner.final(() => { for (const [name, value] of previous) globalThis[name] = value; });
  const jiti = createJiti(import.meta.url, { fsCache: false });
  const subagents = await jiti.import('./subagents.ts');
  const accounts = await jiti.import('./session-accounts.ts');
  const speed = await jiti.import('./session-model-speed.ts');
  const parentManager = sdk.SessionManager.create(cwd, join(root, 'parent-sessions'));
  accounts.appendSessionAccounts(parentManager, { synthetic: 'bound-parent-account' }); speed.appendSessionModelSpeed(parentManager, 'fast');
  const calls = [], sessions = new Map(), children = new Set(), executions = [], starts = [], admissions = new Set();
  const entered = deferred(), promptGate = deferred(); owner.release(() => promptGate.resolve());
  const streamResult = { role: 'assistant', content: [], stopReason: 'stop', timestamp: 0 };
  const stream = { result: async () => streamResult, async *[Symbol.asyncIterator]() {} };
  const model = { provider: 'synthetic', id: 'fixture', name: 'Fixture', api: 'openai-completions', reasoning: true, input: ['text'], contextWindow: 10000, maxTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, baseUrl: 'https://example.invalid' };
  const runtime = { getModel: () => undefined, getAvailable: async () => [model],
    streamSimple: (...args) => { calls.push(['simple', ...args]); return stream; }, stream: (...args) => { calls.push(['full', ...args]); return stream; } };
  const parent = { inner: { sessionManager: parentManager, modelRuntime: runtime, model, agent: { state: { thinkingLevel: 'low' } } },
    cwd, sessionFile: parentManager.getSessionFile(), isAlive: () => true, isRunning: () => false };
  sessions.set(parentManager.getSessionId(), parent);
  let input, construct, child;
  const profile = { name: 'fixture', displayName: 'Fixture', description: 'Fixture', systemPrompt: 'Exact profile', tools: ['read'],
    loadExtensions, loadSkills, promptMode, inheritContext: false, runInBackground: false, enabled: true };
  const sdkCapabilities = { ...sdk, getAgentDir: () => agentDir, initTheme() {},
    SettingsManager: { create: () => ({ getDefaultTools: () => ['read'] }) },
    SessionManager: { create(directory, _unused, options) { calls.push(['manager', directory, options]); return sdk.SessionManager.create(directory, join(root, 'child-sessions'), options); } },
    async createAgentSessionServices(options) { input = options; calls.push(['services']); return { modelRuntime: options.modelRuntime, settingsManager: options.settingsManager,
      resourceLoader: { getExtensions: () => ({ extensions: [{ path: '/fixture/probe.ts', tools: new Map(['External', 'Agent', 'bash'].map(name => [name, {}])) }] }) } }; },
    async createAgentSessionFromServices(options) {
      construct = options; calls.push(['construct']); const manager = options.sessionManager;
      child = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager,
        modelRuntime: options.services.modelRuntime, model: options.model,
        agent: { state: {}, signal: new AbortController().signal, onPayload: () => {} },
        async prompt(task, options) { calls.push(['prompt', task]); entered.resolve(options); await promptGate.promise; options.preflightResult(); if (failPrompt) throw new Error('controlled child prompt failure'); },
        getLastAssistantText: () => 'Child result',
        async abort() { calls.push(['abort', manager.getSessionId()]); await abortChild?.(this); },
        async dispose() { calls.push(['dispose', manager.getSessionId()]); await disposeChild?.(this); },
      };
      children.add(child); // Includes constructed-but-unregistered fixture inners.
      return { session: child };
    },
  };
  const { createSubagentController } = await loadBackend(new URL('./subagent-runtime.ts', import.meta.url), {
    '@earendil-works/pi-coding-agent': sdkCapabilities,
    './subagents': { ...subagents, resolveSubagentProfile: () => profile },
  }, { actual: true, globals: { console: { ...console, error: owner.unexpected('child asynchronous runtime diagnostic') } } });
  const controller = createSubagentController({
    getSession: id => sessions.get(id),
    registerSession(inner, options) {
      calls.push(['register', options]);
      assert.ok(inner.sessionFile, 'child has an SDK file identity before publication');
      const saved = readFileSync(inner.sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(saved[0].id, inner.sessionId, 'real header durable before registry publication');
      assert.equal(saved.some(entry => entry.customType === 'brabbler:subagent'), true);
      assert.deepEqual(accounts.readSessionAccounts(saved.slice(1)), { synthetic: 'bound-parent-account' });
      assert.equal(speed.readSessionModelSpeed(saved.slice(1)), 'fast');
      // Startup publication itself may use this runtime: verify the actual speed
      // view already refers to this child's agent, not a later assignment.
      const codex = { ...model, provider: 'openai-codex', api: 'openai-codex-responses' };
      owner.work(inner.modelRuntime.streamSimple(codex, { messages: [], systemPrompt: '' }, {
        sessionId: inner.sessionId, signal: inner.agent.signal, onPayload: inner.agent.onPayload,
      }).result());
      assert.equal(calls.at(-1)[0], 'full', 'child speed binding exists during registry publication');
      assert.equal(calls.at(-1)[3].serviceTier, 'priority');
      sessions.set(inner.sessionId, { inner, cwd, sessionFile: inner.sessionFile, isAlive: () => true, isRunning: () => admissions.size > 0,
        waitUntilReady: async () => {}, beginCheckoutPromptAdmission() {
          const token = {}; admissions.add(token); let released = false;
          return () => { if (!released) { released = true; admissions.delete(token); calls.push(['admission-released']); } };
        } });
    },
    reopenSession: owner.unexpected('unexpected child reopen'), resolveSessionPath: async id => sessions.get(id)?.sessionFile ?? null,
    invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
  });
  let admissionClosed = false, settling;
  const settle = () => settling ??= (async () => {
    admissionClosed = true;
    await Promise.allSettled(starts);
    const settled = await Promise.allSettled(executions.map(e => Promise.resolve().then(() => e.settled)));
    const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason);
    try { await disposeFixtureChildren(children); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Child fixture lifecycle failed');
  })();
  owner.join(settle);
  const start = () => {
    owner.admit();
    assert.equal(admissionClosed, false, 'child fixture admission is closed');
    const work = owner.work(controller.extensionRuntime.start({ parentContext: parent.inner, parentToolCallId: 'call', profile: 'fixture', task: 'Literal task', description: 'Child' }).then(execution => {
      executions.push(execution);
      assert.ok(execution.settled instanceof Promise, 'actual controller exposes complete queue settlement');
      return execution;
    }));
    starts.push(work); return work;
  };
  return { start, settle, root, controller, owner, calls, parent, parentManager, entered, promptGate, admissions, model, runtime,
    input: () => input, construct: () => construct, child: () => child,
    readChild: async () => readFile(child.sessionFile, 'utf8'), accounts, speed, subagents };
}
