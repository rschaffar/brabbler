/** Browser intent only. Neither captured graph evidence nor payload fields grant authority. */
export type DiscardSubject = { kind: "branch"; branch: string; tip: string } | { kind: "detached"; head: string };
export interface BrowserDiscardPayload {
  subject: DiscardSubject;
  worktreePath?: string;
  removeWorktree: boolean;
  deleteBranch: boolean;
  comparisonTarget?: { branch: string; tip: string };
}
export interface BrowserDiscardOperation extends BrowserDiscardPayload {
  action: "discardResources";
  checkout: string;
  artifactRoots: string[];
}
export interface DiscardLossEvidence {
  state: "integrated" | "not-integrated" | "unknown";
  reason?: string;
  comparisonTarget?: { branch: string; tip: string };
}
/** Graph results are evidence only; structural/ref eligibility is checked separately. */
export function discardLossEvidence(comparisonTarget: { branch: string; tip: string }, contained: "yes" | "no" | "unknown", retained: "yes" | "no" | "unknown"): DiscardLossEvidence {
  return { comparisonTarget,
    state: retained === "yes" && contained === "yes" ? "integrated" : retained === "yes" && contained === "no" ? "not-integrated" : "unknown",
    ...(retained !== "yes" ? { reason: "comparison-proof-lost" } : contained === "unknown" ? { reason: "graph-unavailable-or-incomplete" } : {}) };
}
export function requiresDiscardLossAcknowledgment(op: Pick<BrowserDiscardOperation, "deleteBranch">, evidence: DiscardLossEvidence): boolean {
  return op.deleteBranch && evidence.state !== "integrated";
}
const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Unexpected manual discard field");
}
function branch(value: unknown): value is string {
  return typeof value === "string" && !!value && value !== "HEAD" && !value.startsWith("-") && !value.includes("\0");
}
export function browserDiscardOperation(raw: unknown, checkout: string): BrowserDiscardOperation {
  if (!object(raw)) throw new Error("Invalid manual discard payload");
  only(raw, ["subject", "worktreePath", "removeWorktree", "deleteBranch", "comparisonTarget"]);
  if (!object(raw.subject)) throw new Error("Select an exact branch or detached HEAD");
  const subject = raw.subject;
  if (subject.kind === "branch") {
    only(subject, ["kind", "branch", "tip"]);
    if (!branch(subject.branch) || typeof subject.tip !== "string" || !oid.test(subject.tip)) throw new Error("Select a literal local branch and full exact tip");
  } else if (subject.kind === "detached") {
    only(subject, ["kind", "head"]);
    if (typeof subject.head !== "string" || !oid.test(subject.head)) throw new Error("Select a full exact detached HEAD commit");
  } else throw new Error("Unsupported manual discard subject");
  if (typeof raw.removeWorktree !== "boolean" || typeof raw.deleteBranch !== "boolean" || !raw.removeWorktree && !raw.deleteBranch
    || raw.worktreePath !== undefined && (typeof raw.worktreePath !== "string" || !raw.worktreePath)
    || raw.removeWorktree !== Boolean(raw.worktreePath)) throw new Error("Select explicit exact branch/worktree removal resources");
  if (subject.kind === "detached" && (!raw.removeWorktree || raw.deleteBranch)) throw new Error("Detached discard removes only its worktree; there is no branch to delete");
  if (raw.comparisonTarget !== undefined) {
    if (!object(raw.comparisonTarget)) throw new Error("Invalid captured comparison target");
    only(raw.comparisonTarget, ["branch", "tip"]);
    if (!branch(raw.comparisonTarget.branch) || typeof raw.comparisonTarget.tip !== "string" || !oid.test(raw.comparisonTarget.tip)) throw new Error("Select a literal comparison branch and full captured tip");
  }
  return { ...structuredClone(raw) as unknown as BrowserDiscardPayload, action: "discardResources", checkout, artifactRoots: [] };
}
/** The browser entry point also validates callers bypassing the project adapter. */
export function validateBrowserDiscardOperation(operation: BrowserDiscardOperation): BrowserDiscardOperation {
  if (!object(operation)) throw new Error("Invalid manual discard operation");
  only(operation, ["action", "checkout", "artifactRoots", "subject", "worktreePath", "removeWorktree", "deleteBranch", "comparisonTarget"]);
  const { action, checkout, artifactRoots, ...payload } = operation;
  if (action !== "discardResources" || typeof checkout !== "string" || !Array.isArray(artifactRoots) || artifactRoots.length) throw new Error("Browser discard cannot select explicit artifact roots");
  return browserDiscardOperation(payload, checkout);
}
