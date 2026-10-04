// Internal server adapter only. No routes, tools, approval UI, remote delivery or cleanup.
import type { GitProjectResources } from "./git-project-resources";
import type { GitWorkflowSettings, GitWorkflowOverrides } from "./git-workflow-settings";
import type { GitCheckoutVerificationCandidate } from "./git-checkout-verification";
import type { GitMutationInvocationAuthority } from "./git-mutation-invocation";
import type { NativeCheckoutOutcome } from "./git-native-checkout-transaction";
import { prepareSelectedIntegrationNative, confirmSelectedIntegrationNative, readSelectedIntegrationNativeCompletion,
  readSelectedIntegrationNativeTargetMove as readNativeTargetMove,
  retireSelectedIntegrationPlan as retireNativePlan,
  type LocalIntegrationPlan, type LocalIntegrationResult } from "./git-integration";

export interface SelectedIntegrationPolicy {
  policyRevision: string;
  /** Live resolved selected settings, including caller/project restrictions. */
  settings: GitWorkflowSettings;
  /** Independently read SAVED Project fields. Never a task or editor draft. */
  savedProjectSettings: GitWorkflowOverrides;
}
export interface SelectedIntegrationOptions {
  sessionId: string; agentDir: string;
  /** Original trusted caller owner/guards captured before ANY wait; never request data. */
  nativeAuthority?: GitMutationInvocationAuthority;
  /** Canonical server-owned resources. Selection is not authorization or trust. */
  source: GitProjectResources; target: GitProjectResources;
  receiptIds: readonly string[];
  getPolicy: (source: Readonly<GitProjectResources>) => SelectedIntegrationPolicy | Promise<SelectedIntegrationPolicy>;
  isTrusted: (projectRoot: string) => boolean | Promise<boolean>;
  isSelectionAuthorized: (selection: Readonly<GitProjectResources>) => boolean | Promise<boolean>;
  isCheckAuthorized: (candidate: GitCheckoutVerificationCandidate) => boolean | Promise<boolean>;
  /** REQUIRED trusted synchronous live source revision, covering caller/grants,
   * policy, trust and selected access. Every mutation, including change-and-restore,
   * must change it. Never a request value, capture-time/static stamp or thenable.
   * Unknown/unavailable state must throw. Shared with real receipt validation. */
  readAuthorityRevisionSync: () => string;
  /** Live noninteractive authorization; exact approval is retained outside native gates.
   * EVERY phase must return a synchronous assertion bound to the exact candidate
   * and a captured version of a TRUSTED LIVE authority source (caller, grants,
   * policy, trust and selected access). It must synchronously reread that source
   * and actual owner generation, throwing on unknown state/revocation/change.
   * No void fallback, constant stamp, capture-time Allow or async validator.
   * The prepare assertion is retained with the saved plan; it and the effect
   * assertion run after async validation AND at the actual Git launch boundary. */
  authorize: (phase: "prepare" | "before-checkout" | "before-ref-cas", candidate: Readonly<SelectedIntegrationAuthorizationCandidate>) =>
    SelectedIntegrationAuthorizationPostguard | Promise<SelectedIntegrationAuthorizationPostguard>;
  /** Direct node:test seam only; never expose to controllers' untrusted inputs. */
  afterCheckout?: () => void | Promise<void>;
  afterRefUpdate?: () => void | Promise<void>;
}
/** A server-owned live-source version assertion, NOT a serialized token.
 * Synchronous only; unknown state, returned values/thenables and failures deny. */
export type SelectedIntegrationAuthorizationPostguard = () => void;
export interface SelectedIntegrationPlanContext {
  kind: "selected-local"; version: 1;
  source: GitProjectResources; target: GitProjectResources;
  policyRevision: string; policyDigest: string; savedProjectDigest: string;
  method: "ff" | "merge"; targetRef: string; sourceRef: string;
  checkStatus: "no-defined" | "no-required" | "required";
  checkIndexes: readonly number[]; receiptIds: readonly string[];
  repositoryChecksWaived: false;
}
export type SelectedIntegrationPlan = LocalIntegrationPlan & { selectedContext: SelectedIntegrationPlanContext };
/** Exact process-owned candidate given to live controller authorization, not an approval token. */
export interface SelectedIntegrationAuthorizationCandidate {
  context: SelectedIntegrationPlanContext; planId: string; expiresAt: number;
  sourceOid: string; targetOid: string; treeOid: string; resultOid: string; parents: string[];
}
/** Historical native evidence tied to the original invocation, not current-state
 * or cleanup authorization. Optional journal publication is not a completion barrier. */
export interface SelectedIntegrationNativeCompletion {
  completedAt: number; delivery: "selected-local"; method: "ff" | "merge"; actualFF: boolean;
  feature: GitProjectResources; target: GitProjectResources;
  featureOid: string; previousTargetOid: string; resultOid: string; resultTree: string; parents: string[];
  targetIndexDigest: string; sourceIndexDigest: string; planId: string;
  invocationOwner: GitMutationInvocationAuthority["owner"];
  selectedContext: SelectedIntegrationPlanContext;
}
/** Original-error-only pre-checkout diagnostic. Copies, public constructors and
 * history cannot mint it. No apply/retry, settlement or cleanup authority. */
export interface SelectedIntegrationNativeTargetMove {
  kind: "selected-integration-target-moved"; code: "target_moved";
  planId: string; sessionId: string; context: SelectedIntegrationPlanContext;
  featureOid: string; previousTargetOid: string; observedTargetOid: string;
  otherStateBefore: string; otherStateAfter: string; noEffect: true;
}
/** Measured native checkpoints, never replay or independent cleanup permission. */
export interface SelectedIntegrationNativeOutcome {
  checkoutAttempted: boolean; refUpdateCompleted: boolean; indexInstalled: boolean; completionVerified: boolean;
  native?: NativeCheckoutOutcome;
}
export type SelectedIntegrationResult = { result: LocalIntegrationResult; nativeOutcome: SelectedIntegrationNativeOutcome; nativeHandle?: object };

export async function prepareSelectedIntegration(options: SelectedIntegrationOptions): Promise<SelectedIntegrationPlan> {
  return prepareSelectedIntegrationNative(options);
}
/** Exact approval plus the ORIGINAL nativeAuthority retained by prepare. No
 * reservation callback, implicit retry, target rebaseline or diagnostic barrier.
 * Omitted nativeAuthority / supplied legacy callback fail closed. */
export async function confirmSelectedIntegration(planId: string, approvePlanId: string, sessionId: string,
  legacyIntent?: unknown): Promise<SelectedIntegrationResult> {
  return confirmSelectedIntegrationNative(planId, approvePlanId, sessionId, legacyIntent);
}
/** Identity lookup only: parsed history, a copied handle or an integrated result cannot mint proof.
 * Cleanup still needs independent exact current resources and its own invocation authority. */
export function readSelectedIntegrationNativeProof(handle: object): SelectedIntegrationNativeCompletion | undefined {
  return readSelectedIntegrationNativeCompletion(handle);
}
/** Idempotently retire an UNUSED original returned plan. Copies/IDs return false;
 * consumed native facts remain readable. Safe for a caller's finally after denial. */
export function retireSelectedIntegrationPlan(originalPlan: unknown): boolean { return retireNativePlan(originalPlan); }
/** Only the original native-issued failure object is readable. */
export function readSelectedIntegrationNativeTargetMove(value: unknown): SelectedIntegrationNativeTargetMove | undefined {
  return readNativeTargetMove(value);
}
