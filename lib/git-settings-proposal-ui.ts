import type { AgentMessage } from "./types";

/** A tool result is only a visible locator; the server-owned proposal is the source of truth. */
export function gitSettingsProposalId(message: AgentMessage | Partial<AgentMessage>): string | null {
  if (message.role !== "toolResult" || message.toolName !== "git_workflow_propose_settings" || message.isError) return null;
  const id = (message.details as { proposalId?: unknown } | undefined)?.proposalId;
  return typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ? id : null;
}
