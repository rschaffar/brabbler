import type { PostflightBaseline, PostflightReport } from "./postflight";
import type { ReviewedGitOperation } from "./server";
import type { CleanupSnapshot, WorktreeRecord } from "./cleanup";
import type { RequiredCheck, PluginOperationReceipt, PluginCardField, PluginCardSection } from "../../lib/plugins/types";
import { isOperationReviewReference, type OperationReviewReference } from "../../lib/plugins/review-reference";

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
export const GIT_REVIEW_FORMAT = "git-operation/v1";
/** Complete structured resources, not a bounded presentation copy. No patch/blob bodies. */
export type GitReviewResources =
  | { kind: "cleanup"; snapshot: CleanupSnapshot }
  | { kind: "worktree"; checkout: string; head: { branch: string; tip: string }; registrations: WorktreeRecord[];
      base?: { branch: string; tip: string }; selected?: WorktreeRecord };
/** Lossless once-only details not recoverable from structured operation/resource
 * facts (notably legacy artifact rows). No card field/count/text ceilings apply.
 * New producers use structured resources instead of duplicating their full card. */
export interface GitReviewDetails {
  title?: string; subtitle?: string; text?: string; markdown?: string; scope?: string;
  fields?: PluginCardField[]; sections?: PluginCardSection[];
  patchBefore?: string; patchAfter?: string; requiredAcknowledgment?: string;
}
export interface GitReviewUnavailableComparison {
  reason: "legacy-binding-not-captured" | "legacy-endpoints-missing" | "repository-unavailable" | "objects-unavailable" | "result-unproven" | "unsupported-legacy";
  /** Trustworthy captured identifiers only. Absent is unknown, not today's HEAD. */
  comparison?: GitReviewComparison; trees?: GitReviewComparison;
  /** Omit when no physical binding was captured/admitted. An offline mapping may
   * supply offline-admitted provenance; it must never invent captured identity. */
  repository?: GitReviewRepository;
  detail?: string;
}
export interface GitReviewProposal {
  version: 1; kind: "proposal"; operation: ReviewedGitOperation; fingerprint: string;
  cwd: string; nativeArgs: string[]; checks: RequiredCheck[]; baseline?: PostflightBaseline;
  source: { kind: "git"; captured: CapturedGitReview } | { kind: "resources"; resources: GitReviewResources }
    | { kind: "unavailable"; unavailable: GitReviewUnavailableComparison };
  /** Converter-only presentation facts not represented in the structured source. */
  details?: GitReviewDetails;
}
/** Incomplete legacy inline history cannot be promoted to an exact proposal.
 * Keep only recoverable facts and the existing receipt's historical outcome. */
export interface GitReviewLegacyUnavailable {
  version: 1; kind: "legacy-unavailable"; unavailable: GitReviewUnavailableComparison;
  operation?: ReviewedGitOperation; fingerprint?: string; checks?: RequiredCheck[]; nativeArgs?: string[];
  details?: GitReviewDetails;
}
export interface GitReviewSettlement {
  version: 1; kind: "settlement"; proposal: OperationReviewReference;
  outcome: { phase: PluginOperationReceipt["phase"]; effectStarted: boolean; completed: boolean; checksStarted: boolean;
    effects: string[]; attemptedEffect?: string };
  /** Collected and finalized observations, never parsed receipt/summary prose. */
  postflight?: PostflightReport;
  result?: { captured: CapturedGitReview; commit: string; label: GitReviewResult["label"] };
  resourceResult?: { head: { branch: string | null; tip: string }; registrations: WorktreeRecord[] };
  /** Retain proven legacy result OIDs even when their content/binding is missing;
   * this descriptor alone is NOT a trustworthy actual-result comparison. */
  unavailableResult?: GitReviewUnavailableComparison;
  relation: GitReviewRelation;
}
/** Plugin-owned payload of the generic host envelope. P3 resolves this exact
 * record and, for settlement, its proposal on the SAME referring ancestry.
 * A settlement/result record is not proof that its terminal receipt was saved. */
export type GitReviewPayload = GitReviewProposal | GitReviewSettlement | GitReviewLegacyUnavailable;
export const isGitReviewOid = (value: unknown): value is string => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && !item.includes("\0"));
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every(key => names.includes(key));
const text = (value: unknown): value is string => typeof value === "string" && !value.includes("\0");
const nonempty = (value: unknown): value is string => text(value) && value.length > 0;
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function checks(value: unknown): boolean {
  return Array.isArray(value) && value.every(check => object(check) && keys(check, ["name", "command", "timeoutMs"])
    && text(check.name) && text(check.command) && (check.timeoutMs === undefined || count(check.timeoutMs)));
}
function branchPoint(value: unknown): boolean {
  return object(value) && keys(value, ["branch", "tip"]) && nonempty(value.branch) && isGitReviewOid(value.tip);
}
function head(value: unknown, detached: boolean): boolean {
  return object(value) && keys(value, ["branch", "tip"]) && (nonempty(value.branch) || detached && value.branch === null) && isGitReviewOid(value.tip);
}
function registration(value: unknown): boolean {
  return object(value) && keys(value, ["path", "branch", "head", "detached", "locked", "prunable"]) && nonempty(value.path)
    && (value.branch === undefined || nonempty(value.branch)) && (value.head === undefined || isGitReviewOid(value.head))
    && (value.detached === undefined || typeof value.detached === "boolean")
    && [value.locked, value.prunable].every(item => item === undefined || text(item));
}
function registrations(value: unknown): boolean { return Array.isArray(value) && value.every(registration); }
function cleanupSnapshot(value: unknown): boolean {
  if (!object(value) || !keys(value, ["identity", "repositoryIdentity", "fingerprint", "artifacts", "unapprovedArtifacts", "artifactParents",
    "artifactParentMetadata", "artifactParentIdentities", "path", "cwd", "target", "lossEvidence", "verifiedComparison"])
    || ![value.identity, value.repositoryIdentity, value.fingerprint].every(sha256) || !nonempty(value.cwd) || !text(value.target)
    || value.path !== undefined && !nonempty(value.path) || !Array.isArray(value.artifacts)
    || !value.artifacts.every(item => object(item) && keys(item, ["path", "entries", "bytes", "digest"])
      && nonempty(item.path) && count(item.entries) && count(item.bytes) && sha256(item.digest))
    || !strings(value.unapprovedArtifacts) || !strings(value.artifactParents)
    || !Array.isArray(value.artifactParentMetadata) || !value.artifactParentMetadata.every(item => object(item)
      && keys(item, ["path", "digest"]) && text(item.path) && sha256(item.digest))
    || !Array.isArray(value.artifactParentIdentities) || !value.artifactParentIdentities.every(item => object(item)
      && keys(item, ["path", "identity"]) && text(item.path) && Array.isArray(item.identity) && item.identity.length === 3
      && item.identity.every(part => typeof part === "string" && /^\d+$/.test(part)))) return false;
  const paths = new Set(value.artifacts.map(item => item.path));
  if (paths.size !== value.artifacts.length || !value.unapprovedArtifacts.every(path => paths.has(path))) return false;
  const evidence = value.lossEvidence;
  return (value.verifiedComparison === undefined || branchPoint(value.verifiedComparison))
    && (evidence === undefined || object(evidence) && keys(evidence, ["state", "reason", "comparisonTarget"])
      && ["integrated", "not-integrated", "unknown"].includes(evidence.state as string)
      && (evidence.reason === undefined || text(evidence.reason)) && (evidence.comparisonTarget === undefined || branchPoint(evidence.comparisonTarget)));
}
function resources(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.kind === "cleanup") return keys(value, ["kind", "snapshot"]) && cleanupSnapshot(value.snapshot);
  return value.kind === "worktree" && keys(value, ["kind", "checkout", "head", "registrations", "base", "selected"])
    && nonempty(value.checkout) && head(value.head, false) && registrations(value.registrations)
    && (value.base === undefined || branchPoint(value.base)) && (value.selected === undefined || registration(value.selected));
}
function details(value: unknown): boolean {
  if (!object(value) || !keys(value, ["title", "subtitle", "text", "markdown", "scope", "fields", "sections", "patchBefore", "patchAfter", "requiredAcknowledgment"])) return false;
  const fields = (value: unknown) => Array.isArray(value) && value.every(field => object(field) && keys(field, ["label", "value", "code"])
    && typeof field.label === "string" && typeof field.value === "string" && (field.code === undefined || typeof field.code === "boolean"));
  return Object.entries(value).every(([key, item]) => key === "fields" ? fields(item) : key === "sections"
    ? Array.isArray(item) && item.every(section => object(section) && keys(section, ["title", "text", "fields", "code", "collapsible", "notice"])
      && typeof section.title === "string" && (section.text === undefined || typeof section.text === "string")
      && (section.fields === undefined || fields(section.fields)) && [section.code, section.collapsible, section.notice].every(flag => flag === undefined || typeof flag === "boolean"))
    : typeof item === "string");
}
export function isGitReviewUnavailableComparison(value: unknown): value is GitReviewUnavailableComparison {
  if (!object(value) || !keys(value, ["reason", "comparison", "trees", "repository", "detail"])
    || !["legacy-binding-not-captured", "legacy-endpoints-missing", "repository-unavailable", "objects-unavailable", "result-unproven", "unsupported-legacy"].includes(value.reason as string)
    || value.detail !== undefined && typeof value.detail !== "string"
    || value.comparison !== undefined && !isGitReviewComparison(value.comparison)
    || value.trees !== undefined && !isGitReviewComparison(value.trees)) return false;
  if (value.repository !== undefined) {
    const comparison = value.comparison ?? value.trees;
    if (!comparison || !isCapturedGitReview({ version: 1, repository: value.repository, comparison, trees: comparison })) return false;
    if (value.reason === "legacy-binding-not-captured" && (value.repository as GitReviewRepository).bindingOrigin !== "offline-admitted") return false;
  }
  return true;
}
function operation(value: unknown): value is ReviewedGitOperation {
  if (!object(value) || !nonempty(value.checkout) || typeof value.action !== "string") return false;
  const text = (...names: string[]) => names.every(name => typeof value[name] === "string" && !(value[name] as string).includes("\0"));
  if (value.action === "commit") return keys(value, ["action", "checkout", "mode", "message", "files"])
    && text("message") && (value.mode === "staged" && value.files === undefined || value.mode === "files" && strings(value.files));
  if (value.action === "merge" || value.action === "rebase") return keys(value, ["action", "checkout", "featureBranch", "targetBranch", "mergeMethod"])
    && text("featureBranch") && (value.targetBranch === undefined || text("targetBranch"))
    && (value.mergeMethod === undefined || ["ff-only", "non-ff"].includes(value.mergeMethod as string));
  if (value.action === "createWorktree" || value.action === "attachWorktree") return keys(value, ["action", "checkout", "branch", "baseBranch", "path"]) && text("branch", "baseBranch", "path");
  if (value.action === "removeWorktree") return keys(value, ["action", "checkout", "path"]) && text("path");
  if (value.action === "cleanupFeature") return keys(value, ["action", "checkout", "featureBranch", "featureTip", "integrationCommit", "targetBranch", "worktreePath", "removeWorktree", "deleteBranch", "artifactRoots"])
    && text("featureBranch") && isGitReviewOid(value.featureTip) && isGitReviewOid(value.integrationCommit)
    && (value.targetBranch === undefined || text("targetBranch")) && (value.worktreePath === undefined || text("worktreePath"))
    && typeof value.removeWorktree === "boolean" && typeof value.deleteBranch === "boolean" && strings(value.artifactRoots);
  if (value.action === "discardResources") return keys(value, ["action", "checkout", "subject", "comparisonTarget", "worktreePath", "removeWorktree", "deleteBranch", "artifactRoots"])
    && object(value.subject) && (value.subject.kind === "branch" && keys(value.subject, ["kind", "branch", "tip"]) && nonempty(value.subject.branch) && isGitReviewOid(value.subject.tip)
      || value.subject.kind === "detached" && keys(value.subject, ["kind", "head"]) && isGitReviewOid(value.subject.head))
    && (value.comparisonTarget === undefined || branchPoint(value.comparisonTarget)) && (value.worktreePath === undefined || text("worktreePath"))
    && typeof value.removeWorktree === "boolean" && typeof value.deleteBranch === "boolean" && strings(value.artifactRoots);
  return false;
}
/** Shape decoder only; resolveGitReviewSettlement additionally verifies linked
 * result evidence. The core separately detaches/checksums the whole envelope. */
export function readGitReviewPayload(value: unknown): GitReviewPayload | null {
  if (!object(value) || value.version !== 1) return null;
  if (value.kind === "proposal") {
    if (!keys(value, ["version", "kind", "operation", "fingerprint", "cwd", "nativeArgs", "checks", "baseline", "source", "details"])
      || !operation(value.operation) || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)
      || typeof value.cwd !== "string" || !value.cwd || !strings(value.nativeArgs) || !checks(value.checks) || !object(value.source)) return null;
    if (value.details !== undefined && !details(value.details)) return null;
    if (value.baseline !== undefined && (!object(value.baseline) || value.baseline.action !== value.operation.action || !object(value.baseline.refs))) return null;
    if (value.source.kind === "git") {
      if (!keys(value.source, ["kind", "captured"]) || !isCapturedGitReview(value.source.captured) || !["commit", "merge", "rebase"].includes(value.operation.action)) return null;
    } else if (value.source.kind === "resources") {
      if (!keys(value.source, ["kind", "resources"]) || !resources(value.source.resources)) return null;
    } else if (value.source.kind === "unavailable") {
      if (!keys(value.source, ["kind", "unavailable"]) || !isGitReviewUnavailableComparison(value.source.unavailable)) return null;
    } else return null;
    return value as unknown as GitReviewProposal;
  }
  if (value.kind === "legacy-unavailable") {
    if (!keys(value, ["version", "kind", "unavailable", "operation", "fingerprint", "checks", "nativeArgs", "details"])
      || !isGitReviewUnavailableComparison(value.unavailable) || value.operation !== undefined && !operation(value.operation)
      || value.fingerprint !== undefined && (typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint))
      || value.nativeArgs !== undefined && !strings(value.nativeArgs) || value.checks !== undefined && !checks(value.checks)
      || value.details !== undefined && !details(value.details)) return null;
    return value as unknown as GitReviewLegacyUnavailable;
  }
  if (value.kind !== "settlement" || !keys(value, ["version", "kind", "proposal", "outcome", "postflight", "result", "resourceResult", "unavailableResult", "relation"])
    || !isOperationReviewReference(value.proposal) || !object(value.outcome)
    || !keys(value.outcome, ["phase", "effectStarted", "completed", "checksStarted", "effects", "attemptedEffect"])
    || value.outcome.attemptedEffect !== undefined && !text(value.outcome.attemptedEffect)
    || !["same", "different", "unknown"].includes(value.relation as string)
    || !["succeeded", "failed", "cancelled"].includes(value.outcome.phase as string)
    || ![value.outcome.effectStarted, value.outcome.completed, value.outcome.checksStarted].every(item => typeof item === "boolean") || !strings(value.outcome.effects)) return null;
  if (value.postflight !== undefined && (!object(value.postflight) || value.postflight.version !== 1 || !object(value.postflight.refs) || !object(value.postflight.relationships) || !Array.isArray(value.postflight.issues))) return null;
  if (value.result !== undefined && (!object(value.result) || !keys(value.result, ["captured", "commit", "label"])
    || !isCapturedGitReview(value.result.captured) || !isGitReviewOid(value.result.commit) || !["Actual result", "Rebased feature changes"].includes(value.result.label as string))) return null;
  if (value.resourceResult !== undefined && (!object(value.resourceResult) || !keys(value.resourceResult, ["head", "registrations"])
    || !head(value.resourceResult.head, true) || !registrations(value.resourceResult.registrations))) return null;
  if (value.unavailableResult !== undefined && (value.result !== undefined || !isGitReviewUnavailableComparison(value.unavailableResult))) return null;
  if (!value.result && value.relation !== "unknown") return null;
  return value as unknown as GitReviewSettlement;
}
/** Result content must agree with the exact immutable proposal's settled report.
 * Caller still owns metadata linkage/ancestry and Git object validation. */
export function resolveGitReviewSettlement(proposal: GitReviewProposal, settlement: GitReviewSettlement): boolean {
  if (!settlement.result) return settlement.relation === "unknown";
  if (!proposal.baseline || !settlement.postflight || proposal.source.kind !== "git" || !settlement.outcome.completed
    || !settlement.outcome.effectStarted || settlement.outcome.phase !== "succeeded") return false;
  try {
    const result = gitReviewResult(proposal.baseline, settlement.postflight), captured = settlement.result.captured;
    return !!result && result.commit === settlement.result.commit && result.label === settlement.result.label
      && result.comparison.before === captured.comparison.before && result.comparison.after === captured.comparison.after
      && captured.repository.identity === proposal.source.captured.repository.identity
      && captured.repository.commonDirectory === proposal.source.captured.repository.commonDirectory;
  } catch { return false; }
}
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
