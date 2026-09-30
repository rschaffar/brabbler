import { execFile } from "node:child_process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension, SessionManager } from "@earendil-works/pi-coding-agent";
import { appendAgentGitPreferences, readAgentGitPreferences, type AgentGitPreferences } from "./agent-git-preferences";
import type { SessionEntry } from "./types";
import { getGitReviewDiff, reviewGitBranches, type GitReviewSelection, type GitReviewRepository } from "./git-review";
import { assertManagedGitAction, assertManagedGitWorkspace, managedGitSessionFacts, ManagedGitAccessError, watchManagedGitAccess, type ManagedGitStage } from "./git-workflow-access";
import { managedGitPermissions, AUTOMATIC_WORKFLOW_UNAVAILABLE, PROJECT_GIT_WRITES_UNAVAILABLE } from "./git-workflow-permissions";
import { loadGitProjectSettings } from "./git-project-settings";
import { selectGitProjectResources, revalidateGitProjectResources, withGitProjectReview, gitProjectResourceSummary, GitProjectResourceError } from "./git-project-resources";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import { getGitTaskBindingStatus } from "./git-workflow-binding";
import { requestWorkflowCommit } from "./git-workflow-commit";
import { beginGitAction, failGitAction, finishGitAction, gitActionFailureResult, gitActionSink, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError } from "./git-action-controller";
import { gitExecEnv } from "./git-exec";
import { acquireGitCheckoutGate, GitCheckoutBusyError } from "./git-checkout-gate";
import { GitCommitOperationError } from "./git-commit";
import { prepareIntegration, confirmIntegration } from "./git-integration";
import { runGitVerification } from "./git-verification";
import { validateGitWorkflowPolicy, type GitWorkflowCheck, validLocalBranchName } from "./git-workflow-policy";
import { getProjectTrustStatus } from "./project-trust";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { hasBusyRpcSessionForCwd } from "./rpc-manager";
import { samePath, toNativePath } from "./paths";
import { selectGitWorkspace } from "./git-workspace-selector";
import type { GitActionCandidate } from "./types";

const exec = promisify(execFile);

// Unexpected failures identify only the stage, never a guessed cause or raw error.
const INTEGRATION_PREAPPROVAL_DIAGNOSTICS = {
  caller: "Integration caller validation could not complete. Inspect the persisted session and its checkout.",
  permission: "Integration permission validation could not complete. Inspect Workflow permissions and captured task settings.",
  workspace: "Integration source workspace validation could not complete. Inspect the selected registered feature checkout.",
  checks: "Integration check validation could not complete. Inspect the ordered check labels and executable/argument bounds (including UTF-8 bytes).",
  target: "Integration target checkout validation could not complete. Inspect the local target branch, its distinct registered physical checkout, and allowed roots.",
  trust: "Integration trust validation could not complete. Inspect project trust for both registered checkouts.",
  busy: "Integration session-busy validation could not complete. Inspect running or starting sessions in both registered checkouts.",
  journal: "Integration check-candidate journaling could not complete. Inspect durable Git action history availability and candidate bounds.",
} as const;
type IntegrationPreApprovalPhase = keyof typeof INTEGRATION_PREAPPROVAL_DIAGNOSTICS;

/** Pi Web's browser UI transport, deliberately not a generic confirmation dialog. */
export interface AgentGitWorkflowUiContext {
  gitAction(candidate: GitActionCandidate, signal?: AbortSignal): Promise<boolean>;
  gitPreferences(candidate: Extract<GitActionCandidate, { kind: "preferences" }>, signal?: AbortSignal): Promise<AgentGitPreferences | null>;
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

async function registeredTargets(cwd: string, feature: string): Promise<string[]> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "worktree", "list", "--porcelain", "-z"],
    { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 1024 * 1024 });
  const names = [...stdout.matchAll(/(?:^|\0)branch refs\/heads\/([^\0]+)/g)].map((match) => match[1]);
  return [...new Set(names.filter((name) => name !== feature && validLocalBranchName(name)))];
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
export function createAgentGitWorkflowExtension(sessionCwd: string, agentDir: string = getAgentDir(),
  writableManager?: Pick<SessionManager, "getEntries" | "appendCustomEntry" | "isPersisted">): InlineExtension {
  return {
    name: "pi-web-agent-git-workflow",
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "git_workflow",
        label: "Git Workflow",
        description: "Inspect captured settings with status; configure all scopes in the Workflow panel. Review local candidates, request an exact commit (alias of git_commit operation commit), or integrate using the captured local target/checks. Integration asks for check execution and then exact-state non-FF merge approval. Existing legacy sessions may still supply target/checks and use preferences; managed tasks cannot be retargeted through that legacy form. For status/review only, repositoryPath explicitly selects another allowed repository, with workspaceBranch scoped to it. Without repositoryPath, workspaceBranch stays in this chat's repository. Selection never moves the chat or retargets shell/file tools. Explicit-project mutations are not yet supported. Live disable/pause applies to mutations. No automatic integration, cleanup, or remote actions.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"status" | "preferences" | "review" | "commit" | "integrate">({ type: "string", enum: ["status", "preferences", "review", "commit", "integrate"] }),
          repositoryPath: Type.Optional(Type.String({ description: "Status/review only: absolute physical registered checkout root identifying the repository; no chat move or mutation authority", maxLength: 4096 })),
          workspaceBranch: Type.Optional(Type.String({ description: "Checked-out local branch within the explicitly selected repository, or this chat's repository when repositoryPath is omitted" })),
          targetBranch: Type.Optional(Type.String({ description: "Existing local target branch for review" })),
          commitOids: Type.Optional(Type.Array(Type.String(), { description: "Optional ordered consecutive commits to compare instead of the whole proposed merge" })),
          paths: Type.Optional(Type.Array(Type.String(), { description: "Complete changed file paths for commit" })),
          message: Type.Optional(Type.String({ description: "Exact commit message for approval" })),
          checks: Type.Optional(Type.Array(Type.Object({ label: Type.String(), argv: Type.Array(Type.String()) }), { description: "Ordered verification commands, without a shell. Explicit user approval required before execution." })),
        }),
        async execute(_id, params, signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          let preApprovalPhase: IntegrationPreApprovalPhase | undefined = params.operation === "integrate" ? "caller" : undefined;
          const preApprovalStage = (phase: IntegrationPreApprovalPhase) => { if (preApprovalPhase) preApprovalPhase = phase; };
          try {
            if (!samePath(ctx.cwd, sessionCwd)) return failure("Session checkout changed; Git workflow refused");
            const ui = ctx.ui as typeof ctx.ui & Partial<AgentGitWorkflowUiContext>;
            if (signal?.aborted) return failure("Git workflow cancelled");
            const entries = () => (writableManager?.getEntries() ?? ctx.sessionManager?.getEntries?.() ?? []) as SessionEntry[];
            const guard = (stage: ManagedGitStage) => assertManagedGitAction(sessionCwd, entries(), stage, "agent", agentDir, pi.getActiveTools?.());
            if (params.repositoryPath !== undefined && params.operation !== "status" && params.operation !== "review") return failure(PROJECT_GIT_WRITES_UNAVAILABLE);
            const selected = params.repositoryPath !== undefined ? await selectGitProjectResources(params.repositoryPath, params.workspaceBranch) : undefined;
            const selectedState = selected ? await loadGitProjectSettings(selected, entries(), agentDir, ctx.sessionManager.getSessionId()) : undefined;
            if (params.operation === "status") {
              if (selected && selectedState) {
                const summary = { selection: gitProjectResourceSummary(selected), saved: selectedState.resolved.session,
                  paused: selectedState.paused, sessionScope: "project", legacySessionSettings: selectedState.legacySessionSettings,
                  permissions: managedGitPermissions(selectedState, managedGitSessionFacts(entries(), pi.getActiveTools?.())),
                  capabilities: { status: true, review: process.platform === "linux", mutations: false }, settingsHome: "Workflow",
                  note: PROJECT_GIT_WRITES_UNAVAILABLE };
                return { content: [{ type: "text" as const, text: JSON.stringify(summary) }], details: summary };
              }
              const source = params.workspaceBranch !== undefined ? await selectGitWorkspace(sessionCwd, params.workspaceBranch) : sessionCwd;
              const state = await loadGitWorkflowSettings(sessionCwd, entries(), agentDir, ctx.sessionManager.getSessionId());
              const sessionId = writableManager?.isPersisted?.() ? ctx.sessionManager?.getSessionId?.() : undefined;
              const binding = sessionId ? await getGitTaskBindingStatus(sessionId, agentDir) : undefined;
              const taskBinding = binding ? { status: binding.status, reason: binding.reason, executionAuthority: false,
                ...(binding.binding ? { id: binding.binding.id, generation: binding.binding.generation, goal: binding.binding.goal,
                  workspace: binding.binding.workspace, branch: binding.binding.branch, sourceCount: binding.binding.sources.length } : {}) }
                : { status: "unavailable", reason: "Persisted ordinary session required for private task review metadata.", executionAuthority: false };
              const summary = { cwd: source, paused: state.paused, enabled: state.resolved.session.values.enabled, task: state.task,
                saved: state.resolved.session, taskBinding,
                permissions: managedGitPermissions(state, managedGitSessionFacts(entries(), pi.getActiveTools?.())),
                settingsHome: "Workflow", automaticIntegration: false, cleanup: "retain", automaticUnavailable: AUTOMATIC_WORKFLOW_UNAVAILABLE };
              return { content: [{ type: "text" as const, text: JSON.stringify(summary) }], details: summary };
            }
            if (!ctx.hasUI || !ui.gitAction) return failure("Git workflow review requires an interactive Pi Web session");
            preApprovalStage("permission");
            const state = params.operation === "review" ? null : await guard(params.operation === "commit" ? "commit" : params.operation === "integrate" ? "integration" : "settings");
            preApprovalStage("workspace");
            const workspace = selected?.cwd ?? await selectGitWorkspace(sessionCwd, params.workspaceBranch);
            if (params.operation === "preferences") {
              if (state?.task.kind === "managed") return failure("Configure all scopes in the Workflow panel. Legacy preferences cannot override this managed task.");
              if (params.targetBranch || params.paths || params.message || params.commitOids || !ui.gitPreferences) return failure("Provide only proposed checks for early preferences");
              const manager = ctx.sessionManager;
              if (!manager?.getSessionId() || !writableManager?.isPersisted() || !samePath(manager.getCwd(), sessionCwd)
                || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd) || !samePath(sessionCwd, await realpath(sessionCwd))) return failure("Persisted session checkout required");
              const feature = await featureBranch(workspace);
              const targets = await registeredTargets(workspace, feature);
              const targetTips = new Map(await Promise.all(targets.map(async (name) => [name, (await exec("git",
                ["--no-optional-locks", "-C", workspace, "rev-parse", "--verify", `refs/heads/${name}^{commit}`],
                { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096 })).stdout.trim()] as const)));
              const current = readAgentGitPreferences(writableManager.getEntries() as unknown as SessionEntry[]);
              const proposed = params.checks === undefined ? current?.checks ?? [] : params.checks;
              const checked = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual", checks: proposed });
              const choice = await ui.gitPreferences({ kind: "preferences", featureBranch: feature, targets, checks: checked.checks ?? [], current }, signal);
              if (!choice || signal?.aborted) return { content: [{ type: "text" as const, text: "Git preference choice cancelled; nothing changed." }], details: { saved: false } };
              if (!samePath(manager.getCwd(), sessionCwd) || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd)
                || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))
                || (await featureBranch(workspace)) !== feature || !(await registeredTargets(workspace, feature)).includes(choice.targetBranch)
                || !targetTips.has(choice.targetBranch) || (await exec("git", ["--no-optional-locks", "-C", workspace,
                  "rev-parse", "--verify", `refs/heads/${choice.targetBranch}^{commit}`],
                  { encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096 })).stdout.trim() !== targetTips.get(choice.targetBranch)) return failure("Checkout or target changed; preferences not saved");
              // Revalidate even if a custom UI transport is supplied by another runtime.
              const { resolveAgentGitPreferenceChoice } = await import("./agent-git-preferences");
              let lastIndex = -1;
              const indexes = choice.checks.map((check) => {
                const index = (checked.checks ?? []).findIndex((item, i) => i > lastIndex && JSON.stringify(item) === JSON.stringify(check));
                lastIndex = index;
                return index;
              });
              const validated = resolveAgentGitPreferenceChoice({ targetBranch: choice.targetBranch, method: choice.method,
                checkIndexes: indexes, cleanup: choice.cleanup, mode: choice.mode }, targets, checked.checks ?? []);
              if (!validated || JSON.stringify(validated) !== JSON.stringify(choice)) return failure("Invalid Git preference choice");
              await guard("settings");
              appendAgentGitPreferences(writableManager, validated);
              return { content: [{ type: "text" as const, text: `Saved per-chat preferences: ${validated.targetBranch}, ${validated.method}, ${validated.checks.length} checks, ${validated.mode} mode, ${validated.cleanup} cleanup. No checks, Git mutation, or operation approval occurred.` }], details: { preferences: validated } };
            }
            if (params.operation === "review") {
              const targetBranch = params.targetBranch ?? selectedState?.resolved.session.values.targetBranch;
              if (!validLocalBranchName(targetBranch) || params.paths || params.message || params.checks) return failure("Choose a local target branch to review, or configure the explicitly selected project's target");
              const selection: GitReviewSelection = params.commitOids?.length
                ? { kind: "commits", commitOids: params.commitOids }
                : { kind: "merge" };
              const compare = async (repository: GitReviewRepository, feature: string) => {
                const review = await reviewGitBranches(repository, feature, targetBranch);
                return { review, diff: await getGitReviewDiff(repository, review, selection) };
              };
              const { review, diff } = selected
                ? await withGitProjectReview(selected, (repository) => compare(repository, selected.branch))
                : await compare(workspace, await featureBranch(workspace));
              const candidate = { kind: "review" as const, featureCwd: workspace, review, selection, diff };
              const action = await beginGitAction(gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)), "agent", snapshotGitActionCandidate(candidate));
              try {
                await action.update("awaiting-decision");
                const viewed = await ui.gitAction({ ...candidate, actionId: action.record.id }, signal);
                if (selected && !signal?.aborted) {
                  try { await revalidateGitProjectResources(selected); }
                  catch (cause) {
                    await action.update("blocked", { decision: viewed ? "reviewed" : "dismissed", reason: "The comparison was read-only; its captured repository/workspace changed while displayed." });
                    throw cause;
                  }
                }
                await action.update(signal?.aborted ? "cancelled" : viewed ? "succeeded" : "declined", { decision: signal?.aborted ? "cancelled" : viewed ? "reviewed" : "dismissed" });
                return { content: [{ type: "text" as const, text: viewed
                  ? `User reviewed ${selection.kind === "merge" ? "the whole proposed merge" : "the selected contiguous commits"}. No integration was approved or executed. Target ${review.targetBranch} ${review.targetOid}; feature ${review.featureBranch} ${review.featureOid}.`
                  : "Git comparison dismissed. No operation was approved or executed." }],
                  details: { viewed, selection, targetOid: review.targetOid, featureOid: review.featureOid, actionId: action.record.id,
                    ...(selected ? { resources: gitProjectResourceSummary(selected) } : {}) } };
              } catch (cause) { await failGitAction(action, false, signal, cause); throw cause; }
              finally { action.release(); }
            }
            if (params.operation === "integrate") {
              preApprovalStage("checks");
              const saved = readAgentGitPreferences((writableManager?.getEntries() ?? ctx.sessionManager.getEntries?.() ?? []) as SessionEntry[]);
              const task = state?.task.kind === "managed" ? state.task.settings : undefined;
              const capturedTask = JSON.stringify(state?.task);
              if (task && ((params.targetBranch !== undefined && params.targetBranch !== task.targetBranch)
                || (params.checks !== undefined && JSON.stringify(params.checks) !== JSON.stringify(task.checks)))) {
                return failure("Requested target/checks differ from the captured task. Compare and apply settings in Workflow first.");
              }
              const targetBranch = task ? task.targetBranch : params.targetBranch ?? saved?.targetBranch;
              const requestedChecks = task ? task.checks : params.checks ?? saved?.checks;
              if (!validLocalBranchName(targetBranch) || !Array.isArray(requestedChecks) || !requestedChecks.length || params.paths || params.message || params.commitOids) {
                return failure("Choose a local target and at least one ordered verification check");
              }
              // Validate an ephemeral policy with the same allowlist and digest used by receipts and plans.
              const policy = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual",
                integration: { targetBranch, method: "merge" }, checks: requestedChecks });
              const checks = policy.checks as GitWorkflowCheck[];
              preApprovalStage("caller");
              const manager = ctx.sessionManager;
              const sessionId = manager.getSessionId();
              if (!sessionId || !samePath(manager.getCwd(), sessionCwd) || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd) ||
                  !samePath(sessionCwd, await realpath(sessionCwd))) return failure("Session checkout changed");
              preApprovalStage("workspace");
              const branch = await featureBranch(workspace);
              preApprovalStage("target");
              const target = await targetCheckout(workspace, targetBranch);
              const trusted = () => {
                preApprovalStage("trust");
                return getProjectTrustStatus(workspace, agentDir).trusted && getProjectTrustStatus(target, agentDir).trusted;
              };
              const idle = () => {
                preApprovalStage("busy");
                return !hasBusyRpcSessionForCwd(workspace, sessionId) && !hasBusyRpcSessionForCwd(target, sessionId);
              };
              const guardedPolicy = async () => {
                preApprovalStage("permission");
                const current = await guard("integration");
                await assertManagedGitWorkspace(current, workspace);
                if (JSON.stringify(current.task) !== capturedTask) {
                  throw new ManagedGitAccessError("Captured integration settings changed; request fresh verification and approval before integration.");
                }
                return policy;
              };
              const valid = async () => {
                await guardedPolicy();
                if (signal?.aborted || !trusted() || !idle()) return false;
                preApprovalStage("workspace");
                if (!samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) return false;
                preApprovalStage("target");
                if (!samePath(target, await targetCheckout(workspace, targetBranch))) return false;
                preApprovalStage("caller");
                if (!samePath(manager.getCwd(), sessionCwd) || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd)) return false;
                preApprovalStage("workspace");
                return (await featureBranch(workspace)) === branch && !signal?.aborted;
              };
              if (!await valid()) return failure("Trust both registered checkouts and stop other sessions before integration");
              preApprovalStage("journal");
              const sink = gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data));
              const checkCandidate = { kind: "checks" as const, featureCwd: workspace, targetCwd: target, targetBranch, featureBranch: branch, checks };
              const checkAction = await beginGitAction(sink, "agent", snapshotGitActionCandidate(checkCandidate));
              const receipts = [];
              let checksStarted = false;
              try {
                await checkAction.update("awaiting-decision");
                // Clear before invoking the transport: even a synchronous throw may
                // follow a displayed request. Later revalidation must not re-arm it.
                preApprovalPhase = undefined;
                if (!await ui.gitAction({ ...checkCandidate, actionId: checkAction.record.id }, signal) || signal?.aborted) {
                  await checkAction.update(signal?.aborted ? "cancelled" : "declined", { decision: signal?.aborted ? "cancelled" : "declined" });
                  return { content: [{ type: "text" as const, text: "Verification declined; no checks or integration executed." }], details: { approved: false, actionId: checkAction.record.id } };
                }
                const review = await reviewGitBranches(workspace, branch, targetBranch);
                // No gate while the browser is answering. Reserve both checkouts only during execution.
                const releaseChecks = acquireGitCheckoutGate([workspace, target]);
                try {
                  if (!await valid()) throw new ManagedGitAccessError("Checkout became busy or untrusted before verification");
                  await checkAction.update("executing", { decision: "approved" });
                  for (let i = 0; i < checks.length; i++) {
                    if (!await valid()) throw new ManagedGitAccessError("Verification cancelled or checkout changed");
                    const watcher = await watchManagedGitAccess(() => guard("checks"), signal);
                    try {
                      checksStarted = true;
                      receipts.push(await runGitVerification({ sessionId, cwd: workspace, agentDir, review, checkIndex: i,
                        getPolicy: guardedPolicy, isTrusted: trusted, signal: watcher.signal }));
                    } finally { watcher.dispose(); }
                  }
                  await finishGitAction(checkAction, { status: "verified" });
                } finally { releaseChecks(); }
              } catch (cause) {
                if (checksStarted) {
                  try { await checkAction.update(signal?.aborted ? "cancelled" : "failed", { reason: "Verification stopped or failed. Commands may have run; no integration was authorized by this decision." }); } catch { /* uncertain state stays visible */ }
                } else await failGitAction(checkAction, false, signal, cause);
                throw cause;
              } finally { checkAction.release(); }
              if (!await valid()) return failure("Checkout became busy or untrusted after verification");
              const plan = await prepareIntegration({ sessionId, cwd: workspace, agentDir, featureBranch: branch,
                receiptIds: receipts.map((r) => r.id), getPolicy: guardedPolicy });
              const mergeCandidate = { kind: "integration" as const, featureCwd: workspace, targetCwd: target, plan, receipts };
              const mergeAction = await beginGitAction(sink, "agent", snapshotGitActionCandidate(mergeCandidate));
              let applying = false;
              try {
                await mergeAction.update("awaiting-decision");
                if (!await ui.gitAction({ ...mergeCandidate, actionId: mergeAction.record.id }, signal) || signal?.aborted) {
                  await mergeAction.update(signal?.aborted ? "cancelled" : "declined", { decision: signal?.aborted ? "cancelled" : "declined" });
                  return { content: [{ type: "text" as const, text: "Exact merge declined; no integration executed." }], details: { approved: false, actionId: mergeAction.record.id } };
                }
                const releaseMerge = acquireGitCheckoutGate([workspace, target]);
                try {
                  if (!await valid()) throw new ManagedGitAccessError("Checkout became busy or untrusted before merge");
                  await mergeAction.update("executing", { decision: "approved" });
                  const result = await confirmIntegration(plan.planId, plan.planId, sessionId, async () => {
                    await mergeAction.update("executing", { intended: { mergeOid: plan.mergeOid, targetBranch } });
                    if (!await valid()) throw new ManagedGitAccessError("Integration cancelled or checkout changed before apply");
                    applying = true;
                  });
                  await finishGitAction(mergeAction, result, result.status === "partial-state");
                  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { ...result, actionId: mergeAction.record.id } };
                } finally { releaseMerge(); }
              } catch (cause) {
                await failGitAction(mergeAction, applying, signal, cause);
                if (applying && !(cause instanceof GitActionRecordingError)) throw new GitActionApplyError(mergeAction.record.id, mergeAction.record.intended);
                throw cause;
              }
              finally { mergeAction.release(); }
            }
            if (params.operation !== "commit" || params.checks || !params.paths?.length || typeof params.message !== "string" || !params.message.trim() || params.targetBranch || params.commitOids) {
              return failure("Select complete changed paths and provide an exact commit message");
            }
            return await requestWorkflowCommit({ cwd: workspace, paths: params.paths, message: params.message, signal,
              sink: gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)),
              ask: (candidate, abort) => ui.gitAction!(candidate, abort), beforeApply: async () => {
                await assertManagedGitWorkspace(await guard("commit"), workspace);
                if (hasBusyRpcSessionForCwd(workspace, ctx.sessionManager.getSessionId())) throw new ManagedGitAccessError("Stop other sessions in the selected checkout before committing.");
                if (signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) throw new ManagedGitAccessError("Commit cancelled or workspace changed");
              } });
          } catch (cause) {
            const recorded = gitActionFailureResult(cause);
            if (recorded) return recorded;
            if (cause instanceof GitProjectResourceError) return { ...failure(cause.message), details: { error: cause.message, code: cause.code } };
            if (cause instanceof ManagedGitAccessError || cause instanceof GitCheckoutBusyError || cause instanceof GitCommitOperationError) return failure(cause.message);
            // Never send raw Git stderr, argv, trust contents or arbitrary errors.
            if (preApprovalPhase) {
              const message = `${INTEGRATION_PREAPPROVAL_DIAGNOSTICS[preApprovalPhase]} Check approval was not requested; no checks or merge were executed.`;
              return { ...failure(message), details: { error: message, code: "integration-preapproval-failed", phase: preApprovalPhase,
                checkApprovalRequested: false, checksStarted: false, integrationStarted: false } };
            }
            return failure("Git candidate unavailable or stale; inspect the checkout and request a fresh review");
          }
        },
      });
    },
  };
}
