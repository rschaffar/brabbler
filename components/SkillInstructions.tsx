"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SkillInfo } from "@/lib/api-types";
import { resolveSkillLink, skillInstructionsBody } from "@/lib/skill-instructions";
import { markdownClobberPrefix } from "@/lib/markdown-compat";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { ConfigButton, ConfigDetailHeader, ConfigDetailHeaderInfo, ConfigField } from "./SettingsUi";

export function SkillInstructions({ skill, cwd }: { skill: SkillInfo; cwd: string }) {
  const { t } = useI18n();
  const rootDocument = skill.filePath.split(/[\\/]/).pop()!;
  const [documents, setDocuments] = useState<string[]>([]);
  const documentPath = documents.at(-1) ?? rootDocument;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<string | null>(null);
  const [anchorRequest, setAnchorRequest] = useState(0);
  const openLink = useCallback((href: string) => {
    const link = resolveSkillLink(href, documentPath);
    if (href.startsWith("#")) {
      // Sanitized raw/footnote anchors already have matching IDs. Heading
      // fragments instead name reader-local data, so undo exactly one prefix.
      const id = CSS.escape(link.anchor);
      const target = root.current?.querySelector(`[id="${id}"], a[name="${id}"]`);
      if (target) { target.scrollIntoView({ block: "start" }); return; }
      if (link.anchor.startsWith(markdownClobberPrefix)) link.anchor = link.anchor.slice(markdownClobberPrefix.length);
    }
    pendingAnchor.current = link.anchor;
    if (link.document === documentPath) setAnchorRequest(n => n + 1);
    else setDocuments(stack => [...stack, link.document]);
  }, [documentPath]);
  useLayoutEffect(() => {
    if (pendingAnchor.current === null || (content === null && !error) || !root.current) return;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    const name = CSS.escape(markdownClobberPrefix + anchor);
    const heading = anchor ? (root.current.querySelector(`[id="${name}"], a[name="${name}"]`)
      ?? root.current.querySelector(`[data-heading-anchor="${CSS.escape(anchor)}"]`)) : null;
    (heading ?? root.current).scrollIntoView({ block: "start" });
  }, [content, error, anchorRequest]);
  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({ cwd, filePath: skill.filePath });
        if (documentPath !== rootDocument) params.set("document", documentPath);
        const response = await fetch(`/api/skills/content?${params}`, { signal: controller.signal });
        const data = await response.json() as { content?: unknown; error?: string };
        if (!response.ok || typeof data.content !== "string") throw new Error(data.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) setContent(skillInstructionsBody(data.content));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => controller.abort();
  }, [cwd, skill.filePath, documentPath, rootDocument]);
  return <div ref={root} role="region" aria-label={t("skills.instructions")} style={{ minWidth: 0 }}><ConfigField label={t("skills.instructions")}>
    {documents.length > 0 && <ConfigDetailHeader><ConfigDetailHeaderInfo>
      <ConfigButton size="small" onClick={() => { pendingAnchor.current = ""; setDocuments(stack => stack.slice(0, -1)); }}>{t("skills.documentBack")}</ConfigButton>
      <span className="config-detail-path" title={documentPath}>{documentPath}</span>
    </ConfigDetailHeaderInfo></ConfigDetailHeader>}
    {error ? <span role="alert">{error}</span> : content === null ? <span role="status">{t("i18n.loading")}</span> : content ?
      <MarkdownBody className="skill-instructions" cwd={[skill.baseDir, ...documentPath.split("/").slice(0, -1)].join("/")} onNavigateLink={openLink}>{content}</MarkdownBody>
      : <span>{t("skills.instructionsEmpty")}</span>}
  </ConfigField></div>;
}
