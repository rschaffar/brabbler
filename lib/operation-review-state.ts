import type { DiffReviewModel, ReadingMode } from "./git-diff-review";

export type ReviewPosition = Pick<DiffReviewModel, "full" | "reading" | "changeIndex" | "expansions" | "anchors" | "scrollLeft" | "query">;
/** Convenience-only budgets, never review/file/operation admission limits.
 * Weight conservatively charges UTF-16 text and fixed per-record/map overhead;
 * it is a retained-payload bound, not JavaScript engine RSS accounting. */
export const REVIEW_NAVIGATION_LIMITS = { entries: 128, weight: 64 * 1024, queryCodeUnits: 4096, expansions: 128 } as const;
interface Entry { position?: ReviewPosition; offset?: number; weight: number }
const modes: ReadingMode[] = ["diff", "before", "after"];
function snapshot(value: ReviewPosition): ReviewPosition {
  const expansions: ReviewPosition["expansions"] = new Map();
  for (const [id, amount] of value.expansions) {
    if (expansions.size === REVIEW_NAVIGATION_LIMITS.expansions) break;
    expansions.set(id, { fromStart: amount.fromStart, fromEnd: amount.fromEnd });
  }
  const anchors: ReviewPosition["anchors"] = {};
  for (const mode of modes) {
    const anchor = value.anchors[mode];
    if (anchor) anchors[mode] = { lineNumber: anchor.lineNumber, side: anchor.side, offset: anchor.offset };
  }
  return { full: value.full, reading: value.reading, changeIndex: value.changeIndex, expansions, anchors, scrollLeft: value.scrollLeft,
    // Oversized search text is simply not remembered; the active input and its
    // search are unrestricted. Copy small text without retaining a giant slice.
    query: value.query.length > REVIEW_NAVIGATION_LIMITS.queryCodeUnits ? "" : Array.from(value.query).join("") };
}
function isDefault(value: ReviewPosition) {
  return !value.full && value.reading === "diff" && value.changeIndex === -1 && !value.expansions.size
    && !Object.keys(value.anchors).length && !value.scrollLeft && !value.query;
}
/** One owner per saved review URL. Keys include view + server file ID. No patch,
 * parsed file, context, path, or execution authority is ever retained here. */
export class ReviewNavigationState {
  private entries = new Map<string, Entry>();
  private retainedWeight = 0;
  get size() { return this.entries.size; }
  get weight() { return this.retainedWeight; }
  private recent(key: string) {
    const value = this.entries.get(key);
    if (value) { this.entries.delete(key); this.entries.set(key, value); }
    return value;
  }
  position(key: string) {
    const value = this.recent(key)?.position;
    // The selected model mutates. Never lend cache-owned maps/anchors to it.
    return value ? snapshot(value) : undefined;
  }
  offset(key: string) { return this.recent(key)?.offset ?? 0; }
  savePosition(key: string, model: ReviewPosition) {
    const position = snapshot(model);
    this.save(key, { ...this.entries.get(key), position: isDefault(position) ? undefined : position });
  }
  saveOffset(key: string, value: number) {
    this.save(key, { ...this.entries.get(key), offset: Number.isSafeInteger(value) && value > 0 ? value : undefined });
  }
  private save(key: string, value: Omit<Entry, "weight">) {
    const previous = this.entries.get(key);
    if (previous) { this.retainedWeight -= previous.weight; this.entries.delete(key); }
    if (!value.position && value.offset === undefined) return;
    const position = value.position;
    const weight = 192 + key.length * 2 + (value.offset === undefined ? 0 : 16) + (position
      ? position.query.length * 2 + position.expansions.size * 64 + Object.keys(position.anchors).length * 96 : 0);
    this.entries.set(key, { position, offset: value.offset, weight }); this.retainedWeight += weight;
    while (this.entries.size > REVIEW_NAVIGATION_LIMITS.entries || this.retainedWeight > REVIEW_NAVIGATION_LIMITS.weight) {
      const oldest = this.entries.keys().next().value!;
      this.retainedWeight -= this.entries.get(oldest)!.weight; this.entries.delete(oldest);
    }
  }
}
