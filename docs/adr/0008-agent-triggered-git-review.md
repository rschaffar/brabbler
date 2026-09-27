# 0008 — Agent-triggered Git candidate review in the chat

## Status

Accepted for policy-independent comparison, human-approved commits, explicitly authorized verification and separately approved exact local merges. Agent-driven cleanup and safe post-run relocation remain open in the [implementation plan](../plans/2026-09-27_agent-git-review-plan.md).

## Context

ADR 0007 put three Git controls in permanent rows above the composer and tied merge review to a saved session policy. Recent conversations repeatedly ask the same setup questions and then separately approve a verified merge and cleanup. These controls are intrusive even when no Git operation is underway and cannot be invoked by an agent to show a structured candidate. A saved preference is useful to prefill answers but must never stand in for exact-state consent.

## Decision

Move the legacy controls into one on-demand menu opened from a dedicated icon beside Activity in the top bar, preserving manual access to the existing guarded routes. Add a hidden, sequential `git_workflow` tool in ordinary coding sessions. Its read-only `review` operation takes a local target branch and optional consecutive commit OIDs; it uses `lib/git-review.ts` without a saved policy and displays a transient typed comparison card in the chat. Its `commit` operation uses the existing authenticated whole-file candidate engine, shows the authoritative tree diff and message in a typed card, and calls confirmation only after a human response. The browser reuses the extension UI request ID, replay, Stop/cancellation and response lifecycle; a response to a different or closed request is not consent. The backend revalidates the candidate before the commit ref update.

The comparison acknowledgement is not a merge approval. For `integrate`, the tool validates an explicit target and ordered nonempty check list into an ephemeral policy (never persisted as a default). A first typed card asks permission to execute those checks. Both registered checkouts must be trusted and clean and no other Pi Web session may be busy there. The tool gates the checkouts during verification, then releases them while presenting an exact plan and authoritative diff in a second card. Only an answer matching that server-held plan ID permits a gated, revalidated unsigned non-fast-forward local merge. Stop may abort a running verification command; partial apply remains manual recovery. No dependency on the optional `git-workflow` CLI is added.

An early typed preferences card records a session-scoped target, ordered checks, workspace intent and whether to offer cleanup, from server-enumerated local target branches. It makes no Git changes, does not change a project default and does not authorize future operations; a later integration can use those values only after separately obtaining check and exact plan approvals. Agent-triggered cleanup remains open; moving a chat still bound to a feature checkout requires a separately approved, post-run transaction before that checkout may be removed. The tool cannot currently clean worktrees or contact remotes.

## Consequences

The chat no longer has permanent Git footer links, but manual operations remain available during the transition. An ordinary user can get a generic comparison and explicitly approved commit without creating a session Git policy. Exact integration and cleanup still require separate actions; no preference or comparison authorizes either. Partial commit success remains a manual-recovery result. External Git writers and Windows portability retain the limitations documented in ADR 0007.
