/** Tab stops in rendered order, including Pierre's open shadow-root gap controls. */
export function panelTabStops(root: ParentNode): HTMLElement[] {
  const stops: HTMLElement[] = [];
  const visit = (parent: ParentNode) => {
    for (const child of Array.from(parent.children)) {
      const element = child as HTMLElement;
      if (element.closest("[inert]")) continue;
      if (element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length
        && element.ownerDocument.defaultView?.getComputedStyle(element).visibility !== "hidden") stops.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
      else if (element.tagName === "SLOT") {
        const assigned = (element as HTMLSlotElement).assignedElements({ flatten: true });
        if (assigned.length) {
          // Assigned controls occupy the slot's composed-tree position, not their light-DOM position.
          visit({ children: assigned } as unknown as ParentNode);
        } else visit(element);
      } else visit(element);
    }
  };
  visit(root);
  return stops;
}

export function deepActiveElement(document: Document): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
