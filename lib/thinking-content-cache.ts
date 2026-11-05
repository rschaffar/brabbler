/** Payload budgets, not measurements of JavaScript heap or browser RSS. */
export const THINKING_CACHE_LIMITS = {
  maxEntries: 100,
  maxBytes: 8 * 1024 * 1024,
  maxEntryBytes: 1024 * 1024,
} as const;

interface Limits { maxEntries: number; maxBytes: number; maxEntryBytes: number }
interface Entry { request: Promise<string>; bytes: number }

/** Shared reads with count/estimated UTF-16 payload bounds. Eviction releases
 * only cache ownership: already admitted readers still receive the full result.
 * Pending eviction is not cancellation or a bound on outstanding HTTP work. */
export function createThinkingContentCache(limits: Limits = THINKING_CACHE_LIMITS) {
  const entries = new Map<string, Entry>();
  let retainedBytes = 0;
  const remove = (key: string, entry: Entry) => {
    if (entries.get(key) !== entry) return;
    retainedBytes -= entry.bytes;
    entries.delete(key);
  };
  const evict = () => {
    while (entries.size > limits.maxEntries || retainedBytes > limits.maxBytes) {
      const oldest = entries.entries().next().value;
      if (!oldest) break;
      remove(...oldest);
    }
  };
  return (key: string, read: () => Promise<string>): Promise<string> => {
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached);
      return cached.request;
    }
    let started: Promise<string>;
    try { started = read(); } catch (error) { return Promise.reject(error); }
    const entry: Entry = {
      bytes: key.length * 2,
      request: started.then(value => {
        // A late completion must not resurrect an evicted entry or replace a
        // newer read of the same key (including after an earlier eviction).
        if (entries.get(key) !== entry) return value;
        const bytes = (key.length + value.length) * 2;
        if (bytes > limits.maxEntryBytes || bytes > limits.maxBytes) remove(key, entry);
        else {
          retainedBytes += bytes - entry.bytes;
          entry.bytes = bytes;
          evict();
        }
        return value;
      }).catch(error => {
        remove(key, entry);
        throw error;
      }),
    };
    entries.set(key, entry);
    retainedBytes += entry.bytes;
    evict();
    return entry.request;
  };
}
