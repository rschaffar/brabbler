import {
  resolveGitWorkflowSettings,
  type GitWorkflowField, type GitWorkflowOverrides, type GitWorkflowSettingsResponse, type WorkflowScope,
} from "../lib/git-workflow-settings";

import { MAX_GIT_CHECK_ENV_ENTRIES, validateGitCheckRecipe, type GitCheckRecipe } from "../lib/git-check-recipe";

export type WorkflowEnvRow = { id: string; name: string; value: string };
export type WorkflowRecipeEditor = { id: string; envRows: WorkflowEnvRow[]; envEdited?: boolean };

/** Draft-only identities do not depend on editable names or labels. Never serialize them as recipes. */
export function createWorkflowRecipeEditors(checks: GitCheckRecipe[], prefix: string): WorkflowRecipeEditor[] {
  return checks.map((check, index) => ({ id: `${prefix}:recipe:${index}`, envRows: Object.entries(check.env ?? {}).map(([name, value], row) =>
    ({ id: `${prefix}:recipe:${index}:env:${row}`, name, value })) }));
}

/** Validate the complete row list before constructing an object: no duplicate-key last-wins conversion. */
export function parseWorkflowEnvironment(rows: WorkflowEnvRow[]): Record<string, string> | undefined {
  if (!Array.isArray(rows) || rows.length > MAX_GIT_CHECK_ENV_ENTRIES) throw new Error("Too many environment rows");
  const names = new Set<string>(), ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)
      || typeof row.name !== "string" || typeof row.value !== "string") throw new Error("Invalid literal environment row");
    ids.add(row.id);
    if (names.has(row.name.toUpperCase())) throw new Error("Duplicate environment names (case-insensitive)");
    names.add(row.name.toUpperCase());
  }
  if (!rows.length) return undefined; // Explicit removal restores omission, not a manufactured {}.
  return validateGitCheckRecipe({ label: "Environment", argv: ["true"], env: Object.fromEntries(rows.map(({ name, value }) => [name, value])) }).env;
}

function recipeWithEnvironment(check: GitCheckRecipe, rows: WorkflowEnvRow[]): GitCheckRecipe {
  const env = parseWorkflowEnvironment(rows);
  const next = { ...check };
  if (env === undefined) delete next.env;
  else next.env = env;
  return next;
}

/** Blank selects omission; explicit integration and '.' remain distinct from omitted defaults. */
export function editWorkflowCheckOptional(check: GitCheckRecipe, field: "cwd" | "requiredStage", value: string): GitCheckRecipe {
  const next = { ...check, argv: [...check.argv], ...(Object.hasOwn(check, "env") ? { env: { ...check.env } } : {}) };
  if (value === "") delete next[field];
  else Object.assign(next, { [field]: value }); // Incomplete text stays visible; the shared validator blocks Save.
  return next;
}

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
  recipeEditors?: WorkflowRecipeEditor[];
  error?: string;
  conflict?: boolean;
};
export type WorkflowDrafts = Record<string, WorkflowDraft>;

/** Raw rows survive invalid edits in metadata. The last valid env is never used to save an invalid draft. */
export function editWorkflowCheckEnvironment(draft: WorkflowDraft, checks: GitCheckRecipe[], index: number, rows: WorkflowEnvRow[]): WorkflowDraft {
  const editors = draft.recipeEditors ?? createWorkflowRecipeEditors(checks, "draft");
  if (!editors[index] || !checks[index]) throw new Error("Unknown recipe editor");
  const recipeEditors = editors.map((editor, i) => i === index ? { ...editor, envRows: rows.map((row) => ({ ...row })), envEdited: true } : editor);
  const next = [...checks];
  try { next[index] = recipeWithEnvironment(checks[index], rows); }
  catch { /* Keep all raw rows, including duplicates; validation below blocks saving. */ }
  return { ...draft, overrides: { ...draft.overrides, checks: next }, recipeEditors };
}

/** Save payload contains only recipe fields, never raw rows or editor identities. Throws on invalid rows. */
export function workflowDraftOverrides(draft: Pick<WorkflowDraft, "overrides" | "recipeEditors">): GitWorkflowOverrides {
  if (!draft.recipeEditors?.some((editor) => editor.envEdited)) return draft.overrides;
  const checks = draft.overrides.checks;
  if (!checks || checks.length !== draft.recipeEditors.length) throw new Error("Recipe draft identities changed; review the draft");
  return { ...draft.overrides, checks: checks.map((check, index) => draft.recipeEditors![index].envEdited
    ? recipeWithEnvironment(check, draft.recipeEditors![index].envRows) : check) };
}

export function changedWorkflowDraftFields(draft: WorkflowDraft): GitWorkflowField[] {
  try { return changedWorkflowFields(draft.baseline, workflowDraftOverrides(draft)); }
  catch {
    const fields = changedWorkflowFields(draft.baseline, draft.overrides);
    return fields.includes("checks") ? fields : [...fields, "checks"];
  }
}

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
    if (key === replaceKey || !existing || (!existing.conflict && !changedWorkflowDraftFields(existing).length)) {
      const checks = resolveWorkflowDraft(response, scope, saved).values.checks;
      next[key] = { baseline: saved, overrides: saved, revision: response.revision, recipeEditors: createWorkflowRecipeEditors(checks, key) };
    } else if (existing.conflict || changedWorkflowFields(existing.baseline, saved).length) {
      next[key] = { ...existing, conflict: true,
        recipeEditors: Object.hasOwn(existing.overrides, "checks") ? existing.recipeEditors
          : createWorkflowRecipeEditors(resolveWorkflowDraft(response, scope, existing.overrides).values.checks, key),
        error: existing.error ?? "Saved settings changed. Your draft has been kept. Reload and discard this draft to use the latest settings." };
    } else {
      next[key] = { ...existing, revision: response.revision,
        recipeEditors: Object.hasOwn(existing.overrides, "checks") ? existing.recipeEditors
          : createWorkflowRecipeEditors(resolveWorkflowDraft(response, scope, existing.overrides).values.checks, key) };
    }
  }
  return next;
}

export function workflowRequestTarget(sessionId?: string, cwd?: string, projectPath?: string) {
  if (projectPath !== undefined) return { ...(sessionId ? { sessionId } : {}), projectPath };
  return sessionId ? { sessionId } : cwd ? { cwd } : {};
}

/** Selected scope's draft + saved parents only; never unsaved parent drafts. */
export function resolveWorkflowDraft(data: GitWorkflowSettingsResponse, scope: WorkflowScope, draft: GitWorkflowOverrides, recipeEditors?: WorkflowRecipeEditor[]) {
  const resolve = (overrides: GitWorkflowOverrides) => resolveGitWorkflowSettings(
    scope === "global" ? overrides : data.global,
    scope === "global" ? undefined : scope === "project" ? overrides : data.project,
    scope === "session" ? overrides : undefined,
  );
  try { return { ...resolve(workflowDraftOverrides({ overrides: draft, recipeEditors })), validationError: undefined as string | undefined }; }
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
