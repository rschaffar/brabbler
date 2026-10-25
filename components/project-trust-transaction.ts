import type { Dispatch, SetStateAction } from "react";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { TrustChoice } from "./ProjectTrustDialog";

export type ProjectTrustTransactionContext = {
  projectTrustCwd: string | null;
  projectTrustBusy: boolean;
  projectTrustCwdRef: { current: string | null };
  setProjectTrustBusy: Dispatch<SetStateAction<boolean>>;
  setProjectTrustError: Dispatch<SetStateAction<string | null>>;
  setProjectTrust: Dispatch<SetStateAction<ProjectTrustStatus | null>>;
  setProjectTrustDialogOpen: Dispatch<SetStateAction<boolean>>;
  setModelsRefreshKey: Dispatch<SetStateAction<number>>;
  setSessionKey: Dispatch<SetStateAction<number>>;
};

/** AppShell's original complete transaction. No captured transport or observer. */
export async function respondToProjectTrust(choice: TrustChoice, {
  projectTrustCwd, projectTrustBusy, projectTrustCwdRef,
  setProjectTrustBusy, setProjectTrustError, setProjectTrust,
  setProjectTrustDialogOpen, setModelsRefreshKey, setSessionKey,
}: ProjectTrustTransactionContext): Promise<void> {
  if (!projectTrustCwd || projectTrustBusy) return;
  setProjectTrustBusy(true);
  setProjectTrustError(null);
  try {
    const response = await fetch("/api/project-trust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: projectTrustCwd, ...choice }),
    });
    const data = await response.json() as ProjectTrustStatus & { error?: string };
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
    if (projectTrustCwdRef.current !== projectTrustCwd) return;
    setProjectTrust(data);
    setProjectTrustDialogOpen(false);
    setModelsRefreshKey((key) => key + 1);
    setSessionKey((key) => key + 1);
  } catch (error) {
    if (projectTrustCwdRef.current === projectTrustCwd) setProjectTrustError(error instanceof Error ? error.message : String(error));
  } finally {
    setProjectTrustBusy(false);
  }
}
