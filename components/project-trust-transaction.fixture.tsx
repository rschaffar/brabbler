import { useLayoutEffect, useRef, useState } from "react";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { ProjectTrustDialog, type TrustChoice } from "./ProjectTrustDialog";
import { respondToProjectTrust } from "./project-trust-transaction";
export { respondToProjectTrust } from "./project-trust-transaction";
export { I18nProvider } from "@/hooks/useI18n";
export { SettingsWorkContext } from "./SettingsUi";

/** Finite transaction ABI composition, NOT AppShell or its GET/reset effect.
 * cwd is the caller's captured trust authority; sidebarCwd is unrelated input.
 * Real React state and real dialog; no duplicate transaction algorithm. */
export function TrustTransactionHarness({ cwd, sidebarCwd, initialStatus, initialBusy = false, initialError = null, own, onCommit }: {
  cwd: string | null; sidebarCwd: string; initialStatus: ProjectTrustStatus;
  initialBusy?: boolean; initialError?: string | null;
  own: (label: string, promise: Promise<void>) => void;
  onCommit: (value: { respond: (choice: TrustChoice) => Promise<void> }) => void;
}) {
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(initialStatus);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(true);
  const [projectTrustBusy, setProjectTrustBusy] = useState(initialBusy);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(initialError);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(11);
  const [sessionKey, setSessionKey] = useState(7);
  const projectTrustCwdRef = useRef(cwd);
  projectTrustCwdRef.current = cwd;
  const respond = (choice: TrustChoice) => {
    const promise = respondToProjectTrust(choice, {
      projectTrustCwd: cwd, projectTrustBusy, projectTrustCwdRef,
      setProjectTrustBusy, setProjectTrustError, setProjectTrust,
      setProjectTrustDialogOpen, setModelsRefreshKey, setSessionKey,
    });
    own("trust.transaction", promise);
    return promise; // The production async function's SAME public promise.
  };
  useLayoutEffect(() => { onCommit({ respond }); });
  return <>
    <output data-trust-state>{JSON.stringify({ cwd, sidebarCwd, projectTrust, projectTrustDialogOpen,
      projectTrustBusy, projectTrustError, modelsRefreshKey, sessionKey })}</output>
    {projectTrustDialogOpen && cwd && <ProjectTrustDialog cwd={cwd} status={projectTrust}
      busy={projectTrustBusy} error={projectTrustError}
      onCancel={() => { if (!projectTrustBusy) setProjectTrustDialogOpen(false); }}
      onConfirm={choice => void respond(choice)} />}
  </>;
}
