"use client";

import { useId, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { toolFieldsOfInput, writtenFileText, type ToolField } from "@/lib/tool-fields";
import type { ToolCallContent } from "@/lib/types";

const TEXT_STYLE: CSSProperties = {
  margin: 0,
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const CONTROL_STYLE: CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 5, padding: "4px 8px",
  background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11,
};

/** Mounted only inside an expanded tool card. No Markdown, file links or probes. */
export function ToolArguments({ block, inputText, hasRichView, isError }: {
  block: ToolCallContent;
  /** Canonical full JSON or exact streamed raw input; never derived from rows. */
  inputText: string;
  hasRichView: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  const rawId = useId();
  const [showRaw, setShowRaw] = useState(false);
  const [copyState, setCopyState] = useState<{ text: string; failed: boolean } | null>(null);
  const streaming = block.rawInput !== undefined;
  const fileText = !streaming && !hasRichView ? writtenFileText(block.toolName, block.input) : null;
  const fields = !streaming && !hasRichView && fileText === null ? toolFieldsOfInput(block.input) : null;
  const hasAlternateView = !streaming && (hasRichView || fileText !== null || fields !== null);
  const copyStatus = copyState?.text === inputText ? copyState : null;

  async function copyArguments() {
    try {
      await copyText(inputText);
      setCopyState({ text: inputText, failed: false });
    } catch {
      setCopyState({ text: inputText, failed: true });
    }
  }

  return <div data-tool-arguments style={{
    padding: "6px 10px 8px", minWidth: 0, background: "var(--bg-subtle)",
    borderTop: isError ? "1px solid rgba(248,113,113,0.25)" : "1px solid rgba(34,197,94,0.2)",
  }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6 }}>
      <button type="button" onClick={copyArguments} style={CONTROL_STYLE}>{t("chat.copyArguments")}</button>
      {hasAlternateView && <button type="button" aria-expanded={showRaw} aria-controls={showRaw ? rawId : undefined}
        onClick={() => setShowRaw(!showRaw)} style={CONTROL_STYLE}>
        {t(showRaw ? "chat.hideRawArguments" : "chat.showRawArguments")}
      </button>}
      <span role="status" style={{ color: "var(--text-dim)", fontSize: 11 }}>
        {copyStatus ? t(copyStatus.failed ? "chat.copyArgumentsFailed" : "i18n.copied") : ""}
      </span>
    </div>
    {!hasAlternateView || showRaw ? <pre id={rawId} data-tool-input tabIndex={0} aria-label={t("chat.rawArguments")}
      style={{ ...TEXT_STYLE, overflow: "auto" }}>{inputText}</pre>
      : fileText !== null ? <pre data-tool-file-text tabIndex={0} aria-label={t("chat.writtenFileContent")}
        style={{ ...TEXT_STYLE, overflow: "auto" }}>{fileText}</pre>
        : fields && <ToolFieldRows fields={fields} />}
  </div>;
}

function ToolFieldRows({ fields }: { fields: ToolField[] }) {
  const { t } = useI18n();
  return <table data-tool-fields aria-label={t("chat.toolArguments")} style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}>
    <tbody>{fields.map((field) => <tr key={field.key}>
      <th scope="row" style={{ width: "28%", padding: "4px 12px 4px 0", color: "var(--text-dim)",
        fontSize: "calc(11px + var(--chat-font-size-offset, 0px))", fontWeight: 400, textAlign: "left", verticalAlign: "top", overflowWrap: "anywhere" }}>{field.key}</th>
      <td style={{ ...TEXT_STYLE, padding: "4px 0", verticalAlign: "top" }}>
        {field.multiline ? <pre tabIndex={0} aria-label={field.key} style={{ ...TEXT_STYLE, padding: "8px 10px", maxHeight: 260,
          overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)" }}>{field.value}</pre>
          : field.value === "" ? <span style={{ fontStyle: "italic" }}>{t("chat.emptyArgument")}</span> : field.value}
      </td>
    </tr>)}</tbody>
  </table>;
}
