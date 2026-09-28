import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import type { GitWorkflowSettingsResponse } from "./git-workflow-settings";
import type { SessionEntry } from "./types";
import { readSessionToolSelection } from "./session-tool-selection";
import { listWorktrees } from "./worktree";
import { samePath } from "./paths";

export type ManagedGitStage = "workspace" | "commit" | "checks" | "integration" | "settings";
export class ManagedGitAccessError extends Error {}
export function hasManagedGitMutationTools(tools: readonly string[]): boolean {
  return tools.some((name) => ["bash", "powershell", "edit", "write"].includes(name));
}

/** One live gate for browser actions and already-loaded tools. Not a shell sandbox. */
export async function assertManagedGitAction(
  cwd: string, entries: readonly SessionEntry[], stage: ManagedGitStage, actor: "agent" | "human", agentDir = getAgentDir(), effectiveTools?: readonly string[],
): Promise<GitWorkflowSettingsResponse> {
  if (entries.some((e) => e.type === "custom" && e.customType === "pi-web:subagent")) {
    throw new ManagedGitAccessError("Subagents cannot execute managed Git mutations.");
  }
  const tools = effectiveTools ?? readSessionToolSelection(entries);
  if (actor === "agent" && tools && !hasManagedGitMutationTools(tools)) {
    throw new ManagedGitAccessError("Chat-only and read-only sessions cannot execute managed Git mutations.");
  }
  let state: GitWorkflowSettingsResponse;
  try { state = await loadGitWorkflowSettings(cwd, entries, agentDir, "active-session"); }
  catch { throw new ManagedGitAccessError("Workflow settings are unavailable or unsupported; managed Git actions are blocked."); }
  if (state.paused) throw new ManagedGitAccessError("All managed Git actions are paused. Resume them in Workflow.");
  if (!state.resolved.session.values.enabled) throw new ManagedGitAccessError("Managed Git is disabled for this session. Configure it in Workflow.");
  if (stage === "commit" && state.resolved.session.values.commits === "off") throw new ManagedGitAccessError("Commits are disabled for this session.");
  if (state.task.kind === "managed") {
    const task = state.task.settings;
    if (!task.enabled) throw new ManagedGitAccessError("This task is disabled. Apply enabled settings explicitly in Workflow.");
    if (stage === "commit" && (task.commits === "off" || (actor === "agent" && task.commits === "manual"))) {
      throw new ManagedGitAccessError(task.commits === "off" ? "Commits are disabled for this task." : "Commits are manual for this task. Use the Workflow panel; do not bypass with a shell.");
    }
    if (stage === "workspace" && (task.workspace !== "worktree" || !task.baseBranch)) {
      throw new ManagedGitAccessError("This task has no configured worktree base. Configure and apply it in Workflow.");
    }
    if ((stage === "integration" || stage === "checks") && (!task.targetBranch || task.method !== "merge" || !task.checks.length)) {
      throw new ManagedGitAccessError("This task needs a local non-FF merge target and ordered checks. Configure and apply them in Workflow.");
    }
  }
  return state;
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
