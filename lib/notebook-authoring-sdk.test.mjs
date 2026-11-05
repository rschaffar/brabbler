import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
import { InMemoryCredentialStore, fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { deferred } from './testing/async.fixture.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { createNotebookAuthoringExtension } = await jiti.import('./notebook-authoring-extension.ts');
const { filterNotebookTools } = await jiti.import('./notebook-tool-policy.ts');
const { selectSubagentExtensionTools } = await jiti.import('./subagent-extension-selectors.ts');
const { withSubagentExtensionTools } = await jiti.import('./subagents.ts');
const fence = (language, data) => '```' + language + '\n' + JSON.stringify(data) + '\n```\n';

async function fixture(t, { defaultTools, tools, extensions = true, selectors, denies } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-sdk-'));
  const cwd = path.join(root, 'project'), agentDir = path.join(root, 'agent'); fs.mkdirSync(cwd); fs.mkdirSync(agentDir);
  const indexPath = path.join(cwd, 'index.md'), chapter = path.join(cwd, 'one.md');
  fs.writeFileSync(indexPath, fence('brabbler-notebook', { version: 1, id: 'guide', title: 'Guide', chapters: [{ id: 'one', title: 'One', path: 'one.md' }] }));
  const source = fence('brabbler-step', { version: 1, id: 'first', title: 'First' }) + 'Original text\n\n' + fence('brabbler-step', { version: 1, id: 'last', title: 'Last' }) + 'Unrelated bytes\n';
  fs.writeFileSync(chapter, source);
  fs.mkdirSync(path.join(cwd, 'review-data')); const history = path.join(cwd, 'review-data', 'sentinel'); fs.writeFileSync(history, '{malformed old history');
  const sessions = [], operations = [], errors = [], gates = []; let closed = false;
  t.after(async () => {
    closed = true;
    const failures = [], aborts = sessions.map(async session => session.abort());
    for (const gate of gates) gate.release.resolve();
    const settled = await Promise.allSettled([...aborts, ...operations]);
    failures.push(...settled.filter(result => result.status === 'rejected').map(result => result.reason));
    for (const session of sessions) {
      try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); } catch (error) { failures.push(error); }
      try { session.dispose(); } catch (error) { failures.push(error); }
    }
    failures.push(...errors);
    if (failures.length) throw new AggregateError(failures, `SDK fixture failed; retained ${root}`);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: path.join(agentDir, 'models-store.json'), refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider({ models: [{ id: 'notebook-fixture' }] }); runtime.registerNativeProvider(faux.provider);
  let hold, sequence = 0;
  const roots = async () => {
    const gate = hold; hold = undefined;
    if (gate) { gate.entered.resolve(); await gate.release.promise; }
    return new Set([cwd]);
  };
  async function open(manager = SessionManager.inMemory(cwd), savedTools = tools, resolveSelectors = true) {
    assert.equal(closed, false, 'SDK fixture admission closed');
    const settingsManager = SettingsManager.inMemory({ ...(defaultTools === undefined ? {} : { defaultTools }), cacheWarming: 'off', compaction: { enabled: false }, retry: { enabled: false }, enableInstallTelemetry: false });
    const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime: runtime, settingsManager, resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: extensions ? [createNotebookAuthoringExtension(roots)] : [],
    } });
    assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
    if (selectors && resolveSelectors) {
      const selected = selectSubagentExtensionTools(services.resourceLoader.getExtensions().extensions, selectors, denies);
      savedTools = filterNotebookTools(withSubagentExtensionTools(savedTools ?? [], selected));
    }
    const { session } = await createAgentSessionFromServices({ services, model: faux.getModel('notebook-fixture'), sessionManager: manager,
      ...(savedTools === undefined ? {} : { tools: savedTools }) });
    sessions.push(session);
    await session.bindExtensions({ mode: 'rpc', onError: error => errors.push(error) });
    return session;
  }
  const session = await open();
  function call(name, args, target = session) {
    assert.equal(closed, false, 'SDK fixture admission closed');
    const operation = (async () => {
      const id = `notebook-${++sequence}`;
      faux.setResponses([fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: 'toolUse' }), fauxAssistantMessage([{ type: 'text', text: 'Complete' }])]);
      await target.prompt('Perform this synthetic notebook operation.');
      const result = target.messages.findLast(message => message.role === 'toolResult' && message.toolCallId === id);
      assert.ok(result, 'actual SDK tool result, not assistant text'); return result;
    })();
    operations.push(operation); void operation.catch(() => {}); return operation;
  }
  return { root, cwd, source, chapter, indexPath, history, session, open, call,
    async close(session) { await session.abort(); await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); sessions.splice(sessions.indexOf(session), 1); },
    holdRoots() { hold = { entered: deferred(), release: deferred() }; gates.push(hold); return hold; },
    parse(result) { assert.notEqual(result.isError, true, JSON.stringify(result.content)); return JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')); },
  };
}

test('actual SDK inspect/update works without browser state, preserves neighbors/history, and reopens', async t => {
  const f = await fixture(t);
  const inspected = f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath, stepId: 'first' }));
  const result = f.parse(await f.call('notebook_update_step', { indexPath: f.indexPath, stepId: 'first', binding: inspected.selected.binding, source: inspected.selected.source.replace('Original text', 'Agent-edited text') }));
  assert.equal(result.status, 'updated'); assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source.replace('Original text', 'Agent-edited text'));
  assert.equal(fs.readFileSync(f.history, 'utf8'), '{malformed old history');
  const manager = SessionManager.create(f.cwd, path.join(f.root, 'sessions')), persisted = await f.open(manager);
  f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath }, persisted));
  const file = manager.getSessionFile(); assert.ok(fs.existsSync(file)); await f.close(persisted);
  const reopened = await f.open(SessionManager.open(file));
  assert.equal(f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath, stepId: 'first' }, reopened)).selected.source.includes('Agent-edited text'), true);
});
for (const [defaultTools, read, edit] of [
  [undefined, true, true], [['read'], true, false], [['read', 'edit'], true, true], [['read', 'write'], true, false],
  [[], false, false], [['-read'], false, false], [['-edit'], true, false],
]) test(`native default tool grants ${JSON.stringify(defaultTools)} never widen notebook authority`, async t => {
  const f = await fixture(t, { defaultTools }), names = f.session.getActiveToolNames();
  assert.equal(names.includes('notebook_inspect'), read); assert.equal(names.includes('notebook_update_step'), edit);
  const result = await f.call('notebook_inspect', { indexPath: f.indexPath });
  if (read) f.parse(result); else assert.equal(result.isError, true);
  if (!edit) assert.equal((await f.call('notebook_update_step', { indexPath: f.indexPath, stepId: 'first', binding: { indexPath: f.indexPath, notebookId: 'guide', manifestRevision: 'a'.repeat(64), chapterPath: f.chapter, chapterRevision: 'b'.repeat(64), stepId: 'first' }, source: 'not authorized' })).isError, true);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source);
});
for (const [options, expected] of [
  [{ extensions: false, tools: ['read', 'edit'] }, []],
  [{ tools: [] }, []],
  [{ tools: ['read', 'edit'], selectors: ['ext:*'] }, ['notebook_inspect', 'notebook_update_step']],
  [{ tools: ['read'], selectors: ['ext:*'], denies: ['ext:<inline:brabbler-notebook-authoring>/notebook_update_step'] }, ['notebook_inspect']],
  [{ tools: ['read', 'edit'], selectors: ['ext:<inline:brabbler-notebook-authoring>/notebook_inspect'] }, ['notebook_inspect']],
  [{ tools: ['read', 'edit'], selectors: ['ext:*'], denies: ['ext:*'] }, []],
  [{ tools: [], selectors: ['ext:*'] }, []],
]) test(`real child selector/allowlist projection ${JSON.stringify(options)}`, async t => {
  const f = await fixture(t, options);
  assert.deepEqual(f.session.getActiveToolNames().filter(name => name.startsWith('notebook_')).sort(), expected.sort());
  assert.equal((await f.call('notebook_inspect', { indexPath: f.indexPath })).isError === true, !expected.includes('notebook_inspect'));
  const reopened = await f.open(SessionManager.inMemory(f.cwd), f.session.getActiveToolNames(), false);
  assert.deepEqual(reopened.getActiveToolNames().filter(name => name.startsWith('notebook_')).sort(), expected.sort());
});
for (const revoke of ['read', 'edit', 'notebook_update_step', 'abort', 'shutdown']) test(`live ${revoke} revocation before root-provider completion prevents actual writes`, async t => {
  const f = await fixture(t), inspected = f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath, stepId: 'first' }));
  const gate = f.holdRoots(), pending = f.call('notebook_update_step', { indexPath: f.indexPath, stepId: 'first', binding: inspected.selected.binding, source: inspected.selected.source.replace('Original text', 'Forbidden write') });
  await Promise.race([gate.entered.promise, pending.then(() => { throw new Error('Tool settled before entering the owned root-provider gate'); })]);
  if (revoke === 'abort') {
    const aborted = f.session.abort(); gate.release.resolve(); await aborted;
  } else if (revoke === 'shutdown') { await f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); gate.release.resolve(); }
  else { f.session.setActiveToolsByName(f.session.getActiveToolNames().filter(name => name !== revoke)); gate.release.resolve(); }
  const result = await pending; assert.equal(result.isError, true);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source);
});
for (const revoke of ['read', 'notebook_inspect']) test(`pending inspect refuses live ${revoke} removal`, async t => {
  const f = await fixture(t), gate = f.holdRoots(), pending = f.call('notebook_inspect', { indexPath: f.indexPath });
  await Promise.race([gate.entered.promise, pending.then(() => { throw new Error('Tool settled before entering the owned root-provider gate'); })]);
  f.session.setActiveToolsByName(f.session.getActiveToolNames().filter(name => name !== revoke)); gate.release.resolve();
  assert.equal((await pending).isError, true); assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source);
});
test('authored and transcript file references cannot grant a notebook root', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.copyFileSync(f.indexPath, path.join(outside, 'index.md')); fs.copyFileSync(f.chapter, path.join(outside, 'one.md'));
  fs.appendFileSync(f.chapter, fence('brabbler-review', { version: 1, kind: 'commit', id: 'outside', title: 'External reference', cwd: outside, branch: 'main', oid: 'a'.repeat(40) }));
  f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath, stepId: 'last' }));
  f.session.sessionManager.appendMessage({ role: 'user', content: `Read [this notebook](${path.join(outside, 'index.md')}).`, timestamp: Date.now() });
  const result = await f.call('notebook_inspect', { indexPath: path.join(outside, 'index.md') });
  assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /Access denied/);
});
test('ordinary/loaded/chat-only host composition installs only the intended notebook factory', async t => {
  const { rpcStartup } = await import('./rpc-startup.fixture.mjs');
  for (const [file, toolNames, expected] of [['', undefined, true], ['saved.jsonl', ['read'], true], ['', [], false]]) await t.test(JSON.stringify([file, toolNames]), async t => {
    const r = await rpcStartup(t); await r.start(file, toolNames === undefined ? {} : { toolNames });
    const names = r.captures[0].input.resourceLoaderOptions.extensionFactories.map(factory => factory.name);
    assert.equal(names.includes('brabbler-notebook-authoring'), expected);
    const fake = { settingsManager: r.settings, getAllTools: () => ['notebook_inspect', 'notebook_update_step', 'other'].map(name => ({ name })) };
    assert.deepEqual(r.rpc.withExtensionTools(fake, ['read']), ['read', 'notebook_inspect', 'other']);
    assert.deepEqual(r.rpc.withExtensionTools(fake, []), []);
    await r.settle();
  });
});
test('cold child host startup respects saved allowlists without notebook fallback', async t => {
  const { rpcStartup } = await import('./rpc-startup.fixture.mjs');
  for (const enabled of [false, true]) for (const tools of [[], enabled ? ['read', 'notebook_inspect', 'notebook_update_step'] : ['read']]) await t.test(JSON.stringify([enabled, tools]), async t => {
    const r = await rpcStartup(t, { seed(manager) { manager.appendCustomEntry('brabbler:subagent', {
      version: 1, parentSessionId: 'parent', parentSessionPath: '/fixture/parent.jsonl',
      resourceSnapshot: { version: 1, tools, appendSystemPrompt: [], loadExtensions: enabled, loadSkills: false },
    }); } });
    await r.start('/fixture/child.jsonl');
    assert.equal(r.captures[0].input.resourceLoaderOptions.extensionFactories.some(factory => factory.name === 'brabbler-notebook-authoring'), enabled);
    assert.deepEqual(r.calls.find(([name]) => name === 'construct')[1].tools, filterNotebookTools(tools));
    await r.settle();
  });
});
test('malformed/legacy child metadata cannot acquire new notebook tools through ordinary fallback', async t => {
  const { rpcStartup } = await import('./rpc-startup.fixture.mjs');
  const r = await rpcStartup(t, { seed(manager) { manager.appendCustomEntry('brabbler:subagent', {
    version: 1, parentSessionId: 'parent', parentSessionPath: '/fixture/parent.jsonl',
    resourceSnapshot: { version: 1, tools: ['read', 'notebook_inspect'], appendSystemPrompt: [], loadExtensions: false, loadSkills: false },
  }); } });
  await r.start('/fixture/child.jsonl');
  assert.equal(r.captures[0].input.resourceLoaderOptions.extensionFactories.some(factory => factory.name === 'brabbler-notebook-authoring'), false);
  await r.settle();
});
test('fresh child controller gates the notebook factory on its explicit extension switch', async t => {
  const { subagentCreation } = await import('./subagent-creation.fixture.mjs');
  for (const enabled of [false, true]) await t.test(String(enabled), async t => {
    const r = await subagentCreation(t, { loadExtensions: enabled }), execution = await r.start();
    assert.equal(r.input().resourceLoaderOptions.extensionFactories.some(factory => factory.name === 'brabbler-notebook-authoring'), enabled);
    r.promptGate.resolve(); await execution.settled; await r.settle();
  });
});
