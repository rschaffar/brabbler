import { useLayoutEffect } from "react";
import { useSshAgent, type SshAgentController } from "../hooks/useSshAgent";
import type { ClientCompletion } from "./client-completion";
export { createClientCompletion } from "./client-completion";
export { I18nProvider } from "../hooks/useI18n";

export function SshNotificationProbe({ completion, observe }: { completion: ClientCompletion; observe: (agent: SshAgentController) => void }) {
  const agent = useSshAgent(completion);
  useLayoutEffect(() => { observe(agent); });
  return <section>
    <button onClick={() => { void agent.connect("key", "Fixture", false); }}>Connect</button>
    <button onClick={agent.disconnect}>Disconnect</button>
    <label><input type="checkbox" checked={agent.notificationsEnabled} onChange={event => { void agent.toggleNotifications(event.target.checked); }} />Local notifications</label>
    <output data-field="review">{agent.reviewedId ?? ""}</output>
    <output data-field="notice">{agent.notice}</output>
    <output data-field="notification-status">{agent.notificationStatus}</output>
    <output data-field="connection">{agent.connection?.id ?? ""}</output>
  </section>;
}
