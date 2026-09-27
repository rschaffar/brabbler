# 0009 — Explicit same-repository worktree selection for agent Git tools

## Status

Accepted. Extends ADRs [0007](0007-session-git-workflow.md) and [0008](0008-agent-triggered-git-review.md); it does not change their approval or remote boundaries.

## Context

An ordinary chat may run in the main checkout while the feature being reviewed or committed lives in another linked worktree. Previously the agent tools always used the chat's cwd as the source, forcing the agent to move the chat or fall back to ad-hoc commands. The chat's saved policy must not grant access to unrelated projects or another chat's policy.

## Decision

Add an optional `workspaceBranch` selector to `git_commit`, `git_workflow`, and `git_workspace_start`. Omission retains the calling chat's checkout. A supplied name must identify exactly one physical, registered local-branch checkout in the calling chat's Git common directory and pass Pi Web's existing allowed-root boundary if distinct from the chat checkout. Never accept an arbitrary path, detached checkout, remote ref, or target chat's saved policy. Re-resolve the selector on confirmation or before mutation and retain each operation's existing stale-state checks. The selected source/feature checkout is shown on review and approval cards, alongside the merge destination when applicable.

The calling chat remains the identity and consent owner. `git_commit` still requires its saved `commits: agent` policy; `git_workspace_start` still requires its saved worktree policy and creates a new worktree from the policy's base branch. An `onCreate` continue/fork acts on **the calling chat**, not on a session in the selected creation-source checkout. `git_workflow` continues to require separate check permission, exact commit/merge approval, trusted checkouts and state-bound receipts. Agent-start guidance favors these tools when available and permitted by repository instructions instead of asking for an approval that the tool can collect, without overriding stricter instructions.

## Consequences

A registered worktree outside Pi Web's allowed roots is unavailable until explicitly made browsable. Verification commands still run in the selected feature checkout and may have side effects. In-process gates do not prevent external Git writers; no cross-project action, automatic cleanup or remote operation is introduced.
