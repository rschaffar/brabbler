import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";
import { appendManagedSessionGitWorkflow, readManagedSessionGitWorkflow, validateManagedSessionGitWorkflow } from "./git-workflow-session";
import { inheritGitProjectSessionSettings } from "./git-project-session";

export const GIT_WORKFLOW_TYPE = "pi-web:git-workflow";

export type GitWorkflowCheck = { label: string; argv: string[] };

export const MAX_GIT_WORKFLOW_CHECKS = 12;
export const MAX_GIT_WORKFLOW_CHECK_ARGS = 32;
export const MAX_GIT_WORKFLOW_CHECK_LABEL = 80;
export const MAX_GIT_WORKFLOW_CHECK_EXECUTABLE = 256;
export const MAX_GIT_WORKFLOW_CHECK_ARG = 512;

// Check bounds also apply to UTF-8 bytes in durable Git action history.
// TextEncoder keeps this shared policy compatible with browsers and Node.
const checkTextEncoder = new TextEncoder();

export type GitWorkflowPolicy = {
  mode: "worktree";
  /** Name of a local branch; existence and expected tip must be checked by the caller. */
  baseBranch: string;
  onCreate: "continue" | "fork" | "stay";
  commits: "agent" | "manual";
  integration?: { targetBranch: string; method: "merge" | "ff" | "squash" };
  checks?: GitWorkflowCheck[];
} | {
  mode: "current";
  /** When supplied, require this branch before operating in the current checkout. */
  branch?: string;
  onCreate: "continue" | "fork" | "stay";
  commits: "agent" | "manual";
  integration?: { targetBranch: string; method: "merge" | "ff" | "squash" };
  checks?: GitWorkflowCheck[];
};

export interface SessionGitWorkflowData {
  version: 1;
  /** Null explicitly opts out; undefined means no session policy was recorded. */
  policy: GitWorkflowPolicy | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

/** Pure, conservative local branch-name check. Does not assert the branch exists. */
export function validLocalBranchName(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 255 || value === "@"
    || value.startsWith("-") || value.startsWith("refs/")
    || value.includes("..") || value.includes("@{") || value.endsWith("/")) return false;
  // Conservative printable ASCII subset: excludes whitespace, controls, ref
  // metacharacters, backslashes, and visually confusable/invisible Unicode.
  if (!/^[A-Za-z0-9_./+\-]+$/.test(value)) return false;
  return value.split("/").every((part) => part.length > 0 && !part.startsWith(".")
    && !part.endsWith(".") && !part.endsWith(".lock"));
}

function validCheckText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && checkTextEncoder.encode(value).length <= max && value.trim() === value && !/[\x00-\x1f\x7f\u0085\u2028\u2029]/.test(value);
}

function validCheckArg(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && checkTextEncoder.encode(value).length <= max && value.trim().length > 0 && !/[\x00-\x1f\x7f\u0085\u2028\u2029]/.test(value)
    // These are screening rules, not a guarantee that arbitrary project code is safe.
    && !/(?:[a-z][a-z\d+.-]*:\/\/|\b(?:https?|ssh|git|ftp|file|mailto):|www\.|\b[^\s@]+@[^\s@:]+\.[^\s@:]+(?::|\/))/i.test(value)
    && !/(?:^|[^a-z\d])(?:(?:--?)?(?:api[-_]?key|token|password|passwd|secret|credential|authorization|auth)(?:[=:_-]|$)|bearer\s+|(?:sk-[a-z\d]{12,}|gh[pousr]_[a-z\d]{12,}|github_pat_[a-z\d_]{12,}|AKIA[A-Z0-9]{16}))/i.test(value);
}

function validateChecks(input: unknown): GitWorkflowCheck[] {
  if (!Array.isArray(input) || input.length > MAX_GIT_WORKFLOW_CHECKS) throw new Error("Invalid Git workflow checks");
  return input.map((check: unknown) => {
    if (!record(check) || !fields(check, ["label", "argv"])
      || !validCheckText(check.label, MAX_GIT_WORKFLOW_CHECK_LABEL)
      || !Array.isArray(check.argv) || check.argv.length < 1 || check.argv.length > MAX_GIT_WORKFLOW_CHECK_ARGS + 1
      || !validCheckArg(check.argv[0], MAX_GIT_WORKFLOW_CHECK_EXECUTABLE)
      || !check.argv.slice(1).every((arg: unknown) => validCheckArg(arg, MAX_GIT_WORKFLOW_CHECK_ARG))
      // Do not save the common shell "execute this string" forms as argv checks.
      || (/^(?:sh|bash|zsh|fish|dash|ksh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i
        .test(String(check.argv[0]).split(/[\\/]/).pop() ?? "")
        && check.argv.slice(1).some((arg: unknown) => typeof arg === "string"
          && /^(?:-[a-z]*c[a-z]*|-{1,2}(?:command|encodedcommand)|\/c)$/i.test(arg)))) {
      throw new Error("Invalid Git workflow check: use a label and bounded executable/arguments (no empty, control characters, URLs or obvious credentials)");
    }
    return { label: check.label as string, argv: [...check.argv] as string[] };
  });
}

/** Reject unknown fields (including future approvals or remote actions), rather than persisting them. */
export function validateGitWorkflowPolicy(input: unknown): GitWorkflowPolicy {
  if (!record(input) || (input.mode !== "worktree" && input.mode !== "current")
    || !fields(input, ["mode", "onCreate", "commits", ...(input.mode === "worktree" ? ["baseBranch"] : [])],
      input.mode === "current" ? ["branch", "integration", "checks"] : ["integration", "checks"])
    || !["continue", "fork", "stay"].includes(input.onCreate as string)
    || !["agent", "manual"].includes(input.commits as string)
    || (input.mode === "worktree" && !validLocalBranchName(input.baseBranch))
    || (input.mode === "current" && Object.hasOwn(input, "branch") && !validLocalBranchName(input.branch))) {
    throw new Error("Invalid Git workflow policy");
  }
  if (Object.hasOwn(input, "integration")) {
    if (!record(input.integration) || !fields(input.integration, ["targetBranch", "method"])
      || !validLocalBranchName(input.integration.targetBranch)
      || !["merge", "ff", "squash"].includes(input.integration.method as string)) {
      throw new Error("Invalid Git workflow integration");
    }
  }
  // Return a fresh, allowlisted object; callers cannot mutate a saved snapshot by reference.
  const common = {
    onCreate: input.onCreate as GitWorkflowPolicy["onCreate"],
    commits: input.commits as GitWorkflowPolicy["commits"],
    ...(record(input.integration) ? { integration: {
      targetBranch: input.integration.targetBranch as string,
      method: input.integration.method as "merge" | "ff" | "squash",
    } } : {}),
    ...(Object.hasOwn(input, "checks") ? { checks: validateChecks(input.checks) } : {}),
  };
  return input.mode === "worktree"
    ? { mode: "worktree", baseBranch: input.baseBranch as string, ...common }
    : { mode: "current", ...(Object.hasOwn(input, "branch") ? { branch: input.branch as string } : {}), ...common };
}

function parseSessionData(data: unknown): GitWorkflowPolicy | null | undefined {
  if (record(data) && data.version !== 1) {
    try { return validateManagedSessionGitWorkflow(data).policy; } catch { return null; }
  }
  if (!record(data) || !fields(data, ["version", "policy"]) || data.version !== 1) return undefined;
  if (data.policy === null) return null;
  try { return validateGitWorkflowPolicy(data.policy); } catch { return undefined; }
}

/** Latest valid entry wins; null is a deliberate override, not an absent snapshot. */
export function readSessionGitWorkflow(entries: readonly SessionEntry[]): GitWorkflowPolicy | null | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== GIT_WORKFLOW_TYPE) continue;
    const policy = parseSessionData(entry.data);
    if (policy !== undefined) return policy;
  }
  return undefined;
}

export function appendSessionGitWorkflow(manager: Pick<SessionManager, "appendCustomEntry">, policy: GitWorkflowPolicy | null): void {
  manager.appendCustomEntry(GIT_WORKFLOW_TYPE, {
    version: 1,
    policy: policy === null ? null : validateGitWorkflowPolicy(policy),
  } satisfies SessionGitWorkflowData);
}

/** Forks copy the effective session snapshot, not a newly changed project default. */
export function inheritSessionGitWorkflow(
  sourceEntries: readonly SessionEntry[], destination: Pick<SessionManager, "appendCustomEntry">,
): void {
  const managed = readManagedSessionGitWorkflow(sourceEntries);
  inheritGitProjectSessionSettings(sourceEntries, destination);
  if (managed) {
    appendManagedSessionGitWorkflow(destination, managed.overrides, managed.task);
    return;
  }
  const policy = readSessionGitWorkflow(sourceEntries);
  if (policy !== undefined) appendSessionGitWorkflow(destination, policy);
}
