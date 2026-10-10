"use client";

import { Fragment, useRef, useState } from "react";
import type { ExtensionUiRequest } from "@/lib/types";
import type { PluginCardField, PluginCardSection } from "@/lib/plugins/types";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "../MarkdownBody";
import { BlockingCard } from "../BlockingCard";
import { SuppliedPatchStack } from "../GitPatchStack";
import { ReviewAttachment } from "./ReviewAttachment";

type Request = Extract<ExtensionUiRequest, { method: "plugin_card" }>;
function Fields({ fields }: { fields: PluginCardField[] }) {
  return <dl className="blocking-card-fields">{fields.map((field, index) => <Fragment key={index}>
    <dt>{field.label}</dt><dd className={field.code ? "blocking-card-code" : undefined}>{field.value}</dd>
  </Fragment>)}</dl>;
}
function Section({ section }: { section: PluginCardSection }) {
  const content = <>{section.text && <p className={section.code ? "blocking-card-code" : "whitespace-pre-wrap break-words text-xs"}>{section.text}</p>}
    {section.fields && <Fields fields={section.fields} />}</>;
  return section.collapsible ? <details className="min-w-0 text-xs">
    <summary className="blocking-card-section-title cursor-pointer">{section.title}</summary>{content}
  </details> : <section aria-label={section.title} className={section.notice ? "blocking-card-notice" : "min-w-0"}>
    <h3 className="blocking-card-section-title">{section.title}</h3>{content}
  </section>;
}
/** Identical supplied fields and patches for live approvals and historical receipts. */
export function PluginCardContent({ request, sessionId, reviewBaseUrl }: { request: Request; sessionId?: string; reviewBaseUrl?: string }) {
  return <>
    {request.sessionLinks?.map((link) => <a key={link.sessionId} className="block break-words text-xs text-accent underline" href={`/?session=${encodeURIComponent(link.sessionId)}`}>{link.label}</a>)}
    {request.fields && <Fields fields={request.fields} />}
    {request.text && <pre className="blocking-card-code">{request.text}</pre>}
    {request.markdown && <MarkdownBody>{request.markdown}</MarkdownBody>}
    {request.sections?.filter((section) => !section.collapsible).map((section, index) => <Section key={index} section={section} />)}
    {request.review && <ReviewAttachment key={`${sessionId}:${request.review.id}`} review={request.review} sessionId={sessionId} reviewBaseUrl={reviewBaseUrl} before={request.patchBefore} after={request.patchAfter} contextHandle={request.patchContext} pluginId={request.pluginId} />}
    {request.patch && <SuppliedPatchStack patch={request.patch} before={request.patchBefore ?? "Current"} after={request.patchAfter ?? "Proposed"}
      contextHandle={request.patchContext} pluginId={request.pluginId} />}
    {request.sections?.filter((section) => section.collapsible).map((section, index) => <Section key={index} section={section} />)}
  </>;
}

/** Reusable presentation only. Buttons answer a live session request, never execute. */
export function PluginCard({ request, onRespond, sessionId }: {
  request: Request; sessionId?: string;
  onRespond: (request: Request, response: { action: string; details?: string } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const respond = (response: { action: string; details?: string } | { cancelled: true }) => {
    if (sentRef.current) return;
    sentRef.current = true; setSent(true); onRespond(request, response);
  };
  return <div onKeyDown={(event) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); respond({ cancelled: true }); }
  }}>
    <BlockingCard title={request.title} label={request.subtitle ?? t("chat.extensionRequest")} collapsed={collapsed}
      onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)} footer={<>
        {request.scope && <p className="blocking-card-scope">{request.scope}</p>}
        <button type="button" autoFocus disabled={sent} className="mr-auto" onClick={() => respond({ cancelled: true })}>{t("chat.cancel")}</button>
        {request.actions.map((action) => <button key={action.id} type="button" disabled={sent} data-primary={action.primary || undefined}
          onClick={() => respond({ action: action.id, ...(request.allowDetails ? { details } : {}) })}>{action.label}</button>)}
      </>}>
      <PluginCardContent request={request} sessionId={sessionId} />
      {request.allowDetails && <label className="grid gap-2 text-xs">Additional details
        <textarea aria-label="Additional details" value={details} maxLength={20000} disabled={sent} onChange={(event) => setDetails(event.target.value)}
          placeholder="Explain what you want changed. Request changes sends this back without launching."
          className="min-h-20 w-full rounded border border-border bg-background p-2" />
      </label>}
    </BlockingCard>
  </div>;
}
