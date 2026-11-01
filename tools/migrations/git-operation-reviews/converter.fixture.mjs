// Registered only through the existing classified migration bridge. All inputs
// are synthetic; native effects and teardown are confined to owned temp roots.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { dryRun, operate, LOCAL_HELPERS } from './run.mjs';
import { holdRoot, sha, exclusive, assertOutputDisjoint, inventory } from './io.mjs';
import { inventoryBundles, normalize, bundle } from './codec.mjs';
import { convertSession, session, convertStandalone, capture } from './convert.mjs';
import { data, metadata, validateProjectReviewMetadata } from './target.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { legacyReviewStore } = await jiti.import('./legacy-store.ts');
const here = dirname(fileURLToPath(import.meta.url));
const time = '2026-01-01T00:00:00.000Z', oid = n => String(n).repeat(40), compact = value => JSON.parse(JSON.stringify(value));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'git-review-converter-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessions = join(root, 'sessions'), legacy = join(root, 'legacy'), operations = join(root, 'operations');
  for (const path of [sessions, legacy, operations]) fs.mkdirSync(path, { mode: 0o700 });
  const config = { sessions: [sessions], legacy, operations: null, output: join(root, 'run') };
  return { root, sessions, legacy, operations, config, store: legacyReviewStore(legacy) };
}
function native(f, format = 'sha1') {
  const repo = join(f.root, 'repo'); fs.mkdirSync(repo); git(repo, 'init', '-qb', 'main', `--object-format=${format}`);
  git(repo, 'config', 'user.name', 'Migration'); git(repo, 'config', 'user.email', 'migration@example.invalid');
  fs.writeFileSync(join(repo, 'file'), 'old\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base'); const before = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(join(repo, 'file'), 'new\n'); git(repo, 'add', '.'); const tree = git(repo, 'write-tree'); git(repo, 'commit', '-qm', 'actual'); const after = git(repo, 'rev-parse', 'HEAD');
  return { repo, before, tree, after };
}
function operation() { return { action: 'commit', checkout: '/recorded/repository', mode: 'staged', message: 'literal message' }; }
function presentation(op, operationId, checks = [], args = ['commit', '--no-gpg-sign', '--cleanup=verbatim']) {
  return { title: 'Git commit', operationId, actions: [], sections: [{ title: 'Commit message', text: op.message, code: true },
    ...(checks.length ? [{ title: 'Required checks', fields: checks.map(c => ({ label: c.name, value: c.command, code: true })) }] : []),
    { title: 'Technical details', code: true, collapsible: true, text: [JSON.stringify(op, null, 2), 'Checkout: /recorded/repository', 'Branch: main', `HEAD: ${oid(1)}`,
      'Native Git operation is unsigned and hook-free. Stronger user/repository instructions still apply.', `Candidate tree: ${oid(2)}`, `Exact message:\n${op.message}`,
      ...(checks.length ? ['Required checks (shell commands, may have side effects):', ...checks.map(c => `${c.name}: ${c.command}`), 'Checks run in the selected checkout, including its current staged/unstaged contents.'] : []),
      `Git arguments: ${JSON.stringify(args)}`].join('\n\n') }] };
}
async function oldBundle(f, options = {}) {
  const operationId = options.operationId ?? randomUUID(), op = options.operation ?? operation(), checks = options.checks ?? [], args = options.args ?? ['commit', '--no-gpg-sign', '--cleanup=verbatim'];
  const comparison = options.comparison ?? { before: oid(1), after: oid(2) };
  const meta = { operation: op, fingerprint: 'a'.repeat(64), comparison, args, checks, presentation: options.presentation ?? presentation(op, operationId, checks, args) };
  const ref = await f.store.preparePluginReview('git-workflow', operationId, async writer => {
    await writer.begin('Exact operation, checks and captured state', 'text'); await writer.write(Buffer.from(JSON.stringify(meta) + '\n')); await writer.end();
    await writer.begin('file', 'patch');
    for (let i = 0; i < (options.chunks ?? 1); i++) await writer.write(Buffer.alloc(options.chunkSize ?? 64, i % 256));
    await writer.end();
  });
  return { ref, op, meta };
}
const entry = (id, parentId, other) => ({ id, parentId, timestamp: time, ...other });
function receipt(id, parentId, ref, phase = 'prepared', extra = {}) {
  return entry(id, parentId, { type: 'custom', customType: 'brabbler:operation-receipt', data: { version: 1, pluginId: 'git-workflow', operationId: ref.operationId,
    sequence: id === 'p' ? 1 : 9, phase, toolCallId: 'C', authorization: { mode: 'allow', source: 'project', revision: 'saved', decision: 'policy-authorized' },
    checks: [], effectStarted: phase === 'succeeded', card: { title: 'Git', operationId: ref.operationId, review: ref, actions: [] }, ...extra } });
}
function call(op, parent = 'u', id = 'a') {
  const args = { ...op }; delete args.action;
  return entry(id, parent, { type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'inert', thinkingSignature: 'signed' }, { type: 'toolCall', id: 'C', name: 'git_commit', arguments: args }],
    api: 'synthetic', provider: 'synthetic', model: 'synthetic', stopReason: 'toolUse', timestamp: 1 } });
}
function report(n) {
  return { version: 1, action: 'commit', nativeOutcome: 'completed', finalization: 'completed', verification: 'verified', observedAt: time, scope: 'fixture',
    refs: { subject: { branch: 'main', before: n.before, after: n.after } }, checkouts: [],
    commit: { oid: n.after, tree: n.tree, parents: [n.before], parentCount: 1, author: { name: 'Migration', email: 'migration@example.invalid' }, signed: false, metadataTruncated: false },
    relationships: { subjectMatchesCheckout: true, expectedParent: true, candidateTreeMatches: true, newCommitUnsigned: true }, issues: [], checks: [] };
}
function result(id, parentId, ref, postflight, extras = {}) {
  return entry(id, parentId, { type: 'message', message: { role: 'toolResult', toolCallId: 'C', toolName: 'git_commit', content: [{ type: 'text', text: 'inert tool/provider bytes ' + ref.id }],
    details: { operationId: ref.operationId, action: 'commit', completed: true, effectStarted: true, checksStarted: false, effects: [], receiptPersisted: true, ...(postflight ? { postflight } : {}), ...extras }, isError: false, timestamp: 2 } });
}
function history(f, rows, filename = 'session.jsonl', header = {}) {
  const h = { type: 'session', version: 3, id: randomUUID(), cwd: '/recorded/repository', timestamp: time, ...header };
  const bytes = Buffer.from([JSON.stringify(h), ...rows.map(e => typeof e === 'string' ? e : JSON.stringify(e))].join('\n') + '\n');
  const path = join(f.sessions, filename); fs.writeFileSync(path, bytes, { mode: 0o640 }); fs.chmodSync(path, 0o640); return { bytes, path, header: h };
}
const user = () => entry('u', null, { type: 'message', message: { role: 'user', content: 'literal', timestamp: 0 } });
function decoded(f) { const root = holdRoot(f.legacy); try { return inventoryBundles(root); } finally { root.close(); } }
function payloads(output) { return session(output).entries.filter(e => e.customType === metadata.OPERATION_REVIEW_TYPE).map(e => e.data.payload); }
function options(f, plan) { return { output: f.config.output, confirm: plan.confirmation, writersStopped: true }; }
function manifest(f) { return JSON.parse(fs.readFileSync(join(f.config.output, 'manifest.json'), 'utf8')); }
async function basic(t, count = 1) {
  const f = fixture(t), old = await oldBundle(f);
  const histories = [];
  for (let i = 0; i < count; i++) histories.push(history(f, [user(), call(old.op), receipt('p', 'a', old.ref), receipt('r', 'p', old.ref, 'succeeded')], `owner-${i}.jsonl`));
  return { f, old, histories };
}
test('B01/B03/B04/B17 raw bytes, inert strings, every branch/target, SDK projection and physical last identity survive', async t => {
  const f = fixture(t), old = await oldBundle(f);
  const rows = [user(), call(old.op), receipt('p', 'a', old.ref), entry('i', 'p', { type: 'custom', customType: 'brabbler:interaction-receipt', data: { version: 1,
    request: { type: 'extension_ui_request', method: 'plugin_card', id: 'request', pluginId: 'git-workflow', title: 'Git', operationId: old.ref.operationId, review: old.ref, actions: [] }, outcome: 'aborted' } }),
    receipt('fork', 'p', old.ref), receipt('r', 'i', old.ref, 'succeeded'), result('t', 'r', old.ref),
    entry('label', 't', { type: 'label', targetId: 'r', label: 'retained' }), entry('edit', 'label', { type: 'context_edit', targetId: 'u', replacement: null }),
    entry('compact', 'edit', { type: 'compaction', firstKeptEntryId: 'p', summary: 'saved', tokensBefore: 1 }),
    entry('pause', 'compact', { type: 'custom', customType: 'pause', data: { waiting: JSON.stringify({ review: old.ref, patch: 'inert' }) } }),
    entry('last', 'fork', { type: 'branch_summary', fromId: 't', summary: 'retained branch' })];
  const h = history(f, rows); const source = fs.readFileSync(h.path, 'utf8').replaceAll('\n', '\r\n').replace('"literal"', '"litera\\u006c"');
  fs.writeFileSync(h.path, '\r\n' + source.slice(0, -2) + '\r\n \t');
  const before = sha(fs.readFileSync(h.path)), plan = await dryRun(f.config);
  assert.equal(plan.blocks, 0, JSON.stringify(plan.reasons)); assert.equal(sha(fs.readFileSync(h.path)), before);
  await operate('apply', options(f, plan)); const actual = fs.readFileSync(h.path), model = session(actual);
  assert.equal(model.entries.at(-1).id, 'last'); assert.equal(model.entries.find(e => e.id === 'pause').data.waiting, rows[10].data.waiting);
  assert.equal(payloads(actual).filter(p => p.kind === 'proposal').length, 1);
  assert.equal(payloads(actual).filter(p => p.kind === 'settlement').length, 1);
  assert.equal(model.entries.find(e => e.id === 'fork').data.card.review.id, model.entries.find(e => e.id === 'p').data.card.review.id);
  assert.notEqual(model.entries.find(e => e.id === 'r').data.card.review.id, model.entries.find(e => e.id === 'p').data.card.review.id);
  assert.equal((await operate('check', { output: f.config.output })).states.installed, 1);
  assert.equal((await operate('resume', options(f, plan))).states.installed, 1);
  const noOp = await dryRun({ ...f.config, output: join(f.root, 'no-op') }); assert.equal(noOp.classifications['already-target'], 1);
  await operate('restore', options(f, plan)); assert.equal(sha(fs.readFileSync(h.path)), before); assert.equal(fs.statSync(h.path).mode & 0o777, 0o640);
});
test('B02/B13 unsupported/corrupt sessions and ambiguous IDs stay byte-identical and explicitly blocked', async t => {
  const { f, old } = await basic(t);
  for (const version of [undefined, 1, 2, 99]) history(f, [receipt('p', null, old.ref)], `v${version}.jsonl`, { version });
  const valid = history(f, [user(), receipt('p', 'u', old.ref)], 'dupe-key.jsonl'); fs.writeFileSync(valid.path, valid.bytes.toString().replace('"phase":"prepared"', '"phase":"prepared","phase":"failed"'));
  history(f, [receipt('p', 'missing', old.ref)], 'dangling.jsonl'); history(f, [user(), user()], 'duplicate.jsonl');
  const bad = history(f, [receipt('p', null, old.ref)], 'truncated.jsonl'); fs.appendFileSync(bad.path, '{');
  const bom = history(f, [], 'bom.jsonl'); fs.writeFileSync(bom.path, Buffer.concat([Buffer.from([239,187,191]), bom.bytes]));
  const invalid = history(f, [], 'utf8.jsonl'); fs.appendFileSync(invalid.path, Buffer.from([255]));
  const before = new Map(fs.readdirSync(f.sessions).map(n => [n, sha(fs.readFileSync(join(f.sessions, n)))]));
  const plan = await dryRun(f.config); assert.equal(plan.blocks, 10);
  await assert.rejects(operate('apply', options(f, plan)), /unresolved-blocks/);
  for (const [n, hash] of before) assert.equal(sha(fs.readFileSync(join(f.sessions, n))), hash);
  await operate('apply', { ...options(f, plan), retainBlocked: true }); assert.equal((await operate('check', { output: f.config.output })).blocks, 10);
});
test('B05/B06 terminal copies are local; absent/forked/wrong/reused structured proof never enriches siblings', async t => {
  const f = fixture(t), n = native(f), old = await oldBundle(f, { comparison: { before: n.before, after: n.tree } }), bundles = decoded(f), admitted = [{ from: old.op.checkout, to: n.repo }];
  const rows = [user(), call(old.op), receipt('p', 'a', old.ref), receipt('r', 'p', old.ref, 'succeeded'), result('t', 'r', old.ref, report(n))];
  const h = history(f, rows, 'parent.jsonl');
  const child = history(f, rows, 'child.jsonl', { parentSession: h.path }); fs.rmSync(h.path);
  const converted = await convertSession(child.bytes, bundles, admitted), payload = payloads(converted.output).find(p => p.kind === 'settlement');
  assert.ok(payload.result); assert.equal(payload.resultBasis.candidateTree, n.tree); assert.equal(Object.hasOwn(payloads(converted.output)[0], 'baseline'), false);
  assert.equal(payload.result.captured.repository.bindingOrigin, 'offline-admitted');
  const truncated = await convertSession(history(f, rows.slice(0, -1), 'truncated-copy.jsonl').bytes, bundles, admitted);
  assert.equal(payloads(truncated.output).at(-1).unavailableResult.reason, 'result-unproven');
  const fork = await convertSession(history(f, [...rows, receipt('fork', 'r', old.ref)], 'forked.jsonl').bytes, bundles, admitted);
  assert.equal(payloads(fork.output).find(p => p.kind === 'settlement').result, undefined);
  for (const mutate of [r => { r[4].message.details.operationId = randomUUID(); }, r => { r[4].message.toolName = 'wrong'; }, r => { r[4].message.details.action = 'merge'; },
    r => { r[1].message.content.push(r[1].message.content[1]); }, r => { r[1].message.content[1].arguments.message = 'not exact'; }]) {
    const input = structuredClone(rows); mutate(input); await assert.rejects(convertSession(history(f, input, 'negative.jsonl').bytes, bundles, admitted));
  }
  for (const args of [{}, { checkout: old.op.checkout }, ...['checkout', 'mode', 'message'].map(key => {
    const value = { ...rows[1].message.content[1].arguments }; delete value[key]; return value;
  })]) {
    const incomplete = structuredClone(rows); incomplete[1].message.content[1].arguments = args;
    const converted = await convertSession(history(f, incomplete, 'incomplete-call.jsonl').bytes, bundles, admitted);
    assert.equal(payloads(converted.output).find(p => p.kind === 'settlement').result === undefined, true, 'missing required invocation facts cannot admit actual result');
    assert.equal(converted.plan.occurrences.at(-1).proof.reason, 'invocation-arguments-incomplete');
  }
  const filesOperation = { ...old.op, mode: 'files', files: ['file'] }, filesBundle = await oldBundle(f, { operation: filesOperation,
    comparison: { before: n.before, after: n.tree }, args: ['commit', '--no-gpg-sign', '--cleanup=verbatim', '--only'] });
  const filesRows = [user(), call(filesOperation), receipt('r', 'a', filesBundle.ref, 'succeeded'), result('t', 'r', filesBundle.ref, report(n))];
  assert.equal(payloads((await convertSession(history(f, filesRows, 'files-call.jsonl').bytes, decoded(f), admitted)).output).at(-1).result !== undefined, true);
  delete filesRows[1].message.content[1].arguments.files;
  const missingFiles = await convertSession(history(f, filesRows, 'missing-files.jsonl').bytes, decoded(f), admitted);
  assert.equal(missingFiles.plan.occurrences.at(-1).proof.reason, 'invocation-arguments-incomplete');
  assert.equal(payloads(missingFiles.output).at(-1).result, undefined);
  const wrong = structuredClone(rows); wrong[4].message.toolCallId = 'different';
  assert.equal(payloads((await convertSession(history(f, wrong, 'wrong-call.jsonl').bytes, bundles, admitted)).output).find(p => p.kind === 'settlement').result, undefined);
});
test('B07/B09 unknown flags differ from false/empty; native success/reporting failure and no admission stay honest', async t => {
  const f = fixture(t), n = native(f), old = await oldBundle(f, { comparison: { before: n.before, after: n.tree } }), bundles = decoded(f);
  const source = history(f, [user(), call(old.op), receipt('r', 'a', old.ref, 'succeeded')]);
  let settled = payloads((await convertSession(source.bytes, bundles)).output).at(-1);
  assert.equal(Object.hasOwn(settled.outcome, 'completed'), false); assert.equal(Object.hasOwn(settled.outcome, 'checksStarted'), false); assert.equal(Object.hasOwn(settled.outcome, 'effects'), false);
  const resultRow = result('t', 'r', old.ref, report(n)); resultRow.message.isError = true;
  const proven = history(f, [user(), call(old.op), receipt('r', 'a', old.ref, 'succeeded'), resultRow], 'reported-error.jsonl');
  settled = payloads((await convertSession(proven.bytes, bundles)).output).at(-1);
  assert.equal(settled.outcome.completed, true); assert.equal(settled.outcome.checksStarted, false); assert.deepEqual(compact(settled.outcome.effects), []);
  assert.equal(settled.result, undefined); assert.deepEqual(compact(settled.unavailableResult.comparison), { before: n.before, after: n.after });
  resultRow.message.details.postflight.finalization = 'failed';
  const failed = await convertSession(history(f, [user(), call(old.op), receipt('r', 'a', old.ref, 'succeeded'), resultRow], 'finalization.jsonl').bytes, bundles, [{ from: old.op.checkout, to: n.repo }]);
  assert.equal(payloads(failed.output).at(-1).result, undefined); assert.equal(payloads(failed.output).at(-1).outcome.completed, true);
  const noTerminal = history(f, [user(), call(old.op), receipt('p', 'a', old.ref), result('t', 'p', old.ref, report(n), { receiptPersisted: false })], 'no-terminal.jsonl');
  assert.deepEqual(payloads((await convertSession(noTerminal.bytes, bundles)).output).map(p => p.kind), ['proposal']);
});
test('B08 SHA-1/SHA-256 native endpoints validate without physical baseline fiction; wrong types and object contradictions block', async t => {
  for (const format of ['sha1', 'sha256']) {
    const f = fixture(t), n = native(f, format), old = await oldBundle(f, { comparison: { before: n.before, after: n.tree } }), bundles = decoded(f);
    const h = history(f, [user(), call(old.op), receipt('r', 'a', old.ref, 'succeeded'), result('t', 'r', old.ref, report(n))]);
    const admitted = [{ from: old.op.checkout, to: n.repo }], converted = await convertSession(h.bytes, bundles, admitted), payload = payloads(converted.output).at(-1);
    assert.equal(payload.result.captured.comparison.after, n.after); assert.equal(payload.result.captured.comparison.after.length, format === 'sha1' ? 40 : 64);
    assert.ok(data.resolveGitReviewSettlement(payloads(converted.output)[0], payload));
    const wrong = structuredClone(report(n)); wrong.commit.parents = [n.after];
    const inconsistent = history(f, [user(), call(old.op), receipt('r', 'a', old.ref, 'succeeded'), result('t', 'r', old.ref, wrong)], 'wrong.jsonl');
    // Semantic parent gate rejects before object admission; actual comparison absent.
    assert.equal(payloads((await convertSession(inconsistent.bytes, bundles, admitted)).output).at(-1).result, undefined);
    const wrongType = await oldBundle(f, { comparison: { before: n.tree, after: n.tree } });
    await assert.rejects(convertSession(history(f, [receipt('p', null, wrongType.ref)], 'wrong-type.jsonl').bytes, decoded(f), admitted), /endpoint-object-type/);
    fs.rmSync(join(n.repo, '.git', 'objects', n.tree.slice(0,2), n.tree.slice(2)));
    const missing = await convertSession(h.bytes, bundles, admitted); assert.equal(payloads(missing.output)[0].source.unavailable.reason, 'objects-unavailable');
  }
});
test('B08 real divergent/no-op merge and rebase migrations use exact action-local basis, not current refs', async t => {
  for (const action of ['merge', 'no-op', 'rebase']) {
    const f = fixture(t), n = native(f); git(n.repo, 'checkout', '-qb', 'feature', n.before);
    fs.writeFileSync(join(n.repo, 'feature'), 'feature\n'); git(n.repo, 'add', '.'); git(n.repo, 'commit', '-qm', 'feature');
    const feature = git(n.repo, 'rev-parse', 'HEAD'); let target = n.after, after, disposition;
    if (action === 'rebase') { git(n.repo, 'rebase', n.after); after = git(n.repo, 'rev-parse', 'HEAD'); }
    else {
      git(n.repo, 'checkout', '-q', 'main'); git(n.repo, 'merge', '--no-ff', '--no-edit', 'feature'); after = git(n.repo, 'rev-parse', 'HEAD'); disposition = 'non-fast-forward';
      if (action === 'no-op') { target = after; git(n.repo, 'merge', '--no-ff', '--no-edit', 'feature'); disposition = 'no-op'; }
    }
    const kind = action === 'rebase' ? 'rebase' : 'merge', before = git(n.repo, 'merge-base', target, feature);
    const op = { action: kind, checkout: '/recorded/repository', featureBranch: 'feature', targetBranch: 'main', ...(kind === 'merge' ? { mergeMethod: 'non-ff' } : {}) };
    const args = kind === 'merge' ? ['-c', 'branch.main.mergeOptions=', 'merge', '--no-ff', '--commit', '--no-edit', '--no-gpg-sign', feature]
      : ['rebase', '--no-autostash', '--no-update-refs', '--no-rebase-merges', '--no-gpg-sign', target];
    const operationId = randomUUID(), old = await oldBundle(f, { operationId, operation: op, comparison: { before, after: feature }, args,
      presentation: { title: 'Git', operationId, actions: [], sections: [{ title: 'Unique resource notes', text: 'retained' }] } });
    const observation = report(n); observation.action = kind;
    observation.refs = { feature: { branch: 'feature', before: feature, after: kind === 'rebase' ? after : feature }, target: { branch: 'main', before: target, after: kind === 'merge' ? after : target } };
    const parents = git(n.repo, 'show', '-s', '--format=%P', after).split(' ');
    observation.commit = { ...observation.commit, oid: after, tree: git(n.repo, 'rev-parse', `${after}^{tree}`), parents, parentCount: parents.length };
    observation.relationships = { featureUnchanged: true, targetMatchesCheckout: true, featureIntegrated: true, targetHistoryRetained: true, expectedIntegrationShape: true,
      featureTreeMatchesResult: false, targetUnchanged: true, featureMatchesCheckout: true, targetIntegrated: true };
    if (disposition) observation.disposition = disposition;
    const invocation = call(op), toolResult = result('t', 'r', old.ref, observation); invocation.message.content[1].name = `git_${kind}`;
    toolResult.message.toolName = `git_${kind}`; toolResult.message.details.action = kind;
    const input = history(f, [user(), invocation, receipt('p', 'a', old.ref), receipt('r', 'p', old.ref, 'succeeded'), toolResult]);
    const output = await convertSession(input.bytes, decoded(f), [{ from: op.checkout, to: n.repo }]);
    const settled = payloads(output.output).at(-1); assert.ok(settled.result); assert.equal(settled.result.captured.comparison.before, target); assert.equal(settled.result.captured.comparison.after, after);
    assert.equal(settled.result.label, kind === 'rebase' ? 'Rebased feature changes' : 'Actual result');
    if (action === 'no-op') assert.equal(settled.result.captured.trees.before, settled.result.captured.trees.after);
    const admitted = [{ from: op.checkout, to: n.repo }], proposal = payloads(output.output)[0];
    const optionalRows = session(input.bytes).entries; delete optionalRows[1].message.content[1].arguments.targetBranch; delete optionalRows[1].message.content[1].arguments.mergeMethod;
    assert.equal(payloads((await convertSession(history(f, optionalRows, 'omitted-optional.jsonl').bytes, decoded(f), admitted)).output).at(-1).result !== undefined, true);
    if (action === 'merge') {
      const ffOp = { ...op, mergeMethod: 'ff-only' }, ffArgs = [...args]; ffArgs[3] = '--ff-only';
      const ffBundle = await oldBundle(f, { operation: ffOp, comparison: { before, after: feature }, args: ffArgs,
        presentation: { title: 'Git', operationId: old.ref.operationId, actions: [] }, operationId: old.ref.operationId });
      const ffCall = call(ffOp); ffCall.message.content[1].name = 'git_merge';
      const falseHistory = structuredClone(observation); falseHistory.disposition = 'fast-forward'; falseHistory.refs.target.after = feature;
      const featureParents = git(n.repo, 'show', '-s', '--format=%P', feature).split(' ');
      falseHistory.commit = { ...falseHistory.commit, oid: feature, tree: git(n.repo, 'rev-parse', `${feature}^{tree}`), parents: featureParents, parentCount: featureParents.length };
      const ffResult = result('t', 'r', ffBundle.ref, falseHistory); ffResult.message.toolName = 'git_merge'; ffResult.message.details.action = 'merge';
      const bad = history(f, [user(), ffCall, receipt('r', 'a', ffBundle.ref, 'succeeded'), ffResult], 'available-non-ancestor.jsonl');
      await assert.rejects(convertSession(bad.bytes, decoded(f), admitted), /postflight-ancestry-contradiction/, 'available target history loss is not missing-history availability');
    }
    const wrongTree = structuredClone(observation); wrongTree.commit.tree = git(n.repo, 'rev-parse', `${n.before}^{tree}`);
    await assert.rejects(capture(proposal, settled.result.captured.comparison, admitted, wrongTree), /postflight-object-contradiction/);
    const wrongBase = await oldBundle(f, { operation: op, comparison: { before: n.after, after: feature }, args,
      presentation: { title: 'Git', operationId: old.ref.operationId, actions: [] }, operationId: old.ref.operationId });
    const wrongInput = history(f, [user(), invocation, receipt('p', 'a', wrongBase.ref), receipt('r', 'p', wrongBase.ref, 'succeeded'), result('t', 'r', wrongBase.ref, observation)], 'wrong-base.jsonl');
    const wrongRows = session(wrongInput.bytes).entries; wrongRows.at(-1).message.toolName = `git_${kind}`; wrongRows.at(-1).message.details.action = kind;
    await assert.rejects(convertSession(history(f, wrongRows, 'wrong-base-action.jsonl').bytes, decoded(f), admitted), /proposal-base-contradiction/);
    for (const dependency of [feature, before]) {
      const objectPath = join(n.repo, '.git/objects', dependency.slice(0, 2), dependency.slice(2)), originalObject = fs.readFileSync(objectPath);
      fs.rmSync(objectPath);
      try {
        const missing = await convertSession(input.bytes, decoded(f), admitted), limited = payloads(missing.output).at(-1);
        assert.equal(limited.result, undefined); assert.equal(limited.outcome.completed, true);
        assert.equal(limited.unavailableResult.reason, 'objects-unavailable');
        assert.deepEqual(compact(limited.unavailableResult.comparison), { before: target, after });
        const direct = await capture(proposal, settled.result.captured.comparison, admitted, observation);
        assert.equal(direct.unavailable.reason, 'objects-unavailable', 'missing graph dependencies are not a proven negative relationship');
      } finally { fs.writeFileSync(objectPath, originalObject); }
    }
  }
});
test('B09 missing legacy bundle remains explicit and every unknown terminal links its own unavailable settlement', async t => {
  const f = fixture(t), old = await oldBundle(f), ref = { ...old.ref, id: randomUUID() };
  const h = history(f, [receipt('p', null, ref), receipt('r', 'p', ref, 'failed'), receipt('fork', 'p', ref, 'cancelled')]);
  const converted = await convertSession(h.bytes, decoded(f));
  assert.deepEqual(payloads(converted.output).map(p => p.kind), ['legacy-unavailable', 'settlement', 'settlement']);
  const noSource = receipt('r', null, old.ref, 'failed'); delete noSource.data.card.review;
  const absent = await convertSession(history(f, [noSource], 'no-source.jsonl').bytes, decoded(f));
  assert.deepEqual(payloads(absent.output).map(p => p.kind), ['legacy-unavailable', 'settlement']);
  assert.equal(absent.plan.occurrences[0].source, 'legacy-source-not-recorded');
  assert.equal(converted.plan.occurrences[0].source, 'legacy-bundle-missing');
  const entries = session(converted.output).byId; assert.notEqual(entries.get('r').data.card.review.id, entries.get('fork').data.card.review.id);
});
test('B10 known Git inline sources get linked unavailable settlements; other plugins and provider bytes are untouched', async t => {
  const f = fixture(t), ref = { operationId: randomUUID() }, row = receipt('r', null, ref, 'succeeded'); delete row.data.card.review;
  row.data.card.patch = 'diff --git a/file b/file\n+opaque'; row.data.card.patchContext = randomUUID(); row.data.card.patchBefore = 'HEAD'; row.data.card.patchAfter = 'Candidate';
  const other = structuredClone(row); other.id = 'other'; other.parentId = 'r'; other.data.pluginId = 'other-plugin';
  const h = history(f, [row, other]), converted = await convertSession(h.bytes, decoded(f));
  const model = session(converted.output); assert.equal(model.byId.get('r').data.card.patch, undefined); assert.equal(model.byId.get('r').data.card.patchBefore, 'HEAD');
  assert.equal(payloads(converted.output)[0].kind, 'legacy-unavailable'); assert.equal(payloads(converted.output)[1].kind, 'settlement');
  assert.equal(model.rowById.get('other').text, session(h.bytes).rowById.get('other').text);
});
test('B11 complete giant metadata/artifacts normalize once with a reconstruction witness; patch bytes are hash-drained', async t => {
  const f = fixture(t), op = operation(); op.message = 'start\n\nGit arguments: []\n\n' + 'x'.repeat(1100000) + '\n\nExact message:\nend';
  const checks = [{ name: 'exact', command: 'printf literal\n' + 'z'.repeat(1200000), timeoutMs: 0 }], operationId = randomUUID(), card = presentation(op, operationId, checks);
  const artifacts = Array.from({ length: 300 }, (_, i) => ({ label: `artifact-${i}`, value: `Needs one-time approval · ${i} entries · ${i} bytes · SHA256 ${'b'.repeat(64)}`, code: true }));
  card.sections.push({ title: 'Generated files and directories to remove', fields: artifacts });
  const old = await oldBundle(f, { operationId, operation: op, checks, presentation: card, chunks: 64, chunkSize: 65536 });
  const decodedBundle = decoded(f).decoded.get(old.ref.id), proposal = decodedBundle.payload;
  assert.equal(proposal.operation.message, op.message); assert.equal(sha(JSON.stringify(proposal.checks)), sha(JSON.stringify(checks))); assert.deepEqual(compact(proposal.details.sections.at(-1).fields), artifacts);
  assert.equal(JSON.stringify(proposal.details).includes(op.message.slice(-500000)), false);
  assert.equal(JSON.stringify(proposal.details).includes(checks[0].command.slice(-500000)), false);
  assert.equal(decodedBundle.witness.recipe.filter(r => r.kind === 'technical').length, 1);
  const unsupported = structuredClone(old.meta); unsupported.presentation.sections.find(s => s.title === 'Technical details').text = 'unrecognized';
  assert.throws(() => normalize(unsupported, operationId), /normalization-template/);
});
test('B12 all bundle framing/hashes/ranges and orphans are explicit; no corrupt present bundle becomes missing', async t => {
  const f = fixture(t), old = await oldBundle(f), orphan = await oldBundle(f);
  const offsets = join(f.legacy, orphan.ref.id, 'offsets'), bytes = fs.readFileSync(offsets); bytes[0] = 255; fs.writeFileSync(offsets, bytes);
  fs.mkdirSync(join(f.legacy, `.${randomUUID()}.pending`)); fs.mkdirSync(join(f.legacy, 'unexpected'));
  const source = history(f, [receipt('p', null, old.ref)]), plan = await dryRun(f.config);
  assert.equal(plan.blocks, 3); assert.equal(plan.bundles.blocked, 2); assert.equal(plan.bundles.pending, 1); assert.equal(sha(fs.readFileSync(source.path)), sha(source.bytes));
  const validRoot = holdRoot(f.legacy);
  try { const decodedOld = bundle(validRoot, old.ref.id); assert.equal(decodedOld.manifest.entries, 2); } finally { validRoot.close(); }
  // Recompute aggregate after corrupting index framing, so the framing oracle,
  // not just aggregate integrity, must detect this adversarial input.
  const entries = join(f.legacy, old.ref.id, 'entries'), rows = fs.readFileSync(entries, 'utf8').trimEnd().split('\n').map(JSON.parse); rows[1].start++;
  const index = Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + '\n'), offs = Buffer.alloc(16); offs.writeBigUInt64BE(BigInt(Buffer.byteLength(JSON.stringify(rows[0]) + '\n')), 8);
  fs.writeFileSync(entries, index); fs.writeFileSync(join(f.legacy, old.ref.id, 'offsets'), offs);
  const mf = join(f.legacy, old.ref.id, 'manifest.json'), m = JSON.parse(fs.readFileSync(mf));
  m.sha256 = sha(JSON.stringify(['data', 'entries', 'offsets'].map(n => sha(fs.readFileSync(join(f.legacy, old.ref.id, n)))))); fs.writeFileSync(mf, JSON.stringify(m));
  const root = holdRoot(f.legacy); try { assert.throws(() => bundle(root, old.ref.id), /bundle-entry-shape/); } finally { root.close(); }
});
test('B13 copied IDs across owners are valid; duplicate header IDs and conflicting target metadata are blocked', async t => {
  const { f, old } = await basic(t, 2), plan = await dryRun(f.config); assert.equal(plan.blocks, 0); assert.equal(plan.classifications.convertible, 2);
  const g = fixture(t), header = { id: randomUUID() };
  history(g, [receipt('p', null, old.ref)], 'a.jsonl', header); history(g, [receipt('p', null, old.ref)], 'b.jsonl', header);
  assert.equal((await dryRun(g.config)).reasons['ambiguous-session-header-id'], 2);
  const blocked = fixture(t), owner = { id: randomUUID() };
  history(blocked, [receipt('p', null, old.ref)], 'valid.jsonl', owner);
  history(blocked, [receipt('p', 'missing', old.ref)], 'blocked.jsonl', owner);
  const ambiguous = await dryRun(blocked.config);
  assert.equal(ambiguous.reasons['ambiguous-session-header-id'], 2, 'a blocked body cannot hide a duplicate header identity');
  assert.equal(ambiguous.classifications.convertible, undefined);
  assert.deepEqual(manifest(blocked).blocks.find(b => b.key.endsWith('blocked.jsonl')).otherReasons, ['dangling-or-forward-parent']);
});
test('B14 unequal standalone IDs, original consent/digests/timestamps/nonces and local evidence survive without rebinding', async t => {
  const f = fixture(t), old = await oldBundle(f), owner = randomUUID(), nonce = randomUUID();
  const receiptRow = receipt('r', null, old.ref, 'succeeded').data;
  delete receiptRow.pluginId; delete receiptRow.sequence; delete receiptRow.toolCallId;
  receiptRow.card.requiredAcknowledgment = 'I accept loss';
  const record = { version: 1, id: owner, requestId: owner, pluginId: 'git-workflow', action: 'remove', project: 'original-project', anchor: '/missing/owner', cwd: '/missing/owner',
    state: 'outcome-unknown', inputDigest: 'b'.repeat(64), createdAt: time, updatedAt: time, decision: 'stop', decisionAt: '2026-01-02T00:00:00.000Z',
    acknowledgment: { cardDigest: 'c'.repeat(64), label: 'I accept loss', accepted: true, acceptedAt: time }, nonce, receipt: receiptRow };
  const converted = await convertStandalone(Buffer.from(JSON.stringify(record)), owner + '.json', decoded(f), []), actual = JSON.parse(converted.output);
  assert.notEqual(owner, old.ref.operationId); assert.notEqual(old.ref.id, old.ref.operationId); assert.equal(actual.id, owner); assert.equal(actual.anchor, record.anchor);
  for (const key of ['requestId', 'inputDigest', 'decisionAt', 'acknowledgment', 'nonce', 'state', 'project']) assert.deepEqual(actual[key], record[key]);
  assert.equal(actual.reviewMetadata[1].payload.kind, 'settlement'); assert.equal(Object.hasOwn(actual.reviewMetadata[1].payload.outcome, 'completed'), false);
  validateProjectReviewMetadata(actual);
  assert.equal(sha((await convertStandalone(converted.output, owner + '.json', decoded(f))).output), sha(converted.output));
  const corruptTarget = structuredClone(actual), first = corruptTarget.reviewMetadata[0];
  corruptTarget.reviewMetadata[0] = metadata.snapshotOperationReview(first.pluginId, first.operationId, first.format, { ...first.payload, patch: 'not metadata' }, first.id);
  await assert.rejects(convertStandalone(Buffer.from(JSON.stringify(corruptTarget)), owner + '.json', decoded(f)), /invalid-target-payload/);
  const missingLink = structuredClone(actual); missingLink.reviewMetadata.shift();
  await assert.rejects(convertStandalone(Buffer.from(JSON.stringify(missingLink)), owner + '.json', decoded(f)), /invalid-target-link/);
  const negative = structuredClone(record); negative.result = { details: { operationId: owner, action: 'commit' } };
  await assert.rejects(convertStandalone(Buffer.from(JSON.stringify(negative)), owner + '.json', decoded(f)), /standalone-result-owner-mismatch/);
  fs.writeFileSync(join(f.operations, owner + '.json'), JSON.stringify(record), { mode: 0o600 }); f.config.operations = f.operations;
  const plan = await dryRun(f.config); assert.equal(plan.blocks, 0); await operate('apply', options(f, plan)); await operate('check', { output: f.config.output });
  await operate('restore', options(f, plan)); assert.deepEqual(JSON.parse(fs.readFileSync(join(f.operations, owner + '.json'))), record);
});
test('G1/B14 outer-owned real standalone receipts join local results, preserve unequal IDs and accept v2/no-receipt reruns', async t => {
  const f = fixture(t), n = native(f), op = { ...operation(), checkout: n.repo }, old = await oldBundle(f, { operation: op, comparison: { before: n.before, after: n.tree } });
  const owner = randomUUID(), savedReceipt = receipt('r', null, old.ref, 'succeeded').data;
  delete savedReceipt.pluginId; delete savedReceipt.sequence; delete savedReceipt.toolCallId;
  const record = { version: 1, id: owner, requestId: owner, pluginId: 'git-workflow', action: 'remove', project: 'saved-project', anchor: '/missing/owner', cwd: '/missing/owner',
    state: 'succeeded', inputDigest: 'b'.repeat(64), createdAt: time, updatedAt: time, receipt: savedReceipt, result: result('t', 'r', old.ref, report(n)).message };
  const admitted = [{ from: n.repo, to: n.repo }], bytes = Buffer.from(JSON.stringify(record));
  const converted = await convertStandalone(bytes, owner + '.json', decoded(f), admitted), actual = JSON.parse(converted.output), settled = actual.reviewMetadata.at(-1).payload;
  assert.notEqual(owner, savedReceipt.operationId); assert.equal(settled.result.captured.comparison.after, n.after);
  assert.deepEqual(actual.result, record.result); assert.equal(Object.hasOwn(actual.receipt, 'pluginId'), false); assert.equal(Object.hasOwn(actual.receipt, 'sequence'), false);
  assert.equal(sha((await convertStandalone(converted.output, owner + '.json', decoded(f), admitted)).output), sha(converted.output));
  for (const state of ['preparing', 'failed']) for (const pluginId of ['git-workflow', 'other-plugin']) {
    const bare = { ...record, state, pluginId }; delete bare.receipt; delete bare.result;
    const original = Buffer.from(JSON.stringify(bare));
    assert.equal(sha((await convertStandalone(original, owner + '.json', decoded(f))).output), sha(original));
  }
  const other = { ...record, pluginId: 'other-plugin' };
  assert.equal(sha((await convertStandalone(Buffer.from(JSON.stringify(other)), owner + '.json', decoded(f))).output), sha(Buffer.from(JSON.stringify(other))));
  const conflict = structuredClone(record); conflict.receipt.pluginId = 'other-plugin';
  await assert.rejects(convertStandalone(Buffer.from(JSON.stringify(conflict)), owner + '.json', decoded(f)), /standalone-plugin-owner-mismatch/);
  const malformed = { ...record, receipt: null }; await assert.rejects(convertStandalone(Buffer.from(JSON.stringify(malformed)), owner + '.json', decoded(f)));
  const wrongAction = structuredClone(record); wrongAction.result.details.action = 'merge';
  await assert.rejects(convertStandalone(Buffer.from(JSON.stringify(wrongAction)), owner + '.json', decoded(f)), /standalone-result-owner-mismatch/);
  fs.writeFileSync(join(f.operations, owner + '.json'), bytes, { mode: 0o600 }); f.config.operations = f.operations;
  f.config.repositories = [n.repo];
  const plan = await dryRun(f.config); assert.equal(plan.blocks, 0); await operate('apply', options(f, plan));
  assert.equal((await operate('check', { output: f.config.output })).states.installed, 1);
});
test('G4/B10/B14 incomplete standalone sources retain owner-local outcome/result bytes with an unproven linked settlement', async t => {
  const f = fixture(t), old = await oldBundle(f), owner = randomUUID();
  for (const source of ['inline', 'missing-bundle']) for (const action of ['commit', undefined]) {
    const savedReceipt = receipt('r', null, old.ref, 'succeeded').data;
    delete savedReceipt.pluginId; delete savedReceipt.sequence;
    if (source === 'inline') { delete savedReceipt.card.review; savedReceipt.card.patch = 'opaque historical patch'; }
    else savedReceipt.card.review = { ...old.ref, id: randomUUID() };
    const details = { ...result('t', 'r', old.ref, report({ before: oid(1), after: oid(3), tree: oid(2) })).message.details };
    if (action === undefined) delete details.action;
    const record = { version: 1, id: owner, requestId: owner, pluginId: 'git-workflow', action: 'remove', project: 'saved-project', anchor: '/missing/owner', cwd: '/missing/owner',
      state: 'succeeded', inputDigest: 'b'.repeat(64), createdAt: time, updatedAt: time, receipt: savedReceipt, result: { details, isError: true } };
    const converted = await convertStandalone(Buffer.from(JSON.stringify(record)), owner + '.json', decoded(f)), actual = JSON.parse(converted.output), settled = actual.reviewMetadata.at(-1).payload;
    assert.equal(actual.reviewMetadata[0].payload.kind, 'legacy-unavailable'); assert.equal(settled.kind, 'settlement');
    assert.equal(settled.result, undefined); assert.equal(settled.resultBasis, undefined); assert.equal(settled.postflight, undefined);
    assert.equal(settled.outcome.completed, true); assert.equal(settled.outcome.effectStarted, true); assert.equal(settled.unavailableResult.reason, 'result-unproven');
    assert.deepEqual(actual.result, record.result); assert.equal(actual.reviewMetadata[0].payload.operation, undefined);
    const wrong = structuredClone(record); wrong.result.details.operationId = owner;
    await assert.rejects(convertStandalone(Buffer.from(JSON.stringify(wrong)), owner + '.json', decoded(f)), /standalone-result-owner-mismatch/);
  }
});
test('B16 no-follow roots/intermediates/files, FIFOs, hardlinks and output aliases refuse before any traversal/install', async t => {
  for (const kind of ['root', 'file', 'fifo', 'hardlink', 'output']) {
    const { f, histories } = await basic(t);
    if (kind === 'root') { fs.symlinkSync(f.sessions, join(f.root, 'alias')); f.config.sessions = [join(f.root, 'alias')]; }
    if (kind === 'file') { fs.renameSync(histories[0].path, join(f.root, 'outside')); fs.symlinkSync(join(f.root, 'outside'), histories[0].path); }
    if (kind === 'fifo') { fs.rmSync(histories[0].path); execFileSync('mkfifo', [histories[0].path]); }
    if (kind === 'hardlink') fs.linkSync(histories[0].path, join(f.root, 'linked'));
    if (kind === 'output') f.config.output = join(f.sessions, 'private-output');
    await assert.rejects(dryRun(f.config));
  }
  const f = fixture(t), root = holdRoot(f.sessions);
  try {
    fs.mkdirSync(join(f.sessions, 'held')); const held = root.dir.child('held');
    try { fs.renameSync(join(f.sessions, 'held'), join(f.sessions, 'old')); fs.symlinkSync(f.legacy, join(f.sessions, 'held')); assert.throws(() => exclusive(held, 'not-created', Buffer.from('x')), /directory-edge-changed/); }
    finally { held.close(); }
  } finally { root.close(); }
});
test('S2/B16 physical output aliases/root descendants/containers refuse before artifact creation using held identities', async t => {
  const f = fixture(t); fs.mkdirSync(join(f.sessions, 'descendant'));
  const input = holdRoot(f.sessions), descendant = holdRoot(join(f.sessions, 'descendant')), container = holdRoot(f.root);
  try {
    const directories = inventory(input).directories.map(d => d.identity), ancestors = [];
    for (let d = input.dir; d; d = d.parent) ancestors.push(d.id);
    const before = fs.readdirSync(f.sessions).sort();
    // Distinct namespace spellings can refer to these SAME held objects. This
    // exercises the physical predicate without a privileged mount or fallback.
    for (const alias of [input, descendant, container]) {
      assert.throws(() => {
        assertOutputDisjoint([container.identity, alias.identity], directories, ancestors);
        exclusive(alias.dir, 'must-not-create', Buffer.from('artifact'));
      }, /aliased-output-root/);
    }
    assert.deepEqual(fs.readdirSync(f.sessions).sort(), before);
    assert.equal(fs.existsSync(join(f.root, 'must-not-create')), false);
    const outside = join(f.root, 'existing-output-parent'); fs.mkdirSync(outside, { mode: 0o700 });
    const parent = holdRoot(outside); const newRoot = join(outside, 'must-not-create');
    try {
      assert.throws(() => holdRoot(newRoot, { create: true, assertDirectory(dir, final) {
        // Model an existing output ancestor aliased to a selected descendant;
        // callback admission must run BEFORE the first missing child mkdir.
        const observed = dir.id === parent.identity ? descendant.identity : dir.id;
        assertOutputDisjoint([observed], directories, ancestors, final);
      } }), /aliased-output-root/);
      assert.equal(fs.existsSync(newRoot), false);
      assert.doesNotThrow(() => assertOutputDisjoint([container.identity, parent.identity], directories, ancestors));
    } finally { parent.close(); }
  } finally { input.close(); descendant.close(); container.close(); }
});
test('S3/B22 frozen helper identities cover the actual local runtime import closure, including command environment', () => {
  const root = resolve(here, '../../..'), covered = new Set(LOCAL_HELPERS);
  assert.equal(covered.has('bin/command-env.js'), true);
  for (const file of [...LOCAL_HELPERS, 'tools/migrations/git-operation-reviews/target.mjs']) {
    const path = join(root, file), source = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const clause = node.importClause, bindings = clause?.namedBindings ?? node.exportClause;
        const typesOnly = node.isTypeOnly || clause?.isTypeOnly || !clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly);
        if (!typesOnly) specifier = node.moduleSpecifier;
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || node.expression.getText(source) === 'require' || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'import')) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
        let dependency = resolve(dirname(path), specifier.text);
        if (!fs.existsSync(dependency)) dependency = ['.ts', '.js', '.mjs'].map(ext => dependency + ext).find(p => fs.existsSync(p));
        assert.equal(typeof dependency, 'string', 'known local helper resolves');
        assert.equal(covered.has(relative(root, dependency)), true, `unbound local helper imported by ${file}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
test('S3/B22 private source-only command-env mutation changes identity and refuses before state writes; exact restoration re-enables', async t => {
  const { f, histories } = await basic(t), root = resolve(here, '../../..'), copy = join(f.root, 'source');
  const sourceFiles = [...LOCAL_HELPERS, 'package.json', ...fs.readdirSync(here).filter(n => /\.(mjs|ts)$/.test(n) && !/\.(test|fixture)\./.test(n)).map(n => `tools/migrations/git-operation-reviews/${n}`)];
  for (const file of sourceFiles) { fs.mkdirSync(dirname(join(copy, file)), { recursive: true }); fs.copyFileSync(join(root, file), join(copy, file)); }
  const cli = pathToFileURL(join(copy, 'tools/migrations/git-operation-reviews/cli.mjs')).href, worker = pathToFileURL(join(copy, 'tools/migrations/git-operation-reviews/run.mjs')).href;
  const originalTarget = pathToFileURL(join(here, 'target.mjs')).href;
  // Only pinned external dependency resolution is redirected, never a local
  // helper, storage operation or business policy. No dependency-tree symlink.
  const bootstrap = `import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,next){return next(s,['jiti','@earendil-works/pi-coding-agent'].includes(s)?{...c,parentURL:${JSON.stringify(originalTarget)}}:c);}}); if(process.argv[1]==='identity'){const {toolIdentity}=await import(${JSON.stringify(worker)});console.log(JSON.stringify({tool:toolIdentity()}));}else{const {main}=await import(${JSON.stringify(cli)});process.exitCode=await main(process.argv.slice(1));}`;
  const child = args => spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap, '--', ...args], { encoding: 'utf8' });
  const planned = child(['dry-run', '--sessions', f.sessions, '--operations', 'none', '--legacy', f.legacy, '--output', f.config.output]);
  assert.equal(planned.status, 0, 'private copied tool plans normally'); const plan = JSON.parse(planned.stdout), originalIdentity = manifest(f).tool;
  assert.equal(JSON.parse(child(['identity']).stdout).tool, originalIdentity);
  const helper = join(copy, 'bin/command-env.js'), originalHelper = fs.readFileSync(helper), journal = join(f.config.output, 'journal.json'), journalHash = sha(fs.readFileSync(journal));
  fs.appendFileSync(helper, '\n// synthetic source identity mutation\n');
  assert.notEqual(JSON.parse(child(['identity']).stdout).tool, originalIdentity);
  const args = ['apply', '--output', f.config.output, '--confirm', plan.confirmation, '--writers-stopped', 'I_STOPPED_ALL_SELECTED_WRITERS'];
  const refused = child(args); assert.equal(refused.status, 1); assert.equal(JSON.parse(refused.stderr).reason, 'manifest-contract-mismatch');
  assert.equal(sha(fs.readFileSync(histories[0].path)), sha(histories[0].bytes)); assert.equal(sha(fs.readFileSync(journal)), journalHash);
  fs.writeFileSync(helper, originalHelper); assert.equal(JSON.parse(child(['identity']).stdout).tool, originalIdentity);
  const applied = child(args); assert.equal(applied.status, 0); assert.equal(JSON.parse(applied.stdout).states.installed, 1);
  const restored = child(['restore', ...args.slice(1)]); assert.equal(restored.status, 0); assert.equal(sha(fs.readFileSync(histories[0].path)), sha(histories[0].bytes));
});
test('S4/B19 actual CLI reports partial/uncertain mutation after rename, sanitizes errors and requires explicit recovery', async t => {
  const { f, histories } = await basic(t, 2), plan = await dryRun(f.config), cli = pathToFileURL(join(here, 'cli.mjs')).href;
  const secretMarker = 'synthetic exception content must not be reported';
  const bootstrap = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(String(b).endsWith('/owner-0.jsonl'))throw Object.assign(new Error(${JSON.stringify(secretMarker)}),{code:'EIO'});};syncBuiltinESMExports();const {main}=await import(${JSON.stringify(cli)});process.exitCode=await main(process.argv.slice(1));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap, '--', 'apply', '--output', f.config.output, '--confirm', plan.confirmation,
    '--writers-stopped', 'I_STOPPED_ALL_SELECTED_WRITERS'], { encoding: 'utf8' });
  assert.equal(child.status, 1); assert.equal(child.stdout, ''); const failure = JSON.parse(child.stderr);
  assert.equal(failure.status, 'recovery-required'); assert.equal(failure.stateMayHaveChanged, true); assert.equal(failure.reason, 'io-eio');
  assert.equal(failure.recovery.some(s => s.startsWith('check ')), true); assert.equal(failure.recovery.some(s => s.startsWith('resume ')), true); assert.equal(failure.recovery.some(s => s.startsWith('restore ')), true);
  assert.equal(child.stderr.includes(secretMarker), false);
  assert.equal(histories.filter(h => sha(fs.readFileSync(h.path)) !== sha(h.bytes)).length, 1);
  const state = await operate('check', { output: f.config.output }); assert.equal(state.states['installed-intent'], 1); assert.equal(state.states.original, 1);
  await operate('resume', options(f, plan)); await operate('restore', options(f, plan));
  assert.deepEqual(histories.map(h => sha(fs.readFileSync(h.path))), histories.map(h => sha(h.bytes)));
});
test('private locator context reuses validated bundle metadata with exact finite counts, never path admissions', async t => {
  const f = fixture(t), first = await oldBundle(f); await oldBundle(f);
  await oldBundle(f, { operation: { ...operation(), checkout: '/recorded/other-repository' } });
  history(f, [receipt('p', null, first.ref), receipt('r', 'p', first.ref, 'failed')]);
  const plan = await dryRun(f.config), report = JSON.parse(fs.readFileSync(join(f.config.output, 'recorded-locators.json')));
  assert.equal(plan.recordedCheckoutLocatorCount, 2); assert.equal(plan.repositoriesAdmitted, 0);
  assert.deepEqual(report.locators.find(r => r.locator === first.op.checkout), { locator: first.op.checkout, validatedBundles: 2, referencedBundles: 1,
    unreferencedCandidateBundles: 1, convertedReferenceOccurrences: 2, convertedOwners: 1 });
  assert.deepEqual(report.locators.find(r => r.locator !== first.op.checkout), { locator: '/recorded/other-repository', validatedBundles: 1, referencedBundles: 0,
    unreferencedCandidateBundles: 1, convertedReferenceOccurrences: 0, convertedOwners: 0 });
  assert.equal(report.authority, 'inert-recorded-locators-not-admissions');
});
test('B18/B21 explicit stopped writers/exact manifest, immutable mapping, apply/check/resume/idempotence and exact restore', async t => {
  const { f, histories } = await basic(t, 2), plan = await dryRun(f.config), opts = options(f, plan);
  await assert.rejects(operate('apply', { ...opts, writersStopped: false }), /attestation/); await assert.rejects(operate('apply', { ...opts, confirm: '0'.repeat(64) }), /confirmation/);
  assert.equal((await operate('check', { output: f.config.output })).status, 'incomplete');
  const applied = await operate('apply', opts); assert.equal(applied.states.installed, 2);
  const installed = histories.map(h => sha(fs.readFileSync(h.path))); await operate('apply', opts); await operate('resume', opts);
  assert.deepEqual(histories.map(h => sha(fs.readFileSync(h.path))), installed);
  assert.equal((await operate('check', { output: f.config.output })).states.installed, 2);
  await operate('restore', opts); await operate('restore', opts); assert.deepEqual(histories.map(h => sha(fs.readFileSync(h.path))), histories.map(h => sha(h.bytes)));
  await assert.rejects(operate('resume', opts), /restored-run/);
});
test('B19 killed native CLI child after atomic rename resumes exact before/after files without duplicate records', async t => {
  const { f, histories } = await basic(t, 2), plan = await dryRun(f.config), opts = options(f, plan);
  const code = `import {operate} from ${JSON.stringify(join(here, 'run.mjs'))}; await operate('apply', ${JSON.stringify(opts)}, {barrier(name){if(name==='install-renamed') process.kill(process.pid,'SIGKILL');}});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }); assert.equal(child.signal, 'SIGKILL');
  const journal = JSON.parse(fs.readFileSync(join(f.config.output, 'journal.json'))); assert.equal(Object.values(journal.files).filter(s => s.state === 'install-intent').length, 1);
  assert.equal(histories.filter(h => sha(fs.readFileSync(h.path)) !== sha(h.bytes)).length, 1);
  await operate('resume', opts); assert.equal((await operate('check', { output: f.config.output })).states.installed, 2);
  for (const h of histories) assert.equal(payloads(fs.readFileSync(h.path)).filter(p => p.kind === 'settlement').length, 1);
  await operate('restore', opts); assert.deepEqual(histories.map(h => sha(fs.readFileSync(h.path))), histories.map(h => sha(h.bytes)));
});
test('B19/B20 backups/stage/journal/fsync/short-write faults never falsely publish; durable partial backup and intent resume', async t => {
  for (const barrier of ['backup-ready', 'all-backups-ready', 'install-before-fsync', 'install-intent', 'parent-synced', 'installed']) {
    const { f } = await basic(t, 2), plan = await dryRun(f.config); let hit = false;
    await assert.rejects(operate('apply', options(f, plan), { barrier(name) { if (name === barrier && !hit) { hit = true; throw new Error('controlled'); } } }));
    assert.equal(hit, true); await operate('resume', options(f, plan)); assert.equal((await operate('check', { output: f.config.output })).states.installed, 2);
  }
  for (const failure of ['zero', 'enospc', 'backup-before-fsync', 'journal-before-rename']) {
    const { f, histories } = await basic(t), plan = await dryRun(f.config); let hit = false;
    const hooks = { write(fd, bytes, offset, label) {
      if (label === 'backup' && !hit && ['zero', 'enospc'].includes(failure)) { hit = true; if (failure === 'zero') return 0; throw Object.assign(new Error('controlled'), { code: 'ENOSPC' }); }
      return fs.writeSync(fd, bytes, offset, Math.min(17, bytes.length - offset));
    }, barrier(name) { if (name === failure && !hit) { hit = true; throw new Error('controlled'); } } };
    await assert.rejects(operate('apply', options(f, plan), hooks)); assert.equal(hit, true); assert.equal(sha(fs.readFileSync(histories[0].path)), sha(histories[0].bytes));
  }
});
test('S1/B19 reused interrupted backups sync their verified FD and directory before install intent', async t => {
  for (const point of ['backup-before-fsync', 'backup-before-directory-fsync']) {
    const { f, histories } = await basic(t), plan = await dryRun(f.config); let hit = false;
    await assert.rejects(operate('apply', options(f, plan), { barrier(name) { if (name === point && !hit) { hit = true; throw new Error('controlled'); } } }));
    assert.equal(hit, true); assert.equal(sha(fs.readFileSync(histories[0].path)), sha(histories[0].bytes));
    const backup = join(f.config.output, manifest(f).owners[0].backup), fileStat = fs.statSync(backup), dirStat = fs.statSync(dirname(backup)), calls = [];
    const nativeSync = fsDefault.fsyncSync, spy = t.mock.method(fsDefault, 'fsyncSync', fd => {
      const s = fs.fstatSync(fd); nativeSync(fd);
      if (s.dev === fileStat.dev && s.ino === fileStat.ino) calls.push('verified-backup-fd');
      if (s.dev === dirStat.dev && s.ino === dirStat.ino) calls.push('backup-directory');
    });
    syncBuiltinESMExports();
    try {
      await operate('resume', options(f, plan), { barrier(name) {
        if (name === 'install-intent') {
          assert.ok(calls.includes('verified-backup-fd'), 'existing backup FD must actually be fsynced before install');
          assert.ok(calls.indexOf('backup-directory') > calls.indexOf('verified-backup-fd'), 'backup directory must actually sync after verified FD');
        }
      } });
    } finally { spy.mock.restore(); syncBuiltinESMExports(); }
    await operate('restore', options(f, plan)); assert.equal(sha(fs.readFileSync(histories[0].path)), sha(histories[0].bytes));
  }
});
test('S1/B20 a backup changed after its held-FD sync refuses before directory admission or install', async t => {
  const { f, histories } = await basic(t), plan = await dryRun(f.config), backup = join(f.config.output, manifest(f).owners[0].backup); let hit = false;
  await assert.rejects(operate('apply', options(f, plan), { barrier(name) {
    if (name === 'backup-file-synced' && !hit) { hit = true; fs.appendFileSync(backup, 'changed'); }
  } }), /private-artifact-changed/);
  assert.equal(hit, true); assert.equal(sha(fs.readFileSync(histories[0].path)), sha(histories[0].bytes));
  assert.equal(Object.values(JSON.parse(fs.readFileSync(join(f.config.output, 'journal.json'))).files).some(s => s.backup), false);
});
test('B16/B19/B21 changed inputs/new files/races/tampered backups or journal never broad-overwrite newer bytes', async t => {
  for (const kind of ['source', 'new-file', 'backup', 'journal', 'race']) {
    const { f, histories } = await basic(t), plan = await dryRun(f.config), opts = options(f, plan);
    if (kind === 'race') {
      await assert.rejects(operate('apply', opts, { barrier(name) { if (name === 'install-intent') fs.appendFileSync(histories[0].path, '\n'); } }), /changed-before-rename/);
      assert.equal(fs.readFileSync(histories[0].path).at(-1), 10); continue;
    }
    await operate('apply', opts); const installed = sha(fs.readFileSync(histories[0].path));
    if (kind === 'source') fs.appendFileSync(histories[0].path, '\nnewer');
    if (kind === 'new-file') fs.writeFileSync(join(f.sessions, 'new.jsonl'), 'newer');
    if (kind === 'backup') fs.appendFileSync(join(f.config.output, manifest(f).owners[0].backup), 'tamper');
    if (kind === 'journal') { fs.renameSync(join(f.config.output, 'journal.json'), join(f.config.output, 'saved-journal')); fs.symlinkSync(join(f.config.output, 'saved-journal'), join(f.config.output, 'journal.json')); }
    const before = sha(fs.readFileSync(histories[0].path)); await assert.rejects(operate('restore', opts)); assert.equal(sha(fs.readFileSync(histories[0].path)), before);
    if (kind !== 'source') assert.equal(before, installed);
  }
});
test('B21 restore interruption reconciles exact original bytes and backup tamper remains a refusal', async t => {
  const { f, histories } = await basic(t, 2), plan = await dryRun(f.config), opts = options(f, plan); await operate('apply', opts);
  let hit = false; await assert.rejects(operate('restore', opts, { barrier(name) { if (name === 'restore-renamed' && !hit) { hit = true; throw new Error('controlled'); } } }));
  await operate('restore', opts); assert.deepEqual(histories.map(h => sha(fs.readFileSync(h.path))), histories.map(h => sha(h.bytes)));
});
test('B16 converter lock excludes a separate CLI process without stale-PID deletion', async t => {
  const { f } = await basic(t), plan = await dryRun(f.config); let refusal;
  await operate('apply', options(f, plan), { barrier(name) {
    if (name !== 'all-backups-ready') return;
    const child = spawnSync(process.execPath, [join(here, 'cli.mjs'), 'check', '--output', f.config.output], { encoding: 'utf8' });
    assert.equal(child.status, 1); refusal = JSON.parse(child.stderr).reason;
  } });
  assert.equal(refusal, 'run-locked');
});
test('B09/B17 explicit absent standalone root stays absent and no repository admission probes a saved locator', async t => {
  const { f } = await basic(t); f.config.operations = join(f.root, 'not-created');
  const plan = await dryRun(f.config); assert.equal(plan.blocks, 0); assert.equal(fs.existsSync(f.config.operations), false);
  await operate('apply', options(f, plan)); await operate('check', { output: f.config.output }); await operate('restore', options(f, plan));
  assert.equal(fs.existsSync(f.config.operations), false);
});
