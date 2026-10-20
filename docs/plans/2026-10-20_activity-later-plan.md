# Activity Later and archived attention

## Goal

Let users defer an unread completion or Needs you session to a Later section below Ready to review, retain the yellow dot/details for pending questions, and show actionable archived sessions in Activity.

## Plan Relationship

Extends the existing server-activity-review and session-archive implementations without taking ownership of their historical acceptance gaps. The current acceptance baseline is `docs/testing.md`.

## Assumptions

Later is a shared, durable per-completion receipt, not Read. Read wins over Later; a newer completion returns to Ready to review. Live runs and non-deferred questions keep priority. The user's follow-up explicitly includes deferring Needs you. Those deferrals bind exact live request IDs, remain yellow and answerable, and never acknowledge/answer the question; replacement questions surface again. Bulk subagent Read stays scoped to Ready to review, excluding Later. Idle archived history remains absent; project privacy still applies.

## Plan

- [ ] Extend the locked activity ledger and validated review endpoint with bounded completion/request Later receipts, preserving version-1 files; verify persistence, concurrency, stale/new completion, corruption and eviction contracts.
- [ ] Wire Later through the visible-tab poll and Activity actions/sections; remove archive exclusion without weakening privacy; verify classification and browser interactions.
- [ ] Update README and feature contracts; obtain independent review and address findings.
- [ ] Run complete Nix core, browser/terminal and deployment acceptance with explicit resource admission; retain exact inputs/results/artifact paths and timings.

## Rollback / Recovery

Only Pi Web activity metadata changes; transcripts and archive metadata remain untouched. Existing version-1 ledgers without Later remain readable. Reverting code leaves metadata intact; no deletion, deployment or remote publication is authorized. Atomic locked writes preserve prior state on failure; corrupt data fails visibly.

## Checkpoint Evidence

The completion-only checkpoint passed `nix run .#test -- all --workers 4 --jobs 4` in 621s end-to-end (includes realization): 344 core files / 2,603 tests / 12 suites, all 24 browser/terminal groups, and genuine deployment VM. Snapshot `41d2e82c97d78f9445a0441bfc01367df98bb66d173563aa77a610143bbd92ee`; evidence `/tmp/pi-web-test-source-HBpgqt/selection.json`, `/tmp/pi-web-test-core.4epsKR/run.json`, `/tmp/pi-web-test-browser.ODbhXm/run.json`, `/tmp/pwv-tNcUq9/run.json`. Independent review led to a deterministic gated response-loss fixture; its full browser rerun passed in 349s with snapshot `5ae78ce2fbca71c9923021b071e1e6f8a4bac59193325a15dd4096a922067f96`, evidence `/tmp/pi-web-test-browser.Abbl4F/run.json`. Snapshot comparison found only `e2e/activity.mjs` changed. These are checkpoint results, **not acceptance of the subsequently requested Needs you deferral extension**.

## Completion Checklist

- [ ] Later survives reload/other clients, remains unread, can be marked Read, and does not hide newer completions or live attention.
- [ ] Archived actionable roots/subagents appear; idle history stays absent and concealed projects stay concealed.
- [ ] Required acceptance passes on settled application inputs; exact candidate and evidence are recorded.
- [ ] Feature history is committed; completion intent and exact-state integration approval are resolved separately under the Git policy.
