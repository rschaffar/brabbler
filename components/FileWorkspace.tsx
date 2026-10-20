"use client";
import "./file-workspace.css";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, useLayoutEffect } from "react";
import { FileViewer } from "./FileViewer";
import { TabBar } from "./TabBar";
import { FileEditContext } from "@/hooks/useFileEditSession";
import { FileEditSessions } from "@/lib/file-edit-sessions";
import { FileWorkspaceStore } from "@/lib/file-workspace-store";
import { FileLinkMenuContext } from "./LocalFileLink";
import { useI18n } from "@/hooks/useI18n";
import {
  createFileWorkspace, groupIds, viewGroup, patchFileView, selectFileView, splitFileGroup, openWorkspaceFile,
  closeFileView, closeFileGroup, moveFileView, navigateFileHistory, fileGeometry, minimumFileSize, resizeFileSplit,
  MIN_FILE_WIDTH, MIN_FILE_HEIGHT, FILE_SEPARATOR,
  type FileWorkspaceState, type FileLocation, type FileDisposition, type FileRect, type SplitAxis,
} from "@/lib/file-workspace";

export interface FileWorkspaceHandle {
  open: (location: FileLocation, disposition?: FileDisposition) => void;
  focus: (key?: string) => void;
}
export interface FileWorkspaceStatus { count: number; groups: { id: string; label: string }[]; canSplit: boolean }
interface Props {
  workspaceKey: string;
  active: boolean;
  presented: boolean;
  gitRefreshKey: number;
  onStatus: (status: FileWorkspaceStatus) => void;
  onShowFiles: () => void;
  onEmpty: () => void;
  onFocusWorkspace: (key: string) => void;
  mentionCwd?: string;
  onMentionLines: (path: string, start: number, end: number) => void;
  onAtMention: (path: string, isDir: boolean) => void;
}
const EMPTY = createFileWorkspace();
const HEADER = 76;
const composite = (key: string, id: string) => `${key}\0${id}`;
const position = (rect: FileRect) => ({ position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height });

/** Layout topology never becomes the React ancestry of a live file/terminal. */
export const FileWorkspace = forwardRef<FileWorkspaceHandle, Props>(function FileWorkspace(props, ref) {
  const { t } = useI18n();
  const { onStatus, onFocusWorkspace, onShowFiles, workspaceKey, presented } = props;
  const [store] = useState(() => new FileWorkspaceStore());
  const bank = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [edits] = useState(() => new FileEditSessions());
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState("");
  const [returnView, setReturnView] = useState<{ key: string; id: string }>();
  const [closing, setClosing] = useState<{ key: string; id: string }>();
  const closeDialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<{ key: string; location: FileLocation; origin: string }>();
  const routeDialog = useRef<HTMLDialogElement>(null);
  const state = bank[props.workspaceKey] ?? EMPTY;
  const ordered = groupIds(state.tree);
  const minimum = minimumFileSize(state.tree);
  const compact = size.width < minimum.width || size.height < minimum.height;
  const projected = state.focused ?? (compact ? state.activeGroup : undefined);
  const geometry = projected
    ? { groups: { [projected]: { x: 0, y: 0, ...size } }, dividers: [] }
    : fileGeometry(state.tree, { x: 0, y: 0, ...size });
  const commit = useCallback((key: string, change: (state: FileWorkspaceState) => FileWorkspaceState, silent = false) => {
    const previous = store.snapshot()[key] ?? EMPTY;
    const next = change(previous);
    if (next === previous) return;
    const removed = Object.keys(previous.views).filter(id => !next.views[id]);
    if (removed.some(id => {
      const session = edits.snapshot(composite(key, id));
      return session.owner === composite(key, id) && (session.saving || session.draft);
    })) return; // explicit close first resolves/discards the owner through canClose
    removed.forEach(id => edits.close(composite(key, id)));
    store.set(key, next, silent);
  }, [edits, store]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (edits.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [edits]);
  const paneName = (id: string) => {
    const group = state.groups[id];
    return `${t("workspace.pane", { number: id.slice(5) })}${group?.active ? ` — ${state.views[group.active].label}` : ""}`;
  };
  const groups = ordered.map(id => ({ id, label: paneName(id) }));
  const groupSignature = groups.map(group => `${group.id}:${group.label}`).join("\0");
  const menuContext = useMemo(() => ({ groups: groupSignature ? groupSignature.split("\0").map(value => {
    const at = value.indexOf(":"); return { id: value.slice(0, at), label: value.slice(at + 1) };
  }) : [], canSplit: props.active }), [groupSignature, props.active]);
  const viewCount = Object.keys(state.views).length;
  useEffect(() => onStatus({ count: viewCount, ...menuContext }), [viewCount, menuContext, onStatus]);
  useEffect(() => { if (closing) closeDialog.current?.showModal(); }, [closing]);
  useEffect(() => { if (pending) routeDialog.current?.showModal(); }, [pending]);
  useEffect(() => {
    if (closing && closing.key !== props.workspaceKey) closeDialog.current?.close();
    if (pending && pending.key !== props.workspaceKey) routeDialog.current?.close();
  }, [props.workspaceKey, closing, pending]);
  const canSplit = (group: string, axis: SplitAxis) => {
    if (projected && ordered.length > 1) return false;
    const rect = geometry.groups[group];
    return Boolean(rect && (axis === "right" ? rect.width >= MIN_FILE_WIDTH * 2 + FILE_SEPARATOR : rect.height >= MIN_FILE_HEIGHT * 2 + FILE_SEPARATOR));
  };
  const split = (group: string, axis: SplitAxis, routeFrom?: string) => {
    if (!canSplit(group, axis)) { setStatus(t("workspace.needSpace")); return; }
    commit(props.workspaceKey, previous => {
      const next = splitFileGroup(previous, group, axis, !routeFrom);
      const destination = Object.keys(next.groups).find(id => !previous.groups[id])!;
      return routeFrom ? patchFileView(next, routeFrom, { route: destination }) : next;
    });
  };
  const pendingDomFocus = useRef<{ key: string; group: string } | undefined>(undefined);
  const flushDomFocus = useCallback(() => {
    const target = pendingDomFocus.current;
    if (!target || target.key !== workspaceKey || !presented || document.querySelector("dialog:modal")) return;
    const view = store.snapshot()[target.key]?.groups[target.group]?.active;
    const element = view ? document.getElementById(`file-view-${encodeURIComponent(composite(target.key, view))}`)
      : root.current?.querySelector<HTMLElement>(`[data-file-pane="${target.group}"]`);
    if (element?.getClientRects().length) {
      element.focus({ preventScroll: true }); pendingDomFocus.current = undefined;
    }
  }, [store, workspaceKey, presented]);
  useLayoutEffect(() => { flushDomFocus(); });
  const focusPaneDom = useCallback((key: string, group: string) => {
    pendingDomFocus.current = { key, group };
    queueMicrotask(flushDomFocus);
  }, [flushDomFocus]);
  const focusView = useCallback((owner: string) => {
    for (const [key, workspace] of Object.entries(store.snapshot())) {
      const id = Object.keys(workspace.views).find(id => composite(key, id) === owner);
      const group = id && viewGroup(workspace, id);
      if (id && group) {
        commit(key, state => ({ ...selectFileView(state, group, id), focused: undefined }));
        onFocusWorkspace(key); onShowFiles();
        focusPaneDom(key, group);
        return;
      }
    }
  }, [commit, store, focusPaneDom, onFocusWorkspace, onShowFiles]);
  const focusGroup = (id: string) => {
    const view = state.groups[id]?.active;
    if (view) focusView(composite(props.workspaceKey, view));
    else {
      commit(props.workspaceKey, state => ({ ...selectFileView(state, id), focused: undefined }));
      focusPaneDom(props.workspaceKey, id);
    }
  };
  const open = (location: FileLocation, origin?: string, disposition: FileDisposition = { kind: "normal" }, originWorkspace = props.workspaceKey) => {
    if (originWorkspace !== props.workspaceKey) return;
    const current = store.snapshot()[props.workspaceKey] ?? EMPTY;
    const source = origin ? current.views[origin] : undefined;
    const base = origin ? viewGroup(current, origin)! : current.activeGroup;
    if (disposition.kind === "split" && !canSplit(base, disposition.axis)) { setStatus(t("workspace.needSpace")); return; }
    if (disposition.kind === "normal" && source?.route && source.filePath !== location.filePath && !current.groups[source.route]) {
      setPending({ key: props.workspaceKey, location, origin: origin! }); return;
    }
    const next = openWorkspaceFile(current, location, origin, disposition);
    if (next === current) return;
    commit(props.workspaceKey, () => next);
    const destination = next.lastOpen ? next.groups[next.lastOpen.group] : undefined;
    if (compact && destination && destination.id !== base) {
      if (origin) setReturnView({ key: props.workspaceKey, id: origin });
      commit(props.workspaceKey, state => selectFileView(state, destination.id));
      focusPaneDom(props.workspaceKey, destination.id);
    }
    setStatus(t("workspace.opened", { name: location.label }));
  };
  useImperativeHandle(ref, () => ({
    open: (location, disposition) => open(location, undefined, disposition),
    focus: (key = props.workspaceKey) => focusPaneDom(key, (store.snapshot()[key] ?? EMPTY).activeGroup),
  }));
  const protect = (key: string, id: string) => {
    const session = edits.snapshot(composite(key, id));
    return session.owner === composite(key, id) ? session : { saving: false, draft: undefined };
  };
  const canClose = (key: string, ids: string[]) => {
    if (ids.some(id => protect(key, id).saving)) return false;
    return ids.every(id => {
      const draft = protect(key, id).draft;
      return !draft || draft.content === draft.baseline || window.confirm(t("files.discardConfirm"));
    });
  };
  const closeView = (id: string) => {
    if (!canClose(props.workspaceKey, [id])) return;
    edits.close(composite(props.workspaceKey, id));
    commit(props.workspaceKey, state => closeFileView(state, id));
    const next = store.snapshot()[props.workspaceKey] ?? EMPTY;
    if (!Object.keys(next.views).length) {
      pendingDomFocus.current = undefined;
      props.onEmpty();
    } else focusPaneDom(props.workspaceKey, next.activeGroup);
  };
  const finishClose = (moveTo?: string) => {
    if (!closing || closing.key !== props.workspaceKey) return;
    const current = store.snapshot()[closing.key] ?? EMPTY;
    const ids = current.groups[closing.id]?.views ?? [];
    if (ids.some(id => protect(props.workspaceKey, id).saving) || (!moveTo && !canClose(props.workspaceKey, ids))) return;
    if (!moveTo) ids.forEach(id => edits.close(composite(props.workspaceKey, id)));
    commit(closing.key, state => closeFileGroup(state, closing.id, moveTo));
    closeDialog.current?.close(); setClosing(undefined);
  };
  const parkedEditors = Object.entries(bank).flatMap(([key, workspace]) => key === props.workspaceKey ? []
    : Object.values(workspace.views).flatMap(view => {
      const owner = composite(key, view.id), session = edits.snapshot(owner);
      return session.owner === owner && (session.saving || (session.draft && session.draft.content !== session.draft.baseline))
        ? [{ owner, label: `${view.label} — ${view.cwd ?? view.filePath}` }] : [];
    }));
  const contextFor = (key: string, id: string) => ({ store: edits, viewId: composite(key, id), focusView });
  // All live view hosts are siblings. Group moves therefore preserve React identity.
  const hosts = Object.entries(bank).flatMap(([key, workspace]) => Object.values(workspace.views).flatMap(view => {
    const groupId = viewGroup(workspace, view.id)!;
    const selected = key === props.workspaceKey && workspace.groups[groupId].active === view.id;
    const visible = selected && props.presented && Boolean(geometry.groups[groupId]);
    const session = protect(key, view.id);
    // Hiding/expanding the outer panel and responsive projection retain each
    // group's selected reader. Inactive tabs may unmount; edit owners settle.
    if (!selected && !session.draft && !session.saving) return [];
    const rect = geometry.groups[groupId] ?? { x: 0, y: 0, width: 0, height: 0 };
    return [<div key={composite(key, view.id)} id={`file-view-${encodeURIComponent(composite(key, view.id))}`} role="tabpanel" aria-label={`${t("workspace.pane", { number: groupId.slice(5) })} — ${view.label}`}
      hidden={!visible} inert={!visible} tabIndex={-1} className="file-workspace-view"
      onPointerDown={() => commit(key, state => selectFileView(state, groupId))}
      style={{ ...position({ ...rect, y: rect.y + HEADER, height: Math.max(0, rect.height - HEADER) }), display: visible ? "block" : "none" }}>
      <FileEditContext.Provider value={contextFor(key, view.id)}>
        <FileLinkMenuContext.Provider value={{ ...menuContext, contextKey: props.workspaceKey }}>
          <FileViewer filePath={view.filePath} cwd={view.cwd} sourceSessionId={view.sourceSessionId} gitRefreshKey={props.gitRefreshKey}
            navigationId={view.viewerRevision} initialDisplayMode={view.initialDisplayMode} initialState={view.viewerState}
            initialPage={view.page} initialLineTarget={view.lineTarget} watchEnabled={visible && props.active}
            onEditingChange={() => commit(key, state => patchFileView(state, view.id, { preview: false }))}
            onDraftChange={draft => commit(key, state => patchFileView(state, view.id, { draft }))}
            onSavingChange={saving => commit(key, state => {
              let next = patchFileView(state, view.id, { saving });
              const queued = next.views[view.id]?.pendingOpen;
              if (!saving && queued) {
                next = patchFileView(next, view.id, { pendingOpen: undefined });
                next = openWorkspaceFile(next, { ...queued, label: queued.fileName, cwd: view.cwd }, view.id, { kind: "here" });
              }
              return next;
            })}
            onStateChange={(viewerState, handled) => commit(key, state => patchFileView(state, view.id,
              { viewerState, ...(handled ? { lineTarget: undefined } : {}) }), true)}
            onMentionLines={visible && props.active ? (path, start, end) => props.onMentionLines(view.cwd === props.mentionCwd ? path : view.filePath, start, end) : undefined}
            onAtMention={(path, isDir) => props.onAtMention(view.cwd === props.mentionCwd ? path : view.filePath, isDir)}
            onOpenFile={(filePath, page, lineTarget, disposition) => open({ filePath, label: filePath.split(/[\\/]/).at(-1) ?? filePath,
              cwd: view.cwd, sourceSessionId: view.sourceSessionId, page, lineTarget }, view.id, disposition, key)} />
        </FileLinkMenuContext.Provider>
      </FileEditContext.Provider>
    </div>];
  }));
  return <div className="file-workspace" style={{ height: "100%", display: "flex", flexDirection: "column" }}
    onKeyDown={event => {
      if (event.key !== "Escape") return;
      const details = (event.target as Element).closest("details[open]");
      if (details) {
        details.removeAttribute("open");
        const group = details.closest<HTMLElement>("[data-file-pane]")?.dataset.filePane;
        if (group) focusPaneDom(props.workspaceKey, group);
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (state.focused) { commit(props.workspaceKey, state => ({ ...state, focused: undefined })); event.preventDefault(); event.stopPropagation(); }
    }}>
    {parkedEditors.length > 0 && <div className="file-workspace-switcher">
      <select aria-label={t("workspace.parkedEditors")} value="" onChange={event => { if (event.target.value) focusView(decodeURIComponent(event.target.value)); }}>
        <option value="">{t("workspace.chooseEditor", { count: parkedEditors.length })}</option>
        {parkedEditors.map(editor => <option key={editor.owner} value={encodeURIComponent(editor.owner)}>{editor.label}</option>)}
      </select>
    </div>}
    {(compact || state.focused) && ordered.length > 1 && <div className="file-workspace-switcher">
      <select aria-label={t("workspace.choosePane")} value={projected} onChange={event => commit(props.workspaceKey, state => ({ ...selectFileView(state, event.target.value), focused: state.focused ? event.target.value : undefined }))}>
        {groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
      </select>
      {state.focused && <button type="button" onClick={() => focusGroup(state.focused!)}>{t("workspace.restore")}</button>}
      {returnView?.key === props.workspaceKey && state.views[returnView.id] && <button type="button" onClick={() => { focusView(composite(returnView.key, returnView.id)); setReturnView(undefined); }}>{t("workspace.backToGuide")}</button>}
    </div>}
    <div ref={root} className="file-workspace-canvas" style={{ position: "relative", flex: 1, minHeight: 0 }}>
      {ordered.map(id => {
        const group = state.groups[id], view = group.active ? state.views[group.active] : undefined;
        const rect = geometry.groups[id];
        return <section key={id} hidden={!rect} tabIndex={-1} aria-label={paneName(id)} data-file-pane={id}
          className={`file-workspace-group${state.activeGroup === id ? " is-active" : ""}`}
          style={rect ? position(rect) : { display: "none" }} onPointerDown={() => commit(props.workspaceKey, state => selectFileView(state, id))}>
          <div className="file-workspace-group-header">
            <span title={paneName(id)}>{id.slice(5)}</span>
            <div style={{ minWidth: 0, flex: 1 }}><TabBar tabs={group.views.map(viewId => ({ ...state.views[viewId], label: `${state.views[viewId].label}${group.views.filter(other => state.views[other].filePath === state.views[viewId].filePath).length > 1 ? ` · ${t("workspace.viewNumber", { number: viewId.split("-").at(-1)! })}` : ""}${state.views[viewId].preview ? ` · ${t("workspace.preview")}` : ""}` }))}
              ariaLabel={paneName(id)} getPanelId={viewId => `file-view-${encodeURIComponent(composite(props.workspaceKey, viewId))}`}
              activeTabId={group.active ?? ""} onSelectTab={viewId => commit(props.workspaceKey, state => selectFileView(state, id, viewId))} onCloseTab={closeView} onKeepTab={viewId => commit(props.workspaceKey, state => patchFileView(state, viewId, { preview: false }))} /></div>
          </div>
          <div className="file-workspace-controls">
            <button type="button" aria-label={t("workspace.back")} disabled={!group.back.length} onClick={() => commit(props.workspaceKey, state => navigateFileHistory(state, id, "back"))}>←</button>
            <button type="button" aria-label={t("workspace.forward")} disabled={!group.forward.length} onClick={() => commit(props.workspaceKey, state => navigateFileHistory(state, id, "forward"))}>→</button>
            {view && <select aria-label={t("workspace.links")} value={view.route ?? "here"} onChange={event => {
              const value = event.target.value;
              if (value === "new-right" || value === "new-below") split(id, value === "new-right" ? "right" : "below", view.id);
              else commit(props.workspaceKey, state => patchFileView(state, view.id, { route: value === "here" ? undefined : value }));
            }}>
              <option value="here">{t("workspace.linksHere")}</option>
              {view.route && !state.groups[view.route] && <option value={view.route}>{t("workspace.chooseDestination")}</option>}
              {groups.filter(group => group.id !== id).map(group => <option key={group.id} value={group.id}>{t("workspace.linksTo", { pane: group.label })}</option>)}
              <option value="new-right" disabled={!canSplit(id, "right")}>{t("workspace.newRight")}</option>
              <option value="new-below" disabled={!canSplit(id, "below")}>{t("workspace.newBelow")}</option>
            </select>}
            {view?.preview && <button type="button" onClick={() => { commit(props.workspaceKey, state => patchFileView(state, view.id, { preview: false })); focusPaneDom(props.workspaceKey, id); }}>{t("workspace.keep")}</button>}
            <details className="file-workspace-options" onClick={event => {
              if ((event.target as Element).closest("button")) {
                event.currentTarget.open = false;
                const next = store.snapshot()[props.workspaceKey] ?? EMPTY;
                if (!pendingDomFocus.current) focusPaneDom(props.workspaceKey, next.activeGroup);
              }
            }}><summary aria-label={t("workspace.paneActions")}>⋯</summary><div className="file-workspace-menu">
              <button type="button" title={t("workspace.needSpace")} disabled={!canSplit(id, "right")} onClick={() => split(id, "right")}>{t("workspace.splitRight")}</button>
              <button type="button" title={t("workspace.needSpace")} disabled={!canSplit(id, "below")} onClick={() => split(id, "below")}>{t("workspace.splitBelow")}</button>
              {view && groups.filter(group => group.id !== id).map(group => <button type="button" key={group.id} onClick={() => commit(props.workspaceKey, state => moveFileView(state, view.id, group.id))}>{t("workspace.moveTo", { pane: group.label })}</button>)}
              <button type="button" onClick={() => {
                commit(props.workspaceKey, state => ({ ...state, focused: state.focused ? undefined : id }));
                focusPaneDom(props.workspaceKey, id);
              }}>{t(state.focused ? "workspace.restore" : "workspace.focus")}</button>
              <button type="button" onClick={() => focusGroup(ordered[(ordered.indexOf(id) + ordered.length - 1) % ordered.length])}>{t("workspace.previousPane")}</button>
              <button type="button" onClick={() => focusGroup(ordered[(ordered.indexOf(id) + 1) % ordered.length])}>{t("workspace.nextPane")}</button>
              <button type="button" disabled={ordered.length === 1} onClick={() => setClosing({ key: props.workspaceKey, id })}>{t("workspace.closePane")}</button>
              <button type="button" onClick={() => commit(props.workspaceKey, state => {
                const first = groupIds(state.tree)[0];
                const views = Object.fromEntries(Object.entries(state.views).map(([id, view]) => [id, { ...view, route: undefined }]));
                return { ...state, views, focused: undefined, activeGroup: first, tree: { kind: "group", id: first }, groups: { [first]: { ...state.groups[first], views: Object.keys(views), active: group.active ?? state.groups[first].active ?? Object.keys(views)[0] } } };
              })}>{t("workspace.reset")}</button>
            </div></details>
          </div>
          {!view && <div className="file-workspace-empty">{t("files.noneOpen")}</div>}
        </section>;
      })}
      {hosts}
      {geometry.dividers.map(divider => <div key={divider.id} role="separator" tabIndex={0}
        aria-label={t("workspace.resize")} aria-orientation={divider.axis === "right" ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(divider.minimum * 100)} aria-valuemax={Math.round(divider.maximum * 100)} aria-valuenow={Math.round(divider.ratio * 100)}
        className={`file-workspace-divider ${divider.axis}`} style={position(divider.rect)}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return;
          const bounds = root.current.getBoundingClientRect(), horizontal = divider.axis === "right";
          const candidate = horizontal ? (event.clientX - bounds.left - divider.parent.x) / (divider.parent.width - FILE_SEPARATOR)
            : (event.clientY - bounds.top - divider.parent.y) / (divider.parent.height - FILE_SEPARATOR);
          commit(props.workspaceKey, state => ({ ...state, tree: resizeFileSplit(state.tree, divider.id, Math.max(divider.minimum, Math.min(divider.maximum, candidate))) }));
        }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onDoubleClick={() => commit(props.workspaceKey, state => ({ ...state, tree: resizeFileSplit(state.tree, divider.id, 0.5) }))}
        onKeyDown={event => {
          const positive = divider.axis === "right" ? "ArrowRight" : "ArrowDown", negative = divider.axis === "right" ? "ArrowLeft" : "ArrowUp";
          if (![positive, negative, "Home", "End", "Enter"].includes(event.key)) return;
          event.preventDefault();
          const ratio = event.key === "Home" ? divider.minimum : event.key === "End" ? divider.maximum : event.key === "Enter" ? 0.5 : divider.ratio + (event.key === positive ? 0.02 : -0.02);
          commit(props.workspaceKey, state => ({ ...state, tree: resizeFileSplit(state.tree, divider.id, Math.max(divider.minimum, Math.min(divider.maximum, ratio))) }));
        }} />)}
    </div>
    <div role="status" className={status === t("workspace.needSpace") ? "file-workspace-notice" : "file-workspace-status"}>{status}</div>
    <dialog ref={closeDialog} className="file-link-dialog" aria-label={t("workspace.closePane")} onClose={() => {
      if (closing?.key === props.workspaceKey) {
        const next = store.snapshot()[closing.key] ?? EMPTY;
        focusPaneDom(closing.key, next.groups[closing.id] ? closing.id : next.activeGroup);
      }
      setClosing(undefined);
    }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDialog.current?.close(); } }}>
      <div className="file-workspace-menu">
        {groups.filter(group => group.id !== closing?.id).map(group => <button type="button" key={group.id} onClick={() => finishClose(group.id)}>{t("workspace.moveTabs", { pane: group.label })}</button>)}
        <button type="button" onClick={() => finishClose()}>{t("workspace.closeTabs")}</button>
        <button type="button" onClick={() => closeDialog.current?.close()}>{t("i18n.cancel")}</button>
      </div>
    </dialog>
    <dialog ref={routeDialog} className="file-link-dialog" aria-label={t("workspace.chooseDestination")} onClose={() => {
      if (pending?.key === props.workspaceKey) {
        const next = store.snapshot()[pending.key] ?? EMPTY;
        focusPaneDom(pending.key, viewGroup(next, pending.origin) ?? next.activeGroup);
      }
      setPending(undefined);
    }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); routeDialog.current?.close(); } }}>
      <div className="file-workspace-menu">
        <button type="button" onClick={() => { if (pending?.key === props.workspaceKey) open(pending.location, pending.origin, { kind: "here" }); routeDialog.current?.close(); }}>{t("workspace.openHere")}</button>
        {groups.map(group => <button type="button" key={group.id} onClick={() => { if (pending?.key === props.workspaceKey) {
          commit(pending.key, state => patchFileView(state, pending.origin, { route: viewGroup(state, pending.origin) === group.id ? undefined : group.id }));
          open(pending.location, pending.origin, { kind: "group", id: group.id });
        } routeDialog.current?.close(); }}>{t("workspace.openIn", { pane: group.label })}</button>)}
        <button type="button" onClick={() => routeDialog.current?.close()}>{t("i18n.cancel")}</button>
      </div>
    </dialog>
  </div>;
});
