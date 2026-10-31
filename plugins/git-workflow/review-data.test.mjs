import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { gitReviewResult, isGitReviewComparison, isCapturedGitReview } = await jiti.import('./review-data.ts');
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
