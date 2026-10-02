import { lstatSync, realpathSync } from "node:fs";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { loadGitProjectSettings } from "./git-project-settings";
import { readProjectAuthorization } from "./git-project-authorization";
import { revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { hasFreshCommitPolicyProvenance } from "./git-workflow-session";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import { managedGitPermission, selectedProjectCommitEligibility } from "./git-workflow-permissions";
import { managedGitSessionFacts, ManagedGitAccessError } from "./git-workflow-access";
import { samePath } from "./paths";
import type { SessionEntry } from "./types";

/** Agent-only live gate. Neither creation provenance nor saved Allow alone is
 * authority. Call at capture and again in the native pre-CAS callback. Ask keeps
 * its separate exact-candidate decision; human/legacy routes never use this. */
export async function assertAgentGitCommitAuthorization(options: {
  sessionCwd: string;
  manager: Pick<SessionManager, "getSessionId" | "getSessionFile" | "getCwd" | "getHeader" | "getEntries">;
  selected: GitProjectResources;
  explicitProject?: boolean;
  confirmation: "ask" | "none";
  effectiveTools: () => readonly string[] | undefined;
  agentDir?: string;
}): Promise<void> {
  const { manager, selected, sessionCwd } = options;
  const agentDir = options.agentDir ?? getAgentDir();
  const refuse = (reason: string): never => { throw new ManagedGitAccessError(reason); };
  const sessionId = manager.getSessionId?.(), sessionFile = manager.getSessionFile?.();
  if (!sessionId || !sessionFile || !samePath(manager.getCwd?.() ?? "", sessionCwd)
    || manager.getHeader?.()?.id !== sessionId || !samePath(manager.getHeader?.()?.cwd ?? "", sessionCwd)) {
    refuse("A persisted ordinary chat with a stable checkout is required for agent commit authorization.");
  }
  const owner = { sessionId, sessionFile: sessionFile!, sessionCwd };
  await revalidateGitProjectResources(selected);
  const entries = manager.getEntries() as unknown as SessionEntry[];
  const facts = managedGitSessionFacts(entries, options.effectiveTools());
  const caller = await loadGitWorkflowSettings(sessionCwd, entries, agentDir, sessionId);
  // Selected-project Ask retains its existing non-widening caller clamp.
  if (options.explicitProject && (caller.task.kind === "legacy" || caller.task.kind === "managed"
    && (!caller.task.settings.enabled || caller.task.settings.commits !== "ask"))) {
    refuse("Calling chat's captured task or legacy policy does not permit a selected-project agent commit.");
  }
  // The caller's canonical Project/Chat×Project restriction overlay is a
  // negative-only clamp, including for explicit-project Ask. B's permissive
  // settings must never substitute for disabled/Off/Manual caller settings in A.
  // loadGitWorkflowSettings resolves this overlay canonically even for nested cwds.
  const permission = managedGitPermission(caller, facts, "commit", "agent");
  if (permission.kind === "blocked") refuse(permission.reason);
  const callerEligibility = selectedProjectCommitEligibility(caller, facts, "agent");
  if (callerEligibility.kind !== "confirmation-required") refuse(callerEligibility.reason);
  if (options.confirmation === "none") {
    if (process.platform !== "linux" || !samePath(agentDir, getAgentDir())) {
      refuse("No-prompt commits require Linux physical-resource verification and matching private history/authorization roots.");
    }
    if (caller.task.kind !== "managed" || !caller.task.settings.enabled || caller.task.settings.commits !== "ask") {
      refuse("No-prompt commits require an enabled managed Ask caller task; legacy or absent tasks are not upgraded.");
    }
    // Read the actual persisted file's complete history and header. SDK
    // isPersisted() only means disk-backed; a branch view or claimed marker id
    // must not manufacture ordinary creation provenance.
    try {
      const stat = lstatSync(sessionFile!);
      if (!stat.isFile() || stat.isSymbolicLink() || !samePath(realpathSync(sessionFile!), sessionFile!)) throw new Error("file");
      const persisted = SessionManager.open(sessionFile!, undefined);
      const header = persisted.getHeader();
      const persistedEntries = persisted.getEntries() as unknown as SessionEntry[];
      const persistedCaller = await loadGitWorkflowSettings(sessionCwd, persistedEntries, agentDir, sessionId);
      if (persistedCaller.task.kind !== "managed" || !persistedCaller.task.settings.enabled || persistedCaller.task.settings.commits !== "ask"
        || managedGitPermission(persistedCaller, managedGitSessionFacts(persistedEntries, options.effectiveTools()), "commit", "agent").kind === "blocked") throw new Error("persisted task");
      if (persisted.getSessionId() !== sessionId || !samePath(header?.cwd ?? "", sessionCwd)
        || !hasFreshCommitPolicyProvenance(persistedEntries, { sessionId, header, persisted: true })
        || !hasFreshCommitPolicyProvenance(entries, { sessionId, header, persisted: true })) throw new Error("origin");
    } catch {
      refuse("No-prompt commits require fresh untouched persisted ordinary creation provenance; old, copied or recaptured chats must use Ask.");
    }
  }
  // Keep the fresh selected policy/grant read last, after persisted provenance
  // IO. Never carry an authorization captured before that IO into the CAS gate.
  const live = await loadGitProjectSettings(selected, entries, agentDir, sessionId);
  const eligible = selectedProjectCommitEligibility(live, facts, "agent");
  if (eligible.kind !== "confirmation-required") refuse(eligible.reason);
  const authorization = await readProjectAuthorization(selected, owner, agentDir);
  if (authorization.actions.commit.effective === "deny") refuse("Selected-project commit authorization is denied or stale.");
  if (options.confirmation === "none" && (authorization.actions.commit.effective !== "allow" || live.resolved.session.values.commitConfirmation !== "none")) {
    refuse("No-prompt commit requires live selected confirmation:none and an effective saved Allow.");
  }
  // Applicable prose remains the agent's responsibility: choose Ask whenever
  // stronger repository/user instructions require review. No prose waiver is
  // inferred from this gate, provenance or authorization.
}

/** Bind a pending request to its original caller, never a manager's later id. */
export function agentGitCommitAuthorization(options: Parameters<typeof assertAgentGitCommitAuthorization>[0]): () => Promise<void> {
  const id = options.manager.getSessionId?.(), file = options.manager.getSessionFile?.();
  const assertCaller = () => {
    if (options.manager.getSessionId?.() !== id || options.manager.getSessionFile?.() !== file
      || !samePath(options.manager.getCwd?.() ?? "", options.sessionCwd)
      || options.manager.getHeader?.()?.id !== id || !samePath(options.manager.getHeader?.()?.cwd ?? "", options.sessionCwd)) {
      throw new ManagedGitAccessError("Agent commit caller changed; request a new candidate.");
    }
  };
  return async () => {
    assertCaller();
    await assertAgentGitCommitAuthorization(options);
    assertCaller();
  };
}
