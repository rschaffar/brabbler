import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  let hold, sequence = 0, rootCalls = 0;
  const roots = async () => {
    rootCalls++;
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
  return { root, cwd, source, chapter, indexPath, history, session, open, call, rootCalls: () => rootCalls,
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
  assert.equal(names.includes('notebook_inspect'), read); assert.equal(names.includes('notebook_refresh_references'), read); assert.equal(names.includes('notebook_update_step'), edit);
  const result = await f.call('notebook_inspect', { indexPath: f.indexPath });
  if (read) f.parse(result); else assert.equal(result.isError, true);
  if (!edit) assert.equal((await f.call('notebook_update_step', { indexPath: f.indexPath, stepId: 'first', binding: { indexPath: f.indexPath, notebookId: 'guide', manifestRevision: 'a'.repeat(64), chapterPath: f.chapter, chapterRevision: 'b'.repeat(64), stepId: 'first' }, source: 'not authorized' })).isError, true);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source);
});
for (const [options, expected] of [
  [{ extensions: false, tools: ['read', 'edit'] }, []],
  [{ tools: [] }, []],
  [{ tools: ['read', 'edit'], selectors: ['ext:*'] }, ['notebook_inspect', 'notebook_refresh_references', 'notebook_update_step']],
  [{ tools: ['read'], selectors: ['ext:*'], denies: ['ext:<inline:brabbler-notebook-authoring>/notebook_update_step'] }, ['notebook_inspect', 'notebook_refresh_references']],
  [{ tools: ['read', 'edit'], selectors: ['ext:<inline:brabbler-notebook-authoring>/notebook_inspect'] }, ['notebook_inspect']],
  [{ tools: ['read', 'edit'], selectors: ['ext:*'], denies: ['ext:*'] }, []],
  [{ tools: [], selectors: ['ext:*'] }, []],
]) test(`real child selector/allowlist projection ${JSON.stringify(options)}`, async t => {
  const f = await fixture(t, options);
  assert.deepEqual(f.session.getActiveToolNames().filter(name => name.startsWith('notebook_')).sort(), expected.sort());
  assert.equal((await f.call('notebook_inspect', { indexPath: f.indexPath })).isError === true, !expected.includes('notebook_inspect'));
  const reopened = await f.open(SessionManager.inMemory(f.cwd), f.session.getActiveToolNames(), false);
  assert.deepEqual(reopened.getActiveToolNames().filter(name => name.startsWith('notebook_')).sort(), expected.sort());
  if (!expected.includes('notebook_refresh_references')) {
    const before = f.rootCalls();
    for (const target of [f.session, reopened]) assert.equal((await f.call('notebook_refresh_references', { mode: 'analyze', indexPath: f.indexPath,
      mappings: [{ cwd: f.cwd, targetIds: ['not-defined'], pairs: [{ oldOid: 'a'.repeat(40), newOid: 'b'.repeat(40) }] }] }, target)).isError, true);
    assert.equal(f.rootCalls(), before, 'denied/saved child selection cannot enter even root acquisition');
  }
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
for (const [mode, revoke] of [['analyze', 'read'], ['analyze', 'notebook_refresh_references'], ['apply', 'read'], ['apply', 'edit'], ['apply', 'notebook_refresh_references']]) test(`pending refresh ${mode} refuses live ${revoke} removal`, async t => {
  const f = await fixture(t), gate = f.holdRoots(), params = { mode, indexPath: f.indexPath,
    mappings: [{ cwd: f.cwd, targetIds: ['not-defined'], pairs: [{ oldOid: 'a'.repeat(40), newOid: 'b'.repeat(40) }] }],
    ...(mode === 'apply' ? { binding: { version: 1, digest: 'a'.repeat(64) }, acceptedTargets: ['not-defined'] } : {}) };
  const pending = f.call('notebook_refresh_references', params);
  await Promise.race([gate.entered.promise, pending.then(() => { throw new Error('Refresh settled before root gate'); })]);
  f.session.setActiveToolsByName(f.session.getActiveToolNames().filter(name => name !== revoke)); gate.release.resolve();
  const result = await pending; assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /not permitted by the current tool grants/);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source);
});
test('malformed refresh mode/analysis/apply combinations refuse before root acquisition', async t => {
  const f = await fixture(t), base = { indexPath: f.indexPath, mappings: [{ cwd: f.cwd, targetIds: ['not-defined'], pairs: [{ oldOid: 'a'.repeat(40), newOid: 'b'.repeat(40) }] }] };
  const binding = { version: 1, digest: 'a'.repeat(64) };
  for (const extra of [{ mode: 'unknown' }, { mode: 'apply' }, { mode: 'apply', binding }, { mode: 'apply', acceptedTargets: ['not-defined'] },
    { mode: 'apply', binding, acceptedTargets: [] }, { mode: 'apply', binding, acceptedTargets: ['../invalid'] },
    { mode: 'analyze', binding }, { mode: 'analyze', acceptedTargets: ['not-defined'] }]) assert.equal((await f.call('notebook_refresh_references', { ...base, ...extra })).isError, true);
  assert.equal(f.rootCalls(), 0); assert.equal(fs.readFileSync(f.chapter, 'utf8'), f.source);
});
function referenceFixture(f, second = false) {
  const git = (...args) => execFileSync('git', ['-C', f.cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('init', '-qb', 'main'); fs.writeFileSync(path.join(f.cwd, 'src.txt'), 'before\ncontext\n'); git('add', 'src.txt'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD'); fs.writeFileSync(path.join(f.cwd, 'src.txt'), 'after\ncontext\n'); git('add', 'src.txt'); git('commit', '-qm', 'old');
  const oldOid = git('rev-parse', 'HEAD'), newOid = git('commit-tree', `${oldOid}^{tree}`, '-p', base, '-m', 'rewritten'); git('update-ref', 'refs/heads/main', newOid);
  const target = { version: 1, kind: 'source', id: 'pinned', title: 'Pinned source', cwd: f.cwd, branch: 'main', oid: oldOid, path: 'src.txt', start: 1, end: 2 };
  const source = f.source.replace('Original text\n', 'Original text\n' + fence('brabbler-review', target)); fs.writeFileSync(f.chapter, source);
  const mappings = [{ cwd: f.cwd, targetIds: ['pinned'], pairs: [{ oldOid, newOid }] }], secondPath = path.join(f.cwd, 'two.md');
  if (second) {
    fs.writeFileSync(f.indexPath, fence('brabbler-notebook', { version: 1, id: 'guide', title: 'Guide', chapters: [{ id: 'one', title: 'One', path: 'one.md' }, { id: 'two', title: 'Two', path: 'two.md' }] }));
    fs.writeFileSync(secondPath, fence('brabbler-step', { version: 1, id: 'second', title: 'Second' }) + 'Keep second explanation\n' + fence('brabbler-review', { ...target, id: 'pinned2' }));
    mappings[0].targetIds.push('pinned2');
  }
  return { git, source, oldOid, newOid, mappings, secondPath };
}
for (const editable of [false, true]) test(`actual SDK reference analysis/apply requires edit=${editable}`, async t => {
  const f = await fixture(t, { defaultTools: editable ? ['read', 'edit'] : ['read'] }), { git, source, newOid, mappings } = referenceFixture(f);
  const analyzed = f.parse(await f.call('notebook_refresh_references', { mode: 'analyze', indexPath: f.indexPath, mappings }));
  assert.equal(analyzed.results[0].status, 'unchanged', JSON.stringify(analyzed.results[0])); assert.equal(analyzed.results[0].availability, 'unreachable-but-present');
  if (editable) {
    const invalid = await f.call('notebook_refresh_references', { mode: 'apply', indexPath: f.indexPath, mappings, binding: analyzed.binding, acceptedTargets: ['not-a-proposal'] });
    assert.equal(invalid.isError, true); assert.equal(fs.readFileSync(f.chapter, 'utf8'), source);
  }
  const applied = await f.call('notebook_refresh_references', { mode: 'apply', indexPath: f.indexPath, mappings, binding: analyzed.binding, acceptedTargets: ['pinned'] });
  if (editable) { assert.equal(f.parse(applied).status, 'applied'); assert.match(fs.readFileSync(f.chapter, 'utf8'), new RegExp(newOid)); }
  else { assert.equal(applied.isError, true); assert.equal(fs.readFileSync(f.chapter, 'utf8'), source); }
  assert.equal(fs.readFileSync(f.history, 'utf8'), '{malformed old history'); assert.equal(git('rev-parse', 'HEAD'), newOid);
});
test('actual SDK inventories, analyzes and applies more than one page without widening source or saved-history authority', async t => {
  const f = await fixture(t), { oldOid, newOid, mappings } = referenceFixture(f);
  const targets = Array.from({ length: 40 }, (_, i) => ({ version: 1, kind: 'source', id: `card-${i}`, title: 'Pinned source', cwd: f.cwd, branch: 'main', oid: oldOid, path: 'src.txt', start: 1, end: 2 }));
  fs.writeFileSync(f.chapter, f.source.replace('Original text\n', 'Original text\n' + targets.map(target => fence('brabbler-review', target)).join('')));
  mappings[0].targetIds = 'mapped';
  const inventory = f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath, inventory: {} }));
  assert.equal(inventory.summary.targets, 40);
  const tail = f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath, inventory: { offset: inventory.page.nextOffset, revision: inventory.revision } }));
  assert.equal(tail.targets.at(-1).targetId, 'card-39');
  const analyzed = f.parse(await f.call('notebook_refresh_references', { mode: 'analyze', indexPath: f.indexPath, mappings }));
  assert.equal(analyzed.summary.selected, 40); assert.equal(analyzed.results.length, 32); assert.equal(analyzed.page.detail, 'compact');
  const full = f.parse(await f.call('notebook_refresh_references', { mode: 'analyze', indexPath: f.indexPath, mappings, report: { offset: 39, limit: 1, detail: 'full', binding: analyzed.binding } }));
  assert.deepEqual(full.binding, analyzed.binding); assert.equal(full.results[0].proposed.oid, newOid); assert.equal(full.results[0].sourcePreview.after.text, 'after\ncontext\n');
  const applied = f.parse(await f.call('notebook_refresh_references', { mode: 'apply', indexPath: f.indexPath, mappings, binding: analyzed.binding, acceptedTargets: targets.map(target => target.id) }));
  assert.equal(applied.status, 'applied'); assert.equal(applied.completed[0].targetIds.length, 40);
  assert.doesNotMatch(fs.readFileSync(f.chapter, 'utf8'), new RegExp(oldOid)); assert.equal(fs.readFileSync(f.history, 'utf8'), '{malformed old history');
  const before = fs.readFileSync(f.chapter), roots = f.rootCalls();
  assert.equal((await f.call('notebook_refresh_references', { mode: 'apply', indexPath: f.indexPath, mappings, binding: analyzed.binding, acceptedTargets: ['card-0'], report: {} })).isError, true);
  assert.equal(f.rootCalls(), roots); assert.deepEqual(fs.readFileSync(f.chapter), before);
});
test('new inventory/report/destination schemas reject malformed fields before roots and invalid ranges before writes', async t => {
  const f = await fixture(t), { mappings, source } = referenceFixture(f), analyze = { mode: 'analyze', indexPath: f.indexPath, mappings };
  for (const inventory of [{ unknown: true }, { offset: 'invalid' }, { limit: 33 }]) assert.equal((await f.call('notebook_inspect', { indexPath: f.indexPath, inventory })).isError, true);
  assert.equal((await f.call('notebook_inspect', { indexPath: f.indexPath, stepId: 'first', inventory: {} })).isError, true);
  for (const report of [{ unknown: true }, { filter: 'guessed' }, { detail: 'guessed' }, { offset: 'invalid' }]) assert.equal((await f.call('notebook_refresh_references', { ...analyze, report })).isError, true);
  const invalid = structuredClone(mappings); invalid[0].destinations = [{ targetId: 'pinned', path: 'src.txt', unknown: true }];
  assert.equal((await f.call('notebook_refresh_references', { ...analyze, mappings: invalid })).isError, true);
  assert.equal(f.rootCalls(), 0, 'schema-invalid/contradictory inputs do not acquire roots');
  invalid[0].destinations = [{ targetId: 'pinned', start: 1 }];
  const result = await f.call('notebook_refresh_references', { ...analyze, mappings: invalid });
  assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /Invalid source destination/);
  assert.equal(fs.readFileSync(f.chapter, 'utf8'), source); assert.equal(fs.readFileSync(f.history, 'utf8'), '{malformed old history');
});
test('actual SDK source destination schema supports explicit changed renamed excerpts', async t => {
  const f = await fixture(t), { git, oldOid, mappings } = referenceFixture(f);
  git('mv', 'src.txt', 'renamed.txt'); fs.writeFileSync(path.join(f.cwd, 'renamed.txt'), 'prefix\nnew alpha\nnew beta\n'); git('add', 'renamed.txt');
  const next = git('commit-tree', git('write-tree'), '-m', 'renamed destination'); git('update-ref', 'refs/heads/main', next);
  mappings[0].pairs = [{ oldOid, newOid: next }]; mappings[0].destinations = [{ targetId: 'pinned', path: 'renamed.txt', start: 2, end: 3 }];
  const plan = f.parse(await f.call('notebook_refresh_references', { mode: 'analyze', indexPath: f.indexPath, mappings }));
  assert.equal(plan.results[0].status, 'changed'); assert.equal(plan.results[0].sourcePreview.after.text, 'new alpha\nnew beta\n');
  assert.equal(f.parse(await f.call('notebook_refresh_references', { mode: 'apply', indexPath: f.indexPath, mappings, binding: plan.binding, acceptedTargets: ['pinned'] })).status, 'applied');
  const saved = f.parse(await f.call('notebook_inspect', { indexPath: f.indexPath, stepId: 'first' })).selected.references[0];
  assert.equal(saved.path, 'renamed.txt'); assert.equal(saved.start, 2); assert.equal(saved.end, 3);
});
test('actual SDK partial refresh preserves completed/unknown results and marks the tool result as an error', async t => {
  const f = await fixture(t), { mappings, secondPath, newOid } = referenceFixture(f, true);
  const plan = f.parse(await f.call('notebook_refresh_references', { mode: 'analyze', indexPath: f.indexPath, mappings }));
  const rename = fs.renameSync, fault = t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (to === secondPath) throw new Error('Controlled lost save acknowledgement'); });
  let result;
  try { result = await f.call('notebook_refresh_references', { mode: 'apply', indexPath: f.indexPath, mappings, binding: plan.binding, acceptedTargets: ['pinned', 'pinned2'] }); }
  finally { fault.mock.restore(); }
  assert.equal(result.isError, true);
  const report = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
  assert.deepEqual(result.details, report);
  assert.equal(report.status, 'partial'); assert.equal(report.completed.length, 1); assert.equal(report.completed[0].path, f.chapter);
  assert.equal(report.failed.path, secondPath); assert.match(report.failed.outcome, /unknown/); assert.deepEqual(report.unattempted, []);
  assert.match(fs.readFileSync(secondPath, 'utf8'), new RegExp(newOid)); assert.match(fs.readFileSync(f.chapter, 'utf8'), new RegExp(newOid));
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
