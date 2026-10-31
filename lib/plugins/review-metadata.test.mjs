import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { OPERATION_REVIEW_TYPE, snapshotOperationReview, readOperationReview, operationReviewReference, findOperationReview } = await jiti.import('./review-metadata.ts');
const { projectTreeForResponse, toSummaryTree, MAX_PROJECTED_TREE_DEPTH } = await jiti.import('../project-tree.ts');
const { buildSessionContext } = await jiti.import('../session-context.ts');
const treeNodes = roots => { const found = [], stack = [...roots]; while (stack.length) { const node = stack.pop(); found.push(node); stack.push(...node.children); } return found; };
const pluginId = 'git-workflow';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'brabbler-review-metadata-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessions = join(root, 'sessions'); mkdirSync(sessions);
  const manager = SessionManager.create(root, sessions);
  manager.appendMessage({ role: 'user', content: 'Review changes', timestamp: 1 });
  return { root, sessions, manager };
}
const append = (manager, record) => manager.appendCustomEntry(OPERATION_REVIEW_TYPE, record);
const receipt = (manager, reference, phase = 'prepared') => manager.appendCustomEntry('brabbler:operation-receipt', { phase, card: { review: reference } });

test('snapshot detaches complete metadata and rejects silent JSON coercion or executable objects', () => {
  const payload = { message: 'exact', selection: ['file'], checks: [{ name: 'check', command: 'true' }] };
  const record = snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', payload);
  payload.message = 'changed'; payload.selection.push('other');
  assert.equal(record.payload.message, 'exact'); assert.deepEqual(record.payload.selection, ['file']);
  assert.equal(readOperationReview(JSON.parse(JSON.stringify(record))).sha256, record.sha256);
  const corrupt = structuredClone(record); corrupt.payload.message = 'corrupt'; assert.equal(readOperationReview(corrupt), null);
  let invoked = false;
  const getter = {}; Object.defineProperty(getter, 'secret', { enumerable: true, get() { invoked = true; return 'no'; } });
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, -0, { negative: -0 }, 1n, () => {}, new Date(), { absent: undefined }, { symbol: Symbol('no') },
    { toJSON() { invoked = true; return 'no'; } }, getter, cycle, Array(2)]) {
    assert.throws(() => snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', value), /Invalid operation review metadata/);
  }
  assert.equal(invoked, false);
});

test('multi-megabyte custom record persists, reopens and copies without card-size truncation or model context', t => {
  const { root, sessions, manager } = fixture(t);
  const payload = { message: 'metadata-marker-' + 'm'.repeat(2 * 1024 * 1024),
    selection: Array.from({ length: 5000 }, (_, index) => `selected-${index}`), checks: [{ name: 'all', command: 'true' }] };
  const record = snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', payload), reference = operationReviewReference(record);
  const metadataId = append(manager, record), receiptId = receipt(manager, reference);
  const path = manager.getSessionFile(), reopened = SessionManager.open(path);
  const found = findOperationReview(reopened.getEntries(), pluginId, reference, receiptId);
  assert.equal(found.payload.message, payload.message); assert.equal(found.payload.selection.length, 5000);
  assert.equal(reopened.getEntry(receiptId).parentId, metadataId);
  assert.equal(reopened.buildSessionContext().messages.length, 1);
  assert.equal(JSON.stringify(reopened.buildSessionContext()).includes('metadata-marker-'), false);
  const branchManager = SessionManager.open(path), branchPath = branchManager.createBranchedSession(receiptId);
  const branch = SessionManager.open(branchPath);
  assert.equal(findOperationReview(branch.getEntries(), pluginId, reference, receiptId).sha256, record.sha256);
  const copyDir = join(root, 'all-branches'); mkdirSync(copyDir);
  const all = SessionManager.forkFrom(path, root, copyDir);
  assert.equal(findOperationReview(all.getEntries(), pluginId, reference, receiptId).payload.selection.length, 5000);
  assert.equal(manager.getSessionFile(), path, 'copying through separate managers leaves the original owner unchanged');
  assert.equal(manager.getLeafId(), receiptId);
  assert.ok(readFileSync(path).length > 2 * 1024 * 1024);
  assert.ok(sessions);
});

test('prepared fork cannot inherit sibling settlement, while copied terminal metadata survives original deletion', t => {
  const { root, manager } = fixture(t), operationId = randomUUID();
  const proposal = snapshotOperationReview(pluginId, operationId, 'git-operation/v1', { proposal: { before: '1'.repeat(40), after: '2'.repeat(40) } });
  const proposalRef = operationReviewReference(proposal); append(manager, proposal);
  const preparedId = receipt(manager, proposalRef), original = manager.getSessionFile();
  const forkPath = SessionManager.open(original).createBranchedSession(preparedId);
  const result = snapshotOperationReview(pluginId, operationId, 'git-operation/v1', { proposal: proposalRef, result: { before: '1'.repeat(40), after: '3'.repeat(40) } });
  const resultRef = operationReviewReference(result); append(manager, result); const terminalId = receipt(manager, resultRef, 'succeeded');
  const terminalCopyPath = SessionManager.open(original).createBranchedSession(terminalId);
  const preparedFork = SessionManager.open(forkPath);
  assert.equal(findOperationReview(preparedFork.getEntries(), pluginId, resultRef, preparedId), null);
  assert.ok(findOperationReview(manager.getEntries(), pluginId, proposalRef, preparedId));
  assert.equal(findOperationReview(manager.getEntries(), pluginId, resultRef, preparedId), null, 'physical later result is not an ancestor');
  manager.branch(preparedId); const rejectedId = receipt(manager, proposalRef, 'cancelled');
  assert.equal(findOperationReview(manager.getEntries(), pluginId, resultRef, rejectedId), null);
  const allDirectory = join(root, 'branched-copy'); mkdirSync(allDirectory);
  const allPath = SessionManager.forkFrom(original, root, allDirectory).getSessionFile();
  rmSync(original);
  const all = SessionManager.open(allPath);
  assert.equal(all.getLeafId(), rejectedId);
  assert.equal(findOperationReview(all.getEntries(), pluginId, resultRef, terminalId).sha256, result.sha256);
  assert.equal(findOperationReview(all.getEntries(), pluginId, resultRef, rejectedId), null);
  assert.equal(findOperationReview(all.getEntries(), pluginId, proposalRef, rejectedId).sha256, proposal.sha256);
  const terminalCopy = SessionManager.open(terminalCopyPath);
  assert.equal(terminalCopy.getLeafId(), terminalId);
  assert.equal(findOperationReview(terminalCopy.getEntries(), pluginId, resultRef, terminalId).sha256, result.sha256);
  assert.equal(findOperationReview(terminalCopy.getEntries(), pluginId, proposalRef, terminalId).sha256, proposal.sha256);
});

test('labels normalize copy edges without losing metadata; duplicate/conflicting IDs and ancestry cycles refuse', t => {
  const { manager } = fixture(t), userId = manager.getLeafId();
  manager.appendLabelChange(userId, 'before metadata');
  const record = snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', { message: 'kept' }), reference = operationReviewReference(record);
  const metadataId = append(manager, record), receiptId = receipt(manager, reference);
  manager.appendLabelChange(metadataId, 'proposal');
  const fork = SessionManager.open(manager.getSessionFile()); const path = fork.createBranchedSession(receiptId);
  const copied = SessionManager.open(path);
  assert.ok(findOperationReview(copied.getEntries(), pluginId, reference, receiptId));
  assert.equal(copied.getEntry(metadataId).parentId, userId, 'SDK removes label entry from copied ancestry');
  assert.equal(copied.getEntry(receiptId).parentId, metadataId);
  assert.equal(copied.getLeafId(), copied.getEntries().at(-1).id);
  assert.equal(findOperationReview(copied.getEntries(), 'other-plugin', reference, receiptId), null);
  const entries = copied.getEntries(); assert.equal(findOperationReview([...entries, entries[0]], pluginId, reference, receiptId), null);
  const cycle = structuredClone(entries); cycle.find(entry => entry.id === metadataId).parentId = receiptId;
  assert.equal(findOperationReview(cycle, pluginId, reference, receiptId), null);
  const missing = structuredClone(entries).filter(entry => entry.id !== metadataId);
  assert.equal(findOperationReview(missing, pluginId, reference, receiptId), null);
  const corrupt = structuredClone(entries); corrupt.find(entry => entry.id === metadataId).data.payload.message = 'changed';
  assert.equal(findOperationReview(corrupt, pluginId, reference, receiptId), null);
});

test('full and summary navigation projections omit hidden review bodies while retaining node identity/ancestry', t => {
  const { manager } = fixture(t), userId = manager.getLeafId();
  const record = snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', { message: 'private-metadata-marker' });
  const metadataId = append(manager, record), leftId = receipt(manager, operationReviewReference(record));
  manager.branch(metadataId); const rightId = manager.appendMessage({ role: 'user', content: 'another branch', timestamp: 2 });
  const tree = manager.getTree(), full = projectTreeForResponse(tree), summary = toSummaryTree(full);
  assert.equal(JSON.stringify(full).includes('private-metadata-marker'), false);
  assert.equal(JSON.stringify(summary).includes('private-metadata-marker'), false);
  assert.equal(full[0].entry.id, userId);
  assert.equal(full[0].children[0].entry.id, metadataId);
  const projectedMetadata = full[0].children[0];
  assert.deepEqual(projectedMetadata.children.map(node => node.entry.id), [leftId, rightId]);
  for (const node of projectedMetadata.children) assert.equal(node.entry.parentId, metadataId);
  assert.equal(projectedMetadata.entry.parentId, userId);
  assert.deepEqual(treeNodes(summary).map(node => [node.entry, node.children.map(child => child.entry.id)]),
    treeNodes(full).map(node => [{ id: node.entry.id, parentId: node.entry.parentId, type: node.entry.type, timestamp: node.entry.timestamp }, node.children.map(child => child.entry.id)]));
  for (const branchId of [leftId, rightId]) {
    const display = buildSessionContext(manager.getEntries(), branchId);
    assert.equal(JSON.stringify(display).includes('private-metadata-marker'), false);
    assert.equal(display.entryIds.includes(metadataId), false);
    assert.ok(display.entryIds.includes(userId));
  }
  assert.equal(manager.getEntry(metadataId).data.payload.message, 'private-metadata-marker', 'projection must not strip the actual SDK record');
});

test('custom-only session metadata needs the host initial-flush boundary; configured persistence alone is not a saved reference', t => {
  const { root, sessions } = fixture(t), manager = SessionManager.create(root, sessions);
  const record = snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', { message: 'not-yet-flushed' });
  append(manager, record);
  assert.equal(manager.isPersisted(), true); assert.equal(existsSync(manager.getSessionFile()), false);
  // Documents the SDK qualification. P2's host save port must flush/barrier before
  // returning a usable reference, and must not infer saving from this in-memory leaf.
  assert.ok(manager.getEntries().length);
});

test('logical review UUID conflicts refuse owner-wide without importing a sibling result', t => {
  const { manager } = fixture(t), userId = manager.getLeafId(), operationId = randomUUID(), reviewId = randomUUID();
  const one = snapshotOperationReview(pluginId, operationId, 'git-operation/v1', { value: 'one' }, reviewId);
  const two = snapshotOperationReview(pluginId, operationId, 'git-operation/v1', { value: 'two' }, reviewId);
  const reference = operationReviewReference(one);
  append(manager, one); const firstId = receipt(manager, reference);
  append(manager, two); const sameBranchId = receipt(manager, reference);
  assert.equal(findOperationReview(manager.getEntries(), pluginId, reference, sameBranchId), null);
  const baseEntries = manager.getEntries().filter(entry => entry.id !== sameBranchId && !(entry.type === 'custom' && entry.data?.sha256 === two.sha256));
  manager.branch(userId); const secondEntryId = append(manager, two); const secondId = receipt(manager, reference);
  const siblings = [...baseEntries, manager.getEntry(secondEntryId), manager.getEntry(secondId)];
  assert.equal(findOperationReview(siblings, pluginId, reference, firstId), null);
  assert.equal(findOperationReview(siblings, pluginId, reference, secondId), null);
  const identical = structuredClone(siblings); identical.find(entry => entry.id === secondEntryId).data = structuredClone(one);
  assert.equal(findOperationReview(identical, pluginId, reference, firstId).sha256, one.sha256);
  const corrupt = structuredClone(identical); corrupt.find(entry => entry.id === secondEntryId).data.payload.value = 'invalid hash';
  assert.equal(findOperationReview(corrupt, pluginId, reference, firstId), null);
});

test('metadata remains in raw ancestry across compaction and a copied/reopened selected path', t => {
  const { manager } = fixture(t);
  const record = snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', { message: 'compacted-metadata-marker' });
  const metadataId = append(manager, record), reference = operationReviewReference(record);
  receipt(manager, reference);
  const firstKeptId = manager.appendMessage({ role: 'user', content: 'keep this message', timestamp: 2 });
  manager.appendCompaction('Earlier history summarized', firstKeptId, 1000);
  const leafId = manager.appendMessage({ role: 'user', content: 'after compaction', timestamp: 3 });
  const expectedMessages = manager.buildSessionContext().messages;
  assert.equal(manager.buildContextEntries().some(entry => entry.id === metadataId), false);
  const path = SessionManager.open(manager.getSessionFile()).createBranchedSession(leafId), copied = SessionManager.open(path);
  assert.equal(copied.getLeafId(), leafId);
  assert.equal(findOperationReview(copied.getEntries(), pluginId, reference, leafId).sha256, record.sha256);
  assert.deepEqual(copied.buildSessionContext().messages, expectedMessages);
  assert.equal(JSON.stringify(buildSessionContext(copied.getEntries(), leafId)).includes('compacted-metadata-marker'), false);
});

test('linear contraction and depth flattening retain hidden metadata identities without their bodies', t => {
  const { manager } = fixture(t), userId = manager.getLeafId();
  const record = snapshotOperationReview(pluginId, randomUUID(), 'git-operation/v1', { message: 'linear-metadata-marker' });
  const metadataId = append(manager, record), receiptId = receipt(manager, operationReviewReference(record));
  const full = projectTreeForResponse(manager.getTree());
  assert.equal(full[0].entry.id, userId); assert.equal(full[0].children[0].entry.id, receiptId);
  assert.ok(full[0].children[0].compressedEntryIds.includes(metadataId));
  assert.equal(JSON.stringify(full).includes('linear-metadata-marker'), false);
  const make = (id, parentId) => ({ entry: { id, parentId, type: 'custom', customType: OPERATION_REVIEW_TYPE, timestamp: '2026-01-01T00:00:00Z', data: { marker: 'deep-metadata-marker' } }, children: [] });
  const root = make('root', null); let cursor = root;
  for (let i = 0; i < MAX_PROJECTED_TREE_DEPTH + 5; i++) {
    const next = make(`deep-${i}`, cursor.entry.id), side = make(`side-${i}`, cursor.entry.id);
    cursor.children.push(next, side); cursor = next;
  }
  const expected = new Map(treeNodes([root]).map(node => [node.entry.id, node.entry.parentId]));
  const projected = projectTreeForResponse([root]), summary = toSummaryTree(projected);
  for (const tree of [projected, summary]) {
    const nodes = treeNodes(tree);
    assert.deepEqual(new Set(nodes.map(node => node.entry.id)), new Set(expected.keys()));
    for (const node of nodes) assert.equal(node.entry.parentId, expected.get(node.entry.id));
    assert.equal(JSON.stringify(tree).includes('deep-metadata-marker'), false);
  }
});
