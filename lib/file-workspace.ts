import type { FileTab } from "./file-tab";
import type { FileLineTarget } from "./file-links";

export interface FileLocation {
  filePath: string;
  label: string;
  cwd?: string;
  sourceSessionId?: string | null;
  page?: number;
  lineTarget?: FileLineTarget;
  modeHint?: "diff";
  viewerState?: FileTab["viewerState"];
}
export interface FileView extends FileTab {
  cwd?: string;
  preview?: boolean;
  /** undefined: ordinary navigation; missing group IDs remain visibly invalid. */
  route?: string;
  lastActive?: number;
}
export type SplitAxis = "right" | "below";
export type FileLayout = { kind: "group"; id: string } | {
  kind: "split"; id: string; axis: SplitAxis; ratio: number; first: FileLayout; second: FileLayout;
};
export interface FileGroup {
  id: string;
  views: string[];
  active?: string;
  back: FileLocation[];
  forward: FileLocation[];
}
export interface FileWorkspaceState {
  tree: FileLayout;
  groups: Record<string, FileGroup>;
  views: Record<string, FileView>;
  activeGroup: string;
  nextId: number;
  nextPane: number;
  focused?: string;
}
export type FileDisposition = { kind: "normal" | "here" } | { kind: "group"; id: string } | { kind: "split"; axis: SplitAxis };
export const MIN_FILE_WIDTH = 320;
export const MIN_FILE_HEIGHT = 276;
export const FILE_SEPARATOR = 6;
export function createFileWorkspace(): FileWorkspaceState {
  const group = { id: "pane-1", views: [], back: [], forward: [] };
  return { tree: { kind: "group", id: group.id }, groups: { [group.id]: group }, views: {}, activeGroup: group.id, nextId: 2, nextPane: 2 };
}
export function groupIds(tree: FileLayout): string[] {
  return tree.kind === "group" ? [tree.id] : [...groupIds(tree.first), ...groupIds(tree.second)];
}
export function viewGroup(state: FileWorkspaceState, id: string): string | undefined {
  return Object.values(state.groups).find(group => group.views.includes(id))?.id;
}
export function patchFileView(state: FileWorkspaceState, id: string, patch: Partial<FileView>): FileWorkspaceState {
  const view = state.views[id];
  if (!view) return state;
  const next = { ...view, ...patch };
  if (next.saving || (next.draft && next.draft.content !== next.draft.baseline)) next.preview = false;
  return { ...state, views: { ...state.views, [id]: next } };
}
export function selectFileView(state: FileWorkspaceState, groupId: string, viewId?: string): FileWorkspaceState {
  const group = state.groups[groupId];
  if (!group || (viewId && !group.views.includes(viewId))) return state;
  const active = viewId ?? group.active;
  if (state.activeGroup === groupId && group.active === active) return state;
  return { ...state, nextId: state.nextId + 1, activeGroup: groupId,
    views: active ? { ...state.views, [active]: { ...state.views[active], lastActive: state.nextId } } : state.views,
    groups: { ...state.groups, [groupId]: { ...group, active } } };
}
function replaceGroup(tree: FileLayout, id: string, replacement: FileLayout): FileLayout {
  if (tree.kind === "group") return tree.id === id ? replacement : tree;
  return { ...tree, first: replaceGroup(tree.first, id, replacement), second: replaceGroup(tree.second, id, replacement) };
}
export function splitFileGroup(state: FileWorkspaceState, id: string, axis: SplitAxis, duplicate = true): FileWorkspaceState {
  const group = state.groups[id];
  if (!group) return state;
  let serial = state.nextId;
  const newId = `pane-${state.nextPane}`;
  const newGroup: FileGroup = { id: newId, views: [], back: [], forward: [] };
  const views = { ...state.views };
  if (duplicate && group.active) {
    const view = views[group.active];
    const viewId = `file:view-${serial++}`;
    views[viewId] = { ...view, id: viewId, draft: undefined, saving: false, pendingOpen: undefined, route: undefined, preview: false, lineTarget: undefined };
    newGroup.views = [viewId];
    newGroup.active = viewId;
  }
  const replacement: FileLayout = { kind: "split", id: `split-${serial++}`, axis, ratio: 0.5,
    first: { kind: "group", id }, second: { kind: "group", id: newId } };
  return { ...state, nextId: serial, nextPane: state.nextPane + 1, tree: replaceGroup(state.tree, id, replacement), groups: { ...state.groups, [newId]: newGroup }, views };
}
function locationOf(view: FileView): FileLocation {
  return { filePath: view.filePath, label: view.label, cwd: view.cwd, sourceSessionId: view.sourceSessionId,
    page: view.page, lineTarget: view.lineTarget, viewerState: view.viewerState };
}
function sameResource(view: FileView, location: FileLocation): boolean {
  // De-duplication is presentation only; this never establishes file authorization.
  return view.filePath === location.filePath && view.cwd === location.cwd && (view.sourceSessionId ?? null) === (location.sourceSessionId ?? null);
}
export function openWorkspaceFile(state: FileWorkspaceState, location: FileLocation, origin?: string,
  disposition: FileDisposition = { kind: "normal" }, recordHistory = true): FileWorkspaceState {
  const originView = origin ? state.views[origin] : undefined;
  const base = origin ? viewGroup(state, origin) : state.activeGroup;
  let destination = base ?? state.activeGroup;
  let preview = false;
  if (disposition.kind === "normal" && originView && !sameResource(originView, location) && originView.route) {
    destination = originView.route;
    preview = true;
  } else if (disposition.kind === "group") { destination = disposition.id; preview = true; }
  else if (disposition.kind === "split") {
    const before = new Set(Object.keys(state.groups));
    state = splitFileGroup(state, destination, disposition.axis, false);
    destination = Object.keys(state.groups).find(id => !before.has(id))!;
    preview = true;
  }
  const group = state.groups[destination];
  if (!group) return state; // stale route never falls back into the guide
  const active = group.active ? state.views[group.active] : undefined;
  const match = active && sameResource(active, location) ? active : group.views.map(id => state.views[id]).filter(view => sameResource(view, location)).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))[0];
  // Never replace an in-flight save's view. A different target may use another tab.
  if (match?.saving) return selectFileView(patchFileView(state, match.id, { pendingOpen: {
    tabId: match.id, fileName: location.label, filePath: location.filePath, sourceSessionId: location.sourceSessionId,
    page: location.page, lineTarget: location.lineTarget, modeHint: location.modeHint,
  } }), destination, match.id);
  const oldPreview = preview && !match ? group.views.find(id => state.views[id].preview && !state.views[id].saving && !state.views[id].draft) : undefined;
  const views = { ...state.views };
  if (oldPreview) delete views[oldPreview];
  const id = match?.id ?? `file:view-${state.nextId}`;
  views[id] = { ...match, id, label: location.label, filePath: location.filePath, cwd: location.cwd,
    sourceSessionId: location.sourceSessionId, page: location.page, lineTarget: location.lineTarget,
    viewerRevision: (match?.viewerRevision ?? 0) + 1, lastActive: state.nextId, preview: match?.preview ?? preview,
    viewerState: location.viewerState ?? match?.viewerState,
    initialDisplayMode: location.modeHint ?? match?.initialDisplayMode };
  if (location.modeHint) views[id].viewerState = { displayMode: location.modeHint, wrapLines: match?.viewerState?.wrapLines ?? false, scrollTop: 0, scrollLeft: 0 };
  const nextGroup = { ...group, active: id, views: [...group.views.filter(item => item !== oldPreview), ...(!match ? [id] : [])] };
  if (recordHistory && active) { nextGroup.back = [...group.back, locationOf(active)].slice(-100); nextGroup.forward = []; }
  return { ...state, nextId: state.nextId + 1, views, groups: { ...state.groups, [destination]: nextGroup },
    // Routed navigation retains the source as the explicitly active group.
    activeGroup: origin && disposition.kind === "normal" ? state.activeGroup : destination };
}
export function navigateFileHistory(state: FileWorkspaceState, id: string, direction: "back" | "forward"): FileWorkspaceState {
  const group = state.groups[id];
  const target = group?.[direction].at(-1);
  if (!group || !target || (group.active && state.views[group.active].saving)) return state;
  const current = group.active ? locationOf(state.views[group.active]) : undefined;
  const next = openWorkspaceFile(state, target, undefined, { kind: "group", id }, false);
  return { ...next, groups: { ...next.groups, [id]: { ...next.groups[id],
    [direction]: group[direction].slice(0, -1),
    [direction === "back" ? "forward" : "back"]: [...group[direction === "back" ? "forward" : "back"], ...(current ? [current] : [])].slice(-100) } } };
}
function removeGroup(tree: FileLayout, id: string): FileLayout | undefined {
  if (tree.kind === "group") return tree.id === id ? undefined : tree;
  const first = removeGroup(tree.first, id), second = removeGroup(tree.second, id);
  return first && second ? { ...tree, first, second } : first ?? second;
}
export function closeFileView(state: FileWorkspaceState, id: string): FileWorkspaceState {
  const view = state.views[id], groupId = viewGroup(state, id);
  if (!view || !groupId || view.saving) return state;
  const group = state.groups[groupId];
  const ids = group.views.filter(item => item !== id);
  const views = { ...state.views }; delete views[id];
  let next = { ...state, views, groups: { ...state.groups, [groupId]: { ...group, views: ids, active: group.active === id ? ids.at(-1) : group.active } } };
  if (!ids.length && Object.keys(state.groups).length > 1) next = closeFileGroup(next, groupId);
  return next;
}
export function closeFileGroup(state: FileWorkspaceState, id: string, moveTo?: string): FileWorkspaceState {
  const group = state.groups[id];
  if (!group || Object.keys(state.groups).length === 1 || group.views.some(view => state.views[view].saving)) return state;
  if (moveTo && (!state.groups[moveTo] || moveTo === id)) return state;
  const groups = { ...state.groups }, views = { ...state.views };
  if (moveTo) {
    groups[moveTo] = { ...groups[moveTo], views: [...groups[moveTo].views, ...group.views], active: group.active ?? groups[moveTo].active };
    group.views.forEach(id => { if (views[id].route === moveTo) views[id] = { ...views[id], route: "closed" }; });
  } else group.views.forEach(view => delete views[view]);
  delete groups[id];
  const activeGroup = state.activeGroup === id ? moveTo ?? Object.keys(groups)[0] : state.activeGroup;
  return { ...state, groups, views, activeGroup, focused: state.focused === id ? undefined : state.focused, tree: removeGroup(state.tree, id)! };
}
export function moveFileView(state: FileWorkspaceState, id: string, destination: string): FileWorkspaceState {
  const source = viewGroup(state, id), group = state.groups[destination];
  if (!source || source === destination || !group || state.views[id].saving) return state;
  const origin = state.groups[source], remaining = origin.views.filter(view => view !== id);
  let next = { ...state, activeGroup: destination, groups: { ...state.groups,
    [source]: { ...origin, views: remaining, active: origin.active === id ? remaining.at(-1) : origin.active },
    [destination]: { ...group, views: [...group.views, id], active: id } } };
  if (state.views[id].route === destination) next = patchFileView(next, id, { route: "closed" });
  if (!remaining.length) next = closeFileGroup(next, source);
  return next;
}
export interface FileRect { x: number; y: number; width: number; height: number }
export interface FileDivider { id: string; axis: SplitAxis; rect: FileRect; parent: FileRect; ratio: number; minimum: number; maximum: number }
export function minimumFileSize(tree: FileLayout): { width: number; height: number } {
  if (tree.kind === "group") return { width: MIN_FILE_WIDTH, height: MIN_FILE_HEIGHT };
  const a = minimumFileSize(tree.first), b = minimumFileSize(tree.second);
  return tree.axis === "right" ? { width: a.width + b.width + FILE_SEPARATOR, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + FILE_SEPARATOR };
}
export function fileGeometry(tree: FileLayout, rect: FileRect): { groups: Record<string, FileRect>; dividers: FileDivider[] } {
  if (tree.kind === "group") return { groups: { [tree.id]: rect }, dividers: [] };
  const horizontal = tree.axis === "right", size = (horizontal ? rect.width : rect.height) - FILE_SEPARATOR;
  const aMin = minimumFileSize(tree.first), bMin = minimumFileSize(tree.second);
  const minimum = (horizontal ? aMin.width : aMin.height) / size;
  const maximum = 1 - (horizontal ? bMin.width : bMin.height) / size;
  const ratio = Math.max(minimum, Math.min(maximum, tree.ratio));
  const first = Math.round(size * ratio), second = size - first;
  const a = fileGeometry(tree.first, { ...rect, ...(horizontal ? { width: first } : { height: first }) });
  const b = fileGeometry(tree.second, { ...rect, ...(horizontal ? { x: rect.x + first + FILE_SEPARATOR, width: second } : { y: rect.y + first + FILE_SEPARATOR, height: second }) });
  const divider = { ...rect, ...(horizontal ? { x: rect.x + first, width: FILE_SEPARATOR } : { y: rect.y + first, height: FILE_SEPARATOR }) };
  return { groups: { ...a.groups, ...b.groups }, dividers: [{ id: tree.id, axis: tree.axis, rect: divider, parent: rect, ratio, minimum, maximum }, ...a.dividers, ...b.dividers] };
}
export function resizeFileSplit(tree: FileLayout, id: string, ratio: number): FileLayout {
  if (tree.kind === "group" || !Number.isFinite(ratio)) return tree;
  return tree.id === id ? { ...tree, ratio: Math.max(0.05, Math.min(0.95, ratio)) }
    : { ...tree, first: resizeFileSplit(tree.first, id, ratio), second: resizeFileSplit(tree.second, id, ratio) };
}
