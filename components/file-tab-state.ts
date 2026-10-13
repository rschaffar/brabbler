import type { FileViewerState } from "@/lib/file-viewer-state";
import type { Tab } from "./TabBar";

export interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  modeHint?: "diff";
  page?: number;
  lineTarget?: import("@/lib/file-links").FileLineTarget;
  sourceSessionId?: string | null;
  tabId: string;
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      sourceSessionId: input.sourceSessionId,
      initialDisplayMode: input.modeHint,
      page: input.page,
      lineTarget: input.lineTarget,
      viewerState: input.modeHint ? {
        displayMode: input.modeHint,
        wrapLines: false,
        scrollTop: 0,
        scrollLeft: 0,
      } : undefined,
      viewerRevision: 0,
    }];
  }

  const sourceChanged = Boolean(
    input.sourceSessionId && existing.sourceSessionId !== input.sourceSessionId,
  );
  const sourceUnchanged = !sourceChanged;
  const pageChanged = existing.page !== input.page;
  if (sourceUnchanged && !input.modeHint && !pageChanged && !input.lineTarget) return tabs;
  // Never replace the owner of an in-flight save. Latest navigation wins once it settles.
  if (existing.saving) return tabs.map((tab) => tab.id === input.tabId ? { ...tab, pendingOpen: input } : tab);

  return tabs.map((tab) => {
    if (tab.id !== input.tabId) return tab;
    const next: Tab = { ...tab };
    let bumpRevision = false;
    if (sourceChanged) {
      next.sourceSessionId = input.sourceSessionId;
      bumpRevision = true;
    }
    if (pageChanged) {
      next.page = input.page;
      bumpRevision = true;
    }
    // Every explicit line click is a fresh navigation, even to the same line.
    if (input.lineTarget) {
      next.lineTarget = input.lineTarget;
      bumpRevision = true;
    }
    if (input.modeHint) {
      next.lineTarget = undefined;
      next.initialDisplayMode = input.modeHint;
      next.viewerState = {
        displayMode: input.modeHint,
        wrapLines: tab.viewerState?.wrapLines ?? false,
        scrollTop: 0,
        scrollLeft: 0,
      };
      bumpRevision = true;
    }
    if (bumpRevision) next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    return next;
  });
}

export function setFileSaving(tabs: Tab[], tabId: string, viewerRevision: number, saving: boolean): Tab[] {
  const existing = tabs.find((tab) => tab.id === tabId);
  if (!existing || (existing.viewerRevision ?? 0) !== viewerRevision) return tabs;
  const pending = !saving ? existing.pendingOpen : undefined;
  const next = tabs.map((tab) => tab.id === tabId ? { ...tab, saving, ...(!saving ? { pendingOpen: undefined } : {}) } : tab);
  return pending ? openFileTab(next, pending) : next;
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
  lineTargetHandled = false,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || (tabs[index].viewerRevision ?? 0) !== viewerRevision) return tabs;

  const next = [...tabs];
  next[index] = { ...next[index], viewerState, ...(lineTargetHandled ? { lineTarget: undefined } : {}) };
  return next;
}
