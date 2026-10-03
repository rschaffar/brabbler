import { execFile } from "node:child_process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionContext, InlineExtension, SessionManager } from "@earendil-works/pi-coding-agent";
import { appendAgentGitPreferences, readAgentGitPreferences, type AgentGitPreferences } from "./agent-git-preferences";
import type { SessionEntry } from "./types";
import { getGitReviewDiff, reviewGitBranches, type GitReviewSelection, type GitReviewRepository } from "./git-review";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, managedGitSessionFacts, ManagedGitAccessError, watchManagedGitAccess, type ManagedGitStage } from "./git-workflow-access";
import { managedGitPermissions, selectedProjectCommitEligibility, AUTOMATIC_WORKFLOW_UNAVAILABLE, PROJECT_GIT_WRITES_UNAVAILABLE } from "./git-workflow-permissions";
import { agentGitCommitAuthorization } from "./git-agent-commit-authorization";
import { loadGitProjectSettings } from "./git-project-settings";
import { readManagedSessionGitWorkflow } from "./git-workflow-session";
import { selectGitProjectResources, revalidateGitProjectResources, withGitProjectReview, gitProjectResourceSummary, GitProjectResourceError } from "./git-project-resources";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import { getGitTaskBindingStatus } from "./git-workflow-binding";
import { requestWorkflowCommit, workflowCommitFailureResult } from "./git-workflow-commit";
import { createGitAgentActionArtifactReader, GIT_AGENT_PATCH_CHUNK_BYTES, type GitAgentActionArtifactResult } from "./git-agent-action-artifact";
import { beginGitAction, failGitAction, finishGitAction, gitActionFailureResult, gitActionSink, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError } from "./git-action-controller";
import { gitExecEnv } from "./git-exec";
import { acquireGitCheckoutGate, GitCheckoutBusyError } from "./git-checkout-gate";
import { GitCommitOperationError } from "./git-commit";
import { prepareIntegration, confirmIntegration, prepareFastForwardIntegration, confirmFastForwardIntegration, GitIntegrationTargetMovedError } from "./git-integration";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent, GitOperationRecoveryError, type GitOperationReservation } from "./git-operation-admission";
import { runGitVerification } from "./git-verification";
import { validateGitWorkflowPolicy, type GitWorkflowCheck, validLocalBranchName } from "./git-workflow-policy";
import { getProjectTrustStatus } from "./project-trust";
import { getAllowedFileRoots, getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { samePath, toNativePath } from "./paths";
import { selectGitWorkspace } from "./git-workspace-selector";
import type { GitActionCandidate } from "./types";
import type { createGitSelectedOperationRuntime } from "./git-selected-operation-runtime";
import type { SelectedControllerOperation, SelectedControllerRequests } from "./git-selected-operation-controller";
import { GitCommitVerificationError } from "./git-commit-verification";

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
  writableManager?: Pick<SessionManager, "getEntries" | "appendCustomEntry" | "isPersisted">,
  trustedRuntime?: { readSelectionRevisionSync(): string }): InlineExtension {
  return {
    name: "pi-web-agent-git-workflow",
    hidden: true,
    factory: (pi) => {
      // One process-owned controller generation per physical persisted caller.
      // Nothing is reconstructed from action/history IDs after reload.
      type SelectedRuntime = { runtime: ReturnType<typeof createGitSelectedOperationRuntime>;
        ctx: ExtensionContext; signal?: AbortSignal; busy: boolean };
      const selectedRuntimes = new Map<string, SelectedRuntime>();
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
        description: "Inspect captured settings with status; configure all scopes in the Workflow panel. Capture a read-only local comparison as concise metadata (no human acknowledgement). Use artifact with actionId, UTF-8 byte offset and optional limitBytes (4–24576) for on-demand captured diffs: ≤24KiB chunks with nextOffset, whole-patch SHA-256, binary/end/completePatch flags; no UI or live Git. Other results stay metadata-only. Request an exact commit (alias of git_commit operation commit), or integrate using the captured local target/checks. Integration asks for check execution and exact-state merge approval. Explicit-project commit requires canonical repositoryPath and physical registered checkoutPath. Default confirmation is Ask. Only request confirmation:none when compatible with all applicable repository/user instructions; it requires fresh untouched persisted ordinary creation provenance, an enabled managed Ask caller task, live selected policy confirmation:none and fresh effective saved Allow at capture and before native CAS. It also works for the server-resolved chat checkout/workspaceBranch without UI. Old, legacy, copied or recaptured callers must use Ask; saved Allow alone never skips Ask. A grant never overrides stricter instructions. Selected workspace/prepare/verify/integrate/cleanup/reconcile dispatch before captured-task requirements and use the selected project's live saved policy. Mandatory native adapters that are unavailable refuse explicitly (currently workspace, check authority, cleanup and reconciliation). workspaceMode:current returns metadata only and starts nothing. Prepare requires canonical Project main and its real target checkout. Selected integration uses saved checks, never inline checks. Pass revisionDependency only after receiving a completed preparation/verification result in a separate tool turn; batching/prequeueing follow-ons is refused. No automatic next stage, local delivery, handoff, or chat move. Selection never moves the chat or retargets shell/file tools; never substitute a shell for a denied action.",
        executionMode: "sequential",
        parameters: Type.Object({
          operation: Type.Unsafe<"status" | "preferences" | "review" | "commit" | "integrate" | "artifact" | "workspace" | "prepare" | "verify" | "cleanup" | "reconcile">({ type: "string", enum: ["status", "preferences", "review", "commit", "integrate", "artifact", "workspace", "prepare", "verify", "cleanup", "reconcile"] }),
          actionId: Type.Optional(Type.String({ description: "Artifact only: captured action referenced by this persisted session's raw history" })),
          offset: Type.Optional(Type.Integer({ description: "Artifact only: required UTF-8 byte offset, starting at 0; continue with nextOffset", minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
          limitBytes: Type.Optional(Type.Integer({ description: "Artifact only: optional UTF-8 chunk byte limit, default 24576", minimum: 4, maximum: GIT_AGENT_PATCH_CHUNK_BYTES })),
          repositoryPath: Type.Optional(Type.String({ description: "Absolute physical canonical repository checkout root for explicit status/review/commit; never chat relocation or mutation authority", maxLength: 4096 })),
          checkoutPath: Type.Optional(Type.String({ description: "Physical registered checkout root in canonical repositoryPath; required for selected-project commit", maxLength: 4096 })),
          workspaceBranch: Type.Optional(Type.String({ description: "Checked-out local branch within the explicitly selected repository, or this chat's repository when repositoryPath is omitted" })),
          targetBranch: Type.Optional(Type.String({ description: "Existing local target branch for review" })),
          commitOids: Type.Optional(Type.Array(Type.String(), { description: "Optional ordered consecutive commits to compare instead of the whole proposed merge" })),
          paths: Type.Optional(Type.Array(Type.String(), { description: "Explicit changed paths for commit; staged mode selects only those index entries" })),
          mode: Type.Optional(Type.Unsafe<"whole-file" | "staged">({ type: "string", enum: ["whole-file", "staged"], description: "Commit source: whole files by default, or only explicitly selected staged index entries" })),
          message: Type.Optional(Type.String({ description: "Exact commit message (included in an Ask candidate or saved-Allow no-prompt action)" })),
          confirmation: Type.Optional(Type.Unsafe<"ask" | "none">({ type: "string", enum: ["ask", "none"], description: "Commit only. Default ask. Request none only when compatible with stricter instructions; requires fresh untouched persisted ordinary creation, enabled managed Ask caller, live saved Allow and selected commitConfirmation:none." })),
          checks: Type.Optional(Type.Array(Type.Object({ label: Type.String(), argv: Type.Array(Type.String()) }), { description: "Legacy integration/preferences only. Selected operations reject commands and use saved recipes." })),
          workspaceMode: Type.Optional(Type.Unsafe<"current" | "create" | "attach">({ type: "string", enum: ["current", "create", "attach"] })),
          destinationPath: Type.Optional(Type.String({ maxLength: 4096 })),
          newBranch: Type.Optional(Type.String({ maxLength: 255 })),
          baseBranch: Type.Optional(Type.String({ maxLength: 255 })),
          expectedBaseOid: Type.Optional(Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" })),
          expectedTipOid: Type.Optional(Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" })),
          targetCheckoutPath: Type.Optional(Type.String({ maxLength: 4096 })),
          stage: Type.Optional(Type.Unsafe<"none" | "commit" | "integration" | "handoff">({ type: "string", enum: ["none", "commit", "integration", "handoff"] })),
          checkIndexes: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 63 }), { minItems: 1, maxItems: 64, uniqueItems: true })),
          receiptIds: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 64, uniqueItems: true })),
          revisionDependency: Type.Optional(Type.String({ maxLength: 4096 })),
          ignoredNames: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 2000, uniqueItems: true })),
        }),
        async execute(_id, params, signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          // Historical captured evidence is independent of live Git resources,
          // task policy and UI. Never select a checkout or reconstruct authority.
          if (params.operation === "artifact") {
            const result = (details: GitAgentActionArtifactResult) => ({
              content: [{ type: "text" as const, text: JSON.stringify(details) }], details,
              ...(details.status !== "ok" ? { isError: true } : {}),
            });
            try {
              const required = ["operation", "actionId", "offset"], allowed = [...required, "limitBytes"];
              const props = Object.getOwnPropertyDescriptors(params);
              if (![Object.prototype, null].includes(Object.getPrototypeOf(params)) || Array.isArray(params)
                || required.some((key) => !Object.hasOwn(props, key))
                || Reflect.ownKeys(params).some((key) => typeof key !== "string" || !allowed.includes(key)
                  || !props[key].enumerable || !("value" in props[key]))) {
                return result({ status: "invalid-request", error: "Invalid captured Git patch request." });
              }
              if (signal?.aborted) return failure("Git workflow cancelled");
              const manager = ctx.sessionManager, header = manager.getHeader();
              if (!header || typeof header.cwd !== "string" || ctx.cwd !== header.cwd) {
                return result({ status: "denied", error: "Captured Git action access denied." });
              }
              // The SDK exposes a read-only manager facade to tools. A file
              // pointer is necessary, not proof: the helper pins the physical
              // JSONL/header. Also honor full-manager isPersisted when available.
              const persistence = manager as typeof manager & Partial<Pick<SessionManager, "isPersisted">>;
              const persistedManager = {
                getHeader: () => manager.getHeader(), getSessionId: () => manager.getSessionId(),
                getCwd: () => manager.getCwd(), getSessionFile: () => manager.getSessionFile(),
                getEntries: () => manager.getEntries(), getLeafId: () => manager.getLeafId(),
                isPersisted: () => !!manager.getSessionFile() && persistence.isPersisted?.() !== false,
              };
              const read = createGitAgentActionArtifactReader({ sessionManager: persistedManager,
                sessionId: manager.getSessionId(), cwd: header.cwd, agentDir: getAgentDir(),
                authorizeRoot: (cwd) => isFilePathAllowed(cwd, getKnownAllowedFileRoots()),
              });
              return result(await read({ actionId: params.actionId, offset: params.offset,
                ...(Object.hasOwn(params, "limitBytes") ? { limitBytes: params.limitBytes } : {}),
              }));
            } catch {
              return result({ status: "unavailable", error: "Captured Git artifact is unavailable." });
            }
          }
          // Artifact MUST remain above even parameter interpretation, SDK UI,
          // live caller classification, policy, resource and native gates.
          const selectedOperation = ["workspace", "prepare", "verify", "cleanup", "reconcile"].includes(params.operation)
            || params.operation === "integrate" && (params.repositoryPath !== undefined || params.targetCheckoutPath !== undefined
              || params.receiptIds !== undefined || params.revisionDependency !== undefined);
          if (selectedOperation) {
            const operation = params.operation as SelectedControllerOperation;
            const response = <T extends { status: string }>(details: T) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details,
              ...(["blocked", "recovery-required", "target-moved"].includes(details.status) ? { isError: true } : {}) });
            try {
              const common = ["operation", "repositoryPath", "checkoutPath", "workspaceBranch", "confirmation"];
              const fields = { workspace: ["workspaceMode", "destinationPath", "newBranch", "baseBranch", "expectedBaseOid", "expectedTipOid"],
                prepare: ["targetBranch", "targetCheckoutPath"], verify: ["stage", "checkIndexes", "revisionDependency"],
                integrate: ["targetBranch", "targetCheckoutPath", "receiptIds", "revisionDependency"], cleanup: ["ignoredNames"], reconcile: ["targetBranch", "targetCheckoutPath"] };
              const props = Object.getOwnPropertyDescriptors(params), allowed = [...common, ...fields[operation]];
              if (![Object.prototype, null].includes(Object.getPrototypeOf(params)) || Reflect.ownKeys(params).some((key) => typeof key !== "string"
                || !allowed.includes(key) || !("value" in props[key]) || !props[key].enumerable)
                || params.confirmation !== undefined && !["ask", "none"].includes(params.confirmation)) {
                return response({ status: "blocked", operation, code: "invalid-request" });
              }
              if (signal?.aborted || ctx.cwd !== sessionCwd || !samePath(agentDir, getAgentDir())) return response({ status: "blocked", operation, code: "caller-context-changed" });
              const manager = ctx.sessionManager, file = manager.getSessionFile();
              if (!file) return response({ status: "blocked", operation, code: "persisted-owner-required" });
              // A returned dependency must have actually reached the SDK transcript
              // before THIS assistant tool batch. An in-flight promise, sibling
              // tool call, history ID or parsed journal can never satisfy this.
              if (params.revisionDependency !== undefined) {
                const branch = manager.getBranch(), latest = [...branch].reverse().find((e) => e.type === "message" && e.message.role === "assistant");
                const prior = branch.find((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "git_workflow"
                  && (e.message.details as { revisionDependency?: unknown } | undefined)?.revisionDependency === params.revisionDependency && !e.message.isError);
                if (!latest || !prior || branch.indexOf(prior) >= branch.indexOf(latest)) return response({ status: "blocked", operation, code: "completed-return-dependency-required" });
              }
              const { selectCanonicalGitResources } = await import("./git-project-resources");
              let source;
              if (params.repositoryPath !== undefined) {
                if (params.checkoutPath === undefined) return response({ status: "blocked", operation, code: "explicit-checkout-required" });
                source = await selectCanonicalGitResources({ repositoryPath: params.repositoryPath, checkoutPath: params.checkoutPath, workspaceBranch: params.workspaceBranch });
              } else {
                if (params.checkoutPath !== undefined) return response({ status: "blocked", operation, code: "canonical-repository-required" });
                // Deliberate default: positively verified actual chat checkout,
                // never the last project browsed in Workflow or a guessed repo.
                source = await selectGitProjectResources(sessionCwd, params.workspaceBranch);
              }
              const selector = { repositoryPath: source.projectRoot, checkoutPath: source.cwd, workspaceBranch: source.branch };
              if (operation === "workspace" && params.workspaceMode === "current") {
                if (Object.keys(params).some((key) => !["operation", "repositoryPath", "checkoutPath", "workspaceBranch", "workspaceMode"].includes(key))) return response({ status: "blocked", operation, code: "invalid-request" });
                return response({ status: "current", operation, scope: gitProjectResourceSummary(source), nativeCreation: false, chatMoved: false });
              }
              let item = selectedRuntimes.get(file);
              if (item?.busy) return response({ status: "blocked", operation, code: "operation-in-progress" });
              if (item) { item.ctx = ctx; item.signal = signal; }
              else {
                const { createGitSelectedOperationRuntime } = await import("./git-selected-operation-runtime");
                const holder: Omit<SelectedRuntime, "runtime"> = { ctx, signal, busy: false };
                const runtime = createGitSelectedOperationRuntime({ sessionCwd, agentDir,
                  manager: { getSessionId: () => holder.ctx.sessionManager.getSessionId(), getSessionFile: () => holder.ctx.sessionManager.getSessionFile(),
                    getCwd: () => holder.ctx.sessionManager.getCwd(), getHeader: () => holder.ctx.sessionManager.getHeader(),
                    getEntries: () => holder.ctx.sessionManager.getEntries(), getBranch: () => holder.ctx.sessionManager.getBranch() },
                  effectiveTools: () => pi.getActiveTools?.(), readSelectionRevisionSync: trustedRuntime?.readSelectionRevisionSync,
                  appendEntry: (type, data) => pi.appendEntry(type, data),
                  isCancelled: () => !!holder.signal?.aborted || holder.ctx.cwd !== sessionCwd,
                  ask: (candidate) => { const ui = holder.ctx.ui as typeof holder.ctx.ui & Partial<AgentGitWorkflowUiContext>;
                    if (!holder.ctx.hasUI || !ui?.gitAction) return Promise.resolve(false);
                    return ui.gitAction(candidate, holder.signal); } });
                item = Object.assign(holder, { runtime });
                selectedRuntimes.set(file, item);
              }
              let request: SelectedControllerRequests[SelectedControllerOperation];
              const selection = { selector, ...(params.confirmation === undefined ? {} : { confirmation: params.confirmation }) };
              if (operation === "workspace") {
                if (!params.destinationPath || !validLocalBranchName(params.newBranch) || !validLocalBranchName(params.baseBranch) || !params.expectedBaseOid
                  || !["create", "attach"].includes(params.workspaceMode ?? "") || params.workspaceMode === "create" && Object.hasOwn(params, "expectedTipOid")
                  || params.workspaceMode === "attach" && !params.expectedTipOid) return response({ status: "blocked", operation, code: "invalid-request" });
                request = { ...selection, workspace: { repositoryPath: source.projectRoot, sourceCheckoutPath: source.cwd, destinationPath: params.destinationPath,
                  branch: params.newBranch, baseBranch: params.baseBranch, expectedBaseOid: params.expectedBaseOid,
                  ...(params.workspaceMode === "attach" ? { mode: "attach", expectedTipOid: params.expectedTipOid! } : { mode: "create" }) } };
              } else if (operation === "verify") {
                request = { ...selection, stage: params.stage ?? "integration", ...(params.checkIndexes ? { checkIndexes: params.checkIndexes } : {}),
                  ...(params.revisionDependency ? { revisionDependency: params.revisionDependency } : {}) };
              } else if (operation === "cleanup") request = { ...selection, ...(params.ignoredNames ? { ignoredNames: params.ignoredNames } : {}) };
              else {
                const policy = await loadGitProjectSettings(source, manager.getEntries() as SessionEntry[], agentDir, manager.getSessionId());
                const targetBranch = operation === "prepare" || operation === "reconcile" ? policy.project.mainBranch : policy.resolved.session.values.targetBranch;
                if (!validLocalBranchName(targetBranch) || params.targetBranch !== undefined && params.targetBranch !== targetBranch) return response({ status: "blocked", operation, code: "selected-project-target-required" });
                const target = params.targetCheckoutPath !== undefined ? await selectCanonicalGitResources({ repositoryPath: source.projectRoot,
                  checkoutPath: params.targetCheckoutPath, workspaceBranch: targetBranch }) : await selectGitProjectResources(source.projectRoot, targetBranch);
                request = { ...selection, target: { repositoryPath: target.projectRoot, checkoutPath: target.cwd, workspaceBranch: target.branch },
                  ...(operation === "integrate" ? { ...(params.receiptIds ? { receiptIds: params.receiptIds } : {}), ...(params.revisionDependency ? { revisionDependency: params.revisionDependency } : {}) } : {}) };
              }
              item.busy = true;
              try {
                const details = await item.runtime.run(operation, request);
                return response({ ...details, ...(details.recoveryRequired ? { warning: "Do not retry. Inspect the actual checkout and durable action evidence." } : {}) });
              } finally { item.busy = false; }
            } catch { return response({ status: "blocked", operation, code: "selected-runtime-unavailable" }); }
          }
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
            const allowed = new Set(["operation", "repositoryPath", "checkoutPath", "workspaceBranch", "targetBranch", "commitOids", "paths", "mode", "message", "confirmation", "checks", ...(params.operation === "commit" ? ["receiptIds"] : [])]);
            if (Object.keys(params).some((key) => !allowed.has(key)) || params.mode !== undefined &&
              (params.operation !== "commit" || !["whole-file", "staged"].includes(params.mode)) || params.confirmation !== undefined &&
              (params.operation !== "commit" || !["ask", "none"].includes(params.confirmation))) {
              return failure("Unsupported Git workflow arguments");
            }
            const selected = params.repositoryPath !== undefined ? await selectGitProjectResources(params.repositoryPath, params.workspaceBranch, params.checkoutPath) : undefined;
            const selectedState = selected ? await loadGitProjectSettings(selected, entries(), agentDir, ctx.sessionManager.getSessionId()) : undefined;
            if (params.operation === "status") {
              if (params.targetBranch !== undefined || params.commitOids !== undefined || params.paths !== undefined || params.mode !== undefined || params.message !== undefined || params.checks !== undefined || params.confirmation !== undefined) return failure("Status accepts only resource selectors");
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
            const requestingNone = params.operation === "commit" && params.confirmation === "none";
            if (params.operation !== "review" && (!ctx.hasUI || !ui?.gitAction) && !requestingNone) return failure("Git workflow preferences/commit/integration requires an interactive Pi Web session");
            preApprovalStage("permission");
            const state = params.operation === "review" || selected && params.operation === "commit" ? null
              : await guard(params.operation === "commit" ? "commit" : params.operation === "integrate" ? "integration" : "settings");
            preApprovalStage("workspace");
            const workspace = selected?.cwd ?? await selectGitWorkspace(sessionCwd, params.workspaceBranch);
            if (params.operation === "preferences") {
              if (state?.task.kind === "managed") return failure("Configure all scopes in the Workflow panel. Legacy preferences cannot override this managed task.");
              if (params.targetBranch || params.paths || params.mode || params.message || params.commitOids || !ui.gitPreferences) return failure("Provide only proposed checks for early preferences");
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
              if (!validLocalBranchName(targetBranch) || params.paths || params.mode || params.message || params.checks) return failure("Choose a local target branch to review, or configure the explicitly selected project's target");
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
              const source = selected ?? await selectGitProjectResources(workspace);
              const target = await selectGitProjectResources(source.cwd, review.targetBranch).catch(() => undefined);
              const snapshot = snapshotGitActionCandidate(candidate, source, target);
              // Recheck immediately before journalling; external writers can still race this boundary.
              await revalidateGitProjectResources(source);
              if (target) await revalidateGitProjectResources(target);
              const action = await beginGitAction(gitActionSink(ctx.sessionManager, (type, data) => pi.appendEntry(type, data)), "agent", snapshot);
              let finalizing = false;
              try {
                // A comparison is evidence, not a decision. Capture the bounded
                // patch privately before returning metadata; no browser request or
                // history record can be used as integration approval.
                if (signal?.aborted) {
                  await action.update("cancelled");
                  return failure("Git comparison cancelled; no operation was approved or executed");
                }
                await revalidateGitProjectResources(source);
                if (target) await revalidateGitProjectResources(target);
                if (!selected && (!samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))
                  || (await featureBranch(workspace)) !== review.featureBranch)) {
                  throw new Error("Review workspace selection changed");
                }
                const details = { status: "captured", actionId: action.record.id,
                  selection: selection.kind === "merge" ? { kind: "merge" } : { kind: "commits", count: selection.commitOids.length,
                    firstOid: selection.commitOids[0], lastOid: selection.commitOids.at(-1) },
                  targetBranch: review.targetBranch, targetOid: review.targetOid,
                  featureBranch: review.featureBranch, featureOid: review.featureOid,
                  fromTreeOid: diff.fromTreeOid, toTreeOid: diff.toTreeOid,
                  ...(selected ? { resources: gitProjectResourceSummary(selected) } : { cwd: workspace }) };
                const text = JSON.stringify(details);
                finalizing = true;
                await action.update("succeeded");
                finalizing = false;
                return { content: [{ type: "text" as const, text }], details };
              } catch (cause) {
                await failGitAction(action, false, signal, cause);
                // The final write may already have published despite reporting
                // failure. Return known comparison identities, not a guessed
                // journal state or an invitation to retry from the action ID.
                if (finalizing) {
                  const details = { status: "recording-unconfirmed", actionId: action.record.id,
                    targetOid: review.targetOid, featureOid: review.featureOid,
                    fromTreeOid: diff.fromTreeOid, toTreeOid: diff.toTreeOid,
                    error: "Final comparison record could not be confirmed; inspect private history. This read-only action did not update Git refs." };
                  return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details, isError: true };
                }
                throw cause;
              } finally { action.release(); }
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
              // Squash is a readable legacy preference, never permission to substitute a merge.
              if (task?.method === "squash") return failure("Squash integration is unsupported; no checks or integration ran");
              const method = task?.method === "ff" ? "ff" : "merge";
              const policy = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual",
                integration: { targetBranch, method }, checks: requestedChecks });
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
              const targetResources = await selectGitProjectResources(target);
              const { createGitCheckAuthorityFence } = await import("./git-check-authority-fence");
              const { getRpcSession } = await import("./rpc-manager");
              const nativeSelectionRevision = createGitCheckAuthorityFence({
                scope: { sessionId, sessionFile: manager.getSessionFile()!, cwd: sessionCwd }, agentDir, checkouts: [workspace, target] });
              const readAuthorityRevisionSync = createGitCheckAuthorityFence({
                scope: { sessionId, sessionFile: manager.getSessionFile()!, cwd: sessionCwd }, agentDir,
                checkouts: [workspace, target], readSelectionRevisionSync: () => {
                  if (trustedRuntime) return trustedRuntime.readSelectionRevisionSync();
                  if (!getRpcSession(sessionId)?.isAlive()) throw new Error("Live monotonic authority provider required");
                  return nativeSelectionRevision();
                }, readSelectionStateSync: () => ({
                  cwd: ctx.cwd, sessionId: manager.getSessionId(), file: manager.getSessionFile(), header: manager.getHeader(),
                  tools: pi.getActiveTools?.(), cancelled: !!signal?.aborted, source: resources, target: targetResources,
                  // Actual effective SDK state wins over independently saved tools.
                  entries: entries().filter((entry) => entry.type === "custom" && entry.customType !== "pi-web:git-action"),
                }),
              });
              const checkAction = await beginGitAction(sink, "agent", snapshotGitActionCandidate(checkCandidate, resources, targetResources));
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
                        isTrusted: trusted, signal: watcher.signal, readAuthorityRevisionSync }));
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
              const integrationOptions = { sessionId, cwd: workspace, agentDir, featureBranch: branch,
                receiptIds: receipts.map((r) => r.id), getPolicy: guardedPolicy };
              const plan = method === "ff" ? await prepareFastForwardIntegration(integrationOptions) : await prepareIntegration(integrationOptions);
              const mergeCandidate = { kind: "integration" as const, featureCwd: workspace, targetCwd: target, plan, receipts };
              const mergeAction = await beginGitAction(sink, "agent", snapshotGitActionCandidate(mergeCandidate, resources, targetResources));
              let applying = false;
              let reservation: GitOperationReservation | undefined;
              try {
                await mergeAction.update("awaiting-decision");
                if (!await ui.gitAction!({ ...mergeCandidate, actionId: mergeAction.record.id }, signal) || signal?.aborted) {
                  await mergeAction.update(signal?.aborted ? "cancelled" : "declined", { decision: signal?.aborted ? "cancelled" : "declined" });
                  return { content: [{ type: "text" as const, text: "Exact integration declined; no target ref was updated." }], details: { approved: false, actionId: mergeAction.record.id } };
                }
                const releaseMerge = acquireGitCheckoutGate([workspace, target]);
                try {
                  if (!await valid()) throw new ManagedGitAccessError("Checkout became busy or untrusted before integration");
                  const confirm = "method" in plan ? confirmFastForwardIntegration : confirmIntegration;
                  const result = await confirm(plan.planId, plan.planId, sessionId, async () => {
                    await mergeAction.update("executing", { decision: "approved" });
                    await mergeAction.update("executing", { intended: "method" in plan
                      ? { featureOid: plan.featureOid, targetOid: plan.review.targetOid, targetBranch, tree: plan.treeOid, parents: plan.parents }
                      : { mergeOid: plan.mergeOid, targetBranch } });
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
            const commitResources = selected ?? (requestingNone ? await selectGitProjectResources(workspace) : undefined);
            const commitSource = commitResources ?? await selectGitProjectResources(workspace);
            if (params.receiptIds !== undefined && (!Array.isArray(params.receiptIds) || params.receiptIds.length > 64 ||
              new Set(params.receiptIds).size !== params.receiptIds.length || params.receiptIds.some((id) => typeof id !== "string" || !id || id.length > 256))) return failure("Invalid commit receipt IDs");
            const { createGitSelectedOperationRuntime } = await import("./git-selected-operation-runtime");
            const commitRuntime = createGitSelectedOperationRuntime({ sessionCwd, agentDir, manager,
              effectiveTools: () => pi.getActiveTools?.(), readSelectionRevisionSync: trustedRuntime?.readSelectionRevisionSync,
              appendEntry: (type, data) => pi.appendEntry(type, data), ask: (candidate) => ui.gitAction!(candidate, signal),
              isCancelled: () => !!signal?.aborted || !samePath(ctx.cwd, sessionCwd) });
            const verificationContext = commitRuntime.commitVerificationContext(commitSource, params.receiptIds ?? []);
            const assertAuthorization = commitResources ? agentGitCommitAuthorization({ sessionCwd, manager,
              selected: commitResources, explicitProject: !!selected, confirmation: requestingNone ? "none" : "ask",
              effectiveTools: () => pi.getActiveTools?.(), agentDir }) : undefined;
            const authorizeWithoutConfirmation = requestingNone ? assertAuthorization : undefined;
            const beforeApply = async () => {
              if (selected) {
                if (writableManager?.isPersisted?.() === false) throw new ManagedGitAccessError("A persisted ordinary chat is required for selected-project commits.");
                await assertAuthorization!();
              } else {
                await assertManagedGitWorkspace(await guard("commit"), workspace);
                await assertManagedGitProjectDenial(workspace, {
                  sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile()!, sessionCwd,
                }, "commit", agentDir);
                if (signal?.aborted || !samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) throw new ManagedGitAccessError("Commit cancelled or workspace changed");
              }
              if (signal?.aborted) throw new ManagedGitAccessError("Commit cancelled");
              return commitRuntime.captureAuthorityGuard(commitSource);
            };
            try {
              await beforeApply();
              return await requestWorkflowCommit({ cwd: workspace, paths: params.paths, mode: params.mode, message: params.message, signal,
                ...(commitResources ? { selected: commitResources, agentDir } : {}), authorizeWithoutConfirmation, verificationContext,
                sink: gitActionSink(manager, (type, data) => pi.appendEntry(type, data)),
                ask: (candidate, abort) => ui.gitAction!(candidate, abort), beforeApply });
            } finally { commitRuntime.dispose(); }
          } catch (cause) {
            const recorded = params.operation === "commit" ? workflowCommitFailureResult(cause) : gitActionFailureResult(cause);
            if (recorded) return recorded;
            if (params.operation === "commit") {
              const { readGitSelectedRuntimeRefusal } = await import("./git-selected-operation-runtime");
              const refusal = readGitSelectedRuntimeRefusal(cause);
              if (refusal) return { ...failure(`Commit refused: ${refusal}.`), details: { error: `Commit refused: ${refusal}.`, code: refusal } };
            }
            if (cause instanceof GitProjectResourceError) return { ...failure(cause.message), details: { error: cause.message, code: cause.code } };
            if (cause instanceof GitIntegrationTargetMovedError) return { ...failure(cause.message), details: { error: cause.message, code: cause.code } };
            if (cause instanceof GitCommitVerificationError) return failure(cause.message);
            if (cause instanceof ManagedGitAccessError || cause instanceof GitCheckoutBusyError || cause instanceof GitCommitOperationError) return failure(cause.message);
            // Never send raw Git stderr, argv, trust contents or arbitrary errors.
            if (preApprovalPhase) {
              const message = `${INTEGRATION_PREAPPROVAL_DIAGNOSTICS[preApprovalPhase]} Check approval was not requested; no checks or merge were executed.`;
              return { ...failure(message), details: { error: message, code: "integration-preapproval-failed", phase: preApprovalPhase,
                checkApprovalRequested: false, checksStarted: false, integrationStarted: false } };
            }
            if (cause instanceof GitOperationRecoveryError) return { ...failure(cause.message),
              details: { error: cause.message, actionId: cause.actionId, recoveryRequired: true } };
            return failure("Git candidate unavailable or stale; inspect the checkout and request a fresh review");
          }
        },
      });
    },
  };
}
