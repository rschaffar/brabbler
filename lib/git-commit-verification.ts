// Common server-only commit prerequisite. Working workspace, NEVER candidate-tree tests.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gitCommitWorkingWorkspaceReceiptReader } from "./git-checkout-verification";
import { gitCheckSyncValue } from "./git-check-runner";
import { gitWorkflowDefaultsPath } from "./git-workflow-store";
import { readGitWorkflowWriteEpoch } from "./git-workflow-write-epoch";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { selectGitProjectResources, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { readGitWorkflowSettingsDocument, projectWorkflowOverrides } from "./git-workflow-settings-store";
import { selectGitCheckRecipesForStage, validateGitCheckRecipes, MAX_GIT_WORKFLOW_CHECKS } from "./git-check-recipe";
import { validateGitWorkflowSettings, type GitWorkflowSettings, type GitWorkflowOverrides } from "./git-workflow-settings";
import { readGitCommitProtectedBoundary, type GitCommitProtectedBoundary, type GitCommitPreview } from "./git-commit";
export type { GitCommitProtectedBoundary } from "./git-commit";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Match the native checker's validated full settings profile. Saved recipe field
// order (including cwd/env) is not authority and must not split a genuine cohort.
// Validation retains omitted-stage semantics and rejects unknown/invalid fields.
const settingsDigest = (settings: GitWorkflowSettings) => digest(validateGitWorkflowSettings(settings));
export class GitCommitVerificationError extends Error {
  constructor(readonly code: "missing-context" | "missing-receipts" | "unavailable" | "denied" | "stale" | "unsupported-inheritance") {
    super(`Commit working-workspace verification ${code}.${code === "unsupported-inheritance" ? " Inherited Global/Chat commit recipes are not supported by the saved-Project-only check contract." : ""} Repository-required checks are not waived; the candidate tree was not tested.`);
  }
}
function refuse(code: GitCommitVerificationError["code"]): never { throw new GitCommitVerificationError(code); }
export interface GitCommitSourcePolicy {
  policyRevision: string;
  settings: GitWorkflowSettings;
  /** Actual independently read SAVED canonical source Project, not caller A/task/target. */
  savedProjectSettings: GitWorkflowOverrides;
}
/** Required native v3 contract for the checker owner. No v1/v2 relabelling adapter. */
export interface GitCommitWorkingWorkspaceReceipt {
  readonly kind: "selected-checkout-verification"; readonly version: 3;
  readonly evidenceScope: "working-workspace"; readonly candidateTreeVerified: false;
  readonly repositoryChecksWaived: false;
  readonly id: string; readonly sessionId: string; readonly selection: Readonly<GitProjectResources>;
  readonly checkIndex: number; readonly stage: "commit" | "integration" | "handoff" | "none";
  readonly policyRevision: string; readonly policyDigest: string;
  readonly finishedAt: number; readonly expiresAt: number; readonly exitStatus: 0;
}
export interface GitCommitReceiptValidationOptions {
  sessionId: string; agentDir: string; source: Readonly<GitProjectResources>; checkIndex: number; stage: "commit";
  sourceGetPolicy: GitCommitVerificationContext["sourceGetPolicy"];
  isTrusted: GitCommitVerificationContext["isTrusted"];
  isSelectionAuthorized: GitCommitVerificationContext["isSelectionAuthorized"];
  isCheckAuthorized: GitCommitVerificationContext["isCheckAuthorized"];
  readAuthorityRevisionSync?: () => string;
  signal?: AbortSignal;
  /** Allows ONLY this positively owned index.lock and reservation. Every other
   * marker/unsafe index flag remains refused. Source snapshot must be native v3
   * and include actual tracked/untracked content, modes and symlink bytes. */
  protectedBoundary?: GitCommitProtectedBoundary;
}
export interface GitCommitReceiptReader {
  /** Native lookup + cohort/current epoch + exact v3 source/policy/authority validation. */
  validate(id: string, options: GitCommitReceiptValidationOptions): Promise<GitCommitWorkingWorkspaceReceipt>;
  /** Repeat current epoch/cohort/expiry, source snapshot and synchronous authority
   * AFTER every await, immediately before CAS. Async authority callbacks require
   * readAuthorityRevisionSync; resolved promises are not a final guard. */
  assertCurrentSync(id: string, options: GitCommitReceiptValidationOptions): void;
}
export interface GitCommitVerificationContext {
  sessionId: string; agentDir: string; receiptIds: readonly string[];
  sourceGetPolicy: (source: Readonly<GitProjectResources>) => GitCommitSourcePolicy | Promise<GitCommitSourcePolicy>;
  isTrusted: (projectRoot: string) => boolean | Promise<boolean>;
  isSelectionAuthorized: (source: Readonly<GitProjectResources>) => boolean | Promise<boolean>;
  /** Independent check authority, never derived from commitScope or confirmation mode. */
  isCheckAuthorized: (receipt: GitCommitWorkingWorkspaceReceipt) => boolean | Promise<boolean>;
  readAuthorityRevisionSync?: () => string;
  signal?: AbortSignal;
  /** Direct node:test trusted native-reader simulation ONLY. No settings writes,
   * model/caller-supplied receipt objects, v2 adapter or production exemption. */
  testReceiptReader?: GitCommitReceiptReader;
}
export interface GitCommitVerificationSummary {
  readonly status: "no-defined" | "no-required" | "required";
  readonly checkIndexes: readonly number[]; readonly receiptIds: readonly string[];
  readonly evidenceScope: "working-workspace"; readonly candidateTreeVerified: false; readonly repositoryChecksWaived: false;
}
declare const evidenceBrand: unique symbol;
export type GitCommitVerificationHandle = Readonly<{ [evidenceBrand]: true }>;
interface Evidence {
  source: GitProjectResources; context?: GitCommitVerificationContext; agentDir: string;
  checksDigest: string; projectChecksDigest: string; discoveryRevision: string; summary: GitCommitVerificationSummary; reader?: GitCommitReceiptReader;
  ids: Map<number, string>; receipts: Map<number, GitCommitWorkingWorkspaceReceipt>; binding?: string;
  authorityRevision?: string; policyDigest?: string; policyRevision?: string;
}
const evidence = new WeakMap<GitCommitVerificationHandle, Evidence>();

/** Actual native v3 reader. No type assertion or old v2 relabelling adapter. */
function nativeReader(context: GitCommitVerificationContext): GitCommitReceiptReader {
  if (context.testReceiptReader && process.env.NODE_TEST_CONTEXT) return context.testReceiptReader;
  const reader: GitCommitReceiptReader = gitCommitWorkingWorkspaceReceiptReader;
  if (!reader || typeof reader.validate !== "function" || typeof reader.assertCurrentSync !== "function") refuse("unavailable");
  return reader;
}
function discoveryRevision(agentDir: string): string {
  let legacy: string | null = null;
  try { legacy = digest(readFileSync(gitWorkflowDefaultsPath(agentDir))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return digest([readGitWorkflowSettingsDocument(agentDir), legacy, readGitWorkflowWriteEpoch(agentDir)]);
}
function sourceProfile(policy: GitCommitSourcePolicy, projectChecksDigest: string): void {
  if (!policy || !policy.policyRevision || !policy.settings || !policy.savedProjectSettings) refuse("stale");
  const saved = validateGitCheckRecipes(policy.savedProjectSettings.checks ?? []);
  if (digest(saved) !== projectChecksDigest) refuse("stale");
  const effective = validateGitCheckRecipes(policy.settings.checks);
  if (digest(effective) !== projectChecksDigest) {
    if (selectGitCheckRecipesForStage(saved, "commit").length) refuse("stale");
    if (selectGitCheckRecipesForStage(effective, "commit").length) refuse("unsupported-inheritance");
  }
}
async function sourceChecks(source: GitProjectResources, agentDir: string, context?: GitCommitVerificationContext) {
  const document = readGitWorkflowSettingsDocument(agentDir);
  // Retains Phase-1 saved Project defaults when no modern Project record exists.
  const saved = await projectWorkflowOverrides(document, source.projectRoot, source.cwd, agentDir);
  const projectChecks = validateGitCheckRecipes(saved.checks ?? []), projectChecksDigest = digest(projectChecks);
  const ownsChecks = Object.hasOwn(saved, "checks");
  const inherited = ownsChecks ? [] : validateGitCheckRecipes(document.global.checks ?? []);
  // Selected Project resolution deliberately strips nonempty Global recipes.
  // Historical inherited commit definitions are UNSUPPORTED, never absent/waived.
  // This independent discovery happens even if every new callback is omitted.
  if (selectGitCheckRecipesForStage(inherited, "commit").length) refuse("unsupported-inheritance");
  let policy: GitCommitSourcePolicy | undefined;
  if (typeof context?.sourceGetPolicy === "function") {
    policy = await context.sourceGetPolicy(source);
    sourceProfile(policy, projectChecksDigest);
  }
  const checks = ownsChecks ? projectChecks : inherited;
  return { checks, checksDigest: digest(checks), projectChecksDigest, policy };
}
function binding(preview: GitCommitPreview, message: string): string {
  return digest([preview.repositoryRoot, preview.mode, preview.paths, preview.branch, preview.head, preview.tree, preview.reviewToken, message]);
}
function optionsFor(e: Evidence, checkIndex: number, protectedBoundary?: GitCommitProtectedBoundary): GitCommitReceiptValidationOptions {
  const c = e.context!;
  return { sessionId: c.sessionId, agentDir: c.agentDir, source: e.source, checkIndex, stage: "commit",
    sourceGetPolicy: c.sourceGetPolicy, isTrusted: c.isTrusted, isSelectionAuthorized: c.isSelectionAuthorized,
    isCheckAuthorized: c.isCheckAuthorized, readAuthorityRevisionSync: c.readAuthorityRevisionSync,
    signal: c.signal, protectedBoundary };
}
function validateReceipt(r: GitCommitWorkingWorkspaceReceipt, e: Evidence, id: string, index: number): void {
  const now = Date.now();
  if (!r || r.version !== 3 || r.kind !== "selected-checkout-verification" || r.evidenceScope !== "working-workspace" ||
      r.candidateTreeVerified !== false || r.repositoryChecksWaived !== false || r.id !== id || r.sessionId !== e.context!.sessionId ||
      r.checkIndex !== index || r.stage !== "commit" || r.exitStatus !== 0 || !Number.isSafeInteger(r.finishedAt) ||
      !Number.isSafeInteger(r.expiresAt) || now < r.finishedAt || now >= r.expiresAt ||
      JSON.stringify(r.selection) !== JSON.stringify(e.source)) refuse("stale");
}
function syncAuthorityValue<T>(value: T | Promise<T>): T {
  try { return gitCheckSyncValue(value); } catch { return refuse("stale"); }
}
function authorityRevision(e: Evidence): string | undefined {
  if (!e.context?.readAuthorityRevisionSync) return;
  const stamp = syncAuthorityValue(e.context.readAuthorityRevisionSync());
  if (typeof stamp !== "string" || !stamp || stamp.length > 512 || /[\x00-\x1f\x7f]/.test(stamp)) refuse("stale");
  return stamp;
}
function assertSourcePolicySync(e: Evidence): void {
  const c = e.context;
  if (!c || typeof c.sourceGetPolicy !== "function") return;
  if (c.readAuthorityRevisionSync) {
    if (authorityRevision(e) !== e.authorityRevision) refuse("stale");
  } else {
    const policy = syncAuthorityValue(c.sourceGetPolicy(e.source));
    sourceProfile(policy, e.projectChecksDigest);
    if (policy.policyRevision !== e.policyRevision || settingsDigest(policy.settings) !== e.policyDigest) refuse("stale");
  }
  if (c.signal?.aborted) refuse("stale");
}
function assertAuthoritySync(e: Evidence): void {
  const c = e.context!;
  if (c.readAuthorityRevisionSync) {
    if (authorityRevision(e) !== e.authorityRevision) refuse("stale");
  } else {
    // Exact synchronous live callbacks only. A Promise (even already resolved)
    // is not an authorization fence and requires the monotonic native revision.
    if (syncAuthorityValue(c.isTrusted(e.source.projectRoot)) !== true || syncAuthorityValue(c.isSelectionAuthorized(e.source)) !== true) refuse("stale");
    const policy = syncAuthorityValue(c.sourceGetPolicy(e.source));
    if (!policy || policy.policyRevision !== e.policyRevision || settingsDigest(policy.settings) !== e.policyDigest ||
        digest(validateGitCheckRecipes(policy.savedProjectSettings.checks ?? [])) !== e.projectChecksDigest) refuse("stale");
    sourceProfile(policy, e.projectChecksDigest);
    for (const r of e.receipts.values()) if (syncAuthorityValue(c.isCheckAuthorized(r)) !== true) refuse("stale");
  }
  if (c.signal?.aborted) refuse("stale");
}
async function validateEvidence(e: Evidence, protectedBoundary?: GitCommitProtectedBoundary): Promise<void> {
  const stamp = authorityRevision(e);
  if (e.authorityRevision !== undefined && stamp !== e.authorityRevision) refuse("stale");
  e.authorityRevision = stamp;
  await revalidateGitProjectResources(e.source);
  const actual = await sourceChecks(e.source, e.agentDir, e.context);
  if (actual.checksDigest !== e.checksDigest || actual.projectChecksDigest !== e.projectChecksDigest || discoveryRevision(e.agentDir) !== e.discoveryRevision) refuse("stale");
  if (actual.policy) {
    if (e.policyDigest !== undefined && (settingsDigest(actual.policy.settings) !== e.policyDigest || actual.policy.policyRevision !== e.policyRevision)) refuse("stale");
    e.policyDigest = settingsDigest(actual.policy.settings); e.policyRevision = actual.policy.policyRevision;
  }
  if (!e.summary.checkIndexes.length) { assertSourcePolicySync(e); return; }
  const c = e.context!;
  c.signal?.throwIfAborted();
  if (!await c.isTrusted(e.source.projectRoot) || !await c.isSelectionAuthorized(e.source)) refuse("denied");
  const policy = await c.sourceGetPolicy(e.source);
  sourceProfile(policy, e.projectChecksDigest);
  if (digest(validateGitCheckRecipes(policy.settings.checks)) !== e.checksDigest) refuse("stale");
  if (e.policyDigest !== undefined && (settingsDigest(policy.settings) !== e.policyDigest || policy.policyRevision !== e.policyRevision)) refuse("stale");
  e.policyDigest = settingsDigest(policy.settings); e.policyRevision = policy.policyRevision;
  if (protectedBoundary) {
    if (!readGitCommitProtectedBoundary(protectedBoundary, e.source, e.agentDir)) refuse("stale");
  }
  for (const index of e.summary.checkIndexes) {
    const id = e.ids.get(index)!;
    const r = await e.reader!.validate(id, optionsFor(e, index, protectedBoundary));
    validateReceipt(r, e, id, index);
    if (r.policyRevision !== policy.policyRevision || r.policyDigest !== settingsDigest(policy.settings) || !await c.isCheckAuthorized(r)) refuse("stale");
    e.receipts.set(index, r);
  }
  // The last awaited check authorization must precede an actual synchronous
  // source/epoch recapture even at capture and BEFORE publishing durable intent.
  for (const index of e.summary.checkIndexes) {
    e.reader!.assertCurrentSync(e.ids.get(index)!, optionsFor(e, index, protectedBoundary));
  }
  assertAuthoritySync(e);
  if (discoveryRevision(e.agentDir) !== e.discoveryRevision) refuse("stale");
}
/** Discover canonical SOURCE policy even when old callers omit new context.
 * Must run BEFORE prepareGitCommit/common capture, not just on new call paths. */
export async function captureGitCommitVerification(cwd: string, context?: GitCommitVerificationContext): Promise<{
  handle: GitCommitVerificationHandle; summary: GitCommitVerificationSummary;
}> {
  if (context?.testReceiptReader && !process.env.NODE_TEST_CONTEXT) refuse("unavailable");
  context = context ? { ...context, receiptIds: Array.isArray(context.receiptIds) ? [...context.receiptIds] : context.receiptIds } : undefined;
  const source = await selectGitProjectResources(cwd);
  for (const identity of Object.values(source.identities)) Object.freeze(identity);
  Object.freeze(source.identities); Object.freeze(source);
  const agentDir = context?.agentDir ?? getAgentDir();
  const revision = discoveryRevision(agentDir);
  const actual = await sourceChecks(source, agentDir, context);
  if (discoveryRevision(agentDir) !== revision) refuse("stale");
  const required = selectGitCheckRecipesForStage(actual.checks, "commit").map(({ checkIndex }) => checkIndex);
  if (required.length && (!context || !context.sessionId || !context.agentDir || typeof context.sourceGetPolicy !== "function" ||
      typeof context.isTrusted !== "function" || typeof context.isSelectionAuthorized !== "function" || typeof context.isCheckAuthorized !== "function")) refuse("missing-context");
  const ids = context?.receiptIds ?? [];
  if (!Array.isArray(ids) || ids.length > MAX_GIT_WORKFLOW_CHECKS || new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) refuse("missing-receipts");
  if (required.length && ids.length !== required.length) refuse("missing-receipts");
  const summary: GitCommitVerificationSummary = Object.freeze({ status: !actual.checks.length ? "no-defined" : !required.length ? "no-required" : "required",
    checkIndexes: Object.freeze(required), receiptIds: Object.freeze(required.length ? [...ids] : []), evidenceScope: "working-workspace",
    candidateTreeVerified: false, repositoryChecksWaived: false });
  const e: Evidence = { source, agentDir, discoveryRevision: revision,
    context: context ? { ...context, receiptIds: [...ids] } : undefined, checksDigest: actual.checksDigest, projectChecksDigest: actual.projectChecksDigest,
    summary, ids: new Map(), receipts: new Map(), reader: required.length ? nativeReader(context!) : undefined };
  // IDs need not be in saved-index order. Native validation selects the exact
  // original saved index, never filtered-array numbering.
  const unused = new Set(ids);
  for (const index of required) {
    let matched: string | undefined;
    for (const id of unused) {
      try {
        const r = await e.reader!.validate(id, optionsFor(e, index));
        validateReceipt(r, e, id, index); matched = id; break;
      } catch { /* exact native match or fail closed below */ }
    }
    if (!matched) refuse("stale");
    e.ids.set(index, matched); unused.delete(matched);
  }
  await validateEvidence(e);
  const handle = Object.freeze(Object.create(null)) as GitCommitVerificationHandle;
  evidence.set(handle, e);
  return { handle, summary };
}
/** Seal exact authenticated preview + message only after native capture succeeds. */
export function bindGitCommitVerification(handle: GitCommitVerificationHandle, preview: GitCommitPreview, message: string): void {
  const e = evidence.get(handle);
  if (!e || e.binding || e.source.cwd !== preview.repositoryRoot || `refs/heads/${e.source.branch}` !== preview.branch) refuse("stale");
  e.binding = binding(preview, message);
}
/** Old apply calls still discover prerequisites independently; omission cannot skip them. */
export async function revalidateGitCommitVerification(handle: GitCommitVerificationHandle, preview: GitCommitPreview, message: string,
  protectedBoundary?: GitCommitProtectedBoundary, sessionId?: string): Promise<() => void> {
  const e = evidence.get(handle);
  if (!e || e.binding !== binding(preview, message) ||
      e.summary.checkIndexes.length && sessionId !== undefined && e.context?.sessionId !== sessionId) refuse("stale");
  if (protectedBoundary) {
    const b = readGitCommitProtectedBoundary(protectedBoundary, e.source, e.agentDir);
    if (!b || binding(b.preview, b.message) !== e.binding) refuse("stale");
  }
  await validateEvidence(e, protectedBoundary);
  return () => {
    if (e.context?.signal?.aborted || e.binding !== binding(preview, message) || discoveryRevision(e.agentDir) !== e.discoveryRevision) refuse("stale");
    if (protectedBoundary) {
      const b = readGitCommitProtectedBoundary(protectedBoundary, e.source, e.agentDir);
      if (!b || binding(b.preview, b.message) !== e.binding) refuse("stale");
    }
    for (const index of e.summary.checkIndexes) {
      const r = e.receipts.get(index)!;
      validateReceipt(r, e, e.ids.get(index)!, index);
      e.reader!.assertCurrentSync(e.ids.get(index)!, optionsFor(e, index, protectedBoundary));
    }
    if (e.summary.checkIndexes.length) assertAuthoritySync(e);
    else assertSourcePolicySync(e);
  };
}
