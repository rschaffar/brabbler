import { captureGitActionCandidateSnapshot } from "./git-action-journal";
import { GIT_ACTION_ID_PATTERN } from "./git-action-types";
import type { ExtensionUiRequest, GitActionCandidate, GitNativeActionCandidate } from "./types";

/** Internal trusted display projection only. Call with the server-captured
 * artifact and its journal ID, never model/tool data. Does not open UI, approve,
 * execute, reconstruct a capability or read a checkout. Patch bytes stay only
 * in immutable lazy history; they never enter the transient native Ask packet. */
export function projectNativeGitActionCandidate(actionId: string, captured: unknown): GitNativeActionCandidate {
  if (typeof actionId !== "string" || !GIT_ACTION_ID_PATTERN.test(actionId)) throw new Error("Invalid Git action display identity");
  const snapshot = captureGitActionCandidateSnapshot(captured);
  if (!["workspace", "preparation", "checkout-verification", "cleanup"].includes(snapshot.kind)) throw new Error("Native Git action display kind required");
  // Native journal validation requires the complete v2 resource attribution.
  const attribution = { actionId, repositoryRoot: snapshot.repositoryRoot, projectRoot: snapshot.projectRoot!,
    sourceCheckoutRoot: snapshot.sourceCheckoutRoot!, resourceAttribution: snapshot.resourceAttribution! };
  if (snapshot.kind === "workspace") return { ...attribution, kind: "workspace", workspace: snapshot.workspace! };
  if (snapshot.kind === "checkout-verification") return { ...attribution, kind: "checkout-verification", featureBranch: snapshot.featureBranch!, checkoutVerification: snapshot.checkoutVerification! };
  if (snapshot.kind === "cleanup") return { ...attribution, kind: "cleanup", featureBranch: snapshot.featureBranch!, targetBranch: snapshot.targetBranch!,
    targetCheckoutRoot: snapshot.targetCheckoutRoot!, cleanup: { ...snapshot.cleanup!, ignored: snapshot.cleanup!.ignored! } };
  return { ...attribution, kind: "preparation", featureBranch: snapshot.featureBranch!, targetBranch: snapshot.targetBranch!,
    targetCheckoutRoot: snapshot.targetCheckoutRoot!, preparation: { ...snapshot.preparation!, commitMapping: snapshot.preparation!.commitMapping! } };
}

/** Wrapper integration seam: new native packets are strictly reprojected,
 * while existing v1 candidates retain their original bytes and semantics. */
export function projectGitActionUiCandidate(candidate: GitActionCandidate): GitActionCandidate {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid Git action display candidate");
  switch (candidate.kind) {
    case "preferences": case "commit": case "review": case "checks": case "integration": return candidate;
    case "workspace": case "preparation": case "checkout-verification": case "cleanup": {
      const { actionId, ...captured } = candidate;
      return projectNativeGitActionCandidate(actionId, captured);
    }
    default: throw new Error("Unsupported Git action display kind");
  }
}

/** Strict reducer for an ACTUAL pending native request. The wrapper must look
 * up that live request first; action/history IDs never authorize a response.
 * Undefined means invalid/pending, not cancellation or an automatic decline. */
export function resolveNativeGitActionResponse(request: Extract<ExtensionUiRequest, { method: "git_action" }>, response: unknown): boolean | undefined {
  if (!["workspace", "preparation", "checkout-verification", "cleanup"].includes(request.candidate.kind)
    || !response || typeof response !== "object" || Array.isArray(response)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(response))) return;
  // The actual pending packet must still be a known, bounded native display
  // schema. Scope/stage confusion or future fields cannot become an approval.
  try {
    projectGitActionUiCandidate(request.candidate);
  } catch { return; }
  const descriptors = Object.getOwnPropertyDescriptors(response);
  if (Reflect.ownKeys(response).some((key) => typeof key !== "string" || !["type", "id", "confirmed", "cancelled"].includes(key)
    || !descriptors[key].enumerable || !("value" in descriptors[key]))) return;
  const v = response as Record<string, unknown>;
  if (v.type !== "extension_ui_response" || v.id !== request.id || Object.keys(v).length !== 3) return;
  if (Object.hasOwn(v, "cancelled")) return v.cancelled === true ? false : undefined;
  return typeof v.confirmed === "boolean" ? v.confirmed : undefined;
}

/** Additive wrapper guard. Old request kinds pass through to their unchanged
 * existing reducers; no approval is manufactured here. */
export function gitActionResponsePassesNativeGuard(request: Extract<ExtensionUiRequest, { method: "git_action" }>, response: unknown): boolean {
  switch (request.candidate.kind) {
    case "preferences": case "commit": case "review": case "checks": case "integration": return true;
    case "workspace": case "preparation": case "checkout-verification": case "cleanup":
      return resolveNativeGitActionResponse(request, response) !== undefined;
    default: return false;
  }
}

/** For the parent-owned wrapper's attention display, not authorization. */
export function gitActionAttentionSummary(candidate: GitActionCandidate): string {
  switch (candidate.kind) {
    case "preferences": return "Choose Git workflow preferences";
    case "commit": return "Review exact Git commit";
    case "checks": return "Approve Git checks";
    case "integration": return "Approve exact Git merge";
    case "review": return "Review local Git comparison";
    case "workspace": return candidate.workspace.mode === "create" ? "Approve exact worktree creation" : "Approve exact worktree attachment";
    case "preparation": return "Approve exact history preparation";
    case "checkout-verification": return "Approve saved checkout checks";
    case "cleanup": return candidate.cleanup.ignoredCount ? "Approve cleanup and ALL named ignored-data deletion" : "Approve exact local cleanup";
    default: return "Unsupported Git request";
  }
}
