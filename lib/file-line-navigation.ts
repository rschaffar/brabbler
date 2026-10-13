import type { FileLineTarget } from "./file-links";

/** Prefer the smallest containing rendered block; blank/hidden lines use the nearest block. */
export function findRenderedLineTarget(root: HTMLElement, line: number): HTMLElement | undefined {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-source-line-start][data-source-line-end]"));
  let best: HTMLElement | undefined;
  let bestDistance = Infinity;
  let bestSpan = Infinity;
  for (const block of blocks) {
    const start = Number(block.dataset.sourceLineStart);
    const end = Number(block.dataset.sourceLineEnd);
    const distance = line < start ? start - line : line > end ? line - end : 0;
    const span = end - start;
    if (distance < bestDistance || (distance === bestDistance && span < bestSpan)) {
      best = block;
      bestDistance = distance;
      bestSpan = span;
    }
  }
  return best;
}

/** Scroll only the file pane, never the surrounding chat/page. */
export function navigateToFileLine(root: HTMLElement, target: FileLineTarget, rendered: boolean): boolean {
  root.querySelectorAll("[data-file-line-target]").forEach((element) => element.removeAttribute("data-file-line-target"));
  const anchor = rendered
    ? findRenderedLineTarget(root, target.line)
    : root.querySelector<HTMLElement>(`[data-line-number="${target.line}"]`);
  if (!anchor) return false;
  if (rendered) {
    anchor.setAttribute("data-file-line-target", "true");
  } else {
    root.querySelectorAll<HTMLElement>("[data-line-number]").forEach((element) => {
      const line = Number(element.dataset.lineNumber);
      if (line >= target.line && line <= (target.endLine ?? target.line)) element.setAttribute("data-file-line-target", "true");
    });
  }
  root.scrollTop += anchor.getBoundingClientRect().top - root.getBoundingClientRect().top - Math.min(80, root.clientHeight / 4);
  return true;
}
