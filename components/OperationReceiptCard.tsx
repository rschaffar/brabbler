"use client";

import { useState } from "react";
import { operationAuthorizationLabel, operationOutcomeLabel, type OperationReceiptSnapshot } from "@/lib/operation-receipts";
import { BlockingCard } from "./BlockingCard";
import { PluginCardContent } from "./plugin-ui/PluginCard";

/** Read-only full snapshot: no tool callbacks, authorization controls or inferred success. */
export function OperationReceiptCard({ receipt }: { receipt: OperationReceiptSnapshot }) {
  const [collapsed, setCollapsed] = useState(true);
  const authorization = operationAuthorizationLabel(receipt);
  const outcome = operationOutcomeLabel(receipt);
  const request = { ...receipt.card, type: "extension_ui_request" as const, method: "plugin_card" as const,
    id: receipt.operationId, pluginId: receipt.pluginId, actions: [] };
  return <div className="my-4 min-w-0" data-operation-receipt={receipt.operationId}>
    <BlockingCard title={receipt.card.title} label={`${authorization} · ${outcome}`}
      collapsedLabel={outcome} collapsed={collapsed} retainBodyWhenCollapsed={false}
      onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)}
      footer={<p className="min-w-0 break-words text-xs text-text-muted">{authorization} · {receipt.authorization.source} · {outcome}</p>}>
      <section className="min-w-0">
        <h3 className="blocking-card-section-title">Authorization</h3>
        <p className="break-words text-xs">{authorization} · {receipt.authorization.mode} · {receipt.authorization.source}</p>
        <pre className="blocking-card-code">{receipt.authorization.revision}</pre>
      </section>
      <section className="min-w-0">
        <h3 className="blocking-card-section-title">Execution outcome</h3>
        <p className="break-words text-xs">{outcome}</p>
        <p className="text-xs text-text-muted">{receipt.effectStarted ? "Effect started" : receipt.phase === "executing" ? "Effect may have started; no terminal outcome recorded" : "Effect not started"}</p>
        {receipt.summary && <pre className="blocking-card-code">{receipt.summary}</pre>}
        {receipt.checks.length > 0 && <ul className="grid list-none gap-2 p-0">{receipt.checks.map((check, index) =>
          <li key={index} className="blocking-card-choice break-words">{check.name}: {check.status}</li>)}</ul>}
      </section>
      {request.scope && <p className="blocking-card-scope">{request.scope}</p>}
      <PluginCardContent request={request} />
      <section className="min-w-0 text-xs text-text-muted">
        <h3 className="blocking-card-section-title">Correlation</h3>
        <pre className="blocking-card-code">{receipt.pluginId}{"\n"}{receipt.operationId}{receipt.toolCallId ? `\n${receipt.toolCallId}` : ""}</pre>
      </section>
    </BlockingCard>
  </div>;
}
