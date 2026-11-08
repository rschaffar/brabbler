export type FileViewerDisplayMode = "source" | "preview" | "diff";

export interface FileEditDraft {
  content: string;
  baseline: string;
  revision: string;
  /** The old baseline is no longer current; equal text is still unsaved input. */
  conflicted?: boolean;
}

export function isFileDraftDirty(draft?: FileEditDraft): boolean {
  return Boolean(draft && (draft.conflicted || draft.content !== draft.baseline));
}

export interface FileViewerState {
  displayMode: FileViewerDisplayMode;
  wrapLines: boolean;
  scrollTop: number;
  scrollLeft: number;
}

export function resolveInitialFileDisplayMode(
  initialState?: FileViewerState,
  initialDisplayMode?: FileViewerDisplayMode,
): FileViewerDisplayMode {
  return initialState?.displayMode ?? initialDisplayMode ?? "source";
}
