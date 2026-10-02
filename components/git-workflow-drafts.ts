import {
  resolveGitWorkflowSettings,
  type GitWorkflowField, type GitWorkflowOverrides, type GitWorkflowSettingsResponse, type WorkflowScope,
} from "../lib/git-workflow-settings";

import type { GitCheckRecipe } from "../lib/git-check-recipe";

/** Raw typing may be incomplete. Change only the edited legacy field; retain extensions and omission. */
export function editWorkflowCheck(check: GitCheckRecipe, part: "label" | "executable" | "arguments", value: string): GitCheckRecipe {
  return {
    ...check,
    ...(Object.hasOwn(check, "env") ? { env: { ...check.env } } : {}),
    label: part === "label" ? value : check.label,
    argv: part === "executable" ? [value, ...check.argv.slice(1)]
      : part === "arguments" ? [check.argv[0], ...(value === "" ? [] : value.split("\n"))] : [...check.argv],
  };
}

export const workflowScopes: WorkflowScope[] = ["global", "project", "session"];
export const workflowFields: GitWorkflowField[] = [
  "enabled", "managedGitToolsOnly", "workspace", "mainBranch", "baseBranch", "branch", "onCreate", "workspaceConfirmation",
  "commits", "commitConfirmation", "checks", "checkConfirmation", "targetBranch", "delivery", "method",
  "prepareConfirmation", "integrateConfirmation", "cleanup", "cleanupConfirmation",
];
export type WorkflowDraft = {
  baseline: GitWorkflowOverrides;
  overrides: GitWorkflowOverrides;
  revision: string;
  error?: string;
  conflict?: boolean;
};
export type WorkflowDrafts = Record<string, WorkflowDraft>;

/** Canonical project identity comes from the server, never from a sidebar label. */
export function workflowDraftKey(scope: WorkflowScope, projectRoot?: string, sessionId?: string, sessionScope?: "project"): string | null {
  if (scope === "global") return "global";
  if (scope === "project") return projectRoot ? `project:${projectRoot}` : null;
  if (sessionScope === "project") return sessionId && projectRoot ? `session:${sessionId}:project:${projectRoot}` : null;
  return sessionId ? `session:${sessionId}` : null;
}

export function changedWorkflowFields(a: GitWorkflowOverrides, b: GitWorkflowOverrides): GitWorkflowField[] {
  return workflowFields.filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]));
}

export function resetWorkflowField(overrides: GitWorkflowOverrides, field: GitWorkflowField): GitWorkflowOverrides {
  const next = { ...overrides };
  delete next[field]; // Absence inherits; false, null and [] are explicit values.
  return next;
}

/** Explicit editor choice for a NEW agent-commit setup, never a migration of saved settings or captured tasks.
 * The preference alone is not an Allow or a request to execute without asking. */
export function configureNewAgentCommits(overrides: GitWorkflowOverrides): GitWorkflowOverrides {
  return { ...overrides, commits: "ask", commitConfirmation: "none" };
}

/**
 * Refresh clean scopes, but never overwrite a draft whose saved baseline changed.
 * A 409 is sticky: only an explicit successful discard/reload resolves it. An
 * unrelated successful save can advance a still-matching baseline's revision.
 */
export function receiveWorkflowSettings(
  drafts: WorkflowDrafts,
  response: GitWorkflowSettingsResponse,
  sessionId?: string,
  replaceKey?: string,
): WorkflowDrafts {
  const next = { ...drafts };
  for (const scope of workflowScopes) {
    const key = workflowDraftKey(scope, response.projectRoot, sessionId, response.sessionScope);
    const saved = response[scope];
    if (!key || saved === null) continue;
    const existing = drafts[key];
    if (key === replaceKey || !existing || (!existing.conflict && !changedWorkflowFields(existing.baseline, existing.overrides).length)) {
      next[key] = { baseline: saved, overrides: saved, revision: response.revision };
    } else if (existing.conflict || changedWorkflowFields(existing.baseline, saved).length) {
      next[key] = { ...existing, conflict: true, error: existing.error ?? "Saved settings changed. Your draft has been kept. Reload and discard this draft to use the latest settings." };
    } else {
      next[key] = { ...existing, revision: response.revision };
    }
  }
  return next;
}

export function workflowRequestTarget(sessionId?: string, cwd?: string, projectPath?: string) {
  if (projectPath !== undefined) return { ...(sessionId ? { sessionId } : {}), projectPath };
  return sessionId ? { sessionId } : cwd ? { cwd } : {};
}

/** Selected scope's draft + saved parents only; never unsaved parent drafts. */
export function resolveWorkflowDraft(data: GitWorkflowSettingsResponse, scope: WorkflowScope, draft: GitWorkflowOverrides) {
  const resolve = (overrides: GitWorkflowOverrides) => resolveGitWorkflowSettings(
    scope === "global" ? overrides : data.global,
    scope === "global" ? undefined : scope === "project" ? overrides : data.project,
    scope === "session" ? overrides : undefined,
  );
  try { return { ...resolve(draft), validationError: undefined as string | undefined }; }
  catch (cause) {
    // Text/argv inputs can be incomplete while typing. Keep that raw draft
    // visible without making it executable or letting the strict resolver crash
    // the editor. Saving remains blocked until the shared resolver accepts it.
    const inherited = resolve({});
    return {
      values: { ...inherited.values, ...draft },
      origins: Object.assign({}, inherited.origins, Object.fromEntries(Object.keys(draft).map((key) => [key, scope]))),
      validationError: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** Only persistence failures permit a cwd-only fallback, not arbitrary access errors. */
export function isUnpersistedWorkflowSession(status: number, message: string): boolean {
  return status === 404 || /not persisted|not yet saved|unsaved session/i.test(message);
}
