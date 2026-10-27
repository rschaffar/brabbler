/** Shared wire contract; notes are personal data, never agent context. */
export const SCRATCHPAD_MAX_LENGTH = 100_000;
export interface ScratchpadNote { text: string; revision: string }
/** String scopes are legacy session IDs; null remains the original Global scope. */
export type ScratchpadScope = string | null | { projectId: string };
export interface ScratchpadProject { projectId: string; root: string }
export function validScratchpadScope(value: unknown): value is ScratchpadScope {
  if (value === null || (typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value))) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scope = value as { projectId?: unknown };
  return Object.keys(scope).length === 1 && typeof scope.projectId === "string" && /^[a-f0-9]{64}$/.test(scope.projectId);
}
export function scratchpadScopeFields(scope: ScratchpadScope): { sessionId: string | null } | { projectId: string } {
  return typeof scope === "object" && scope !== null ? { projectId: scope.projectId } : { sessionId: scope };
}
export function validScratchpadNote(value: unknown): value is ScratchpadNote {
  if (!value || typeof value !== "object") return false;
  const note = value as ScratchpadNote;
  return typeof note.text === "string" && note.text.length <= SCRATCHPAD_MAX_LENGTH
    && typeof note.revision === "string" && /^[a-f0-9]{64}$/.test(note.revision);
}
