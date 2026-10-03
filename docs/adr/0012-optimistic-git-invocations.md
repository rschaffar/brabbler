# 0012 — Independent Git invocations and optimistic concurrency

## Status

**Accepted direction, 2026-10-03; implementation in progress.** The user explicitly rejected persistent failed-check quarantine and then clarified the broader requirement: another session must not block Git work through activity, failure, uncertainty, history or application-level synchronization. The user accepts responsibility for avoiding conflicting edits in the same worktree. The requested implementation follows completion of the Phases 2–5 feature rebase.

This supersedes the application reservations, repository-wide admission/quarantine, cross-invocation receipt fencing and placement leases in [ADR 0011](0011-policy-driven-git-tools.md), including its section 7. It does **not** supersede authorization, required checks, exact-candidate approval, physical identity validation, deliberate staging, method-specific integration, rebase result reentry or truthful outcomes. The [existing roadmap](../plans/2026-09-29_policy-driven-git-tools-plan.md) remains the sole execution plan.

**Current versus intended behavior:** the rebased source still has those older gates. This record is not a claim that they have been removed. Native transaction and invocation foundations must precede removing any gate on which apply currently relies. No local integration, publication, deployment, live-settings change or feature-resource cleanup is approved here.

## Decision

**An operation may proceed because its own authority and exact current Git state permit it—not because other sessions are idle or their historical records are settled.**

1. Capture an explicit physical source/target, relevant refs, index/content state, policy, result and required verification evidence.
2. Obtain the operation's own exact Ask approval, or qualify an explicitly requested no-confirmation operation under its existing stricter saved authorization rules.
3. Consume a process-local, single-use invocation capability. Revalidate its original authority and state immediately before effects.
4. Apply using Git-native index/ref transactions against the captured expected commits. Reject a changed candidate or native contention without waiting in an application queue or retrying implicitly.
5. Report actual success, definite no-effect rejection, measured partial effects or uncertainty. History records these facts but cannot authorize or prevent another invocation.

No process-wide/session-wide checkout gate, common-directory reservation, resource busy map, historical unresolved-intent veto or session/terminal placement lease replaces the old scheme under another name. Two distinct invocations may operate on the same repository. Reuse of the **same** consumed invocation remains forbidden. Genuine overlapping Git writes may contend on Git's own native locks; that is not application session ownership.

## Authorization and verification remain independent

- Deny, Off/Manual/disabled modes, opt-out, pause, allowed roots, trust, caller capabilities and relevant project/user instructions still govern the calling operation.
- Allow does not silently suppress Ask. Explicit no-confirmation eligibility remains separately checked, including the special non-inheritable ordinary-creation requirement for commits.
- Each operation retains its own immutable authority baseline. Relevant policy/trust changes and change-and-restore revoke it. An unrelated session's writes must not revoke another invocation merely by incrementing a global epoch.
- Required commit/integration recipes still need authentic, fresh, successful, correctly scoped receipts. Removing historical quarantine does not allow committing through a failing required commit check.
- A failed/cancelled/uncertain check produces no success receipt and retires its **own** cohort. It cannot invalidate another session's otherwise-current cohort. A late completion cannot reopen a retired cohort.
- Working-workspace checks retain the explicit limitation that the eventual selected commit tree was not tested. Clean-checkout, working-workspace and legacy paired evidence are not interchangeable.
- Snapshot dependencies must name relevant resources/refs rather than every unrelated repository ref. Changed dependency semantics require a new evidence version; do not relabel old snapshots or claim arbitrary check commands have no external dependencies.

## Checked-out transactions, not just ref CAS

The current native implementation modifies checkout files before its final ref CAS. Removing the application gate around that sequence is insufficient.

The replacement uses pinned physical repository/worktree administration and the original real target `index.lock` descriptor. It prepares an interactive native `update-ref --stdin` transaction which verifies the source and conditionally updates the target, using no-dereference semantics and exact expected OIDs. Git must acknowledge preparation and hold the relevant ref locks **before checkout files change**.

With those native protections held, revalidate the original source and target bytes/index/HEAD bindings and authority, apply the exact tree using a private temporary index, independently verify the resulting tree/files/modes/symlinks, and write/fsync the result through the owned real index-lock descriptor. Commit the prepared ref transaction, then install that same index inode. FF and non-FF retain their requested object/parent semantics; preparation reverses which captured ref is updated and which is verified. No hooks, signing, filters, implicit merge strategy or shell fallback is introduced.

Locks last only for the bounded native transaction—not coding, checks, human waiting or history persistence. On failure, abort an uncommitted native transaction, stop/reap owned children, and release only native locks whose ownership is proved. Never recreate or deliberately retain an index lock as application quarantine. A process crash may naturally leave a Git lock; an unrelated invocation must not delete an unowned lock automatically.

Refs, the index and working files are not one crash-atomic filesystem transaction. Report whether checkout application began, whether a ref commit was sent/acknowledged, what was observed afterward, and whether index installation completed. Lost acknowledgement is not proof of no effect. Never roll back over subsequent work or repeat an uncertain invocation automatically. A new independently authorized candidate is allowed if its actual current state is supported, regardless of historical uncertainty.

## Checks, diagnostics and retention

Containment remains an execution property: run authorized check commands with process accounting, supervise cancellation and attempt cleanup of their own descendants. Incomplete cleanup is an honest warning/non-success for that invocation, not a durable veto on another session. Neither records nor their absence prove that an external writer has stopped; the user accepts concurrent editing responsibility.

Separate immutable candidate/outcome diagnostics from live native capabilities. Optional output/history storage failure reports unavailable diagnostics; it must not turn known native success into fictitious native uncertainty or block a different invocation. Missing mandatory execution evidence still means that invocation cannot claim success or issue a receipt. History IDs, restored JSON and copied records never reconstruct authority, including after restart.

Use bounded per-item writes plus best-effort rotation of recognized application-owned diagnostic data. Initial implementation budgets are **100 MiB for completed output logs, 16 MiB for compact records and 64 MiB for captured artifacts**, retaining existing per-item bounds. These are retention targets, not transactional disk quotas: concurrent writes or failed deletion can temporarily exceed them. If space cannot be reclaimed safely, omit optional new diagnostics with a warning instead of rejecting Git work. Do not add a cross-session admission lock to enforce the budget.

Rotation must not delete project files, branches, worktrees, native Git locks, active transports or uncertain process spools. Evicted history artifacts are labelled unavailable/expired; do not reconstruct them from today's checkout. Receipt retirement and anti-replay live independently of diagnostic retention, so deleting or restoring records cannot revive a capability. No existing live private history is pruned as part of developing or testing this feature; retention tests use disposable fixtures.

## Workspace creation and cleanup

Creating a worktree does not own, move or lock a session. Removing a worktree still requires independent explicit deletion authority, exact named resources, safe integrated history, unchanged supported file state, ignored-data consent where applicable and native validation. Session/terminal inventory is informational, not an exclusive placement lease or a veto on unrelated operations. The user is responsible for not deleting a worktree still needed by a session; tools never move sessions automatically to make deletion work.

Native partial removal and branch-update outcomes remain distinct. A cleanup failure cannot quarantine the repository or authorize blindly deleting whatever remains. No automatic cleanup or remote action follows integration.

## Acceptance

- Two real persisted sessions run checks concurrently in distinct feature worktrees of one repository. Failure/cancellation/uncertainty or unavailable diagnostics in A does not prevent B's check, own receipts or separately authorized commit.
- Genuine simultaneous same-target FF/non-FF attempts use native transactions. At most one captured candidate wins; a loser changes no target files/index/ref and cannot transfer its approval to a newer candidate.
- Independent branch commits do not invalidate each other solely because unrelated refs changed. Relevant source/target/content/policy changes still reject stale evidence.
- Forged, copied, replayed, restarted or retired invocation/cohort handles cannot execute or issue receipts. Own final authority fences remain mandatory.
- Partial filesystem/ref/index effects and missing acknowledgements produce truthful outcomes without automatic retry, rollback or artificial persistent locks.
- Legacy unresolved/corrupt/oversized history and retention failures are diagnostic only across browser, legacy agent and selected-operation paths. No hidden RPC/tool/terminal placement gate reintroduces cross-session blocking.
- Deletion keeps exact-resource and independent-consent safety without session ownership; disposable tests prove no automatic session movement or deletion on merge.

## Consequences

This is a deliberate tradeoff, not merely an ergonomic relaxation of quarantine. The application no longer attempts to protect one session from arbitrary code or continued processes launched by another. Exact native Git validation protects supported transactions; it is not a sandbox or a guarantee against uncoordinated same-worktree filesystem writes. The user has explicitly chosen that responsibility model.

All implementation, documentation and UI claims must distinguish this accepted direction from connected and verified behavior. Integration of this feature still requires fresh exact-state approval under the repository lifecycle.
