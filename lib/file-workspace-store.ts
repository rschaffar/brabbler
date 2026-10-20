import type { FileWorkspaceState } from "./file-workspace";

/** Reading-position reports update the model without repainting the whole shell.
 * A later render must still read the latest snapshot, including after parking. */
export class FileWorkspaceStore {
  private value: Record<string, FileWorkspaceState> = {};
  private listeners = new Set<() => void>();
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(key: string, state: FileWorkspaceState, silent = false) {
    if (this.value[key] === state) return;
    this.value = { ...this.value, [key]: state };
    if (!silent) this.listeners.forEach(listener => listener());
  }
}
