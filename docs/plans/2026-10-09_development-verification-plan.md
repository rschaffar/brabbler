# Effective development and verification

## Goal

Implement the approved instruction changes plus reliable browser diagnostics,
per-run artifacts, and isolated bounded terminal-test lifecycle. Preserve exact
candidate verification, worktree isolation, non-FF integration and separate
cleanup authority.

## Plan Relationship

`docs/testing.md` owns verification; `e2e/README.md` owns browser/terminal
acceptance. Existing Nix and Git plans retain their scopes. This work does not
revive the removed Managed Workflow framework or change application behavior.

## Non-Goals

Tests-only iteration mode, archive/restore race fixes, production builds,
settings changes, remote publication, and deletion of existing resources.

## Plan

- [x] Add shared fixture isolation, unique artifact roots, context tracing and bounded owned-server shutdown; cover failures, interruption and diagnostics with focused regressions.
- [x] Adopt the helpers in general/plugin/focused browser and terminal acceptance, including peer contexts, without weakening assertions or adding automatic retries.
- [x] Clarify baseline equivalence, selection, source/verification ownership, diagnostics and retention in maintained guides; slim AGENTS.md while preserving domain guidance in focused documents.
- [ ] Review the diff, run focused regressions then full isolated core checks and affected browser/terminal acceptance at a stable checkpoint, and record exact scope/results.
- [ ] Commit reviewed work and resolve completion intent; rebase/reverify any integration candidate before the tool's separate exact-state approval.

## Verification checkpoint

The pre-rebase candidate passed the complete Linux isolated pipeline (264 files,
1,695 tests, type generation/typecheck/lint), general browser acceptance, and
focused harness regressions. Terminal and plugin acceptance passed before the
final trace-export-budget adjustment. These are not post-rebase receipts.

User selected local integration and requested rebase before further acceptance.
Rebased onto `c09460c1a8e2c9fb16a69a60235e6bfa28a05fbf`; preserved the new
size-independent Git review guidance in `docs/feature-internals.md` and adapted
the newly merged trust-only browser branch to shared tracing/isolation. An initial
mechanical AGENTS conflict was aborted before creating
`backup/development-verification-20261009-1018`; that backup remains retained.
Combined-candidate baseline and acceptance are pending below.

## Completion Checklist

- [x] All runner-created contexts trace; failed runs retain identifiable logs, screenshots/traces and fixture paths without overwriting an earlier run.
- [x] Terminal children use private HOME/XDG/agent/TMP state and bounded shutdown; diagnostics distinguish requested signals from observed exits and do not claim arbitrary descendant settlement.
- [x] Common checks are not required twice by wording; plugin/browser/terminal coverage and final-candidate safeguards remain explicit.
- [ ] Verification evidence and remaining limitations reported; no production builds, settings edits, publication or unapproved cleanup.
