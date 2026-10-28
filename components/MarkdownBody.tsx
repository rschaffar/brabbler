"use client";

import { createContext, useContext, useMemo, type ComponentProps } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parseFileLineTarget, parsePdfPageFragment, resolveInlineFileReference, resolveLocalFileHref, resolveLocalFileLink, type OpenFileLink } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { jumpToMarkdownFragment, markdownDocumentRehypePlugins, markdownMediaRehypePlugins, markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { ImagePreview } from "./ImagePreview";
import { RemoteImageGate } from "./RemoteImageGate";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { ReviewNotebookBlock } from "./ReviewNotebookBlock";
import { BlockedFileLink } from "./BlockedFileLink";
import { LocalFileLink } from "./LocalFileLink";
import { MarkdownMedia } from "./MarkdownMedia";
import { resolveMarkdownMedia } from "@/lib/markdown-media";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: OpenFileLink;
  onNavigateLink?: (href: string) => void;
  enableInlineMedia?: boolean;
  enableReviewBlocks?: boolean;
  sourceSessionId?: string;
}

function InlineFileCode({ children, className, cwd, onOpenFile, ...props }: ComponentProps<"code"> & { cwd?: string; onOpenFile?: OpenFileLink }) {
  const insideLink = useContext(MarkdownLinkContext);
  const reference = !insideLink && onOpenFile && typeof children === "string"
    ? resolveInlineFileReference(children, cwd)
    : null;
  const code = <code className={className} {...props}>{children}</code>;
  if (!reference || !onOpenFile) return code;
  return <LocalFileLink href={String(children)} filePath={reference.filePath} lineTarget={reference.lineTarget} onOpenFile={onOpenFile}>{code}</LocalFileLink>;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  enableInlineMedia,
  sourceSessionId,
  isStreaming,
  onOpenFile,
  ...props
}: ComponentProps<"img"> & ExtraProps & Pick<MarkdownBodyProps, "cwd" | "enableInlineMedia" | "sourceSessionId" | "isStreaming" | "onOpenFile">) {
  const insideLink = useContext(MarkdownLinkContext);
  const { t } = useI18n();
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const media = enableInlineMedia ? resolveMarkdownMedia(href, cwd) : null;
  if (media) {
    const label = alt?.trim() || (media.kind === "local" ? getFileName(media.filePath) : t("chat.mediaLabel"));
    if (insideLink) return <span>{label}</span>;
    if (media.kind === "blocked") return <BlockedFileLink reason={media.reason}>{label}</BlockedFileLink>;
    if (media.kind === "remote") return <a href={media.href} target="_blank" rel="noopener noreferrer">{label}</a>;
    if (media.kind !== "local" || isStreaming) return <span>{label}</span>;
    return <MarkdownMedia filePath={media.filePath} type={media.type} label={label} sessionId={sourceSessionId} onOpenFile={onOpenFile} />;
  }
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const imageSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  return <RemoteImageGate src={imageSrc} alt={alt} insideLink={insideLink}>
    {!imageSrc || insideLink ? image : <ImagePreview src={imageSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>}
  </RemoteImageGate>;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onNavigateLink, enableInlineMedia = false, enableReviewBlocks = false, sourceSessionId }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "brabbler-review" && enableReviewBlocks && !onNavigateLink) return <ReviewNotebookBlock source={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        if (lang === "mermaid") {
          return (
            <MermaidBlock
              code={raw.replace(/\n$/, "")}
              isStreaming={isStreaming}
              defaultPreview
            />
          );
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <InlineFileCode className="markdown-inline-code" cwd={cwd} onOpenFile={onOpenFile} {...props}>
          {children}
        </InlineFileCode>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      if (onNavigateLink && href && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
        const navigate = () => onNavigateLink(href);
        return <MarkdownLinkContext.Provider value={true}>
          <a {...props} role="link" tabIndex={0} onClick={navigate} onKeyDown={event => { if (event.key === "Enter") navigate(); }}>{children}</a>
        </MarkdownLinkContext.Provider>;
      }
      if (href?.startsWith("#")) return <MarkdownLinkContext.Provider value={true}>
        <a href={href} {...props} onClick={jumpToMarkdownFragment}>{children}</a>
      </MarkdownLinkContext.Provider>;
      const resolution = onOpenFile ? resolveLocalFileLink(href, cwd) : null;
      if (resolution?.kind === "blocked") {
        return <MarkdownLinkContext.Provider value={true}>
          <BlockedFileLink key={href} reason={resolution.reason}>{children}</BlockedFileLink>
        </MarkdownLinkContext.Provider>;
      }
      const filePath = resolution?.kind === "local" ? resolution.filePath : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }

      return (
        <MarkdownLinkContext.Provider value={true}>
          <LocalFileLink href={href} {...props} filePath={filePath} page={parsePdfPageFragment(href) ?? undefined}
            lineTarget={parseFileLineTarget(href)} onOpenFile={openFile}>{children}</LocalFileLink>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} enableInlineMedia={enableInlineMedia && !onNavigateLink} sourceSessionId={sourceSessionId} isStreaming={isStreaming} onOpenFile={onOpenFile} {...props} />;
    },
    ol({ node, start, style, ...props }) {
      const items = node?.children.filter((child) => child.type === "element" && child.tagName === "li").length ?? 0;
      const first = start ?? 1;
      const last = first + Math.max(items, 1) - 1;
      const digits = Math.max(String(Math.abs(first)).length, String(Math.abs(last)).length, 2);
      return <ol start={start} style={{ ...style, ["--ol-marker-digits" as string]: digits }} {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile, onNavigateLink, enableInlineMedia, enableReviewBlocks, sourceSessionId]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={onNavigateLink ? markdownDocumentRehypePlugins : enableInlineMedia ? markdownMediaRehypePlugins : markdownRehypePlugins}
        urlTransform={onOpenFile || enableInlineMedia ? markdownUrlTransform : undefined}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
