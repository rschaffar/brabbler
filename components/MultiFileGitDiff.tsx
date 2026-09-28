"use client";

import { useMemo, useState } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import { CommittedPatchDiff } from "./CommittedPatchDiff";

const MAX_PATCH_CHARACTERS = 2 * 1024 * 1024;
const MAX_PATCH_FILES = 200;
export interface CapturedFilePatch { name: string; previousName?: string; patch: string; binary: boolean }

/** Pierre returns parsed files, not raw file slices. Mirror its line-prefix
 * boundary for captured `git diff` output, then validate each slice strictly.
 * Hunk lines carry a +, - or space prefix; quoted paths are decoded by Pierre,
 * not by splitting on whitespace. Anything else keeps the COMPLETE raw patch.
 */
export function splitCapturedGitPatch(patch: string): { files: CapturedFilePatch[]; fallback?: string; oversized?: boolean } {
  if (patch.length > MAX_PATCH_CHARACTERS) return { files: [], oversized: true, fallback: "Captured patch is oversized for this viewer; no partial diff is displayed." };
  if (!patch.trim()) return { files: [] };
  const slices = patch.split(/(?=^diff --git )/m);
  if (slices.length > MAX_PATCH_FILES) return { files: [], oversized: true, fallback: "Captured patch contains too many files for this viewer; no partial diff is displayed." };
  try {
    const files = slices.map((raw) => {
      if (!raw.startsWith("diff --git ")) throw new Error("Unknown patch preamble");
      const parsed = parsePatchFiles(raw, undefined, true);
      if (parsed.length !== 1 || parsed[0].files.length !== 1) throw new Error("Unexpected file count");
      const file = parsed[0].files[0];
      if (!file.name) throw new Error("Missing filename");
      return { name: file.name, previousName: file.prevName, patch: raw, binary: /^(?:Binary files .* differ|GIT binary patch)\r?$/m.test(raw) };
    });
    return { files };
  } catch {
    return { files: [], fallback: "Captured patch could not be parsed reliably; showing the complete raw patch, not a partial diff." };
  }
}

export function MultiFileGitDiff({ patch, hasBinaryChanges, before, after }: { patch: string; hasBinaryChanges: boolean; before: string; after: string }) {
  const { files, fallback, oversized } = useMemo(() => splitCapturedGitPatch(patch), [patch]);
  return <div className="min-w-0 space-y-2" aria-label="Captured multi-file diff">
    <p className="break-all text-xs text-text-muted">Captured trees: <span className="font-mono">{before} → {after}</span></p>
    {hasBinaryChanges && <p className="text-xs text-text-muted">Binary changes are summarized; binary file contents were not captured as text.</p>}
    {fallback && <p role="status" className="text-xs text-text-muted">{fallback}</p>}
    {fallback && !oversized && <pre role="region" aria-label="Raw patch" className="max-h-[44vh] min-w-0 overflow-auto rounded border border-border p-2 font-mono text-xs">{patch}</pre>}
    {!fallback && files.length === 0 && <p className="text-xs text-text-muted">No tree changes in the captured patch.</p>}
    {files.map((file, index) => <CapturedFileDiff key={`${index}:${file.name}`} file={file} before={before} after={after} initiallyOpen={files.length === 1 || index === 0} />)}
  </div>;
}

function CapturedFileDiff({ file, before, after, initiallyOpen }: { file: CapturedFilePatch; before: string; after: string; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="min-w-0 rounded border border-border p-2">
    <summary className="cursor-pointer break-all font-mono text-xs">{file.previousName && file.previousName !== file.name ? `${file.previousName} → ` : ""}{file.name}{file.binary ? " · binary" : ""}</summary>
    {open && <CommittedPatchDiff patch={file.patch} hasBinaryChanges={file.binary} before={before} after={after} independentScroll />}
  </details>;
}
