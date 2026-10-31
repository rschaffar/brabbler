import type { PostflightBaseline, PostflightReport } from "./postflight";

/** Content identifiers, never retention refs or execution authority. */
export interface GitReviewComparison { before: string; after: string }
export interface GitReviewRepository {
  commonDirectory: string;
  identity: string;
  checkout: string;
  primaryCheckout: string;
  bindingOrigin: "captured" | "offline-admitted";
}
export interface CapturedGitReview {
  version: 1;
  repository: GitReviewRepository;
  comparison: GitReviewComparison;
  /** Pin both the content and the original commit/tree endpoints. */
  trees: GitReviewComparison;
}
export interface GitReviewResult {
  comparison: GitReviewComparison;
  commit: string;
  label: "Actual result" | "Rebased feature changes";
}
export type GitReviewRelation = "same" | "different" | "unknown";
export const isGitReviewOid = (value: unknown): value is string => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function isGitReviewComparison(value: unknown): value is GitReviewComparison {
  return object(value) && Object.keys(value).length === 2 && isGitReviewOid(value.before) && isGitReviewOid(value.after)
    && value.before.length === value.after.length;
}
export function isCapturedGitReview(value: unknown): value is CapturedGitReview {
  if (!object(value) || Object.keys(value).length !== 4 || value.version !== 1
    || !isGitReviewComparison(value.comparison) || !isGitReviewComparison(value.trees)
    || value.comparison.before.length !== value.trees.before.length || !object(value.repository)) return false;
  const repository = value.repository;
  return Object.keys(repository).length === 5 && /^\d+:\d+:\d+$/.test(repository.identity as string)
    && [repository.commonDirectory, repository.identity, repository.checkout, repository.primaryCheckout]
    .every(item => typeof item === "string" && item.length > 0 && !item.includes("\0"))
    && ["captured", "offline-admitted"].includes(repository.bindingOrigin as string);
}

/** Use only settled, verified observations. A populated report.commit is not proof:
 * it is collected before the final identity/ref guards and can survive their failure.
 * This projection never performs Git reads, retries effects or upgrades saved intent. */
export function gitReviewResult(baseline: PostflightBaseline, report: PostflightReport): GitReviewResult | undefined {
  if (report.action !== baseline.action || report.nativeOutcome !== "completed" || report.verification !== "verified"
    || report.finalization !== "completed" || report.issues.length || !report.commit || !isGitReviewOid(report.commit.oid)) return;
  const holds = (...names: string[]) => names.every(name => report.relationships[name] === true);
  const boundRef = (name: string) => {
    const expected = baseline.refs[name], observed = report.refs[name];
    return expected && observed && observed.branch === expected.branch && observed.before === expected.before
      && isGitReviewOid(expected.before) && isGitReviewOid(observed.after) ? observed : undefined;
  };
  if (baseline.action === "commit") {
    const subject = boundRef("subject");
    if (!subject || subject.after !== report.commit.oid || !isGitReviewOid(baseline.candidateTree)
      || report.commit.tree !== baseline.candidateTree || report.commit.parentCount !== 1
      || report.commit.parents[0] !== subject.before
      || !holds("subjectMatchesCheckout", "expectedParent", "candidateTreeMatches", "newCommitUnsigned")) return;
    return { comparison: { before: subject.before, after: subject.after! }, commit: report.commit.oid, label: "Actual result" };
  }
  if (baseline.action === "merge") {
    const target = boundRef("target"), feature = boundRef("feature");
    if (!target || !feature || target.after !== report.commit.oid || feature.after !== feature.before
      || !holds("featureUnchanged", "targetMatchesCheckout", "featureIntegrated", "targetHistoryRetained", "expectedIntegrationShape")) return;
    const shape = report.disposition === "no-op" ? target.after === target.before
      : report.disposition === "fast-forward" ? baseline.mergeMethod === "ff-only" && target.after === feature.before
      : report.disposition === "non-fast-forward" && baseline.mergeMethod === "non-ff" && report.commit.parentCount === 2
        && report.commit.parents[0] === target.before && report.commit.parents[1] === feature.before;
    if (!shape) return;
    return { comparison: { before: target.before, after: target.after! }, commit: report.commit.oid, label: "Actual result" };
  }
  if (baseline.action === "rebase") {
    const target = boundRef("target"), feature = boundRef("feature");
    if (!target || !feature || feature.after !== report.commit.oid || target.after !== target.before
      || !holds("targetUnchanged", "featureMatchesCheckout", "targetIntegrated")) return;
    return { comparison: { before: target.before, after: feature.after! }, commit: report.commit.oid, label: "Rebased feature changes" };
  }
}
