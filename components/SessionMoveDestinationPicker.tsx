"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeFilePathSlashes } from "@/lib/file-paths";
import { DirectoryPicker } from "./DirectoryPicker";
import { readSessionMoveResponse, SessionMoveResponseError } from "@/lib/session-move-client";

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
  return Boolean(a && b) && key(a) === key(b);
}

export function moveDirectoryOptions(project: string, worktrees: DirectoryOption[]): DirectoryOption[] {
  // Non-Git directories and repository subdirectories stay directly selectable.
  return worktrees.some((item) => sameMoveDirectory(item.path, project))
    ? worktrees
    : [{ path: project, branch: null }, ...worktrees];
}

interface MoveOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function filterMoveOptions(options: MoveOption[], query: string): MoveOption[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((item) => terms.every((term) => item.label.toLocaleLowerCase().includes(term)));
}

function MoveDestinationSelect({ id, options, value, onChange, disabled, placeholder, filterLabel, emptyLabel }: {
  id: string;
  options: MoveOption[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  filterLabel: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const expanded = open && !disabled;
  const filtered = filterMoveOptions(options, query);
  const selected = options.find((item) => item.value === value)?.label ?? value;
  const activeOption = filtered[active];
  const show = () => {
    if (!open) { setQuery(""); setActive(-1); setOpen(true); }
  };
  const choose = (item: MoveOption) => {
    if (item.disabled) return;
    onChange(item.value);
    setOpen(false);
  };
  useEffect(() => {
    if (expanded && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);

  return <div style={{ position: "relative", minWidth: 0 }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", opacity: disabled ? 0.5 : 1 }}>
      <input ref={inputRef} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={`${id}-options`} aria-activedescendant={expanded && activeOption ? `${id}-option-${active}` : undefined}
        data-value={value} value={expanded ? query : selected} disabled={disabled}
        placeholder={expanded ? filterLabel : placeholder} title={selected || placeholder}
        autoComplete="off" spellCheck={false} onFocus={show} onClick={show}
        onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && expanded) {
            event.preventDefault(); event.stopPropagation(); setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); show();
            const step = event.key === "ArrowDown" ? 1 : -1;
            const navigable = expanded ? filtered : options;
            let next = expanded && active >= 0 ? active : step === 1 ? -1 : 0;
            for (let count = 0; count < navigable.length; count++) {
              next = (next + step + navigable.length) % navigable.length;
              if (!navigable[next].disabled) { setActive(next); break; }
            }
          } else if (event.key === "Enter" && expanded) {
            event.preventDefault();
            if (activeOption) choose(activeOption);
            else if (filtered.filter((item) => !item.disabled).length === 1) choose(filtered.find((item) => !item.disabled)!);
          }
        }}
        style={{ width: "100%", minWidth: 0, padding: 8, color: "var(--text)", background: "none", border: 0, borderRadius: 6, textOverflow: "ellipsis" }} />
      <button type="button" tabIndex={-1} aria-label={filterLabel} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => {
          if (expanded) setOpen(false);
          else { inputRef.current?.focus(); show(); }
        }} style={{ padding: "0 8px", color: "var(--text-muted)", background: "none", border: 0, cursor: "pointer" }}>▾</button>
    </div>
    {expanded && <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 1, marginTop: 4, padding: 4, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 4px 16px #0004" }}>
      <div ref={listRef} id={`${id}-options`} role="listbox" aria-label={filterLabel} style={{ maxHeight: 180, overflowY: "auto" }}>
        {filtered.map((item, index) => <button type="button" role="option" id={`${id}-option-${index}`} key={item.value}
          data-value={item.value} aria-selected={item.value === value} disabled={item.disabled} tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}
          onMouseEnter={() => setActive(index)}
          style={{ display: "block", width: "100%", padding: 8, textAlign: "left", overflowWrap: "anywhere", border: 0, borderRadius: 4, color: item.disabled ? "var(--text-dim)" : "var(--text)", background: index === active ? "var(--bg-hover)" : item.value === value ? "var(--bg-selected)" : "none", cursor: item.disabled ? "default" : "pointer", fontSize: 12 }}>
          {item.label}
        </button>)}
      </div>
      {filtered.length === 0 && <div role="status" style={{ padding: 8, color: "var(--text-muted)", fontSize: 12 }}>{emptyLabel}</div>}
    </div>}
  </div>;
}

interface Props {
  projects: readonly { root: string; key: string }[];
  currentProject: string;
  currentCwd: string;
  sourceUnavailable?: boolean;
  allowCurrentDirectory?: boolean;
  destination: string;
  onChange: (path: string) => void;
  disabled: boolean;
}

export function SessionMoveDestinationPicker({ projects, currentProject, currentCwd, sourceUnavailable = false, allowCurrentDirectory = false, destination, onChange, disabled }: Props) {
  const { t } = useI18n();
  const [project, setProject] = useState(currentProject);
  const [sourceExplicitlySelected, setSourceExplicitlySelected] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [listing, setListing] = useState<{ project: string; options: DirectoryOption[]; error?: string } | null>(null);
  // Historical source paths remain visible without probing a vanished checkout.
  const unavailableSource = sourceUnavailable && sameMoveDirectory(project, currentProject) && !sourceExplicitlySelected;
  const loading = Boolean(project && !unavailableSource && listing?.project !== project);

  useEffect(() => {
    if (!project || unavailableSource) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/worktrees?cwd=${encodeURIComponent(project)}`, { signal: controller.signal });
        const data = await readSessionMoveResponse<{ worktrees?: DirectoryOption[] }>(response);
        if (cancelled) return;
        setListing({ project, options: moveDirectoryOptions(project, data.worktrees ?? []) });
        onChange(sameMoveDirectory(project, currentProject) || sameMoveDirectory(project, currentCwd) ? "" : project);
      } catch (error) {
        if (!cancelled) setListing({ project, options: [], error: error instanceof SessionMoveResponseError
          ? t("sessionWorktrees.invalidResponse", { status: error.status }) : String(error) });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [project, currentProject, currentCwd, unavailableSource, onChange, attempt, t]);

  const options = listing?.project === project ? [...listing.options] : [];
  const showingSource = sameMoveDirectory(project, currentProject);
  if (showingSource && currentCwd && !options.some(item => sameMoveDirectory(item.path, currentCwd))) {
    options.unshift({ path: currentCwd, branch: null });
  }
  const projectOptions = projects.map((item) => ({ value: item.root, label: item.root }));
  if (!projectOptions.some((item) => sameMoveDirectory(item.value, currentProject))) {
    projectOptions.unshift({ value: currentProject, label: currentProject });
  }
  const directoryOptions = options.map((item) => ({
    value: item.path,
    label: `${item.branch ?? (item.isMain ? t("sidebar.main") : t("sidebar.directory"))} · ${item.path}${sameMoveDirectory(item.path, currentCwd) ? ` (${t("sidebar.currentDirectory")})` : ""}`,
    disabled: sameMoveDirectory(item.path, currentCwd) && (!allowCurrentDirectory || sourceUnavailable),
  }));
  if (!project && destination) directoryOptions.push({ value: destination, label: destination, disabled: !allowCurrentDirectory && sameMoveDirectory(destination, currentCwd) });
  return <>
    <label style={{ fontSize: 12 }} htmlFor="move-session-project">{t("sidebar.moveDestination")}</label>
    <MoveDestinationSelect id="move-session-project" value={project} options={projectOptions} disabled={disabled}
      placeholder={t("sidebar.chooseProject")} filterLabel={t("sidebar.filterProjects")} emptyLabel={t("sidebar.noMatchingProjects")}
      onChange={(value) => {
        if (value === project) {
          if (unavailableSource) setSourceExplicitlySelected(true);
          return;
        }
        setSourceExplicitlySelected(true);
        setProject(value);
        setListing(null);
        onChange("");
      }} />
    <label style={{ fontSize: 12 }} htmlFor="move-session-directory">{t("sidebar.moveDirectory")}</label>
    <MoveDestinationSelect key={project} id="move-session-directory" value={destination || (showingSource ? currentCwd : "")} options={directoryOptions}
      disabled={disabled || (!project && !destination) || loading || Boolean(listing?.error)} onChange={onChange}
      placeholder={loading ? t("sidebar.loading") : t("sidebar.chooseDirectory")}
      filterLabel={t("sidebar.filterWorktrees")} emptyLabel={t("sidebar.noMatchingWorktrees")} />
    {listing?.project === project && listing.error && <div role="alert" style={{ color: "#ef4444", fontSize: 12 }}>
      {listing.error} <button type="button" disabled={disabled} onClick={() => { setListing(null); setAttempt((value) => value + 1); }}>{t("sidebar.retry")}</button>
    </div>}
    <button type="button" disabled={disabled} onClick={() => setBrowsePath(destination || currentCwd || currentProject)} style={{ textAlign: "left", color: "var(--accent)", background: "none", border: 0, cursor: "pointer" }}>{t("sidebar.browseProject")}</button>
    {browsePath !== null && <DirectoryPicker initialPath={browsePath} onCancel={() => setBrowsePath(null)} onSelect={(path) => {
      setProject("");
      setListing(null);
      onChange(!allowCurrentDirectory && sameMoveDirectory(path, currentCwd) ? "" : path);
      setBrowsePath(null);
    }} />}
  </>;
}
