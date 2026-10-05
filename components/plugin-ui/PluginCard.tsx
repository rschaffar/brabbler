"use client";

import { useState } from "react";
import type { ExtensionUiRequest } from "@/lib/types";
import { MarkdownBody } from "../MarkdownBody";
import { CommittedPatchDiff } from "../CommittedPatchDiff";

type Request = Extract<ExtensionUiRequest, { method: "plugin_card" }>;
/** Reusable presentation only. Buttons answer a live session request, never execute. */
export function PluginCard({ request, onRespond }: {
  request: Request;
  onRespond: (request: Request, response: { action: string } | { cancelled: true }) => void;
}) {
  const [sent, setSent] = useState(false);
  const respond = (response: { action: string } | { cancelled: true }) => { setSent(true); onRespond(request, response); };
  return <section aria-label={request.title} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); respond({ cancelled: true }); } }} className="min-w-0 rounded-lg border border-border bg-bg-panel p-3 text-sm text-text">
    <h3 className="mb-2 font-semibold">{request.title}</h3>
    {request.text && <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{request.text}</pre>}
    {request.markdown && <MarkdownBody>{request.markdown}</MarkdownBody>}
    {request.patch && <CommittedPatchDiff patch={request.patch} hasBinaryChanges={/GIT binary patch|Binary files /.test(request.patch)} before={request.patchBefore ?? "Current"} after={request.patchAfter ?? "Proposed"} independentScroll />}
    <div className="mt-3 flex flex-wrap gap-2">
      {request.actions.map((action) => <button key={action.id} type="button" disabled={sent}
        className="rounded border border-border px-3 py-2 hover:bg-bg-hover disabled:opacity-50" onClick={() => respond({ action: action.id })}>{action.label}</button>)}
      <button type="button" autoFocus disabled={sent} className="rounded border border-border px-3 py-2 hover:bg-bg-hover" onClick={() => respond({ cancelled: true })}>Dismiss</button>
    </div>
  </section>;
}
