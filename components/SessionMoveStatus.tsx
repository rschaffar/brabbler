import type { ReactNode } from "react";

export function SessionMoveStatus({ children }: { children: ReactNode }) {
  return <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
    {children}
  </p>;
}
