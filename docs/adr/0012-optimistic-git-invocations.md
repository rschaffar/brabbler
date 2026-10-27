# 0012 — Independent Git invocations and optimistic concurrency

> Historical decision: superseded by [ADR 0014](0014-remove-managed-git-workflow.md). Managed Workflow is removed; this document does not define current runtime behavior.

## Status

**Settings/entry-path update, 2026-10-04:** [ADR 0013](0013-live-git-settings.md) replaces captured tasks and duplicate writers with live scoped settings and selected agent/human operations; it does not supersede this record's independent-invocation decision. Core Phase 7 source is migrated and under acceptance, with origin hardening and cross-scope consent verification ongoing. Earlier status notes below, including the live failure and idle-only proposal descriptions, are historical observations, not current setup instructions or installed validation. See [the maintained guide](../git-workflow.md); Phase 6's accepted source/integration/cleanup does not certify Phase 7. Historical bodies and all genuine authorization/native/check safeguards remain intact.

**Accepted decision, 2026-10-03; Phase 6 source accepted and integrated, production entry path unproven.** The user explicitly rejected persistent failed-check quarantine and then clarified the broader requirement: another session must not block Git work through activity, failure, uncertainty, history or application-level synchronization. The user accepts responsibility for concurrent edits and deletion of a worktree still used by a session. The authorized implementation is connected after the Phases 2–5 feature rebase; this is not a paused design proposal or an installed-release claim.

This supersedes the application reservations, repository-wide admission/quarantine, cross-invocation receipt fencing and placement leases in [ADR 0011](0011-policy-driven-git-tools.md), including its section 7. It does **not** supersede authorization, required checks, exact-candidate approval, physical identity validation, deliberate staging, method-specific integration, rebase result reentry or truthful outcomes. The [historical roadmap](../plans/archived/2026-09-29_policy-driven-git-tools-plan.md) later delivered removal; [ADR 0014](0014-remove-managed-git-workflow.md) retires its outstanding managed-Workflow obligations.

**Source acceptance complete:** final Phase 6 source `2ccc381` passed **3,211 tests / 5 skipped**, typecheck/lint, **25 containment cases (5 actual OS cases)** plus **8 real-backend independent cases**, **20 browser scenarios**, and terminal checks at **1440×900 / 390×844**. Native prepared-ref/checked-out transactions, original invocation capabilities, scoped authority, required-check batches, own-caller cleanup, live reads and bounded retention are covered by that source/disposable-fixture acceptance; application gates/leases/admission are retired. Explicit unsigned non-FF integration `1a48d0e` and separately approved removal of its feature worktree/branch and five ignored artifact entries are complete.

**Production-path gap remains:** the user rebuilt the system; the current `/nix/store/a32ya4fhd9hphp96g3r04qvfdnvz4rp1-pi-web-0.9.3` package and SDK **1.0.0** were verified. Nevertheless, live selected-tool metadata `workspace: current` failed with **`selected-runtime-unavailable`** for **`task: none`**. Green source fixtures do not prove the real production entry path. Phase 7 of the sole coordinator-owned roadmap owns entry wiring and the authorized removal of the entire redundant task layer; the broader live-settings migration is not yet implemented. Settings-proposal Apply/Dismiss and own-session idle persistence guards remain until persistence changes. This copy repair is not whole-feature completion. The [guide](../git-workflow.md) owns the source contract and limits; the roadmap owns metrics and acceptance. This notice supersedes historical pending-acceptance statements below. No production build is expected during development. Prior integration/cleanup approvals authorize no new integration, cleanup, publication, deployment, Nix/global-rule change or live-consent migration.

Required batches authenticate original private attempt/settlement/registration membership and the exact ordered required receipt set, never public cohort metadata. The browser runs one explicit required-check batch and does not fall back to old passes after current-batch failure; none never waives required checks. Legacy integration derives recipes only from captured task settings or validated saved preferences; `params.checks` can only exactly compare them. Saving preferences remains a separate explicit decision, and paired cwd/env/requiredStage refusal is unchanged.

Own-checkout cleanup authenticates the original candidate/removal pair at the first native handoff before ordinary reads after disappearance, retaining the original caller/fence/scopes and current policy/trust. No new fence, fake caller or chat move is introduced. Anchorless workspace/preparation lazy reads require privately issued original RPC request/response and SDK-owner identity across root awaits; anchored history is a separate read-only path. Neither grants execution rights; human previews retain inline patches.

Completed diagnostic retention is connected with 16 MiB record, 100 MiB log and 64 MiB artifact targets. Bounded aggregate-byte/entry accounting protects incoming correlation IDs and permits validated-prefix recovery from stable overshoots, not a global quota or Git gate. Legacy history remains read-only without live pruning, replay or recovery-release. Authenticated `/api/git/check-recovery` GET is diagnostic and POST returns 410; it creates no `cgroupRelease` grant. Unknown/active/uncertain spools remain untouched; unavailable original artifacts are never reconstructed from current checkout content. These source facts do not weaken the decision below or the repository's stronger lifecycle rules.

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

The predecessor native implementation modified checkout files before its final ref CAS. Removing its application gate alone was insufficient; the shared replacement transaction below is implemented and connected to callers, with aggregate acceptance still pending.

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
