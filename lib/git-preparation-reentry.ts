import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { GitPreparationApplyResult } from "./git-preparation-apply";
import type { GitProjectResources } from "./git-project-resources";

const MAX_LIFETIME_MS = 5 * 60_000;
const MAX_PENDING_MS = 30 * 60_000;
const MAX_OPERATIONS = 128;
const MAX_CHECKS = 64;
const MAX_RECONCILIATIONS = 3;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** All fields are captured/revalidated by the server, never taken as authority
 * from a tool argument. operationId scopes one requested preparation/check chain;
 * it is not a task binding, workspace owner or repository-wide retry counter. */
export interface GitPreparationReentryState {
  sessionId: string;
  operationId: string;
  policyRevision: string;
  source: GitProjectResources;
  target: GitProjectResources;
  sourceOid: string;
  targetOid: string;
}

declare const contextBrand: unique symbol;
/** Private controller generation; serialization/restart cannot retain identity. */
export interface GitPreparationReentryContext { readonly [contextBrand]: true }

export interface GitPreparationResultProof {
  context: GitPreparationReentryContext;
  /** Monotonic timestamp captured when the actual result completed, using the
   * same clock as this controller (performance.now() in production). */
  completedAt: number;
  result: GitPreparationApplyResult;
  before: GitPreparationReentryState;
  after: GitPreparationReentryState;
}

declare const launchBrand: unique symbol;
/** Process-only launch identity. Copies/JSON have no standing. */
export interface GitPreparationReentryLaunch { readonly [launchBrand]: true }

export interface GitPreparationVerificationProof {
  completedAt: number;
  launch: GitPreparationReentryLaunch;
  status: "passed" | "failed" | "cancelled" | "partial-state";
  before: GitPreparationReentryState;
  after: GitPreparationReentryState;
  /** Newly issued live receipt IDs, not the accumulated list or history IDs.
   * The verifier must independently authenticate their exact candidate/recipe. */
  receiptIds: readonly string[];
}

/** A completed independent reconciliation, not an ordinary preparation no-op.
 * Both states are fresh CURRENT observations during this reconciliation, not
 * the previous chain's candidate. Stable adaptation/policy/resource changes
 * are allowed; before/after must agree exactly. No receipts carry over. */
export interface GitPreparationReconciliationProof {
  context: GitPreparationReentryContext;
  startedAt: number;
  completedAt: number;
  status: "completed";
  disposition: "revalidated" | "recovered" | "not-launched" | "definite-no-effect";
  before: GitPreparationReentryState;
  after: GitPreparationReentryState;
  /** Required if this controller knows a still-pending launch, including one
   * whose time bound expired. The registry must prove it is no longer active;
   * elapsed time alone NEVER supplies that proof. */
  previousLaunch?: GitPreparationReentryLaunch;
}

export type GitPreparationReentryBlocker = "unissued-result" | "invalid-proof" | "dependency-required" |
  "invalid-dependency" | "stale" | "state-changed" | "receipts-changed" | "terminal-result" | "capacity";
export class GitPreparationReentryError extends Error {
  readonly code: GitPreparationReentryBlocker;
  constructor(code: GitPreparationReentryBlocker) {
    super(`Preparation result reentry refused: ${code}`);
    this.code = code;
    this.name = "GitPreparationReentryError";
  }
}
function refuse(code: GitPreparationReentryBlocker): never { throw new GitPreparationReentryError(code); }

export interface GitPreparationRevisionResult {
  status: "rewritten" | "verified" | "reconciled";
  /** Non-enumerable: ordinary JSON/action-journal projection omits it. The
   * controller explicitly projects it into ONLY the completed live tool result. */
  readonly revisionDependency: string;
}
export interface GitPreparationReentryRequest {
  stage: "verify" | "integrate";
  revisionDependency: unknown;
  state: GitPreparationReentryState;
  /** Exact ORDERING-ledger receipts accumulated in this chain. They are NOT
   * the integration recipe selection or a list of required checks. Authenticating
   * actual receipts/recipes and applying authority remains independent. */
  receiptIds: readonly string[];
}
export interface GitPreparationReentryOptions {
  /** SECURITY BOUNDARY: trusted bootstrap only. Resolve object identity through
   * a PRIVATE WeakMap populated ONLY after native apply has actually returned
   * and its outcome/resources/old+new refs have been verified. Never implement
   * this by parsing caller data, SDK history, action IDs, approvals or receipts.
   * A plain native result, snapshot or prepared-apply handle alone is NOT proof. */
  readPreparationResult: (handle: object) => GitPreparationResultProof | undefined;
  /** Separate PRIVATE completed-verifier result registry, tied to the exact
   * consume() launch. Successful completion/containment and its completion time
   * must be independently proved before registry publication. A pending promise,
   * progress event or passing history card must not enter this registry.
   * Terminal/uncertain results may be registered
   * to retire the chain but cannot issue a successor. */
  readVerificationResult: (handle: object) => GitPreparationVerificationProof | undefined;
  /** PRIVATE completed reconciliation/disposition registry. Populate only after
   * independent admission, physical-resource/ref/policy revalidation, native
   * cleanliness and any required recovery/containment reconciliation have been
   * PROVED, with no active/uncertain run remaining. For not-launched/no-effect,
   * prove that definite outcome independently too. A disposition/admission flag
   * itself proves or grants nothing; this callback must not trust such request
   * flags, receipts, snapshots, history, ordinary no-ops or approvals. No route
   * or tool exposure is provided here. A restart requires a NEW live operation,
   * NEW registry entry and this controller's context, never a restored object. */
  readReconciliationResult: (handle: object) => GitPreparationReconciliationProof | undefined;
  /** Trusted test seam only. Production uses a monotonic process clock. */
  now?: () => number;
  /** Freshness of each COMPLETED result's unconsumed dependency, <=5 minutes.
   * A successful completed verifier/reconciliation gets its own fresh window. */
  lifetimeMs?: number;
  /** Finite launch-to-completion bound, default/cap 30 minutes. Separate from
   * token freshness. May be shortened to the trusted runner's maximum. Expiry
   * invalidates ordering, NOT containment, admission or recovery quarantine. */
  pendingLifetimeMs?: number;
}

function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) refuse("invalid-proof");
}
function resourceKey(resource: GitProjectResources): string {
  if (!resource?.identities) refuse("invalid-proof");
  const paths = [resource.projectRoot, resource.cwd, resource.branch, resource.commonDir, resource.gitDir];
  paths.forEach(text);
  const identities = ["project", "checkout", "common", "git", "marker"].map((name) => {
    const id = resource.identities[name as keyof GitProjectResources["identities"]];
    if (!id) refuse("invalid-proof");
    [id.device, id.inode, id.birthtime].forEach(text);
    return [id.device, id.inode, id.birthtime];
  });
  const marker = resource.identities.marker;
  if (marker.changed !== undefined) text(marker.changed);
  if (marker.size !== undefined) text(marker.size);
  return JSON.stringify([paths, identities, marker.changed ?? null, marker.size ?? null]);
}
function stateKeys(state: GitPreparationReentryState) {
  if (!state) refuse("invalid-proof");
  [state.sessionId, state.operationId, state.policyRevision].forEach(text);
  if (typeof state.sourceOid !== "string" || typeof state.targetOid !== "string" ||
      !OID.test(state.sourceOid) || !OID.test(state.targetOid)) refuse("invalid-proof");
  const source = resourceKey(state.source), target = resourceKey(state.target);
  // Canonical physical paths are already normalized by the resource selector.
  // No filesystem discovery/fallback or authority is performed in this module.
  if (state.source.projectRoot !== state.target.projectRoot || state.source.commonDir !== state.target.commonDir ||
      state.source.cwd === state.target.cwd || state.source.gitDir === state.target.gitDir || state.source.branch === state.target.branch ||
      JSON.stringify(state.source.identities.project) !== JSON.stringify(state.target.identities.project) ||
      JSON.stringify(state.source.identities.common) !== JSON.stringify(state.target.identities.common)) refuse("invalid-proof");
  const base = JSON.stringify([state.sessionId, state.operationId, state.policyRevision, source, target, state.targetOid]);
  return { scope: JSON.stringify([state.sessionId, state.operationId]), base,
    exact: JSON.stringify([base, state.sourceOid]) };
}
function receipts(ids: readonly string[]): string[] {
  if (!Array.isArray(ids) || ids.length > MAX_CHECKS) refuse("invalid-proof");
  ids.forEach(text);
  if (new Set(ids).size !== ids.length) refuse("invalid-proof");
  return [...ids].sort();
}
function resultWithDependency(status: GitPreparationRevisionResult["status"], dependency: string): GitPreparationRevisionResult {
  return Object.freeze(Object.defineProperty({ status }, "revisionDependency", { value: dependency, enumerable: false })) as GitPreparationRevisionResult;
}

type Epoch = { scope: string; exact: string; receiptIds: string[]; dependency?: string;
  expiresAt?: number; retired: boolean; recoveryRequired: boolean; pending?: PendingLaunch };
type PendingLaunch = { epoch: Epoch; launch: GitPreparationReentryLaunch;
  stage: GitPreparationReentryRequest["stage"]; startedAt: number; deadline: number };
type OperationScope = { current?: Epoch; checks: number; reconciliations: number };

/** Standalone control-flow foundation; no tool, route, Git mutation, journal or
 * automatic continuation. Keep issuer PRIVATE to the trusted operation controller;
 * expose only gate to dependent managed dispatch. There is intentionally no
 * exported mint(snapshot), restore(history), optional-token launch or singleton.
 *
 * publish* is called at completed tool-result publication, not during preview,
 * apply, progress, approval or prequeued dispatch. Unpredictability prevents an
 * invocation constructed before that result from supplying its dependency. It
 * cannot prove delivery/reading/reasoning by the model, semantic correctness,
 * receipt validity, trust, admission or operation authorization. Those checks
 * remain mandatory independently, including at the native effect boundary.
 *
 * Every dependent verify/integrate must consume BEFORE launch. Verify consumes
 * the old dependency and returns a private launch identity. ONLY its completed
 * successful result can publish a fresh successor, retaining ordering receipts.
 * Fresh tokens last <=5 minutes; pending launches have a separate <=30-minute
 * runner bound. Failed/stale/consumed/not-launched chains never restore tokens.
 * Explicit independently PROVED completed reconciliation can start a fresh
 * chain (zero receipts), including after adaptation/recovery/restart, without
 * demanding a user mutation. Ordinary no-op never clears/renews a dependency.
 *
 * Counters survive chain retirement/expiry: <=3 reconciliations and <=64 checks
 * per live server-owned session/operation scope. No target-movement counter.
 * The bounded ledger retains at most 128 scopes until controller disposal;
 * these are request budgets, NOT repository ownership/contention/grants. Do
 * not invent a new operationId to evade a budget within the same request.
 * Restart creates a new live request/controller, not restored ordering state.
 * Recreate PRIVATE registries; never serialize dependencies or replay objects.
 */
export function createGitPreparationReentryController(options: GitPreparationReentryOptions) {
  if (typeof options?.readPreparationResult !== "function" || typeof options.readVerificationResult !== "function" ||
      typeof options.readReconciliationResult !== "function") refuse("invalid-proof");
  const lifetime = options.lifetimeMs ?? MAX_LIFETIME_MS;
  const pendingLifetime = options.pendingLifetimeMs ?? MAX_PENDING_MS;
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > MAX_LIFETIME_MS ||
      !Number.isFinite(pendingLifetime) || pendingLifetime <= 0 || pendingLifetime > MAX_PENDING_MS) refuse("invalid-proof");
  const now = options.now ?? (() => performance.now());
  const readPreparation = options.readPreparationResult, readVerification = options.readVerificationResult;
  const readReconciliation = options.readReconciliationResult;
  const context = Object.freeze(Object.create(null)) as GitPreparationReentryContext;
  const usedResults = new WeakSet<object>();
  const launches = new WeakMap<GitPreparationReentryLaunch, PendingLaunch>();
  const scopes = new Map<string, OperationScope>();
  const tokens = new Map<string, Epoch>();
  let disposed = false;
  let lastTime = -Infinity;
  function time(): number {
    const current = now();
    if (disposed || !Number.isFinite(current) || current < lastTime) {
      scopes.clear(); tokens.clear(); disposed = true;
      refuse("stale");
    }
    lastTime = current;
    return current;
  }
  function retire(epoch: Epoch) {
    if (epoch.dependency) tokens.delete(epoch.dependency);
    epoch.dependency = undefined;
    epoch.retired = true;
    // Keep scope budgets and any pending identity: timeout is not proof that
    // a child stopped. Only independent completed reconciliation can renew it.
  }
  function prune(current: number, completedEpoch?: Epoch) {
    for (const { current: epoch } of scopes.values()) {
      if (epoch && epoch !== completedEpoch && (epoch.pending ? current >= epoch.pending.deadline :
        epoch.expiresAt !== undefined && current >= epoch.expiresAt)) retire(epoch);
    }
  }
  function live(epoch: Epoch) {
    if (epoch.retired || scopes.get(epoch.scope)?.current !== epoch) refuse("stale");
  }
  function scopeFor(key: string): OperationScope {
    let scope = scopes.get(key);
    if (!scope) {
      if (scopes.size >= MAX_OPERATIONS) refuse("capacity");
      scope = { checks: 0, reconciliations: 0 };
      scopes.set(key, scope);
    }
    return scope;
  }
  function authenticate(handle: object) {
    if (!handle || typeof handle !== "object" || usedResults.has(handle)) refuse("unissued-result");
  }
  function fresh(completedAt: number, current: number) {
    if (!Number.isFinite(completedAt) || completedAt < 0 || completedAt > current || current >= completedAt + lifetime) refuse("stale");
  }
  function issue(epoch: Epoch, status: GitPreparationRevisionResult["status"], completedAt: number) {
    // Each completed result has its OWN consumption window, not an epoch TTL.
    const dependency = randomBytes(32).toString("hex");
    epoch.dependency = dependency;
    epoch.expiresAt = completedAt + lifetime;
    tokens.set(dependency, epoch);
    return resultWithDependency(status, dependency);
  }
  function start(keys: ReturnType<typeof stateKeys>, scope: OperationScope) {
    if (scope.current) retire(scope.current);
    const epoch: Epoch = { scope: keys.scope, exact: keys.exact, receiptIds: [], retired: false, recoveryRequired: false };
    scope.current = epoch;
    return epoch;
  }
  const issuer = Object.freeze({
    /** PRIVATE generation stamp for trusted result registries, never a tool arg. */
    context,
    publishPreparationResult(handle: object): GitPreparationRevisionResult | { status: "already-prepared" } {
      const current = time(); prune(current); authenticate(handle);
      const proof = readPreparation(handle);
      if (!proof || proof.context !== context) refuse("unissued-result");
      usedResults.add(handle);
      fresh(proof.completedAt, current);
      const { result, before, after } = proof;
      if (result?.status !== "prepared" && result?.status !== "already-prepared") refuse("terminal-result");
      const from = stateKeys(before), to = stateKeys(after);
      if (from.base !== to.base || before.sourceOid !== result.oldSourceOid || after.sourceOid !== result.newSourceOid ||
          before.targetOid !== result.targetOid) refuse("invalid-proof");
      if (result.status === "already-prepared") {
        if (result.oldSourceOid !== result.newSourceOid) refuse("invalid-proof");
        return Object.freeze({ status: "already-prepared" });
      }
      if (result.oldSourceOid === result.newSourceOid || typeof result.treeOid !== "string" || !OID.test(result.treeOid)) refuse("invalid-proof");
      const scope = scopeFor(to.scope);
      return issue(start(to, scope), "rewritten", proof.completedAt); // Tree equivalence is irrelevant.
    },
    publishVerificationResult(handle: object): GitPreparationRevisionResult {
      const current = time(); authenticate(handle);
      const proof = readVerification(handle);
      if (!proof) refuse("unissued-result");
      usedResults.add(handle);
      const pending = launches.get(proof.launch);
      if (!pending || pending.stage !== "verify") refuse("unissued-result");
      launches.delete(proof.launch); // completion is single-use even on failure
      const { epoch, startedAt, deadline } = pending;
      // Authenticate the actual completion BEFORE pruning its pending epoch.
      // The runner bound measures launch-to-completion, not publication delay;
      // publication has its own completed-result freshness window. This does
      // not revive a retired/superseded epoch or release native containment.
      prune(current, epoch);
      try {
        live(epoch);
        fresh(proof.completedAt, current);
        if (proof.completedAt < startedAt || proof.completedAt > deadline || epoch.pending !== pending) refuse("stale");
        if (proof.status !== "passed") refuse("terminal-result");
        if (stateKeys(proof.before).exact !== epoch.exact || stateKeys(proof.after).exact !== epoch.exact) refuse("state-changed");
        const added = receipts(proof.receiptIds);
        if (!added.length || added.some((id) => epoch.receiptIds.includes(id))) refuse("invalid-proof");
        epoch.receiptIds = receipts([...epoch.receiptIds, ...added]);
        epoch.pending = undefined;
        return issue(epoch, "verified", proof.completedAt);
      } catch (error) {
        // Failed/uncertain results cannot release admission/quarantine. Retain
        // the launch for independent recovery reconciliation, never auto retry.
        epoch.recoveryRequired = true;
        retire(epoch);
        throw error;
      }
    },
    publishReconciliationResult(handle: object): GitPreparationRevisionResult {
      const current = time(); prune(current); authenticate(handle);
      const proof = readReconciliation(handle);
      if (!proof || proof.context !== context) refuse("unissued-result");
      usedResults.add(handle);
      fresh(proof.completedAt, current);
      if (!Number.isFinite(proof.startedAt) || proof.startedAt < 0 || proof.startedAt > proof.completedAt) refuse("invalid-proof");
      if (proof.status !== "completed" || !["revalidated", "recovered", "not-launched", "definite-no-effect"].includes(proof.disposition)) refuse("terminal-result");
      const from = stateKeys(proof.before), to = stateKeys(proof.after);
      if (from.exact !== to.exact) refuse("state-changed");
      const scope = scopeFor(to.scope), previous = scope.current;
      if (proof.previousLaunch !== undefined && previous?.pending?.launch !== proof.previousLaunch) refuse("unissued-result");
      if (previous?.pending) {
        if (proof.previousLaunch !== previous.pending.launch || proof.startedAt < previous.pending.startedAt) refuse("invalid-proof");
        if (proof.disposition === "revalidated" || previous.recoveryRequired && proof.disposition !== "recovered") refuse("terminal-result");
      } else if (proof.disposition === "not-launched" || proof.disposition === "definite-no-effect") {
        // These outcomes must refer to this controller's exact consumed launch.
        refuse("invalid-proof");
      }
      if (scope.reconciliations >= MAX_RECONCILIATIONS) refuse("capacity");
      scope.reconciliations++;
      if (previous?.pending) launches.delete(previous.pending.launch);
      return issue(start(to, scope), "reconciled", proof.completedAt);
    },
    /** Teardown invalidates generation/ordering. It never clears native admission. */
    dispose() { scopes.clear(); tokens.clear(); disposed = true; },
  });
  const gate = Object.freeze({
    consume(request: GitPreparationReentryRequest): GitPreparationReentryLaunch {
      const current = time(); prune(current);
      if (!request || request.revisionDependency === undefined || request.revisionDependency === null || request.revisionDependency === "") refuse("dependency-required");
      if (typeof request.revisionDependency !== "string") refuse("invalid-dependency");
      const epoch = tokens.get(request.revisionDependency);
      if (!epoch) refuse("invalid-dependency");
      tokens.delete(request.revisionDependency); epoch.dependency = undefined;
      try {
        live(epoch);
        if (stateKeys(request.state).exact !== epoch.exact) refuse("state-changed");
        if (JSON.stringify(receipts(request.receiptIds)) !== JSON.stringify(epoch.receiptIds)) refuse("receipts-changed");
        if (request.stage !== "verify" && request.stage !== "integrate") refuse("invalid-proof");
        const launch = Object.freeze(Object.create(null)) as GitPreparationReentryLaunch;
        if (request.stage === "verify") {
          const scope = scopes.get(epoch.scope)!;
          if (scope.checks >= MAX_CHECKS) refuse("capacity");
          scope.checks++;
        }
        const pending = { epoch, launch, stage: request.stage, startedAt: current, deadline: current + pendingLifetime };
        epoch.pending = pending;
        epoch.expiresAt = undefined;
        launches.set(launch, pending);
        return launch;
      } catch (error) { retire(epoch); throw error; }
    },
  });
  return Object.freeze({ issuer, gate });
}
