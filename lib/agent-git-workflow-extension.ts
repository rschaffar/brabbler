import { execFile } from "node:child_process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { confirmGitCommit, prepareGitCommit } from "./git-commit";
import { getGitCommitTreeOid, getGitReviewDiff, getGitTreeDiff, reviewGitBranches, type GitReviewSelection } from "./git-review";
import { gitExecEnv } from "./git-exec";
import { acquireGitCheckoutGate } from "./git-checkout-gate";
import { prepareIntegration, confirmIntegration } from "./git-integration";
import { runGitVerification } from "./git-verification";
import { validateGitWorkflowPolicy, type GitWorkflowCheck, validLocalBranchName } from "./git-workflow-policy";
import { getProjectTrustStatus } from "./project-trust";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { hasBusyRpcSessionForCwd } from "./rpc-manager";
import { samePath, toNativePath } from "./paths";
import type { GitActionCandidate } from "./types";

const exec = promisify(execFile);

/** Pi Web's browser UI transport, deliberately not a generic confirmation dialog. */
export interface AgentGitWorkflowUiContext {
  gitAction(candidate: GitActionCandidate, signal?: AbortSignal): Promise<boolean>;
}

async function targetCheckout(cwd: string, branch: string): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "worktree", "list", "--porcelain", "-z"],
    { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 1024 * 1024 });
  let location = "";
  let target = "";
  for (const line of stdout.split("\0")) {
    if (line.startsWith("worktree ")) location = toNativePath(line.slice(9));
    if (line === `branch refs/heads/${branch}`) {
      if (target) throw new Error("Ambiguous target checkout");
      target = location;
    }
  }
  if (!target || samePath(target, cwd) || !samePath(target, await realpath(target))) throw new Error("Distinct physical target checkout required");
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(target, roots)) throw new Error("Checkout outside allowed roots");
  const { stdout: top } = await exec("git", ["--no-optional-locks", "-C", target, "rev-parse", "--show-toplevel"],
    { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096 });
  if (!samePath(target, toNativePath(top.trim()))) throw new Error("Target checkout root required");
  return target;
}

async function featureBranch(cwd: string): Promise<string> {
  const { stdout: root } = await exec("git", ["--no-optional-locks", "-C", cwd, "rev-parse", "--show-toplevel"],
    { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096 });
  if (!samePath(cwd, toNativePath(root.trim()))) throw new Error("Checkout root required");
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "symbolic-ref", "--quiet", "HEAD"],
    { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096 });
  if (!stdout.trim().startsWith("refs/heads/")) throw new Error("Local feature branch required");
  return stdout.trim().slice("refs/heads/".length);
}

/** A human-bound first slice of the generic Git workflow: no saved policy is needed for inspection or an approved commit. */
export function createAgentGitWorkflowExtension(sessionCwd: string, agentDir: string = getAgentDir()): InlineExtension {
  return {
    name: "pi-web-agent-git-workflow",
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "git_workflow",
        label: "Git Workflow",
        description: "Review local Git candidates. `integrate` requires an explicit local targetBranch and ordered checks (label + executable argv); asks permission to run them, then separately shows an exact merge plan for approval. No saved policy required. Checks may execute project code. Only unsigned non-FF local integration; no cleanup or remote actions.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"review" | "commit" | "integrate">({ type: "string", enum: ["review", "commit", "integrate"] }),
          targetBranch: Type.Optional(Type.String({ description: "Existing local target branch for review" })),
          commitOids: Type.Optional(Type.Array(Type.String(), { description: "Optional ordered consecutive commits to compare instead of the whole proposed merge" })),
          paths: Type.Optional(Type.Array(Type.String(), { description: "Complete changed file paths for commit" })),
          message: Type.Optional(Type.String({ description: "Exact commit message for approval" })),
          checks: Type.Optional(Type.Array(Type.Object({ label: Type.String(), argv: Type.Array(Type.String()) }), { description: "Ordered verification commands, without a shell. Explicit user approval required before execution." })),
        }),
        async execute(_id, params, signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          if (!samePath(ctx.cwd, sessionCwd)) return failure("Session checkout changed; Git workflow refused");
          const ui = ctx.ui as typeof ctx.ui & Partial<AgentGitWorkflowUiContext>;
          if (!ctx.hasUI || !ui.gitAction) return failure("Git workflow review requires an interactive Pi Web session");
          if (signal?.aborted) return failure("Git workflow cancelled");
          try {
            if (params.operation === "review") {
              if (!params.targetBranch || params.paths || params.message || params.checks) return failure("Choose a local target branch to review");
              const review = await reviewGitBranches(ctx.cwd, await featureBranch(ctx.cwd), params.targetBranch);
              const selection: GitReviewSelection = params.commitOids?.length
                ? { kind: "commits", commitOids: params.commitOids }
                : { kind: "merge" };
              const diff = await getGitReviewDiff(ctx.cwd, review, selection);
              const viewed = await ui.gitAction({ kind: "review", review, selection, diff }, signal);
              return { content: [{ type: "text" as const, text: viewed
                ? `User reviewed ${selection.kind === "merge" ? "the whole proposed merge" : "the selected contiguous commits"}. No integration was approved or executed. Target ${review.targetBranch} ${review.targetOid}; feature ${review.featureBranch} ${review.featureOid}.`
                : "Git comparison dismissed. No operation was approved or executed." }],
                details: { viewed, selection, targetOid: review.targetOid, featureOid: review.featureOid } };
            }
            if (params.operation === "integrate") {
              if (!validLocalBranchName(params.targetBranch) || !Array.isArray(params.checks) || !params.checks.length || params.paths || params.message || params.commitOids) {
                return failure("Choose a local target and at least one ordered verification check");
              }
              // Validate an ephemeral policy with the same allowlist and digest used by receipts and plans.
              const policy = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual",
                integration: { targetBranch: params.targetBranch, method: "merge" }, checks: params.checks });
              const checks = policy.checks as GitWorkflowCheck[];
              const manager = ctx.sessionManager;
              const sessionId = manager.getSessionId();
              if (!sessionId || !samePath(manager.getCwd(), sessionCwd) || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd) ||
                  !samePath(sessionCwd, await realpath(sessionCwd))) return failure("Session checkout changed");
              const branch = await featureBranch(ctx.cwd);
              const target = await targetCheckout(ctx.cwd, params.targetBranch);
              const trusted = () => getProjectTrustStatus(ctx.cwd, agentDir).trusted && getProjectTrustStatus(target, agentDir).trusted;
              const idle = () => !hasBusyRpcSessionForCwd(ctx.cwd, sessionId) && !hasBusyRpcSessionForCwd(target, sessionId);
              const valid = async () => !signal?.aborted && trusted() && idle() &&
                samePath(target, await targetCheckout(ctx.cwd, params.targetBranch!)) &&
                samePath(manager.getCwd(), ctx.cwd) && (await featureBranch(ctx.cwd)) === branch;
              if (!await valid()) return failure("Trust both registered checkouts and stop other sessions before integration");
              if (!await ui.gitAction({ kind: "checks", targetBranch: params.targetBranch, featureBranch: branch, checks }, signal) || signal?.aborted) {
                return { content: [{ type: "text" as const, text: "Verification declined; no checks or integration executed." }], details: { approved: false } };
              }
              const review = await reviewGitBranches(ctx.cwd, branch, params.targetBranch);
              const receipts = [];
              // No gate while the browser is answering. Reserve both checkouts only during execution.
              const releaseChecks = acquireGitCheckoutGate([ctx.cwd, target]);
              try {
                if (!await valid()) return failure("Checkout became busy or untrusted before verification");
                for (let i = 0; i < checks.length; i++) {
                  if (!await valid()) return failure("Verification cancelled or checkout changed");
                  receipts.push(await runGitVerification({ sessionId, cwd: ctx.cwd, agentDir, review, checkIndex: i,
                    getPolicy: () => policy, isTrusted: trusted, signal }));
                }
              } finally { releaseChecks(); }
              if (!await valid()) return failure("Checkout became busy or untrusted after verification");
              const plan = await prepareIntegration({ sessionId, cwd: ctx.cwd, agentDir, featureBranch: branch,
                receiptIds: receipts.map((r) => r.id), getPolicy: () => policy });
              if (!await ui.gitAction({ kind: "integration", plan, receipts }, signal) || signal?.aborted) {
                return { content: [{ type: "text" as const, text: "Exact merge declined; no integration executed." }], details: { approved: false } };
              }
              const releaseMerge = acquireGitCheckoutGate([ctx.cwd, target]);
              try {
                if (!await valid()) return failure("Checkout became busy or untrusted before merge");
                const result = await confirmIntegration(plan.planId, plan.planId, sessionId);
                return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
              } finally { releaseMerge(); }
            }
            if (params.operation !== "commit" || params.checks || !params.paths?.length || typeof params.message !== "string" || !params.message.trim() || params.targetBranch || params.commitOids) {
              return failure("Select complete changed paths and provide an exact commit message");
            }
            const preview = await prepareGitCommit(ctx.cwd, params.paths);
            const parentTree = await getGitCommitTreeOid(ctx.cwd, preview.head);
            const diff = await getGitTreeDiff(ctx.cwd, parentTree, preview.tree);
            if (!await ui.gitAction({ kind: "commit", preview, message: params.message, diff }, signal) || signal?.aborted) {
              return { content: [{ type: "text" as const, text: "Commit declined or cancelled; no commit was made." }], details: { approved: false } };
            }
            const result = await confirmGitCommit(preview, params.message);
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
          } catch {
            // Never send raw Git stderr or file contents back through a failed tool result.
            return failure("Git candidate unavailable or stale; inspect the checkout and request a fresh review");
          }
        },
      });
    },
  };
}
