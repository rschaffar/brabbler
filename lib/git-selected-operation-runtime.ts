import { lstatSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { bindingDigest, readBindingFile } from "./git-workflow-binding-io";
import { getAllowedFileRoots, getKnownAllowedFileRoots, isFilePathAllowed, isExistingFilePathAllowed } from "./file-access";
import { gitExecEnv } from "./git-exec";
import { managedGitSessionFacts } from "./git-workflow-access";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import { captureGitScopedAuthorityRevision, readGitScopedAuthorityRevision, gitWorkflowPolicyRevision } from "./git-scoped-authority";
import type { GitMutationInvocationAuthority } from "./git-mutation-invocation";
import { resolveGitWorkflowSettings, validateGitWorkflowSettings } from "./git-workflow-settings";
import { readManagedSessionGitWorkflow, workflowTaskFromEntries } from "./git-workflow-session";
import { readGitProjectSessionSettings } from "./git-project-session";
import { loadGitProjectSettings } from "./git-project-settings";
import { readProjectAuthorization, type ProjectAuthorizationOwner } from "./git-project-authorization";
import { getProjectTrustStatus } from "./project-trust";
import { selectCanonicalGitResources, selectGitProjectResources, revalidateGitProjectResources,
  withGitProjectReview, type GitProjectResources, type GitResourceSelector } from "./git-project-resources";
import { prepareGitPreparationApply, applyGitPreparation, readGitPreparationNativeOutcome, retireGitPreparedApply, type GitPreparedApply } from "./git-preparation-apply";
import { preflightGitPreparation, sameGitPreparationDependencies } from "./git-preparation";
import { readGitIntegrationNativeOutcome } from "./git-integration";
import { prepareSelectedIntegration, confirmSelectedIntegration, readSelectedIntegrationNativeProof,
  retireSelectedIntegrationPlan, type SelectedIntegrationPlan } from "./git-selected-integration";
import { getGitTreeDiff, reviewGitBranches, getGitReviewDiff, type GitReview, type GitReviewDiff } from "./git-review";
import { lookupGitCheckoutVerificationReceipt, runGitCheckoutVerification, validateGitCheckoutVerificationReceipt, GitCheckoutVerificationError,
  readGitCheckoutVerificationNativeExecution,
  captureGitCheckoutCheckRecoverySnapshot,
  type GitCheckoutVerificationReceipt, type GitCheckoutCheckBinding } from "./git-checkout-verification";
import { createGitCheckAuthorityFence, bindGitCheckCleanupCandidate, acceptGitCheckCleanupRemoval } from "./git-check-authority-fence";
import { readGitCleanupCallerPolicy, readGitCleanupCallerAuthorization, type GitCleanupCallerScope } from "./git-selected-cleanup-caller-policy";
import { createGitCheckCohort, retireGitCheckCohort, type GitCheckCohort, gitCheckDigest } from "./git-check-runner";
import { normalizeGitCheckRecipe, selectGitCheckRecipesForStage, validateGitCheckRecipes } from "./git-check-recipe";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";
import * as workspaceNative from "./git-workspace-operation";
import * as preparationNative from "./git-preparation-apply";
import { captureGitWorkspaceOperation, applyGitWorkspaceOperation, readGitWorkspaceNativeProof, retireGitWorkspaceCandidate,
  GitWorkspaceOperationError, type GitWorkspaceCandidate, type GitWorkspaceCompletedProof } from "./git-workspace-operation";
import * as cleanupNative from "./git-cleanup-operation";
import * as checkoutNative from "./git-checkout-verification";
import { createGitCleanupEngine, GitCleanupOperationError, readGitCleanupCandidateEvidence, readGitCleanupRemovalAuthority,
  readGitCleanupNativeProof as readNativeCleanupProof, type GitCleanupCandidate, type GitCleanupCompletedProof,
  type GitCleanupRemovalProof, type GitCleanupEvidence, type GitCleanupFailure } from "./git-cleanup-operation";
import { getRpcSession } from "./rpc-manager";
import { captureSelectedOperationAuthorization } from "./git-selected-operation-authorization";
import type { GitCommitVerificationContext } from "./git-commit-verification";
import { beginGitAction, beginGitActionWithId, gitActionSink, gitActionAttribution, snapshotGitPreparationAction,
  snapshotGitWorkspaceAction, snapshotGitCheckoutVerificationAction, snapshotGitCleanupAction, gitActionDiagnosticReport,
  failGitAction } from "./git-action-controller";
import { type GitActionOutcome, type GitActionCandidateSnapshot, type GitActionCheckExecution } from "./git-action-types";
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
const refusalContext = new AsyncLocalStorage<{ code?: string; diagnostics?: import("./git-action-types").GitActionDiagnosticWarning }>();
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

/** Current native observation only. Historical failures/corruption neither
 * authorize nor veto a new invocation. Exact own preparation reentry remains
 * in the controller's private chain, never reconstructed from journal rows. */
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
    await revalidateGitProjectResources(source);
    return { kind: "independent", source, sourceOid: tip, evidenceRevision: digest([source, tip, agentDir]) };
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

type Capture = { candidate: SelectedNativeCandidate; retired?: boolean; prepared?: GitPreparedApply; plan?: SelectedIntegrationPlan;
  workspace?: GitWorkspaceCandidate; workspaceProof?: GitWorkspaceCompletedProof;
  cleanupEngine?: ReturnType<typeof createGitCleanupEngine>; cleanupCandidate?: GitCleanupCandidate; cleanupEvidence?: GitCleanupEvidence;
  cleanupProof?: GitCleanupCompletedProof; removal?: GitCleanupRemovalProof; cleanupFailure?: GitCleanupFailure;
  checks?: { binding: GitCheckoutCheckBinding; snapshot: Awaited<ReturnType<typeof captureGitCheckoutCheckRecoverySnapshot>>; executionCwd: string }[];
  reconcileSnapshot?: Awaited<ReturnType<typeof preflightGitPreparation>>; reconciliationReview?: GitReview; reconciliationDiff?: GitReviewDiff;
  exactApproval?: boolean;
  cohort?: GitCheckCohort;
  receipts?: GitCheckoutVerificationReceipt[];
  runs?: Readonly<GitActionCheckExecution>[];
  authorityGuard?: () => void;
  before?: GitPreparationReentryState; executing?: SelectedNativeExecution; executionAuthorized?: boolean; executingStarted: boolean };

export function createGitSelectedOperationRuntime(context: GitSelectedOperationRuntimeContext) {
  const agentDir = context.agentDir ?? getAgentDir();
  if (process.platform !== "linux" || agentDir !== getAgentDir()) refuse("native-runtime-root-unavailable");
  const m = context.manager, file = m.getSessionFile();
  if (!file) refuse("persisted-owner-required");
  const owner = Object.freeze({ sessionId: m.getSessionId(), sessionFile: file, sessionCwd: context.sessionCwd });
  const instance = persisted(context, owner).identity;
  const cleanupProofs = new WeakMap<object, GitCleanupCompletedProof>();
  const recoveryProofs = new WeakMap<object, { before: GitPreparationReentryState; after: GitPreparationReentryState; previousLaunch?: GitPreparationReentryLaunch }>();
  // Original native rows retained only after the invocation RETURNS. The fixed
  // reader requires actual original containment facts anew on every use; history
  // neither authorizes nor vetoes a new invocation.
  const consumedChecks = new WeakMap<GitPreparationReentryLaunch, Capture>();
  const noEffectProofs = new WeakMap<object, Extract<SelectedCompletionEnvelope["completion"], { operation: "prepare" }>["result"]>();
  const registry = createGitSelectedOperationRegistry(owner, { readCleanupProof: (h) => cleanupProofs.get(h), readRecoveryProof: (h) => recoveryProofs.get(h),
    readPreparationNoEffect: (h) => noEffectProofs.get(h) });
  const captures = new Map<string, Capture>();
  const readOwner = () => persisted(context, owner, instance);
  const trusted = (r: Readonly<GitProjectResources>) => getProjectTrustStatus(r.projectRoot, agentDir).trusted && getProjectTrustStatus(r.cwd, agentDir).trusted;
  const writerRevision = () => {
    const live = getRpcSession(owner.sessionId);
    const revision = context.readSelectionRevisionSync ? context.readSelectionRevisionSync() :
      live?.isAlive() ? live.readGitCheckAuthorityRevisionSync?.() : undefined;
    if (revision !== undefined && (typeof revision !== "string" || !revision || revision.length > 512 || /[\x00-\x1f\x7f]/.test(revision))) refuse("known-monotonic-authority-required");
    return revision;
  };
  // Capture the ORIGINAL complete scoped map and own loaded authority before
  // discovery. Later canonical selections narrow that map, never rebaseline it.
  const invocationScope = new AsyncLocalStorage<ReturnType<typeof originalInvocation>>();
  function originalInvocation() {
    readOwner();
    const original = captureGitScopedAuthorityRevision(agentDir), generation = randomUUID();
    const invocationOwner = { sessionId: owner.sessionId, sessionFile: owner.sessionFile, generation };
    const ownFence = createGitCheckAuthorityFence({ scope: { sessionId: owner.sessionId, sessionFile: owner.sessionFile, cwd: owner.sessionCwd },
      agentDir, invocationOwner, projectRoots: [], checkouts: [owner.sessionCwd],
      readSelectionStateSync: () => context.effectiveTools(), readSelectionRevisionSync: () => {
        const revision = writerRevision(); if (!revision) refuse("live-monotonic-authority-provider-unavailable"); return revision;
      } });
    const baseline = ownFence();
    const resources = new Map<string, GitProjectResources>();
    let callerCurrent: SelectedOperationCurrent | undefined, cleanupCandidate: object | undefined, cleanupRemoval: object | undefined;
    const removedCallerScope = (): GitCleanupCallerScope | undefined => {
      if (!cleanupCandidate || !cleanupRemoval) return;
      const authority = readGitCleanupRemovalAuthority(cleanupCandidate, cleanupRemoval);
      if (!authority || !same(authority.binding.owner, invocationOwner)) refuse("original-cleanup-removal-association-required");
      if (callerCurrent?.kind !== "git" || !same(callerCurrent.resources, authority.binding.source)) return;
      return { candidate: cleanupCandidate, removal: cleanupRemoval, caller: authority.binding.source, owner, invocationOwner };
    };
    const assertOriginal = () => {
      readOwner();
      const selection = { sessionId: owner.sessionId, projectRoots: [...new Set([...resources.values()].map((r) => r.projectRoot))],
        trustPaths: [...new Set([owner.sessionCwd, ...[...resources.values()].flatMap((r) => [r.projectRoot, r.cwd])])] };
      if (ownFence() !== baseline) refuse("original-caller-authority-revoked");
      if (original(selection) !== readGitScopedAuthorityRevision(agentDir, selection)) refuse("original-scoped-authority-revoked");
      const roots = getKnownAllowedFileRoots();
      for (const r of resources.values()) if (!isFilePathAllowed(r.projectRoot, roots) || !isFilePathAllowed(r.cwd, roots) || !trusted(r))
        refuse("selected-root-or-trust-revoked");
      // Native leaves own physical presence/identity, including cleanup's exact
      // removal transition. This is the independent LIVE authority check only.
    };
    const readCurrent = async (): Promise<SelectedOperationCurrent> => {
      // Preserve the ORIGINAL classification. Genuine own removal changes its
      // physical presence, not the saved/header cwd, project scope or caller.
      if (removedCallerScope()) { assertOriginal(); return structuredClone(callerCurrent!); }
      const observed = await readSelectedRuntimeCurrent(owner.sessionCwd);
      if (callerCurrent && !same(callerCurrent, observed)) refuse("caller-classification-changed");
      callerCurrent ??= structuredClone(observed);
      assertOriginal(); return structuredClone(callerCurrent);
    };
    return { generation, baseline, assertOriginal, readCurrent, removedCallerScope,
      add(r: GitProjectResources) { resources.set(r.cwd, r); assertOriginal(); },
      bindCleanup(candidate: object) {
        if (!callerCurrent || cleanupCandidate) refuse("original-cleanup-caller-required");
        bindGitCheckCleanupCandidate(ownFence, candidate); cleanupCandidate = candidate; assertOriginal();
      },
      acceptCleanup(candidate: object, removal: object) {
        if (candidate !== cleanupCandidate) refuse("original-cleanup-candidate-required");
        // MUST precede every ordinary authority read after native removal.
        acceptGitCheckCleanupRemoval(ownFence, candidate, removal);
        cleanupRemoval = removal; assertOriginal();
      } };
  }
  const bootstrapInvocation = originalInvocation();
  const invocation = () => invocationScope.getStore() ?? bootstrapInvocation;
  const operationPolicy = (p: Awaited<ReturnType<typeof loadGitProjectSettings>>) => ({ ...p, revision: gitWorkflowPolicyRevision(p) });
  const scopedAuthorization = async (r: GitProjectResources) => {
    readOwner(); invocation().add(r);
    const removed = invocation().removedCallerScope();
    const status = removed && same(removed.caller, r) ? await readGitCleanupCallerAuthorization(removed, agentDir)
      : await readProjectAuthorization(r, owner, agentDir);
    invocation().assertOriginal();
    return { ...status, revision: readGitScopedAuthorityRevision(agentDir, { sessionId: owner.sessionId, projectRoots: [r.projectRoot], domains: ["grants"] }) };
  };
  const readers: SelectedOperationReaders = {
    async readResources(selector) { const r = await selectCanonicalGitResources(selector); invocation().add(r); return r; },
    async readCaller() {
      const originalWriterRevision = writerRevision();
      const saved = readOwner(), tools = context.effectiveTools();
      if (!tools || !Array.isArray(tools)) refuse("effective-tools-required");
      const facts = managedGitSessionFacts(saved.entries, tools), current = await invocation().readCurrent();
      if (current.kind === "git") invocation().add(current.resources as GitProjectResources);
      invocation().assertOriginal();
      const chat = operationPolicy(await loadGitWorkflowSettings(undefined, saved.entries, agentDir, owner.sessionId));
      // Legacy explicit opt-out remains a negative restriction, never task consent.
      if (chat.task.kind === "legacy" && chat.task.policy === null) chat.optedOut = true;
      let policy = chat;
      if (current.kind === "git") {
        const removed = invocation().removedCallerScope();
        const canonical = operationPolicy(removed ? await readGitCleanupCallerPolicy(removed, saved.entries, agentDir)
          : await loadGitProjectSettings(current.resources as GitProjectResources, saved.entries, agentDir, owner.sessionId));
        policy = { ...canonical, task: chat.task, session: chat.session, optedOut: chat.optedOut,
          revision: digest([canonical.revision, chat.revision]), resolved: { ...canonical.resolved,
            session: resolveGitWorkflowSettings(canonical.global, canonical.project, chat.session ?? {}) } };
      }
      readOwner();
      if (writerRevision() !== originalWriterRevision) refuse("authority-changed-during-caller-capture");
      return { persisted: true, current, facts, policy,
        revision: digest([saved.identity, saved.header, current, facts, policy.revision, originalWriterRevision]) } as SelectedOperationCaller;
    },
    async readPolicy(r) {
      invocation().add(r); const entries = readOwner().entries, removed = invocation().removedCallerScope();
      const p = removed && same(removed.caller, r) ? await readGitCleanupCallerPolicy(removed, entries, agentDir)
        : await loadGitProjectSettings(r, entries, agentDir, owner.sessionId);
      invocation().assertOriginal(); return operationPolicy(p);
    },
    readAuthorization: scopedAuthorization,
    revalidateResources: revalidateGitProjectResources,
    async readCurrentPolicy(r) { return readers.readPolicy(r as GitProjectResources, owner); },
    async readCurrentAuthorization(r) { return scopedAuthorization(r as GitProjectResources); },
    async revalidateCurrent(current) { readOwner(); if (!same(current, await invocation().readCurrent())) refuse("caller-classification-changed"); },
  };
  const register = (saved: Capture) => {
    saved.candidate.revision = digest([saved.candidate.revision, invocation().generation]);
    saved.candidate.invocationOwner ??= { sessionId: owner.sessionId, sessionFile: owner.sessionFile, generation: invocation().generation };
    if (saved.candidate.operation === "workspace" || saved.candidate.operation === "prepare" || saved.candidate.operation === "reconcile") {
      saved.authorityGuard ??= captureAuthorityGuard(saved.candidate.source, ...(saved.candidate.target ? [saved.candidate.target] : []));
    }
    captures.set(saved.candidate.revision, saved);
    return registry.capture(saved.candidate, saved);
  };
  const authorityFence = (resources: readonly GitProjectResources[]) => {
    const original = invocation(); resources.forEach((r) => original.add(r));
    return () => { original.assertOriginal(); return original.baseline; };
  };
  const mutationAuthority = (source: GitProjectResources, target: GitProjectResources | undefined, bridge: { saved?: Capture }): GitMutationInvocationAuthority => {
    const original = invocation(), readAuthorityRevisionSync = authorityFence([source, ...(target ? [target] : [])]);
    let exactBinding: string | undefined;
    return { owner: { sessionId: owner.sessionId, sessionFile: owner.sessionFile, generation: original.generation }, readAuthorityRevisionSync,
      assertCurrentSync(binding) {
        readAuthorityRevisionSync();
        if (!same(binding.owner, { sessionId: owner.sessionId, sessionFile: owner.sessionFile, generation: original.generation }) ||
          !same(binding.source, source) || !same(binding.target, target)) refuse("native-invocation-binding-mismatch");
        const current = digest(binding);
        if (exactBinding && exactBinding !== current) refuse("native-invocation-binding-mismatch");
        exactBinding ??= current;
        // Capture-time native reads are not effect approval. At apply the
        // controller has independently checked exact Ask or explicit saved Allow.
        if (bridge.saved && (bridge.saved.retired || !bridge.saved.executing || !bridge.saved.executionAuthorized))
          refuse("native-effect-authorization-required");
      } };
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
    readOwner();
    await revalidateGitProjectResources(source); await revalidateGitProjectResources(target);
  };
  const base = {
    readCandidate: registry.readCandidate, readNativeCompletion: registry.readNativeCompletion,
    readNativeFailure: registry.readNativeFailure,
    retire(handle: object, completed = false) { const saved = registry.readCapture<Capture>(handle); if (saved) {
      saved.retired = true;
      captures.delete(saved.candidate.revision);
      if (saved.cohort && !completed) retireGitCheckCohort(saved.cohort);
      if (saved.prepared) retireGitPreparedApply(saved.prepared);
      if (saved.plan) retireSelectedIntegrationPlan(saved.plan);
      if (saved.workspace) retireGitWorkspaceCandidate(saved.workspace);
      if (saved.cleanupCandidate) saved.cleanupEngine!.retire(saved.cleanupCandidate);
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
      if (!saved.executingStarted && saved.prepared && !sameGitPreparationDependencies(saved.prepared.snapshot,
        await preflightGitPreparation({ source: selector(saved.candidate.source), target: selector(saved.candidate.target!) }, agentDir))) refuse("native-capture-stale");
    },
  };
  const workspace: SelectedNativeAdapter<"workspace"> = { ...base,
    async capture(request) {
      requireLeaf(workspaceNative, "applyGitWorkspaceOperationWithAuthority", SELECTED_RUNTIME_BLOCKERS.workspace);
      const source = await readers.readResources(request.selector), policy = await readers.readPolicy(source, owner);
      const authorityGuard = captureAuthorityGuard(source);
      const bridge: { saved?: Capture } = {};
      const nativeAuthority = mutationAuthority(source, undefined, bridge);
      const native = await captureGitWorkspaceOperation(request.workspace, {}, nativeAuthority);
      try {
      const candidate: SelectedNativeCandidate = { operation: "workspace", source, sourceOid: native.sourceOid,
        actionId: native.actionId, policyRevision: policy.revision, history: snapshotGitWorkspaceAction(source, native),
        revision: digest([source, native, policy.revision]), ...(native.parentCreation ? { parentCreation: native.parentCreation } : {}) };
      bridge.saved = { candidate, workspace: native, authorityGuard, executingStarted: false };
      return register(bridge.saved);
      } catch (error) { retireGitWorkspaceCandidate(native); throw error; }
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.workspace) refuse("native-workspace-capture-required");
      await execution.authorize(); saved.executionAuthorized = true;
      saved.executing = execution; saved.executingStarted = true;
      let result;
      const guard = saved.authorityGuard;
      const apply = requireLeaf<(options: Parameters<typeof applyGitWorkspaceOperation>[0] & { assertCurrentSync(): void }) => ReturnType<typeof applyGitWorkspaceOperation>>(
        workspaceNative, "applyGitWorkspaceOperationWithAuthority", SELECTED_RUNTIME_BLOCKERS.workspace);
      try { result = await apply({ candidate: saved.workspace,
        authorize: async () => { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); await execution.authorize(); guard(); },
        assertCurrentSync() { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); } }); }
      catch (cause) { if (cause instanceof GitWorkspaceOperationError && cause.facts) registry.failure(cause, {
        kind: "partial", actionId: execution.actionId, candidateRevision: saved.candidate.revision, recoveryRequired: true, workspace: cause.facts }); throw cause; }
      const proof = readGitWorkspaceNativeProof(result); if (!proof) refuse("actual-native-workspace-proof-required");
      saved.workspaceProof = proof;
      return registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
        completedAt: performance.now(), completion: { operation: "workspace", result, proof,
          creation: { mode: proof.mode, destination: proof.destination, originalSource: saved.candidate.source, branchRef: proof.branchRef } } }, result);
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
      return register({ candidate, checks: rows, cohort: createGitCheckCohort(c.checks.checkIndexes), receipts: [], runs: [], before: c.orderingState, executingStarted: false });
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.checks || !saved.receipts) refuse("native-check-capture-required");
      saved.executing = execution; saved.executingStarted = true;
      try { for (const row of saved.checks) {
        await execution.authorize();
        const receipt = await runGitCheckoutVerification({ ...checkOptions(saved.candidate.source, row.binding.checkIndex, row.binding.stage, execution),
          cohort: saved.cohort,
          onExecution: (handle) => {
            // Optional prepublication facts. They can explain failure, never
            // finish a passing batch or establish a receipt.
            const measured = readGitCheckoutVerificationNativeExecution(handle);
            if (measured) saved.runs!.push(measured);
          } });
        const measured = readGitCheckoutVerificationNativeExecution(receipt);
        if (!measured || measured.actionId !== execution.actionId || measured.sessionId !== owner.sessionId ||
          measured.checkIndex !== row.binding.checkIndex || measured.stage !== row.binding.stage || measured.recipeDigest !== row.snapshot.recipeDigest ||
          measured.snapshotDigest !== gitCheckDigest(JSON.stringify(row.snapshot)) || measured.environmentDigest !== row.binding.environmentDigest ||
          measured.policyDigest !== row.binding.policyDigest || measured.executionCwd !== row.executionCwd ||
          measured.receipt?.id !== receipt.id || measured.exitStatus !== 0 || !measured.containmentComplete || measured.timedOut || measured.overflow)
          refuse("actual-published-native-receipt-required");
        saved.runs = [...saved.runs!.filter((r) => r.checkIndex !== measured.checkIndex), measured];
        saved.receipts.push(receipt);
      } } catch (cause) {
        if (saved.cohort) retireGitCheckCohort(saved.cohort);
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
      const bridge: { saved?: Capture } = {};
      const nativeAuthority = mutationAuthority(source, target, bridge);
      const prepared = await prepareGitPreparationApply({ source: request.selector, target: request.target }, agentDir, nativeAuthority);
      try {
      const resultTree = prepared.candidate.comparison.commits.at(-1)?.newTreeOid ?? await treeOid(source, prepared.candidate.newSourceOid);
      const diff = await withGitProjectReview(source, (repo) => getGitTreeDiff(repo,
        prepared.candidate.comparison.commits.at(-1)?.oldTreeOid ?? resultTree, resultTree));
      const candidate: SelectedNativeCandidate = { operation: "prepare", source, target, sourceOid: prepared.snapshot.source.oid,
        targetOid: prepared.snapshot.target.oid, policyRevision: policy.revision, invocationOwner: nativeAuthority.owner,
        history: snapshotGitPreparationAction(source, target, prepared.candidate, resultTree, diff),
        revision: digest([prepared, source, target, policy.revision]), ...(prepared.snapshot.status === "already-prepared" ? { noEffect: "already-prepared" } : {}) };
      const before = paired(candidate, owner, captureContext.operationId);
      bridge.saved = { candidate, prepared, before, authorityGuard, executingStarted: false };
      return register(bridge.saved);
      } catch (error) { retireGitPreparedApply(prepared); throw error; }
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.prepared || !saved.before) refuse("native-capture-required");
      await execution.authorize(); saved.executionAuthorized = true;
      saved.executing = execution; saved.executingStarted = true;
      const guard = saved.authorityGuard;
      const apply = requireLeaf<(options: Parameters<typeof applyGitPreparation>[0] & { assertCurrentSync(): void }) => ReturnType<typeof applyGitPreparation>>(
        preparationNative, "applyGitPreparationWithAuthority", SELECTED_RUNTIME_BLOCKERS.prepare);
      const result = await apply({ prepared: saved.prepared, actionId: execution.actionId,
        authorize: async () => { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); await execution.authorize(); guard(); saved.executionAuthorized = true; },
        assertCurrentSync() { if (!guard) refuse("mandatory-native-authority-guard-required"); guard(); } }).catch((cause: unknown) => {
          const facts = readGitPreparationNativeOutcome(cause);
          if (facts && cause && typeof cause === "object") registry.failure(cause, { kind: "partial", actionId: execution.actionId,
            candidateRevision: saved.candidate.revision, recoveryRequired: true, nativeOutcome: facts });
          throw cause;
        });
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
      const nativeAuthority = mutationAuthority(source, target, bridge);
      const readAuthorityRevisionSync = nativeAuthority.readAuthorityRevisionSync;
      const originalAuthorityRevision = readAuthorityRevisionSync();
      const plan = await prepareSelectedIntegration({ sessionId: owner.sessionId, agentDir, source, target, nativeAuthority,
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
          if (!receipt) refuse("authentic-sealed-check-receipt-required");
          await checkAuthority(source); return true;
        },
        readAuthorityRevisionSync,
        authorize: async (_phase, candidate) => {
          if (!same(candidate.context.source, source) || !same(candidate.context.target, target) || candidate.context.policyRevision !== policy.revision ||
            bridge.saved?.plan && candidate.planId !== bridge.saved.plan.planId) refuse("native-authorization-binding-mismatch");
          const stamp = originalAuthorityRevision, binding = digest(candidate);
          if (readAuthorityRevisionSync() !== stamp) refuse("authority-revoked");
          if (bridge.saved?.executing) { await bridge.saved.executing.authorize(); bridge.saved.executionAuthorized = true; }
          else { readOwner(); if (!trusted(source) || !trusted(target)) refuse("untrusted-project"); }
          return () => {
            if (digest(candidate) !== binding || readAuthorityRevisionSync() !== stamp) refuse("authority-revoked");
          };
        },
      });
      try {
      const candidate: SelectedNativeCandidate = { operation: "integrate", source, target,
        sourceOid: plan.review.featureOid, targetOid: plan.review.targetOid, policyRevision: policy.revision, invocationOwner: nativeAuthority.owner,
        revision: digest([plan, source, target, policy.revision]), history: { kind: "integration", repositoryRoot: source.cwd,
          ...gitActionAttribution(source, target), featureBranch: source.branch, targetBranch: target.branch,
          featureOid: plan.review.featureOid, targetOid: plan.review.targetOid, integrationMethod: "method" in plan ? "ff" : "merge",
          ...("method" in plan ? {} : { mergeOid: plan.mergeOid, message: plan.message }), checks: [], diff: plan.diff } };
      bridge.saved = { candidate, plan, before: paired(candidate, owner, captureContext.operationId), executingStarted: false };
      return register(bridge.saved);
      } catch (error) { retireSelectedIntegrationPlan(plan); throw error; }
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.plan) refuse("native-capture-required");
      saved.executing = execution; saved.executingStarted = true;
      await execution.authorize(); saved.executionAuthorized = true;
      const result = await confirmSelectedIntegration(saved.plan.planId, saved.plan.planId, owner.sessionId).catch((cause: unknown) => {
        const facts = readGitIntegrationNativeOutcome(cause);
        if (facts && cause && typeof cause === "object") registry.failure(cause, { kind: "partial", actionId: execution.actionId,
          candidateRevision: saved.candidate.revision, recoveryRequired: true, nativeOutcome: facts });
        throw cause;
      });
      if (result.result.status !== "integrated" || !result.nativeHandle) {
        registry.failure(result, { kind: "partial", actionId: execution.actionId, candidateRevision: saved.candidate.revision, recoveryRequired: true, integration: result });
        throw result;
      }
      const proof = readSelectedIntegrationNativeProof(result.nativeHandle); if (!proof) refuse("native-integration-proof-required");
      const completedAt = performance.now();
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
      const bridge: { saved?: Capture } = {};
      // Source deletion is a native, explicitly proved transition, not a new
      // policy baseline or a diagnostic callback acknowledgement.
      const nativeAuthority = mutationAuthority(source, target, bridge);
      const assertGuard = () => {
        nativeAuthority.readAuthorityRevisionSync();
        const removed = bridge.saved?.removal;
        if (removed) {
          const facts = readNativeCleanupProof(removed);
          if (!facts || facts.kind !== "removed" || !same(facts.invocationOwner, nativeAuthority.owner) ||
            !same(facts.sourceIdentity, source.identities.checkout) || facts.sourcePath !== source.cwd || facts.adminPath !== source.gitDir ||
            !absent(source.cwd) || !absent(source.gitDir)) refuse("own-native-removal-required");
        }
      };
      const adapters: Parameters<typeof createGitCleanupEngine>[0] & { assertCurrentSync(): void } = {
        nativeAuthority, assertCurrentSync: assertGuard,
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
          invocation().add(selected);
          const roots = await getAllowedFileRoots();
          if (!same(selected.identities.project, target.identities.project) || !same(selected.identities.common, target.identities.common) ||
            !isExistingFilePathAllowed(selected.cwd, roots) || !trusted(selected)) refuse("designated-main-unavailable");
          return selected;
        },
        async authorize(phase, candidate, removal) {
          if (phase === "before-delete") {
            if (!bridge.saved || !candidate || candidate !== bridge.saved.cleanupCandidate || !removal) refuse("own-native-removal-required");
            // Accept the privately associated original proof before readOwner,
            // policy discovery or ANY normal read of the transitioning fence.
            invocation().acceptCleanup(candidate, removal);
            const facts = readNativeCleanupProof(removal);
            if (!facts || facts.kind !== "removed" ||
              facts.actionId !== candidate.actionId || facts.featureOid !== integrationProof.featureOid ||
              !same(facts.invocationOwner, nativeAuthority.owner) || !same(facts.sourceIdentity, source.identities.checkout) ||
              facts.sourcePath !== source.cwd || facts.adminPath !== source.gitDir || !absent(source.cwd) || !absent(source.gitDir)) refuse("own-native-removal-required");
            bridge.saved.removal = removal;
          }
          readOwner();
          const resources = bridge.saved?.removal ? target : source;
          await revalidateGitProjectResources(resources); if (!trusted(target)) refuse("untrusted-project");
          if (bridge.saved?.executing) { assertGuard(); await bridge.saved.executing.authorize(); assertGuard(); bridge.saved.executionAuthorized = true; }
        },
      };
      const engine = createEngine(adapters);
      const native = await engine.capture({ integrationHandle: c.integrationHandle, creatorHandle: c.creatorHandle, ignoredNames: request.ignoredNames });
      try {
      invocation().bindCleanup(native);
      const evidence = readGitCleanupCandidateEvidence(native);
      if (!evidence || evidence.actionId !== native.actionId || !same(evidence.integration, integrationProof)) refuse("actual-native-cleanup-evidence-required");
      const candidate: SelectedNativeCandidate = { operation: "cleanup", source, target, sourceOid: native.featureOid,
        targetOid: evidence.target.oid, actionId: native.actionId, policyRevision: policy.revision,
        history: snapshotGitCleanupAction(source, target, { featureOid: native.featureOid, targetOid: evidence.target.oid,
          mainOid: evidence.mainSnapshot.oid, sourcePath: source.cwd, branchRef: native.featureRef, targetPath: target.cwd, mainPath: evidence.main.cwd,
          source: capturedCheckout(source), target: capturedCheckout(target), main: capturedCheckout(evidence.main),
          integration: { completedAt: integrationProof.completedAt, delivery: integrationProof.delivery, method: integrationProof.method,
            actualFF: integrationProof.actualFF, featureOid: integrationProof.featureOid, previousTargetOid: integrationProof.previousTargetOid,
            resultOid: integrationProof.resultOid, resultTree: integrationProof.resultTree, parents: [...integrationProof.parents] }, provenance: { mode: "create", originalSourcePath: creationProof.originalSource.cwd,
            originalSource: capturedCheckout(creationProof.originalSource), branchRef: creationProof.branchRef },
          ignoredCount: native.ignored.length, ignoredDeletion: native.ignored.length ? "exact-approval-required" : "none", ignored: [...native.ignored] }),
        cleanup: { integrationHandle: c.integrationHandle, creatorHandle: c.creatorHandle,
          ignoredNames: native.ignored.map((row) => row.path) }, revision: digest([native, evidence, policy.revision]) };
      bridge.saved = { candidate, cleanupEngine: engine, cleanupCandidate: native, cleanupEvidence: structuredClone(evidence), executingStarted: false };
      return register(bridge.saved);
      } catch (error) { engine.retire(native); throw error; }
    },
    async execute(handle, execution) {
      const saved = registry.readCapture<Capture>(handle); if (!saved?.cleanupEngine || !saved.cleanupCandidate) refuse("native-cleanup-capture-required");
      await execution.authorize(); saved.executionAuthorized = true;
      saved.executing = execution; saved.executingStarted = true;
      try {
        const { proof } = await saved.cleanupEngine.apply(saved.cleanupCandidate);
        const facts = readNativeCleanupProof(proof);
        if (!facts || facts.kind !== "completed" || !same(facts.removal.invocationOwner, saved.candidate.invocationOwner)) refuse("own-native-cleanup-completion-required");
        cleanupProofs.set(proof, facts);
        const completed = registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
          completedAt: performance.now(), completion: { operation: "cleanup", proof } }, proof);
        return completed;
      } catch (cause) {
        const refusal = refusalContext.getStore()!;
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
      // Read-only reconciliation cannot invent a rewrite or repair uncertainty.
      if (snapshot.status !== "already-prepared") refuse("native-clean-reconciliation-required");
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
      const guard = saved.authorityGuard;
      if (!guard) refuse("mandatory-native-authority-guard-required");
      guard(); await execution.authorize(); guard();
      const snapshot = await preflightGitPreparation({ source: selector(saved.candidate.source), target: selector(target) }, agentDir);
      if (!sameGitPreparationDependencies(snapshot, saved.reconcileSnapshot) || snapshot.status !== "already-prepared") refuse("native-reconciliation-state-changed");
      await execution.authorize(); guard();
      if (execution.previousLaunch) await assertConsumedCheck(execution.previousLaunch, saved.candidate.source, target);
      guard();
      const recoveryHandle = Object.freeze({}); recoveryProofs.set(recoveryHandle, { before, after: before, previousLaunch: execution.previousLaunch });
      const completedAt = performance.now();
      return registry.completed({ stage: "completed", actionId: execution.actionId, candidateRevision: saved.candidate.revision,
        completedAt, before: saved.before, after: saved.before,
        completion: { operation: "reconcile", disposition: execution.previousLaunch ? "recovered" : "revalidated", recoveryHandle } }, recoveryHandle);
    },
  };
  // Migrated leaves own native transactions. History is optional diagnostics,
  // never an execution reservation or a success-proof reader.
  async function beginInvocationDiagnostics(candidate: Readonly<SelectedNativeCandidate>, sink: ReturnType<typeof gitActionSink>) {
    // Controller validates in-memory candidates before its own narrowly caught
    // storage/anchor failures. Do not suppress candidate-validation failures.
    const action = candidate.actionId ? await beginGitActionWithId(candidate.actionId, sink, "agent", candidate.history, agentDir)
      : await beginGitAction(sink, "agent", candidate.history, agentDir);
    const warning = () => { const current = refusalContext.getStore(), report = gitActionDiagnosticReport(action); if (current && report.diagnostics) current.diagnostics = report.diagnostics; };
    warning();
    const record = action.record;
    const optional = async (write: () => Promise<unknown>) => { await write(); warning(); };
    return {
      action: { record, async update(...args: Parameters<NonNullable<typeof action>["update"]>) {
        const [state, details] = args;
        const intended: GitActionOutcome | undefined = state === "executing" && candidate.history.checkoutVerification ? {
          kind: "checkout-verification", checkoutVerification: { ...verificationBinding(candidate.history.checkoutVerification), runs: [] } } :
          state === "executing" && candidate.operation === "cleanup" ? { kind: "cleanup", cleanup: { ...cleanupBinding(captures.get(candidate.revision)!.cleanupEvidence!), effects: [] } } : undefined;
        if (action) await optional(() => action!.update(state, { ...details, ...(intended ? { intended } : {}) }));
      }, release() { action.release(); warning(); } },
      async recordNativeCompletion() { refuse("postpublication-native-result-required"); },
      async sealCompletion(handle: object) {
        // Fixed private readers authenticate the actual original object before
        // any optional write. No caller-supplied proof callback participates.
        const envelope = registry.readNativeCompletion(handle);
        if (!envelope || envelope.actionId !== record.id || envelope.candidateRevision !== candidate.revision) refuse("own-native-completion-required");
        const seal = await registry.seal(handle);
        if (action) {
          const completion = envelope.completion;
          let outcome: GitActionOutcome;
          if (completion.operation === "verify") {
            const runs = completion.receiptIds.map((id) => {
              const receipt = registry.readSealedReceipt(id), facts = receipt && readGitCheckoutVerificationNativeExecution(receipt);
              if (!facts?.receipt || facts.actionId !== record.id) refuse("own-published-native-receipt-required");
              return structuredClone(facts);
            });
            outcome = { kind: "checkout-verification", status: "passed", checkoutVerification: {
              ...verificationBinding(candidate.history.checkoutVerification!), runs } };
          } else if (completion.operation === "prepare") {
            const r = completion.result;
            outcome = { kind: "preparation", status: r.status, preparation: { oldSourceOid: r.oldSourceOid, newSourceOid: r.newSourceOid,
              targetMainOid: r.targetOid, resultTreeOid: r.status === "prepared" ? r.treeOid : candidate.history.preparation!.resultTreeOid } };
          } else if (completion.operation === "integrate") {
            const p = completion.integration;
            outcome = { status: "integrated", mergeOid: p.resultOid, tree: p.resultTree, parents: [...p.parents],
              featureOid: p.featureOid, targetOid: p.previousTargetOid, targetBranch: p.target.branch };
          } else if (completion.operation === "workspace") {
            const p = completion.proof;
            outcome = { kind: "workspace", status: p.mode === "create" ? "created" : "attached", workspace: {
              mode: p.mode, destinationPath: p.destination.cwd, branch: p.destination.branch!, tipOid: p.resultOid, treeOid: p.treeOid,
              ...(p.knownParentCreation ? { parentCreated: true, knownParentCreation: p.knownParentCreation } : {}) } };
          } else if (completion.operation === "cleanup") {
            const p = completion.proof, removal = p.removal, saved = captures.get(candidate.revision);
            if (!saved?.cleanupEvidence) refuse("native-cleanup-capture-required");
            outcome = { kind: "cleanup", status: "cleaned-up", cleanup: { ...cleanupBinding(saved.cleanupEvidence), effects: [
              { kind: "worktree-removed", sourcePath: removal.sourcePath, sourceIdentity: removal.sourceIdentity,
                adminPath: removal.adminPath, featureOid: removal.featureOid, exit: 0, sourceAbsent: true, adminAbsent: true,
                beforeInventoryDigest: digest(removal.before), afterInventoryDigest: digest(removal.after) },
              { kind: "branch-deleted", branchRef: p.deletedRef, deletedOid: p.deletedOid, transactionExit: 0, finalInventoryDigest: digest(p.finalInventory) }],
              nativeHeadReflogMayHaveChanged: p.nativeHeadReflogMayHaveChanged,
              ...(candidate.cleanup?.ignoredNames.length && saved.exactApproval ? { ignoredDataDeletionApproved: true } : {}) } };
          } else if (completion.operation === "reconcile") outcome = { status: "reviewed" };
          else return refuse("migrated-native-completion-required");
          await optional(() => action!.update("succeeded", { outcome }));
        }
        return seal;
      },
      readDurableCompletion: registry.readDurableCompletion,
      async recordFailure(failure: import("./git-selected-operation-controller").SelectedNativeFailure | undefined, execution: { executionStarted: boolean }) {
        if (action) await optional(() => failGitAction(action!, failure?.kind === "partial" && failure.nativeOutcome?.status === "no-checkout-effect" ? false : execution.executionStarted));
      },
    };
  }
  const journalAdmission: SelectedJournalAdmissionFactory = {
    async begin(boundOwner, candidate) {
      readOwner(); if (!same(boundOwner, owner)) refuse("durable-journal-owner-mismatch");
      const saved = captures.get(candidate.revision); if (!saved) refuse("private-native-capture-required");
      const sink = gitActionSink(m, context.appendEntry);
      return beginInvocationDiagnostics(candidate, sink);
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
      async assertReconciliation(handle, envelope, previousLaunch) {
        const facts = recoveryProofs.get(handle);
        if (!facts || facts.previousLaunch !== previousLaunch || !same(facts.before, envelope.before) || !same(facts.after, envelope.after)) refuse("independent-reconciliation-proof-required");
        if (previousLaunch) await assertConsumedCheck(previousLaunch, facts.after.source as GitProjectResources, facts.after.target as GitProjectResources);
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
        const approved = await context.ask(structuredClone(candidate)) === true;
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
    /** Trusted dispatch wraps discovery too: original capture is synchronous. */
    withInvocation<T>(callback: () => Promise<T>): Promise<T> {
      return invocationScope.run(originalInvocation(), callback);
    },
    async run<K extends SelectedControllerOperation>(operation: K, request: SelectedControllerRequests[K]): Promise<SelectedOperationResult> {
      return refusalContext.run({}, async () => { try {
        const original = invocationScope.getStore() ?? originalInvocation();
        return await invocationScope.run(original, async () => {
        readOwner();
        const result = await (controller[operation] as (r: SelectedControllerRequests[K]) => Promise<SelectedOperationResult>)(request);
        return { ...result, ...(result.code === "operation-refused" && refusalContext.getStore()?.code ? { code: refusalContext.getStore()!.code } : {}),
          ...(refusalContext.getStore()?.diagnostics ? { diagnosticsUnavailable: true as const, diagnostics: refusalContext.getStore()!.diagnostics } : {}) };
        });
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
function requireLeaf<T = (...args: never[]) => unknown>(module: object, name: string, code: string): T {
  const implementation = Reflect.get(module, name);
  if (typeof implementation !== "function") refuse(code);
  return implementation as T;
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
