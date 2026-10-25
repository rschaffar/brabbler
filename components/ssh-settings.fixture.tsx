import { useLayoutEffect } from "react";
import { SshSettings } from "./SshSettings";
import { useSshAgent, type SshAgentController } from "../hooks/useSshAgent";
import type { ClientCompletion } from "../lib/client-completion";
export { I18nProvider } from "../hooks/useI18n";
export { createClientCompletion } from "../lib/client-completion";

// Actual default controller and actual Settings, not an implementation of either.
// Controller stays mounted when embedded Settings becomes inactive.
export function SshSettingsProbe({ completion, active, observe, onWork }: {
  completion: ClientCompletion;
  active: boolean;
  observe: (agent: SshAgentController) => void;
  onWork?: (work: Promise<unknown>) => void;
}) {
  const agent = useSshAgent(completion);
  useLayoutEffect(() => { observe(agent); });
  return <SshSettings controller={agent} active={active} onWork={onWork} />;
}
