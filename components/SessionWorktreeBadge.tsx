import type { SessionInfo } from "@/lib/types";

/** The same linked-checkout label in every session list. */
export function SessionWorktreeBadge({ session, className }: { session: SessionInfo; className?: string }) {
  if (!session.isWorktree || !session.branch) return null;
  return (
    <span
      className={className}
      title={`Worktree: ${session.cwd}`}
      style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--accent)", minWidth: 0, overflow: "hidden" }}
    >
      <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.branch}</span>
    </span>
  );
}
