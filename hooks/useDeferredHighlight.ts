"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { hasHighlightSelection, waitForHighlight, whenSelectionClears } from "@/lib/highlight-queue";

export function useDeferredHighlight(code: string, language: string, enabled: boolean,
  root: RefObject<HTMLElement | null>): boolean {
  // The token carries no source contents. A stale queued grant cannot color a
  // different code/language/streaming generation, including an A -> B -> A cycle.
  const generation = useMemo(() => ({ length: code.length, language, enabled }), [code, language, enabled]);
  const [granted, setGranted] = useState<object | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelSelection = () => {}, cancelQueue = () => {};
    const enqueue = () => {
      cancelQueue = waitForHighlight(() => {
        if (hasHighlightSelection(root.current)) {
          // Selection release requeues rather than publishing many grants at once.
          cancelSelection = whenSelectionClears(root.current, enqueue);
        } else setGranted(generation);
      });
    };
    enqueue();
    return () => { cancelQueue(); cancelSelection(); };
  }, [enabled, generation, root]);
  return enabled && granted === generation;
}
