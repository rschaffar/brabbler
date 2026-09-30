import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension, SessionManager } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { canRecordGitWorkspaceTransition } from "./git-workspace-transition";
import { gitExecEnv } from "./git-exec";
import { readSessionGitWorkflow, validLocalBranchName, type GitWorkflowPolicy } from "./git-workflow-policy";
import { assertManagedGitProjectDenial, assertManagedGitWorkspaceStart, ManagedGitAccessError } from "./git-workflow-access";
import { samePath } from "./paths";
import type { SessionEntry } from "./types";
import { addWorktree, proposedWorktreePath, resolveProject } from "./worktree";
import { selectGitWorkspace } from "./git-workspace-selector";

const execFileAsync = promisify(execFile);

export const GIT_WORKSPACE_START_TYPE = "pi-web:git-workspace-start";
export const GIT_WORKSPACE_COMPLETED_TYPE = "pi-web:git-workspace-completed";

export interface GitWorkspaceTransition {
  version: 1;
  originCwd: string;
  destinationPath: string;
  branch: string;
  baseOid: string;
  onCreate: "continue" | "fork" | "stay";
  featureTip: string;
  createdAt: string;
  nonce: string;
}

export interface CompletedGitWorkspaceTransition {
  version: 1;
  originCwd: string;
  destinationPath: string;
  nonce: string;
  completedAt: string;
}

const oid = (value: unknown): value is string => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const boundedPath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
const nonce = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactFields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function parseStart(value: unknown): GitWorkspaceTransition | null {
  if (!record(value) || !exactFields(value, ["version", "originCwd", "destinationPath", "branch", "baseOid", "onCreate", "featureTip", "createdAt", "nonce"])
    || value.version !== 1 || !boundedPath(value.originCwd) || !boundedPath(value.destinationPath)
    || !validLocalBranchName(value.branch) || !oid(value.baseOid) || !oid(value.featureTip)
    || !["continue", "fork", "stay"].includes(value.onCreate as string)
    || !timestamp(value.createdAt) || !nonce(value.nonce)) return null;
  return value as unknown as GitWorkspaceTransition;
}
function parseCompletion(value: unknown): CompletedGitWorkspaceTransition | null {
  if (!record(value) || !exactFields(value, ["version", "originCwd", "destinationPath", "nonce", "completedAt"])
    || value.version !== 1 || !boundedPath(value.originCwd) || !boundedPath(value.destinationPath)
    || !nonce(value.nonce) || !timestamp(value.completedAt)) return null;
  return value as unknown as CompletedGitWorkspaceTransition;
}

/** Log order, not wall-clock time, determines the latest uncompleted start. */
export function readPendingGitWorkspaceTransition(entries: readonly Pick<SessionEntry, "type">[]): GitWorkspaceTransition | null {
  const completed = new Set<string>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as SessionEntry;
    if (entry.type !== "custom") continue;
    if (entry.customType === GIT_WORKSPACE_COMPLETED_TYPE) {
      const data = parseCompletion(entry.data);
      if (data) completed.add(`${data.nonce}\0${data.originCwd}\0${data.destinationPath}`);
    } else if (entry.customType === GIT_WORKSPACE_START_TYPE) {
      const data = parseStart(entry.data);
      if (data) return completed.has(`${data.nonce}\0${data.originCwd}\0${data.destinationPath}`) ? null : data;
    }
  }
  return null;
}

/** Append to the source and, for a fork, to the target too. Idempotent on retry. */
export function gitWorkspaceCompletion(transition: GitWorkspaceTransition): CompletedGitWorkspaceTransition {
  const checked = parseStart(transition);
  if (!checked) throw new Error("Invalid Git workspace transition");
  return {
    version: 1, originCwd: checked.originCwd, destinationPath: checked.destinationPath,
    nonce: checked.nonce, completedAt: new Date().toISOString(),
  };
}

export function appendCompletedGitWorkspaceTransition(
  source: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
  transition: GitWorkspaceTransition,
  target?: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
): void {
  const completion = gitWorkspaceCompletion(transition);
  for (const manager of new Set([source, ...(target ? [target] : [])])) {
    const entries = manager.getEntries() as SessionEntry[];
    const alreadyCompleted = entries.some((entry) => entry.type === "custom" && entry.customType === GIT_WORKSPACE_COMPLETED_TYPE
      && (() => { const data = parseCompletion(entry.data); return data?.nonce === completion.nonce
        && data?.originCwd === completion.originCwd && data?.destinationPath === completion.destinationPath; })());
    if (!alreadyCompleted) manager.appendCustomEntry(GIT_WORKSPACE_COMPLETED_TYPE, completion);
  }
}

/** This tool only creates; navigation/forking requires a separate route with its own checks. */
export function createGitWorkspaceStartExtension(
  sessionCwd: string,
  getSavedPolicy: () => GitWorkflowPolicy | null | undefined,
  onStarted?: (transition: GitWorkspaceTransition) => Promise<void> | void,
): InlineExtension {
  return {
    name: "pi-web-git-workspace-start", hidden: true,
    factory: (pi) => {
      let creating = false;
      pi.registerTool({
        name: "git_workspace_start", label: "Start Git Workspace", executionMode: "sequential",
        description: "Create a NEW local feature worktree from this chat's saved base, or propose an explicit local baseBranch when a managed worktree task has none. A missing-base proposal requires exact approval, creates only, and does not save settings or move the chat. A configured base cannot be overridden. Optionally select another registered source worktree in the same repository with workspaceBranch. Supply a new branch and the full current base commit OID. No remote operations or attaching an existing branch.",
        parameters: Type.Object({
          workspaceBranch: Type.Optional(Type.String({ description: "Registered source checkout branch in this chat's repository; omit for the chat checkout" })),
          baseBranch: Type.Optional(Type.String({ description: "Explicit local base only when the captured managed worktree task has no base; must match a configured base if provided" })),
          branch: Type.String({ description: "New local feature branch name (must not exist)" }),
          expectedBaseOid: Type.String({ description: "Full current commit OID of the selected local base branch; refresh if it has changed" }),
        }),
        async execute(_id, params, _signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          if (creating) return failure("Workspace creation already in progress");
          creating = true;
          try {
            const manager = ctx.sessionManager;
            const entries = manager.getEntries() as SessionEntry[];
            const guard = () => assertManagedGitWorkspaceStart(sessionCwd, manager.getEntries() as SessionEntry[], params.baseBranch, pi.getActiveTools?.());
            const selected = await guard();
            const policy = getSavedPolicy();
            // The callback must read session entries, not changed project defaults. A missing-base
            // managed task has a null legacy projection; the explicit base is NOT saved as one.
            if (JSON.stringify(policy) !== JSON.stringify(readSessionGitWorkflow(entries))
              || (selected.oneOff ? policy !== null : policy?.mode !== "worktree" || policy.baseBranch !== selected.baseBranch)) {
              return failure("Saved worktree settings changed; inspect the chat before creating a workspace");
            }
            if (manager.getHeader()?.parentSession || entries.some((e) => e.type === "custom" && e.customType === "pi-web:subagent")) {
              return failure("Subagents cannot start a workspace");
            }
            const file = manager.getSessionFile();
            // Extension contexts expose ReadonlySessionManager, not isPersisted().
            if (!file || !existsSync(file)) return failure("Persist the session before creating a workspace");
            // One automatic transition per chat for now. Refuse BEFORE creating an orphan worktree.
            if (onStarted && selected.onCreate !== "stay" && !canRecordGitWorkspaceTransition(manager.getSessionId())) {
              return failure("This chat already has a workspace transition; use manual continuation for another worktree");
            }
            let realCwd: string;
            try { realCwd = realpathSync(ctx.cwd); } catch { return failure("Session checkout is unavailable"); }
            if (!samePath(realCwd, realpathSync(sessionCwd)) || !samePath(realCwd, realpathSync(manager.getCwd()))
              || !samePath(realCwd, realpathSync(manager.getHeader()?.cwd ?? ""))) return failure("Session checkout changed");
            if (!isExistingFilePathAllowed(realCwd, await getAllowedFileRoots())) return failure("Session checkout is outside allowed roots");
            const owner = { sessionId: manager.getSessionId(), sessionFile: file, sessionCwd: sessionCwd };
            await assertManagedGitProjectDenial(sessionCwd, owner, "workspace");
            const project = await resolveProject(realCwd);
            if (!samePath(project.projectRoot, (await resolveProject(sessionCwd)).projectRoot)) {
              return failure("Session project changed");
            }
            if (readPendingGitWorkspaceTransition(entries)) return failure("A workspace transition is already pending");
            if (!validLocalBranchName(params.branch) || !oid(params.expectedBaseOid)) return failure("A new branch and full expected local base OID are required");
            const workspace = await selectGitWorkspace(sessionCwd, params.workspaceBranch);
            await assertManagedGitProjectDenial(workspace, owner, "workspace");
            if (selected.state.task.kind === "managed") {
              if (!ctx.hasUI) return failure("Workspace creation requires interactive approval");
              const destination = proposedWorktreePath(project.projectRoot, params.branch);
              const approved = await ctx.ui.confirm("Create feature workspace?",
                `Create branch ${params.branch} in ${destination} from local ${selected.baseBranch} at ${params.expectedBaseOid}, using source ${workspace}. Chat disposition: ${selected.oneOff ? "stay (one-off base; no settings change or automatic chat movement)" : selected.onCreate}. No commit, integration, or cleanup is approved.`, { signal: _signal });
              if (!approved || _signal?.aborted) return failure("Workspace creation cancelled; nothing created");
            }
            const verifySelection = async () => {
              const currentSource = await selectGitWorkspace(sessionCwd, params.workspaceBranch);
              if (_signal?.aborted || !samePath(workspace, currentSource)) {
                throw new ManagedGitAccessError("Source workspace changed or creation cancelled; nothing created");
              }
              const current = await guard();
              await assertManagedGitProjectDenial(currentSource, owner, "workspace");
              if (JSON.stringify(current.state.task) !== JSON.stringify(selected.state.task)
                || current.baseBranch !== selected.baseBranch || current.onCreate !== selected.onCreate || current.oneOff !== selected.oneOff
                || JSON.stringify(getSavedPolicy()) !== JSON.stringify(policy)) {
                throw new ManagedGitAccessError("Saved worktree settings changed during approval; nothing created");
              }
              if (_signal?.aborted) throw new ManagedGitAccessError("Workspace creation cancelled; nothing created");
            };
            let created: { path: string; branch: string };
            try {
              await verifySelection();
              created = await addWorktree(workspace, { branch: params.branch, baseBranch: selected.baseBranch,
                expectedBaseOid: params.expectedBaseOid, mode: "create", beforeCreate: verifySelection });
            } catch (cause) {
              if (cause instanceof ManagedGitAccessError) return failure(cause.message);
              return failure("Workspace creation failed; inspect the local branch, base OID and clean checkout, then retry");
            }
            // Resolve the actual new branch tip; never assume another checkout's HEAD is the feature tip.
            let featureTip: string;
            try {
              const { stdout } = await execFileAsync("git", ["-C", created.path, "rev-parse", "--verify", "HEAD^{commit}"], {
                env: gitExecEnv(), timeout: 10_000, maxBuffer: 4096,
              });
              if (!oid(stdout.trim())) throw new Error("Cannot read feature tip");
              featureTip = stdout.trim();
              const transition: GitWorkspaceTransition = {
                version: 1, originCwd: realCwd, destinationPath: created.path, branch: created.branch,
                baseOid: params.expectedBaseOid.toLowerCase(), onCreate: selected.onCreate,
                featureTip, createdAt: new Date().toISOString(), nonce: randomUUID(),
              };
              pi.appendEntry(GIT_WORKSPACE_START_TYPE, transition);
              // A create-only proposal has no pending move to replay. Close its durable
              // start explicitly; other dispositions still require server acceptance.
              if (transition.onCreate === "stay") pi.appendEntry(GIT_WORKSPACE_COMPLETED_TYPE, gitWorkspaceCompletion(transition));
              else await onStarted?.(transition);
              return { content: [{ type: "text" as const, text: `Created ${created.path}. ${transition.onCreate === "stay" ? "No session movement was requested." : "Session transition scheduled after this run."}` }], details: transition };
            } catch {
              return failure(`Worktree created at ${created.path}, but the session transition could not be saved. Recover manually; do not retry creation.`);
            }
          } catch (cause) {
            if (cause instanceof ManagedGitAccessError) return failure(cause.message);
            return failure("Workspace start refused; check the persisted session checkout and allowed project");
          } finally { creating = false; }
        },
      });
    },
  };
}
