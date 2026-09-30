import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import { validLocalBranchName } from "./git-workflow-policy";
import type { GitWorkflowSettingsResponse } from "./git-workflow-settings";
import type { SessionEntry } from "./types";
import { readSessionToolSelection } from "./session-tool-selection";
import { listWorktrees } from "./worktree";
import { samePath } from "./paths";

import { managedGitPermission, type GitWorkflowSessionFacts, type ManagedGitStage } from "./git-workflow-permissions";
export { hasManagedGitMutationTools, type ManagedGitStage } from "./git-workflow-permissions";

export class ManagedGitAccessError extends Error {}
export function managedGitSessionFacts(entries: readonly SessionEntry[], effectiveTools?: readonly string[]): GitWorkflowSessionFacts {
  return { subagent: entries.some((e) => e.type === "custom" && e.customType === "pi-web:subagent"),
    tools: effectiveTools ?? readSessionToolSelection(entries) };
}

/** One live gate for browser actions and already-loaded tools. Not a shell sandbox. */
export async function assertManagedGitAction(
  cwd: string, entries: readonly SessionEntry[], stage: ManagedGitStage, actor: "agent" | "human", agentDir = getAgentDir(), effectiveTools?: readonly string[],
): Promise<GitWorkflowSettingsResponse> {
  let state: GitWorkflowSettingsResponse;
  try { state = await loadGitWorkflowSettings(cwd, entries, agentDir, "active-session"); }
  catch { throw new ManagedGitAccessError("Workflow settings are unavailable or unsupported; managed Git actions are blocked."); }
  const permission = managedGitPermission(state, managedGitSessionFacts(entries, effectiveTools), stage, actor);
  if (permission.kind === "blocked") throw new ManagedGitAccessError(permission.reason);
  return state;
}

/** An explicit base can fill only a missing managed worktree input for this one creation.
 * It never edits the captured task or turns an unconfigured legacy policy into consent.
 */
export async function assertManagedGitWorkspaceStart(
  cwd: string, entries: readonly SessionEntry[], proposedBase: string | undefined, effectiveTools?: readonly string[], agentDir = getAgentDir(),
): Promise<{ state: GitWorkflowSettingsResponse; baseBranch: string; onCreate: "stay" | "continue" | "fork"; oneOff: boolean }> {
  if (proposedBase !== undefined && !validLocalBranchName(proposedBase)) {
    throw new ManagedGitAccessError("Supply a valid local base branch name.");
  }
  let state: GitWorkflowSettingsResponse;
  try { state = await loadGitWorkflowSettings(cwd, entries, agentDir, "active-session"); }
  catch { throw new ManagedGitAccessError("Workflow settings are unavailable or unsupported; managed Git actions are blocked."); }
  const task = state.task;
  if (proposedBase !== undefined && task.kind === "managed" && task.settings.workspace !== "worktree") {
    throw new ManagedGitAccessError("This task does not permit creating a feature worktree; an explicit base cannot change its workspace strategy.");
  }
  const oneOff = task.kind === "managed" && task.settings.workspace === "worktree"
    && task.settings.baseBranch === null && proposedBase !== undefined;
  if (task.kind === "managed" && proposedBase !== undefined && task.settings.baseBranch
    && task.settings.baseBranch !== proposedBase) {
    throw new ManagedGitAccessError("The proposed base differs from the captured base; stop the chat and explicitly change/apply settings before retargeting.");
  }
  if (task.kind === "legacy" && proposedBase !== undefined && task.policy?.mode === "worktree"
    && task.policy.baseBranch !== proposedBase) {
    throw new ManagedGitAccessError("The proposed base differs from the saved worktree policy.");
  }
  const permissionState = oneOff && task.kind === "managed"
    ? { ...state, task: { kind: "managed" as const, settings: { ...task.settings, baseBranch: proposedBase } } }
    : state;
  const permission = managedGitPermission(permissionState, managedGitSessionFacts(entries, effectiveTools), "workspace", "agent");
  if (permission.kind === "blocked") {
    throw new ManagedGitAccessError(permission.code === "missing-worktree-base"
      ? "No worktree base is configured. Supply an explicit local baseBranch and expectedBaseOid for a one-off, create-only proposal; or stop the chat to Save and Apply session settings."
      : permission.reason);
  }
  if (task.kind === "managed") {
    if (task.settings.workspace !== "worktree" || !(task.settings.baseBranch || proposedBase)) {
      throw new ManagedGitAccessError("A managed worktree strategy and local base are required.");
    }
    return { state, baseBranch: task.settings.baseBranch ?? proposedBase!, onCreate: oneOff ? "stay" : task.settings.onCreate, oneOff };
  }
  if (task.kind !== "legacy" || task.policy?.mode !== "worktree") {
    throw new ManagedGitAccessError("A saved session worktree policy is required.");
  }
  return { state, baseBranch: task.policy.baseBranch, onCreate: task.policy.onCreate, oneOff: false };
}

/** Check the selected source, not the chat cwd or a cached branch name. */
export async function assertManagedGitWorkspace(state: GitWorkflowSettingsResponse, workspace: string): Promise<void> {
  if (state.task.kind !== "managed") return;
  const task = state.task.settings;
  let checkout;
  try { checkout = (await listWorktrees(workspace)).find((tree) => samePath(tree.path, workspace)); }
  catch { throw new ManagedGitAccessError("Selected Git workspace is unavailable."); }
  if (!checkout) throw new ManagedGitAccessError("A registered checkout root is required.");
  if (task.workspace === "worktree" && checkout.isMain) throw new ManagedGitAccessError("This task requires a linked feature worktree, not the primary checkout.");
  if (task.workspace === "current" && task.branch && checkout.branch !== task.branch) {
    throw new ManagedGitAccessError(`This task requires branch ${task.branch}. Select that workspace or explicitly apply different task settings.`);
  }
}

/** Revocation cancels a cancellable check, never interrupts a ref/index apply. */
export async function watchManagedGitAccess(
  assert: () => Promise<unknown>, parent?: AbortSignal,
): Promise<{ signal: AbortSignal; dispose: () => void }> {
  await assert();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  let pending = false;
  const timer = setInterval(() => {
    if (pending || controller.signal.aborted) return;
    pending = true;
    void assert().catch(cancel).finally(() => { pending = false; });
  }, 250);
  timer.unref?.();
  return { signal: controller.signal, dispose: () => { clearInterval(timer); parent?.removeEventListener("abort", cancel); } };
}
