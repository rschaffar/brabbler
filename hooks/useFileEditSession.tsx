"use client";
import { createContext, useContext, useState, useSyncExternalStore, useMemo } from "react";
import { FileEditSessions } from "@/lib/file-edit-sessions";
import type { FileEditDraft } from "@/lib/file-viewer-state";

export const FileEditContext = createContext<{ store: FileEditSessions; viewId: string; focusView: (id: string) => void } | null>(null);
export function useFileEditSession() {
  const context = useContext(FileEditContext);
  const [local] = useState(() => new FileEditSessions());
  const store = context?.store ?? local, viewId = context?.viewId ?? "standalone";
  const session = useSyncExternalStore(store.subscribe, () => store.snapshot(viewId), () => store.snapshot(viewId));
  const owned = session.owner === viewId;
  const actions = useMemo(() => ({
    setDraft: (draft: FileEditDraft | undefined) => store.draft(viewId, draft),
    setSaving: (saving: boolean) => store.saving(viewId, saving),
    bind: (identity: string) => store.bind(viewId, identity),
    claim: () => store.claim(viewId),
  }), [store, viewId]);
  return {
    ...actions,
    identity: store.identity(viewId),
    draft: owned ? session.draft : undefined,
    saving: owned && session.saving,
    blocked: Boolean(session.owner && !owned),
    focusOwner: () => { if (session.owner) context?.focusView(session.owner); },
  };
}
