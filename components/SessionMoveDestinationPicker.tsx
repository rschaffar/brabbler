"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeFilePathSlashes } from "@/lib/file-paths";
import { DirectoryPicker } from "./DirectoryPicker";

interface DirectoryOption {
  path: string;
  branch: string | null;
  isMain?: boolean;
}

// Display-only equality for absolute paths supplied by the server. The move
// endpoint remains authoritative for realpath, registration and validation.
export function sameMoveDirectory(a: string, b: string): boolean {
  const key = (value: string) => {
    const slashes = normalizeFilePathSlashes(value);
    const trimmed = slashes.replace(/\/+$/, "") || "/";
    return /^(?:[a-z]:\/|\/\/)/i.test(slashes) ? trimmed.toLowerCase() : trimmed;
  };
  return key(a) === key(b);
}

export function moveDirectoryOptions(project: string, worktrees: DirectoryOption[]): DirectoryOption[] {
  // Non-Git directories and repository subdirectories stay directly selectable.
  return worktrees.some((item) => sameMoveDirectory(item.path, project))
    ? worktrees
    : [{ path: project, branch: null }, ...worktrees];
}

interface Props {
  projects: readonly { root: string; key: string }[];
  currentCwd: string;
  destination: string;
  onChange: (path: string) => void;
  disabled: boolean;
}

export function SessionMoveDestinationPicker({ projects, currentCwd, destination, onChange, disabled }: Props) {
  const { t } = useI18n();
  const [project, setProject] = useState("");
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [listing, setListing] = useState<{ project: string; options: DirectoryOption[]; error?: string } | null>(null);
  const loading = Boolean(project && listing?.project !== project);

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/worktrees?cwd=${encodeURIComponent(project)}`, { signal: controller.signal });
        const data = await response.json() as { worktrees?: DirectoryOption[]; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (cancelled) return;
        setListing({ project, options: moveDirectoryOptions(project, data.worktrees ?? []) });
        onChange(sameMoveDirectory(project, currentCwd) ? "" : project);
      } catch (error) {
        if (!cancelled) setListing({ project, options: [], error: String(error) });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [project, currentCwd, onChange, attempt]);

  const selectStyle = { width: "100%", padding: 8, color: "var(--text)", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6 };
  const options = listing?.project === project ? listing.options : [];
  return <>
    <label style={{ fontSize: 12 }} htmlFor="move-session-project">{t("sidebar.moveDestination")}</label>
    <select id="move-session-project" value={project} disabled={disabled} onChange={(event) => {
      setProject(event.target.value);
      setListing(null);
      onChange("");
    }} style={selectStyle}>
      <option value="">{t("sidebar.chooseProject")}</option>
      {projects.map((item) => <option key={item.key} value={item.root}>{item.root}</option>)}
    </select>
    <label style={{ fontSize: 12 }} htmlFor="move-session-directory">{t("sidebar.moveDirectory")}</label>
    <select id="move-session-directory" value={destination} disabled={disabled || loading || Boolean(listing?.error)} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
      <option value="">{loading ? t("sidebar.loading") : t("sidebar.chooseDirectory")}</option>
      {options.map((item) => <option key={item.path} value={item.path} disabled={sameMoveDirectory(item.path, currentCwd)}>
        {item.branch ?? (item.isMain ? t("sidebar.main") : t("sidebar.directory"))} · {item.path}{sameMoveDirectory(item.path, currentCwd) ? ` (${t("sidebar.currentDirectory")})` : ""}
      </option>)}
      {!project && destination && <option value={destination} disabled={sameMoveDirectory(destination, currentCwd)}>{destination}</option>}
    </select>
    {listing?.project === project && listing.error && <div role="alert" style={{ color: "#ef4444", fontSize: 12 }}>
      {listing.error} <button type="button" disabled={disabled} onClick={() => { setListing(null); setAttempt((value) => value + 1); }}>{t("sidebar.retry")}</button>
    </div>}
    <button type="button" disabled={disabled} onClick={() => setBrowsePath(destination || currentCwd)} style={{ textAlign: "left", color: "var(--accent)", background: "none", border: 0, cursor: "pointer" }}>{t("sidebar.browseProject")}</button>
    {browsePath !== null && <DirectoryPicker initialPath={browsePath} onCancel={() => setBrowsePath(null)} onSelect={(path) => {
      setProject("");
      setListing(null);
      onChange(sameMoveDirectory(path, currentCwd) ? "" : path);
      setBrowsePath(null);
    }} />}
  </>;
}
