import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@': process.cwd() } });
const { SessionManager } = await jiti.import('@earendil-works/pi-coding-agent');
const { executeGitOperation } = await jiti.import('../../plugins/git-workflow/server.ts');
const { gitWorkflowManifest } = await jiti.import('../../plugins/git-workflow/manifest.ts');
const { updatePluginSettings } = await jiti.import('./settings.ts');
const { snapshotOperationReview, operationReviewReference, OPERATION_REVIEW_TYPE } = await jiti.import('./review-metadata.ts');
const { snapshotOperationReceipt, OPERATION_RECEIPT_TYPE } = await jiti.import('../operation-receipts.ts');
const { cacheSessionPath } = await jiti.import('../session-reader.ts');
const { flushSessionEntries, sessionSaveBarrier } = await jiti.import('../session-save.ts');
const { allowFileRoot } = await jiti.import('../file-access.ts');
const { captureGitReview } = await jiti.import('../../plugins/git-workflow/review-reader.ts');
const { gitProjectActions } = await jiti.import('../../plugins/git-workflow/project-management.ts');
const { createFileProjectOperationStore } = await jiti.import('./project-operation-store.ts');
const sessionRoute = await jiti.import('../../app/api/sessions/[id]/reviews/[reviewId]/route.ts');
const projectRoute = await jiti.import('../../app/api/plugins/bundled/[id]/project-actions/[operationId]/reviews/[reviewId]/route.ts');
const { bundledPlugin } = await jiti.import('./registry.ts');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'review-provider-')), agent = join(root, 'agent'), repo = join(root, 'repo');
  const old = process.env.PI_CODING_AGENT_DIR, roots = globalThis.__piAdditionalAllowedRoots, cache = globalThis.__piAllowedRootsCache;
  process.env.PI_CODING_AGENT_DIR = agent; globalThis.__piAdditionalAllowedRoots = new Set(); globalThis.__piAllowedRootsCache = undefined;
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    globalThis.__piAdditionalAllowedRoots = roots; globalThis.__piAllowedRootsCache = cache; rmSync(root, { recursive: true, force: true }); });
  mkdirSync(repo); git(repo, 'init', '-qb', 'main'); git(repo, 'config', 'user.name', 'Review'); git(repo, 'config', 'user.email', 'review@example.invalid');
  writeFileSync(join(repo, 'file.txt'), 'old\nunchanged context\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  const before = git(repo, 'rev-parse', 'HEAD'); allowFileRoot(repo);
  updatePluginSettings(gitWorkflowManifest, 'global', repo, { enabled: true }, []);
  updatePluginSettings(gitWorkflowManifest, 'project', repo, { commit: 'allow', merge: 'allow', targetBranch: 'main', mergeMethod: 'non-ff' }, []);
  const manager = SessionManager.create(repo, join(agent, 'sessions', 'project'));
  let sequence = 0, latest;
  const ui = { isDirectoryInUse: () => false, reserveDirectory: () => () => {}, pluginCard: () => assert.fail('Allow must not ask'),
    async saveOperationReview(pluginId, operationId, format, payload) {
      const record = snapshotOperationReview(pluginId, operationId, format, payload);
      manager.appendCustomEntry(OPERATION_REVIEW_TYPE, record); flushSessionEntries(manager); sessionSaveBarrier(manager); return operationReviewReference(record);
    },
    operationReceipt(pluginId, receipt) {
      latest = snapshotOperationReceipt(pluginId, receipt, ++sequence); manager.appendCustomEntry(OPERATION_RECEIPT_TYPE, latest);
      flushSessionEntries(manager); sessionSaveBarrier(manager);
    } };
  const request = async (query = '', ref = latest.card.review, id = manager.getSessionId(), init = {}) => {
    cacheSessionPath(id, manager.getSessionFile());
    return sessionRoute.GET(new Request(`http://localhost/api/sessions/${id}/reviews/${ref.id}${query}`, { headers: { host: 'localhost' }, ...init }),
      { params: Promise.resolve({ id, reviewId: ref.id }) });
  };
  return { root, agent, repo, before, manager, ui, request, get latest() { return latest; } };
}
async function json(response, status = 200) { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; }
async function commit(f) {
  writeFileSync(join(f.repo, 'file.txt'), 'actual\nunchanged context\n');
  const result = await executeGitOperation(f.repo, { action: 'commit', checkout: f.repo, mode: 'files', files: ['file.txt'], message: 'exact message' }, f.ui);
  assert.notEqual(result.isError, true, result.content[0].text); return result;
}
test('real native producer → persisted SDK owner → registered session GETs; exact result, lazy context, details, copied history and no writes', async t => {
  const f = fixture(t); await commit(f);
  updatePluginSettings(gitWorkflowManifest, 'global', f.repo, { enabled: false }, []);
  const session = f.manager.getSessionFile(), saved = hash(session), index = hash(join(f.repo, '.git/index')), refs = git(f.repo, 'show-ref');
  t.mock.method(SessionManager, 'open', () => assert.fail('review GET must never open/migrate an SDK owner'));
  t.mock.method(bundledPlugin('git-workflow'), 'extension', () => assert.fail('history never enables execution'));
  const overview = await json(await f.request('?op=overview'));
  assert.equal(overview.defaultView, 'result'); assert.equal(overview.views[0].available, true); assert.equal(overview.views[0].label, 'Actual result');
  const page = await json(await f.request('?op=page&view=result&start=0')); assert.equal(page.total, 1); assert.equal(page.files[0].path, 'file.txt');
  writeFileSync(join(f.repo, 'file.txt'), 'dirty must not substitute\n');
  const preview = await json(await f.request('?op=preview&view=result&file=0')); assert.match(preview.text, /\+actual/); assert.doesNotMatch(preview.text, /dirty/);
  const context = await json(await f.request('?op=context&view=result&file=0'));
  assert.equal(context.oldFile.contents, 'old\nunchanged context\n'); assert.equal(context.newFile.contents, 'actual\nunchanged context\n');
  const download = await f.request('?op=patch&view=result'); const patch = await download.text(); assert.equal(download.status, 200); assert.equal(patch, preview.text);
  const details = await json(await f.request('?op=details')); assert.match(details.text, /exact message/);
  assert.equal(hash(session), saved); assert.equal(hash(join(f.repo, '.git/index')), index); assert.equal(git(f.repo, 'show-ref'), refs);
  assert.equal(existsSync(join(f.agent, 'brabbler/reviews')), false);
  const copiedId = randomUUID(), copy = join(f.root, 'copied.jsonl'), rows = readFileSync(session, 'utf8').split('\n');
  rows[0] = JSON.stringify({ ...JSON.parse(rows[0]), id: copiedId }); writeFileSync(copy, rows.join('\n'));
  cacheSessionPath(copiedId, copy); rmSync(session);
  // Exact copied occurrence, no original owner or live wrapper needed.
  const copied = await sessionRoute.GET(new Request('http://localhost/review?op=context&view=result&file=0', { headers: { host: 'localhost' } }),
    { params: Promise.resolve({ id: copiedId, reviewId: f.latest.card.review.id }) });
  assert.equal((await json(copied)).newFile.contents, 'actual\nunchanged context\n');
});
test('unknown owners, unsupported/pre-tree sessions and forged queries have no SDK rewrite, scan persistence or path admission', async t => {
  const f = fixture(t); await commit(f);
  const path = f.manager.getSessionFile(), rows = readFileSync(path, 'utf8').split('\n');
  t.mock.method(SessionManager, 'open', () => assert.fail('SDK migration forbidden'));
  const roots = [...globalThis.__piAdditionalAllowedRoots];
  for (const version of [1, 99]) {
    rows[0] = JSON.stringify({ ...JSON.parse(rows[0]), version }); writeFileSync(path, rows.join('\n')); const before = hash(path);
    await json(await f.request(), 404); assert.equal(hash(path), before);
  }
  rows[0] = JSON.stringify({ ...JSON.parse(rows[0]), version: 3 }); writeFileSync(path, rows.join('\n'));
  for (const query of ['?op=page&view=result&start=1', '?op=page&view=result&cwd=/secret', '?op=context&view=result&file=../file',
    '?op=preview&view=result&file=0&file=0', '?op=patch&view=HEAD', '?op=page&view=result&before=HEAD']) await json(await f.request(query), 400);
  const unknown = await sessionRoute.GET(new Request('http://localhost/review', { headers: { host: 'localhost' } }), { params: Promise.resolve({ id: randomUUID(), reviewId: randomUUID() }) });
  await json(unknown, 404); assert.deepEqual([...globalThis.__piAdditionalAllowedRoots], roots);
  assert.equal(readdirSync(join(f.agent, 'brabbler')).some(name => /scan|catalog/.test(name)), false);
});
test('invalid operation names, including prototype keys, refuse normally before provider dispatch', async t => {
  const f = fixture(t); await commit(f); let calls = 0;
  t.mock.method(bundledPlugin('git-workflow').reviewProvider, 'read', async () => { calls++; assert.fail('invalid op dispatched'); });
  for (const op of ['toString', 'constructor', '__proto__', 'unknown', '']) {
    const response = await f.request(`?op=${op}`), body = await response.json();
    assert.equal(response.status, 400, `normal selection refusal for op=${op}`);
    assert.deepEqual(body, { error: 'Invalid review selection.' });
  }
  assert.equal(calls, 0);
});
test('selected patch IDs are validated before attachment headers for session/standalone and empty comparisons', async t => {
  const f = fixture(t); await commit(f);
  const owner = randomUUID(), identity = await gitProjectActions.resolveProject(f.repo);
  createFileProjectOperationStore(() => join(f.agent, 'brabbler/project-operations')).save({ version: 1, id: owner, requestId: owner,
    pluginId: 'git-workflow', action: 'remove', project: identity.identity, anchor: f.repo, cwd: f.repo, state: 'succeeded',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), inputDigest: 'b'.repeat(64), receipt: f.latest,
    reviewMetadata: f.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === OPERATION_REVIEW_TYPE).map(entry => entry.data) });
  const standalone = query => projectRoute.GET(new Request(`http://localhost/review${query}`, { headers: { host: 'localhost' } }),
    { params: Promise.resolve({ id: 'git-workflow', operationId: owner, reviewId: f.latest.card.review.id }) });
  const refused = async response => {
    // Join even a broken implementation's rejected attachment before asserting
    // pre-header refusal. A failed body is NOT accepted as a normal JSON reply.
    const body = await response.text().then(text => ({ text }), error => ({ error }));
    assert.equal(response.status, 400, 'invalid saved file selection must refuse before attachment');
    assert.equal(response.headers.has('Content-Disposition'), false);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
    assert.equal(body.error, undefined); assert.deepEqual(JSON.parse(body.text), { error: 'Invalid saved Git review or file selection.' });
  };
  for (const request of [f.request, standalone]) {
    for (const id of [1, Number.MAX_SAFE_INTEGER]) await refused(await request(`?op=patch&view=result&file=${id}`));
    const selected = await request('?op=patch&view=result&file=0'), selectedBytes = await selected.text();
    const full = await request('?op=patch&view=result'), fullBytes = await full.text();
    assert.equal(selected.status, 200); assert.equal(full.status, 200); assert.equal(selectedBytes, fullBytes); assert.match(fullBytes, /\+actual/);
  }
  const captured = await captureGitReview(f.repo, { before: f.before, after: f.before });
  const ref = await f.ui.saveOperationReview('git-workflow', randomUUID(), 'git-operation/v1', { version: 1, kind: 'proposal',
    operation: { action: 'commit', checkout: f.repo, mode: 'staged', message: 'empty' }, fingerprint: 'a'.repeat(64), cwd: f.repo,
    nativeArgs: [], checks: [], source: { kind: 'git', captured } });
  f.ui.operationReceipt('git-workflow', { version: 1, operationId: ref.operationId, card: { title: 'Empty', operationId: ref.operationId, review: ref, actions: [] },
    phase: 'prepared', authorization: { mode: 'ask', source: 'builtin', revision: 'test', decision: 'pending' }, checks: [], effectStarted: false });
  await refused(await f.request('?op=patch&view=proposal&file=0'));
  const empty = await f.request('?op=patch&view=proposal'), bytes = await empty.text(); assert.equal(empty.status, 200); assert.equal(bytes, '');
});
test('an admitted HTTP patch errors its body if the physical repository disappears after bytes', async t => {
  const f = fixture(t); await commit(f);
  const response = await f.request('?op=patch&view=result&file=0'), reader = response.body.getReader();
  let failure;
  try {
    const first = await reader.read(); assert.ok(first.value?.length); assert.equal(response.status, 200);
    renameSync(f.repo, `${f.repo}-removed-midstream`);
    try { while (!(await reader.read()).done) { /* Drain the exact admitted stream. */ } } catch (error) { failure = error; }
  } finally { reader.releaseLock(); }
  assert.ok(failure, 'post-header loss must not close a successful partial download');
  assert.match(failure.message, /unavailable|ENOENT|No such file/i);
});
test('legacy and unknown formats preserve ownership with unavailable overview, never open bundles or admit paths', async t => {
  const f = fixture(t), operationId = randomUUID();
  const future = await f.ui.saveOperationReview('git-workflow', operationId, 'future-review/v9', { unsupported: true });
  const legacy = { version: 1, id: randomUUID(), operationId, sha256: 'a'.repeat(64), bytes: 123, entries: 1 };
  const roots = [...globalThis.__piAdditionalAllowedRoots];
  for (const ref of [future, legacy]) {
    f.ui.operationReceipt('git-workflow', { version: 1, operationId, card: { title: 'Retained outcome', operationId, review: ref, actions: [] },
      phase: 'failed', authorization: { mode: 'ask', source: 'builtin', revision: 'test', decision: 'pending' }, checks: [], effectStarted: false });
    const overview = await json(await f.request('?op=overview'));
    assert.equal(overview.views[0].available, false); assert.equal(overview.details, false);
    assert.match(overview.views[0].reason, ref.version === 1 ? /offline migration required/ : /format unavailable/);
    await json(await f.request('?op=patch&view=result'), 501);
  }
  assert.deepEqual([...globalThis.__piAdditionalAllowedRoots], roots); assert.equal(existsSync(join(f.agent, 'brabbler/reviews')), false);
});
test('missing result objects retain available proposal; denial and physical replacement never adopt saved paths/OIDs', async t => {
  const f = fixture(t); await commit(f);
  const resultOid = git(f.repo, 'rev-parse', 'HEAD');
  rmSync(join(f.repo, '.git/objects', resultOid.slice(0, 2), resultOid.slice(2)));
  const partial = await json(await f.request()); assert.equal(partial.defaultView, 'result'); assert.equal(partial.views[0].available, false); assert.equal(partial.views[1].available, true);
  await json(await f.request('?op=preview&view=result&file=0'), 409);
  assert.match((await json(await f.request('?op=preview&view=proposal&file=0'))).text, /actual/);
  globalThis.__piAdditionalAllowedRoots.clear();
  const denied = await json(await f.request()); assert.equal(denied.views.every(view => !view.available), true); assert.match(denied.views[1].reason, /denied/);
  allowFileRoot(f.repo); renameSync(f.repo, `${f.repo}-old`);
  const missing = await json(await f.request()); assert.equal(missing.views.every(view => !view.available), true); assert.match(missing.views[1].reason, /unavailable/);
  mkdirSync(f.repo); git(f.repo, 'init', '-qb', 'main');
  const replaced = await json(await f.request()); assert.equal(replaced.views.every(view => !view.available), true);
});
test('huge/binary API patch streams complete bytes, selected previews stay bounded and cancellation owns the stream', async t => {
  const f = fixture(t); writeFileSync(join(f.repo, 'huge'), 'x'.repeat(3 * 1024 * 1024) + '\n');
  writeFileSync(join(f.repo, 'binary'), Buffer.from([0, 1, 255, 0, 12])); git(f.repo, 'add', '.');
  const captured = await captureGitReview(f.repo, { before: f.before, after: git(f.repo, 'write-tree') });
  const ref = await f.ui.saveOperationReview('git-workflow', randomUUID(), 'git-operation/v1', { version: 1, kind: 'proposal',
    operation: { action: 'commit', checkout: f.repo, mode: 'staged', message: 'large' }, fingerprint: 'a'.repeat(64), cwd: f.repo, nativeArgs: [], checks: [], source: { kind: 'git', captured } });
  f.ui.operationReceipt('git-workflow', { version: 1, operationId: ref.operationId, card: { title: 'Large', operationId: ref.operationId, review: ref, actions: [] },
    phase: 'prepared', authorization: { mode: 'ask', source: 'builtin', revision: 'test', decision: 'pending' }, checks: [], effectStarted: false });
  const page = await json(await f.request('?op=page&view=proposal')), file = page.files.find(file => file.path === 'huge');
  const preview = await json(await f.request(`?op=preview&view=proposal&file=${file.id}`));
  assert.equal(preview.complete, false); assert.equal(Buffer.byteLength(preview.text), 256 * 1024);
  const response = await f.request('?op=patch&view=proposal');
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; digest.update(chunk); }
  const expected = execFileSync('git', ['-C', f.repo, 'diff', '--binary', '--full-index', '--no-renames', f.before, captured.comparison.after], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(bytes, expected.length); assert.equal(digest.digest('hex'), createHash('sha256').update(expected).digest('hex')); assert.match(expected.toString(), /GIT binary patch/);
  const cancelled = await f.request('?op=patch&view=proposal'); const reader = cancelled.body.getReader(); await reader.read(); await reader.cancel();
  assert.equal(existsSync(join(f.agent, 'brabbler/reviews')), false);
});
test('standalone real physical owner admission precedes content fallback, even for disabled history and distinct owner/receipt IDs', async t => {
  const f = fixture(t); await commit(f);
  const owner = randomUUID(), identity = await gitProjectActions.resolveProject(f.repo);
  const records = f.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === OPERATION_REVIEW_TYPE).map(entry => entry.data);
  const store = createFileProjectOperationStore(() => join(f.agent, 'brabbler/project-operations'));
  store.save({ version: 1, id: owner, requestId: owner, pluginId: 'git-workflow', action: 'remove', project: identity.identity, anchor: f.repo, cwd: f.repo,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: 'succeeded', inputDigest: 'b'.repeat(64), receipt: f.latest, reviewMetadata: records });
  updatePluginSettings(gitWorkflowManifest, 'global', f.repo, { enabled: false }, []);
  const request = () => projectRoute.GET(new Request('http://localhost/review?op=context&view=result&file=0', { headers: { host: 'localhost' } }),
    { params: Promise.resolve({ id: 'git-workflow', operationId: owner, reviewId: f.latest.card.review.id }) });
  assert.notEqual(owner, f.latest.operationId); assert.equal((await json(await request())).newFile.contents, 'actual\nunchanged context\n');
  globalThis.__piAdditionalAllowedRoots.clear(); await json(await request(), 400);
  allowFileRoot(f.repo); renameSync(f.repo, `${f.repo}-removed`); await json(await request(), 400);
});
