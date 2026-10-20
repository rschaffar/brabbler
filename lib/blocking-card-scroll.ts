/** Keep a newly arrived card's actions visible as asynchronous review content loads.
 * Only the chat scroller moves; any subsequent reader scroll ends this request's follow.
 */
export function followBlockingCard(container: HTMLElement, card: HTMLElement, state = { following: true }): () => void {
  let disposed = false;
  let frame: number | null = null;

  const reveal = () => {
    frame = null;
    if (disposed || !state.following || !card.isConnected || card.querySelector("dialog.is-fullscreen[open]")) return;
    const bounds = card.getBoundingClientRect();
    if (!bounds.height) return;
    const viewportTop = container.getBoundingClientRect().top + container.clientTop;
    const viewportBottom = viewportTop + container.clientHeight;
    // Bottom alignment prioritizes the actions even when a short chat viewport
    // cannot fit the whole card. Never scroll the document or the card body.
    if (bounds.bottom > viewportBottom - 16 || bounds.top < viewportTop) {
      container.scrollTo({ top: container.scrollTop + bounds.bottom - viewportBottom + 16, behavior: "instant" });
    }
  };
  const schedule = () => {
    if (!disposed && state.following && frame === null) frame = requestAnimationFrame(reveal);
  };
  // Scroll events also come from browser anchoring, focus and range clamping.
  // Only explicit reader gestures relinquish follow, including nested review scrolling.
  const stopFollowing = () => { state.following = false; };
  const onPointerDown = (event: PointerEvent) => {
    if (event.target === container) stopFollowing(); // Chat scrollbar/track.
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stopFollowing();
  };
  container.addEventListener("wheel", stopFollowing, { passive: true });
  container.addEventListener("touchmove", stopFollowing, { passive: true });
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("keydown", onKeyDown);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  observer?.observe(card);
  observer?.observe(container);
  schedule();
  return () => {
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    observer?.disconnect();
    container.removeEventListener("wheel", stopFollowing);
    container.removeEventListener("touchmove", stopFollowing);
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("keydown", onKeyDown);
  };
}
