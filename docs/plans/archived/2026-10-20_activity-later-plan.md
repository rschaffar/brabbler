# Activity Later and archived attention

## Goal

Let users defer an unread completion or Needs you session to a Later section below Ready to review, retain the yellow dot/details for pending questions, and show actionable archived sessions in Activity.

## Plan Relationship

Extends the existing server-activity-review and session-archive implementations without taking ownership of their historical acceptance gaps. The current acceptance baseline is `docs/testing.md`.

## Assumptions

Later is a shared, durable per-completion receipt, not Read. Read wins over Later; a newer completion returns to Ready to review. Live runs and non-deferred questions keep priority. The user's follow-up explicitly includes deferring Needs you. Those deferrals bind exact live request IDs, remain yellow and answerable, and never acknowledge/answer the question; replacement questions surface again. Bulk subagent Read stays scoped to Ready to review, excluding Later. Idle archived history remains absent; project privacy still applies.

## Plan

- [x] Extend the locked activity ledger and validated review endpoint with bounded completion/request Later receipts, preserving version-1 files; verify persistence, concurrency, stale/new completion, corruption and eviction contracts.
- [x] Wire Later through the visible-tab poll and Activity actions/sections; remove archive exclusion without weakening privacy; verify classification and browser interactions.
- [x] Update README and feature contracts; obtain independent review and address findings.
- [x] Run complete Nix core, browser/terminal and deployment acceptance with explicit resource admission; retain exact inputs/results/artifact paths and timings.

## Rollback / Recovery

Only Pi Web activity metadata changes; transcripts and archive metadata remain untouched. Existing version-1 ledgers without Later remain readable. Reverting code leaves metadata intact; no deletion, deployment or remote publication is authorized. Atomic locked writes preserve prior state on failure; corrupt data fails visibly.

## Checkpoint Evidence

The completion-only checkpoint passed `nix run .#test -- all --workers 4 --jobs 4` in 621s end-to-end (includes realization): 344 core files / 2,603 tests / 12 suites, all 24 browser/terminal groups, and genuine deployment VM. Snapshot `41d2e82c97d78f9445a0441bfc01367df98bb66d173563aa77a610143bbd92ee`; evidence `/tmp/pi-web-test-source-HBpgqt/selection.json`, `/tmp/pi-web-test-core.4epsKR/run.json`, `/tmp/pi-web-test-browser.ODbhXm/run.json`, `/tmp/pwv-tNcUq9/run.json`. Independent review led to a deterministic gated response-loss fixture; its full browser rerun passed in 349s with snapshot `5ae78ce2fbca71c9923021b071e1e6f8a4bac59193325a15dd4096a922067f96`, evidence `/tmp/pi-web-test-browser.Abbl4F/run.json`. Snapshot comparison found only `e2e/activity.mjs` changed. These are checkpoint results, **not acceptance of the subsequently requested Needs you deferral extension**.

## Final Evidence

- Isolated branch `feat/activity-later`, worktree `/home/robert/projects/3rdparty/pi-web-worktrees/activity-later`, based on local `rst-main` `1fe0a04c2d6d11e0c301457e379289d3a61f1508`. Application implementation is commit `d25acbf785e028ccaf996a4e82f12d0e57e6eb28`; separately authorized fixture repair is `1b466ead474be200a431ea0650fe498fa58c89c0`.
- Independent review addressed persisted-response-loss availability recovery and forwarding the displayed request token rather than substituting a replacement question. Re-review found no remaining concrete issues. Unit guards/API tests cover stale request identity; actual browser tests cover yellow dots, question answering, cross-device/reload persistence, archived live/review states and per-completion renewal.
- Expanded application snapshot `26525f3cc4989f76bfedc5787f3e76834cf98ef8d0eb341ded41bda94568a15d`: `nix run .#test -- all --workers 2 --jobs 2`. Two/two was selected because several independent core/build/browser invocations were active, not because of read-only review. `/tmp/pi-web-test-source-7lIy58/selection.json` records admission (32 CPUs, about 51 GiB available; estimates, not reservations). All **24 browser/terminal groups / 53 scenario receipts passed**, `/tmp/pi-web-test-browser.oUepSI/run.json`, as did genuine deployment, `/tmp/pwv-MjV3Os/run.json`.
- That composed command was **not a pass**: full core stalled in unchanged `lib/terminal-manager.test.mjs` with a surviving real shell. After browser/VM settlement, the owner identity-checked and sent SIGINT only to the owned core driver. Its report `/tmp/pi-web-test-core.kbO9yT/run.json` records interrupted execution, settled Nix client and no observed survivors. Full command wall time: **1,070s**, including realization and the stall; log `/tmp/activity-later-expanded-acceptance.log`. No deadlines were inflated or assertions skipped.
- The user separately authorized investigating/repairing the fixture. A deterministic ignored-HUP case demonstrates registry-only teardown losing the expired PTY: focused `nix run .#test -- core --jobs 2 --file lib/terminal-manager.test.mjs` failed **9/10** before repair (42s, `/tmp/activity-later-terminal-red.log`, `/tmp/pi-web-test-core.K9fjQz/run.json`), then passed **10/10** after retaining the fixture's owned record for forced cleanup (72s, `/tmp/activity-later-terminal-green.log`, `/tmp/pi-web-test-core.eQqnGy/run.json`). Both runs reported zero observed survivors. Production terminal code is unchanged. This proves the cleanup flaw, not the originating case of the earlier stalled shell, which was not captured.
- Final snapshot `347d25d98aa4fd25acb6da91a8b666757994520ba446aa85952f624465d4215c` passed complete `nix run .#test -- core --jobs 4`: **344 files / 2,610 tests / 12 suites**, none failed/skipped/cancelled, requested/effective workers **4/4**, `/tmp/pi-web-test-core.UQAT0D/run.json`. Source `/tmp/pi-web-test-source-v6nesy/source`; full log `/tmp/activity-later-final-core.log`. Command wall time **262s**, including realization; core level **258.282s**, before-first-case preparation **37.830s**, case-execution span **220.099s**. Resources had freed up before this run (about 60 GiB available).
- Snapshot comparison with the successful expanded browser/VM input found **only `lib/terminal-manager.test.mjs` changed**. Complete browser/VM results therefore remain evidence for the unchanged application, not executions on the later fixture/documentation tip. Browser level wall time **874.687s**, including realization: **140.923s** before the first group and **733.588s** from first group start to last finish (including inter-group realization). Deployment level **127.334s**, with test script **37.36s**. Overlapping intervals are not added; these are acceptance timings, not performance benchmarks. Preparation/model/review/coordination are not interchangeable intervals.
- Durable behavior is documented in `README.md`, `docs/feature-internals.md`, and fixture ownership in `docs/terminal.md`. This plan's final evidence/archive change and the fixture-ownership description are documentation-only. Final input comparison verifies unchanged application/test/harness files, allowing only the reviewed `docs/terminal.md` description and plan move/evidence; admitted documentation changes are not mislabeled as earlier executions on the new tip. `git diff --check` and documentation review cover that proportional follow-up. The user selected integration after successful checks. Exact-state non-FF merge approval and separate cleanup remain owned by the harness Git lifecycle; no remote publication or host deployment is included.

## Completion Checklist

- [x] Completed Later items remain unread until Read; deferred questions remain yellow and answerable; newer completions and replacement questions are not implicitly deferred.
- [x] Archived actionable roots/subagents appear; idle history stays absent and concealed projects stay concealed.
- [x] Complete core, full browser/terminal inventory and deployment acceptance pass on the settled applicable inputs, with checkpoint/interrupted evidence distinguished above.
- [x] Feature history is committed and the user's integration intent is recorded; exact-state merge approval and separate cleanup are handed off to the harness Git lifecycle.
