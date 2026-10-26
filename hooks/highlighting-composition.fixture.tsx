import { useLayoutEffect, useRef } from "react";
import { useDeferredHighlight } from "./useDeferredHighlight";
import { usePrismLanguages } from "./usePrismLanguages";

export function HighlightProbe({ code = "A", language = "tsx", enabled = true, kind = "deferred", id = "one", onCommit, onWork }: {
  code?: string; language?: string; enabled?: boolean; kind?: "deferred" | "grammar"; id?: string;
  onCommit?: (id: string, ready: boolean) => void;
  onWork?: (work: Promise<void>) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Both are real application hooks; disabled peers admit no work.
  const deferred = useDeferredHighlight(code, language, enabled && kind === "deferred", root);
  const grammar = usePrismLanguages(enabled && kind === "grammar", root, onWork);
  const ready = kind === "deferred" ? deferred : grammar;
  useLayoutEffect(() => { onCommit?.(id, ready); });
  return <div ref={root} data-probe={id} data-ready={String(ready)}>{code}</div>;
}
