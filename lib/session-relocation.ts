import { sessionPathKey } from "./session-path";

type RelocationFailure = { error: unknown };
type Binding = { id: string; source: string };
type Relocation = Binding & { settled: Promise<RelocationFailure | undefined> };

export interface SessionRelocationReservation {
  include(files: readonly Binding[]): void;
  release(failure?: RelocationFailure): void;
}

declare global {
  var __piSessionRelocations: Map<string, Relocation> | undefined;
  var __piRecentSessionRelocations: Map<string, Binding> | undefined;
}

function relocations(): Map<string, Relocation> {
  return globalThis.__piSessionRelocations ??= new Map();
}

/** Include source paths so a URL alias cannot bypass its persisted SDK ID. */
export function pendingSessionRelocation(id: string | undefined, source: string): Relocation | undefined {
  const active = relocations();
  return (id ? active.get(id) : undefined) ?? [...active.values()].find(entry => entry.source && sessionPathKey(entry.source) === sessionPathKey(source));
}

/** Bounded identity breadcrumbs for a caller holding a path captured just before
 * commit. They contain no cwd/authority and still require a fresh header check. */
export function recentSessionRelocation(source: string): Readonly<Binding> | undefined {
  return globalThis.__piRecentSessionRelocations?.get(sessionPathKey(source));
}

/** Hold the root before discovery yields, then include the validated family and
 * linked-file footprint. This coordinates startup, not move/write authority. */
export function reserveSessionRelocations(files: readonly Binding[]): SessionRelocationReservation {
  const active = relocations(), owned = new Map<string, Relocation>();
  let settle!: (failure?: RelocationFailure) => void;
  const settled = new Promise<RelocationFailure | undefined>(resolve => { settle = resolve; });
  let released = false;
  const reservation: SessionRelocationReservation = {
    include(additions) {
      if (released) throw new Error("Session relocation has already settled");
      const sources = additions.filter(file => file.source).map(file => sessionPathKey(file.source));
      if (new Set(additions.map(file => file.id)).size !== additions.length || new Set(sources).size !== sources.length) {
        throw new Error("Ambiguous session relocation footprint");
      }
      for (const file of additions) {
        const existing = active.get(file.id);
        if (existing && existing !== owned.get(file.id)) throw new Error("Session relocation is already in progress");
        if (file.source && [...active.values()].some(entry => entry.id !== file.id && entry.source
          && sessionPathKey(entry.source) === sessionPathKey(file.source))) throw new Error("Session relocation source is already reserved");
        if (existing?.source && file.source && sessionPathKey(existing.source) !== sessionPathKey(file.source)) {
          throw new Error("Session relocation source changed");
        }
      }
      for (const { id, source } of additions) {
        const entry = owned.get(id) ?? { id, source, settled };
        if (source) entry.source = source;
        owned.set(id, entry); active.set(id, entry);
      }
    },
    release(failure) {
      if (released) return;
      released = true;
      for (const entry of owned.values()) if (active.get(entry.id) === entry) active.delete(entry.id);
      const recent = globalThis.__piRecentSessionRelocations ??= new Map();
      if (failure) {
        // An uncertain move invalidates earlier success hints too. Never retain
        // an exception, transcript, account or cached working context here.
        for (const [path, entry] of recent) if (owned.has(entry.id)) recent.delete(path);
      } else {
        for (const { id, source } of owned.values()) if (source) {
          const key = sessionPathKey(source);
          recent.delete(key); recent.set(key, { id, source });
        }
        while (recent.size > 4096) {
          const oldest = recent.keys().next().value;
          if (oldest === undefined) break;
          recent.delete(oldest);
        }
      }
      settle(failure);
    },
  };
  reservation.include(files);
  return reservation;
}
