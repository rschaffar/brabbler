"use client";
import { useCallback, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "./useI18n";

// Browser coordination only. The server retains fork/source/branch authority.
export function useQuotedChatBranch(selectedSessionId: string | undefined,
  onSessionForked: (newSessionId: string) => void) {
  const { t } = useI18n();
  const [pendingQuotePrompt, setPendingQuotePrompt] = useState<{ sessionId: string; text: string } | null>(null);
  // Return the public rejecting operation. The real quote UI observes its whole
  // try/catch/finally transaction; do not independently report this inner refusal.
  const onAskInNewChat = useCallback(async (prompt: string, sourceSessionId: string, sourceEntryId: string) => {
    const result = await sendAgentCommand<{ newSessionId?: string }>(sourceSessionId, {
      type: "fork_branch", entryId: sourceEntryId,
    });
    if (!result?.newSessionId) throw new Error(t("chat.quoteForkFailed"));
    setPendingQuotePrompt({ sessionId: result.newSessionId, text: prompt });
    onSessionForked(result.newSessionId);
  }, [onSessionForked, t]);
  const onInitialPromptConsumed = useCallback(() => setPendingQuotePrompt(null), []);
  return { onAskInNewChat, onInitialPromptConsumed,
    initialPrompt: pendingQuotePrompt?.sessionId === selectedSessionId ? pendingQuotePrompt?.text : undefined };
}
