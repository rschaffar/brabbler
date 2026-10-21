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
import type { ReviewSource } from "@/lib/review-notebook";

/** Presentation of the already-authorized immutable excerpt; performs no file reads. */
export function ReviewNotebookSource({ source }: { source: ReviewSource }) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const language = getFileLanguage(source.path);
  const ready = usePrismLanguages(Boolean(source.contents) && needsPrismLanguage(language), root);
  const highlighted = useDeferredHighlight(source.contents, language, ready, root);
  return <div ref={root} className="review-notebook-source" tabIndex={0} role="region" aria-label={t("review.sourceLabel", { path: source.path })}>
    <SyntaxHighlighter
      language={highlighted ? language : "text"}
      style={isDark ? vscDarkPlus : vs}
      wrapLines
      customStyle={{ margin: 0, padding: 0, background: "transparent", font: "inherit" }}
      codeTagProps={{ style: { font: "inherit" } }}
      renderer={({ rows, stylesheet, useInlineStyles }) => rows.map((row, index) => <div key={index} className="review-notebook-source-line">
        <span aria-hidden="true">{source.start + index}</span>
        <span>{renderSyntaxNode({ node: row, stylesheet, useInlineStyles, key: `line-${index}` })}</span>
      </div>)}
    >{source.contents}</SyntaxHighlighter>
  </div>;
}
