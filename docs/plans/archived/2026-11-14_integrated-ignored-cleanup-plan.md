# Opt-in ignored-file disposal for integrated worktrees

## Goal

Allow a user to approve a merge and have an agent subsequently remove the integrated
feature worktree and its ignored contents without another routine approval card.
The user explicitly selected a saved opt-in, any otherwise eligible integrated
feature worktree, whole-worktree removal only, and permanent deletion without a
recovery archive. Tracked changes and unignored untracked files still block removal.

Status: implementation, independent safety review and complete acceptance finished.
The remaining mandatory exact-state local non-FF integration is handed to the
receiving session's native Git lifecycle; this record does not claim its execution.
No live setting changes, deployment, remote operations or resource cleanup are authorized
by this plan. Integration into local main requires exact-state approval.

## Plan Relationship

This feature revises ADRs 0017/0019 only for explicit standing ignored-file authority.
The Git-backed review plan retains review storage/migration ownership; the core
optimization plan retains performance work. Neither is expanded by this feature.

## Architecture

- Add `ignoredArtifactPolicy`, default `exact-paths`, with explicit
  `all-in-integrated-worktree` opt-in in the existing scoped settings matrix.
  Keep it separate from workflow choices, presets and `cleanupFeature` permission.
- Only integrated cleanup removing its worktree may use the new authority. Derive
  ignored membership from fresh Git enumeration, never agent arguments. During
  effects recheck membership without discovering or adding deletion targets.
- Keep exact-path approval behavior for artifact-only cleanup, strict worktree
  removal and browser discard. Existing settings retain their current meaning.
- Freeze inventory and authority, retain policy revocation, source/ref/path/activity
  protections, and record policy-authorized versus user-approved results honestly.
- Settings help and operation receipts explicitly describe permanent deletion,
  including ignored local data; no archive or content-based secret classification.

## Non-Goals

Deleting dirty tracked files or sweeping unignored untracked files; automatic
session relocation; weakening mount, nested-repository, special-file, symlink or
literal-path protections; coupling cleanup execution to merge; backups; enabling
new permission automatically; performance redesign.

## Plan

- [x] P1: Add the setting, scoped resolution/guidance and integrated-only ignored
  authorization; exercise actual permission/source-boundary behavior in existing
  pure and native test owners, including a meaningful failing counterexample.
- [x] P2: Add explicit UI warning/receipt presentation, ADR and maintained guides;
  verify scoped UI save/readback, defaults, unaffected presets and browser-discard
  behavior. Complete an independent safety review and resolve its findings.
- [x] P3: Run focused checks, then complete sandboxed core/static, all browser/terminal
  groups and genuine deployment acceptance after changes settle. Record immutable
  inputs, commands, results, artifact locations, resource widths and timings.
- [x] P4 handoff: the verified source/evidence candidate is ready for the receiving
  session's native Git lifecycle. That owner must commit only this feature, rebase
  onto current local main, reassess changed inputs and obtain exact-state approval
  for ordinary unsigned non-FF integration. Actual integration and any subsequent
  resource cleanup are proved by native operation reports, not this implementation
  record. Publication and deployment are not part of this work.

## Verification checkpoint

Focused command: `nix run .#test -- core --jobs 4` selecting
`plugins/git-workflow/{cleanup,resource-rules,policy,discard}.test.mjs` and
`components/SettingsUi.test.mjs` through repeated `--file` options.
All **308 tests in five files** pass with typegen/typecheck/lint, no skipped or
cancelled tests. Core output:
`/nix/store/05spjfshvcdhf96yzhnwz4kmsz3d5rfn-brabbler-core-checks`.

The first focused run caught a real structural-parent preservation bug; its
immutable failure is retained privately, and the corrected nested-removal case
passes. A controlled fault removing only the remaining-artifact authority
comparison fails exactly the empty-directory lost-ignore-membership test
(**162 pass / 1 fail**), showing that clean porcelain alone is insufficient.
Original production bytes were restored before the green run. Independent review
confirmed the added empty-directory, pending-Ask and partial-effect revocation
cases and closed with no blockers. Existing per-file N/F isolation remains valid:
new native effects are synchronous/awaited and confined to each existing private
fixture; the mounted case uses the existing fenced settings fixture.

### Complete acceptance

`nix run .#test -- all --workers 4 --jobs 4` passed in **433 seconds** end to end,
including in-run realization. Exact immutable source:
`/nix/store/4gmwf0m1hg0h1zrji732drm7cy3hxgk7-source`, outer content/mode digest
`d2176586837b5bf1ffbf554fa6e38e3512dce5046e37476f17a4f39db4f0a0a5`.
All **534 core files / 4,666 tests / 14 suites**, **26 browser/terminal groups**,
and genuine Home Manager deployment passed, with no skipped/cancelled core cases.
Core output: `/nix/store/iqym5s7zpimygmsr98kjb1pngygs8pny-brabbler-core-checks`.
Application package: `/nix/store/na1r2ipki8i6a68hfplrh40hr9j0sdjc-brabbler-0.1.0`.

Requested/effective widths were four core workers and four browser sandboxes. Another
Nix-backed test workload was active, so the four/four profile reserved headroom on
the observed 32-CPU / approximately 61-GiB-available host instead of admitting the
32-CPU twelve/four estimate. Core invocation/file-execution windows were
**411.611 / 408.541 seconds**. Browser invocation was **322.278 seconds**, including
**70.320 seconds** support preparation and **5.200 seconds** definition publication;
its group-client window was **246.754 seconds**. Deployment invocation was
**103.817 seconds**, including realization and the **52.950-second** guest script.
These overlap and are not additive. Static evidence reused its exact declared
inputs from the focused run; effectful acceptance was fresh. This is correctness
evidence, not a matched performance benchmark. No installed service or live setting
was changed. Subsequent plan/index closure is documentation-only and is not relabelled
as another application test run.

[ADR 0043](../../adr/0043-integrated-worktree-ignored-files.md) owns the durable decision;
[Git plugin documentation](../../git-workflow-plugin.md#bounded-cleanup) owns operation,
activation and safety behavior. Private logs retain original failed and successful
runs; runner-required short-path diagnostics remain with their native reports.

## Risks and stop conditions

Ignored files can contain valuable local data and configuration. The opt-in must be
explicit, default conservative, and scoped by the existing resolver. No source file,
transcript, tool argument or preset can manufacture it. Unsupported paths/types or
safety failures retain resources and report the blocker. Stop on unexpected checkout
changes or conflicts rather than resetting another task's work.

## Rollback / Recovery

Before effects, rejection/revocation retains resources. After dispatched deletion,
partial results are durable; no automatic rollback, retry or backup is promised.
Disabling the setting restores exact-path authority for future invocations but cannot
recover deleted ignored data. Application rollback does not delete private settings.

## Completion Checklist

- [x] New permission is opt-in and does not change existing settings or presets.
- [x] Integrated removal can run without an artifact card; Ask still asks and Deny/Keep
  still block. Nonintegrated, artifact-only and manual-discard paths are not broadened.
- [x] Dirty/untracked, stale-policy/inventory, path, activity and integration protections
  have relevant behavioral coverage and independent review.
- [x] Required complete acceptance passes with retained exact-input evidence.
- [x] Durable decision and current behavior are in their owning guides.
- [x] Remaining exact-state integration and resource-cleanup obligation transferred
  explicitly to the receiving session's native Git lifecycle as described in P4.
  Archived implementation evidence is neither integration proof nor cleanup permission.
