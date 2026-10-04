import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { ProjectAuthorizationOwner, ProjectAuthorizationStatus } from "./git-project-authorization";
import type { GitProjectResources, GitResourceSelector } from "./git-project-resources";
import { hasManagedGitMutationTools, type GitWorkflowSessionFacts } from "./git-workflow-permissions";
import type { GitWorkflowSettingsResponse } from "./git-workflow-settings";
import { validLocalBranchName } from "./git-workflow-policy";
import { samePath } from "./paths";

/** Foundation only: these actions have no new route/tool/native dispatcher here.
 * Commit intentionally remains on its existing authorization path. */
export const SELECTED_OPERATION_ACTIONS = ["workspace", "checks", "prepare", "integration", "cleanup"] as const;
export type SelectedOperationAction = typeof SELECTED_OPERATION_ACTIONS[number];
export interface SelectedOperationRequest {
  action: SelectedOperationAction;
  owner: ProjectAuthorizationOwner;
  selector: GitResourceSelector;
  confirmation?: "ask" | "none";
  /** Process-owned live request identity, NOT a historical action ID. */
  requestId: string;
  /** Outer controller's exact request/candidate revision, including operation
   * inputs (checks, refs, paths etc.). This helper never constructs a candidate. */
  requestRevision: string;
}
/** Identity scope only, not a selected native source. A verified detached
 * caller may have branch:null; selected native resources still require a real
 * registered local branch. Never invent a branch to satisfy a caller gate. */
export type SelectedOperationGitIdentity = Omit<GitProjectResources, "branch"> & { branch: string | null };
export interface SelectedOperationNonGitIdentity {
  kind: "non-git";
  cwd: string;
  identity: GitProjectResources["identities"]["checkout"];
  /** Trusted reader must positively inspect physical cwd AND ancestors, with
   * stable directory instances and no symlink/unknown/unreadable Git markers
   * or ambiguous/bare repository. ENOENT for a marker is not a failed Git probe.
   * Bind the complete absence/ancestry proof into revision and recheck it live.
   * Never return this variant by catching arbitrary Git discovery failure. */
  noRepository: { verified: true; revision: string };
}
export type SelectedOperationCurrent = { kind: "git"; resources: SelectedOperationGitIdentity } | SelectedOperationNonGitIdentity;
/** Unqualified chat restrictions only. No non-Git Project settings, recipes,
 * branches, task consent or grants may substitute selected operation policy. */
export type SelectedOperationChatPolicy = Pick<GitWorkflowSettingsResponse,
  "revision" | "paused" | "optedOut" | "global" | "session" | "resolved" | "task">;
interface SelectedOperationCallerBase {
  /** Validate physical saved header/file instance against owner on every read,
   * including non-Git callers; revision binds that instance and own chat state.
   * Actual live tools win over independently saved tools; unknown fails closed. */
  persisted: boolean;
  revision: string;
  facts: GitWorkflowSessionFacts;
}
export type SelectedOperationCaller = SelectedOperationCallerBase & (
  { current: { kind: "git"; resources: SelectedOperationGitIdentity }; policy: GitWorkflowSettingsResponse }
  | { current: SelectedOperationNonGitIdentity; policy: SelectedOperationChatPolicy }
);
export interface SelectedOperationReaders {
  /** All callbacks are trusted server adapters, never model/request payloads.
   * Every invocation must read live state; cached capture-time answers are invalid.
   * Exceptions fail closed. Native resource/policy/authorization readers can be
   * used directly, with the same independently validated owner on every read. */
  readResources: (selector: GitResourceSelector) => Promise<GitProjectResources>;
  readCaller: (owner: ProjectAuthorizationOwner) => Promise<SelectedOperationCaller>;
  readPolicy: (resources: GitProjectResources, owner: ProjectAuthorizationOwner) => Promise<GitWorkflowSettingsResponse>;
  readAuthorization: (resources: GitProjectResources, owner: ProjectAuthorizationOwner) => Promise<ProjectAuthorizationStatus>;
  revalidateResources: (resources: GitProjectResources) => Promise<void>;
  /** Canonical Git CURRENT identity scope, not a selected native source.
   * Must independently read project/keyed restrictions and current action Deny
   * without requiring/inventing an attached branch. Not called for non-Git. */
  readCurrentPolicy: (resources: SelectedOperationGitIdentity, owner: ProjectAuthorizationOwner) => Promise<GitWorkflowSettingsResponse>;
  readCurrentAuthorization: (resources: SelectedOperationGitIdentity, owner: ProjectAuthorizationOwner) => Promise<ProjectAuthorizationStatus>;
  /** Revalidate physical current/header classification, including absence proof
   * for non-Git. Missing/changed/ambiguous identity fails closed. */
  revalidateCurrent: (current: SelectedOperationCurrent, owner: ProjectAuthorizationOwner) => Promise<void>;
  /** Trusted clock, optional only for deterministic tests. */
  now?: () => number;
}
export interface SelectedOperationEvidence {
  version: 1;
  approvalToken: false;
  kind: "exact-approval-required" | "saved-allow";
  action: SelectedOperationAction;
  requestId: string;
  requestRevision: string;
  /** Binds exact request, physical resources, caller facts/state and both live
   * authorization/policy revisions. Not secret, signed, or execution authority. */
  revision: string;
  capturedAt: number;
  expiresAt: number;
}
export type SelectedOperationEvaluation = { kind: "evidence"; evidence: SelectedOperationEvidence }
  | { kind: "blocked"; code: string; reason: string };
const LIFETIME_MS = 30_000;
const confirmationField = {
  workspace: "workspaceConfirmation", checks: "checkConfirmation", prepare: "prepareConfirmation",
  integration: "integrateConfirmation", cleanup: "cleanupConfirmation",
} as const;
const blocked = (code: string, reason: string): SelectedOperationEvaluation => ({ kind: "blocked", code, reason });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;

function gitCaller(caller: SelectedOperationCaller): caller is SelectedOperationCallerBase & {
  current: { kind: "git"; resources: SelectedOperationGitIdentity }; policy: GitWorkflowSettingsResponse;
} {
  return caller.current?.kind === "git";
}
function nonGitIdentityMatches(current: SelectedOperationNonGitIdentity, owner: ProjectAuthorizationOwner): boolean {
  return current?.kind === "non-git" && typeof current.cwd === "string" && isAbsolute(current.cwd)
    && samePath(current.cwd, owner.sessionCwd) && current.noRepository?.verified === true
    && nonempty(current.noRepository.revision) && !!current.identity
    && [current.identity.device, current.identity.inode, current.identity.birthtime]
      .every((value) => typeof value === "string" && /^[0-9]{1,30}$/.test(value));
}
function policyMatches(policy: GitWorkflowSettingsResponse, resources: SelectedOperationGitIdentity): boolean {
  return nonempty(policy.revision) && samePath(policy.projectRoot ?? "", resources.projectRoot)
    && samePath(policy.cwd ?? "", resources.cwd);
}
function chatPolicyBlock(state: SelectedOperationChatPolicy, action: SelectedOperationAction): SelectedOperationEvaluation | undefined {
  if (!nonempty(state.revision)) return blocked("caller-policy-mismatch", "Live own chat restrictions are unavailable.");
  if (state.optedOut) return blocked("opted-out", "The calling chat has opted out of managed Git.");
  if (state.paused) return blocked("paused", "Managed Git is paused.");
  if (state.global.enabled === false || state.session?.enabled === false || !state.resolved.session.values.enabled
    || state.task.kind === "managed" && !state.task.settings.enabled) {
    return blocked("disabled", "The current caller, captured task or selected project disables managed Git.");
  }
  if (state.session?.[confirmationField[action]] === "disabled") return blocked("confirmation-disabled", "This operation is disabled by live chat policy.");
  if ((action === "integration" || action === "cleanup") && (state.session?.delivery === "pr" || state.session?.delivery === "leave")) {
    return blocked("delivery-not-local", "Explicit chat restrictions forbid local delivery.");
  }
}
function policyBlock(state: GitWorkflowSettingsResponse, action: SelectedOperationAction, selected: boolean): SelectedOperationEvaluation | undefined {
  const chatRestriction = chatPolicyBlock(state, action);
  if (chatRestriction) return chatRestriction;
  if (state.project.enabled === false || state.projectSessionRestrictions?.enabled === false) {
    return blocked("disabled", "The current canonical Project/chat or selected Project disables managed Git.");
  }
  const field = confirmationField[action];
  // Selected effective Disabled always refuses. The caller's explicit scoped
  // Disabled is a clamp too, but its builtin defaults are not selected policy
  // (notably prepare/cleanup default Disabled must not retarget Project B).
  if (selected ? state.resolved.session.values[field] === "disabled"
    : state.project[field] === "disabled" || state.session?.[field] === "disabled") {
    return blocked("confirmation-disabled", "This operation is disabled by live policy.");
  }
  if (action === "integration" || action === "cleanup") {
    // A's Project delivery is not B's policy. The aggregate legacy
    // projectSessionRestrictions.delivery can originate from A's Project too,
    // so use explicit chat overrides here. The independently read currentPolicy
    // supplies canonical Chat×Project negatives; caller.policy supplies legacy
    // unqualified negatives. Neither may be bypassed by selecting B.
    const nonlocal = selected
      ? state.resolved.project.values.delivery !== "local" || state.resolved.session.values.delivery !== "local"
        || !!state.projectSessionRestrictions?.delivery
      : state.session?.delivery === "pr" || state.session?.delivery === "leave";
    if (nonlocal) return blocked("delivery-not-local", "Integration and integration-dependent cleanup require local delivery.");
  }
  if (selected && action === "cleanup" && (state.resolved.session.values.cleanup !== "worktree-and-branch"
    || !["global", "project", "session"].includes(state.resolved.session.origins.cleanup))) {
    return blocked("cleanup-mode-required", "Cleanup requires an explicit saved worktree-and-branch mode; retain refuses even Ask or Allow.");
  }
  // Captured task target/base/checks (or legacy task consent) are never selected
  // operation authority. In particular checks/direct-main need no fake target.
}

/** Reusable live capture. Evidence is NOT approval, admission, a receipt, a
 * candidate or a capability. Ask (including default Ask) always needs exact,
 * request-specific human approval OUTSIDE this helper, even with saved Allow.
 * Cleanup receipt/native eligibility and all recovery/checkout/ref/check gates
 * remain the outer controller's responsibility. Selected cleanup:retain refuses
 * execution; eligible cleanup still never performs or schedules deletion here. */
export async function captureSelectedOperationAuthorization(
  request: SelectedOperationRequest, readers: SelectedOperationReaders,
): Promise<SelectedOperationEvaluation> {
  if (!SELECTED_OPERATION_ACTIONS.includes(request.action) || !nonempty(request.requestId) || !nonempty(request.requestRevision)
    || !request.owner || !nonempty(request.owner.sessionId) || !nonempty(request.owner.sessionFile) || !nonempty(request.owner.sessionCwd)
    || !request.selector || !nonempty(request.selector.repositoryPath) || !nonempty(request.selector.checkoutPath)
    || request.confirmation !== undefined && request.confirmation !== "ask" && request.confirmation !== "none") {
    return blocked("invalid-request", "Select a live exact request and persisted ordinary caller.");
  }
  // Detach inputs before awaits; later caller-side mutation cannot retarget a read.
  const input = structuredClone(request);
  try {
    const selected = structuredClone(await readers.readResources(input.selector));
    if (!samePath(selected.projectRoot, input.selector.repositoryPath) || !samePath(selected.cwd, input.selector.checkoutPath)
      || input.selector.workspaceBranch !== undefined && selected.branch !== input.selector.workspaceBranch) {
      return blocked("resource-mismatch", "Selected canonical physical resources do not match the request.");
    }
    const caller = structuredClone(await readers.readCaller(input.owner));
    if (caller.persisted !== true || caller.facts.subagent !== false || !nonempty(caller.revision)) {
      return blocked("ordinary-caller-required", "A verified persisted ordinary chat is required.");
    }
    if (!caller.facts.tools || !hasManagedGitMutationTools(caller.facts.tools)) {
      return blocked("coding-tools-required", "Known active coding tools are required; read-only/Chat-only callers are ineligible.");
    }
    // A need not be a repository, belong to B or move to B. Positive non-Git
    // evidence is distinct from unknown/broken Git. Current Git is identity
    // scope only (possibly detached), never the selected native source.
    let currentPolicy: GitWorkflowSettingsResponse | undefined;
    let callerRestriction: SelectedOperationEvaluation | undefined;
    if (gitCaller(caller)) {
      if (!policyMatches(caller.policy, caller.current.resources)) {
        return blocked("caller-policy-mismatch", "Canonical-current caller policy is unavailable.");
      }
      currentPolicy = structuredClone(await readers.readCurrentPolicy(caller.current.resources, input.owner));
      if (!policyMatches(currentPolicy, caller.current.resources) || currentPolicy.sessionScope !== "project") {
        return blocked("caller-policy-mismatch", "Read live canonical-current caller-keyed Chat×Project restrictions.");
      }
      callerRestriction = policyBlock(caller.policy, input.action, false) ?? policyBlock(currentPolicy, input.action, false);
    } else {
      if (!nonGitIdentityMatches(caller.current, input.owner)) {
        return blocked("caller-identity-unavailable", "Positively verified non-Git physical caller identity is required; unknown Git refuses.");
      }
      callerRestriction = chatPolicyBlock(caller.policy, input.action);
    }
    const policy = structuredClone(await readers.readPolicy(selected, input.owner));
    if (!policyMatches(policy, selected) || policy.sessionScope !== "project") {
      return blocked("selected-policy-mismatch", "Read live selected Project and caller-keyed Chat×Project policy.");
    }
    const restriction = callerRestriction ?? policyBlock(policy, input.action, true);
    if (restriction) return restriction;
    const field = confirmationField[input.action];
    const preference = policy.resolved.session.values[field];
    if (preference !== "ask" && preference !== "none") return blocked("invalid-policy", "Unsupported confirmation policy.");
    if (input.action === "prepare") {
      // Designation must be explicitly SAVED on this Project, not inherited
      // Global, old task names, a guessed primary branch or an unsaved draft.
      const main = policy.project.mainBranch;
      if (!validLocalBranchName(main) || policy.resolved.session.values.mainBranch !== main
        || policy.resolved.session.origins.mainBranch !== "project") {
        return blocked("project-main-required", "Prepare requires an explicit saved Project main branch.");
      }
      if (selected.branch === main) return blocked("source-is-main", "Prepare source must not be the designated main branch.");
    }
    // Read savedAction independently of preferences on EVERY evaluation, even
    // Ask. Selected B Allow cannot defeat canonical-current caller Deny.
    const currentAuthorization = gitCaller(caller)
      ? structuredClone(await readers.readCurrentAuthorization(caller.current.resources, input.owner)) : undefined;
    const selectedAuthorization = structuredClone(await readers.readAuthorization(selected, input.owner));
    const saved = selectedAuthorization.actions[input.action]?.effective;
    const currentSaved = currentAuthorization?.actions[input.action]?.effective;
    if (!["allow", "deny", "none"].includes(saved) || gitCaller(caller) && !currentAuthorization
      || currentAuthorization && (!["allow", "deny", "none"].includes(currentSaved!)
        || !nonempty(currentAuthorization.revision) || !nonempty(currentAuthorization.policyRevision))
      || !nonempty(selectedAuthorization.revision) || !nonempty(selectedAuthorization.policyRevision)) {
      return blocked("invalid-authorization", "Live saved action authorization is unavailable.");
    }
    if (saved === "deny" || currentSaved === "deny") return blocked("saved-deny", "A live saved action Deny blocks even exact Ask.");
    if (input.confirmation === "none" && (preference !== "none" || saved !== "allow")) {
      return blocked("saved-allow-required", "Explicit none requires live selected confirmation:none and independently read saved action Allow.");
    }
    await readers.revalidateCurrent(caller.current, input.owner);
    await readers.revalidateResources(selected);
    // Fence mixed reads (e.g. policy:none followed by a policy edit before the
    // grant read). This is not a lock against external writers; the outer
    // controller still revalidates under admission immediately before effect.
    const latestCaller = await readers.readCaller(input.owner);
    const latestCurrentPolicy = gitCaller(caller) ? await readers.readCurrentPolicy(caller.current.resources, input.owner) : undefined;
    const latestPolicy = await readers.readPolicy(selected, input.owner);
    const latestCurrentAuthorization = gitCaller(caller) ? await readers.readCurrentAuthorization(caller.current.resources, input.owner) : undefined;
    const latestSelectedAuthorization = await readers.readAuthorization(selected, input.owner);
    if (digest({ caller, currentPolicy, policy, currentAuthorization, selectedAuthorization })
      !== digest({ caller: latestCaller, currentPolicy: latestCurrentPolicy, policy: latestPolicy, currentAuthorization: latestCurrentAuthorization,
        selectedAuthorization: latestSelectedAuthorization })) {
      return blocked("live-state-changed", "Live authority changed during evaluation; recapture and review.");
    }
    const now = (readers.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + LIFETIME_MS)) {
      return blocked("invalid-clock", "Authorization clock is unavailable.");
    }
    const evidence: SelectedOperationEvidence = Object.freeze({ version: 1, approvalToken: false,
      kind: input.confirmation === "none" ? "saved-allow" : "exact-approval-required",
      action: input.action, requestId: input.requestId, requestRevision: input.requestRevision,
      revision: digest({ input, selected, caller, currentPolicy, policy, currentAuthorization, selectedAuthorization }),
      capturedAt: now, expiresAt: now + LIFETIME_MS });
    return { kind: "evidence", evidence };
  } catch {
    return blocked("live-read-failed", "Live caller, resource, policy or authorization read failed; operation refused.");
  }
}

/** Outer controller calls immediately before EACH effect under its own native
 * reservation/admission gate. This rereads all live authority, compares exact
 * revisions, and refreshes the observation expiry ONLY after an identical full
 * live reread. An expired observation is not authority, but need not force a
 * second human approval or reject a long check's final CAS. The separate exact
 * approval remains bound to the same live request/native candidate, whose own
 * validity/TTL the controller must independently enforce. Saved-Allow still
 * requires fresh Allow on every call, never an old observation's grant.
 * Do not accept client/history evidence as a token; retain capture in live
 * process-owned request state. No receipts/grants/settings are created here. */
export async function revalidateSelectedOperationAuthorization(
  request: SelectedOperationRequest, captured: SelectedOperationEvidence, readers: SelectedOperationReaders,
): Promise<SelectedOperationEvaluation> {
  const now = (readers.now ?? Date.now)();
  if (captured?.version !== 1 || captured.approvalToken !== false || !Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(captured.capturedAt) || captured.capturedAt < 0 || !Number.isSafeInteger(captured.expiresAt)
    || captured.expiresAt !== captured.capturedAt + LIFETIME_MS || now < captured.capturedAt
    || !["exact-approval-required", "saved-allow"].includes(captured.kind) || !SELECTED_OPERATION_ACTIONS.includes(captured.action)
    || !nonempty(captured.requestId) || !nonempty(captured.requestRevision) || !/^[a-f0-9]{64}$/.test(captured.revision)) {
    return blocked("invalid-evidence", "Observation format or clock is invalid; use process-owned live request evidence.");
  }
  const fresh = await captureSelectedOperationAuthorization(request, readers);
  if (fresh.kind === "blocked") return fresh;
  if (fresh.evidence.revision !== captured.revision || fresh.evidence.kind !== captured.kind
    || fresh.evidence.action !== captured.action || fresh.evidence.requestId !== captured.requestId
    || fresh.evidence.requestRevision !== captured.requestRevision || fresh.evidence.capturedAt < now) {
    return blocked("revision-changed", "Request, caller, resources, policy or saved authorization changed; recapture and review.");
  }
  return fresh;
}
