/** A visible child can still be clipped/scrolled while the sidebar expands. */
export function sidebarReady() {
  const sidebar = document.querySelector(".sidebar-container.sidebar-open");
  if (!sidebar || !sidebar.firstElementChild) return false;
  if (sidebar.getAnimations().some((animation) => animation.pending || animation.playState === "running")) return false;
  return sidebar.getBoundingClientRect().width > 0
    && sidebar.getBoundingClientRect().width >= sidebar.firstElementChild.getBoundingClientRect().width - 1
    && Math.abs(sidebar.scrollLeft) <= 1;
}
