import { lstatSync, realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { bindingDigest, readBindingFile } from "./git-workflow-binding-io";
import { getAllowedFileRoots, getKnownAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { gitExecEnv } from "./git-exec";
import { managedGitSessionFacts } from "./git-workflow-access";
import { loadGitWorkflowSettings, readGitWorkflowSettingsDocument, gitWorkflowSettingsPath } from "./git-workflow-settings-store";
import { resolveGitWorkflowSettings, validateGitWorkflowSettings } from "./git-workflow-settings";
import { readManagedSessionGitWorkflow, workflowTaskFromEntries } from "./git-workflow-session";
import { readGitProjectSessionSettings } from "./git-project-session";
import { readGitWorkflowWriteEpoch } from "./git-workflow-write-epoch";
import { loadGitProjectSettings } from "./git-project-settings";
import { readProjectAuthorization, projectAuthorizationPath, type ProjectAuthorizationOwner } from "./git-project-authorization";
import { getProjectTrustStatus } from "./project-trust";
import { selectCanonicalGitResources, selectGitProjectResources, revalidateGitProjectResources,
  withGitProjectReview, type GitProjectResources, type GitResourceSelector } from "./git-project-resources";
import { prepareGitPreparationApply, applyGitPreparation, readGitPreparationCompletion, type GitPreparedApply } from "./git-preparation-apply";
import { preflightGitPreparation } from "./git-preparation";
import { prepareSelectedIntegration, confirmSelectedIntegration, readSelectedIntegrationNativeProof,
  type SelectedIntegrationPlan } from "./git-selected-integration";
import { getGitTreeDiff, reviewGitBranches, getGitReviewDiff, type GitReview, type GitReviewDiff } from "./git-review";
import { withGitCheckoutGate } from "./git-checkout-gate";
import { lookupGitCheckoutVerificationReceipt, runGitCheckoutVerification, validateGitCheckoutVerificationReceipt, GitCheckoutVerificationError,
  readGitCheckoutVerificationNativeExecution,
  captureGitCheckoutCheckRecoverySnapshot, invalidateGitCheckoutVerificationReceiptsForCheckout,
  type GitCheckoutVerificationReceipt, type GitCheckoutCheckBinding } from "./git-checkout-verification";
import { createGitCheckAuthorityFence } from "./git-check-authority-fence";
import { gitCheckDigest, gitCheckRunningCheckouts } from "./git-check-runner";
import { normalizeGitCheckRecipe, selectGitCheckRecipesForStage, validateGitCheckRecipes } from "./git-check-recipe";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";
import * as workspaceNative from "./git-workspace-operation";
import * as preparationNative from "./git-preparation-apply";
import { captureGitWorkspaceOperation, applyGitWorkspaceOperation, readGitWorkspaceNativeProof,
  type GitWorkspaceCandidate, type GitWorkspaceCompletedProof, type GitWorkspaceAdmission } from "./git-workspace-operation";
import { createGitWorkspaceAdmission } from "./git-workspace-admission";
import { createGitCleanupAdmission } from "./git-cleanup-admission";
import * as cleanupNative from "./git-cleanup-operation";
import * as checkoutNative from "./git-checkout-verification";
import { createGitCleanupEngine, GitCleanupOperationError, type GitCleanupCandidate, type GitCleanupCompletedProof,
  type GitCleanupRemovalProof, type GitCleanupEvidence, type GitCleanupFailure, type GitCleanupDurableAck } from "./git-cleanup-operation";
import { createTrustedWorkspaceUsage, GitWorkspaceUsageError } from "./git-workspace-usage";
import { readRpcWorkspaceSessionUsage, getRpcSession } from "./rpc-manager";
import { readTerminalWorkspaceUsage } from "./terminal-manager";
import { basename } from "node:path";
import { captureSelectedOperationAuthorization } from "./git-selected-operation-authorization";
import type { GitCommitVerificationContext } from "./git-commit-verification";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent, inspectGitOperationAdmission,
  readGitOperationReservationOwner, type GitOperationReservation } from "./git-operation-admission";
import { beginGitAction, beginGitActionWithId, gitActionSink, gitActionAttribution, snapshotGitPreparationAction,
  snapshotGitWorkspaceAction, snapshotGitCheckoutVerificationAction, snapshotGitCleanupAction, recordVerifiedCleanupRemoval,
  finishVerifiedNativeGitAction, finishGitAction, failGitAction } from "./git-action-controller";
import { readGitAction } from "./git-action-journal";
import { GIT_ACTION_ID_PATTERN, type GitActionOutcome, type GitActionNativeOutcome, type GitActionCandidateSnapshot, type GitActionCheckExecution } from "./git-action-types";
import { createGitSelectedOperationRegistry } from "./git-selected-operation-registry";
import { createGitSelectedOperationController, type SelectedControllerOperation, type SelectedControllerRequests,
  type SelectedNativeAdapter, type SelectedNativeCandidate, type SelectedNativeExecution, type SelectedCompletionEnvelope,
  type SelectedPreparationOrderingRequirement, type SelectedJournalAdmissionFactory, type SelectedOperationResult } from "./git-selected-operation-controller";
import type { SelectedOperationCaller, SelectedOperationCurrent, SelectedOperationReaders } from "./git-selected-operation-authorization";
import type { GitPreparationReentryState, GitPreparationReentryLaunch } from "./git-preparation-reentry";
import type { GitActionCandidate, SessionEntry } from "./types";

const digest = (value: unknown) => {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, stable((v as Record<string, unknown>)[key])])) : v;
  return bindingDigest(stable(value === undefined ? null : JSON.parse(JSON.stringify(value))));
};
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const oid = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
class RuntimeRefusal extends Error { constructor(readonly code: string) { super(code); } }
/** Fixed internal refusal only; never disclose arbitrary Git/SDK error text. */
export function readGitSelectedRuntimeRefusal(cause: unknown): string | undefined {
  return cause instanceof RuntimeRefusal ? cause.code : undefined;
}
const refusalContext = new AsyncLocalStorage<{ code?: string }>();
function refuse(code: string): never { const context = refusalContext.getStore(); if (context) context.code = code; throw new RuntimeRefusal(code); }
function physical(path: string) {
  const s = lstatSync(path, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(path) !== path || resolve(path) !== path) refuse("physical-caller-required");
  return { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) };
}
function absent(path: string): boolean {
  try { lstatSync(path); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw e; }
}
export type SelectedRuntimeManager = Pick<SessionManager, "getSessionId" | "getSessionFile" | "getCwd" | "getHeader" | "getEntries"> &
  Partial<Pick<SessionManager, "isPersisted" | "getBranch">>;
export interface GitSelectedOperationRuntimeContext {
  sessionCwd: string; manager: SelectedRuntimeManager;
  effectiveTools(): readonly string[] | undefined;
  /** Host writer epoch; advance BEFORE every SDK tools/selection mutation.
   * Mandatory without a live RPC wrapper and its registered writer fence. */
  readSelectionRevisionSync?(): string;
  appendEntry(type: string, data: unknown): void;
  ask(candidate: GitActionCandidate): Promise<boolean>;
  isCancelled(): boolean;
  /** Trusted deployment root only, never tool input. Must match journal root. */
  agentDir?: string;
}

/** Current absence is a positive bounded physical ancestry proof, NOT a caught
 * Git discovery failure. A .git marker (including broken links), bare metadata,
 * unreadable ancestor or ambiguous repository always fails closed. */
export async function readSelectedRuntimeCurrent(cwd: string): Promise<SelectedOperationCurrent> {
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots)) refuse("caller-root-denied");
  const id = physical(cwd), ancestry: unknown[] = [];
  let path = cwd;
  for (let depth = 0; depth < 256; depth++) {
    const instance = physical(path);
    if (!absent(join(path, ".git"))) {
      const resources = await selectGitProjectResources(path);
      if (!same(instance, physical(path)) || !same(id, physical(cwd))) refuse("caller-identity-changed");
      return { kind: "git", resources };
    }
    // A bare/partly initialized repository is not a non-Git caller.
    if (!absent(join(path, "HEAD")) && (!absent(join(path, "objects")) || !absent(join(path, "config")))) refuse("caller-git-state-unknown");
    ancestry.push([path, instance]);
    if (dirname(path) === path) {
      for (const row of ancestry as [string, unknown][]) {
        if (!same(physical(row[0]), row[1]) || !absent(join(row[0], ".git"))) refuse("caller-identity-changed");
      }
      return { kind: "non-git", cwd, identity: id, noRepository: { verified: true, revision: digest(ancestry) } };
    }
    path = dirname(path);
  }
  return refuse("caller-git-state-unknown");
}

/** Pure descriptor read: SessionManager.open can migrate old JSONL on read; do
 * not use it for bootstrap. Pin the original file INSTANCE across all requests. */
function persisted(context: GitSelectedOperationRuntimeContext, owner: ProjectAuthorizationOwner, instance?: unknown) {
  const m = context.manager;
  if (context.isCancelled() || m.isPersisted?.() === false || m.getSessionId() !== owner.sessionId || m.getSessionFile() !== owner.sessionFile ||
    m.getCwd() !== owner.sessionCwd || m.getHeader()?.id !== owner.sessionId || m.getHeader()?.cwd !== owner.sessionCwd ||
    realpathSync(owner.sessionFile) !== owner.sessionFile) refuse("persisted-owner-required");
  const file = readBindingFile(owner.sessionFile, 16 * 1024 * 1024, true);
  if (instance && !same(instance, file.identity)) refuse("persisted-owner-replaced");
  const rows = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes).trimEnd().split("\n").map((line) => JSON.parse(line));
  const header = rows.shift();
  if (header?.type !== "session" || header.version !== 3 || header.id !== owner.sessionId || header.cwd !== owner.sessionCwd || !same(header, m.getHeader())) refuse("persisted-header-mismatch");
  const entries = m.getEntries() as unknown as SessionEntry[], disk = rows as SessionEntry[];
  const relevant = (e: readonly SessionEntry[]) => ({ managed: readManagedSessionGitWorkflow(e), task: workflowTaskFromEntries(e),
    scoped: [...readGitProjectSessionSettings(e)], subagent: managedGitSessionFacts(e, []).subagent });
  if (!same(relevant(entries), relevant(disk))) refuse("persisted-caller-state-mismatch");
  return { identity: file.identity, header, entries, disk };
}

/** Deny-only restart observation. Inspect durable managed preparation artifacts
 * and native recovery records independently of this generation's WeakMaps.
 * No historical action can issue a revisionDependency or grant. */
export async function readSelectedRuntimePreparationOrdering(source: GitProjectResources, agentDir = getAgentDir()): Promise<SelectedPreparationOrderingRequirement> {
  try {
    await revalidateGitProjectResources(source);
    const tip = await withGitProjectReview(source, async (repo) => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      if (typeof repo === "string") refuse("physical-source-required");
      return (await promisify(execFile)("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`, `--work-tree=${repo.cwd}`,
        "rev-parse", "HEAD^{commit}"], { encoding: "utf8", env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir }, timeout: 15000, maxBuffer: 4096 })).stdout.trim();
    });
    if (!oid(tip)) return { kind: "unknown" };
    let required = false;
    const evidence: unknown[] = [];
    const directory = async (parts: string[]) => {
      let path = agentDir; physical(path);
      for (const part of parts) { path = join(path, part); if (absent(path)) return []; physical(path); }
      return await readdir(path);
    };
    const history = join(agentDir, "pi-web", "git-actions", "v1");
    for (const id of await directory(["pi-web", "git-actions", "v1"])) {
      if (!GIT_ACTION_ID_PATTERN.test(id)) return { kind: "unknown" };
      physical(join(history, id));
      const action = await readGitAction(id, { includeArtifact: true }, agentDir);
      if (!action.record || action.unavailable || !action.candidate) return { kind: "unknown" };
      const c = action.candidate, attribution = c.resourceAttribution;
      if (c.kind !== "preparation") continue;
      if (!attribution || !c.preparation) return { kind: "unknown" };
      if (same(attribution.commonIdentity, source.identities.common) && same(attribution.projectIdentity, source.identities.project) &&
        same(c.preparation.source.checkoutIdentity, source.identities.checkout)) {
        evidence.push([id, action.record.state, c.preparation, action.record.outcome]);
        if (c.preparation.oldSourceOid !== c.preparation.newSourceOid && ["executing", "recovery-required", "succeeded"].includes(action.record.state)) required = true;
      }
    }
    const recovery = join(agentDir, "pi-web", "git-preparation-recovery", "v1");
    for (const name of await directory(["pi-web", "git-preparation-recovery", "v1"])) {
      if (/^hooks-[a-f0-9-]+$/.test(name)) { physical(join(recovery, name)); continue; }
      if (!/^[a-f0-9-]+\.(json|index)(\.(outcome|partial))?$/.test(name)) return { kind: "unknown" };
      if (!name.endsWith(".json")) continue;
      const data = JSON.parse(readBindingFile(join(recovery, name), 1024 * 1024, true).bytes.toString("utf8"));
      if (data?.version !== 1 || !data.source?.identities || !data.candidate) return { kind: "unknown" };
      if (same(data.source.identities.checkout, source.identities.checkout) && same(data.source.identities.common, source.identities.common)) {
        required = true; evidence.push([name, data.actionId, data.candidate.oldSourceOid, data.candidate.newSourceOid]);
      }
    }
    await revalidateGitProjectResources(source);
    return { kind: required ? "required" : "independent", source, sourceOid: tip, evidenceRevision: digest(evidence) };
  } catch { return { kind: "unknown" }; }
}

/** Missing mandatory adapters remain visible refusals. They are NOT dummy native
 * engines, optional authorization, or optimistic successful capability claims. */
export const SELECTED_RUNTIME_BLOCKERS = Object.freeze({
  workspace: "workspace-synchronous-leaf-authority-unavailable",
  prepare: "preparation-synchronous-leaf-authority-unavailable",
  verify: "native-check-execution-reader-unavailable",
  cleanup: "cleanup-synchronous-leaf-authority-unavailable",
  reconcile: "independent-consumed-launch-recovery-reader-unavailable",
});

type Capture = { candidate: SelectedNativeCandidate; prepared?: GitPreparedApply; plan?: SelectedIntegrationPlan;
  workspace?: GitWorkspaceCandidate; workspaceProof?: GitWorkspaceCompletedProof; workspaceAdmission?: GitWorkspaceAdmission;
  cleanupEngine?: ReturnType<typeof createGitCleanupEngine>; cleanupCandidate?: GitCleanupCandidate; cleanupEvidence?: GitCleanupEvidence;
  cleanupProof?: GitCleanupCompletedProof; removal?: GitCleanupRemovalProof; cleanupFailure?: GitCleanupFailure;
  cleanupAdapters?: import("./git-selected-operation-controller").SelectedJournalAdmission["cleanup"];
  checks?: { binding: GitCheckoutCheckBinding; snapshot: Awaited<ReturnType<typeof captureGitCheckoutCheckRecoverySnapshot>>; executionCwd: string }[];
  reconcileSnapshot?: Awaited<ReturnType<typeof preflightGitPreparation>>; reconciliationReview?: GitReview; reconciliationDiff?: GitReviewDiff;
  workspaceFailure?: { cause: object; facts: import("./git-workspace-operation").GitWorkspaceFailureEvidence };
  exactApproval?: boolean;
  usageToken?: object;
  receipts?: GitCheckoutVerificationReceipt[];
  runs?: Readonly<GitActionCheckExecution>[];
  authorityGuard?: () => void;
  before?: GitPreparationReentryState; executing?: SelectedNativeExecution; executingStarted: boolean };

export function createGitSelectedOperationRuntime(context: GitSelectedOperationRuntimeContext) {
  const agentDir = context.agentDir ?? getAgentDir();
  if (process.platform !== "linux" || agentDir !== getAgentDir()) refuse("native-runtime-root-unavailable");
  const m = context.manager, file = m.getSessionFile();
  if (!file) refuse("persisted-owner-required");
  const owner = Object.freeze({ sessionId: m.getSessionId(), sessionFile: file, sessionCwd: context.sessionCwd });
  const instance = persisted(context, owner).identity;
  const cleanupProofs = new WeakMap<object, GitCleanupCompletedProof>();
  const recoveryProofs = new WeakMap<object, { before: GitPreparationReentryState; after: GitPreparationReentryState; previousLaunch?: GitPreparationReentryLaunch }>();
  // Original native rows retained only after the invocation RETURNS. Storage
  // grants nothing: the independent reader requires durable history/admission
  // and containment anew on EVERY use; rows are never adopted from history.
  const consumedChecks = new WeakMap<GitPreparationReentryLaunch, Capture>();
  const noEffectProofs = new WeakMap<object, Extract<SelectedCompletionEnvelope["completion"], { operation: "prepare" }>["result"]>();
  const registry = createGitSelectedOperationRegistry(owner, { readCleanupProof: (h) => cleanupProofs.get(h), readRecoveryProof: (h) => recoveryProofs.get(h),
    readPreparationNoEffect: (h) => noEffectProofs.get(h) });
  const captures = new Map<string, Capture>();
  const activateActions = new Map<string, () => Promise<void>>();
  const readOwner = () => persisted(context, owner, instance);
  const trusted = (r: Readonly<GitProjectResources>) => getProjectTrustStatus(r.projectRoot, agentDir).trusted && getProjectTrustStatus(r.cwd, agentDir).trusted;
  const writerRevision = () => {
    const live = getRpcSession(owner.sessionId);
    const revision = context.readSelectionRevisionSync ? context.readSelectionRevisionSync() :
      live?.isAlive() ? live.readGitCheckAuthorityRevisionSync?.() : undefined;
    if (revision !== undefined && (typeof revision !== "string" || !revision || revision.length > 512 || /[\x00-\x1f\x7f]/.test(revision))) refuse("known-monotonic-authority-required");
    return revision;
  };
  const readers: SelectedOperationReaders = {
    readResources: selectCanonicalGitResources,
    async readCaller() {
      const originalWriterRevision = writerRevision();
      const saved = readOwner(), tools = context.effectiveTools();
      if (!tools || !Array.isArray(tools)) refuse("effective-tools-required");
      const facts = managedGitSessionFacts(saved.entries, tools), current = await readSelectedRuntimeCurrent(owner.sessionCwd);
      const chat = await loadGitWorkflowSettings(undefined, saved.entries, agentDir, owner.sessionId);
      // Legacy explicit opt-out remains a negative restriction, never task consent.
      if (chat.task.kind === "legacy" && chat.task.policy === null) chat.optedOut = true;
      let policy = chat;
      if (current.kind === "git") {
        const canonical = await loadGitProjectSettings(current.resources as GitProjectResources, saved.entries, agentDir, owner.sessionId);
        policy = { ...canonical, task: chat.task, session: chat.session, optedOut: chat.optedOut,
          revision: digest([canonical.revision, chat.revision]), resolved: { ...canonical.resolved,
            session: resolveGitWorkflowSettings(canonical.global, canonical.project, chat.session ?? {}) } };
      }
      readOwner();
      if (writerRevision() !== originalWriterRevision) refuse("authority-changed-during-caller-capture");
      return { persisted: true, current, facts, policy,
        revision: digest([saved.identity, saved.header, current, facts, policy.revision, originalWriterRevision]) } as SelectedOperationCaller;
    },
    async readPolicy(r) { return loadGitProjectSettings(r, readOwner().entries, agentDir, owner.sessionId); },
    async readAuthorization(r) { readOwner(); return readProjectAuthorization(r, owner, agentDir); },
    revalidateResources: revalidateGitProjectResources,
    async readCurrentPolicy(r) { return loadGitProjectSettings(r as GitProjectResources, readOwner().entries, agentDir, owner.sessionId); },
    async readCurrentAuthorization(r) { readOwner(); return readProjectAuthorization(r as GitProjectResources, owner, agentDir); },
    async revalidateCurrent(current) { readOwner(); if (!same(current, await readSelectedRuntimeCurrent(owner.sessionCwd))) refuse("caller-classification-changed"); },
  };
  // A final synchronous comparison for integration's post-await guard. This is
  // not the monotonic all-revocations checker provider; checks remain refused.
  function syncAuthority(resources: readonly GitProjectResources[]) {
    const caller = readOwner();
    const fileState = (path: string) => {
      if (absent(path)) return "absent";
      const f = readBindingFile(path, 4 * 1024 * 1024, true); return [f.identity, f.fingerprint, digest(f.bytes.toString("base64"))];
    };
    return digest([caller.identity, caller.header, readManagedSessionGitWorkflow(caller.entries), workflowTaskFromEntries(caller.entries),
      [...readGitProjectSessionSettings(caller.entries)], managedGitSessionFacts(caller.entries, context.effectiveTools()),
      readGitWorkflowWriteEpoch(agentDir), fileState(gitWorkflowSettingsPath(agentDir)), fileState(projectAuthorizationPath(agentDir)),
      readGitWorkflowSettingsDocument(agentDir), getKnownAllowedFileRoots(), resources.map((r) => [trusted(r), physical(r.cwd), physical(r.projectRoot), physical(r.gitDir), physical(r.commonDir)])]);
  }
  const register = (saved: Capture) => {
    if (saved.candidate.operation === "workspace" || saved.candidate.operation === "prepare" || saved.candidate.operation === "reconcile") {
      saved.authorityGuard ??= captureAuthorityGuard(saved.candidate.source, ...(saved.candidate.target ? [saved.candidate.target] : []));
    }
    captures.set(saved.candidate.revision, saved);
    if (saved.candidate.operation !== "cleanup") {
      saved.usageToken = {}; selectedUsage().set(saved.usageToken, [saved.candidate.source.cwd, ...(saved.candidate.target ? [saved.candidate.target.cwd] : [])]);
    }
    return registry.capture(saved.candidate, saved);
  };
  const authorityFence = (resources: readonly GitProjectResources[]) => {
    const savedFence = createGitCheckAuthorityFence({
      scope: { sessionId: owner.sessionId, sessionFile: owner.sessionFile, cwd: owner.sessionCwd }, agentDir,
      checkouts: [...new Set(resources.flatMap((r) => [r.projectRoot, r.cwd]))],
    });
    return () => {
      if (!context.readSelectionRevisionSync && !getRpcSession(owner.sessionId)?.isAlive()) refuse("live-monotonic-authority-provider-unavailable");
      const revision = context.readSelectionRevisionSync?.();
      if (context.readSelectionRevisionSync && (typeof revision !== "string" || !revision || revision.length > 512 || /[\x00-\x1f\x7f]/.test(revision))) refuse("known-monotonic-authority-required");
      return digest([savedFence(), syncAuthority(resources), revision]);
    };
  };
  const captureAuthorityGuard = (source: GitProjectResources, ...additional: GitProjectResources[]) => {
    const fence = authorityFence([source, ...additional]), expected = fence();
    return () => { if (fence() !== expected) refuse("live-authority-changed-at-native-boundary"); };
  };
  const checkAuthority = async (source: GitProjectResources) => {
    const result = await captureSelectedOperationAuthorization({ action: "checks", owner, selector: selector(source),
      requestId: "native-receipt-authority", requestRevision: digest(source), confirmation: "ask" }, readers);
    if (result.kind !== "evidence") refuse(result.kind === "blocked" ? result.code : "check-authority-unavailable");
  };
  const savedSourceCheckPolicy = async (source: GitProjectResources) => {
    const p = await readers.readPolicy(source, owner);
    if (!same(validateGitCheckRecipes(p.project.checks ?? []), p.resolved.session.values.checks)) refuse("saved-source-project-check-recipes-required");
    return p;
  };
  const checkOptions = (source: GitProjectResources, checkIndex: number, stage: GitCheckoutCheckBinding["stage"], execution?: SelectedNativeExecution) => ({
    sessionId: owner.sessionId, selector: selector(source), agentDir, checkIndex, stage, actionId: execution?.actionId,
    getPolicy: async () => { const p = await savedSourceCheckPolicy(source); return { policyRevision: p.revision, settings: validateGitWorkflowSettings(p.resolved.session.values) }; },
    isSelectionAuthorized: async () => {
      readOwner(); await revalidateGitProjectResources(source); const roots = await getAllowedFileRoots();
      return isExistingFilePathAllowed(source.projectRoot, roots) && isExistingFilePathAllowed(source.cwd, roots);
    },
    isTrusted: () => trusted(source),
    isActorAuthorized: async () => { if (execution) await execution.authorize(); else await checkAuthority(source); return true; },
    readAuthorityRevisionSync: authorityFence([source]),
  });
  const assertConsumedCheck = async (launch: GitPreparationReentryLaunch, source: GitProjectResources, target: GitProjectResources) => {
    const saved = consumedChecks.get(launch), execution = saved?.executing;
    if (!saved?.runs?.length || !execution || execution.previousLaunch !== launch) refuse("independent-consumed-launch-recovery-reader-unavailable");
    if (!same(saved.candidate.source, source) || !same(saved.candidate.target, target)) refuse("consumed-check-resources-changed");
    if (saved.runs.some((row) => readGitCheckoutVerificationNativeExecution(row) !== row ||
      row.actionId !== execution.actionId || row.sessionId !== owner.sessionId || !row.containmentComplete || row.timedOut || row.overflow)) refuse("consumed-check-containment-not-proven");
    const durable = await readGitAction(execution.actionId, { includeArtifact: true }, agentDir);
    if (durable.unavailable || !durable.record || durable.record.state !== "failed" || durable.record.sessionId !== owner.sessionId ||
      !same(durable.candidate, saved.candidate.history) || !same(durable.record.outcome?.checkoutVerification?.runs, saved.runs)) refuse("independent-consumed-check-history-required");
    readOwner();
    try { await assertGitOperationAdmission(source, agentDir); await assertGitOperationAdmission(target, agentDir); }
    catch { refuse("consumed-check-independent-admission-required"); }
  };
  const base = {
    readCandidate: registry.readCandidate, readNativeCompletion: registry.readNativeCompletion,
    readNativeFailure: registry.readNativeFailure,
    retire(handle: object) { const saved = registry.readCapture<Capture>(handle); if (saved) {
      captures.delete(saved.candidate.revision); if (saved.executing) activateActions.delete(saved.executing.actionId);
      if (saved.usageToken) selectedUsage().delete(saved.usageToken);
    } registry.retire(handle); },
    async assertExact(handle: object) {
      const saved = registry.readCapture<Capture>(handle); if (!saved) refuse("native-capture-retired");
      if (saved.candidate.operation !== "cleanup" || !saved.removal) await revalidateGitProjectResources(saved.candidate.source);
      else if (!absent(saved.candidate.source.cwd) || !absent(saved.candidate.source.gitDir)) refuse("removed-source-replaced");
      if (saved.candidate.target) await revalidateGitProjectResources(saved.candidate.target);
      if (saved.checks && !saved.executingStarted) for (const check of saved.checks) {
        if (!same(check.snapshot, await captureGitCheckoutCheckRecoverySnapshot(saved.candidate.source, check.binding, true))) refuse("native-check-snapshot-stale");
      }
      // After launch the native engine owns the ONLY permitted progress (owned
      // index lock/read-tree/ref CAS). It independently validates the exact
      // original inventory and its measured progress before each callback.
      if (!saved.executingStarted && saved.prepared && !same(saved.prepared.snapshot,
        await preflightGitPreparation({ source: selector(saved.candidate.source), target: selector(saved.candidate.target!) }, agentDir))) refuse("native-capture-stale");
    },
  };
  const workspace: SelectedNativeAdapter<"workspace"> = { ...base,
    async capture(request) {
      requireLeaf(workspaceNative, "applyGitWorkspaceOperationWithAuthority", SELECTED_RUNTIME_BLOCKERS.workspace);
      const source = await readers.readResources(request.selector), policy = await readers.readPolicy(source, owner);
      const authorityGuard = captureAuthorityGuard(source);
      const bridge: { saved?: Capture; proof?: GitWorkspaceCompletedProof } = {};
      const admission = createGitWorkspaceAdmission({ agentDir,
        async onIntent(e) {
          const execution = bridge.saved?.executing;
          if (!execution || e.actionId !== execution.actionId || !same(e.request, bridge.saved?.workspace?.request)) refuse("native-intent-correlation-required");
          await activateActions.get(execution.actionId)?.();
        },
        async onCompleted(proof) {
          if (!bridge.proof || !same(bridge.proof, proof) || !readGitWorkspaceNativeProof(bridge.proof)) refuse("actual-native-workspace-proof-required");
          await bridge.saved!.executing!.onNativeCompleted(bridge.proof);
        },
        async onFailure(facts) {
          const execution = bridge.saved?.executing;
          if (execution) { const cause = new RuntimeRefusal("workspace-partial-state");
            registry.failure(cause, { kind: "partial", actionId: execution.actionId, candidateRevision: bridge.saved!.candidate.revision, recoveryRequired: true, workspace: facts });
            bridge.saved!.workspaceFailure = { cause, facts }; }
        },
      });
      const wrapped: GitWorkspaceAdmission = { assertAdmission: admission.assertAdmission,
        async beginIntent(e) { const intent = await admission.beginIntent(e); return { ...intent,
          async completed(proof) { bridge.proof = proof; if (bridge.saved) bridge.saved.workspaceProof = proof; await intent.completed(proof); } }; } };
      const native = await captureGitWorkspaceOperation(request.workspace, wrapped);
      const candidate: SelectedNativeCandidate = { operation: "workspace", source, sourceOid: native.sourceOid,
        actionId: native.actionId, policyRevision: policy.revision, history: snapshotGitWorkspaceAction(source, native),
        revision: digest([source, native, policy.revision]), ...(native.parentCreation ? { parentCreation: native.parentCreation } : {}) };
      bridge.saved = { candidate, workspace: native, workspaceAdmission: wrapped, authorityGuard, executingStarted: false };
      return register(bridge.saved);
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.workspace) refuse("native-workspace-capture-required");
      saved.executing = execution; saved.executingStarted = true;
      let result;
      const guard = saved.authorityGuard;
      const apply = requireLeaf<(options: Parameters<typeof applyGitWorkspaceOperation>[0] & { assertCurrentSync(): void }) => ReturnType<typeof applyGitWorkspaceOperation>>(
        workspaceNative, "applyGitWorkspaceOperationWithAuthority", SELECTED_RUNTIME_BLOCKERS.workspace);
      try { result = await apply({ candidate: saved.workspace,
        authorize: async () => { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); await execution.authorize(); guard(); },
        assertCurrentSync() { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); } }); }
      catch (cause) { if (cause && typeof cause === "object" && saved.workspaceFailure) registry.failure(cause, {
        kind: "partial", actionId: execution.actionId, candidateRevision: saved.candidate.revision, recoveryRequired: true, workspace: saved.workspaceFailure.facts }); throw cause; }
      const proof = saved.workspaceProof; if (!proof || !readGitWorkspaceNativeProof(proof)) refuse("actual-native-workspace-proof-required");
      return registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
        completedAt: performance.now(), completion: { operation: "workspace", result, proof,
          creation: { mode: proof.mode, destination: proof.destination, originalSource: saved.candidate.source, branchRef: proof.branchRef } } }, proof);
    },
  };
  const verification: SelectedNativeAdapter<"verify"> = { ...base,
    async capture(request, c) {
      if (typeof Reflect.get(checkoutNative, "readGitCheckoutVerificationNativeExecution") !== "function") refuse("native-check-execution-reader-unavailable");
      if (!c.checks) refuse("saved-check-selection-required");
      const source = await readers.readResources(request.selector), policy = await savedSourceCheckPolicy(source);
      const head = await commitOid(source), sourceTree = await treeOid(source, head);
      const rows: NonNullable<Capture["checks"]> = [];
      for (const checkIndex of c.checks.checkIndexes) {
        const recipe = policy.resolved.session.values.checks[checkIndex]; if (!recipe) refuse("saved-check-index-required");
        const normalized = normalizeGitCheckRecipe(recipe), executionCwd = join(source.cwd, normalized.cwd);
        physical(executionCwd);
        const environmentDigest = gitCheckDigest(JSON.stringify(Object.entries(sanitizeProjectCommandEnvironment({ ...gitExecEnv(), ...normalized.env }))
          .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))));
        const binding: GitCheckoutCheckBinding = { recipe, checkIndex, stage: c.checks.stage,
          policyRevision: policy.revision, policyDigest: gitCheckDigest(JSON.stringify(validateGitWorkflowSettings(policy.resolved.session.values))), environmentDigest };
        rows.push({ binding, snapshot: await captureGitCheckoutCheckRecoverySnapshot(source, binding, true), executionCwd });
      }
      const evidenceScope = c.checks.stage === "commit" ? "working-workspace" as const : "clean-checkout" as const;
      if (rows.some((row) => row.snapshot.version !== (c.checks!.stage === "commit" ? 3 : 2))) refuse("native-verification-scope-required");
      const details = { evidenceScope, candidateTreeVerified: false as const, repositoryChecksWaived: false as const,
        sourceOid: head, sourceTreeOid: sourceTree, snapshotDigest: gitCheckDigest(JSON.stringify(rows[0].snapshot)),
        policyRevision: policy.revision, policyDigest: rows[0].binding.policyDigest, stage: c.checks.stage,
        requiredSavedIndexes: c.checks.stage === "none" ? [] : selectGitCheckRecipesForStage(policy.project.checks ?? [], c.checks.stage).map((r) => r.checkIndex), source: capturedCheckout(source),
        checks: rows.map((row) => ({ checkIndex: row.binding.checkIndex, recipe: row.binding.recipe,
          recipeDigest: row.snapshot.recipeDigest, environmentDigest: row.binding.environmentDigest, executionCwd: row.executionCwd,
          ...(row.snapshot.version === 2 ? { snapshot: structuredClone(row.snapshot) } : {}) })) };
      const candidate: SelectedNativeCandidate = { operation: "verify", source, sourceOid: head, policyRevision: policy.revision,
        checks: c.checks, history: snapshotGitCheckoutVerificationAction(source, details), revision: digest([source, rows, policy.revision]),
        ...(c.orderingState ? { target: c.orderingState.target, targetOid: c.orderingState.targetOid } : {}) };
      return register({ candidate, checks: rows, receipts: [], runs: [], before: c.orderingState, executingStarted: false });
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.checks || !saved.receipts) refuse("native-check-capture-required");
      saved.executing = execution; saved.executingStarted = true;
      try { for (const row of saved.checks) {
        await execution.authorize();
        const receipt = await runGitCheckoutVerification({ ...checkOptions(saved.candidate.source, row.binding.checkIndex, row.binding.stage, execution),
          onExecution: async (handle) => {
            const measured = readGitCheckoutVerificationNativeExecution(handle);
            if (!measured || measured !== handle || measured.actionId !== execution.actionId || measured.sessionId !== owner.sessionId ||
              measured.checkIndex !== row.binding.checkIndex || measured.stage !== row.binding.stage || measured.recipeDigest !== row.snapshot.recipeDigest ||
              measured.snapshotDigest !== gitCheckDigest(JSON.stringify(row.snapshot)) || measured.environmentDigest !== row.binding.environmentDigest ||
              measured.policyDigest !== row.binding.policyDigest || measured.executionCwd !== row.executionCwd) refuse("actual-bound-native-check-execution-required");
            saved.runs!.push(measured);
            await execution.onNativeCompleted(handle);
          } });
        if (!saved.runs!.some((run) => run.receipt?.id === receipt.id && readGitCheckoutVerificationNativeExecution(receipt) === run)) refuse("journalled-native-receipt-required");
        saved.receipts.push(receipt);
      } } catch (cause) {
        if (cause instanceof GitCheckoutVerificationError) refusalContext.getStore()!.code = `selected-check-${cause.code}`;
        if (execution.previousLaunch && saved.runs?.length) {
          consumedChecks.set(execution.previousLaunch, saved);
        }
        if (cause && typeof cause === "object" && saved.runs?.length) registry.failure(cause, { kind: "partial", actionId: execution.actionId,
          candidateRevision: saved.candidate.revision, recoveryRequired: true });
        throw cause;
      }
      const completedAt = performance.now();
      return registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
        completedAt, before: saved.before, after: saved.before,
        completion: { operation: "verify", status: "passed", receiptIds: saved.receipts.map((r) => r.id) } }, saved.receipts);
    },
  };
  const preparation: SelectedNativeAdapter<"prepare"> = { ...base,
    async capture(request, captureContext) {
      requireLeaf(preparationNative, "applyGitPreparationWithAuthority", SELECTED_RUNTIME_BLOCKERS.prepare);
      const source = await readers.readResources(request.selector), target = await readers.readResources(request.target);
      const policy = await readers.readPolicy(source, owner);
      if (target.branch !== policy.project.mainBranch || target.branch !== policy.resolved.session.values.mainBranch) refuse("project-main-target-required");
      const authorityGuard = captureAuthorityGuard(source, target);
      const prepared = await prepareGitPreparationApply({ source: request.selector, target: request.target }, agentDir);
      const resultTree = prepared.candidate.comparison.commits.at(-1)?.newTreeOid ?? await treeOid(source, prepared.candidate.newSourceOid);
      const diff = await withGitProjectReview(source, (repo) => getGitTreeDiff(repo,
        prepared.candidate.comparison.commits.at(-1)?.oldTreeOid ?? resultTree, resultTree));
      const candidate: SelectedNativeCandidate = { operation: "prepare", source, target, sourceOid: prepared.snapshot.source.oid,
        targetOid: prepared.snapshot.target.oid, policyRevision: policy.revision,
        history: snapshotGitPreparationAction(source, target, prepared.candidate, resultTree, diff),
        revision: digest([prepared, source, target, policy.revision]), ...(prepared.snapshot.status === "already-prepared" ? { noEffect: "already-prepared" } : {}) };
      const before = paired(candidate, owner, captureContext.operationId);
      return register({ candidate, prepared, before, authorityGuard, executingStarted: false });
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.prepared || !saved.before) refuse("native-capture-required");
      saved.executing = execution; saved.executingStarted = true;
      const guard = saved.authorityGuard;
      const apply = requireLeaf<(options: Parameters<typeof applyGitPreparation>[0] & { assertCurrentSync(): void }) => ReturnType<typeof applyGitPreparation>>(
        preparationNative, "applyGitPreparationWithAuthority", SELECTED_RUNTIME_BLOCKERS.prepare);
      const result = await apply({ prepared: saved.prepared, actionId: execution.actionId,
        authorize: async () => { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); await execution.authorize(); guard(); },
        assertCurrentSync() { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); },
        onIntent: async (reservation) => {
          const held = readGitOperationReservationOwner(reservation);
          if (!held || held.kind !== "prepare" || held.actionId !== execution.actionId || held.agentDir !== agentDir || !same(held.selection, saved.candidate.source)) refuse("held-preparation-admission-required");
          await activateActions.get(execution.actionId)?.();
        }, onCompleted: execution.onNativeCompleted });
      if (result.status === "partial-state") {
        registry.failure(result, { kind: "partial", actionId: execution.actionId, candidateRevision: saved.candidate.revision, recoveryRequired: true, preparation: result });
        throw result;
      }
      const envelope: SelectedCompletionEnvelope = { stage: "completed", actionId: execution.actionId,
        candidateRevision: saved.candidate.revision, completedAt: performance.now(), before: saved.before,
        after: { ...saved.before, sourceOid: result.newSourceOid }, completion: { operation: "prepare", result } };
      if (result.status === "already-prepared") noEffectProofs.set(result, structuredClone(result));
      const completed = registry.completed(envelope, result, result.status === "already-prepared");
      // No-op has no rewrite callback; independently exact native return is now
      // journalled, without issuing an ordering successor.
      if (result.status === "already-prepared") await execution.onNativeCompleted(completed);
      return completed;
    },
  };
  const integration: SelectedNativeAdapter<"integrate"> = { ...base,
    async capture(request, captureContext) {
      const source = await readers.readResources(request.selector), target = await readers.readResources(request.target);
      const policy = await readers.readPolicy(source, owner);
      await savedSourceCheckPolicy(source);
      const requiredChecks = selectGitCheckRecipesForStage(policy.resolved.session.values.checks, "integration");
      if (requiredChecks.length && !captureContext.receiptIds.length) refuse("required-receipts-missing");
      const bridge: { saved?: Capture } = {};
      const readAuthorityRevisionSync = authorityFence([source, target]);
      const originalAuthorityRevision = readAuthorityRevisionSync();
      const plan = await prepareSelectedIntegration({ sessionId: owner.sessionId, agentDir, source, target,
        receiptIds: captureContext.receiptIds,
        getPolicy: async (r) => { const p = await savedSourceCheckPolicy(r as GitProjectResources);
          return { policyRevision: p.revision, settings: validateGitWorkflowSettings(p.resolved.session.values), savedProjectSettings: p.project }; },
        isTrusted: (root) => getProjectTrustStatus(root, agentDir).trusted,
        isSelectionAuthorized: async (r) => { readOwner(); await revalidateGitProjectResources(r as GitProjectResources); return true; },
        isCheckAuthorized: async (r) => {
          const receipt = captureContext.receiptIds.map((id) => registry.readSealedReceipt(id)).find((receipt) => receipt &&
            receipt.sessionId === owner.sessionId && receipt.stage === r.stage && receipt.checkIndex === r.checkIndex &&
            receipt.policyRevision === r.policyRevision && receipt.policyDigest === r.policyDigest && receipt.recipeDigest === r.recipeDigest &&
            same(receipt.selection, r.selection) && same(receipt.snapshot, r.snapshot));
          if (!receipt) refuse("durably-sealed-check-receipt-required");
          await checkAuthority(source); return true;
        },
        readAuthorityRevisionSync,
        authorize: async (_phase, candidate) => {
          if (!same(candidate.context.source, source) || !same(candidate.context.target, target) || candidate.context.policyRevision !== policy.revision ||
            bridge.saved?.plan && candidate.planId !== bridge.saved.plan.planId) refuse("native-authorization-binding-mismatch");
          const stamp = originalAuthorityRevision, binding = digest(candidate);
          if (readAuthorityRevisionSync() !== stamp) refuse("authority-revoked");
          if (bridge.saved?.executing) await bridge.saved.executing.authorize();
          else { readOwner(); if (!trusted(source) || !trusted(target)) refuse("untrusted-project"); }
          return () => {
            if (digest(candidate) !== binding || readAuthorityRevisionSync() !== stamp) refuse("authority-revoked");
          };
        },
      }).catch((cause: unknown) => {
        // Fixed native diagnostic -> fixed metadata code, never echo stderr.
        if (cause instanceof Error && cause.message === "Git integration unavailable: admission history changed") refuse("native-integration-admission-history-changed");
        throw cause;
      });
      const candidate: SelectedNativeCandidate = { operation: "integrate", source, target,
        sourceOid: plan.review.featureOid, targetOid: plan.review.targetOid, policyRevision: policy.revision,
        revision: digest([plan, source, target, policy.revision]), history: { kind: "integration", repositoryRoot: source.cwd,
          ...gitActionAttribution(source, target), featureBranch: source.branch, targetBranch: target.branch,
          featureOid: plan.review.featureOid, targetOid: plan.review.targetOid, integrationMethod: "method" in plan ? "ff" : "merge",
          ...("method" in plan ? {} : { mergeOid: plan.mergeOid, message: plan.message }), checks: [], diff: plan.diff } };
      bridge.saved = { candidate, plan, before: paired(candidate, owner, captureContext.operationId), executingStarted: false };
      return register(bridge.saved);
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.plan) refuse("native-capture-required");
      saved.executing = execution; saved.executingStarted = true;
      const result = await confirmSelectedIntegration(saved.plan.planId, saved.plan.planId, owner.sessionId, execution.journalAdmission.beginIntegrationIntent)
        .catch((cause: unknown) => {
          if (cause && typeof cause === "object") {
            // Only the original native WeakMap-issued pre-effect proof may
            // retire this approval as target movement. Unknown/mismatched
            // errors keep the controller's conservative recovery disposition.
            try { registry.integrationTargetMoved(cause, handle, execution.actionId); } catch { /* preserve original uncertainty */ }
          }
          throw cause;
        });
      if (result.result.status !== "integrated" || !result.nativeHandle) {
        registry.failure(result, { kind: "partial", actionId: execution.actionId, candidateRevision: saved.candidate.revision, recoveryRequired: true, integration: result });
        throw result;
      }
      const proof = readSelectedIntegrationNativeProof(result.nativeHandle); if (!proof) refuse("native-integration-proof-required");
      const completedAt = performance.now();
      try { await execution.onNativeCompleted(result.nativeHandle); }
      catch (cause) {
        if (cause && typeof cause === "object") registry.failure(cause, { kind: "partial", actionId: execution.actionId,
          candidateRevision: saved.candidate.revision, recoveryRequired: true, integration: result });
        throw cause;
      }
      return registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
        completedAt, before: saved.before, completion: { operation: "integrate", result, integration: proof } }, result.nativeHandle);
    },
  };
  const cleanup: SelectedNativeAdapter<"cleanup"> = { ...base,
    async capture(request, c) {
      const createEngine = requireLeaf<(adapters: Parameters<typeof createGitCleanupEngine>[0] & { assertCurrentSync(): void }) => ReturnType<typeof createGitCleanupEngine>>(
        cleanupNative, "createGitCleanupEngineWithAuthority", SELECTED_RUNTIME_BLOCKERS.cleanup);
      if (typeof Reflect.get(cleanupNative, "readGitCleanupNativeProof") !== "function") refuse("cleanup-native-proof-reader-unavailable");
      if (!c.integrationHandle || !c.creatorHandle) refuse("sealed-cleanup-prerequisites-required");
      const integrationProof = registry.readIntegration(c.integrationHandle), creationProof = registry.readCreation(c.creatorHandle);
      if (!integrationProof || !creationProof) refuse("sealed-cleanup-prerequisites-required");
      if (!same(creationProof.destination, integrationProof.feature)) refuse("creation-integration-resource-seal-mismatch");
      const source = integrationProof.feature, target = integrationProof.target, policy = await readers.readPolicy(target, owner);
      const bridge: { saved?: Capture; evidence?: GitCleanupEvidence; proof?: GitCleanupCompletedProof } = {};
      const removalAcks = new WeakMap<object, GitCleanupDurableAck<GitCleanupRemovalProof>>();
      const admission = createGitCleanupAdmission({ agentDir, readNativeProof: readNativeCleanupProof,
        async onIntent(e) {
          if (!bridge.saved?.executing || e.actionId !== bridge.saved.executing.actionId || !same(e, bridge.saved.cleanupEvidence)) refuse("native-cleanup-intent-correlation-required");
          await activateActions.get(e.actionId)?.();
        },
        async onRemoval(proof) {
          if (!bridge.saved?.removal || !same(proof, bridge.saved.removal)) refuse("actual-native-removal-required");
          await bridge.saved.executing!.onNativeCompleted(bridge.saved.removal);
        },
        async onCompleted(proof) {
          if (!bridge.proof || !same(bridge.proof, proof)) refuse("actual-native-cleanup-completion-required");
          await bridge.saved!.executing!.onNativeCompleted(bridge.proof);
        },
        async onFailure(facts) { if (bridge.saved?.executing) bridge.saved.cleanupFailure = facts; },
      });
      const usage = createTrustedWorkspaceUsage(() => readHostWorkspaceUsage(bridge.saved?.usageToken), admission.readRecordedRemoval);
      // Both guards originate BEFORE any effect. Removal changes which exact
      // physical selection survives, never the original authority revision.
      const sourceGuard = captureAuthorityGuard(source, target);
      const survivingGuard = captureAuthorityGuard(target);
      const assertGuard = () => (bridge.saved?.removal ? survivingGuard : sourceGuard)();
      const adapters: Parameters<typeof createGitCleanupEngine>[0] & { assertCurrentSync(): void } = {
        assertCurrentSync: assertGuard,
        readCompletedIntegration: registry.readIntegration,
        readCreatedWorkspace(handle) {
          const creation = registry.readCreation(handle);
          if (!creation || !same(creation.destination, integrationProof.feature)) return undefined;
          // Same complete measured resource facts, in the integration issuer's
          // serialization order. Native cleanup compares JSON byte order; this
          // changes representation only, never identity, authority or facts.
          return { ...creation, destination: structuredClone(integrationProof.feature) };
        },
        async getProjectMain() {
          const main = (await readers.readPolicy(target, owner)).project.mainBranch;
          if (!main) refuse("saved-project-main-required");
          const selected = await selectGitProjectResources(target.projectRoot, main);
          const roots = await getAllowedFileRoots();
          if (!same(selected.identities.project, target.identities.project) || !same(selected.identities.common, target.identities.common) ||
            !isExistingFilePathAllowed(selected.cwd, roots) || !trusted(selected)) refuse("designated-main-unavailable");
          return selected;
        },
        async acquireUsageLease(resources, evidence) {
          const marker = resources.identities.marker;
          if (!marker || !("changed" in marker) || !("size" in marker)) refuse("native-marker-identity-required");
          const lease = usage.acquireLease(resources.cwd, resources.identities.checkout, { actionId: evidence.actionId,
            featureOid: evidence.integration.featureOid, adminPath: resources.gitDir, adminIdentity: resources.identities.git,
            markerIdentity: { ...marker, changed: String(marker.changed), size: String(marker.size) }, adminInventoryHash: evidence.inventory.admins[basename(resources.gitDir)] });
          return { assertIdle: () => lease.assertUnused(), release: () => lease.release(),
            acknowledgeRemoval(proof) { const ack = removalAcks.get(proof); if (!ack) refuse("sealed-issued-removal-ack-required"); lease.acknowledgeRemoval(ack); } };
        },
        async assertAdmission(evidence) {
          bridge.evidence = structuredClone(evidence);
          await admission.assertAdmission(evidence);
        },
        async beginIntent(evidence) {
          const intent = await admission.beginIntent(evidence);
          return { ...intent,
            async recordRemoval(proof) {
              if (bridge.saved) bridge.saved.removal = proof;
              const ack = await intent.recordRemoval(proof); removalAcks.set(proof, ack); return ack;
            },
            async completed(proof) { bridge.proof = proof; if (bridge.saved) bridge.saved.cleanupProof = proof;
              const native = readNativeCleanupProof(proof); if (!native || native.kind !== "completed") refuse("actual-native-cleanup-proof-required");
              cleanupProofs.set(proof, native); return intent.completed(proof); },
          };
        },
        async authorize(phase) {
          readOwner(); const resources = phase === "before-delete" || bridge.saved?.removal ? target : source;
          await revalidateGitProjectResources(resources); if (!trusted(target)) refuse("untrusted-project");
          if (bridge.saved?.executing) { assertGuard(); await bridge.saved.executing.authorize(); assertGuard(); }
        },
      };
      const engine = createEngine(adapters);
      const native = await engine.capture({ integrationHandle: c.integrationHandle, creatorHandle: c.creatorHandle, ignoredNames: request.ignoredNames });
      if (!bridge.evidence) refuse("actual-native-cleanup-evidence-required");
      const candidate: SelectedNativeCandidate = { operation: "cleanup", source, target, sourceOid: native.featureOid,
        targetOid: integrationProof.resultOid, actionId: native.actionId, policyRevision: policy.revision,
        history: snapshotGitCleanupAction(source, target, { featureOid: native.featureOid, targetOid: bridge.evidence.target.oid,
          mainOid: bridge.evidence.mainSnapshot.oid, sourcePath: source.cwd, branchRef: native.featureRef, targetPath: target.cwd, mainPath: bridge.evidence.main.cwd,
          source: capturedCheckout(source), target: capturedCheckout(target), main: capturedCheckout(bridge.evidence.main),
          integration: { completedAt: integrationProof.completedAt, delivery: integrationProof.delivery, method: integrationProof.method,
            actualFF: integrationProof.actualFF, featureOid: integrationProof.featureOid, previousTargetOid: integrationProof.previousTargetOid,
            resultOid: integrationProof.resultOid, resultTree: integrationProof.resultTree, parents: [...integrationProof.parents] }, provenance: { mode: "create", originalSourcePath: creationProof.originalSource.cwd,
            originalSource: capturedCheckout(creationProof.originalSource), branchRef: creationProof.branchRef },
          ignoredCount: native.ignored.length, ignoredDeletion: native.ignored.length ? "exact-approval-required" : "none", ignored: [...native.ignored] }),
        cleanup: { integrationHandle: c.integrationHandle, creatorHandle: c.creatorHandle,
          ignoredNames: native.ignored.map((row) => row.path) }, revision: digest([native, bridge.evidence, policy.revision]) };
      bridge.saved = { candidate, cleanupEngine: engine, cleanupCandidate: native, cleanupEvidence: bridge.evidence, executingStarted: false,
        cleanupAdapters: { acquireUsageLease: adapters.acquireUsageLease, assertAdmission: adapters.assertAdmission, beginIntent: adapters.beginIntent } };
      return register(bridge.saved);
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.cleanupEngine || !saved.cleanupCandidate) refuse("native-cleanup-capture-required");
      saved.executing = execution; saved.executingStarted = true;
      try {
        const { proof } = await saved.cleanupEngine.apply(saved.cleanupCandidate);
        const completed = registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
          completedAt: performance.now(), completion: { operation: "cleanup", proof } }, proof);
        return completed;
      } catch (cause) {
        const refusal = refusalContext.getStore()!;
        if (!refusal.code && cause instanceof GitWorkspaceUsageError) refusal.code = `cleanup-usage-${cause.code}`;
        if (!refusal.code && cause instanceof GitCleanupOperationError) refusal.code = `cleanup-${cause.code}`;
        if (cause && typeof cause === "object") {
          const failure = cause instanceof GitCleanupOperationError ? cause.facts : saved.cleanupFailure;
          if (failure) registry.failure(cause, { kind: "partial", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
            recoveryRequired: true, cleanup: failure });
        }
        throw cause;
      }
    },
  };
  const reconciliation: SelectedNativeAdapter<"reconcile"> = { ...base,
    async capture(request, c) {
      const source = await readers.readResources(request.selector), target = await readers.readResources(request.target);
      const policy = await readers.readPolicy(source, owner);
      const authorityGuard = captureAuthorityGuard(source, target);
      const snapshot = await preflightGitPreparation({ source: selector(source), target: selector(target) }, agentDir);
      // Only a positively clean, admitted, already prepared native paired state
      // can reconcile ordering. Unresolved leaf recovery remains quarantined.
      if (snapshot.status !== "already-prepared") refuse("native-clean-admitted-reconciliation-required");
      const review = await withGitProjectReview(source, (repo) => reviewGitBranches(repo, source.branch!, target.branch!));
      if (review.featureOid !== snapshot.source.oid || review.targetOid !== snapshot.target.oid) refuse("native-reconciliation-ref-changed");
      const diff = await withGitProjectReview(source, (repo) => getGitReviewDiff(repo, review, { kind: "merge" }));
      const candidate: SelectedNativeCandidate = { operation: "reconcile", source, target,
        sourceOid: snapshot.source.oid, targetOid: snapshot.target.oid, policyRevision: policy.revision,
        revision: digest([snapshot, source, target, policy.revision]), history: { kind: "review", repositoryRoot: source.cwd,
          ...gitActionAttribution(source, target), featureOid: snapshot.source.oid, targetOid: snapshot.target.oid } };
      return register({ candidate, reconcileSnapshot: snapshot, reconciliationReview: review, reconciliationDiff: diff,
        before: paired(candidate, owner, c.operationId), authorityGuard, executingStarted: false });
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.reconcileSnapshot || !saved.before || !saved.candidate.target) refuse("native-reconciliation-capture-required");
      if (execution.previousLaunch) await assertConsumedCheck(execution.previousLaunch, saved.candidate.source, saved.candidate.target!);
      saved.executing = execution;
      const before = saved.before, target = saved.candidate.target;
      return withGitCheckoutGate([saved.candidate.source.cwd, target.cwd], async () => {
      const guard = saved.authorityGuard;
      if (!guard) refuse("mandatory-native-authority-guard-required");
      guard(); await execution.authorize(); guard();
      const snapshot = await preflightGitPreparation({ source: selector(saved.candidate.source), target: selector(target) }, agentDir);
      if (!same(snapshot, saved.reconcileSnapshot) || snapshot.status !== "already-prepared") refuse("native-reconciliation-state-changed");
      await assertGitOperationAdmission(saved.candidate.source, agentDir);
      await assertGitOperationAdmission(target, agentDir);
      await execution.authorize(); guard();
      if (execution.previousLaunch) await assertConsumedCheck(execution.previousLaunch, saved.candidate.source, target);
      guard();
      const recoveryHandle = Object.freeze({}); recoveryProofs.set(recoveryHandle, { before, after: before, previousLaunch: execution.previousLaunch });
      const completedAt = performance.now(); await execution.onNativeCompleted(recoveryHandle);
      return registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
        completedAt, before: saved.before, after: saved.before,
        completion: { operation: "reconcile", disposition: execution.previousLaunch ? "recovered" : "revalidated", recoveryHandle } }, recoveryHandle);
      });
    },
  };
  const journalAdmission: SelectedJournalAdmissionFactory = {
    async begin(boundOwner, candidate) {
      readOwner(); if (!same(boundOwner, owner)) refuse("durable-journal-owner-mismatch");
      const saved = captures.get(candidate.revision); if (!saved) refuse("private-native-capture-required");
      const sink = gitActionSink(m, context.appendEntry);
      const action = candidate.actionId ? await beginGitActionWithId(candidate.actionId, sink, "agent", candidate.history, agentDir)
        : await beginGitAction(sink, "agent", candidate.history);
      let reservation: GitOperationReservation | undefined;
      let measured: { actionId: string; outcome: GitActionOutcome } | undefined;
      const outcomes = new WeakMap<object, { actionId: string; outcome: GitActionNativeOutcome }>();
      const intended: GitActionOutcome | undefined = candidate.history.checkoutVerification ? { kind: "checkout-verification",
        checkoutVerification: { ...verificationBinding(candidate.history.checkoutVerification), runs: [] } } : candidate.operation === "cleanup" ? {
          kind: "cleanup", cleanup: { ...cleanupBinding(saved.cleanupEvidence!), effects: [] } } : undefined;
      let executingRequested = false;
      // The model/controller cannot exempt an executing history record by ID.
      // Persist it only after the real native owner has issued its held intent.
      const activate = async () => {
        if (!executingRequested) refuse("native-launch-before-approval");
        if (action.record.state !== "executing") await action.update("executing", { ...(intended && !action.record.intended ? { intended } : {}),
          ...(saved.exactApproval ? { decision: "approved" as const } : {
            reason: candidate.noEffect || candidate.operation === "reconcile" ? "Read-only native observation; no mutation approval." : "Live selected saved Allow; no exact-candidate prompt requested." }) });
      };
      activateActions.set(action.record.id, activate);
      const unavailable = () => refuse("adapter-not-valid-for-this-operation");
      return {
        action: { ...action, get record() { return action.record; }, async update(state, details) {
          if (state === "executing") { executingRequested = true; return; }
          return action.update(state, details);
        } },
        workspaceAdmission: saved.workspaceAdmission ?? { assertAdmission: unavailable, beginIntent: unavailable },
        cleanup: saved.cleanupAdapters ?? { acquireUsageLease: unavailable, assertAdmission: unavailable, beginIntent: unavailable },
        async beginIntegrationIntent() {
          reservation = await beginSupervisedGitOperationIntent(candidate.source, action.record.id, "integration", agentDir);
          const held = readGitOperationReservationOwner(reservation);
          if (!held || held.actionId !== action.record.id || held.kind !== "integration" || held.agentDir !== agentDir || !same(held.selection, candidate.source)) refuse("admission-correlation-mismatch");
          await activate(); return reservation;
        },
        async recordNativeCompletion(handle) {
          const pending = readGitPreparationCompletion(handle), envelope = registry.readNativeCompletion(handle);
          const workspaceProof = readGitWorkspaceNativeProof(handle), integrationProof = readSelectedIntegrationNativeProof(handle);
          const cleanupProof = readNativeCleanupProof(handle);
          await activate();
          if (pending && pending.actionId === action.record.id && pending.stage === "verified-pending-admission") {
            measured = { actionId: pending.actionId, outcome: { kind: "preparation", status: "prepared",
              preparation: { oldSourceOid: pending.result.oldSourceOid, newSourceOid: pending.result.newSourceOid,
                targetMainOid: pending.result.targetOid, resultTreeOid: pending.result.treeOid } } };
            outcomes.set(handle, { actionId: pending.actionId, outcome: measured.outcome as GitActionNativeOutcome });
            await finishVerifiedNativeGitAction(action, handle, (h) => outcomes.get(h));
          } else if (envelope?.actionId === action.record.id && envelope.completion.operation === "prepare" && envelope.completion.result.status === "already-prepared") {
            const r = envelope.completion.result;
            measured = { actionId: action.record.id, outcome: { kind: "preparation", status: "already-prepared",
              preparation: { oldSourceOid: r.oldSourceOid, newSourceOid: r.newSourceOid, targetMainOid: r.targetOid,
                resultTreeOid: (candidate.history as GitActionCandidateSnapshot).preparation!.resultTreeOid } } };
            outcomes.set(handle, { actionId: action.record.id, outcome: measured.outcome as GitActionNativeOutcome });
            await finishVerifiedNativeGitAction(action, handle, (h) => outcomes.get(h));
          } else if (workspaceProof?.actionId === action.record.id && handle === saved.workspaceProof && same(workspaceProof, handle)) {
            measured = { actionId: action.record.id, outcome: { kind: "workspace", status: workspaceProof.mode === "create" ? "created" : "attached",
              workspace: { mode: workspaceProof.mode, destinationPath: workspaceProof.destination.cwd, branch: workspaceProof.destination.branch!,
                tipOid: workspaceProof.resultOid, treeOid: workspaceProof.treeOid,
                ...(workspaceProof.knownParentCreation ? { parentCreated: true, knownParentCreation: workspaceProof.knownParentCreation } : {}) } } };
            outcomes.set(handle, { actionId: action.record.id, outcome: measured.outcome as GitActionNativeOutcome });
            await finishVerifiedNativeGitAction(action, handle, (h) => outcomes.get(h));
          } else if (integrationProof?.admissionActionId === action.record.id && same(integrationProof.feature, candidate.source) && same(integrationProof.target, candidate.target)) {
            if (!reservation || !readGitOperationReservationOwner(reservation)) refuse("held-integration-admission-required");
            measured = { actionId: action.record.id, outcome: { status: "integrated", mergeOid: integrationProof.resultOid,
              tree: integrationProof.resultTree, parents: [...integrationProof.parents], featureOid: integrationProof.featureOid,
              targetOid: integrationProof.previousTargetOid, targetBranch: integrationProof.target.branch } };
            await finishGitAction(action, measured.outcome);
            reservation.assertOwned(); reservation.resolve();
          } else if (cleanupProof?.actionId === action.record.id && (handle === saved.removal || handle === saved.cleanupProof)) {
            const removal = cleanupProof.kind === "removed" ? cleanupProof : cleanupProof.removal;
            const effects: NonNullable<GitActionOutcome["cleanup"]>["effects"] = [{ kind: "worktree-removed", sourcePath: removal.sourcePath,
              sourceIdentity: removal.sourceIdentity, adminPath: removal.adminPath, featureOid: removal.featureOid, exit: 0, sourceAbsent: true, adminAbsent: true,
              beforeInventoryDigest: digest(removal.before), afterInventoryDigest: digest(removal.after) }];
            if (cleanupProof.kind === "completed") effects.push({ kind: "branch-deleted", branchRef: cleanupProof.deletedRef,
              deletedOid: cleanupProof.deletedOid, transactionExit: 0, finalInventoryDigest: digest(cleanupProof.finalInventory) });
            const outcome: GitActionNativeOutcome = { kind: "cleanup", status: cleanupProof.kind === "removed" ? "worktree-removed" : "cleaned-up",
              cleanup: { ...cleanupBinding(saved.cleanupEvidence!), effects,
                ...(cleanupProof.kind === "completed" ? { nativeHeadReflogMayHaveChanged: cleanupProof.nativeHeadReflogMayHaveChanged } : {}),
                ...(saved.candidate.cleanup?.ignoredNames.length && saved.exactApproval ? { ignoredDataDeletionApproved: true } : {}) } };
            outcomes.set(handle, { actionId: action.record.id, outcome });
            if (cleanupProof.kind === "removed") await recordVerifiedCleanupRemoval(action, handle, (h) => outcomes.get(h));
            else { measured = { actionId: action.record.id, outcome }; await finishVerifiedNativeGitAction(action, handle, (h) => outcomes.get(h)); }
          } else if (saved.runs?.includes(handle as GitActionCheckExecution) && readGitCheckoutVerificationNativeExecution(handle) === handle) {
            const runs = saved.runs.map((r) => structuredClone(r)), last = runs.at(-1)!;
            const failed = last.exitStatus !== 0 || !last.receipt || !last.containmentComplete || last.timedOut || last.overflow;
            const final = failed || runs.length === saved.checks!.length;
            // Each row is genuinely terminal/passing. The journal STATE stays
            // executing for an incomplete batch; no operation seal is issued.
            const status = !last.containmentComplete ? "partial-state" : failed ? "failed" : "passed";
            const outcome: GitActionOutcome = { kind: "checkout-verification", status, checkoutVerification: {
              ...verificationBinding(candidate.history.checkoutVerification!), runs } };
            measured = { actionId: action.record.id, outcome };
            if (final) { outcomes.set(handle, { actionId: action.record.id, outcome: outcome as GitActionNativeOutcome });
              await finishVerifiedNativeGitAction(action, handle, (h) => outcomes.get(h));
            } else await action.update("executing", { outcome });
          } else if (recoveryProofs.has(handle) && candidate.operation === "reconcile") {
            measured = { actionId: action.record.id, outcome: { status: "reviewed" } }; await finishGitAction(action, measured.outcome);
          } else refuse("actual-native-completion-required");
        },
        async sealCompletion(handle) {
          return registry.seal(handle, async (envelope) => {
            const durable = await readGitAction(action.record.id, { includeArtifact: true }, agentDir);
            if (!measured || durable.unavailable || !durable.record || !durable.candidate || durable.record.sessionId !== owner.sessionId ||
              durable.record.state !== "succeeded" || !same(durable.record.outcome, measured.outcome) || envelope.candidateRevision !== candidate.revision ||
              !same(durable.candidate, candidate.history) || !inspectGitOperationAdmission(agentDir, candidate.source.commonDir).admitted) refuse("durable-completion-unconfirmed");
            readOwner();
            await assertGitOperationAdmission(candidate.operation === "cleanup" ? candidate.target! : candidate.source, agentDir);
          });
        },
        readDurableCompletion: registry.readDurableCompletion,
        async recordFailure(failure, execution) {
          const p = failure?.kind === "partial" ? failure.preparation : undefined;
          if (p) await finishGitAction(action, { kind: "preparation", status: "partial-state", preparation: {
            oldSourceOid: p.oldSourceOid, newSourceOid: p.newSourceOid ?? p.observedSourceOid ?? p.oldSourceOid,
            targetMainOid: p.targetOid, resultTreeOid: p.treeOid ?? (candidate.history as GitActionCandidateSnapshot).preparation!.resultTreeOid } }, true);
          else await failGitAction(action, failure?.kind === "target-moved" && failure.noEffect === true ? false : execution.executionStarted);
        },
      };
    },
  };
  const controller = createGitSelectedOperationController({ owner, authorization: readers,
    native: { workspace, prepare: preparation, verify: verification, integrate: integration,
      cleanup, reconcile: reconciliation,
      readCleanupPrerequisites: (_o, source) => registry.readCleanupPrerequisites(source),
      readReceipt: lookupGitCheckoutVerificationReceipt,
      async assertReceipt(candidate, receipt) {
        await validateGitCheckoutVerificationReceipt(receipt.id, checkOptions(candidate.source, receipt.checkIndex, receipt.stage));
      },
      invalidateReceipts: (source) => invalidateGitCheckoutVerificationReceiptsForCheckout(source.cwd),
      async assertReconciliation(handle, envelope, previousLaunch) {
        const facts = recoveryProofs.get(handle);
        if (!facts || facts.previousLaunch !== previousLaunch || !same(facts.before, envelope.before) || !same(facts.after, envelope.after)) refuse("independent-reconciliation-proof-required");
        if (previousLaunch) await assertConsumedCheck(previousLaunch, facts.after.source as GitProjectResources, facts.after.target as GitProjectResources);
        await assertGitOperationAdmission(facts.after.source as GitProjectResources, agentDir);
        await assertGitOperationAdmission(facts.after.target as GitProjectResources, agentDir);
        await checkAuthority(facts.after.source as GitProjectResources);
      } }, journalAdmission,
    isTrusted: async (r) => trusted(r),
    async currentUserRequestId() {
      const saved = readOwner();
      const branch = m.getBranch?.() as unknown as SessionEntry[] | undefined;
      const user = [...(branch ?? saved.entries)].reverse().find((e) => e.type === "message" && e.message.role === "user");
      if (!user || !saved.disk.some((e) => e.id === user.id && same(e, user))) refuse("current-persisted-user-required");
      return user.id;
    },
    readPreparationOrderingRequirement: (_o, source) => readSelectedRuntimePreparationOrdering(source as GitProjectResources, agentDir),
    async approveExact(input) {
      readOwner(); const c = input.candidate;
      const askExact = async (candidate: GitActionCandidate) => {
        const approved = await context.ask(candidate) === true;
        if (approved) { const saved = captures.get(c.revision); if (!saved) refuse("private-native-capture-required"); saved.exactApproval = true; }
        return approved;
      };
      if (c.history.kind === "preparation") {
        const h = c.history;
        if (!h.preparation?.commitMapping || !h.resourceAttribution || !h.projectRoot || !h.sourceCheckoutRoot || !h.targetCheckoutRoot || !h.featureBranch || !h.targetBranch) refuse("exact-ui-candidate-required");
        return askExact({ kind: "preparation", actionId: input.actionId, repositoryRoot: h.repositoryRoot,
          projectRoot: h.projectRoot, sourceCheckoutRoot: h.sourceCheckoutRoot, targetCheckoutRoot: h.targetCheckoutRoot,
          resourceAttribution: h.resourceAttribution, featureBranch: h.featureBranch, targetBranch: h.targetBranch,
          preparation: { ...h.preparation, commitMapping: h.preparation.commitMapping } });
      }
      if (c.history.kind === "integration") {
        // UI accepts the existing exact integration candidate shape. Private plan
        // is never returned in normal model-facing results.
        const capture = captures.get(c.revision)?.plan;
        if (!capture) refuse("exact-ui-candidate-required");
        return askExact({ kind: "integration", actionId: input.actionId, featureCwd: c.source.cwd, targetCwd: c.target!.cwd, plan: capture, receipts: [] });
      }
      if (c.history.kind === "workspace" && c.history.workspace) return askExact({ kind: "workspace", actionId: input.actionId,
        repositoryRoot: c.source.cwd, projectRoot: c.source.projectRoot, sourceCheckoutRoot: c.source.cwd,
        resourceAttribution: c.history.resourceAttribution!, workspace: c.history.workspace });
      if (c.history.kind === "checkout-verification" && c.history.checkoutVerification) return askExact({ kind: "checkout-verification",
        actionId: input.actionId, repositoryRoot: c.source.cwd, projectRoot: c.source.projectRoot, sourceCheckoutRoot: c.source.cwd,
        resourceAttribution: c.history.resourceAttribution!, featureBranch: c.source.branch!, checkoutVerification: c.history.checkoutVerification });
      if (c.history.kind === "cleanup" && c.history.cleanup) return askExact({ kind: "cleanup", actionId: input.actionId,
        repositoryRoot: c.source.cwd, projectRoot: c.source.projectRoot, sourceCheckoutRoot: c.source.cwd, targetCheckoutRoot: c.target!.cwd,
        resourceAttribution: c.history.resourceAttribution!, featureBranch: c.source.branch!, targetBranch: c.target!.branch!, cleanup: { ...c.history.cleanup, ignored: c.history.cleanup.ignored ?? [] } });
      if (c.history.kind === "review") {
        const saved = captures.get(c.revision);
        if (!saved?.reconciliationReview || !saved.reconciliationDiff) refuse("exact-reconciliation-ui-adapter-unavailable");
        return askExact({ kind: "review", actionId: input.actionId, featureCwd: c.source.cwd,
          review: saved.reconciliationReview, diff: saved.reconciliationDiff, selection: { kind: "merge" } });
      }
      return refuse("exact-ui-adapter-unavailable");
    },
  });
  return Object.freeze({
    async run<K extends SelectedControllerOperation>(operation: K, request: SelectedControllerRequests[K]): Promise<SelectedOperationResult> {
      return refusalContext.run({}, async () => { try {
        readOwner();
        const result = await (controller[operation] as (r: SelectedControllerRequests[K]) => Promise<SelectedOperationResult>)(request);
        return result.code === "operation-refused" && refusalContext.getStore()?.code ? { ...result, code: refusalContext.getStore()!.code } : result;
      } catch (cause) { return { operation, status: "blocked", code: cause instanceof RuntimeRefusal ? cause.code : "trusted-bootstrap-unavailable" }; } });
    },
    captureAuthorityGuard,
    commitVerificationContext(source: GitProjectResources, receiptIds: readonly string[]): GitCommitVerificationContext {
      readOwner();
      return { sessionId: owner.sessionId, agentDir, receiptIds: [...receiptIds], readAuthorityRevisionSync: authorityFence([source]),
        async sourceGetPolicy(resources) {
          if (!same(resources, source)) refuse("commit-source-changed");
          const p = await readers.readPolicy(source, owner); return { policyRevision: p.revision, settings: validateGitWorkflowSettings(p.resolved.session.values), savedProjectSettings: p.project };
        },
        isTrusted: (root) => (root === source.projectRoot || root === source.cwd) && trusted(source),
        async isSelectionAuthorized(resources) { if (!same(resources, source)) return false; await checkAuthority(source); return true; },
        async isCheckAuthorized(receipt) { if (!registry.readSealedReceipt(receipt.id)) return false; await checkAuthority(source); return true; },
      };
    },
    dispose: controller.dispose,
    get blockers() {
      return Object.freeze({
        ...(typeof Reflect.get(workspaceNative, "applyGitWorkspaceOperationWithAuthority") !== "function" ? { workspace: SELECTED_RUNTIME_BLOCKERS.workspace } : {}),
        ...(typeof Reflect.get(preparationNative, "applyGitPreparationWithAuthority") !== "function" ? { prepare: SELECTED_RUNTIME_BLOCKERS.prepare } : {}),
        ...(typeof Reflect.get(checkoutNative, "readGitCheckoutVerificationNativeExecution") !== "function" ? { verify: SELECTED_RUNTIME_BLOCKERS.verify } : {}),
        ...(typeof Reflect.get(cleanupNative, "createGitCleanupEngineWithAuthority") !== "function" || typeof Reflect.get(cleanupNative, "readGitCleanupNativeProof") !== "function" ? { cleanup: SELECTED_RUNTIME_BLOCKERS.cleanup } : {}),
        // Unknown/incomplete launches deny independently; settled native check
        // failures now have an exact process-only recovery reader.
      });
    },
  });
}
function selector(source: GitProjectResources): GitResourceSelector { return { repositoryPath: source.projectRoot, checkoutPath: source.cwd, workspaceBranch: source.branch }; }
function paired(candidate: SelectedNativeCandidate, owner: ProjectAuthorizationOwner, operationId: string): GitPreparationReentryState {
  if (!candidate.target || !candidate.targetOid) return refuse("paired-state-required");
  return { sessionId: owner.sessionId, operationId, policyRevision: candidate.policyRevision, source: candidate.source,
    target: candidate.target, sourceOid: candidate.sourceOid, targetOid: candidate.targetOid };
}
function capturedCheckout(r: GitProjectResources) {
  if (!r.identities.marker) refuse("physical-git-marker-required");
  return { gitDir: r.gitDir, checkoutIdentity: r.identities.checkout, gitIdentity: r.identities.git, markerIdentity: r.identities.marker };
}
function selectedUsage(): Map<object, readonly string[]> {
  const state = globalThis as unknown as Record<symbol, unknown>, key = Symbol.for("pi-web:selected-operations:checkout-usage");
  return (state[key] ??= new Map<object, readonly string[]>()) as Map<object, readonly string[]>;
}
/** Authoritative host producers, not the UI list. Preserve even pre-reload RPC
 * starts and refuse unlocatable locks; native placement fences remain additional. */
function readHostWorkspaceUsage(excludedOwnCapture?: object): import("./git-workspace-usage").WorkspaceUsageSnapshot {
  const starts = [...(globalThis.__piStartingSessionCwds ?? new Map<string, number>())];
  const count = starts.reduce((sum, [, n]) => sum + n, 0);
  const located = starts.length <= 10_000 && starts.every(([, n]) => Number.isSafeInteger(n) && n > 0) && count >= (globalThis.__piStartLocks?.size ?? 0);
  const checks = [...gitCheckRunningCheckouts()], own = [...selectedUsage()].filter(([token]) => token !== excludedOwnCapture).flatMap(([, paths]) => paths);
  return { sessions: readRpcWorkspaceSessionUsage(), terminals: readTerminalWorkspaceUsage(),
    checks: { known: checks.length <= 10_000, entries: checks.map((cwd) => ({ id: cwd, cwd, stopped: false })) },
    inflight: { known: located && own.length <= 10_000, entries: [...own, ...starts.map(([cwd]) => cwd)].map((cwd) => ({ cwd })) } };
}
function requireLeaf<T = (...args: never[]) => unknown>(module: object, name: string, code: string): T {
  const implementation = Reflect.get(module, name);
  if (typeof implementation !== "function") refuse(code);
  return implementation as T;
}
function readNativeCleanupProof(handle: unknown): Readonly<GitCleanupRemovalProof | GitCleanupCompletedProof> | undefined {
  const reader = Reflect.get(cleanupNative, "readGitCleanupNativeProof");
  return typeof reader === "function" ? reader(handle) : undefined;
}
function verificationBinding(c: NonNullable<GitActionCandidateSnapshot["checkoutVerification"]>) {
  return { evidenceScope: c.evidenceScope, candidateTreeVerified: c.candidateTreeVerified, repositoryChecksWaived: c.repositoryChecksWaived,
    sourceOid: c.sourceOid, sourceTreeOid: c.sourceTreeOid, snapshotDigest: c.snapshotDigest, policyDigest: c.policyDigest,
    policyRevision: c.policyRevision, stage: c.stage, requiredSavedIndexes: [...c.requiredSavedIndexes] };
}
function cleanupBinding(e: GitCleanupEvidence) {
  return { featureOid: e.integration.featureOid, targetOid: e.target.oid, mainOid: e.mainSnapshot.oid,
    sourcePath: e.integration.feature.cwd, branchRef: `refs/heads/${e.integration.feature.branch}`, targetPath: e.integration.target.cwd, mainPath: e.main.cwd };
}
async function commitOid(source: GitProjectResources): Promise<string> {
  const { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  return withGitProjectReview(source, async (repo) => {
    if (typeof repo === "string") return refuse("physical-source-required");
    const value = (await promisify(execFile)("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`, `--work-tree=${repo.cwd}`,
      "rev-parse", "HEAD^{commit}"], { env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir }, encoding: "utf8", timeout: 15000, maxBuffer: 4096 })).stdout.trim();
    if (!oid(value)) refuse("full-source-oid-required"); return value;
  });
}
async function treeOid(source: GitProjectResources, oid: string): Promise<string> {
  const { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  return withGitProjectReview(source, async (repo) => {
    if (typeof repo === "string") return refuse("physical-source-required");
    return (await promisify(execFile)("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`, `--work-tree=${repo.cwd}`,
      "rev-parse", `${oid}^{tree}`], { env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir }, encoding: "utf8", timeout: 15000, maxBuffer: 4096 })).stdout.trim();
  });
}
