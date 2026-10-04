/** Shared policy DTOs and validation only. Session persistence and inheritance stay server-side. */
import { validateGitCheckRecipes, type GitCheckRecipe } from "./git-check-recipe";
export {
  MAX_GIT_WORKFLOW_CHECKS, MAX_GIT_WORKFLOW_CHECK_ARGS, MAX_GIT_WORKFLOW_CHECK_LABEL,
  MAX_GIT_WORKFLOW_CHECK_EXECUTABLE, MAX_GIT_WORKFLOW_CHECK_ARG,
} from "./git-check-recipe";

export const GIT_WORKFLOW_TYPE = "pi-web:git-workflow";
export type GitWorkflowCheck = GitCheckRecipe;

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
    ...(Object.hasOwn(input, "checks") ? { checks: validateGitCheckRecipes(input.checks) } : {}),
  };
  return input.mode === "worktree"
    ? { mode: "worktree", baseBranch: input.baseBranch as string, ...common }
    : { mode: "current", ...(Object.hasOwn(input, "branch") ? { branch: input.branch as string } : {}), ...common };
}
