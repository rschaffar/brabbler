import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { applyWorkflowSettings, responseFor, SettingsError, target } from "@/app/api/git/workflow/settings/service";
import { revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { GIT_WORKFLOW_FIELDS, resolveGitWorkflowSettings, validateGitWorkflowOverrides, validateGitWorkflowScopeOverrides, type GitWorkflowField, type GitWorkflowOverrides, type GitWorkflowSettings, type WorkflowScope } from "./git-workflow-settings";
import { samePath } from "./paths";
import { readSessionHeader, resolveSessionPath } from "./session-reader";

const TTL = 30 * 60_000;
const MAX = 64;
const ID = /^[0-9a-f-]{36}$/;
type Change = { field: GitWorkflowField; inherit: boolean; value?: GitWorkflowOverrides[GitWorkflowField] };
type Proposal = {
  id: string; ownerId: string; ownerFile: string; ownerDev: number; ownerIno: number; ownerCwd: string;
  scope: WorkflowScope; projectPath?: string; selection?: GitProjectResources; revision: string;
  changes: Change[]; before: GitWorkflowOverrides; after: GitWorkflowOverrides;
  effectiveBefore: GitWorkflowSettings; effectiveAfter: GitWorkflowSettings;
  created: number; state: "pending" | "applied" | "dismissed" | "stale"; inFlight: boolean;
};
const registry = globalThis as typeof globalThis & { __gitSettingsProposals?: Map<string, Proposal> };
function proposals() { return registry.__gitSettingsProposals ??= new Map<string, Proposal>(); }
function prune() {
  const map = proposals();
  for (const [id, item] of map) if (Date.now() - item.created > TTL) map.delete(id);
  while (map.size >= MAX) map.delete(map.keys().next().value!);
}
function changesFrom(input: unknown): Change[] {
  if (!Array.isArray(input) || !input.length || input.length > GIT_WORKFLOW_FIELDS.length) throw new SettingsError(`Choose 1–${GIT_WORKFLOW_FIELDS.length} workflow fields`, 400);
  const seen = new Set<string>();
  return input.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new SettingsError("Invalid proposal change", 400);
    const row = item as Record<string, unknown>;
    if (typeof row.field !== "string" || !GIT_WORKFLOW_FIELDS.includes(row.field as GitWorkflowField) || seen.has(row.field)
      || Object.keys(row).some((key) => key !== "field" && key !== "value")) throw new SettingsError("Unknown or duplicate workflow field", 400);
    seen.add(row.field);
    if (!Object.hasOwn(row, "value")) return { field: row.field as GitWorkflowField, inherit: true };
    const checked = validateGitWorkflowOverrides({ [row.field]: row.value });
    return { field: row.field as GitWorkflowField, inherit: false, value: checked[row.field as GitWorkflowField] };
  });
}
function ownerStat(file: string) { const stat = statSync(file); return { dev: stat.dev, ino: stat.ino }; }
async function owner(id: string) {
  const t = await target({ sessionId: id });
  if (!t.file || !t.cwd || !t.manager || !t.id || !t.manager.isPersisted()
    || t.manager.getEntries().some((e) => e.type === "custom" && e.customType === "pi-web:subagent")) {
    throw new SettingsError("Persisted ordinary chat required", 409);
  }
  return t;
}
function request(item: Proposal): Record<string, unknown> {
  return { scope: item.scope, revision: item.revision, ...(item.projectPath ? { projectPath: item.projectPath } : {}),
    ...(item.scope === "session" ? { sessionId: item.ownerId } : {}) };
}
async function assertOwner(item: Proposal, id: string) {
  if (id !== item.ownerId || await resolveSessionPath(id) !== item.ownerFile) throw new SettingsError("Proposal belongs to another chat", 403);
  const header = readSessionHeader(item.ownerFile);
  const info = ownerStat(item.ownerFile);
  if (header?.id !== id || !samePath(header.cwd ?? "", item.ownerCwd) || info.dev !== item.ownerDev || info.ino !== item.ownerIno) {
    throw new SettingsError("Proposal chat identity changed; request a new proposal");
  }
  // Recheck ordinary-chat eligibility even for Global/Project writes. A
  // changed session must never keep a proposal from its earlier identity.
  if ((await owner(id)).file !== item.ownerFile) throw new SettingsError("Proposal chat identity changed; request a new proposal");
  if (item.selection) await revalidateGitProjectResources(item.selection);
}
export async function proposeGitSettings(sessionId: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > 16_384) throw new SettingsError("Invalid settings proposal", 400);
  const args = input as Record<string, unknown>;
  if (Object.keys(args).some((key) => !["scope", "repositoryPath", "changes"].includes(key))
    || !["global", "project", "session"].includes(args.scope as string)
    || (args.repositoryPath !== undefined && typeof args.repositoryPath !== "string")
    || (args.scope === "global" && args.repositoryPath !== undefined)
    || (args.scope === "project" && args.repositoryPath === undefined)) throw new SettingsError("Select a valid scope and physical project checkout", 400);
  const scope = args.scope as WorkflowScope;
  const changes = changesFrom(args.changes);
  const t = await owner(sessionId);
  const path = args.repositoryPath as string | undefined;
  const selected = path ? await target({ projectPath: path }) : undefined;
  const destination = scope === "session" ? await target({ sessionId, ...(path ? { projectPath: path } : {}) })
    : await target(path ? { projectPath: path } : {});
  const before = await responseFor(destination);
  if (scope === "project" && !before.projectRoot) throw new SettingsError("Select a project", 400);
  const original = { ...(before[scope] ?? {}) };
  const after = { ...original };
  for (const change of changes) {
    if (change.inherit) delete after[change.field];
    else Object.assign(after, { [change.field]: change.value });
  }
  validateGitWorkflowScopeOverrides(after, scope, original);
  const effectiveAfter = scope === "global" ? resolveGitWorkflowSettings(after).values
    : scope === "project" ? resolveGitWorkflowSettings(before.global, after).values
      : resolveGitWorkflowSettings(before.global, before.project, after).values;
  prune();
  const stat = ownerStat(t.file!);
  const item: Proposal = { id: randomUUID(), ownerId: sessionId, ownerFile: t.file!, ownerCwd: t.cwd!, ownerDev: stat.dev, ownerIno: stat.ino,
    scope, ...(path ? { projectPath: path, selection: selected!.selection! } : {}), revision: before.revision,
    changes, before: original, after, effectiveBefore: before.resolved[scope].values, effectiveAfter,
    created: Date.now(), state: "pending", inFlight: false };
  proposals().set(item.id, item);
  return item.id;
}
function find(id: string) {
  if (!ID.test(id)) throw new SettingsError("Invalid proposal id", 400);
  const item = proposals().get(id);
  if (!item) throw new SettingsError("Proposal expired or server restarted; request a new proposal", 410);
  return item;
}
export async function gitSettingsProposal(id: string, sessionId: string) {
  const item = find(id);
  await assertOwner(item, sessionId);
  let state = item.state;
  let canApply = item.scope !== "session";
  if (state === "pending") {
    if (Date.now() - item.created > TTL) { item.state = state = "stale"; }
    else {
      try {
        const current = await responseFor(await target(request(item)));
        if (current.revision !== item.revision) item.state = state = "stale";
        else if (item.scope === "session") canApply = current.sessionEditable;
      } catch { item.state = state = "stale"; }
    }
  }
  return { id, scope: item.scope, projectRoot: item.selection?.projectRoot, projectPath: item.projectPath,
    changes: item.changes, before: item.before, after: item.after,
    effectiveBefore: item.effectiveBefore, effectiveAfter: item.effectiveAfter, state, created: item.created,
    expires: item.created + TTL, idleRequired: item.scope === "session", canApply, inFlight: item.inFlight };
}
export async function decideGitSettingsProposal(id: string, sessionId: string, decision: "apply" | "dismiss") {
  const item = find(id);
  await assertOwner(item, sessionId);
  if (item.state !== "pending" || item.inFlight) throw new SettingsError("Proposal already handled or stale. Request a new proposal.");
  if (Date.now() - item.created > TTL) { item.state = "stale"; throw new SettingsError("Proposal expired. Request a new proposal."); }
  if (decision === "dismiss") { item.state = "dismissed"; return; }
  item.inFlight = true;
  let wrote = false;
  try {
    const result = await applyWorkflowSettings(request(item), async (t, before) => {
      await assertOwner(item, sessionId);
      if (before.revision !== item.revision || JSON.stringify(before[item.scope] ?? {}) !== JSON.stringify(item.before)
        || (item.scope === "session" && !t.manager)) throw new SettingsError("Settings changed; reload and request a new proposal.");
      return { ...request(item), overrides: item.after };
    }, () => { wrote = true; item.state = "applied"; });
    return result;
  } catch (cause) {
    // A run or Git transaction can end without changing the saved candidate.
    // All other failures need a new review, not a silent rebase of the proposal.
    if (!wrote && !(cause instanceof SettingsError && item.scope === "session"
      && (cause.message.includes("Stop the chat") || cause.message.includes("Checkout is busy")))) item.state = "stale";
    throw cause;
  } finally { item.inFlight = false; }
}
export function resetGitSettingsProposalsForTest() { proposals().clear(); }
