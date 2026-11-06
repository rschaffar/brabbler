import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
import { rpcStartup } from './rpc-startup.fixture.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@': process.cwd() } });

test('BTW creation/reopen/refresh preserves a busy source and real JSONL, then moves and deletes with its family', async t => {
  const root = mkdtempSync(join(tmpdir(), 'btw-native-'));
  const cwd = join(root, 'project'), destination = join(root, 'destination'), agent = join(root, 'agent');
  for (const path of [cwd, destination, agent]) mkdirSync(path);
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const globals = ['__piSessions', '__piStartLocks', '__piSessionRelocations', '__piRecentSessionRelocations'];
  const previous = globals.map(name => globalThis[name]);
  for (const name of globals) globalThis[name] = new Map();
  process.env.PI_CODING_AGENT_DIR = agent;
  let reader, scanner;
  t.after(async () => {
    await scanner?.flushSessionScanIndexForTests();
    reader?.invalidateSessionListCache();
    for (let i = 0; i < globals.length; i++) globalThis[globals[i]] = previous[i];
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  });
  const { SessionManager } = await jiti.import('@earendil-works/pi-coding-agent');
  const { flushSessionEntries } = await jiti.import('./session-save.ts');
  reader = await jiti.import('./session-reader.ts');
  scanner = await jiti.import('./session-list-scanner.ts');
  const { ensureBtwConversation, getBtwConversation, readBtwSourceBranch } = await jiti.import('./btw-runtime.ts');
  const { appendSessionToolSelection, readSessionToolSelection } = await jiti.import('./session-tool-selection.ts');
  const { appendNativeResourceSelection, readNativeResourceSelection } = await jiti.import('./session-native-resources.ts');
  const { moveSessionFamily } = await jiti.import('./session-move.ts');
  const { GET, DELETE } = await jiti.import('../app/api/sessions/[id]/route.ts');
  const source = SessionManager.create(cwd);
  appendSessionToolSelection(source, ['read', 'bash', 'edit', 'write']);
  const native = { version: 1, codeMode: true, mcpServers: [{ scope: 'global', name: 'example' }] };
  appendNativeResourceSelection(source, native);
  source.appendMessage({ role: 'user', content: 'Explain the choices', timestamp: 1 });
  source.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Please choose an approach' }, { type: 'toolCall', id: 'pending-call', name: 'ask_user', arguments: {} }], timestamp: 2 });
  flushSessionEntries(source);
  const sourceId = source.getSessionId(), sourcePath = source.getSessionFile();
  reader.cacheSessionPath(sourceId, sourcePath); reader.invalidateSessionListCache();
  const sourceBytes = readFileSync(sourcePath, 'utf8');
  globalThis.__piSessions.set(sourceId, { inner: { sessionManager: source }, sessionId: sourceId, sessionFile: sourcePath, cwd,
    isAlive: () => true, isRunning: () => true,
    getBtwWaitingQuestion: () => ({ method: 'ask_user', id: 'live-request', question: 'A or B?', options: [{ title: 'A' }, { title: 'B' }] }) });
  const results = await Promise.all([ensureBtwConversation(sourceId), ensureBtwConversation(sourceId)]);
  const child = results[0].session;
  assert.ok(child); assert.equal(results[1].session.id, child.id, 'one creation under concurrent explicit opens');
  assert.equal(child.relation.kind, 'btw'); assert.equal(child.relation.parentSessionId, sourceId);
  assert.equal(readFileSync(sourcePath, 'utf8'), sourceBytes, 'busy source untouched');
  assert.match(results[0].snapshot.text, /A or B/); assert.equal(results[0].snapshot.text.includes('pending-call'), false);
  assert.equal(results[0].snapshot.text.includes('live-request'), false);
  const childManager = SessionManager.open(child.path);
  assert.equal(childManager.getEntries().some(entry => entry.type === 'message' && entry.message.role === 'assistant'), false, 'opening makes no model turn');
  const detail = await GET(new Request(`http://localhost/api/sessions/${child.id}`), { params: Promise.resolve({ id: child.id }) });
  const body = await detail.json(); assert.equal(detail.status, 200);
  assert.equal(body.info.relation.kind, 'btw'); assert.deepEqual(body.toolNames, ['read', 'bash', 'edit', 'write']);
  assert.deepEqual(readNativeResourceSelection(childManager.getEntries()), native);
  assert.deepEqual(body.nativeResources, native);
  assert.equal((await getBtwConversation(sourceId)).session.id, child.id);
  const beforeRefreshLeaf = childManager.getLeafId();
  const beforeRace = readFileSync(child.path, 'utf8');
  const open = SessionManager.open;
  const opening = t.mock.method(SessionManager, 'open', function (path, ...args) {
    const manager = open.call(this, path, ...args);
    if (path === child.path) globalThis.__piStartLocks.set(child.id, Promise.resolve());
    return manager;
  });
  try { await assert.rejects(ensureBtwConversation(sourceId, true), /started while context was refreshing/); }
  finally { opening.mock.restore(); globalThis.__piStartLocks.delete(child.id); }
  assert.equal(readFileSync(child.path, 'utf8'), beforeRace, 'late startup blocks a separate cold writer');
  appendSessionToolSelection(source, []);
  appendNativeResourceSelection(source, { version: 1, codeMode: false, mcpServers: [] });
  source.appendMessage({ role: 'user', content: 'New saved context', timestamp: 3 });
  const anchored = await readBtwSourceBranch(sourceId, results[0].snapshot.sourceLeafId);
  assert.equal(anchored.some(entry => entry.message?.content === 'New saved context'), false);
  assert.equal(source.getLeafId(), source.getEntries().at(-1).id, 'reading does not navigate the source');
  await assert.rejects(readBtwSourceBranch(sourceId, 'missing-anchor'), /anchor is unavailable/);
  const refreshed = await ensureBtwConversation(sourceId, true);
  assert.equal(refreshed.session.id, child.id); assert.match(refreshed.snapshot.text, /New saved context/);
  const saved = SessionManager.open(child.path).getEntries();
  assert.equal(saved.filter(entry => entry.type === 'custom' && entry.customType === 'brabbler:btw-context').length, 2, 'refresh appends snapshots');
  assert.deepEqual(readSessionToolSelection(saved), ['read', 'bash', 'edit', 'write'], 'refresh does not recopy changed source tools');
  assert.deepEqual(readNativeResourceSelection(saved), native, 'refresh does not recopy changed native intent');
  const readOnlyBytes = readFileSync(sourcePath, 'utf8');
  const liveSource = globalThis.__piSessions.get(sourceId);
  globalThis.__piSessions.delete(sourceId);
  await readBtwSourceBranch(sourceId, refreshed.snapshot.sourceLeafId);
  assert.equal(readFileSync(sourcePath, 'utf8'), readOnlyBytes, 'cold source reads do not append or navigate');
  const legacyBytes = [JSON.stringify({ type: 'session', version: 1, id: sourceId, cwd, timestamp: '2026-01-01T00:00:00Z' }),
    JSON.stringify({ type: 'message', timestamp: '2026-01-01T00:00:01Z', message: { role: 'user', content: 'Legacy source text', timestamp: 1 } })].join('\n') + '\n';
  writeFileSync(sourcePath, legacyBytes);
  reader.invalidateSessionManagerCache(sourcePath);
  try {
    const legacyError = await readBtwSourceBranch(sourceId, refreshed.snapshot.sourceLeafId).then(() => null, error => error);
    assert.equal(readFileSync(sourcePath, 'utf8'), legacyBytes, 'source inspection never migrates the saved source');
    assert.match(legacyError?.message ?? '', /explicit ordinary reopen/);
    const childBeforeLegacyRefresh = readFileSync(child.path, 'utf8');
    await assert.rejects(ensureBtwConversation(sourceId, true), /explicit ordinary reopen/);
    assert.equal(readFileSync(child.path, 'utf8'), childBeforeLegacyRefresh, 'unsupported source cannot append an unstable child reference');
  } finally { writeFileSync(sourcePath, readOnlyBytes); reader.invalidateSessionManagerCache(sourcePath); }
  globalThis.__piSessions.set(sourceId, liveSource);
  const branched = SessionManager.open(child.path);
  branched.branch(beforeRefreshLeaf);
  branched.appendMessage({ role: 'user', content: 'Continue from the first reference', timestamp: 4 });
  reader.invalidateSessionManagerCache(child.path); reader.invalidateSessionListCache();
  assert.doesNotMatch((await getBtwConversation(sourceId)).snapshot.text, /New saved context/, 'snapshot display follows the active child branch');
  await assert.rejects(moveSessionFamily(sourceId, destination), /Stop the session/);
  globalThis.__piSessions.delete(sourceId);
  const moved = await moveSessionFamily(sourceId, destination);
  assert.deepEqual(new Set(moved.movedIds), new Set([sourceId, child.id]));
  const movedChild = await reader.resolveSessionPath(child.id);
  assert.equal(reader.readSessionHeader(movedChild).cwd, destination);
  assert.equal((await getBtwConversation(sourceId)).session.id, child.id, 'ID attachment survives move');
  const response = await DELETE(new Request(`http://localhost/api/sessions/${sourceId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: sourceId }) });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(existsSync(movedChild), false, 'parent deletion includes the BTW child');
  const legacyId = SessionManager.inMemory(cwd).getSessionId(), legacyPath = join(agent, 'legacy-source.jsonl');
  const freshLegacy = legacyBytes.replace(sourceId, legacyId);
  writeFileSync(legacyPath, freshLegacy); reader.cacheSessionPath(legacyId, legacyPath);
  await assert.rejects(ensureBtwConversation(legacyId), /explicit ordinary reopen/);
  assert.equal(readFileSync(legacyPath, 'utf8'), freshLegacy, 'new BTW refuses unstable v1 anchors without rewriting its source');
  const extensionOnly = SessionManager.create(cwd);
  extensionOnly.appendMessage({ role: 'user', content: 'Extension-only source', timestamp: 1 }); flushSessionEntries(extensionOnly);
  const extensionOnlyId = extensionOnly.getSessionId();
  reader.cacheSessionPath(extensionOnlyId, extensionOnly.getSessionFile()); reader.invalidateSessionListCache();
  globalThis.__piSessions.set(extensionOnlyId, { inner: { sessionManager: extensionOnly, getActiveToolNames: () => ['codemode', 'external'] },
    isAlive: () => true, isChatOnly: () => false, getBtwWaitingQuestion: () => undefined });
  const extensionChild = await ensureBtwConversation(extensionOnlyId);
  const extensionEntries = SessionManager.open(extensionChild.session.path).getEntries();
  assert.equal(readSessionToolSelection(extensionEntries), undefined, 'extension-only is not inferred to be Chat only');
});

test('cold BTW startup restores ordinary tools, resources and additive guidance, and permits its own questions', async t => {
  const f = await rpcStartup(t, { seed(manager, { tools }) {
    manager.appendCustomEntry('brabbler:btw', { version: 1, sessionId: manager.getSessionId(), parentSessionId: 'source', sourceLeafId: null, createdAt: 'now' });
    tools.appendSessionToolSelection(manager, ['read', 'bash']);
    manager.appendCustomEntry('brabbler:native-resources', { version: 1, codeMode: true, mcpServers: [] });
  } });
  const { session } = await f.start('/synthetic/saved.jsonl');
  assert.equal(session.isChatOnly(), false);
  assert.deepEqual(session.inner.getActiveToolNames(), ['read', 'bash', 'external']);
  assert.equal(f.calls.find(call => call[0] === 'construct')[1].tools, undefined, 'no builtin-only SDK allowlist');
  const loader = f.captures[0].input.resourceLoaderOptions;
  for (const flag of ['noExtensions', 'noSkills', 'noContextFiles']) assert.notEqual(loader[flag], true);
  for (const name of ['brabbler-btw-source', 'brabbler-session-references']) assert.equal(loader.extensionFactories.some(factory => factory.name === name), true, name);
  assert.match(loader.appendSystemPrompt.join('\n'), /independent BTW/);
  assert.equal(f.nativePorts[0].input.selection.codeMode, true);
  const changed = await f.rpc.setRpcSessionTools(session.sessionId, undefined, ['read', 'edit', 'write']);
  assert.equal(changed.session, session); assert.equal(changed.recreated, false);
  assert.deepEqual(session.inner.getActiveToolNames(), ['read', 'edit', 'write', 'external']);
  const events = []; session.onEvent(event => events.push(event));
  const answer = f.owner.work(session.createExtensionUiContext().input('BTW own question'));
  const request = events.find(event => event.type === 'extension_ui_request');
  assert.ok(request);
  await session.send({ type: 'extension_ui_response', id: 'source-question-not-owned-here', value: 'must not answer' });
  assert.equal(session.getBtwWaitingQuestion().id, request.id, 'foreign response does not settle the BTW question');
  await session.send({ type: 'extension_ui_response', id: request.id, value: 'Independent reply' });
  assert.equal(await answer, 'Independent reply');
  assert.equal(session.getBtwWaitingQuestion(), undefined);
  await f.settle();
});

test('saved Chat-only BTW remains opted out, with context files but no extension/native resources', async t => {
  const f = await rpcStartup(t, { seed(manager, { tools }) {
    manager.appendCustomEntry('brabbler:btw', { version: 1, sessionId: manager.getSessionId(), parentSessionId: 'source', sourceLeafId: null, createdAt: 'now' });
    tools.appendSessionToolSelection(manager, []);
    manager.appendCustomEntry('brabbler:native-resources', { version: 1, codeMode: true, mcpServers: [] });
  } });
  const { session } = await f.start('/synthetic/saved.jsonl');
  assert.equal(session.isChatOnly(), true);
  assert.deepEqual(f.calls.find(call => call[0] === 'construct')[1].tools, []);
  const loader = f.captures[0].input.resourceLoaderOptions;
  assert.equal(loader.noExtensions, true); assert.equal(loader.noSkills, true); assert.notEqual(loader.noContextFiles, true);
  assert.equal(loader.extensionFactories.some(factory => factory.name === 'brabbler-btw-source'), false);
  assert.equal(f.nativePorts[0].input.selection.codeMode, false);
  const state = await session.send({ type: 'get_state' });
  assert.match(state.systemPrompt, /Exact context/); assert.match(state.systemPrompt, /independent BTW/);
  assert.equal(f.calls.some(call => call[0] === 'prompt'), false);
  await f.settle();
});
