"use client";

import { useId, useState, type ReactNode } from "react";
import type { LocalFileLinkBlockReason } from "@/lib/file-links";
import { useI18n } from "@/hooks/useI18n";

/** No href: modified clicks and browser context menus cannot navigate a rejected path. */
export function BlockedFileLink({ reason, children }: { reason: LocalFileLinkBlockReason; children: ReactNode }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const explanation = t(reason === "outside-root" ? "fileLink.outsideRoot" : "fileLink.missingBase");
  return (
    <span className="blocked-file-link">
      <button type="button" className="blocked-file-link-trigger" title={explanation}
        aria-expanded={expanded} aria-controls={expanded ? id : undefined}
        onClick={() => setExpanded(value => !value)}>
        {children}
      </button>
      {expanded && <span id={id} role="status" className="blocked-file-link-explanation"> {explanation}</span>}
    </span>
  );
}
