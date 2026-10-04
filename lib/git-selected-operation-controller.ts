import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { captureSelectedOperationAuthorization, revalidateSelectedOperationAuthorization,
  type SelectedOperationAction, type SelectedOperationReaders, type SelectedOperationRequest } from "./git-selected-operation-authorization";
import { createGitPreparationReentryController, type GitPreparationReentryState,
  type GitPreparationReentryLaunch, type GitPreparationResultProof, type GitPreparationVerificationProof,
  type GitPreparationReconciliationProof } from "./git-preparation-reentry";
import { selectGitCheckoutVerificationChecks, type GitCheckoutVerificationReceipt } from "./git-checkout-verification";
import { normalizeGitCheckRecipe, type GitCheckRecipe, type GitCheckStage } from "./git-check-recipe";
import type { ProjectAuthorizationOwner } from "./git-project-authorization";
import type { GitProjectResources, GitResourceSelector } from "./git-project-resources";
import type { GitWorkspaceRequest, GitWorkspaceResult, GitWorkspaceCompletedProof,
  GitWorkspaceParentCreation, GitWorkspaceKnownParentCreation, GitWorkspaceFailureEvidence } from "./git-workspace-operation";
import type { GitPreparationApplyResult } from "./git-preparation-apply";
import type { SelectedIntegrationResult, SelectedIntegrationNativeCompletion } from "./git-selected-integration";
import type { GitCleanupCompletedProof, GitCleanupFailure, GitCleanupIntegration, GitCleanupCreatedWorkspace } from "./git-cleanup-operation";
import type { GitActionHandle } from "./git-action-controller";
import type { GitActionCandidateSnapshot, GitActionCheckoutVerificationSnapshot } from "./git-action-types";

/** Composition only. No dispatcher, singleton, task adoption, chat movement,
 * filesystem fallback, command overrides, test seams or callback tool arguments.
 * A runtime bridge must implement ALL contracts below before exposing dispatch. */
export type SelectedControllerOperation = "workspace" | "prepare" | "verify" | "integrate" | "cleanup" | "reconcile";
interface SelectionRequest { selector: GitResourceSelector; confirmation?: "ask" | "none" }
export type SelectedWorkspaceRequest = SelectionRequest & { workspace: GitWorkspaceRequest };
export type SelectedPrepareRequest = SelectionRequest & { target: GitResourceSelector };
export type SelectedVerifyRequest = SelectionRequest & {
  stage: GitCheckStage; checkIndexes?: readonly number[]; revisionDependency?: string;
};
export type SelectedIntegrateRequest = SelectionRequest & {
  target: GitResourceSelector; receiptIds?: readonly string[]; revisionDependency?: string;
};
export type SelectedCleanupRequest = SelectionRequest & { ignoredNames?: readonly string[] };
export type SelectedReconcileRequest = SelectionRequest & { target: GitResourceSelector };
/** Native capture inputs deliberately omit human preference and ordering tokens;
 * neither may be forwarded as leaf options or used as native proof. */
export type SelectedNativeRequests = {
  [K in SelectedControllerOperation]: Omit<SelectedControllerRequests[K], "confirmation" | "revisionDependency">;
};
export interface SelectedControllerRequests {
  workspace: SelectedWorkspaceRequest; prepare: SelectedPrepareRequest; verify: SelectedVerifyRequest;
  integrate: SelectedIntegrateRequest; cleanup: SelectedCleanupRequest; reconcile: SelectedReconcileRequest;
}

export type SelectedCleanupHistory = GitActionCandidateSnapshot & {
  kind: "cleanup"; cleanup: NonNullable<GitActionCandidateSnapshot["cleanup"]>;
};
/** Controller-local contract pending the history owner's matching strict union.
 * Both are independent SOURCE checks, never paired v1 or a commit candidate tree.
 * Clean v2 labels only a verified clean checkout/index/HEAD, not dirty workspace
 * coverage. Working v3 remains mandatory exclusively for commit. No conversion. */
export type SelectedCheckoutVerificationSnapshot = Omit<GitActionCheckoutVerificationSnapshot, "evidenceScope" | "stage"> & (
  { evidenceScope: "working-workspace"; stage: "commit" } |
  { evidenceScope: "clean-checkout"; stage: Exclude<GitCheckStage, "commit"> }
);
export type SelectedCheckoutVerificationHistory = Omit<GitActionCandidateSnapshot, "kind" | "checkoutVerification"> & {
  kind: "checkout-verification"; checkoutVerification: SelectedCheckoutVerificationSnapshot;
};
/** This exact binding is read from the native capture registry, NEVER supplied
 * by a model. revision includes every candidate input, recipe/environment,
 * physical identity, relevant policy and ref/index/working-content facts. It
 * excludes journal/progress appends. Revalidate at every native effect boundary. */
export interface SelectedNativeCandidate {
  operation: SelectedControllerOperation;
  revision: string;
  source: GitProjectResources;
  target?: GitProjectResources;
  sourceOid: string;
  targetOid?: string;
  policyRevision: string;
  invocationOwner?: import("./git-mutation-invocation").GitMutationInvocationAuthority["owner"];
  history: GitActionCandidateSnapshot | SelectedCleanupHistory | SelectedCheckoutVerificationHistory;
  /** Workspace/cleanup captures already allocate their native action UUID. */
  actionId?: string;
  noEffect?: "already-prepared";
  /** Commit uses genuine working-workspace v3; other stages are target-free v2. */
  checks?: { stage: GitCheckStage; checkIndexes: readonly number[] };
  /** Exact server-detected additional namespace creation, NEVER a model option. */
  parentCreation?: Readonly<GitWorkspaceParentCreation>;
  cleanup?: { integrationHandle: object; creatorHandle: object; ignoredNames: readonly string[] };
}
export type SelectedNativeCompletion = {
  operation: "prepare"; result: Exclude<GitPreparationApplyResult, { status: "partial-state" }>;
} | { operation: "workspace"; result: GitWorkspaceResult; creation: GitCleanupCreatedWorkspace;
  proof: GitWorkspaceCompletedProof }
  | { operation: "verify"; status: "passed"; receiptIds: readonly string[] }
  | { operation: "integrate"; result: SelectedIntegrationResult; integration: SelectedIntegrationNativeCompletion }
  | { operation: "cleanup"; proof: GitCleanupCompletedProof }
  | { operation: "reconcile"; disposition: GitPreparationReconciliationProof["disposition"];
    /** Independent current exact admission/cleanliness/recovery proof, not flags
     * inferred from time, a no-op, history, or a request to renew a token. */
    recoveryHandle: object };
export interface SelectedCompletionEnvelope {
  /** Pending native callbacks/admission resolution are NOT completed results. */
  stage: "completed";
  /** Bridge normalizes the actual native completion time to bootstrap's
   * monotonic clock; publication/journal time must not replace completion time. */
  actionId: string; candidateRevision: string; completedAt: number;
  /** Required only for paired preparation/reentry/reconciliation; standalone
   * checks/workspace need no invented target or fake task prerequisites. */
  before?: GitPreparationReentryState; after?: GitPreparationReentryState;
  completion: SelectedNativeCompletion;
}
export type SelectedNativeFailure = {
  kind: "partial"; actionId: string; candidateRevision: string; recoveryRequired: true;
  nativeOutcome?: import("./git-native-checkout-transaction").NativeCheckoutOutcome;
  preparation?: Extract<GitPreparationApplyResult, { status: "partial-state" }>;
  integration?: SelectedIntegrationResult; cleanup?: GitCleanupFailure; workspace?: GitWorkspaceFailureEvidence;
};

export interface SelectedJournalActionHandle {
  readonly record: { id: string; sessionId: string; kind: GitActionCandidateSnapshot["kind"] | "cleanup" };
  update: GitActionHandle["update"];
  release: GitActionHandle["release"];
}
/** Private runtime projection. Native identity sealing is independent of optional
 * diagnostic publication; this interface never acquires resource ownership. */
export interface SelectedJournalAdmission {
  action: SelectedJournalActionHandle;
  /** Called by actual leaf completion callbacks/intent wrappers. Read the actual
   * native registry (including pending-admission preparation), persist measured
   * outcome via action wrappers, and NEVER publish ordering proof here. */
  recordNativeCompletion(handle: object): Promise<void>;
  /** Fixed native readers authenticate ORIGINAL completed objects and their
   * original invocation. Optional history is not a barrier or a proof reader. */
  sealCompletion(nativeHandle: object): Promise<object>;
  readDurableCompletion(seal: object): { stage: "completed"; actionId: string; nativeHandle: object; candidateRevision: string } | undefined;
  recordFailure(failure: SelectedNativeFailure | undefined, context: { executionStarted: boolean; code: string }): Promise<void>;
}
export interface SelectedJournalAdmissionFactory {
  /** Use beginGitActionWithId for supported native action UUIDs; otherwise
   * beginGitAction. Read-only reconciliation can use genuine review history,
   * NOT a fake preparation/verifier success. Use the native cleanup/checker
   * journal wrappers with actual completion readers. Persist an anchor before
   * returning. Owner must match the bound session. */
  begin(owner: Readonly<ProjectAuthorizationOwner>, candidate: Readonly<SelectedNativeCandidate>): Promise<SelectedJournalAdmission>;
}
export interface SelectedNativeExecution {
  actionId: string; operationId: string;
  journalAdmission: SelectedJournalAdmission;
  /** Noninteractive live assertion. Native MUST await before each effect and
   * final ref/CAS, including EACH check launch and completion sealing. Human
   * waits are exclusively before execute and outside native/admission gates.
   * Selected integration additionally requires its trusted synchronous LIVE
   * authority-revision reader/postguard at launch; this async assertion is NOT
   * that postguard and the bridge must never supply a constant/void fallback. */
  authorize(): Promise<void>;
  onNativeCompleted(handle: object): Promise<void>;
  previousLaunch?: GitPreparationReentryLaunch;
}
export interface SelectedNativeCaptureContext {
  owner: Readonly<ProjectAuthorizationOwner>; operationId: string;
  checks?: { stage: GitCheckStage; checkIndexes: readonly number[] };
  /** Separately authenticated REQUIRED-stage selection, NOT ordering ledger.
   * If the request omits IDs, the bridge may independently select exact live
   * integration-stage recipe receipts. Never forward the all-receipt ledger. */
  receiptIds: readonly string[];
  orderingState?: GitPreparationReentryState;
  integrationHandle?: object; creatorHandle?: object;
}
export interface SelectedNativeAdapter<K extends SelectedControllerOperation> {
  capture(request: Readonly<SelectedNativeRequests[K]>, context: SelectedNativeCaptureContext): Promise<object>;
  readCandidate(handle: object): SelectedNativeCandidate | undefined;
  /** Exact capture or independently verified OWN native progress allowance;
   * never recapture/widen to unrelated ref/index changes after an effect. */
  assertExact(handle: object): Promise<void>;
  /** Return ONLY an opaque actual completed-result registry handle. Never a
   * model callback/result, optimistic pending promise, or plain leaf JSON. */
  execute(handle: object, execution: SelectedNativeExecution): Promise<object>;
  /** Workspace proof facts MUST originate from readGitWorkspaceNativeProof on
   * the EXACT issued intent proof object, not the public GitWorkspaceResult or
   * a JSON clone (neither is registered). Capture that opaque identity in the
   * native callback; publish only after actual apply/intent completion returned. */
  readNativeCompletion(handle: object): SelectedCompletionEnvelope | undefined;
  /** Resolve thrown objects/results by identity; no parsing of error strings. */
  readNativeFailure(cause: unknown): SelectedNativeFailure | undefined;
  /** Retire native plans/approvals, including a proven pre-effect target move. */
  retire(handle: object, completed?: boolean): void;
}
export interface SelectedSealedCleanupPrerequisites {
  integration: { handle: object; proof: GitCleanupIntegration };
  creation: { handle: object; proof: GitCleanupCreatedWorkspace };
}
export type SelectedNativeAdapters = { [K in SelectedControllerOperation]: SelectedNativeAdapter<K> } & {
  /** Optional RESULT, mandatory reader: authenticate only private native+
   * durable journal/admission COMPLETED registries, including operations from
   * other live controller instances. Never restore capabilities from history.
   * This does not grant ownership, actor authority or ordering tokens. */
  readCleanupPrerequisites(owner: Readonly<ProjectAuthorizationOwner>, source: Readonly<GitProjectResources>):
    Promise<SelectedSealedCleanupPrerequisites | undefined>;
  /** Actual native lookup only; never history, casts or upgraded v2 receipts. */
  readReceipt(id: string): GitCheckoutVerificationReceipt | undefined;
  /** Fresh native validation is mandatory. Commit MUST use the genuine v3
   * working-workspace reader/binding; integration/handoff/manual remain native
   * v2 source-only checks. A clean v2 receipt never proves a working workspace,
   * and working evidence never claims staged candidate-tree verification. */
  assertReceipt(candidate: SelectedNativeCandidate, receipt: GitCheckoutVerificationReceipt): Promise<void>;
  /** Prove no active/uncertain launch, fresh native cleanliness, admission and
   * any necessary independent recovery; authenticate recoveryHandle by identity. */
  assertReconciliation(handle: object, envelope: SelectedCompletionEnvelope, previousLaunch?: GitPreparationReentryLaunch): Promise<void>;
};
/** Deny-only historical observation, NEVER ordering/approval/receipt authority.
 * Read durable completed AND in-flight managed preparations independently, bind
 * to this actual physical source instance and CURRENT actual tip. A positive
 * independent classification must establish this is genuinely never-prepared,
 * not merely that this generation forgot its WeakMaps or that a tip moved.
 * Unknown includes unavailable/incomplete evidence; it is NOT independent. */
export type SelectedPreparationOrderingRequirement = {
  kind: "independent"; source: GitProjectResources; sourceOid: string; evidenceRevision: string;
} | { kind: "unknown" };
export interface SelectedOperationControllerBootstrap {
  owner: ProjectAuthorizationOwner;
  /** readCaller revision must cover saved file INSTANCE/identity, effective tools
   * and relevant policy facts, not entry count/mtime/each journal append.
   * Caller need NOT be in Git: the live authorization helper's positively
   * verified non-Git caller union is supported without movement/task adoption.
   * Cleanup authorization uses the sealed integration's SURVIVING target, never
   * rediscovery of the removed source. Original native own-removal proof and
   * live unchanged owner/permission/physical target checks remain mandatory. */
  authorization: SelectedOperationReaders;
  native: SelectedNativeAdapters;
  journalAdmission: SelectedJournalAdmissionFactory;
  isTrusted(resources: Readonly<GitProjectResources>): Promise<boolean>;
  /** Independently read the CURRENT REAL user entry ID, never a model argument. */
  currentUserRequestId(owner: Readonly<ProjectAuthorizationOwner>): Promise<string>;
  readPreparationOrderingRequirement(owner: Readonly<ProjectAuthorizationOwner>, source: Readonly<GitProjectResources>):
    Promise<SelectedPreparationOrderingRequirement>;
  /** Request-specific exact UI; outside all native gates. No saved grant is
   * created. Return true only for approval of this exact candidate/evidence. */
  approveExact(input: { requestId: string; actionId: string; operation: SelectedControllerOperation;
    candidate: Readonly<SelectedNativeCandidate>; authorizationRevision: string; ignoredNames: readonly string[] }): Promise<boolean>;
  /** Trusted monotonic clock, tests only override. */
  now?: () => number;
}
export interface SelectedOperationResult {
  status: "completed" | "already-prepared" | "no-defined" | "no-required" | "blocked" | "recovery-required";
  operation: SelectedControllerOperation;
  actionId?: string; code?: string;
  sourceOid?: string; targetOid?: string; resultOid?: string; treeOid?: string;
  scope?: { projectRoot: string; checkoutPath: string; branch: string };
  revisionDependency?: string;
  receiptIds?: readonly string[];
  diagnosticsUnavailable?: true;
  diagnostics?: import("./git-action-types").GitActionDiagnosticWarning;
  knownParentCreation?: GitWorkspaceKnownParentCreation;
  recoveryRequired?: true;
  /** Actual measured partial checkpoints; never guidance to retry. */
  knownFacts?: { observedSourceOid?: string | null; newSourceOid?: string; treeOid?: string;
    checkoutAttempted?: boolean; refUpdateCompleted?: boolean; indexInstalled?: boolean; completionVerified?: boolean;
    nativeStatus?: import("./git-native-checkout-transaction").NativeCheckoutOutcome["status"];
    refPrepared?: boolean; refCommitSent?: boolean; refAcknowledged?: boolean; indexSynced?: boolean;
    directorySyncFailed?: boolean; childReaped?: boolean;
    removeAttempted?: boolean; removalVerified?: boolean; removalRecorded?: boolean; branchDeleteAttempted?: boolean;
    branchDeleteVerified?: boolean; sourceAbsent?: boolean | null; featureRefAbsent?: boolean | null;
    parentCreationAttempted?: boolean; parentCreated?: boolean; knownParentCreation?: GitWorkspaceKnownParentCreation;
    destinationPresent?: boolean | null; observedBranchOid?: string | null };
}
const actions: Record<SelectedControllerOperation, SelectedOperationAction> = {
  workspace: "workspace", prepare: "prepare", verify: "checks", integrate: "integration", cleanup: "cleanup", reconcile: "prepare",
};
const historyKinds = { workspace: "workspace", prepare: "preparation", verify: "checkout-verification", integrate: "integration",
  cleanup: "cleanup", reconcile: "review" } as const;
// Native readers and canonical selection legitimately emit different key order.
// Compare authenticated STRUCTURAL facts, not JSON insertion order; identity
// authentication remains exclusively in the opaque native/durable readers.
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, current) =>
  current && typeof current === "object" && !Array.isArray(current)
    ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : current) ?? "undefined").digest("hex");
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
// Native recipe/snapshot signature domain is verbatim JSON, unlike structural
// comparison above. Never rewrite native digest facts or history into authority.
const nativeDigest = (value: string) => createHash("sha256").update(value).digest("hex");
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096 && !/[\x00-\x1f\x7f]/.test(s);
const oid = (s: unknown): s is string => typeof s === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
class Refused extends Error { constructor(readonly code: string) { super(code); } }
function requireFact(value: unknown, code: string): asserts value { if (!value) throw new Refused(code); }
function strictObject(value: unknown, keys: readonly string[]) {
  requireFact(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((k) => keys.includes(k)), "invalid-request");
}
function selection(value: GitResourceSelector) {
  strictObject(value, ["repositoryPath", "checkoutPath", "workspaceBranch"]);
  requireFact(text(value.repositoryPath) && text(value.checkoutPath) && (value.workspaceBranch === undefined || text(value.workspaceBranch)), "invalid-request");
}
const requestKeys = {
  workspace: ["workspace"], prepare: ["target"], verify: ["stage", "checkIndexes", "revisionDependency"],
  integrate: ["target", "receiptIds", "revisionDependency"], cleanup: ["ignoredNames"], reconcile: ["target"],
} as const;
function validate<K extends SelectedControllerOperation>(operation: K, request: SelectedControllerRequests[K]) {
  strictObject(request, ["selector", "confirmation", ...requestKeys[operation]]);
  selection(request.selector);
  requireFact(request.confirmation === undefined || request.confirmation === "ask" || request.confirmation === "none", "invalid-request");
  if ("target" in request) selection(request.target);
  if ("revisionDependency" in request) requireFact(request.revisionDependency === undefined || text(request.revisionDependency), "invalid-request");
  if ("receiptIds" in request && request.receiptIds !== undefined) {
    requireFact(Array.isArray(request.receiptIds) && request.receiptIds.length <= 64 && request.receiptIds.every(text)
      && new Set(request.receiptIds).size === request.receiptIds.length, "invalid-request");
  }
  if ("stage" in request) {
    requireFact(["none", "commit", "integration", "handoff"].includes(request.stage), "invalid-request");
    if (request.checkIndexes !== undefined) requireFact(Array.isArray(request.checkIndexes) && request.checkIndexes.length > 0
      && request.checkIndexes.length <= 64 && request.checkIndexes.every((n) => Number.isSafeInteger(n) && n >= 0)
      && new Set(request.checkIndexes).size === request.checkIndexes.length, "invalid-request");
  }
  if ("ignoredNames" in request && request.ignoredNames !== undefined) requireFact(Array.isArray(request.ignoredNames)
    && request.ignoredNames.length <= 2000 && request.ignoredNames.every((s) => text(s) && !/[*?\[\]{}]/.test(s))
    && new Set(request.ignoredNames).size === request.ignoredNames.length, "invalid-request");
  if ("workspace" in request) {
    const w = request.workspace;
    strictObject(w, ["repositoryPath", "sourceCheckoutPath", "destinationPath", "branch", "baseBranch", "expectedBaseOid", "mode", "expectedTipOid"]);
    requireFact([w.repositoryPath, w.sourceCheckoutPath, w.destinationPath, w.branch, w.baseBranch].every(text)
      && oid(w.expectedBaseOid) && (w.mode === "create" && !("expectedTipOid" in w) || w.mode === "attach" && oid(w.expectedTipOid))
      && w.repositoryPath === request.selector.repositoryPath && w.sourceCheckoutPath === request.selector.checkoutPath, "invalid-request");
  }
}
function sourceKey(owner: ProjectAuthorizationOwner, source: GitProjectResources) {
  // Paths/branch names are exact candidate facts, NOT separate fence namespaces:
  // two aliases of one physical checkout cannot fork an outstanding chain.
  return digest([owner, source.identities.project, source.identities.checkout, source.identities.git, source.identities.common]);
}
function state(candidate: SelectedNativeCandidate, owner: ProjectAuthorizationOwner, operationId: string): GitPreparationReentryState {
  requireFact(candidate.target && oid(candidate.sourceOid) && oid(candidate.targetOid), "paired-state-required");
  return { sessionId: owner.sessionId, operationId, policyRevision: candidate.policyRevision,
    source: candidate.source, target: candidate.target, sourceOid: candidate.sourceOid, targetOid: candidate.targetOid };
}
type Chain = { operationId: string; receipts: string[]; dependency?: string; pending?: GitPreparationReentryLaunch;
  state?: GitPreparationReentryState; reconciled?: boolean; recovery: boolean; retiredBy?: string;
};

export function createGitSelectedOperationController(bootstrap: SelectedOperationControllerBootstrap) {
  requireFact(bootstrap && bootstrap.authorization && bootstrap.native && bootstrap.journalAdmission
    && typeof bootstrap.journalAdmission.begin === "function" && typeof bootstrap.isTrusted === "function"
    && typeof bootstrap.currentUserRequestId === "function" && typeof bootstrap.approveExact === "function"
    && typeof bootstrap.readPreparationOrderingRequirement === "function", "trusted-bootstrap-required");
  requireFact([bootstrap.authorization.readResources, bootstrap.authorization.readCaller, bootstrap.authorization.readPolicy,
    bootstrap.authorization.readAuthorization, bootstrap.authorization.revalidateResources, bootstrap.authorization.readCurrentPolicy,
    bootstrap.authorization.readCurrentAuthorization, bootstrap.authorization.revalidateCurrent].every((f) => typeof f === "function")
    && (bootstrap.now === undefined || typeof bootstrap.now === "function"), "live-authorization-readers-required");
  for (const k of Object.keys(actions) as SelectedControllerOperation[]) {
    const a = bootstrap.native[k];
    requireFact(a && [a.capture, a.readCandidate, a.assertExact, a.execute, a.readNativeCompletion, a.readNativeFailure, a.retire]
      .every((f) => typeof f === "function"), "native-adapters-required");
  }
  requireFact([bootstrap.native.readReceipt, bootstrap.native.assertReceipt,
    bootstrap.native.readCleanupPrerequisites, bootstrap.native.assertReconciliation].every((f) => typeof f === "function"), "native-adapters-required");
  const owner = Object.freeze(structuredClone(bootstrap.owner));
  requireFact(owner && [owner.sessionId, owner.sessionFile, owner.sessionCwd].every(text), "ordinary-owner-required");
  const native = bootstrap.native, readers = bootstrap.authorization, now = bootstrap.now ?? (() => performance.now());
  const preparations = new WeakMap<object, GitPreparationResultProof>();
  const verifications = new WeakMap<object, GitPreparationVerificationProof>();
  const reconciliations = new WeakMap<object, GitPreparationReconciliationProof>();
  const ordering = createGitPreparationReentryController({ readPreparationResult: (h) => preparations.get(h),
    readVerificationResult: (h) => verifications.get(h), readReconciliationResult: (h) => reconciliations.get(h), now });
  const fences = new Map<string, Chain>(), tokens = new Map<string, Chain>();
  const integrations = new Map<string, { handle: object; proof: GitCleanupIntegration }>();
  const creations = new Map<string, { handle: object; proof: GitCleanupCreatedWorkspace }>();
  let disposed = false;
  function retire(chain: Chain) {
    if (chain.dependency) tokens.delete(chain.dependency);
    chain.dependency = undefined;
    chain.receipts = [];
    chain.reconciled = false;
    chain.recovery = true;
  }
  async function orderingRequirement(source: GitProjectResources) {
    const requirement = await bootstrap.readPreparationOrderingRequirement(owner, source);
    requireFact(requirement && ["independent", "unknown"].includes(requirement.kind), "ordering-state-unavailable");
    if (requirement.kind !== "unknown") requireFact(same(requirement.source, source)
      && oid(requirement.sourceOid) && text(requirement.evidenceRevision), "ordering-state-unavailable");
    return requirement;
  }
  function publish(chain: Chain, dependency: string) {
    if (chain.dependency) tokens.delete(chain.dependency);
    chain.dependency = dependency; chain.pending = undefined; chain.recovery = false; tokens.set(dependency, chain);
  }
  async function run<K extends SelectedControllerOperation>(operation: K, raw: SelectedControllerRequests[K]): Promise<SelectedOperationResult> {
    let key: string | undefined, candidateHandle: object | undefined, candidate: SelectedNativeCandidate | undefined;
    let journal: SelectedJournalAdmission | undefined, executing = false, finished = false, chain: Chain | undefined;
    let nativeResultHandle: object | undefined, actualCompletion: SelectedCompletionEnvelope | undefined;
    let consumed = false, userEntry: string | undefined;
    let operationId: string = randomUUID();
    const adapter = native[operation] as SelectedNativeAdapter<K>;
    const requestId = randomUUID();
    try {
      requireFact(!disposed, "controller-disposed");
      validate(operation, raw);
      const request = structuredClone(raw);
      const source = structuredClone(await readers.readResources(request.selector));
      key = sourceKey(owner, source);
      requireFact(fences.size < 128 || fences.has(key), "capacity");
      userEntry = await bootstrap.currentUserRequestId(owner);
      requireFact(text(userEntry), "current-user-request-required");
      chain = fences.get(key);
      if (operation === "prepare" && chain?.recovery && chain.retiredBy && chain.retiredBy !== userEntry) {
        fences.delete(key); chain = undefined;
      }
      const dependent = operation === "verify" || operation === "integrate";
      const requirement = dependent || operation === "prepare" || operation === "reconcile" ? await orderingRequirement(source) : undefined;
      if (requirement && requirement.kind !== "independent" && !chain) {
        chain = { operationId: randomUUID(), receipts: [], recovery: true }; fences.set(key, chain);
      }
      if (chain?.state && requirement && requirement.kind !== "unknown" && requirement.sourceOid !== chain.state.sourceOid
        && operation !== "reconcile") retire(chain);
      // Unknown CURRENT physical state can only deny. A fresh completed live proof in
      // THIS generation is the sole override, and only for its exact epoch.
      if (dependent && requirement?.kind === "unknown" && (!chain?.state || !chain.reconciled || chain.recovery))
        throw new Refused("ordering-state-unavailable");
      operationId = chain?.operationId ?? operationId;
      // This is a fresh request/capture, never a replay. The old launch/target
      // snapshot must not reach the new prepare.
      let cleanupIntegration = integrations.get(key), cleanupCreation = creations.get(key);
      if (operation === "cleanup") {
        if (!cleanupIntegration || !cleanupCreation) {
          const sealed = await native.readCleanupPrerequisites(owner, source);
          cleanupIntegration ??= sealed?.integration; cleanupCreation ??= sealed?.creation;
        }
        requireFact(cleanupIntegration && cleanupCreation && cleanupCreation.proof.mode === "create"
          && same(cleanupIntegration.proof.feature, source) && same(cleanupCreation.proof.destination, source)
          && cleanupIntegration.proof.target.projectRoot === source.projectRoot && cleanupIntegration.proof.target.commonDir === source.commonDir
          && same(cleanupIntegration.proof.target.identities.common, source.identities.common)
          && same(cleanupIntegration.proof.target.identities.project, source.identities.project), "sealed-cleanup-proofs-required");
      }
      // The exact B source/refs/disposition/ignored allowance remain in request+
      // native candidate revision. Policy/grants/caller reads stay on surviving A
      // for the ENTIRE operation, including AFTER independently proved own removal.
      const authorizationResources = operation === "cleanup" ? cleanupIntegration!.proof.target : source;
      const authSelector = operation === "cleanup" ? { repositoryPath: authorizationResources.projectRoot,
        checkoutPath: authorizationResources.cwd, workspaceBranch: authorizationResources.branch } : request.selector;
      const authRequest: SelectedOperationRequest = { action: actions[operation], owner, selector: authSelector,
        confirmation: request.confirmation, requestId, requestRevision: digest([operation, request]) };
      // Initial live eligibility before native capture; a candidate adds its exact binding below.
      const initial = await captureSelectedOperationAuthorization(authRequest, readers);
      requireFact(initial.kind === "evidence", initial.kind === "blocked" ? initial.code : "authorization-unavailable");
      requireFact(await bootstrap.isTrusted(authorizationResources), "untrusted-project");
      let checks: SelectedNativeCaptureContext["checks"];
      let savedChecks: { recipes: readonly GitCheckRecipe[]; requiredIndexes: readonly number[] } | undefined;
      if (operation === "verify") {
        const r = request as SelectedVerifyRequest;
        const policy = await readers.readPolicy(source, owner);
        const defined = policy.resolved.session.values.checks;
        savedChecks = { recipes: policy.project.checks ?? [], requiredIndexes: r.stage === "none" ? []
          : selectGitCheckoutVerificationChecks(policy.project.checks ?? [], r.stage).checkIndexes };
        const discovery = r.stage === "none" ? { status: defined.length ? "required" : "no-defined",
          checkIndexes: defined.map((_, i) => i).filter((i) => (defined[i].requiredStage ?? "integration") === "none") }
          : selectGitCheckoutVerificationChecks(defined, r.stage);
        // Optional/manual recipes never become implicit prerequisite commands.
        // Explicit stage:none indexes DO run and may advance ordering, but their
        // receipts are never submitted as integration-stage prerequisites.
        const indexes = r.checkIndexes ?? (r.stage === "none" ? [] : discovery.checkIndexes);
        if (r.checkIndexes) requireFact(indexes.every((i) => discovery.checkIndexes.includes(i)), "check-stage-mismatch");
        if (!indexes.length) {
          const fresh = await revalidateSelectedOperationAuthorization(authRequest, initial.evidence, readers);
          requireFact(fresh.kind === "evidence", fresh.kind === "blocked" ? fresh.code : "authorization-unavailable");
          requireFact(await bootstrap.isTrusted(source), "untrusted-project");
          return { operation, status: discovery.status === "no-defined" ? "no-defined" : "no-required",
            scope: { projectRoot: source.projectRoot, checkoutPath: source.cwd, branch: source.branch } };
        }
        checks = { stage: r.stage, checkIndexes: [...indexes] };
      }
      if ((operation === "verify" || operation === "integrate") && !chain)
        requireFact(!(request as SelectedVerifyRequest | SelectedIntegrateRequest).revisionDependency, "invalid-revision-dependency");
      if ((operation === "verify" || operation === "integrate") && chain) {
        const token = (request as SelectedVerifyRequest | SelectedIntegrateRequest).revisionDependency;
        requireFact(!chain.recovery && token && tokens.get(token) === chain && chain.dependency === token, "revision-dependency-required");
      }
      // A new prepare cannot fork its own outstanding/uncertain rewrite.
      // An independent explicit user request has already retired that local chain;
      // its native capture, live authority and actual rewrite are still required.
      // Ordinary no-op MUST NOT erase the fence or mint another dependency.
      const context: SelectedNativeCaptureContext = { owner, operationId, checks,
        orderingState: chain?.state ? structuredClone(chain.state) : undefined,
        receiptIds: operation === "integrate" ? [...((request as SelectedIntegrateRequest).receiptIds ?? [])] : [],
        ...(operation === "cleanup" ? { integrationHandle: cleanupIntegration!.handle, creatorHandle: cleanupCreation!.handle } : {}) };
      const captureInput = Object.fromEntries(["selector", ...requestKeys[operation]]
        .filter((k) => k !== "revisionDependency" && Object.hasOwn(request, k))
        .map((k) => [k, (request as unknown as Record<string, unknown>)[k]])) as unknown as SelectedNativeRequests[K];
      candidateHandle = await adapter.capture(captureInput, context);
      requireFact(candidateHandle && typeof candidateHandle === "object", "native-capture-required");
      const observed = adapter.readCandidate(candidateHandle);
      requireFact(observed && observed.operation === operation && text(observed.revision) && text(observed.policyRevision)
        && observed.history.kind === historyKinds[operation]
        && observed.history.repositoryRoot === source.cwd
        && same(observed.source, source), "native-candidate-mismatch");
      candidate = structuredClone(observed);
      const candidateBinding = digest(observed);
      // Preserve registry identities: structuredClone is deliberately not authority.
      if (observed.cleanup) candidate.cleanup = { ...observed.cleanup, ignoredNames: [...observed.cleanup.ignoredNames] };
      requireFact(oid(candidate.sourceOid), "native-candidate-mismatch");
      if ("target" in request) {
        const target = await readers.readResources(request.target);
        requireFact(candidate.target && same(candidate.target, target) && await bootstrap.isTrusted(target), "native-target-mismatch");
      }
      if (requirement && requirement.kind !== "unknown") requireFact(candidate.sourceOid === requirement.sourceOid, "ordering-tip-changed");
      if (checks) {
        requireFact(same(candidate.checks, checks), "native-checks-mismatch");
        const h = candidate.history.checkoutVerification;
        requireFact(h && h.stage === checks.stage && h.evidenceScope === (checks.stage === "commit" ? "working-workspace" : "clean-checkout")
          && h.candidateTreeVerified === false && h.repositoryChecksWaived === false
          && h.sourceOid === candidate.sourceOid && oid(h.sourceTreeOid) && h.policyRevision === candidate.policyRevision
          && sha256(h.snapshotDigest) && sha256(h.policyDigest)
          && h.source.gitDir === source.gitDir && same(h.source.checkoutIdentity, source.identities.checkout)
          && same(h.source.gitIdentity, source.identities.git) && same(h.source.markerIdentity, source.identities.marker)
          && same(h.checks.map((row) => row.checkIndex), checks.checkIndexes)
          && h.checks.every((row) => sha256(row.recipeDigest) && sha256(row.environmentDigest) && text(row.executionCwd)
            && row.recipeDigest === nativeDigest(JSON.stringify(row.recipe)) && savedChecks?.recipes[row.checkIndex]
            && same(normalizeGitCheckRecipe(row.recipe), normalizeGitCheckRecipe(savedChecks.recipes[row.checkIndex])))
          && same(h.requiredSavedIndexes, savedChecks?.requiredIndexes),
        "native-verification-evidence-mismatch");
      }
      if (operation === "workspace") requireFact(same(candidate.parentCreation, candidate.history.workspace?.parentCreation), "native-parent-mismatch");
      if ((operation === "verify" || operation === "integrate") && chain?.state)
        requireFact(same(state(candidate, owner, operationId), chain.state), "ordering-state-changed");
      if (operation === "prepare" && chain) requireFact(candidate.noEffect === "already-prepared", "fresh-user-request-required");
      if (operation === "cleanup") requireFact(candidate.target && same(candidate.target, authorizationResources)
        && candidate.cleanup && candidate.cleanup.integrationHandle === cleanupIntegration!.handle
        && candidate.cleanup.creatorHandle === cleanupCreation!.handle
        && same([...candidate.cleanup.ignoredNames].sort(), [...((request as SelectedCleanupRequest).ignoredNames ?? [])].sort()), "exact-ignored-approval-required");
      authRequest.requestRevision = digest([operation, request, candidate.revision]);
      const captured = await captureSelectedOperationAuthorization(authRequest, readers);
      requireFact(captured.kind === "evidence", captured.kind === "blocked" ? captured.code : "authorization-unavailable");
      const evidence = captured.evidence;
      journal = await bootstrap.journalAdmission.begin(owner, candidate);
      requireFact(journal?.action && text(journal.action.record.id) && journal.action.record.sessionId === owner.sessionId
        && journal.action.record.kind === candidate.history.kind
        && (!candidate.actionId || candidate.actionId === journal.action.record.id)
        && [journal.action.update, journal.action.release, journal.recordNativeCompletion, journal.sealCompletion,
          journal.readDurableCompletion, journal.recordFailure]
          .every((f) => typeof f === "function"), "journal-admission-required");
      const actionId = journal.action.record.id;
      const forceIgnoredAsk = !!candidate.cleanup?.ignoredNames.length;
      requireFact(!candidate.noEffect || operation === "prepare", "invalid-native-noop");
      if (!candidate.noEffect && (evidence.kind === "exact-approval-required" || forceIgnoredAsk)) {
        await journal.action.update("awaiting-decision");
        requireFact(await bootstrap.approveExact({ requestId, actionId, operation, candidate: structuredClone(candidate),
          authorizationRevision: evidence.revision, ignoredNames: candidate.cleanup?.ignoredNames ?? [] }), "approval-denied");
      }
      const live = async () => {
        requireFact(!disposed, "controller-disposed");
        requireFact(await bootstrap.currentUserRequestId(owner) === userEntry, "user-request-changed");
        if (dependent) {
          const currentRequirement = await orderingRequirement(candidate!.source);
          requireFact(currentRequirement.kind !== "unknown" || chain?.state && chain.reconciled && !chain.recovery, "ordering-state-unavailable");
          requireFact(currentRequirement.kind === "unknown" || currentRequirement.sourceOid === candidate!.sourceOid, "ordering-tip-changed");
        }
        const fresh = await revalidateSelectedOperationAuthorization(authRequest, evidence, readers);
        requireFact(fresh.kind === "evidence", fresh.kind === "blocked" ? fresh.code : "authorization-unavailable");
        requireFact(await bootstrap.isTrusted(authorizationResources)
          && (operation === "cleanup" || !candidate!.target || await bootstrap.isTrusted(candidate!.target)), "untrusted-project");
        const latestCandidate = adapter.readCandidate(candidateHandle!);
        requireFact(latestCandidate && digest(latestCandidate) === candidateBinding && digest(candidate) === candidateBinding
          && (!candidate!.cleanup || latestCandidate.cleanup?.integrationHandle === candidate!.cleanup.integrationHandle
            && latestCandidate.cleanup.creatorHandle === candidate!.cleanup.creatorHandle), "native-candidate-changed");
        await adapter.assertExact(candidateHandle!);
      };
      await live(); // Post-human-wait, outside native gates.
      if ((operation === "verify" || operation === "integrate") && chain) {
        const token = (request as SelectedVerifyRequest | SelectedIntegrateRequest).revisionDependency;
        const launch = ordering.gate.consume({ stage: operation === "verify" ? "verify" : "integrate",
          revisionDependency: token, state: state(candidate, owner, chain.operationId), receiptIds: chain.receipts });
        consumed = true; chain.pending = launch;
        tokens.delete(token!); chain.dependency = undefined;
      }
      const startedAt = now();
      await journal.action.update("executing", { decision: "approved" }); executing = true;
      await live();
      const nativeHandle = await adapter.execute(candidateHandle, { actionId, operationId, journalAdmission: journal,
        authorize: live, onNativeCompleted: (h) => journal!.recordNativeCompletion(h), previousLaunch: chain?.pending });
      nativeResultHandle = nativeHandle;
      const nativeEnvelope = adapter.readNativeCompletion(nativeHandle);
      if (!nativeEnvelope) throw nativeHandle;
      // Snapshot authenticated facts before another await; a journal callback
      // cannot retarget the proof by mutating a shared registry projection.
      const envelope: SelectedCompletionEnvelope = { ...nativeEnvelope,
        before: nativeEnvelope.before ? structuredClone(nativeEnvelope.before) : undefined,
        after: nativeEnvelope.after ? structuredClone(nativeEnvelope.after) : undefined,
        completion: nativeEnvelope.completion.operation === "reconcile" ? { ...nativeEnvelope.completion }
          : structuredClone(nativeEnvelope.completion) };
      requireFact(envelope && envelope.stage === "completed" && envelope.actionId === actionId && envelope.candidateRevision === candidate.revision
        && envelope.completion.operation === operation && Number.isFinite(envelope.completedAt)
        && envelope.completedAt >= startedAt && envelope.completedAt <= now(), "native-completion-required");
      const before = operation === "prepare" || operation === "reconcile" || operation === "integrate" || operation === "verify" && chain
        ? stateIfPaired(candidate, owner, operationId) : undefined;
      requireFact(!before || envelope.before && same(envelope.before, before), "native-before-mismatch");
      if (candidate.noEffect) requireFact(envelope.completion.operation === "prepare"
        && envelope.completion.result.status === "already-prepared", "native-noop-mismatch");
      if (envelope.completion.operation === "verify") {
        const ids = envelope.completion.receiptIds;
        requireFact(checks && Array.isArray(ids) && ids.every(text) && ids.length === checks.checkIndexes.length
          && new Set(ids).size === ids.length, "all-check-receipts-required");
        const indexes: number[] = [];
        for (const id of ids) {
          const receipt = native.readReceipt(id);
          requireFact(receipt && receipt.kind === "selected-checkout-verification"
            && (checks.stage === "commit" ? receipt.version === 3 && receipt.snapshot.version === 3
              && receipt.evidenceScope === "working-workspace" && receipt.candidateTreeVerified === false && receipt.repositoryChecksWaived === false
              && receipt.snapshot.evidenceScope === "working-workspace" && receipt.snapshot.candidateTreeVerified === false && receipt.snapshot.repositoryChecksWaived === false
              : receipt.version === 2 && receipt.snapshot.version === 2
                && [receipt, receipt.snapshot].every((facts) =>
                  (Reflect.get(facts, "evidenceScope") === undefined || Reflect.get(facts, "evidenceScope") === "clean-checkout")
                  && ["candidateTreeVerified", "repositoryChecksWaived"].every((flag) => Reflect.get(facts, flag) === undefined || Reflect.get(facts, flag) === false)
                  && !Object.keys(facts).some((key) => key.startsWith("workspace"))))
            && receipt.sessionId === owner.sessionId && receipt.stage === checks.stage
            && same(receipt.selection, candidate.source) && receipt.exitStatus === 0, "actual-sealed-receipt-required");
          const h = candidate.history.checkoutVerification!, row = h.checks.find((r) => r.checkIndex === receipt.checkIndex), s = receipt.snapshot;
          requireFact(row && receipt.policyRevision === candidate.policyRevision && receipt.policyDigest === h.policyDigest
            && receipt.recipeDigest === row.recipeDigest && receipt.executionCwd === row.executionCwd && receipt.environmentDigest === row.environmentDigest
            && s.policyDigest === h.policyDigest && s.policyRevision === nativeDigest(candidate.policyRevision)
            && s.recipeDigest === row.recipeDigest && s.environmentDigest === row.environmentDigest
            && s.checkDigest === nativeDigest(JSON.stringify({ checkIndex: row.checkIndex, recipe: row.recipe }))
            && s.stageDigest === nativeDigest(checks.stage) && s.checkoutPath === nativeDigest(candidate.source.cwd)
            && s.checkoutIdentity === nativeDigest(JSON.stringify(candidate.source.identities))
            && s.resourceIdentity === nativeDigest(candidate.source.commonDir + "\u0000" + JSON.stringify(candidate.source.identities.common))
            && s.branch === nativeDigest(`refs/heads/${candidate.source.branch}`) && s.head === nativeDigest(candidate.sourceOid) && s.tree === nativeDigest(h.sourceTreeOid)
            && receipt.snapshotDigest === nativeDigest(JSON.stringify(s))
            && (row !== h.checks[0] || receipt.snapshotDigest === h.snapshotDigest), "native-receipt-binding-mismatch");
          await native.assertReceipt(candidate, receipt); indexes.push(receipt.checkIndex);
        }
        requireFact(same(indexes.sort((a, b) => a - b), [...checks.checkIndexes].sort((a, b) => a - b)), "all-check-receipts-required");
        if (chain) requireFact(envelope.before && envelope.after && same(envelope.before, envelope.after), "native-after-mismatch");
      }
      if (envelope.completion.operation === "prepare") {
        const r = envelope.completion.result;
        requireFact(envelope.before && envelope.after && r.oldSourceOid === candidate.sourceOid
          && r.targetOid === candidate.targetOid && oid(r.newSourceOid)
          && same({ ...envelope.before, sourceOid: r.newSourceOid }, envelope.after), "native-after-mismatch");
      }
      if (envelope.completion.operation === "reconcile") {
        requireFact(before && envelope.before && envelope.after && same(envelope.before, envelope.after), "current-exact-reconciliation-required");
        await native.assertReconciliation(envelope.completion.recoveryHandle, envelope, chain?.pending);
      }
      if (envelope.completion.operation === "workspace") {
        const c = envelope.completion, w = (request as SelectedWorkspaceRequest).workspace, d = c.creation.destination;
        requireFact(c.result.actionId === actionId && c.proof.actionId === actionId && c.proof.mode === w.mode
          && c.creation.mode === w.mode && same(c.creation.originalSource, candidate.source)
          && same(d, c.proof.destination) && d.cwd === w.destinationPath && d.branch === w.branch
          && d.projectRoot === candidate.source.projectRoot && d.commonDir === candidate.source.commonDir
          && same(d.identities.project, candidate.source.identities.project) && same(d.identities.common, candidate.source.identities.common)
          && c.creation.branchRef === `refs/heads/${w.branch}` && c.result.path === w.destinationPath && c.result.branch === w.branch
          && c.result.status === (w.mode === "create" ? "created" : "attached")
          && c.result.oid === (w.mode === "create" ? w.expectedBaseOid : w.expectedTipOid)
          && c.proof.version === 1 && c.proof.outcome === "completed" && c.proof.status === "clean"
          && candidate.invocationOwner && same(c.proof.invocationOwner, candidate.invocationOwner)
          && c.proof.sourceOid === candidate.sourceOid && c.proof.baseOid === w.expectedBaseOid
          && c.proof.branchRef === `refs/heads/${w.branch}` && c.proof.resultOid === c.result.oid
          && c.proof.treeOid === c.result.treeOid && oid(c.result.treeOid)
          && same(c.result.knownParentCreation, c.proof.knownParentCreation)
          && (candidate.parentCreation ? c.proof.knownParentCreation?.path === candidate.parentCreation.path
            && c.proof.knownParentCreation.ancestorPath === candidate.parentCreation.ancestorPath
            && c.proof.knownParentCreation.mode === candidate.parentCreation.mode
            && same(c.proof.knownParentCreation.ancestorIdentity, candidate.parentCreation.ancestorIdentity)
            : !c.proof.knownParentCreation), "sealed-creation-required");
      }
      if (envelope.completion.operation === "integrate") {
        const c = envelope.completion;
        requireFact(c.result.result.status === "integrated" && c.result.nativeOutcome.completionVerified
          && c.integration.delivery === "selected-local" && ["ff", "merge"].includes(c.integration.method)
          && c.integration.actualFF === (c.integration.method === "ff")
          && candidate.invocationOwner && same(c.integration.invocationOwner, candidate.invocationOwner) && same(c.integration.feature, source)
          && same(c.integration.target, candidate.target) && c.integration.featureOid === candidate.sourceOid
          && c.integration.previousTargetOid === candidate.targetOid && oid(c.integration.resultOid) && oid(c.integration.resultTree), "sealed-integration-required");
      }
      actualCompletion = envelope;
      const seal = await journal.sealCompletion(nativeHandle);
      const durable = journal.readDurableCompletion(seal);
      requireFact(durable && durable.stage === "completed" && durable.actionId === actionId && durable.nativeHandle === nativeHandle
        && durable.candidateRevision === candidate.revision, "durable-completion-required");
      const completion = envelope.completion;
      const result: SelectedOperationResult = { operation, actionId, status: "completed", sourceOid: candidate.sourceOid,
        targetOid: candidate.targetOid, scope: { projectRoot: source.projectRoot, checkoutPath: source.cwd, branch: source.branch } };
      if (completion.operation === "prepare") {
        requireFact(before && envelope.before && envelope.after, "paired-state-required");
        const handle = {};
        preparations.set(handle, { context: ordering.issuer.context, completedAt: envelope.completedAt,
          result: completion.result, before: envelope.before, after: envelope.after });
        const published = ordering.issuer.publishPreparationResult(handle);
        result.sourceOid = completion.result.newSourceOid;
        if (published.status === "already-prepared") result.status = "already-prepared";
        else {
          chain = { operationId, receipts: [], state: envelope.after, recovery: false }; fences.set(key, chain);
          publish(chain, published.revisionDependency); result.revisionDependency = published.revisionDependency;
          if (completion.result.status === "prepared") result.treeOid = completion.result.treeOid;
        }
      } else if (completion.operation === "verify") {
        result.receiptIds = [...completion.receiptIds];
        if (chain) {
          requireFact(envelope.before && envelope.after, "paired-state-required");
          const handle = {};
          verifications.set(handle, { completedAt: envelope.completedAt, launch: chain.pending!, status: "passed",
            before: envelope.before, after: envelope.after, receiptIds: completion.receiptIds });
          const published = ordering.issuer.publishVerificationResult(handle);
          chain.receipts.push(...completion.receiptIds); publish(chain, published.revisionDependency);
          result.revisionDependency = published.revisionDependency;
        }
      } else if (completion.operation === "integrate") {
        integrations.set(key, { handle: seal, proof: completion.integration });
        result.resultOid = completion.integration.resultOid; result.treeOid = completion.integration.resultTree;
        if (chain) { retire(chain); chain.retiredBy = userEntry; } // No successor.
      } else if (completion.operation === "workspace") {
        creations.set(sourceKey(owner, completion.creation.destination), { handle: seal, proof: completion.creation });
        result.resultOid = completion.result.oid; result.treeOid = completion.result.treeOid;
        result.knownParentCreation = completion.result.knownParentCreation;
        result.scope = { projectRoot: completion.creation.destination.projectRoot,
          checkoutPath: completion.creation.destination.cwd, branch: completion.creation.destination.branch };
      } else if (completion.operation === "reconcile") {
        requireFact(before && envelope.before && envelope.after && same(envelope.before, envelope.after), "current-exact-reconciliation-required");
        const handle = {};
        reconciliations.set(handle, { context: ordering.issuer.context, startedAt, completedAt: envelope.completedAt,
          status: "completed", disposition: completion.disposition, before: envelope.before, after: envelope.after, previousLaunch: chain?.pending });
        const published = ordering.issuer.publishReconciliationResult(handle);
        chain ??= { operationId, receipts: [], recovery: false }; fences.set(key, chain);
        chain.receipts = []; chain.state = envelope.after; chain.reconciled = true; publish(chain, published.revisionDependency);
        result.revisionDependency = published.revisionDependency;
      } else {
        requireFact(completion.proof.actionId === actionId, "sealed-cleanup-required");
        integrations.delete(key); creations.delete(key);
      }
      finished = true;
      return result;
    } catch (cause) {
      let failure: SelectedNativeFailure | undefined;
      try {
        failure = adapter.readNativeFailure(cause) ?? (nativeResultHandle ? adapter.readNativeFailure(nativeResultHandle) : undefined);
        // Authenticate the ORIGINAL handle first; snapshot only its deny-only
        // facts. A journal await must not retarget that private classification.
        if (failure) failure = structuredClone(failure);
      } catch { failure = undefined; /* unknown is not safe */ }
      if (key && executing && !chain && !fences.has(key) && (operation === "prepare" || operation === "integrate")) {
        chain = { operationId, receipts: [], recovery: true }; fences.set(key, chain);
      }
      if (chain && (executing || consumed)) { retire(chain); chain.retiredBy = userEntry; }
      if (journal) { try { await journal.recordFailure(failure, { executionStarted: executing,
        code: cause instanceof Refused ? cause.code : "operation-refused" }); } catch { /* preserve uncertainty */ } }
      const base: SelectedOperationResult = { operation, actionId: journal?.action.record.id,
        ...(candidate ? { sourceOid: candidate.sourceOid, targetOid: candidate.targetOid,
          scope: { projectRoot: candidate.source.projectRoot, checkoutPath: candidate.source.cwd, branch: candidate.source.branch } } : {}),
        status: executing || consumed ? "recovery-required" : "blocked", code: cause instanceof Refused ? cause.code : "operation-refused",
        ...(executing || consumed ? { recoveryRequired: true as const } : {}) };
      if (actualCompletion?.completion.operation === "prepare" && actualCompletion.completion.result.status === "prepared") {
        base.knownFacts = { newSourceOid: actualCompletion.completion.result.newSourceOid, treeOid: actualCompletion.completion.result.treeOid };
      } else if (actualCompletion?.completion.operation === "integrate") {
        base.knownFacts = { ...actualCompletion.completion.result.nativeOutcome };
        base.resultOid = actualCompletion.completion.integration.resultOid;
        base.treeOid = actualCompletion.completion.integration.resultTree;
      }
      if (failure && candidate && failure.actionId === journal?.action.record.id && failure.candidateRevision === candidate.revision) {
        if (failure.kind === "partial") {
          if (failure.nativeOutcome?.status === "no-checkout-effect") {
            base.status = "blocked"; base.recoveryRequired = undefined; base.code = "stale-candidate-new-request-required";
          }
          const p = failure.preparation, i = failure.integration?.nativeOutcome, c = failure.cleanup, w = failure.workspace;
          base.knownFacts = { ...(failure.nativeOutcome ? { nativeStatus: failure.nativeOutcome.status,
            checkoutAttempted: failure.nativeOutcome.checkoutAttempted, refPrepared: failure.nativeOutcome.refPrepared,
            refCommitSent: failure.nativeOutcome.refCommitSent, refAcknowledged: failure.nativeOutcome.refAcknowledged,
            refUpdateCompleted: failure.nativeOutcome.refAcknowledged, indexInstalled: failure.nativeOutcome.indexInstalled,
            indexSynced: failure.nativeOutcome.indexSynced, directorySyncFailed: failure.nativeOutcome.directorySyncFailed,
            childReaped: failure.nativeOutcome.childReaped, completionVerified: failure.nativeOutcome.status === "complete" } : {}), ...(p ? { observedSourceOid: p.observedSourceOid, newSourceOid: p.newSourceOid, treeOid: p.treeOid } : {}),
            ...(i ?? {}), ...(c ? { removeAttempted: c.removeAttempted, removalVerified: c.removalVerified, removalRecorded: c.removalRecorded,
              branchDeleteAttempted: c.branchDeleteAttempted, branchDeleteVerified: c.branchDeleteVerified,
              sourceAbsent: c.sourceAbsent, featureRefAbsent: c.featureRefAbsent } : {}),
            ...(w ? { parentCreationAttempted: w.parentCreationAttempted, parentCreated: w.parentCreated,
              knownParentCreation: w.knownParentCreation, destinationPresent: w.destinationPresent, observedBranchOid: w.observedBranchOid } : {}) };
        }
      }
      return base;
    } finally {
      try { if (candidateHandle) adapter.retire(candidateHandle, finished); }
      finally { journal?.action.release(); }
    }
  }
  return Object.freeze({
    workspace: (request: SelectedWorkspaceRequest) => run("workspace", request),
    prepare: (request: SelectedPrepareRequest) => run("prepare", request),
    verify: (request: SelectedVerifyRequest) => run("verify", request),
    integrate: (request: SelectedIntegrateRequest) => run("integrate", request),
    cleanup: (request: SelectedCleanupRequest) => run("cleanup", request),
    reconcile: (request: SelectedReconcileRequest) => run("reconcile", request),
    /** Invalidates this generation's private handles, never another invocation. */
    dispose() { disposed = true; ordering.issuer.dispose(); tokens.clear(); fences.clear(); integrations.clear(); creations.clear(); },
  });
}
function stateIfPaired(candidate: SelectedNativeCandidate, owner: ProjectAuthorizationOwner, operationId: string) {
  return candidate.target ? state(candidate, owner, operationId) : undefined;
}
