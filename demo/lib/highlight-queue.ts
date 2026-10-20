// Adapted from upstream b2b6a45b. Grants run after commit, never from render.
// Only mounted consumers' callbacks are retained, not code or token trees.
type Schedule = (run: () => void) => () => void;

export function createHighlightQueue(schedule: Schedule) {
  const waiting: Array<() => void> = [];
  let cancelSlice: (() => void) | null = null;
  let newestGrants = 0;
  const release = () => {
    cancelSlice = null;
    // Favor recent replies, but give the oldest waiter every fourth grant.
    const show = newestGrants < 3 ? waiting.pop() : waiting.shift();
    newestGrants = newestGrants < 3 ? newestGrants + 1 : 0;
    try { show?.(); } finally { if (waiting.length) queue(); else newestGrants = 0; }
  };
  const queue = () => { cancelSlice ??= schedule(release); };
  return (show: () => void) => {
    waiting.push(show);
    queue();
    return () => {
      const index = waiting.indexOf(show);
      if (index !== -1) waiting.splice(index, 1);
      if (!waiting.length) { cancelSlice?.(); cancelSlice = null; newestGrants = 0; }
    };
  };
}

function scheduleIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 50);
  return () => window.clearTimeout(id);
}

// Browser effects are the only callers; SSR neither schedules nor spends a budget.
export const waitForHighlight = createHighlightQueue(scheduleIdle);

export function hasHighlightSelection(element: HTMLElement | null): boolean {
  const selection = element?.ownerDocument.getSelection();
  if (element && selection && !selection.isCollapsed) {
    for (let i = 0; i < selection.rangeCount; i++) {
      if (selection.getRangeAt(i).intersectsNode(element)) return true;
    }
  }
  return false;
}

/** Don't replace native selection's text nodes while colors are arriving. */
export function whenSelectionClears(element: HTMLElement | null, run: () => void): () => void {
  const document = element?.ownerDocument;
  let active = true;
  const check = () => {
    if (!active) return;
    if (hasHighlightSelection(element)) return;
    active = false;
    document?.removeEventListener("selectionchange", check);
    run();
  };
  document?.addEventListener("selectionchange", check);
  check();
  return () => { active = false; document?.removeEventListener("selectionchange", check); };
}
