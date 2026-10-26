"use client";

import type { BlockingExtensionUiRequest } from "@/lib/types";
import type { AskUserAnswer } from "@/lib/ask-user";
import type { SetAnswer } from "@/lib/question-set";
import { AskUserDialog } from "./AskUserDialog";
import { ExtensionDialog } from "./ExtensionDialog";
import { QuestionSetDialog } from "./QuestionSetDialog";
import { PluginCard } from "./plugin-ui/PluginCard";

export type InlineBlockingRequest = Exclude<BlockingExtensionUiRequest, { method: "custom" }>;
type Response = { value: string } | { confirmed: boolean } | { action: string; details?: string }
  | { cancelled: true } | { answer: AskUserAnswer } | { answers: SetAnswer[] };

/** The request ID, not the dialog kind, owns the local draft lifetime. */
export function BlockingRequestCard({ request, sessionId, onRespond, onReadWork }: {
  request: InlineBlockingRequest; sessionId?: string;
  onRespond: (request: InlineBlockingRequest, response: Response) => Promise<void>;
  onReadWork?: (work: Promise<void>) => void;
}) {
  return request.method === "ask_user_batch"
    ? <QuestionSetDialog key={request.id} request={request} sessionId={sessionId ?? ""} onRespond={onRespond} />
    : request.method === "ask_user"
      ? <AskUserDialog key={request.id} request={request} onRespond={onRespond} />
      : request.method === "plugin_card"
        ? <PluginCard key={request.id} request={request} sessionId={sessionId} onRespond={onRespond} onReadWork={onReadWork} />
        : <ExtensionDialog key={request.id} request={request} onRespond={onRespond} />;
}
