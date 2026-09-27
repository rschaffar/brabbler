# 0008 — Agent-triggered Git candidate review in the chat

## Status

Accepted for policy-independent comparison and exact human-approved commits. Agent-driven merge execution, verification and cleanup remain open in the [implementation plan](../plans/2026-09-27_agent-git-review-plan.md).

## Context

ADR 0007 put three Git controls in permanent rows above the composer and tied merge review to a saved session policy. Recent conversations repeatedly ask the same setup questions and then separately approve a verified merge and cleanup. These controls are intrusive even when no Git operation is underway and cannot be invoked by an agent to show a structured candidate. A saved preference is useful to prefill answers but must never stand in for exact-state consent.

## Decision

Move the legacy controls into one on-demand menu near the top of the chat, preserving manual access to the existing guarded routes. Add a hidden, sequential `git_workflow` tool in ordinary coding sessions. Its read-only `review` operation takes a local target branch and optional consecutive commit OIDs; it uses `lib/git-review.ts` without a saved policy and displays a transient typed comparison card in the chat. Its `commit` operation uses the existing authenticated whole-file candidate engine, shows the authoritative tree diff and message in a typed card, and calls confirmation only after a human response. The browser reuses the extension UI request ID, replay, Stop/cancellation and response lifecycle; a response to a different or closed request is not consent. The backend revalidates the candidate before the commit ref update.

The comparison acknowledgement is not a merge approval. The tool cannot currently verify, execute a merge, clean worktrees or contact remotes. Continue to use the on-demand manual panels for local integration until a server-owned staged execution flow handles a running tool, checkout gates, check trust, exact-state approval and sessions living in the worktree to be removed. No dependency on the optional `git-workflow` CLI is added.

## Consequences

The chat no longer has permanent Git footer links, but manual operations remain available during the transition. An ordinary user can get a generic comparison and explicitly approved commit without creating a session Git policy. Exact integration and cleanup still require separate actions; no preference or comparison authorizes either. Partial commit success remains a manual-recovery result. External Git writers and Windows portability retain the limitations documented in ADR 0007.
