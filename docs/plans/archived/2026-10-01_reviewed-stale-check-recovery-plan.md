# Human-reviewed recovery after a failed check and later branch movement

## Disposition — delivered historically, then retired (2026-10-27)

Historical integration `3cf76a1` is on audited main. The old recovery route, panel,
quarantine proofs and tickets were deliberately removed.
[ADR 0014](../../adr/0014-remove-managed-git-workflow.md) retires all remaining
recovery obligations; no live record is disposed of by this documentation change.
The unchecked integration note and original private-state observations below are
historical, not current resource claims or active recovery instructions.

## Goal

Allow an operator to dispose of a **failed/cancelled** Pi Web Git check whose original production containment proof and unchanged pre/post check snapshots survive, even if the repository later moved, without presenting the old check as passed or bypassing admission.

## Plan Relationship

The integrated Git workflow plan owns broader process/resource admission and automation. This is a bounded exception to the existing unchanged-current-snapshot recovery rule in `AGENTS.md` and `docs/git-workflow.md`, explicitly requested for human-reviewed later movement; it is not general automatic recovery or a new Git action grant. The Pi SDK upgrade stays on its separate feature branch.

## Non-Goals

Do not reset refs or worktrees, remove/edit private admission records directly, interpret reflogs as authoritative actor identity, mint verification receipts, perform a live recovery without a separate exact review, integrate into `rst-main` without exact-state approval, run a production build, or publish remotely.

## Risks and recovery

A changed ref or ignored/out-of-tree side effect cannot be attributed from a Git snapshot alone. Retain the original equal pre/post evidence, physical resource and action ownership, original cgroup's durable empty/terminal proof and fresh stopped-unit query, current worktree identities/status, an expiring single-use review ticket, and checkout-gate rechecks. Explicitly label the limits of current-state review and refuse incomplete/simulated/changed original proof. Testing uses disposable agent dirs/repos; failure leaves the live quarantine intact. Keep the recovery feature worktree and branch if verification or integration is blocked.

## Plan

- [x] Add a distinct bounded current-state capture to `lib/git-verification.ts` and a narrowly typed reviewed-drift disposition to `lib/git-operation-admission.ts`. Focused ledger tests passed; original pre/post equality remains mandatory, and recovery creates no receipt. Invalidate all old receipts in the affected Git resource, not only one checkout.
- [x] Extend `app/api/git/check-recovery/route.ts` to preview original/current commits and statuses without requiring a current merge review, then require a separate drift acknowledgement and recheck ticket, resources, trust, action and original systemd unit on POST. Real-systemd opt-in tests passed 7/7, including moved refs, dirty/stale/replay refusals; the agent's original ephemeral policy is reconstructed from its immutable action and validated against the proof digest.
- [x] Update `components/GitCheckRecoveryPanel.tsx` to show original/current checkout state and a separately labelled acknowledgement. Component tests passed 4/4; full browser E2E exercised the moved-review UI with a disposable intercepted response and passed at desktop/mobile sizes.
- [x] Update `AGENTS.md`, `docs/git-workflow.md` and ADR 0012 for this exact exception, its limits and its separate original-policy provenance; the original unchanged-state path still passed the real-systemd test. The SDK upgrade remains on its own branch.
- [x] Run focused tests, `env -u PI_PACKAGE_DIR npm test` (1,995 pass, 6 skipped), `node_modules/.bin/tsc --noEmit`, `npm run lint`, full `npm run test:e2e`, real-systemd route tests and `git diff --check`; all passed in this recovery checkout before committing.

## Completion Checklist

- [x] No live private recovery record was changed by implementation or tests; read-only inspection still reports `unresolved` for action `b03e0cf9-327e-4893-8c17-7065d9e46e2d`. A read-only preview using this source returned `mode: moved` with both current clean worktrees; its process-local ticket was not used.
- [ ] Feature branch and worktree are clean after commits; `rst-main` remains untouched until a separately approved non-fast-forward integration of an exact verified candidate.
