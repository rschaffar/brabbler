/** Shared wire contract; notes are personal data, never agent context. */
export const SCRATCHPAD_MAX_LENGTH = 100_000;
export interface ScratchpadNote { text: string; revision: string }
export function validScratchpadScope(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value));
}
export function validScratchpadNote(value: unknown): value is ScratchpadNote {
  if (!value || typeof value !== "object") return false;
  const note = value as ScratchpadNote;
  return typeof note.text === "string" && note.text.length <= SCRATCHPAD_MAX_LENGTH
    && typeof note.revision === "string" && /^[a-f0-9]{64}$/.test(note.revision);
}
