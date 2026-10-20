"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { OpenFileLink } from "@/lib/file-links";
import { markdownMediaFileUrl, releaseMarkdownMedia } from "@/lib/markdown-media";

const MediaActiveContext = createContext(true);
let activationSequence = 0;

/** Covered/inert chat stays mounted; it must not retain active media resources. */
export function MarkdownMediaScope({ active, children }: { active: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return <MediaActiveContext.Provider value={active && visible}>{children}</MediaActiveContext.Provider>;
}

interface Props {
  filePath: string;
  type: "audio" | "video";
  label: string;
  sessionId?: string;
  onOpenFile?: OpenFileLink;
}

export function MarkdownMedia(props: Props) {
  const active = useContext(MediaActiveContext);
  // Unmount activation state too, so returning to chat never resumes/loading-replays.
  return active ? <MediaPlayer key={`${props.filePath}:${props.sessionId ?? ""}`} {...props} /> : <span>{props.label}</span>;
}

function MediaPlayer({ filePath, type, label, sessionId, onOpenFile }: Props) {
  const { t } = useI18n();
  const [activationId, setActivationId] = useState<string | null>(null);
  return <span className={`markdown-media markdown-media-${type}`}>
    <span className="markdown-media-label">{label}</span>
    {activationId ? <LoadedMedia type={type} label={label} src={`${markdownMediaFileUrl(filePath, sessionId)}&v=${activationId}`} /> :
      <button type="button" className="markdown-media-load" onClick={() => setActivationId(`${Date.now()}-${++activationSequence}`)}>
        {t(type === "audio" ? "chat.loadAudio" : "chat.loadVideo", { name: label })}
      </button>}
    <span className="markdown-media-actions">
      {onOpenFile && <button type="button" onClick={() => onOpenFile(filePath)}>{t("chat.openMediaFile")}</button>}
      <a href={markdownMediaFileUrl(filePath, sessionId, true)} download>{t("i18n.downloadFile")}</a>
      {activationId && <button type="button" onClick={() => setActivationId(null)}>{t("chat.unloadMedia")}</button>}
    </span>
  </span>;
}

function LoadedMedia({ type, src, label }: { type: "audio" | "video"; src: string; label: string }) {
  const { t } = useI18n();
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const media = mediaRef.current;
    // Strict Mode replays setup after cleanup on the same native node.
    if (media && media.getAttribute("src") !== src) media.setAttribute("src", src);
    return () => { if (media) releaseMarkdownMedia(media); };
  }, [src]);
  const props = { ref: (media: HTMLMediaElement | null) => { mediaRef.current = media; }, src, controls: true, preload: "metadata", "aria-label": label, onError: () => setFailed(true) };
  return <>
    {type === "audio" ? <audio {...props} /> : <video {...props} playsInline />}
    {failed && <span role="status" className="markdown-media-error">{t("chat.mediaFailed")}</span>}
  </>;
}
