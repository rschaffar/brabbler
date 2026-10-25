"use client";
import { useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";
/** Selected chat's saved cwd wins over independent Sidebar checkout selection. */
export function useSessionFileBinding(selectedSession: SessionInfo | null, activeCwd: string | null) {
  const [parkedFileWorkspaceKey, setParkedFileWorkspaceKey] = useState<string | null>(null);
  const currentFileWorkspaceKey = JSON.stringify([selectedSession?.id ?? null, selectedSession?.cwd ?? activeCwd ?? null]);
  const fileWorkspaceKey = parkedFileWorkspaceKey ?? currentFileWorkspaceKey;
  const parkedFileCwd = parkedFileWorkspaceKey ? (JSON.parse(parkedFileWorkspaceKey) as [string | null, string | null])[1] ?? "" : "";
  useEffect(() => { setParkedFileWorkspaceKey(null); }, [currentFileWorkspaceKey]);
  return { currentFileWorkspaceKey, fileWorkspaceKey, parkedFileWorkspaceKey, setParkedFileWorkspaceKey, parkedFileCwd };
}
