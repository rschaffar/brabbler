"use client";

import { createContext, useContext, useMemo, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parseFileLineTarget, parsePdfPageFragment, resolveInlineFileReference, resolveLocalFileHref, resolveLocalFileLink, shouldOpenLocalFileInApp, type OpenFileLink } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { BlockedFileLink } from "./BlockedFileLink";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: OpenFileLink;
}

function InlineFileCode({ children, className, cwd, onOpenFile, ...props }: ComponentProps<"code"> & { cwd?: string; onOpenFile?: OpenFileLink }) {
  const insideLink = useContext(MarkdownLinkContext);
  const reference = !insideLink && onOpenFile && typeof children === "string"
    ? resolveInlineFileReference(children, cwd)
    : null;
  const code = <code className={className} {...props}>{children}</code>;
  if (!reference || !onOpenFile) return code;
  return <a href={String(children)} onClick={(event) => {
    if (!shouldOpenLocalFileInApp(event)) return;
    event.preventDefault();
    onOpenFile(reference.filePath, undefined, reference.lineTarget);
  }}>{code}</a>;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const imageSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  if (!imageSrc || insideLink) return image;
  return (
    <ImagePreview src={imageSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>
  );
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
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

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, parsePdfPageFragment(href) ?? undefined, parseFileLineTarget(href));
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
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
  }), [cwd, isStreaming, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : undefined}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
