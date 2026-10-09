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

- [ ] Add shared fixture isolation, unique artifact roots, context tracing and bounded owned-server shutdown; cover failures, interruption and diagnostics with focused regressions.
- [ ] Adopt the helpers in general/plugin/focused browser and terminal acceptance, including peer contexts, without weakening assertions or adding automatic retries.
- [ ] Clarify baseline equivalence, selection, source/verification ownership, diagnostics and retention in maintained guides; slim AGENTS.md while preserving domain guidance in focused documents.
- [ ] Review the diff, run focused regressions then full isolated core checks and affected browser/terminal acceptance at a stable checkpoint, and record exact scope/results.
- [ ] Commit reviewed work and resolve completion intent; rebase/reverify any integration candidate before the tool's separate exact-state approval.

## Completion Checklist

- [ ] All runner-created contexts trace; failed runs retain identifiable logs, screenshots/traces and fixture paths without overwriting an earlier run.
- [ ] Terminal children use private HOME/XDG/agent/TMP state and bounded shutdown; diagnostics distinguish requested signals from observed exits and do not claim arbitrary descendant settlement.
- [ ] Common checks are not required twice by wording; plugin/browser/terminal coverage and final-candidate safeguards remain explicit.
- [ ] Verification evidence and remaining limitations reported; no production builds, settings edits, publication or unapproved cleanup.
