"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { loadPrismLanguages } from "@/lib/prism-languages";
import { whenSelectionClears } from "@/lib/highlight-queue";

/** Deterministically plain on SSR/first hydration, even after another render loaded Prism. */
export function usePrismLanguages(enabled: boolean, root?: RefObject<HTMLElement | null>,
  onWork?: (work: Promise<void>) => void): boolean {
  const observer = useRef(onWork);
  observer.current = onWork;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let cancelSelection = () => {};
    const work = loadPrismLanguages().then(() => {
      if (active) cancelSelection = whenSelectionClears(root?.current ?? null, () => setReady(true));
    }, () => { /* Readable plain text; later demand/mount can retry. */ });
    // Observe the actual import plus its publication/rejection handler. The
    // selection listener has its separate effect-owned cleanup below. Updating
    // the observer does not restart demand or change retry/cancellation policy.
    observer.current?.(work);
    return () => { active = false; cancelSelection(); };
  }, [enabled, root]);
  return enabled && ready;
}
