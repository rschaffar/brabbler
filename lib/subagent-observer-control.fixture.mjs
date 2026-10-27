import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
import { backendCase, deferred, loadBackend } from './backend-ownership.fixture.mjs';

export async function observerControl(t) {
  const owner = backendCase(t), root = await mkdtemp(join(tmpdir(), 'brabbler-observer-control-'));
  const cwd = join(root, 'project'), agentDir = join(root, 'agent');
  owner.remove(() => rm(root, { recursive: true, force: true }));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  owner.final(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  const names = ['__piSubagentRuns', '__piSubagentQueue', '__piSubagentNotifications'];
  const previous = names.map(name => [name, globalThis[name]]);
  globalThis.__piSubagentRuns = new Map(); globalThis.__piSubagentQueue = undefined; globalThis.__piSubagentNotifications = new Map();
  owner.final(() => { for (const [name, value] of previous) globalThis[name] = value; });
  const promptEntered = deferred(), promptGate = deferred(), peerGate = deferred(), checkpoint = deferred();
  owner.release(() => promptGate.resolve()); owner.release(() => peerGate.resolve());
  const marker = new Error('observer-control: terminal invalidation after native persistence');
  const expectedError = error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === marker;
  let execution, admission, peer, observation, closing, closed = false, targetRunId;
  let injected = 0, invalidations = 0, settledCallbacks = 0, peerStarted = false, peerFinished = false;
  const admissions = new Set(), peerStates = [], ports = [];
  owner.join(() => joinWork());

  await mkdir(cwd); await mkdir(join(agentDir, 'agents'), { recursive: true });
  await writeFile(join(agentDir, 'agents', 'settings.json'), JSON.stringify({ version: 1, builtInEnabled: true, maxConcurrent: 1 }));
  const jiti = createJiti(import.meta.url, { fsCache: false });
  const types = await jiti.import('./subagents.ts');
  const { persistChildSession } = await jiti.import('./subagent-lifecycle.ts');
  const parentManager = sdk.SessionManager.create(cwd, join(root, 'parent-sessions'));
  persistChildSession(parentManager);
  const manager = sdk.SessionManager.create(cwd, join(root, 'child-sessions'));
  manager.appendCustomEntry(types.SUBAGENT_META_TYPE, {
    version: 1, parentSessionId: parentManager.getSessionId(), parentSessionPath: parentManager.getSessionFile(),
    parentToolCallId: 'seed-call', profile: 'observer-control', description: 'Seed child', task: 'Seed task',
    runInBackground: false, createdAt: '2025-01-01T00:00:00.000Z', turnLimit: 0,
    resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: ['read'], loadSkills: false, loadExtensions: false },
  });
  manager.appendCustomEntry(types.SUBAGENT_RESULT_TYPE, { version: 1, runId: 'seed-only-not-the-resumed-run', status: 'completed', completedAt: '2025-01-01T00:00:01.000Z' });
  persistChildSession(manager);
  const readNative = () => readFileSync(manager.getSessionFile(), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  function host(sessionManager, child) {
    let alive = true, disposed = false;
    const inner = { sessionId: sessionManager.getSessionId(), sessionFile: sessionManager.getSessionFile(), sessionManager,
      async prompt(task, options) {
        assert.equal(child, true); assert.equal(task, 'Controlled resumed task'); assert.equal(options.source, 'rpc');
        promptEntered.resolve(); await promptGate.promise; options.preflightResult();
      },
      getLastAssistantText: () => 'Controlled terminal result',
      async abort() {},
      dispose() { assert.equal(disposed, false, 'each owned host is disposed once'); disposed = true; alive = false; },
    };
    const wrapper = { inner, cwd, sessionFile: inner.sessionFile, isAlive: () => alive, isRunning: () => child && admissions.size > 0,
      waitUntilReady: async () => {}, onSubagentSettled() { settledCallbacks += 1; },
      beginCheckoutPromptAdmission() { const token = {}; admissions.add(token); return () => admissions.delete(token); },
    };
    ports.push(wrapper); return wrapper;
  }
  const parent = host(parentManager, false), child = host(manager, true);
  const sessions = new Map([[parent.inner.sessionId, parent], [child.inner.sessionId, child]]);
  const { createSubagentController } = await loadBackend(new URL('./subagent-runtime.ts', import.meta.url), {}, {
    actual: true, globals: { console: { ...console, error: owner.unexpected('observer control runtime diagnostic') } },
  });
  const controller = createSubagentController({
    getSession: id => sessions.get(id), registerSession: owner.unexpected('resume must not register a new session'),
    reopenSession: owner.unexpected('live native child must not reopen'), resolveSessionPath: async id => sessions.get(id)?.sessionFile ?? null,
    isBuiltInSubagentsEnabled: () => true,
    invalidateSessionList() {
      invalidations += 1;
      // Initial queued/running updates and the seeded terminal entry cannot arm
      // this fault. Only this resumed run's newly saved terminal entry qualifies.
      if (!targetRunId || injected) return;
      const memory = manager.getEntries().at(-1);
      if (memory?.customType !== types.SUBAGENT_RESULT_TYPE || memory.data?.runId !== targetRunId) return;
      let disk;
      try {
        const entries = readNative(); disk = entries.at(-1);
        assert.equal(entries[0].id, child.inner.sessionId);
        assert.equal(memory.data.status, 'completed'); assert.equal(disk.type, 'custom');
        assert.equal(disk.customType, types.SUBAGENT_RESULT_TYPE); assert.equal(disk.id, memory.id);
        assert.equal(disk.data.runId, targetRunId); assert.equal(disk.data.status, 'completed');
        assert.equal(disk.data.result, 'Controlled terminal result');
        assert.equal(settledCallbacks, 1, 'actual persisted-result callback precedes invalidation');
      } catch (error) { checkpoint.reject(error); throw error; }
      injected += 1; checkpoint.resolve(disk); throw marker;
    },
  });
  function observe() {
    if (!observation) {
      assert.ok(execution, 'an admitted execution exists');
      const raw = execution.settled;
      // Reflect only this explicitly requested observer, retaining the original
      // error object. Public completion is deliberately never joined here.
      const outcome = raw.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
      observation = { raw, outcome };
    }
    return observation;
  }
  function joinWork() {
    if (!closing) closing = (async () => {
      closed = true;
      const errors = [];
      const admissionsDone = await Promise.allSettled(admission ? [admission] : []);
      errors.push(...admissionsDone.filter(r => r.status === 'rejected').map(r => r.reason));
      // Join every accepted queue/recovery/bookkeeping tail, including the
      // independent held peer. Do not include execution.completion/publication.
      const jobs = [];
      if (execution) jobs.push(observe().outcome.then(outcome => { if (outcome.status === 'rejected' && !expectedError(outcome.reason)) throw outcome.reason; }));
      if (peer) jobs.push(peer.result, peer.bookkeeping);
      const done = await Promise.allSettled(jobs);
      errors.push(...done.filter(r => r.status === 'rejected').map(r => r.reason));
      const disposed = await Promise.allSettled(ports.map(async wrapper => { await wrapper.inner.abort(); await wrapper.inner.dispose(); }));
      errors.push(...disposed.filter(r => r.status === 'rejected').map(r => r.reason));
      if (peer && !peerFinished) errors.push(new Error('independently held peer was not drained after its actual queue joins'));
      if (admissions.size) errors.push(new Error('native host admission remained live after actual work joins'));
      if (errors.length) throw new AggregateError(errors, 'Observer control cleanup failed');
    })();
    return closing;
  }
  async function admit() {
    owner.admit(); assert.equal(closed, false); assert.equal(admission, undefined);
    admission = owner.work(controller.extensionRuntime.resume({ parentContext: parent.inner, sessionId: child.inner.sessionId,
      parentToolCallId: 'observer-call', task: 'Controlled resumed task', description: 'Observer fault control', runInBackground: false,
    }).then(result => { execution = result; targetRunId = result.run.runId; return result; }));
    await admission;
    // Use the queue created by the actual controller, not a replacement queue.
    const queue = globalThis.__piSubagentQueue;
    const queued = queue.enqueue(parent.inner.sessionId, 1, async () => {
      peerStarted = true; await peerGate.promise; peerFinished = true; return 'independent-peer-released';
    }, state => peerStates.push(state));
    peer = { result: owner.work(queued.promise), bookkeeping: owner.work(queued.settled) };
    return execution;
  }
  return { admit, observe, join: joinWork, owner, marker, controller, promptEntered: promptEntered.promise, checkpoint: checkpoint.promise,
    releasePrompt: () => promptGate.resolve(), releasePeer: () => peerGate.resolve(), readNative,
    childId: child.inner.sessionId, resultType: types.SUBAGENT_RESULT_TYPE, admissions, peerStates,
    state: () => ({ injected, invalidations, settledCallbacks, peerStarted, peerFinished }),
  };
}
