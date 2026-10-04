// Internal native linear preparation. Original invocation authority is never reconstructed from history.
import { createHash } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { planGitPreparationCandidate, type GitPreparationCandidate } from "./git-preparation-candidate";
import { preflightGitPreparation, revalidateGitPreparationInventory, sameGitPreparationDependencies, assertGitPreparationSharingSync,
  type GitPreparationRequest, type GitPreparationSnapshot, type GitPreparationTrackedContents } from "./git-preparation";
import { selectCanonicalGitResources, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { loadGitProjectSettings } from "./git-project-settings";
import { gitWorkflowPolicyRevision } from "./git-scoped-authority";
import { captureGitMutationAuthority, type GitMutationInvocation, type GitMutationInvocationAuthority } from "./git-mutation-invocation";
import { captureNativeCheckoutTransaction, applyNativeCheckoutTransaction, applyNativeCheckoutTransactionForTest,
  readNativeCheckoutCompletion, getNativeCheckoutOutcome, type NativeCheckoutCandidate, type NativeCheckoutOutcome } from "./git-native-checkout-transaction";

const digest = (data: string) => createHash("sha256").update(data).digest("hex");
function refuse(): never { throw new Error("Preparation apply refused: original authority or exact safe candidate unavailable; request a fresh candidate"); }
export type GitPreparationApplyResult =
  | { status: "already-prepared"; oldSourceOid: string; newSourceOid: string; targetOid: string }
  | { status: "prepared"; oldSourceOid: string; newSourceOid: string; targetOid: string; treeOid: string; recoveryPath: string }
  | { status: "partial-state"; oldSourceOid: string; observedSourceOid: string | null; targetOid: string; recoveryPath: string;
      recoveryRequired: true; newSourceOid?: string; treeOid?: string };
type PreparedResult = Extract<GitPreparationApplyResult, { status: "prepared" }>;
declare const completionBrand: unique symbol;
export interface GitPreparationVerifiedCompletion { readonly [completionBrand]: true }
export interface GitPreparationCompletionEvidence {
  readonly stage: "completed";
  readonly actionId?: string;
  readonly invocationOwner: GitMutationInvocationAuthority["owner"];
  readonly result: Readonly<PreparedResult>;
  readonly proof: { readonly version: 1; readonly outcome: "completed"; readonly beforeOid: string; readonly afterOid: string; readonly resultTreeOid: string };
  readonly source: GitProjectResources; readonly target: GitProjectResources; readonly settingsRevision: string;
  readonly sourceTrackedContents: Readonly<GitPreparationTrackedContents>;
  readonly targetTrackedContents: Readonly<GitPreparationTrackedContents>;
  readonly nativeOutcome: NativeCheckoutOutcome;
}
type Completion = { evidence: GitPreparationCompletionEvidence; native: object; invocation: GitMutationInvocation;
  diagnostics: "not-requested" | "recorded" | "unavailable" };
const completions = new WeakMap<object, Completion>();
const preApplyFailures = new WeakMap<object, NativeCheckoutOutcome>();
const noNativeCheckoutEffect: NativeCheckoutOutcome = Object.freeze({ status: "no-checkout-effect", checkoutAttempted: false,
  refPrepared: false, refCommitSent: false, refAcknowledged: false, indexInstalled: false, indexSynced: false,
  directorySyncFailed: false, childReaped: true });
function recordPreApplyFailure(error: unknown): void {
  // Facts about THIS apply boundary only, not a claim that prior read/object
  // preparation wrote nothing. Existing native facts can never be overwritten.
  if (error && typeof error === "object" && !getNativeCheckoutOutcome(error) && !completions.has(error) && !preApplyFailures.has(error)) {
    preApplyFailures.set(error, noNativeCheckoutEffect);
  }
}
/** Historical measured completion tied to SAME invocation and original shared native
 * handle. Copies/history/restart never mint authority. Retirement does not erase facts. */
export function readGitPreparationCompletion(value: object): GitPreparationCompletionEvidence | undefined {
  const saved = value && completions.get(value);
  return saved && readNativeCheckoutCompletion(saved.native) ? structuredClone(saved.evidence) : undefined;
}
export function readGitPreparationDiagnosticStatus(value: object): Completion["diagnostics"] | undefined { return completions.get(value)?.diagnostics; }
export function readGitPreparationNativeOutcome(value: unknown): NativeCheckoutOutcome | undefined {
  if (!value || typeof value !== "object") return;
  const completion = completions.get(value);
  return completion?.evidence.nativeOutcome ?? getNativeCheckoutOutcome(value) ?? preApplyFailures.get(value);
}
export interface GitPreparedApply { readonly snapshot: GitPreparationSnapshot; readonly candidate: GitPreparationCandidate }
type Saved = { snapshot: GitPreparationSnapshot; candidate: GitPreparationCandidate; source: GitProjectResources;
  target: GitProjectResources; settingsRevision: string; agentDir: string; issuedAt: number; invocation: GitMutationInvocation;
  native?: NativeCheckoutCandidate };
const issued = new WeakMap<GitPreparedApply, Saved>();
const originalPrepared = new WeakSet<object>();
/** Idempotent unused-capability retirement. Copies/IDs are inert; completed
 * native facts remain readable. Already consumed originals have no live slot. */
export function retireGitPreparedApply(value: unknown): boolean {
  if (!value || typeof value !== "object" || !originalPrepared.has(value)) return false;
  const saved = issued.get(value as GitPreparedApply);
  if (saved) { issued.delete(value as GitPreparedApply); saved.invocation.retire(); }
  return true;
}
const selector = (r: GitPreparationSnapshot["source"]) => ({ repositoryPath: r.projectRoot, checkoutPath: r.cwd, workspaceBranch: r.branch });
function assertDesignatedMain(s: GitPreparationSnapshot): void {
  if (s.dependencyVersion !== 2 || s.source.branch === s.target.branch || s.source.ref === s.designatedMain.ref ||
      s.target.ref !== s.designatedMain.ref || s.target.oid !== s.designatedMain.oid) refuse();
}
async function assertMainSettings(saved: Pick<Saved, "source" | "agentDir" | "snapshot" | "settingsRevision">): Promise<void> {
  const settings = await loadGitProjectSettings(saved.source, [], saved.agentDir);
  if (gitWorkflowPolicyRevision(settings) !== saved.settingsRevision || settings.project.mainBranch !== saved.snapshot.target.branch) refuse();
  assertDesignatedMain(saved.snapshot);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value;
}
/** nativeAuthority comes only from the trusted owner, captured BEFORE all reads/waits.
 * Legacy callers without real session/file/generation and live guards fail closed. */
export async function prepareGitPreparationApply(request: GitPreparationRequest, agentDir = getAgentDir(),
  nativeAuthority?: GitMutationInvocationAuthority): Promise<GitPreparedApply> {
  const authority = captureGitMutationAuthority(nativeAuthority);
  const source = await selectCanonicalGitResources(request.source), target = await selectCanonicalGitResources(request.target);
  const settings = await loadGitProjectSettings(source, [], agentDir), snapshot = await preflightGitPreparation(request, agentDir);
  const candidate = await planGitPreparationCandidate(snapshot, agentDir); // materializes and independently verifies trees/parents/metadata/signature constraints
  const settingsRevision = gitWorkflowPolicyRevision(settings);
  const partial = { source, target, snapshot, candidate, settingsRevision, agentDir, issuedAt: Date.now() };
  await assertMainSettings(partial);
  await revalidateGitProjectResources(source); await revalidateGitProjectResources(target);
  authority.assertOriginalSync();
  const invocation = authority.bind({ kind: "prepare", source, target, candidateSha256: digest(JSON.stringify({
    snapshot: preparationBindingSnapshot(snapshot), candidate, settingsRevision })) });
  const guard = () => {
    invocation.assertCurrentSync();
    if (Date.now() - partial.issuedAt >= 5 * 60_000) refuse();
    assertDesignatedMain(snapshot);
    assertGitPreparationSharingSync(source, target, snapshot);
    invocation.assertCurrentSync(); // slow bounded sharing reads cannot swallow a revocation
  };
  try {
    await revalidateGitPreparationInventory(source, target, snapshot);
    let native: NativeCheckoutCandidate | undefined;
    if (candidate.status === "candidate") {
      const tree = candidate.comparison.commits.at(-1)?.newTreeOid;
      if (!tree || candidate.oldSourceOid !== snapshot.source.oid || candidate.targetOid !== snapshot.target.oid ||
          candidate.newSourceOid === snapshot.source.oid || candidate.comparison.commits.length !== snapshot.rewriteSeries.length) refuse();
      // REVERSED roles: the base/target is verified, the source feature checkout is rewritten.
      native = await captureNativeCheckoutTransaction({
        source: { resources: target, expectedOid: snapshot.target.oid, treeOid: snapshot.target.trackedContents.treeOid, indexDigest: snapshot.target.indexDigest },
        target: { resources: source, expectedOid: snapshot.source.oid, treeOid: snapshot.source.trackedContents.treeOid, indexDigest: snapshot.source.indexDigest },
        resultOid: candidate.newSourceOid, resultTreeOid: tree, assertAuthoritySync: guard });
    } else if (snapshot.status !== "already-prepared" || candidate.newSourceOid !== snapshot.source.oid) refuse();
    guard();
    const handle = freeze({ snapshot: structuredClone(snapshot), candidate: structuredClone(candidate) });
    issued.set(handle, { ...partial, invocation, native }); originalPrepared.add(handle); return handle;
  } catch (e) { invocation.retire(); throw e; }
}
/** The binding includes exact selected dependencies, not diagnostic all-ref history. */
function preparationBindingSnapshot(s: GitPreparationSnapshot) {
  return { dependencyVersion: s.dependencyVersion, status: s.status, source: s.source, target: s.target,
    designatedMain: s.designatedMain, mergeBaseOid: s.mergeBaseOid, rewriteSeries: s.rewriteSeries,
    registeredWorktrees: s.registeredWorktrees.filter((r) => r.cwd === s.source.cwd || r.cwd === s.target.cwd), publication: s.publication };
}
export interface GitPreparationApplyOptions {
  prepared: GitPreparedApply;
  /** Optional diagnostic ID only; never ownership, authorization or an anti-replay ledger key. */
  actionId?: string;
  /** Legacy supervised admission callback is deliberately unsupported. */
  onIntent?: unknown;
  /** Additional async actor checks; ORIGINAL prepare-time sync guard remains mandatory at effects. */
  authorize: (phase: "before-apply" | "final-effect" | "final-ref") => Promise<void>;
  /** Optional DIAGNOSTIC publication after acknowledged ref/index installation.
   * Throwing only marks diagnostics unavailable; cannot undo known native execution. */
  onCompleted?: (completion: GitPreparationVerifiedCompletion) => void | Promise<void>;
  /** Explicit node:test seams, never accepted from production payloads. */
  afterIntent?: () => void | Promise<void>;
  afterCheckout?: () => void | Promise<void>;
  afterRef?: () => void | Promise<void>;
  afterIndexInstall?: () => void | Promise<void>;
}
export async function applyGitPreparation(options: GitPreparationApplyOptions): Promise<GitPreparationApplyResult> {
  let invocation: GitMutationInvocation | undefined;
  let nativeApplyEntered = false;
  try {
    if (!options || typeof options.authorize !== "function" || options.onIntent !== undefined ||
        (options.afterIntent || options.afterCheckout || options.afterRef || options.afterIndexInstall) && !process.env.NODE_TEST_CONTEXT) refuse();
    const saved = issued.get(options.prepared); if (!saved) refuse();
    issued.delete(options.prepared);
    const { source, target, snapshot, candidate } = saved;
    invocation = saved.invocation;
    invocation.assertCurrentSync();
    if (Date.now() - saved.issuedAt >= 5 * 60_000) refuse();
    await options.authorize("before-apply");
    const fresh = () => preflightGitPreparation({ source: selector(snapshot.source), target: selector(snapshot.target) }, saved.agentDir);
    if (!sameGitPreparationDependencies(snapshot, await fresh())) refuse();
    await assertMainSettings(saved);
    if (JSON.stringify(await planGitPreparationCandidate(snapshot, saved.agentDir)) !== JSON.stringify(candidate)) refuse();
    await options.authorize("final-effect"); await options.authorize("final-ref");
    await assertMainSettings(saved);
    if (!sameGitPreparationDependencies(snapshot, await fresh())) refuse();
    await revalidateGitPreparationInventory(source, target, snapshot);
    invocation.assertCurrentSync();
    if (snapshot.status === "already-prepared") {
      if (candidate.status !== "already-prepared" || candidate.newSourceOid !== snapshot.source.oid) refuse();
      // No native effect and no native completion or reentry successor for a no-op.
      return { status: "already-prepared", oldSourceOid: snapshot.source.oid, newSourceOid: snapshot.source.oid, targetOid: snapshot.target.oid };
    }
    if (!saved.native) refuse();
    invocation.consumeSync();
    nativeApplyEntered = true; // helper measurements alone classify every failure after entry
    const native = options.afterIntent || options.afterCheckout || options.afterRef || options.afterIndexInstall
      ? await applyNativeCheckoutTransactionForTest(saved.native, { afterLocks: options.afterIntent,
        afterCheckout: options.afterCheckout, afterRef: options.afterRef, afterIndexInstall: options.afterIndexInstall })
      : await applyNativeCheckoutTransaction(saved.native);
    const evidence = readNativeCheckoutCompletion(native);
    if (!evidence || evidence.resultOid !== candidate.newSourceOid || evidence.resultTreeOid !== candidate.comparison.commits.at(-1)?.newTreeOid ||
        JSON.stringify(evidence.source.resources) !== JSON.stringify(target) || JSON.stringify(evidence.target.resources) !== JSON.stringify(source)) refuse();
    // Historical shared native verification under its protections; never re-read a newer checkout to revoke it.
    const result = freeze({ status: "prepared" as const, oldSourceOid: snapshot.source.oid, newSourceOid: candidate.newSourceOid,
      targetOid: snapshot.target.oid, treeOid: evidence.resultTreeOid, recoveryPath: "" });
    const completion = Object.freeze(Object.create(null)) as GitPreparationVerifiedCompletion;
    const record: Completion = { native, invocation, diagnostics: "not-requested", evidence: freeze({ stage: "completed" as const,
      ...(options.actionId ? { actionId: options.actionId } : {}), invocationOwner: structuredClone(invocation.binding.owner), result,
      proof: { version: 1 as const, outcome: "completed" as const, beforeOid: snapshot.source.oid, afterOid: candidate.newSourceOid, resultTreeOid: evidence.resultTreeOid },
      source: structuredClone(source), target: structuredClone(target), settingsRevision: saved.settingsRevision,
      sourceTrackedContents: evidence.targetContents, targetTrackedContents: evidence.sourceContents, nativeOutcome: evidence.outcome }) };
    completions.set(completion, record); completions.set(result, record);
    // Separate optional diagnostic channel. No guard/application errors enter this catch.
    if (options.onCompleted) {
      try { await options.onCompleted(completion); record.diagnostics = "recorded"; }
      catch { record.diagnostics = "unavailable"; }
    }
    return result;
  } catch (error) {
    if (!nativeApplyEntered) recordPreApplyFailure(error);
    throw error;
  } finally { invocation?.retire(); }
}
/** Compatibility wrapper: extra assertion is NOT a replacement authority source.
 * Real nativeAuthority must already have been captured by prepare. */
export async function applyGitPreparationWithAuthority(options: GitPreparationApplyOptions & { assertCurrentSync(): void }): Promise<GitPreparationApplyResult> {
  try {
    const value: unknown = options.assertCurrentSync();
    if (value !== undefined) {
      if (value && typeof (value as PromiseLike<unknown>).then === "function") void Promise.resolve(value).catch(() => {});
      refuse();
    }
  } catch (error) { recordPreApplyFailure(error); throw error; }
  return applyGitPreparation(options);
}
