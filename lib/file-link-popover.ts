export interface LinkRect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface LinkViewport { left: number; top: number; width: number; height: number }

/** Wrapped links anchor to the hovered line, or the first visible line for keyboard use. */
export function fileLinkAnchor(rects: readonly LinkRect[], viewport: LinkViewport, pointer?: { x: number; y: number }): LinkRect | undefined {
  const visible = rects.filter(rect => rect.width > 0 && rect.height > 0
    && rect.bottom > viewport.top && rect.top < viewport.top + viewport.height
    && rect.right > viewport.left && rect.left < viewport.left + viewport.width);
  return (pointer && visible.find(rect => pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom)) || visible[0];
}

/** Fixed top-layer coordinates in the layout viewport, including keyboard/zoom offsets. */
export function fileLinkPopoverPosition(anchor: LinkRect, size: { width: number; height: number }, viewport: LinkViewport): { left: number; top: number } {
  const margin = 8, gap = 6;
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - margin * 2));
  const left = Math.max(viewport.left + margin, Math.min(anchor.left, viewport.left + viewport.width - margin - width));
  const above = anchor.top - gap - height;
  const preferred = above >= viewport.top + margin ? above : anchor.bottom + gap;
  const top = Math.max(viewport.top + margin, Math.min(preferred, viewport.top + viewport.height - margin - height));
  return { left, top };
}
