import { deepActiveElement } from "./panel-focus";

interface ComposerFocusHandle { focus(): void }

function hasModalOwner(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"]'))
    .some((element) => element.getClientRects().length > 0);
}

/** Explicit New only: never turn remounts, polling or streaming into autofocus. */
export function requestFreshComposerFocus(
  input: { current: ComposerFocusHandle | null },
  isMobile: boolean,
  isCurrent: () => boolean,
): void {
  if (isMobile || hasModalOwner()) return;
  const initiator = deepActiveElement(document);
  // Blocking cards and quote/model controls keep their own keyboard lifecycle,
  // even when they are inline rather than aria-modal overlays.
  if (initiator?.closest('.blocking-card, [role="dialog"], [role="listbox"], [inert]')) return;
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  document.addEventListener("pointerdown", cancel, true);
  document.addEventListener("keydown", cancel, true);
  requestAnimationFrame(() => {
    document.removeEventListener("pointerdown", cancel, true);
    document.removeEventListener("keydown", cancel, true);
    if (cancelled || !isCurrent() || window.matchMedia("(max-width: 640px)").matches || hasModalOwner()) return;
    const active = deepActiveElement(document);
    // A New button may still own focus, or its old composer may have unmounted.
    // Any different control focused in the meantime wins over this request.
    if (active && active !== document.body && active !== document.documentElement && active !== initiator) return;
    input.current?.focus();
  });
}
