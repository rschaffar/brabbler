"use client";

import { useRef } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import renderSyntaxNode from "react-syntax-highlighter/dist/esm/create-element";
import { vs, vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { usePrismLanguages } from "@/hooks/usePrismLanguages";
import { useDeferredHighlight } from "@/hooks/useDeferredHighlight";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { getFileLanguage } from "@/lib/file-language";
import { needsPrismLanguage } from "@/lib/prism-languages";
import type { EvidenceSelection } from "@/lib/review-handoff";
import type { ReviewSource } from "@/lib/review-notebook";

/** Presentation of the already-authorized immutable excerpt; performs no file reads. */
export function ReviewNotebookSource({ source, onWork, onReviewSelection }: { source: ReviewSource; onWork?: (work: Promise<void>) => void; onReviewSelection?: (selection: EvidenceSelection | null) => void }) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const language = getFileLanguage(source.path);
  const ready = usePrismLanguages(Boolean(source.contents) && needsPrismLanguage(language), root, onWork);
  const highlighted = useDeferredHighlight(source.contents, language, ready, root);
  const captureSelection = () => {
    if (!onReviewSelection) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !root.current?.contains(selection.anchorNode) || !root.current.contains(selection.focusNode)) return;
    const row = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-review-source-line]");
    const a = Number(row(selection.anchorNode)?.dataset.reviewSourceLine), b = Number(row(selection.focusNode)?.dataset.reviewSourceLine);
    const quote = selection.toString().slice(0, 8000);
    if (quote && a > 0 && b > 0) onReviewSelection({ quote, context: source.contents.slice(0, 8000), start: Math.min(a, b), end: Math.max(a, b), side: "additions", path: source.path });
  };
  return <div ref={root} onMouseUp={captureSelection} onKeyUp={captureSelection} className="review-notebook-source" tabIndex={0} role="region" aria-label={t("review.sourceLabel", { path: source.path })}>
    <SyntaxHighlighter
      language={highlighted ? language : "text"}
      style={isDark ? vscDarkPlus : vs}
      wrapLines
      customStyle={{ margin: 0, padding: 0, background: "transparent", font: "inherit" }}
      codeTagProps={{ style: { font: "inherit" } }}
      renderer={({ rows, stylesheet, useInlineStyles }) => rows.map((row, index) => <div key={index} className="review-notebook-source-line" data-review-source-line={source.start + index}>
        <span aria-hidden="true">{source.start + index}</span>
        <span>{renderSyntaxNode({ node: row, stylesheet, useInlineStyles, key: `line-${index}` })}</span>
      </div>)}
    >{source.contents}</SyntaxHighlighter>
    {onReviewSelection && <button type="button" onMouseDown={event => event.preventDefault()} onClick={captureSelection}>Anchor selected source text</button>}
  </div>;
}
