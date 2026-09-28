"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode, type RefObject } from "react";
import type { ExtensionUiRequest } from "@/lib/types";
import type { GitActionState } from "@/lib/git-action-types";
import type { GitActionDialog } from "./GitActionDialog";
import type { ComponentProps } from "react";

type LiveRequest = Extract<ExtensionUiRequest, { method: "git_action" }>;
interface GitActionContextValue {
  sessionId: string | null;
  liveRequest: LiveRequest | null;
  onRespond: ComponentProps<typeof GitActionDialog>["onRespond"];
  interactionBlocked: boolean;
  questionCardRef?: RefObject<HTMLDivElement | null>;
  mountedActions: ReadonlyMap<string, number>;
  registerAnchor: (actionId: string) => () => void;
}
const GitActionContext = createContext<GitActionContextValue | null>(null);

/** Only ChatWindow's current live request carries authority. Records never do. */
export function GitActionProvider({ sessionId, liveRequest, onRespond, interactionBlocked, questionCardRef, children }: Omit<GitActionContextValue, "mountedActions" | "registerAnchor"> & { children: ReactNode }) {
  const [mountedActions, setMountedActions] = useState<ReadonlyMap<string, number>>(new Map());
  const registerAnchor = useCallback((actionId: string) => {
    setMountedActions((previous) => new Map(previous).set(actionId, (previous.get(actionId) ?? 0) + 1));
    return () => setMountedActions((previous) => {
      const next = new Map(previous);
      const count = (next.get(actionId) ?? 1) - 1;
      if (count) next.set(actionId, count); else next.delete(actionId);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ sessionId, liveRequest, onRespond, interactionBlocked, questionCardRef, mountedActions, registerAnchor }),
    [sessionId, liveRequest, onRespond, interactionBlocked, questionCardRef, mountedActions, registerAnchor]);
  return <GitActionContext.Provider value={value}>{children}</GitActionContext.Provider>;
}

export function useGitActionContext() { return useContext(GitActionContext); }

export function matchingLiveGitRequest(request: LiveRequest | null | undefined, actionId: string, state?: GitActionState): LiveRequest | null {
  // A missed request-closed SSE cannot keep stale buttons alive after GET
  // proves the decision ended. History can remove authority, never create it.
  if (state && state !== "proposed" && state !== "awaiting-decision") return null;
  return request?.candidate.kind !== "preferences" && request?.candidate.actionId === actionId ? request : null;
}

/** Windowed/off-branch anchors must never swallow a pending question. */
export function GitActionLiveFallback({ children }: { children: ReactNode }) {
  const context = useGitActionContext();
  const request = context?.liveRequest;
  const actionId = request?.candidate.actionId;
  if (actionId && matchingLiveGitRequest(request, actionId) && context?.mountedActions.has(actionId)) return null;
  return children;
}
