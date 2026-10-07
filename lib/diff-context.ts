/** Complete immutable text for display only; an absent side is not an empty file. */
export interface DiffFileContents { name: string; contents: string; cacheKey: string }
export interface DiffContext { oldFile: DiffFileContents | null; newFile: DiffFileContents | null }
export type LoadDiffContext = (signal: AbortSignal) => Promise<DiffContext>;
export const MAX_DIFF_FILE_BYTES = 1024 * 1024;
export const MAX_DIFF_CONTEXT_LINES = 50_000;
export function countDiffTextLines(contents: string): number {
  return contents === "" ? 0 : contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0);
}
export class DiffContextError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
