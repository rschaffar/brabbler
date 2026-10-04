import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { readGitCleanupRemovalAuthority, readGitCleanupNativeProof } from "./git-cleanup-operation";
import type { GitMutationInvocationAuthority } from "./git-mutation-invocation";
import { readProjectAuthorization, type ProjectAuthorizationOwner } from "./git-project-authorization";
import { gitProjectResourceSummary, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { GIT_WORKFLOW_TYPE } from "./git-workflow-policy";
import { readManagedSessionGitWorkflow } from "./git-workflow-session";
import { readGitProjectSessionSettings } from "./git-project-session";
import { readGitWorkflowSettingsDocument, projectWorkflowOverrides } from "./git-workflow-settings-store";
import { resolveGitWorkflowSettings, type GitWorkflowSettingsResponse } from "./git-workflow-settings";
import { readGitWorkflowWriteEpoch } from "./git-workflow-write-epoch";
import { bindGitWorkflowPolicyRevision, captureGitScopedAuthorityRevision, readGitScopedAuthorityRevision } from "./git-scoped-authority";
import { readSessionHeader } from "./session-reader";
import type { SessionEntry } from "./types";

/** Original caller identity, NOT a claim that its deliberately removed checkout
 * still exists. Only the fixed private native candidate↔invocation↔proof reader
 * can admit this read-only route. The runtime must also retain/assert its original
 * authority fence; none of these metadata reads grants native execution. */
export interface GitCleanupCallerScope {
  candidate: object;
  removal: object;
  caller: Readonly<GitProjectResources>;
  owner: Readonly<ProjectAuthorizationOwner>;
  invocationOwner: GitMutationInvocationAuthority["owner"];
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function refuse(): never { throw new Error("Original native own-caller removal required"); }
function absent(path: string): boolean {
  try { lstatSync(path); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}
function originalScope(scope: GitCleanupCallerScope) {
  const authority = readGitCleanupRemovalAuthority(scope.candidate, scope.removal);
  const proof = readGitCleanupNativeProof(scope.removal), header = readSessionHeader(scope.owner.sessionFile);
  if (header?.id !== scope.owner.sessionId || header.cwd !== scope.owner.sessionCwd) refuse();
  if (!authority || !proof || proof.kind !== "removed" || authority.binding.kind !== "cleanup" ||
    !isDeepStrictEqual(authority.binding.owner, scope.invocationOwner) ||
    scope.owner.sessionId !== scope.invocationOwner.sessionId || scope.owner.sessionFile !== scope.invocationOwner.sessionFile ||
    !isDeepStrictEqual(authority.binding.source, scope.caller) ||
    !(scope.owner.sessionCwd === scope.caller.cwd || scope.owner.sessionCwd.startsWith(`${scope.caller.cwd}/`)) ||
    proof.sourcePath !== scope.caller.cwd || proof.adminPath !== scope.caller.gitDir ||
    !isDeepStrictEqual(proof.sourceIdentity, scope.caller.identities.checkout) ||
    !absent(scope.caller.cwd) || !absent(scope.caller.gitDir)) refuse();
  const evidence = authority.evidence;
  for (const surviving of [evidence.integration.target, evidence.main]) {
    if (surviving.projectRoot !== scope.caller.projectRoot || surviving.commonDir !== scope.caller.commonDir ||
      !isDeepStrictEqual(surviving.identities.project, scope.caller.identities.project) ||
      !isDeepStrictEqual(surviving.identities.common, scope.caller.identities.common)) refuse();
  }
  return evidence;
}
async function validateSurvivors(scope: GitCleanupCallerScope) {
  const evidence = originalScope(scope);
  await revalidateGitProjectResources(evidence.integration.target);
  await revalidateGitProjectResources(evidence.main);
  originalScope(scope);
}

/** Same canonical Project/Chat×Project policy semantics as loadGitProjectSettings,
 * but absence is independently proven by the ORIGINAL native removal instead of
 * pretending that source still passes ordinary resource-existence validation. */
export async function readGitCleanupCallerPolicy(scope: GitCleanupCallerScope, entries: readonly SessionEntry[], agentDir: string) {
  originalScope(scope);
  const selection = scope.caller, sessionIdentity = scope.owner.sessionId;
  const authorityScope = { domains: ["settings"] as const, projectRoots: [selection.projectRoot], sessionId: sessionIdentity };
  const original = captureGitScopedAuthorityRevision(agentDir)(authorityScope);
  const document = readGitWorkflowSettingsDocument(agentDir);
  const project = await projectWorkflowOverrides(document, selection.projectRoot, selection.projectRoot, agentDir);
  const session = readGitProjectSessionSettings(entries).get(selection.projectRoot)?.overrides ?? {};
  const optedOut = readManagedSessionGitWorkflow(entries)?.optedOut === true;
  const legacySessionSettings = entries.some((entry) => entry.type === "custom" && entry.customType === GIT_WORKFLOW_TYPE);
  const writeEpoch = readGitWorkflowWriteEpoch(agentDir);
  await validateSurvivors(scope);
  if (readGitScopedAuthorityRevision(agentDir, authorityScope) !== original) refuse();
  const revision = hash({ document, selection, project, sessionIdentity, session, optedOut, writeEpoch });
  const policyRevision = hash({ original, global: document.global, paused: document.paused,
    projectRoot: selection.projectRoot, project, sessionIdentity, session, optedOut });
  return bindGitWorkflowPolicyRevision({
    revision, paused: document.paused, optedOut, cwd: selection.cwd, projectRoot: selection.projectRoot,
    selection: gitProjectResourceSummary(selection), sessionScope: "project", legacySessionSettings,
    global: document.global, project, session,
    resolved: { global: resolveGitWorkflowSettings(document.global), project: resolveGitWorkflowSettings(document.global, project),
      session: resolveGitWorkflowSettings(document.global, project, session) },
    task: { kind: "none" }, sessionEditable: false,
  } satisfies GitWorkflowSettingsResponse, policyRevision);
}

/** Grants are keyed by canonical project/common identity and the ORIGINAL saved
 * owner, not checkout. The genuine surviving target is only a physical witness
 * for that SAME original project: it never becomes the caller or its cwd. */
export async function readGitCleanupCallerAuthorization(scope: GitCleanupCallerScope, agentDir: string) {
  const evidence = originalScope(scope);
  await validateSurvivors(scope);
  const status = await readProjectAuthorization(evidence.integration.target, scope.owner, agentDir);
  await validateSurvivors(scope);
  return status;
}
