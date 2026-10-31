import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { cleanupReviewSnapshot } from './review-resources.fixture.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { gitReviewResult, isGitReviewComparison, isCapturedGitReview, readGitReviewPayload, isGitReviewUnavailableComparison } = await jiti.import('./review-data.ts');
const { snapshotOperationReview, readOperationReview } = await jiti.import('../../lib/plugins/review-metadata.ts');
const oid = n => String(n).repeat(40);
function fixture(action = 'commit') {
  const baseline = { action, cwd: '/fixture', repository: '/fixture/.git', repositoryIdentity: '1:2:16877', checkouts: [], registrations: [],
    refs: action === 'commit' ? { subject: { branch: 'feature', before: oid(1) } }
      : { target: { branch: 'main', before: oid(1) }, feature: { branch: 'feature', before: oid(2) } },
    candidateTree: oid(4), mergeMethod: 'non-ff' };
  const refs = Object.fromEntries(Object.entries(baseline.refs).map(([key, value]) => [key, { ...value,
    after: action === 'rebase' && key === 'target' ? value.before : action === 'merge' && key === 'feature' ? value.before : oid(3) }]));
  const report = { version: 1, action, nativeOutcome: 'completed', finalization: 'completed', verification: 'verified', observedAt: '2026-01-01T00:00:00.000Z',
    scope: 'fixture', refs, checkouts: [], commit: { oid: oid(3), tree: oid(4), parents: action === 'merge' ? [oid(1), oid(2)] : [oid(1)],
      parentCount: action === 'merge' ? 2 : 1, author: { name: 'Test', email: 'test@example.invalid' }, signed: false, metadataTruncated: false },
    relationships: { subjectMatchesCheckout: true, expectedParent: true, candidateTreeMatches: true, newCommitUnsigned: true,
      featureUnchanged: true, targetMatchesCheckout: true, featureIntegrated: true, targetHistoryRetained: true, expectedIntegrationShape: true,
      targetUnchanged: true, featureMatchesCheckout: true, targetIntegrated: true }, issues: [], checks: [], disposition: 'non-fast-forward' };
  return { baseline, report };
}

test('commit actual result is parent to recorded commit, never a current branch or candidate label', () => {
  const { baseline, report } = fixture();
  assert.deepEqual(gitReviewResult(baseline, report), { comparison: { before: oid(1), after: oid(3) }, commit: oid(3), label: 'Actual result' });
  for (const mutate of [
    value => { value.commit.tree = oid(5); }, value => { value.commit.parents[0] = oid(5); },
    value => { value.refs.subject.before = oid(5); }, value => { value.refs.subject.after = oid(5); },
    value => { value.refs.subject.branch = 'other'; }, value => { value.relationships.candidateTreeMatches = false; },
  ]) {
    const changed = structuredClone(report); mutate(changed); assert.equal(gitReviewResult(baseline, changed), undefined);
  }
});

test('partially populated reports and late-guard/native-finalization failures do not become proven history', () => {
  for (const action of ['commit', 'merge', 'rebase']) {
    const { baseline, report } = fixture(action);
    for (const field of ['verification', 'nativeOutcome', 'finalization']) {
      for (const value of [undefined, 'failed', 'unavailable', 'not-run', 'started']) {
        const changed = { ...report, [field]: value };
        assert.equal(gitReviewResult(baseline, changed), undefined, `${action}: ${field}=${value}`);
      }
    }
    assert.equal(gitReviewResult(baseline, { ...report, issues: ['late identity guard failed'] }), undefined);
    assert.equal(gitReviewResult(baseline, { ...report, commit: undefined }), undefined);
    assert.equal(gitReviewResult(baseline, { ...report, action: 'cleanupFeature' }), undefined);
    assert.equal(gitReviewResult(baseline, { ...report, commit: { ...report.commit, oid: 'HEAD' } }), undefined);
  }
});

test('merge default is captured target to actual result, including explicit no-op and fast-forward', () => {
  const { baseline, report } = fixture('merge');
  assert.deepEqual(gitReviewResult(baseline, report).comparison, { before: oid(1), after: oid(3) });
  // Divergent merge may legitimately have a tree different from the feature tree.
  report.relationships.featureTreeMatchesResult = false;
  assert.ok(gitReviewResult(baseline, report));
  const swapped = structuredClone(report); swapped.commit.parents.reverse();
  assert.equal(gitReviewResult(baseline, swapped), undefined);
  report.disposition = 'no-op'; report.commit.oid = oid(1); report.refs.target.after = oid(1);
  report.commit.parents = [oid(9)]; report.commit.parentCount = 1;
  assert.deepEqual(gitReviewResult(baseline, report).comparison, { before: oid(1), after: oid(1) });
  report.disposition = 'fast-forward'; report.commit.oid = oid(2); report.refs.target.after = oid(2); baseline.mergeMethod = 'ff-only';
  report.commit.parents = [oid(1)]; report.commit.parentCount = 1;
  assert.deepEqual(gitReviewResult(baseline, report).comparison, { before: oid(1), after: oid(2) });
  report.refs.feature.after = oid(5);
  assert.equal(gitReviewResult(baseline, report), undefined, 'moved feature must not reuse captured proposal');
});

test('rebase displays rebased feature changes against captured target, not all old-tip to new-tip upstream changes', () => {
  const { baseline, report } = fixture('rebase');
  assert.deepEqual(gitReviewResult(baseline, report), { comparison: { before: oid(1), after: oid(3) }, commit: oid(3), label: 'Rebased feature changes' });
  report.refs.target.after = oid(5); assert.equal(gitReviewResult(baseline, report), undefined);
});

test('saved comparison schema accepts only full compatible object IDs and metadata, never embedded patches', () => {
  const comparison = { before: oid(1), after: oid(2) };
  assert.equal(isGitReviewComparison(comparison), true);
  assert.equal(isGitReviewComparison({ ...comparison, before: 'main' }), false);
  assert.equal(isGitReviewComparison({ ...comparison, after: oid(2).slice(0, 10) }), false);
  assert.equal(isGitReviewComparison({ ...comparison, patch: '+secret' }), false);
  const captured = { version: 1, repository: { commonDirectory: '/fixture/.git', identity: '1:2:16877', checkout: '/fixture', primaryCheckout: '/fixture', bindingOrigin: 'captured' }, comparison, trees: comparison };
  assert.equal(isCapturedGitReview(captured), true);
  assert.equal(isCapturedGitReview({ ...captured, patch: 'not allowed' }), false);
  assert.equal(isCapturedGitReview({ ...captured, repository: { ...captured.repository, identity: 'unverified' } }), false);
  assert.equal(isCapturedGitReview({ ...captured, repository: { ...captured.repository, bindingOrigin: 'offline-admitted' } }), true);
  assert.equal(isCapturedGitReview({ ...captured, comparison: { before: '1'.repeat(64), after: '2'.repeat(64) } }), false);
});

test('settled result projection preserves full SHA-256 endpoint IDs', () => {
  const convert = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value + value[0].repeat(24)
    : Array.isArray(value) ? value.map(convert)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)])) : value;
  for (const action of ['commit', 'merge', 'rebase']) {
    const { baseline, report } = convert(fixture(action)), result = gitReviewResult(baseline, report);
    assert.equal(result.commit.length, 64); assert.equal(result.comparison.before.length, 64); assert.equal(result.comparison.after.length, 64);
  }
});

test('legacy unavailable schema retains trustworthy OIDs and complete once-only artifact details without inventing physical identity', () => {
  const unavailable = { reason: 'legacy-binding-not-captured', comparison: { before: oid(1), after: oid(2) } };
  const fields = Array.from({ length: 5000 }, (_, i) => ({ label: `generated-${i}`, value: `Needs one-time approval · ${i + 1} entries · SHA256 ${'a'.repeat(64)}`, code: true }));
  const payload = { version: 1, kind: 'legacy-unavailable', unavailable,
    details: { title: 'Historical cleanup', sections: [{ title: 'Exact generated resources', text: 'm'.repeat(2 * 1024 * 1024), fields }] } };
  const record = snapshotOperationReview('git-workflow', 'a046677d-8293-4445-9a2b-558317341280', 'git-operation/v1', payload);
  const reopened = readGitReviewPayload(readOperationReview(JSON.parse(JSON.stringify(record))).payload);
  assert.ok(reopened); assert.equal(reopened.kind, 'legacy-unavailable');
  assert.deepEqual(structuredClone(reopened.unavailable.comparison), unavailable.comparison);
  assert.equal(Object.hasOwn(reopened.unavailable, 'repository'), false);
  assert.deepEqual(structuredClone(reopened.details.sections[0].fields), fields);
  assert.equal(reopened.details.sections[0].text.length, 2 * 1024 * 1024);
  const admitted = { ...unavailable, repository: { commonDirectory: '/fixture/.git', identity: '1:2:16877', checkout: '/fixture', primaryCheckout: '/fixture', bindingOrigin: 'offline-admitted' } };
  assert.equal(isGitReviewUnavailableComparison(admitted), true);
  assert.equal(isGitReviewUnavailableComparison({ ...admitted, repository: { ...admitted.repository, bindingOrigin: 'captured' } }), false, 'an offline observation must not become original captured identity');
  assert.equal(readGitReviewPayload({ ...payload, patch: '+not metadata' }), null);
  assert.equal(readGitReviewPayload({ ...payload, details: { patch: '+not metadata' } }), null);
  assert.equal(isGitReviewUnavailableComparison({ ...unavailable, comparison: { before: 'HEAD', after: oid(2) } }), false);
});

const reference = { version: 2, id: 'a046677d-8293-4445-9a2b-558317341280', operationId: 'a046677d-8293-4445-9a2b-558317341281' };
function resourceProposal(paths = ['generated']) {
  return { version: 1, kind: 'proposal', operation: { action: 'cleanupFeature', checkout: '/repo', featureBranch: 'feature',
    featureTip: oid(1), integrationCommit: oid(2), removeWorktree: true, deleteBranch: true, artifactRoots: paths },
    fingerprint: 'a'.repeat(64), cwd: '/repo', nativeArgs: [], checks: [], source: { kind: 'resources', resources: { kind: 'cleanup', snapshot: cleanupReviewSnapshot(paths) } } };
}
test('complete large resources and checks round-trip outside card limits', () => {
  const paths = Array.from({ length: 5000 }, (_, i) => `generated-${i}`), payload = resourceProposal(paths);
  payload.checks = Array.from({ length: 5000 }, (_, i) => ({ name: `check-${i}`, command: 'x'.repeat(i === 0 ? 2 * 1024 * 1024 : 10), timeoutMs: 0 }));
  const record = snapshotOperationReview('git-workflow', reference.operationId, 'git-operation/v1', payload);
  const parsed = readGitReviewPayload(readOperationReview(JSON.parse(JSON.stringify(record))).payload);
  assert.ok(parsed); assert.deepEqual(structuredClone(parsed.source.resources.snapshot), payload.source.resources.snapshot);
  assert.deepEqual(structuredClone(parsed.checks), payload.checks);
});
test('resource metadata rejects malformed artifacts, permissions, parent records and unexpected bodies', () => {
  for (const mutate of [
    p => { p.source.resources.snapshot = { artifacts: [null], patch: '+not metadata' }; },
    p => { p.source.resources.patch = '+not metadata'; },
    p => { delete p.source.resources.snapshot.repositoryIdentity; },
    p => { p.operation.worktreePath = 1; },
    p => { p.source.resources.snapshot.artifacts[0] = null; },
    p => { p.source.resources.snapshot.artifacts[0].entries = -1; },
    p => { p.source.resources.snapshot.artifacts[0].bytes = 1.5; },
    p => { p.source.resources.snapshot.artifacts[0].digest = 'invalid'; },
    p => { p.source.resources.snapshot.artifacts[0].patch = '+not metadata'; },
    p => { p.source.resources.snapshot.unapprovedArtifacts = ['not-selected']; },
    p => { p.source.resources.snapshot.artifactParents = [null]; },
    p => { p.source.resources.snapshot.artifactParentMetadata = [{ path: '', digest: 1 }]; },
    p => { p.source.resources.snapshot.artifactParentIdentities[0].identity = ['1', '2']; },
    p => { p.source.resources.snapshot.artifactParentIdentities[0].identity[1] = 'invalid'; },
    p => { p.source.resources.snapshot.lossEvidence.state = 'invented'; },
    p => { p.source.resources.snapshot.lossEvidence.comparisonTarget.patch = '+not metadata'; },
    p => { p.source.resources.snapshot.verifiedComparison.tip = 'HEAD'; },
  ]) {
    const payload = resourceProposal(); mutate(payload); assert.equal(readGitReviewPayload(payload), null);
  }
});
test('worktree proposals and optional settlement observations validate every declared member', () => {
  const registration = { path: '/repo', branch: 'main', head: oid(1), detached: false, locked: '', prunable: '' };
  const payload = resourceProposal();
  payload.source.resources = { kind: 'worktree', checkout: '/repo', head: { branch: 'main', tip: oid(1) }, registrations: [registration], base: { branch: 'main', tip: oid(1) }, selected: registration };
  assert.ok(readGitReviewPayload(payload));
  for (const mutate of [
    p => { delete p.source.resources.checkout; }, p => { p.source.resources.head.branch = null; },
    p => { p.source.resources.head.patch = '+not metadata'; }, p => { p.source.resources.registrations = [null]; },
    p => { p.source.resources.registrations[0].head = 'HEAD'; }, p => { p.source.resources.registrations[0].locked = true; },
    p => { p.source.resources.registrations[0].detached = 'false'; }, p => { p.source.resources.registrations[0].ref = 'not metadata'; },
    p => { p.source.resources.base = { branch: 'main' }; }, p => { p.source.resources.selected = null; },
  ]) { const changed = structuredClone(payload); mutate(changed); assert.equal(readGitReviewPayload(changed), null); }
  const settlement = { version: 1, kind: 'settlement', proposal: reference, outcome: { phase: 'failed', effectStarted: true, completed: false, checksStarted: false, effects: [] },
    resourceResult: { head: { branch: null, tip: oid(1) }, registrations: [registration] }, relation: 'unknown' };
  assert.ok(readGitReviewPayload(settlement));
  for (const resourceResult of ['not an observation', null, { head: { branch: 'main', tip: 'HEAD' }, registrations: [] },
    { head: { branch: null, tip: oid(1) }, registrations: [null] }, { ...settlement.resourceResult, patch: '+not metadata' }]) {
    assert.equal(readGitReviewPayload({ ...settlement, resourceResult }), null);
  }
});
test('legacy and proposal check definitions share strict member validation without limits', () => {
  const legacy = { version: 1, kind: 'legacy-unavailable', unavailable: { reason: 'legacy-endpoints-missing' }, checks: [{ name: 'test', command: 'true', timeoutMs: 0 }] };
  assert.ok(readGitReviewPayload(legacy));
  const operation = { action: 'discardResources', checkout: '/repo', subject: { kind: 'branch', branch: 'feature', tip: oid(1) },
    comparisonTarget: { branch: 'main', tip: oid(2) }, removeWorktree: true, deleteBranch: true, artifactRoots: [] };
  assert.ok(readGitReviewPayload({ ...legacy, operation }));
  assert.equal(readGitReviewPayload({ ...legacy, operation: { ...operation, subject: { ...operation.subject, patch: '+not metadata' } } }), null);
  assert.equal(readGitReviewPayload({ ...legacy, operation: { ...operation, comparisonTarget: { branch: 'main', tip: 'HEAD' } } }), null);
  for (const checks of [[null], [{ name: 'test' }], [{ name: 'test', command: 1 }], [{ name: 'test', command: 'true', timeoutMs: -1 }], [{ name: 'test', command: 'true', patch: '+not metadata' }]]) {
    assert.equal(readGitReviewPayload({ ...legacy, checks }), null);
    assert.equal(readGitReviewPayload({ ...resourceProposal(), checks }), null);
  }
});
