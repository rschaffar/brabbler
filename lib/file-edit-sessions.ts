import type { FileEditDraft } from "./file-viewer-state";

export interface FileEditSession { owner?: string; draft?: FileEditDraft; saving: boolean }
const EMPTY: FileEditSession = Object.freeze({ saving: false });
/** Browser-local coordination only. Every edit/read/save still requires server admission. */
export class FileEditSessions {
  private bindings = new Map<string, string>();
  private sessions = new Map<string, FileEditSession>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  snapshot = (view: string): FileEditSession => this.sessions.get(this.bindings.get(view) ?? "") ?? EMPTY;
  identity = (view: string): string | undefined => this.bindings.get(view);
  bind(view: string, identity: string): boolean {
    if (this.bindings.get(view) === identity) return true;
    // A view cannot abandon a transaction/draft by rebinding to another file.
    const old = this.snapshot(view);
    if (old.owner === view && (old.saving || old.draft)) return false;
    if (old.owner === view) this.sessions.delete(this.bindings.get(view)!);
    this.bindings.set(view, identity); this.emit();
    return true;
  }
  claim(view: string): boolean {
    const key = this.bindings.get(view);
    if (!key) return false;
    const session = this.sessions.get(key) ?? EMPTY;
    if (session.owner && session.owner !== view) return false;
    if (!session.owner) { this.sessions.set(key, { ...session, owner: view }); this.emit(); }
    return true;
  }
  draft(view: string, draft?: FileEditDraft) {
    const session = this.snapshot(view);
    if (!draft && session.owner !== view) return;
    if (draft && !this.claim(view)) return;
    const key = this.bindings.get(view)!;
    this.sessions.set(key, { ...this.snapshot(view), draft }); this.emit();
  }
  saving(view: string, saving: boolean) {
    if (!this.claim(view)) return;
    this.sessions.set(this.bindings.get(view)!, { ...this.snapshot(view), saving }); this.emit();
  }
  close(view: string): boolean {
    const session = this.snapshot(view);
    if (session.owner === view && session.saving) return false;
    if (session.owner === view) this.sessions.delete(this.bindings.get(view)!);
    this.bindings.delete(view); this.emit(); return true;
  }
  get dirty(): boolean {
    return [...this.sessions.values()].some(session => session.saving || (session.draft && session.draft.content !== session.draft.baseline));
  }
}
