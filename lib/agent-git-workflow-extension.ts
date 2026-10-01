import { execFile } from "node:child_process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension, SessionManager } from "@earendil-works/pi-coding-agent";
import { appendAgentGitPreferences, readAgentGitPreferences, type AgentGitPreferences } from "./agent-git-preferences";
import type { SessionEntry } from "./types";
import { getGitReviewDiff, reviewGitBranches, type GitReviewSelection, type GitReviewRepository } from "./git-review";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, managedGitSessionFacts, ManagedGitAccessError, watchManagedGitAccess, type ManagedGitStage } from "./git-workflow-access";
import { managedGitPermissions, selectedProjectCommitEligibility, AUTOMATIC_WORKFLOW_UNAVAILABLE, PROJECT_GIT_WRITES_UNAVAILABLE } from "./git-workflow-permissions";
import { readProjectAuthorization, type ProjectAuthorizationOwner } from "./git-project-authorization";
import { loadGitProjectSettings } from "./git-project-settings";
import { readManagedSessionGitWorkflow } from "./git-workflow-session";
import { selectGitProjectResources, revalidateGitProjectResources, withGitProjectReview, gitProjectResourceSummary, GitProjectResourceError } from "./git-project-resources";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import { getGitTaskBindingStatus } from "./git-workflow-binding";
import { requestWorkflowCommit } from "./git-workflow-commit";
import { beginGitAction, failGitAction, finishGitAction, gitActionFailureResult, gitActionSink, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError } from "./git-action-controller";
import { gitExecEnv } from "./git-exec";
import { acquireGitCheckoutGate, GitCheckoutBusyError } from "./git-checkout-gate";
import { GitCommitOperationError } from "./git-commit";
import { prepareIntegration, confirmIntegration } from "./git-integration";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent, type GitOperationReservation } from "./git-operation-admission";
import { runGitVerification } from "./git-verification";
import { validateGitWorkflowPolicy, type GitWorkflowCheck, validLocalBranchName } from "./git-workflow-policy";
import { getProjectTrustStatus } from "./project-trust";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
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
  admission: "Integration Git-resource admission could not complete. Inspect unfinished checks, integration and durable action history for this repository.",
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
        name: "git_workflow_propose_settings",
        label: "Propose Workflow settings",
        description: "Propose field-by-field Global, Project or Session Workflow settings for human review in chat. This NEVER saves settings, applies a task, or starts Git work. For Project and Chat×Project give repositoryPath: an allowed physical registered checkout root. Omit it for unqualified Session or Global. changes is 1–10 distinct fields; omit value to reset a field to inherit (null, false and [] are explicit values). The human alone can click Apply or Dismiss; Session Apply waits until this chat is idle. Do not call another tool to apply a proposal.",
        executionMode: "sequential",
        parameters: Type.Object({
          scope: Type.Unsafe<"global" | "project" | "session">({ type: "string", enum: ["global", "project", "session"] }),
          repositoryPath: Type.Optional(Type.String({ maxLength: 4096 })),
          changes: Type.Array(Type.Object({ field: Type.String(), value: Type.Optional(Type.Unknown()) }), { minItems: 1, maxItems: 10 }),
        }),
        async execute(_id, params, signal, _update, ctx) {
          try {
            if (signal?.aborted || !samePath(ctx.cwd, sessionCwd)) throw new Error("Session changed or proposal cancelled");
            if (readManagedSessionGitWorkflow(ctx.sessionManager.getEntries() as SessionEntry[])?.optedOut) throw new Error("Git workflow off for this chat");
            const { proposeGitSettings } = await import("./git-settings-proposals");
            const proposalId = await proposeGitSettings(ctx.sessionManager.getSessionId(), params);
            return { content: [{ type: "text" as const, text: `Workflow settings proposal ${proposalId} is available in this chat for human Apply or Dismiss. Nothing was saved or applied to the task.` }],
              details: { proposalId } };
          } catch {
            return { content: [{ type: "text" as const, text: "Workflow settings proposal unavailable. Check scope, fields, persisted chat and physical project selection; no settings were saved." }], isError: true, details: { proposal: false } };
          }
        },
      });
      pi.registerTool({
        name: "git_workflow",
        label: "Git Workflow",
        description: "Inspect captured settings with status; configure all scopes in the Workflow panel. Review local candidates, request an exact commit (alias of git_commit operation commit), or integrate using the captured local target/checks. Integration asks for check execution and exact-state merge approval. Explicit-project commit requires canonical repositoryPath and physical registered checkoutPath. Default confirmation is Ask. Only request confirmation:none if applicable repository/user instructions permit skipping this candidate prompt; it requires selected policy confirmation:none and fresh effective saved Allow at every gate. A grant never overrides stricter instructions. Other explicit-project mutations remain unavailable. Selection never moves the chat or retargets shell/file tools; never substitute a shell for a denied action.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"status" | "preferences" | "review" | "commit" | "integrate">({ type: "string", enum: ["status", "preferences", "review", "commit", "integrate"] }),
          repositoryPath: Type.Optional(Type.String({ description: "Absolute physical canonical repository checkout root for explicit status/review/commit; never chat relocation or mutation authority", maxLength: 4096 })),
          checkoutPath: Type.Optional(Type.String({ description: "Physical registered checkout root in canonical repositoryPath; required for selected-project commit", maxLength: 4096 })),
          workspaceBranch: Type.Optional(Type.String({ description: "Checked-out local branch within the explicitly selected repository, or this chat's repository when repositoryPath is omitted" })),
          targetBranch: Type.Optional(Type.String({ description: "Existing local target branch for review" })),
          commitOids: Type.Optional(Type.Array(Type.String(), { description: "Optional ordered consecutive commits to compare instead of the whole proposed merge" })),
          paths: Type.Optional(Type.Array(Type.String(), { description: "Complete changed file paths for commit" })),
          message: Type.Optional(Type.String({ description: "Exact commit message (included in an Ask candidate or saved-Allow no-prompt action)" })),
          confirmation: Type.Optional(Type.Unsafe<"ask" | "none">({ type: "string", enum: ["ask", "none"], description: "Selected-project commit only. Default ask. Request none only if stricter repository/user instructions permit; requires live saved Allow and selected commitConfirmation:none." })),
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
            // A selected operation must read the same live transcript as its
            // durable action anchor and authorization owner, not a second
            // injected manager that might represent another chat.
            const selectedEntries = () => (ctx.sessionManager?.getEntries?.() ?? []) as SessionEntry[];
            if (readManagedSessionGitWorkflow(selectedEntries())?.optedOut) return failure("Pi Web Git workflow is off for this chat. Turn it on in Workflow to use managed Git tools.");
            const guard = (stage: ManagedGitStage) => assertManagedGitAction(sessionCwd, entries(), stage, "agent", agentDir, pi.getActiveTools?.());
            if (params.checkoutPath !== undefined && params.repositoryPath === undefined) return failure("checkoutPath requires canonical repositoryPath");
            if (params.repositoryPath !== undefined && !["status", "review", "commit"].includes(params.operation)) return failure(PROJECT_GIT_WRITES_UNAVAILABLE);
            if (params.operation === "commit" && params.repositoryPath !== undefined && process.platform !== "linux") {
              return failure("Selected-project commits currently require Linux physical-resource and durable-admission verification");
            }
            if (params.operation === "commit" && params.repositoryPath !== undefined && params.checkoutPath === undefined) return failure("Selected-project commits require an explicit canonical repository and physical checkout path");
            // The journal, authorization and operation ledger must use one private
            // root; the journal currently binds itself to the SDK agent dir.
            if (params.operation === "commit" && params.repositoryPath !== undefined && !samePath(agentDir, getAgentDir())) {
              return failure("Selected-project commit history and authorization roots differ; no commit was attempted");
            }
            // Tool schemas describe future scoped operations, but cannot authorize
            // them. Refuse unrecognized runtime arguments instead of ignoring them.
            const allowed = new Set(["operation", "repositoryPath", "checkoutPath", "workspaceBranch", "targetBranch", "commitOids", "paths", "message", "confirmation", "checks"]);
            if (Object.keys(params).some((key) => !allowed.has(key)) || params.confirmation !== undefined &&
              (params.operation !== "commit" || params.repositoryPath === undefined || !["ask", "none"].includes(params.confirmation))) {
              return failure("Unsupported Git workflow arguments");
            }
            const selected = params.repositoryPath !== undefined ? await selectGitProjectResources(params.repositoryPath, params.workspaceBranch, params.checkoutPath) : undefined;
            const selectedState = selected ? await loadGitProjectSettings(selected, entries(), agentDir, ctx.sessionManager.getSessionId()) : undefined;
            if (params.operation === "status") {
              if (params.targetBranch !== undefined || params.commitOids !== undefined || params.paths !== undefined || params.message !== undefined || params.checks !== undefined || params.confirmation !== undefined) return failure("Status accepts only resource selectors");
              if (selected && selectedState) {
                const summary = { selection: gitProjectResourceSummary(selected), saved: selectedState.resolved.session,
                  paused: selectedState.paused, sessionScope: "project", legacySessionSettings: selectedState.legacySessionSettings,
                  permissions: managedGitPermissions(selectedState, managedGitSessionFacts(entries(), pi.getActiveTools?.())),
                  selectedCommitEligibility: selectedProjectCommitEligibility(selectedState, managedGitSessionFacts(entries(), pi.getActiveTools?.()), "agent"),
                  capabilities: { status: true, review: process.platform === "linux", mutations: process.platform === "linux" ? { commit: "ask-or-saved-allow-none" } : false }, settingsHome: "Workflow",
                  note: "Selected-project commits require live policy, ordinary caller, physical resource, authorization and admission checks; none additionally requires saved Allow and compatible instructions." };
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
            const skipCommitPrompt = !!selected && params.operation === "commit" && params.confirmation === "none";
            if ((!ctx.hasUI || !ui?.gitAction) && !skipCommitPrompt) return failure("Git workflow review/commit requires an interactive Pi Web session");
            preApprovalStage("permission");
            const state = params.operation === "review" || selected && params.operation === "commit" ? null
              : await guard(params.operation === "commit" ? "commit" : params.operation === "integrate" ? "integration" : "settings");
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
                const viewed = await ui.gitAction!({ ...candidate, actionId: action.record.id }, signal);
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
              const denial = (action: "checks" | "integration") => assertManagedGitProjectDenial(workspace, {
                sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile()!, sessionCwd,
              }, action, agentDir);
              // The selected source can be another registered worktree, but it
              // must remain in this persisted chat's canonical repository.
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
              await denial("checks");
              await denial("integration");
              const trusted = () => {
                preApprovalStage("trust");
                return getProjectTrustStatus(workspace, agentDir).trusted && getProjectTrustStatus(target, agentDir).trusted;
              };
              const guardedPolicy = async () => {
                preApprovalStage("permission");
                const current = await guard("integration");
                await denial("integration");
                await assertManagedGitWorkspace(current, workspace);
                if (JSON.stringify(current.task) !== capturedTask) {
                  throw new ManagedGitAccessError("Captured integration settings changed; request fresh verification and approval before integration.");
                }
                return policy;
              };
              const valid = async () => {
                await guardedPolicy();
                if (signal?.aborted || !trusted()) return false;
                preApprovalStage("workspace");
                if (!samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) return false;
                preApprovalStage("target");
                if (!samePath(target, await targetCheckout(workspace, targetBranch))) return false;
                preApprovalStage("caller");
                if (!samePath(manager.getCwd(), sessionCwd) || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd)) return false;
                preApprovalStage("workspace");
                return (await featureBranch(workspace)) === branch && !signal?.aborted;
              };
              if (!trusted()) return failure("Trust both registered checkouts before integration");
              if (!await valid()) return failure("Checkout selection or authorization changed before integration");
              preApprovalStage("admission");
              const resources = await selectGitProjectResources(workspace);
              await assertGitOperationAdmission(resources, agentDir);
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
                if (!await ui.gitAction!({ ...checkCandidate, actionId: checkAction.record.id }, signal) || signal?.aborted) {
                  await checkAction.update(signal?.aborted ? "cancelled" : "declined", { decision: signal?.aborted ? "cancelled" : "declined" });
                  return { content: [{ type: "text" as const, text: "Verification declined; no checks or integration executed." }], details: { approved: false, actionId: checkAction.record.id } };
                }
                const review = await reviewGitBranches(workspace, branch, targetBranch);
                // No gate while the browser is answering. Reserve both checkouts only during execution.
                const releaseChecks = acquireGitCheckoutGate([workspace, target]);
                try {
                  if (!await valid()) throw new ManagedGitAccessError("Checkout selection or trust changed before verification");
                  await checkAction.update("executing", { decision: "approved" });
                  for (let i = 0; i < checks.length; i++) {
                    if (!await valid()) throw new ManagedGitAccessError("Verification cancelled or checkout changed");
                    const watcher = await watchManagedGitAccess(async () => { await guard("checks"); await denial("checks"); }, signal);
                    try {
                      checksStarted = true;
                      receipts.push(await runGitVerification({ sessionId, cwd: workspace, agentDir, review, checkIndex: i,
                        actionId: checkAction.record.id, getPolicy: async () => { await denial("checks"); return guardedPolicy(); },
                        isTrusted: trusted, signal: watcher.signal }));
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
              if (!await valid()) return failure("Checkout selection or trust changed after verification");
              const plan = await prepareIntegration({ sessionId, cwd: workspace, agentDir, featureBranch: branch,
                receiptIds: receipts.map((r) => r.id), getPolicy: guardedPolicy });
              const mergeCandidate = { kind: "integration" as const, featureCwd: workspace, targetCwd: target, plan, receipts };
              const mergeAction = await beginGitAction(sink, "agent", snapshotGitActionCandidate(mergeCandidate));
              let applying = false;
              let reservation: GitOperationReservation | undefined;
              try {
                await mergeAction.update("awaiting-decision");
                if (!await ui.gitAction!({ ...mergeCandidate, actionId: mergeAction.record.id }, signal) || signal?.aborted) {
                  await mergeAction.update(signal?.aborted ? "cancelled" : "declined", { decision: signal?.aborted ? "cancelled" : "declined" });
                  return { content: [{ type: "text" as const, text: "Exact merge declined; no integration executed." }], details: { approved: false, actionId: mergeAction.record.id } };
                }
                const releaseMerge = acquireGitCheckoutGate([workspace, target]);
                try {
                  if (!await valid()) throw new ManagedGitAccessError("Checkout became busy or untrusted before merge");
                  const result = await confirmIntegration(plan.planId, plan.planId, sessionId, async () => {
                    await mergeAction.update("executing", { decision: "approved" });
                    await mergeAction.update("executing", { intended: { mergeOid: plan.mergeOid, targetBranch } });
                    if (!await valid()) throw new ManagedGitAccessError("Integration cancelled or checkout changed before apply");
                    reservation = await beginSupervisedGitOperationIntent(resources, mergeAction.record.id, "integration", agentDir);
                    applying = true;
                    return reservation;
                  });
                  await finishGitAction(mergeAction, result, result.status === "partial-state");
                  let recoveryRequired = false;
                  if (result.status === "integrated") {
                    try { if (!reservation) throw new Error("missing operation reservation"); reservation.resolve(); }
                    catch { recoveryRequired = true; }
                  }
                  const details = { ...result, actionId: mergeAction.record.id,
                    ...(recoveryRequired ? { recoveryRequired: true, recoveryWarning: "Git operation admission could not be finalized; inspect the action and checkout before any new Git work." } : {}) };
                  return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
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
            const manager = ctx.sessionManager;
            const selectedOwner = selected && manager?.getSessionId?.() && manager?.getSessionFile?.() && writableManager?.isPersisted?.() !== false
              ? { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile()!, sessionCwd: sessionCwd } satisfies ProjectAuthorizationOwner : undefined;
            if (selected && (!selectedOwner || !samePath(manager.getCwd(), sessionCwd) || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd))) {
              return failure("A persisted ordinary chat with a stable checkout is required for selected-project commits");
            }
            const beforeApply = async () => {
              if (selected) {
                if (!selectedOwner || manager.getSessionId() !== selectedOwner.sessionId || manager.getSessionFile() !== selectedOwner.sessionFile
                  || writableManager?.isPersisted?.() === false || !samePath(manager.getCwd(), sessionCwd) || !samePath(manager.getHeader()?.cwd ?? "", sessionCwd)) {
                  throw new ManagedGitAccessError("Selected-project commit caller changed; request a new candidate.");
                }
                await revalidateGitProjectResources(selected);
                // Captured task and legacy consent from the calling repository are
                // not authority over another project. Their hard restrictions do
                // remain restrictions; an old legacy session never gains this path.
                const caller = await loadGitWorkflowSettings(sessionCwd, selectedEntries(), agentDir, selectedOwner.sessionId);
                if (caller.task.kind === "legacy" || caller.task.kind === "managed" &&
                  (!caller.task.settings.enabled || caller.task.settings.commits !== "ask")) {
                  throw new ManagedGitAccessError("Calling chat's captured task or legacy policy does not permit a selected-project agent commit.");
                }
                const live = await loadGitProjectSettings(selected, selectedEntries(), agentDir, selectedOwner.sessionId);
                const eligible = selectedProjectCommitEligibility(live, managedGitSessionFacts(selectedEntries(), pi.getActiveTools?.()), "agent");
                if (eligible.kind !== "confirmation-required") throw new ManagedGitAccessError(eligible.reason);
                const authorization = await readProjectAuthorization(selected, selectedOwner, agentDir);
                if (authorization.actions.commit.effective === "deny") throw new ManagedGitAccessError("Selected-project commit authorization is denied or stale.");
                if (skipCommitPrompt && (authorization.actions.commit.effective !== "allow" ||
                  live.resolved.session.values.commitConfirmation !== "none")) {
                  throw new ManagedGitAccessError("No-prompt commit requires live selected confirmation:none and an effective saved Allow.");
                }
                // Tool instructions leave a stricter project's/user's Ask rule
                // with the agent: it must omit confirmation:none in that case.
                // Never infer no-prompt consent from settings or old chat policy.
              } else {
                await assertManagedGitWorkspace(await guard("commit"), workspace);
                await assertManagedGitProjectDenial(workspace, {
                  sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile()!, sessionCwd,
                }, "commit", agentDir);
                if (signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) throw new ManagedGitAccessError("Commit cancelled or workspace changed");
              }
              if (signal?.aborted) throw new ManagedGitAccessError("Commit cancelled");
            };
            await beforeApply();
            return await requestWorkflowCommit({ cwd: workspace, paths: params.paths, message: params.message, signal,
              ...(selected ? { selected, agentDir, owner: selectedOwner } : {}), skipApproval: skipCommitPrompt,
              sink: gitActionSink(manager, (type, data) => pi.appendEntry(type, data)),
              ask: (candidate, abort) => ui.gitAction!(candidate, abort), beforeApply });
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
