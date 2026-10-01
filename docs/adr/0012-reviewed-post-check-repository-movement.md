# ADR 0012: Review later repository movement when releasing a failed-check quarantine

## Status

Accepted for the bounded Pi Web check-recovery path. This does not change the separate commit, integration, or repository lifecycle approvals.

## Context

A managed failed/cancelled check records the original Git state before and after execution, plus evidence that the original systemd cgroup became empty and terminal. The initial human-review path required today's repository snapshot to match the post-check snapshot. Later, independently performed commits or a target advance made that equality impossible even when the check itself left Git unchanged and the original service is stopped. Turning off the Pi Web workflow cannot resolve or erase a durable quarantine.

## Decision

Retain the unchanged-current-state recovery path. Add a distinct, explicitly acknowledged **post-check movement** path, only when:

- the durable original pre/post check snapshots are identical, valid and tied to the failed/cancelled action and check; the original Linux systemd proof is complete and the original unit is independently confirmed stopped;
- both currently registered worktrees are the same physical resource/branches with the same original policy and check, are trusted and clean, and their original commits are found as reachable Git objects by matching bounded commit identities to the recorded SHA-256 fingerprints. For an agent check, reconstruct the validated ephemeral policy from its immutable check-action artifact and verify its original digest; do not substitute the chat's unrelated legacy policy;
- current refs/index/status and worktree identities are captured in a short-lived, one-use, process-local review; the operator sees original and current commit OIDs, current paths/branches/status, and explicitly acknowledges that later movement and possible non-Git effects were reviewed;
- the server rechecks the action, policy, original unit, worktrees and exact current state under the checkout gate immediately before disposition, and invalidates old process-local plans and verification receipts for the entire repository resource.

This releases the recorded failed-check **quarantine only**. It neither gives the old check a passing receipt nor approves a merge. Candidate trees that cannot be reviewed against their original check remain blocked. Missing historical objects, changed original proof or physical identities, dirty later state and uncertain process state remain blocked. Git history and reflogs cannot attribute a change to an actor; ignored/out-of-tree files and escaped processes are outside this bounded proof and require human investigation.

## Alternatives rejected

- Resetting or temporarily restoring the checkouts to old refs would overwrite subsequent work and make review misleading.
- Deleting/editing the ledger or using another Git implementation to avoid admission bypasses the quarantine rather than resolving it.
- Treating current passing tests as proof that the old check exited, or reusing pre-recovery receipts, confuses execution/containment with success.
- Automatically releasing any record with a stopped unit ignores changes by the original check and changes to resource identity.

## Consequences

A repository with unreachable original commit objects or unreviewed later effects may remain quarantined. This is intentional. The procedure requires a fresh verification run and a separate exact-state integration approval after review. A UI or server restart loses the review ticket but never the durable original evidence. Existing records are not migrated or rewritten during implementation; the only later durable write is a separately approved, validated recovered disposition.
