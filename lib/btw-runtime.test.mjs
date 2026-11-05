import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  const { ensureBtwConversation, getBtwConversation } = await jiti.import('./btw-runtime.ts');
  const { moveSessionFamily } = await jiti.import('./session-move.ts');
  const { GET, DELETE } = await jiti.import('../app/api/sessions/[id]/route.ts');
  const source = SessionManager.create(cwd);
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
  assert.equal(body.info.relation.kind, 'btw'); assert.deepEqual(body.toolNames, []);
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
  source.appendMessage({ role: 'user', content: 'New saved context', timestamp: 3 });
  const refreshed = await ensureBtwConversation(sourceId, true);
  assert.equal(refreshed.session.id, child.id); assert.match(refreshed.snapshot.text, /New saved context/);
  const saved = SessionManager.open(child.path).getEntries();
  assert.equal(saved.filter(entry => entry.type === 'custom' && entry.customType === 'brabbler:btw-context').length, 2, 'refresh appends snapshots');
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
});

test('cold BTW startup overrides historical tool/native pins and rejects API escalation and shell execution', async t => {
  const f = await rpcStartup(t, { seed(manager, { tools }) {
    manager.appendCustomEntry('brabbler:btw', { version: 1, sessionId: manager.getSessionId(), parentSessionId: 'source', sourceLeafId: null, createdAt: 'now' });
    tools.appendSessionToolSelection(manager, ['read', 'bash']);
  } });
  const { session } = await f.start('/synthetic/saved.jsonl');
  assert.equal(session.isChatOnly(), true);
  assert.deepEqual(f.calls.find(call => call[0] === 'construct')[1].tools, []);
  const loader = f.captures[0].input.resourceLoaderOptions;
  assert.equal(loader.noExtensions, true); assert.equal(loader.noSkills, true); assert.equal(loader.noContextFiles, true);
  assert.equal(loader.extensionFactories.some(factory => factory.name === 'brabbler-session-reference'), false);
  await assert.rejects(session.send({ type: 'bash', command: 'must not execute' }), /chat-only/);
  await assert.rejects(f.rpc.setRpcSessionTools(session.sessionId, undefined, ['bash']), /chat-only/);
  await assert.rejects(f.rpc.setRpcSessionNativeResources(session.sessionId, undefined, { version: 1, codeMode: false, mcpServers: [] }), /chat-only/);
  assert.equal(f.calls.some(call => call[0] === 'prompt'), false);
  await f.settle();
});
