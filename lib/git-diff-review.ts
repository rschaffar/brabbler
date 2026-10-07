import { parsePatchFiles, SPLIT_WITH_NEWLINES, type ExpansionDirections, type FileDiffMetadata } from "@pierre/diffs";
import { MAX_DIFF_CONTEXT_LINES, MAX_DIFF_FILE_BYTES, type DiffContext } from "./diff-context";

export type ReadingMode = "diff" | "before" | "after";
export interface DiffLineTarget { lineNumber: number; side: "additions" | "deletions" }
export interface ReviewAnchor extends DiffLineTarget { offset: number }
export interface DiffReviewModel {
  patch: string; file: FileDiffMetadata | null; fallback: string | null; context: DiffContext | null;
  full: boolean; reading: ReadingMode; changes: DiffLineTarget[]; changeIndex: number;
  expansions: Map<number, { fromStart: number; fromEnd: number }>;
  anchors: Partial<Record<ReadingMode, ReviewAnchor>>;
  scrollLeft: number; query: string;
}
let nextId = 0;
const lines = (contents: string) => contents === "" ? [] : contents.split(SPLIT_WITH_NEWLINES);

export function changeTargets(file: FileDiffMetadata): DiffLineTarget[] {
  const targets: DiffLineTarget[] = [];
  for (const hunk of file.hunks) {
    let oldLine = Math.max(1, hunk.deletionStart), newLine = Math.max(1, hunk.additionStart);
    for (const content of hunk.hunkContent) {
      if (content.type === "context") { oldLine += content.lines; newLine += content.lines; }
      else {
        targets.push(content.additions ? { lineNumber: newLine, side: "additions" } : { lineNumber: oldLine, side: "deletions" });
        oldLine += content.deletions; newLine += content.additions;
      }
    }
  }
  return targets;
}

/** A stable, comparison-local model; retain it while a file renderer is unmounted. */
export function createDiffReview(patch: string, comparison = ""): DiffReviewModel {
  let file: FileDiffMetadata | null = null, fallback: string | null = null;
  try {
    const parsed = parsePatchFiles(patch, undefined, true);
    if (parsed.length === 1 && parsed[0].files.length === 1) {
      file = parsed[0].files[0];
      file.cacheKey = `review:${++nextId}:${comparison}`;
      const count = file.hunks.flatMap((hunk) => hunk.hunkContent).reduce((sum, content) =>
        sum + (content.type === "context" ? content.lines : content.additions + content.deletions), 0);
      if (count > 2500) fallback = "Too many lines for the interactive diff; showing the complete raw patch.";
    } else if (parsed.length) fallback = "The patch could not be displayed as a diff; showing the raw patch.";
  } catch { fallback = "The patch could not be displayed as a diff; showing the raw patch."; }
  const model: DiffReviewModel = { patch, file, fallback, context: null, full: false, reading: "diff", changes: file ? changeTargets(file) : [],
    changeIndex: -1, expansions: new Map(), anchors: {}, scrollLeft: 0, query: "" };
  // An added/deleted text patch already contains the complete available side.
  if (file && ["new", "deleted"].includes(file.type) && [file.mode, file.prevMode].every((mode) => !mode || ["100644", "100755"].includes(mode))) {
    const contents = (file.type === "new" ? file.additionLines : file.deletionLines).join("");
    const value = { name: file.name, contents, cacheKey: `${file.cacheKey}:file` };
    if (!/^(?:GIT binary patch|Binary files .+ differ)$/m.test(patch)) {
      const context = file.type === "new" ? { oldFile: null, newFile: value } : { oldFile: value, newFile: null };
      try { validateReviewContext(model, context); model.context = context; } catch { /* Explicit server context may still be available. */ }
    }
  }
  return model;
}

/** Verify complete contents correspond to the supplied patch before exposing omitted lines. */
export function validateReviewContext(model: DiffReviewModel, context: DiffContext): void {
  const file = model.file;
  if (!file || !context || !context.oldFile && !context.newFile) throw new Error("Matching full-file context is unavailable.");
  let total = 0;
  for (const [side, value] of [["old", context.oldFile], ["new", context.newFile]] as const) {
    if (value === null) continue;
    if (!value || typeof value.contents !== "string" || typeof value.cacheKey !== "string" ||
      value.name !== (side === "old" ? file.prevName ?? file.name : file.name)) throw new Error("The file snapshot does not match this patch.");
    if (value.contents.includes("\0") || new TextEncoder().encode(value.contents).length > MAX_DIFF_FILE_BYTES) throw new Error("Full-file context exceeds the text size limit.");
    total += lines(value.contents).length;
  }
  if (total > MAX_DIFF_CONTEXT_LINES) throw new Error("Full-file context exceeds the line limit.");
  if (file.type === "new" && context.oldFile !== null || file.type === "deleted" && context.newFile !== null ||
    ["change", "rename-changed"].includes(file.type) && (!context.oldFile || !context.newFile)) throw new Error("The file versions do not match this patch.");
  if (!file.isPartial && file.hunks.length) {
    if ((context.oldFile?.contents ?? "") !== file.deletionLines.join("") || (context.newFile?.contents ?? "") !== file.additionLines.join("")) {
      throw new Error("The complete file versions do not match this patch.");
    }
    return;
  }
  const oldLines = lines(context.oldFile?.contents ?? ""), newLines = lines(context.newFile?.contents ?? "");
  const unchanged = (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
    if (oldEnd < oldStart || newEnd < newStart || oldEnd - oldStart !== newEnd - newStart ||
      oldLines.slice(oldStart, oldEnd).some((line, offset) => line !== newLines[newStart + offset])) {
      throw new Error("Omitted context does not match the supplied patch; full-file context is unavailable.");
    }
  };
  let oldCursor = 0, newCursor = 0;
  for (const hunk of file.hunks) {
    const oldStart = Math.max(0, hunk.deletionStart - (hunk.deletionCount ? 1 : 0));
    const newStart = Math.max(0, hunk.additionStart - (hunk.additionCount ? 1 : 0));
    unchanged(oldCursor, oldStart, newCursor, newStart);
    for (const [actual, expected, start, index, count] of [
      [oldLines, file.deletionLines, oldStart, hunk.deletionLineIndex, hunk.deletionCount],
      [newLines, file.additionLines, newStart, hunk.additionLineIndex, hunk.additionCount],
    ] as const) {
      if (actual.length < start + count || actual.slice(start, start + count).some((line, offset) => line !== expected[index + offset])) {
        throw new Error("The file snapshot changed or does not match the supplied patch; refresh the diff.");
      }
    }
    oldCursor = oldStart + hunk.deletionCount; newCursor = newStart + hunk.additionCount;
  }
  unchanged(oldCursor, oldLines.length, newCursor, newLines.length);
}

export function rememberExpansion(model: DiffReviewModel, index: number, direction: ExpansionDirections, count: number) {
  const value = model.expansions.get(index) ?? { fromStart: 0, fromEnd: 0 };
  if (direction === "up" || direction === "both") value.fromStart += count;
  if (direction === "down" || direction === "both") value.fromEnd += count;
  model.expansions.set(index, value);
}
export function matchingLines(contents: string, query: string): number[] {
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  return lines(contents).flatMap((line, index) => line.toLocaleLowerCase().includes(needle) ? [index + 1] : []);
}
export function validLine(value: string, contents: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= lines(contents).length ? number : null;
}
