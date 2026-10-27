"use client";

import { createContext, useContext, type ComponentProps } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parseFileLineTarget, parsePdfPageFragment, resolveLocalFileHref, resolveLocalFileLink, type OpenFileLink } from "@/lib/file-links";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform } from "@/lib/markdown";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { jumpToMarkdownFragment } from "@/lib/markdown-compat";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { ReviewNotebookBlock } from "./ReviewNotebookBlock";
import { BlockedFileLink } from "./BlockedFileLink";
import { LocalFileLink } from "./LocalFileLink";

const ReviewCardsContext = createContext(true);
const PresenterWorkContext = createContext<((work: Promise<unknown>) => void) | undefined>(undefined);
const LinkContext = createContext<{ baseDir?: string; relativeRoot?: string; onOpenFile?: OpenFileLink }>({});
function MarkdownPreviewLink({ href, children, ...props }: ComponentProps<"a"> & ExtraProps) {
  delete props.node;
  const { baseDir, relativeRoot, onOpenFile } = useContext(LinkContext);
  if (href?.startsWith("#")) return <a href={href} {...props} onClick={jumpToMarkdownFragment}>{children}</a>;
  const resolution = onOpenFile ? resolveLocalFileLink(href, baseDir, relativeRoot) : null;
  if (resolution?.kind === "blocked") return <BlockedFileLink key={href} reason={resolution.reason}>{children}</BlockedFileLink>;
  const linkedFile = resolution?.kind === "local" ? resolution.filePath : null;
  if (!linkedFile || !onOpenFile) return <a href={href} {...props}>{children}</a>;
  return <LocalFileLink href={href} {...props} filePath={linkedFile} page={parsePdfPageFragment(href) ?? undefined}
    lineTarget={parseFileLineTarget(href)} onOpenFile={onOpenFile}>{children}</LocalFileLink>;
}
// Stable element types preserve Mermaid, rejection feedback, source positions and focus.
function MarkdownCode({ className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
    const reviewCards = useContext(ReviewCardsContext);
    const onWork = useContext(PresenterWorkContext);
    const lang = className?.replace("language-", "").toLowerCase() ?? "", raw = String(children);
    if (className?.includes("language-") || raw.includes("\n")) {
      if (lang === "pi-review" && reviewCards) return <ReviewNotebookBlock source={raw.replace(/\n$/, "")} onWork={onWork} />;
      if (lang === "mermaid") return <MermaidBlock code={raw.replace(/\n$/, "")} defaultPreview onWork={onWork} />;
      return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} onWork={onWork} />;
    }
    return <code className={className} {...props}>{children}</code>;
}
const codeComponents: Components = {
  code: MarkdownCode,
  pre({ children, node }) {
    return <div data-source-line-start={node?.properties.dataSourceLineStart as number | undefined}
      data-source-line-end={node?.properties.dataSourceLineEnd as number | undefined}>{children}</div>;
  },
};

/** Shared sanitized file prose. Guided prose disables automatic images (including remote URLs). */
export function FileMarkdownBody({ markdown, baseDir, relativeRoot = baseDir, sourceSessionId, onOpenFile,
  rehypePlugins = markdownPreviewRehypePlugins, images = true, reviewCards = true, onWork }: {
  markdown: string; baseDir?: string; relativeRoot?: string; sourceSessionId?: string | null; onOpenFile?: OpenFileLink;
  rehypePlugins?: ComponentProps<typeof ReactMarkdown>["rehypePlugins"]; images?: boolean; reviewCards?: boolean;
  onWork?: (work: Promise<unknown>) => void;
}) {
  return <PresenterWorkContext.Provider value={onWork}><ReviewCardsContext.Provider value={reviewCards}><LinkContext.Provider value={{ baseDir, relativeRoot, onOpenFile }}>
    <ReactMarkdown remarkPlugins={markdownPreviewRemarkPlugins} rehypePlugins={rehypePlugins}
      urlTransform={onOpenFile ? markdownUrlTransform : undefined} components={{ ...codeComponents, a: MarkdownPreviewLink,
        img({ src, alt, ...props }) {
          delete props.node;
          if (!images) return <span>{alt ?? "Image"} (open as an explicit evidence target)</span>;
          const imagePath = typeof src === "string" ? resolveLocalFileHref(src, baseDir, relativeRoot) : null;
          const query = new URLSearchParams({ type: "read", ...(sourceSessionId ? { sessionId: sourceSessionId } : {}) });
          const imageSrc = imagePath ? `/api/files/${encodeFilePathForApi(imagePath)}?${query}` : src;
          // eslint-disable-next-line @next/next/no-img-element
          return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
        },
      }}>{markdown}</ReactMarkdown>
  </LinkContext.Provider></ReviewCardsContext.Provider></PresenterWorkContext.Provider>;
}
