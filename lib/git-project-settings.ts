import { createHash } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { GIT_WORKFLOW_TYPE } from "./git-workflow-policy";
import { readGitProjectSessionSettings } from "./git-project-session";
import { gitProjectResourceSummary, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { readGitWorkflowSettingsDocument, projectWorkflowOverrides } from "./git-workflow-settings-store";
import { resolveGitWorkflowSettings, type GitWorkflowSettingsResponse } from "./git-workflow-settings";
import { readGitWorkflowWriteEpoch } from "./git-workflow-write-epoch";
import type { SessionEntry } from "./types";

/**
 * Project-keyed preferences only. Never project an unqualified captured task or
 * old chat preference onto the repository selected by this request. The actual
 * caller identity is part of the revision; resource selection is not consent.
 */
export async function loadGitProjectSettings(
  selection: GitProjectResources, entries: readonly SessionEntry[] = [], agentDir = getAgentDir(), sessionIdentity = "",
): Promise<GitWorkflowSettingsResponse> {
  const document = readGitWorkflowSettingsDocument(agentDir);
  const project = await projectWorkflowOverrides(document, selection.projectRoot, selection.projectRoot, agentDir);
  const scoped = readGitProjectSessionSettings(entries);
  const session = sessionIdentity ? scoped.get(selection.projectRoot)?.overrides ?? {} : null;
  const legacySessionSettings = !!sessionIdentity && entries.some((entry) => entry.type === "custom" && entry.customType === GIT_WORKFLOW_TYPE);
  const writeEpoch = readGitWorkflowWriteEpoch(agentDir);
  await revalidateGitProjectResources(selection);
  const revision = createHash("sha256").update(JSON.stringify({ document, selection, project, sessionIdentity, session, writeEpoch })).digest("hex");
  return {
    revision, paused: document.paused, cwd: selection.cwd, projectRoot: selection.projectRoot,
    selection: gitProjectResourceSummary(selection), sessionScope: "project", legacySessionSettings,
    global: document.global, project, session,
    resolved: { global: resolveGitWorkflowSettings(document.global), project: resolveGitWorkflowSettings(document.global, project),
      session: resolveGitWorkflowSettings(document.global, project, session ?? {}) },
    task: { kind: "none" }, sessionEditable: false,
  };
}
