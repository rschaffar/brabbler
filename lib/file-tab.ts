import type { FileEditDraft, FileViewerDisplayMode, FileViewerState } from "./file-viewer-state";

/** Domain state; tab-bar presentation does not own file operations. */
export interface FileTab {
  id: string;
  label: string;
  filePath: string;
  kind?: "terminal";
  closing?: boolean;
  preview?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  page?: number;
  lineTarget?: import("./file-links").FileLineTarget;
  viewerState?: FileViewerState;
  viewerRevision?: number;
  draft?: FileEditDraft;
  saving?: boolean;
  pendingOpen?: OpenFileTabInput;
}

export interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  modeHint?: "diff";
  page?: number;
  lineTarget?: import("./file-links").FileLineTarget;
  sourceSessionId?: string | null;
  tabId: string;
}
