import { SCRATCHPAD_MAX_LENGTH, scratchpadScopeFields, validScratchpadScope, validScratchpadNote, type ScratchpadNote, type ScratchpadProject, type ScratchpadScope } from "./scratchpad";

export interface ScratchpadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface ScratchpadTransport {
  read(scope: ScratchpadScope): Promise<ScratchpadNote>;
  save(scope: ScratchpadScope, text: string, revision: string): Promise<ScratchpadNote | { current: ScratchpadNote }>;
}
export const scratchpadTransport: ScratchpadTransport = {
  async read(scope) {
    const query = scope === null ? "" : `?${new URLSearchParams(scratchpadScopeFields(scope) as Record<string, string>)}`;
    const response = await fetch(`/api/scratchpad${query}`, { cache: "no-store" });
    const data: unknown = await response.json();
    if (!response.ok || !validScratchpadNote(data)) throw new Error("read");
    return data;
  },
  async save(scope, text, revision) {
    const response = await fetch("/api/scratchpad", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scratchpadScopeFields(scope), text, revision }),
    });
    const data = await response.json();
    if (response.status === 409 && validScratchpadNote(data?.current)) return { current: data.current };
    if (!response.ok || !validScratchpadNote(data)) throw new Error("save");
    return data;
  },
};
export async function resolveScratchpadProject(cwd: string): Promise<ScratchpadProject> {
  const response = await fetch(`/api/scratchpad?${new URLSearchParams({ projectCwd: cwd })}`, { cache: "no-store" });
  const data = await response.json() as ScratchpadProject;
  if (!response.ok || !data || !validScratchpadScope({ projectId: data.projectId }) || typeof data.root !== "string" || !data.root) throw new Error("project");
  return data;
}

export interface ScratchpadView {
  text: string;
  ready: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: "load" | "save" | null;
  recoveryUnavailable: boolean;
  conflict: ScratchpadNote | null;
  canUndo: boolean;
  canRedo: boolean;
  selection: { start: number; end: number; generation: number } | null;
}
interface Edit { text: string; start: number; end: number }

/** Optional passive observation of the original complete read/write promises. */
export type ScratchpadWorkObserver = (work: Promise<void>) => void;

/** One note owns IO/history even while its editor is closed or another session is selected. */
export class ScratchpadController {
  private base: ScratchpadNote | null = null;
  // A rejected/lost response does not prove that the server did not commit.
  private uncertain = false;
  private listeners = new Set<() => void>();
  private undo: Edit[] = [];
  private redo: Edit[] = [];
  private group: { at: number; kind: string; caret: number } | null = null;
  private storageKey: string;
  private view: ScratchpadView = {
    text: "", ready: false, loading: false, saving: false, dirty: false, error: null,
    recoveryUnavailable: false, conflict: null, canUndo: false, canRedo: false, selection: null,
  };
  constructor(readonly scope: ScratchpadScope, private storage: ScratchpadStorage | null, private transport = scratchpadTransport, private onWork?: ScratchpadWorkObserver) {
    this.storageKey = `pi-web:scratchpad:${JSON.stringify(scope)}`;
    try {
      const raw = storage?.getItem(this.storageKey);
      const draft = raw ? JSON.parse(raw) : null;
      if (validScratchpadNote(draft)) {
        this.base = { text: "", revision: draft.revision };
        this.view = { ...this.view, text: draft.text, dirty: true };
      }
    } catch { this.view.recoveryUnavailable = true; }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.view;
  private publish(change: Partial<ScratchpadView>) {
    this.view = { ...this.view, ...change, canUndo: this.undo.length > 0, canRedo: this.redo.length > 0 };
    for (const listener of this.listeners) listener();
  }
  private persist() {
    let failed = false;
    try {
      if (!this.storage) throw new Error("Storage unavailable");
      if ((this.view.dirty || this.view.saving || this.view.conflict) && this.base) this.storage.setItem(this.storageKey, JSON.stringify({ text: this.view.text, revision: this.base.revision }));
      else this.storage.removeItem(this.storageKey);
    } catch { failed = true; }
    this.publish({ recoveryUnavailable: failed && this.view.dirty });
  }
  refresh() {
    const work = this.refreshFullWork();
    this.onWork?.(work);
    return work;
  }
  private async refreshFullWork() {
    if (this.view.loading || this.view.saving || this.view.conflict || (this.view.ready && this.view.dirty && this.view.error !== "load")) return;
    this.publish({ loading: true, error: null });
    try {
      const remote = await this.transport.read(this.scope);
      const dirty = this.view.dirty;
      if (dirty && this.base && this.base.revision !== remote.revision && this.view.text !== remote.text) {
        this.publish({ ready: true, conflict: remote });
      } else {
        this.base = remote;
        if (!dirty && this.view.text !== remote.text) {
          // External updates are not local undo steps; never undo over another client's work accidentally.
          this.undo = []; this.redo = []; this.group = null;
        }
        this.publish({ ready: true, text: dirty ? this.view.text : remote.text, dirty: dirty && this.view.text !== remote.text });
        this.persist();
      }
    } catch { this.publish({ error: "load" }); }
    finally { this.publish({ loading: false }); }
    void this.drain();
  }
  breakGroup() { this.group = null; }
  edit(text: string, beforeStart: number, beforeEnd: number, afterStart: number, afterEnd: number, kind = "", now = Date.now()) {
    if (!this.view.ready || text.length > SCRATCHPAD_MAX_LENGTH || text === this.view.text) return;
    const delta = text.length - this.view.text.length;
    const groupable = beforeStart === beforeEnd && afterStart === afterEnd
      && ((kind === "insertText" && delta > 0 && delta <= 2) || (kind === "deleteContentBackward" && delta < 0 && delta >= -2));
    const grouped = groupable && this.group?.kind === kind
      && now - this.group.at < 750 && this.group.caret === beforeStart;
    if (!grouped) this.undo.push({ text: this.view.text, start: beforeStart, end: beforeEnd });
    // Bound both count and total retained text, not only the number of keystrokes.
    while (this.undo.length > 100 || (this.undo.length > 1 && this.undo.reduce((sum, entry) => sum + entry.text.length, 0) > 2_000_000)) this.undo.shift();
    this.redo = [];
    this.group = groupable ? { at: now, kind, caret: afterStart } : null;
    this.publish({ text, dirty: this.uncertain || !this.base || text !== this.base.text, selection: null });
    this.persist();
    void this.drain();
  }
  history(direction: "undo" | "redo", start: number, end: number) {
    const from = direction === "undo" ? this.undo : this.redo;
    const to = direction === "undo" ? this.redo : this.undo;
    const entry = from.pop();
    if (!entry) return;
    to.push({ text: this.view.text, start, end });
    this.group = null;
    this.publish({ text: entry.text, dirty: this.uncertain || !this.base || entry.text !== this.base.text,
      selection: { start: entry.start, end: entry.end, generation: (this.view.selection?.generation ?? 0) + 1 } });
    this.persist();
    void this.drain();
  }
  resolve(useLocal: boolean) {
    const remote = this.view.conflict;
    if (!remote) return;
    this.base = remote;
    this.uncertain = false;
    this.publish({ conflict: null, error: null });
    if (!useLocal) this.edit(remote.text, 0, this.view.text.length, 0, 0);
    this.publish({ dirty: this.view.text !== remote.text });
    this.persist();
    void this.drain();
  }
  retry() {
    if (!this.view.ready || this.view.error === "load") { void this.refresh(); return; }
    this.publish({ error: null });
    void this.drain();
  }
  private drain() {
    const work = this.drainFullWork();
    this.onWork?.(work);
    return work;
  }
  private async drainFullWork() {
    if (!this.base || !this.view.ready || this.view.loading || this.view.saving || this.view.error || this.view.conflict || !this.view.dirty) return;
    this.publish({ saving: true });
    try {
      while (this.view.dirty && !this.view.conflict) {
        const text = this.view.text;
        this.uncertain = true;
        const result = await this.transport.save(this.scope, text, this.base.revision);
        if ("current" in result) { this.publish({ conflict: result.current }); break; }
        this.base = result;
        this.uncertain = false;
        this.publish({ dirty: this.view.text !== result.text });
        this.persist();
      }
    } catch { this.publish({ error: "save", dirty: true }); }
    finally { this.publish({ saving: false }); this.persist(); }
  }
}
