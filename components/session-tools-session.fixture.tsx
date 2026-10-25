import type { useAgentSession } from "@/hooks/useAgentSession";
import { SessionToolsControl } from "./SessionToolsControl";
import { SettingsWorkContext } from "./SettingsUi";

// Deliberately tiny default mapping matching ChatWindow.tsx:858-866.
// No alternative handler or hook algorithm. Actual ChatWindow reachability/key
// is still an installed bridge; this proves callback -> real hook -> HTTP.
export function SessionToolsSession({ value, options, onWork }: {
  value: ReturnType<typeof useAgentSession>;
  options: { session?: { id: string; cwd: string } | null; newSessionCwd?: string | null; newSessionDraftKey?: string | null };
  onWork: (label: string, work: Promise<unknown>) => void;
}) {
  const cwd = options.session?.cwd ?? options.newSessionCwd;
  if (!cwd) return null;
  return <SettingsWorkContext.Provider value={onWork}><SessionToolsControl
    key={options.session?.id ?? options.newSessionDraftKey ?? options.newSessionCwd}
    cwd={cwd}
    sessionId={options.session?.id ?? value.sessionIdRef.current}
    selection={value.data?.nativeResources}
    busy={value.agentRunning || value.bashRunning || value.isCompacting || value.modelSwitching || value.modelSpeedChanging}
    chatOnly={value.toolPreset === "none"}
    onApply={value.handleNativeResourcesChange}
  /></SettingsWorkContext.Provider>;
}
