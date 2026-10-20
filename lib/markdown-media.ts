import { resolveLocalFileLink, type LocalFileLinkBlockReason } from "./file-links";
import { encodeFilePathForApi } from "./file-paths";
import { getAudioMime, getVideoMime } from "./file-types";

export type MarkdownMedia =
  | { kind: "local"; filePath: string; type: "audio" | "video" }
  | { kind: "blocked"; reason: LocalFileLinkBlockReason }
  | { kind: "remote"; href: string }
  | { kind: "unavailable" };

function mediaUrlPathname(href: string): string {
  let pathname: string;
  try { pathname = new URL(href, "https://markdown.invalid").pathname; }
  catch { pathname = href.split(/[?#]/, 1)[0]; }
  // Classification only, never substitute decoded text for URL/path identity.
  try { return decodeURIComponent(pathname); } catch { return pathname; }
}

/** Recognition only: the file API remains the sole read-authorization boundary. */
export function resolveMarkdownMedia(href: string | undefined, cwd?: string): MarkdownMedia | null {
  if (!href) return null;
  const input = href.trim();
  const resolution = resolveLocalFileLink(input, cwd);
  const candidate = resolution?.kind === "local" ? resolution.filePath : mediaUrlPathname(input);
  const type = getAudioMime(candidate) ? "audio" : getVideoMime(candidate) ? "video" : null;
  if (!type) return null;
  if (resolution?.kind === "blocked") return resolution;
  if (resolution?.kind === "local") return { ...resolution, type };
  if (/^(?:https?:\/\/|\/\/)/i.test(input)) return { kind: "remote", href };
  // App/API URLs and unsupported schemes are never fetched as media or images.
  return { kind: "unavailable" };
}

export function markdownMediaFileUrl(filePath: string, sessionId?: string, download = false): string {
  const params = new URLSearchParams({ type: download ? "download" : "read" });
  if (sessionId) params.set("sessionId", sessionId);
  return `/api/files/${encodeFilePathForApi(filePath)}?${params}`;
}

/** Detach native resource ownership, including outstanding range requests. */
export function releaseMarkdownMedia(media: HTMLMediaElement): void {
  media.pause();
  media.removeAttribute("src");
  media.load();
}
