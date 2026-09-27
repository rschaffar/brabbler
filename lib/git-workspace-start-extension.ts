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
import { samePath } from "./paths";
import type { SessionEntry } from "./types";
import { addWorktree, resolveProject } from "./worktree";
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
export function appendCompletedGitWorkspaceTransition(
  source: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
  transition: GitWorkspaceTransition,
  target?: Pick<SessionManager, "appendCustomEntry" | "getEntries">,
): void {
  const checked = parseStart(transition);
  if (!checked) throw new Error("Invalid Git workspace transition");
  const completion: CompletedGitWorkspaceTransition = {
    version: 1, originCwd: checked.originCwd, destinationPath: checked.destinationPath,
    nonce: checked.nonce, completedAt: new Date().toISOString(),
  };
  for (const manager of new Set([source, ...(target ? [target] : [])])) {
    const entries = manager.getEntries() as SessionEntry[];
    const alreadyCompleted = entries.some((entry) => entry.type === "custom" && entry.customType === GIT_WORKSPACE_COMPLETED_TYPE
      && (() => { const data = parseCompletion(entry.data); return data?.nonce === checked.nonce
        && data.originCwd === checked.originCwd && data.destinationPath === checked.destinationPath; })());
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
        description: "Explicitly create a NEW local feature worktree from the saved session's local base branch. Optionally select another registered worktree in this chat's repository as the clean creation source by workspaceBranch. Supply a new branch name and the full current local base commit OID. Any configured post-run chat transition still moves/forks this chat, not a chat in the source worktree. No remote operations or attaching an existing branch.",
        parameters: Type.Object({
          workspaceBranch: Type.Optional(Type.String({ description: "Checked-out local branch identifying a registered source worktree; omit for this chat's checkout" })),
          branch: Type.String({ description: "New local feature branch name (must not exist)" }),
          expectedBaseOid: Type.String({ description: "Full current commit OID of the saved local base branch; refresh if it has changed" }),
        }),
        async execute(_id, params, _signal, _update, ctx) {
          const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true, details: { error: message } });
          if (creating) return failure("Workspace creation already in progress");
          creating = true;
          try {
            const manager = ctx.sessionManager;
            const entries = manager.getEntries() as SessionEntry[];
            const policy = getSavedPolicy();
            // The callback must read session entries, not project defaults. Verify it still matches the persisted snapshot.
            if (policy?.mode !== "worktree" || JSON.stringify(policy) !== JSON.stringify(readSessionGitWorkflow(entries))) {
              return failure("A saved session worktree policy is required");
            }
            if (manager.getHeader()?.parentSession || entries.some((e) => e.type === "custom" && e.customType === "pi-web:subagent")) {
              return failure("Subagents cannot start a workspace");
            }
            const file = manager.getSessionFile();
            // Extension contexts expose ReadonlySessionManager, not isPersisted().
            if (!file || !existsSync(file)) return failure("Persist the session before creating a workspace");
            // One automatic transition per chat for now. Refuse BEFORE creating an orphan worktree.
            if (onStarted && !canRecordGitWorkspaceTransition(manager.getSessionId())) {
              return failure("This chat already has a workspace transition; use manual continuation for another worktree");
            }
            let realCwd: string;
            try { realCwd = realpathSync(ctx.cwd); } catch { return failure("Session checkout is unavailable"); }
            if (!samePath(realCwd, realpathSync(sessionCwd)) || !samePath(realCwd, realpathSync(manager.getCwd()))
              || !samePath(realCwd, realpathSync(manager.getHeader()?.cwd ?? ""))) return failure("Session checkout changed");
            if (!isExistingFilePathAllowed(realCwd, await getAllowedFileRoots())) return failure("Session checkout is outside allowed roots");
            const project = await resolveProject(realCwd);
            if (!samePath(project.projectRoot, (await resolveProject(sessionCwd)).projectRoot)) {
              return failure("Session project changed");
            }
            if (readPendingGitWorkspaceTransition(entries)) return failure("A workspace transition is already pending");
            if (!validLocalBranchName(params.branch) || !oid(params.expectedBaseOid)) return failure("A new branch and full expected local base OID are required");
            const workspace = await selectGitWorkspace(sessionCwd, params.workspaceBranch);
            let created: { path: string; branch: string };
            try {
              if (!samePath(workspace, await selectGitWorkspace(sessionCwd, params.workspaceBranch))) return failure("Source workspace changed");
              created = await addWorktree(workspace, { branch: params.branch, baseBranch: policy.baseBranch,
                expectedBaseOid: params.expectedBaseOid, mode: "create" });
            } catch {
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
                baseOid: params.expectedBaseOid.toLowerCase(), onCreate: policy.onCreate,
                featureTip, createdAt: new Date().toISOString(), nonce: randomUUID(),
              };
              pi.appendEntry(GIT_WORKSPACE_START_TYPE, transition);
              // The server must durably accept the transition before the tool says it is scheduled.
              // Stay creates only the worktree: it never schedules a move.
              if (transition.onCreate !== "stay") await onStarted?.(transition);
              return { content: [{ type: "text" as const, text: `Created ${created.path}. ${transition.onCreate === "stay" ? "No session movement was requested." : "Session transition scheduled after this run."}` }], details: transition };
            } catch {
              return failure(`Worktree created at ${created.path}, but the session transition could not be saved. Recover manually; do not retry creation.`);
            }
          } catch {
            return failure("Workspace start refused; check the persisted session checkout and allowed project");
          } finally { creating = false; }
        },
      });
    },
  };
}
