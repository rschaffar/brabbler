"use client";

import { useEffect, useState, type RefObject } from "react";
import { loadPrismLanguages } from "@/lib/prism-languages";
import { whenSelectionClears } from "@/lib/highlight-queue";

/** Deterministically plain on SSR/first hydration, even after another render loaded Prism. */
export function usePrismLanguages(enabled: boolean, root?: RefObject<HTMLElement | null>): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let cancelSelection = () => {};
    loadPrismLanguages().then(() => {
      if (active) cancelSelection = whenSelectionClears(root?.current ?? null, () => setReady(true));
    }, () => { /* Readable plain text; later demand/mount can retry. */ });
    return () => { active = false; cancelSelection(); };
  }, [enabled, root]);
  return enabled && ready;
}
