import { parsePatchFiles } from "@pierre/diffs";

export interface DisplayPatch { patch: string; hasBinaryChanges: boolean }
export interface DisplayFile {
  id: string;
  path: string;
  previousPath?: string;
  status: string;
  additions?: number;
  deletions?: number;
  value?: DisplayPatch;
}

/** Preserve exact Git file blocks; never reconstruct an approval patch from parsed hunks. */
export function splitGitPatch(patch: string): DisplayFile[] {
  const starts = [...patch.matchAll(/^diff --git /gm)].map((match) => match.index!);
  if (!starts.length || patch.slice(0, starts[0]).trim()) throw new Error("Unsupported patch framing");
  return starts.map((start, index) => {
    const raw = patch.slice(start, starts[index + 1] ?? patch.length);
    const parsed = parsePatchFiles(raw, undefined, true);
    if (parsed.length !== 1 || parsed[0].files.length !== 1) throw new Error("Unsupported file patch");
    const file = parsed[0].files[0];
    const counts = file.hunks.flatMap((hunk) => hunk.hunkContent).reduce((sum, content) => content.type === "context"
      ? sum : { additions: sum.additions + content.additions, deletions: sum.deletions + content.deletions }, { additions: 0, deletions: 0 });
    const hasBinaryChanges = /^(?:GIT binary patch|Binary files .+ differ)$/m.test(raw);
    return { id: String(index), path: file.name, previousPath: file.prevName,
      status: { change: "Modified", new: "Added", deleted: "Deleted", "rename-pure": "Renamed", "rename-changed": "Renamed" }[file.type],
      ...(!hasBinaryChanges ? counts : {}), value: { patch: raw, hasBinaryChanges } };
  });
}

/** Per-stack queue and successful-response cache. Only bounded, read-only patch loads. */
export function createPatchLoader<T = DisplayPatch>(load: (id: string, signal: AbortSignal) => Promise<T>, limit = 3,
  onReadWork?: (work: Promise<void>) => void) {
  let active = 0;
  const cache = new Map<string, T>();
  const queue: Array<() => void> = [];
  const pump = () => { while (active < limit && queue.length) queue.shift()!(); };
  return (id: string, signal: AbortSignal): Promise<T> => {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    const cached = cache.get(id);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const start = () => {
        if (signal.aborted) { signal.removeEventListener("abort", abort); return; }
        active++;
        // Strict Mode can synchronously unmount/replay effects. Do not start a
        // read for an already-cancelled mount, and settle synchronous loader errors.
        const work = Promise.resolve().then(() => {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          return load(id, signal);
        }).then((value) => {
          if (!signal.aborted) { cache.set(id, value); resolve(value); }
        }, reject).finally(() => { active--; signal.removeEventListener("abort", abort); pump(); });
        // Abort may already have rejected the returned request promise. Its real
        // admitted loader and slot-release finally still belong to this owner.
        onReadWork?.(work);
      };
      signal.addEventListener("abort", abort, { once: true });
      queue.push(start);
      pump();
    });
  };
}
