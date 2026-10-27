# Effective development and verification

## Closure — completed historical milestone (2026-10-27)

Integrated lineage `277db23` is on audited main. Current three-level Nix acceptance
supersedes the offline/dev-server commands below; diagnostics and bounded lifecycle
contracts belong to `docs/testing.md` and `e2e/README.md`. Historical reset attribution
remains unproven, not a new blocker or a claimed fix. See the
[closure index](../README.md#closure-evidence). Original pending-merge, backup and
resource observations below are historical, not current execution instructions.

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
- [x] Review the diff, run focused regressions then full isolated core checks and affected browser/terminal acceptance at a stable checkpoint, and record exact scope/results.
- [x] Commit reviewed work and resolve completion intent; rebase/reverify any integration candidate before the tool's separate exact-state approval.

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
Combined-candidate verification completed on
`1642b2c5afd28e44951eea1a42b511af03c6b9e3`, with writers paused and heavy checks
serialized. Every command below used `nix develop --offline --no-write-lock-file -c`:

| Command after shell prefix | Result / evidence |
| --- | --- |
| `node nix/test-offline.mjs` | PASS: 266 files / 1,705 tests, 29 exporter contracts, typegen, typecheck, lint; `/tmp/pi-web-development-verification-rebased-full.log`, retained `/tmp/pi-web-test-offline.GbXwNunm` |
| `npm run test:e2e` | PASS: general desktop/mobile acceptance; `test-results/e2e/browser-wTqkF2`, 11 traces |
| `env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` | PASS: both viewports; `test-results/e2e/browser-Ok7Ey3`, 2 traces |
| `env E2E_TRUST_ONLY=1 npm run test:e2e` | PASS: both viewports; `test-results/e2e/browser-X6Ata7`, 2 traces |
| `npm run test:terminal` | PASS: both viewports; `test-results/e2e/terminal-H8XOja`, 2 traces |
| `env E2E_ACTIVITY_ONLY=1 npm run test:e2e` | PASS: desktop/tablet/mobile and peer; `test-results/e2e/browser-hdsC5C`, 8 traces |
| `env E2E_TIMESTAMPS_ONLY=1 npm run test:e2e` | PASS: both viewports; `test-results/e2e/browser-lQgKYx`, 2 traces |

All six acceptance manifests report no errors, settled child/pipes and absent
original POSIX process groups. Every opened context has a nonempty saved trace.
All 33 current-target design subsections were checked for exact preservation once
in the guides (normalizing relative links); maintained local file links resolve.
`git diff rst-main...HEAD --check` passed. This evidence-only plan follow-up does
not alter tested executable inputs; it receives a documentation/diff review,
not another redundant application acceptance run. Merge approval remains separate.

## Failures and limits

- Early fixture ownership assertion and undefined terminal screenshot path were
  fixed. Regression review also covered interrupted launch ownership, concurrent
  trace closure, early pending-request rejection and shutdown settlement honesty.
- Pre-rebase `browser-EZuEI1` retained the observed plugin `get_tools` ECONNRESET;
  timestamped events show the primary failure preceded requested teardown. Later
  plugin runs passed, but the original connection reset's cause is **unproven**.
- Pre-rebase `browser-xkoC81` exposed a five-second export deadline for a roughly
  128 MB trace and a redundant deleted-account selection issuing a rejected PUT.
  Export now has its own measured 30-second budget, separate from screenshots;
  the fixture asserts restored selection without issuing that unnecessary write.
  Application assertion deadlines and general console/5xx failure rules remain.
- No Windows acceptance was run. Shutdown does not certify escaped descendants
  or Windows descendants. Retained fixtures/logs/traces may contain private test
  material; existing resources, the backup branch and external test roots require
  separate bounded cleanup authorization. No installed service, production build,
  remote operation, settings change or application archive/restore fix was used.

## Completion Checklist

- [x] All runner-created contexts trace; failed runs retain identifiable logs, screenshots/traces and fixture paths without overwriting an earlier run.
- [x] Terminal children use private HOME/XDG/agent/TMP state and bounded shutdown; diagnostics distinguish requested signals from observed exits and do not claim arbitrary descendant settlement.
- [x] Common checks are not required twice by wording; plugin/browser/terminal coverage and final-candidate safeguards remain explicit.
- [x] Verification evidence and remaining limitations reported; no production builds, settings edits, publication or unapproved cleanup.
