# Persistent new sessions and browser drafts

## Goal
Explicit New actions save an empty session without a model turn, restore unsent text in the same browser, and reveal the destination chat on mobile even from an overview.

## Context
New currently creates only a temporary composer; SDK startup itself can defer its first JSONL flush. Composer drafts are memory-only. Mobile New does not close covering overviews. No active plan owns this behavior; Session Launch owns agent-created sessions, not browser New.

## Plan
- [x] Persist ordinary startup snapshots through the existing setup-only flush boundary; focused route/RPC tests verify empty creation, subsequent SDK appends and failed-write refusal.
- [x] Initialize explicit New composers (not passive project browsing), retain draft identity through asynchronous creation/navigation, and close covering overviews; focused hook/AppShell/tab regressions pass, including restrictive startup preferences and account selection waiting.
- [x] Add best-effort browser-local text draft storage, preserving memory-only images and rejected-submission/rekey behavior; focused tests pass for reload, corruption, unavailable storage and failed clears.
- [x] Extend installed-browser coverage for empty-session listing/reload, literal draft restoration and mobile cross-project New; history and Activity groups pass, and the desktop-sidecar correction/no-session Explorer chain now passes focused browser acceptance.
- [ ] Reverify the rebased composition with complete `nix run .#test -- all --workers 4 --jobs 4`; prior corrected-runtime acceptance remains recorded below, but incoming runtime/harness changes require fresh evidence.

## Non-Goals
Server/cross-device draft synchronization, persistent image attachments, automatic model turns, or session creation merely from browsing a project's files.

## Rollback / Recovery
No transcript migration or new model-context entry. Reverting leaves valid SDK session files. Browser text drafts are best-effort localStorage entries, never sent automatically; unavailable/quota-limited storage retains in-page text. Failed initialization retains the composer/draft and reports the failure rather than claiming persistence. Empty saved sessions use ordinary deletion/archive controls.

## Evidence and review

- Initial focused core attempt stopped at a new test's forbidden `module` variable name; corrected the fixture. Evidence: `/tmp/pi-web-test-core.K2JvRu/run.json`, `/tmp/persistent-new-sessions-focused.log`.
- Second focused attempt passed static preparation but found two test-fixture expectations: a cross-realm Error and the changed passive-only cleanup guard. Corrected both without weakening production failure handling. Evidence: `/tmp/pi-web-test-core.l64qH5/run.json`, `/tmp/persistent-new-sessions-focused-2.log`.
- Seven-file focused iteration passed 135 tests: `/tmp/pi-web-test-core.oLUit5/run.json`. Subsequent eight-file iteration passed 152 tests with static checks: `/tmp/pi-web-test-core.icE0gH/run.json`. The later account-unmount regression is additional and awaits final acceptance.
- Initial history browser group passed both desktop and 390px touch empty-session/draft/focus chains: `/tmp/pi-web-test-browser.Me0rFT/run.json`, source digest `5567ee3d10cc1ee74a3d6591c8ba2a16369c3c8b0dfcc57c2091830a77bca30e` (before review corrections).
- Initial Activity group failed only the new assertion that a closed mobile backdrop must be Playwright-hidden. Exact screenshot/trace showed the composer revealed and drawer closed; the backdrop intentionally remains mounted with opacity zero/pointer-events none. Replaced that incorrect assertion with actual drawer-open-class and pointer-events checks, retaining the ordinary timeout. Failure retained at `/tmp/pi-web-test-browser.187x82/run.json`, immutable diagnostics `/nix/store/cxl9ygszz14cs45pw13b12qy4j6d5zpq-pi-web-browser-activity-diagnostics`.
- Independent review identified startup preference hydration, account selection during creation and pending-draft reload identity. Corrections use a layout-hydrated preset ref, awaited session account mutation and synchronously saved per-tab draft IDs. Follow-up review found no remaining high-confidence bugs; its requested account-unmount regression was added. Reload recovery intentionally does not replay uncertain creation or claim an idempotent transaction; the maintained session guide owns that limitation.

- Corrected history acceptance passed at desktop/390px with restrictive presets and pending-response reload: `/tmp/pi-web-test-browser.mYuf1C/run.json`, digest `0b5573c12c8df56d4dfdb0f76ad9286405448edc1a15b0e0c968a91190f14ce9`; browser execution 39.557s, driver including preparation 116.532s (outer CLI setup not included in that driver interval).
- Corrected Activity acceptance passed all 1280/700/390px scenarios, including cross-project New from both overviews: `/tmp/pi-web-test-browser.5VVvrk/run.json`; browser execution 230.912s. These are focused iterations, not complete acceptance.
- Implementation commit: `47dd179d7e1a941eac4b7d97547dc76a0204e7fc`, based on local main `c8557e5afec41739801a756a1d8e0b496f0b316c`; dedicated branch `fix/persistent-new-sessions`, worktree `/home/robert/projects/3rdparty/pi-desk-worktrees/persistent-new-sessions`. Rebase onto main was a no-op. No remote or installed-service operation was requested.
- First complete acceptance attempt: `nix run .#test -- all --workers 4 --jobs 4`, source digest `471bf8349c7efa37871e3edefadcbde13fb8e8a2664c5b6a145237840b8643e9` (`47dd179` plus the browser-guide-only working change). Source/evidence root `/tmp/pi-web-test-source-xDJPdO`, log `/tmp/persistent-new-sessions-all.log`. Requested/effective four/four overlap was admitted with 32 CPUs/~36.9 GiB available; estimate 16 CPUs/27 GiB, not a reservation. Runtime package prerequisites were already prepared by focused runs.

- First complete attempt stopped after **346s command wall time**: core passed **429 files / 3,273 tests / 12 suites**, but `diff-context` failed waiting for Expand Git Explorer after desktop New. Exact screenshot showed the newly saved chat and an incorrectly closed Explorer, not runner contention. Retained evidence: `/tmp/pi-web-test-browser.1B7tt6/run.json`, `/tmp/pi-web-test-core.H60W9j/run.json`, diagnostics `/nix/store/aa6dfn6wiaqnn0axdjkhicjvjzbycqx6-pi-web-browser-diff-context-diagnostics`. Deployment was not run, and this is not complete acceptance.
- **Retraction/correction:** unconditional overview closing was too broad. Only mobile New should close its covering overview; desktop New must preserve mounted sidecars. The callback now gates closing by `isMobile`, with executable navigation regressions. The Explorer browser chain additionally verifies retained desktop detail, then uses a passive setup view for genuine no-session coverage (New intentionally has a saved session now). No deadlines, scenario inventory or error filters changed.

- Desktop correction passed `nix run .#test -- core --jobs 4 --file components/AppShell.workspace-memory.test.mjs` (**11 tests**, static checks included; `/tmp/pi-web-test-core.WQhxyt/run.json`) and `nix run .#test -- e2e --group diff-context` (**20.579s browser execution**; `/tmp/pi-web-test-browser.CRw5xH/run.json`). Full acceptance must now run on the corrected runtime, rather than reusing the earlier complete attempt.

## Complete acceptance before the integration-time main advance

`nix run .#test -- all --workers 4 --jobs 4` passed on implementation candidate **`cf17a88c898105e9bb115e2781f206e83d4a86cd`**, clean source digest **`d954276c7ff125c2e5dd3e0c54ad186193af3916f7650126d37bca9552258dcf`**. End-to-end command (including in-run realization) took **459s / 7m39s**, from 2026-10-23 12:06:43 to 12:14:22 +02:00. This excludes model/review/coordination time and earlier focused prerequisite preparation; it is not a cold-cache or performance comparison.

| Level | Result | Intervals and retained evidence |
| --- | --- | --- |
| Core/static/plugins | **429 files / 3,273 tests / 12 suites**, zero failed/skipped/cancelled | Driver 319.046s; before first file 57.356s (realization/export/static setup), file-execution window 261.319s. `/tmp/pi-web-test-core.agYeMD/run.json`; immutable summary `/nix/store/0vxbm5rla613rv636zplrsa1yk8asphg-pi-web-core-checks/artifacts/run-z0p5xV/summary.json`. |
| Browser/terminal | **26 groups / 59 exact scenario receipts**, all execution/coverage/settlement gates passed | Driver 377.641s; preparation until first capsule 6.596s, parallel execution window 370.928s. `/tmp/pi-web-test-browser.4VkVfx/run.json`. |
| Genuine Home Manager deployment | Activation, environment/permissions, durable HTTP write/restart and production PTY passed; clients settled, unit inactive/MainPID 0, cgroup absent and TCP refused | Total including realization 74.584s; reported driver execution 19.560s (remaining realization/setup/collection not separately timed). `/tmp/pwv-I8KJHI/run.json`, `artifacts/acceptance.json`, `artifacts/junit.xml`. |

These intervals overlap and must not be added. Core and browser requested/effective widths were **4/4**, with overlap admitted at **32 CPUs / ~36.7 GiB available RAM**, estimating **16 CPUs / 27 GiB**, not reserving them. The deployment guest retained its fixed one-vCPU/1536-MiB profile. Source export/selection: `/tmp/pi-web-test-source-gAmixf/source.json` and `selection.json`; complete command log: `/tmp/persistent-new-sessions-all-2.log`. Runtime package/dependency prerequisites were warm from the focused runs; deployment realization remained inside this command. No installed host service or real credentials were used.

### Rebase and proportional final verification

Local main advanced only by `docs/plans/2026-10-23_guided-review-notebooks-plan.md`, to **`b2730a7edec8f3f81453fab8e837ffa916b51544`**. The integrated rebase produced implementation tip **`987ec18d56493a43544babb3c5e2be353471b69a`** (commits `57659b9`, `987ec18`). Comparing the tested candidate to that tip shows exactly the one upstream documentation addition and **zero application/test/Nix input changes**. The full evidence remains bound to the original tested candidate, not relabelled as a new-tip run. The final follow-up only records/archives this evidence and is checked as a documentation-only delta.

## Integration-time main advance and resumed verification

The first merge proposal refused as stale before any Git effect. Main advanced from `b2730a7` to **`76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92`**, including the behavioral-test/harness overhaul, session-context extraction and native operation composition, not merely documentation. The next rebase completed without conflicts at **`8d039509e7746c1c9b017f13f6fee9534c40de73`**; this feature's production implementation files are unchanged. The old merge approval/evidence is not authority for this new composition. This plan is reopened until fresh complete acceptance passes.

Scope remains this feature, not the incoming overhaul or Activity-client pilot. To follow the new contributor contract, its hook tests now mount actual `useAgentSession` under StrictMode for single-flight startup, restrictive preset hydration and real unmount; narrowly retained extracted matrices explicitly disclaim React proof and join complete operation chains. Draft-store tests import fresh actual Jiti modules with real attachment validation, rather than substituted constants. Live scheduling records a reviewed F rationale for the pure storage file and a justified E hold for the broad mounted-hook graph; historical audit data is untouched. New browser positive session reads use the incoming traced-browser HTTP helper.

The delegated focused command `nix run .#test -- core --jobs 4 --file hooks/new-session-persistence.test.mjs --file lib/draft-store.test.mjs --file lib/test-design.test.mjs` passed **3 files / 25 tests**, effective workers 4, **37s** wall time. Type evidence reused; lint passed with the existing two warnings. Evidence: `/tmp/pi-web-test-core.Fdpx6o/artifacts/run-ZMzBgj`, `/tmp/persistent-new-sessions-harness-adaptation.log`; its initial failed iteration remains in `/tmp/persistent-new-sessions-harness-adaptation.failed-1.log`. Parent review confirmed the changes are test-only, with production unchanged.

## Completion Checklist
- [x] Focused tests and browser regressions pass for the feature before rebase; incoming-harness focused tests pass.
- [ ] Complete acceptance passes on the new runtime/harness composition with retained evidence.
- [ ] Updated implementation/evidence is ready for a fresh exact-state local merge proposal. Durable behavior/limitations remain owned by `docs/session-internals.md`, browser coverage by `e2e/README.md`.

The original integration/cleanup checkbox is transferred to this active session's global `git-worktrees` lifecycle and durable operation receipts, not silently treated as executed by this plan. Local main/non-FF integration still needs the tool's exact-state approval; feature cleanup has its separate gate. The implementation plan closes again only on the newly verified composition; that Git owner records the actual integration outcome in receipts and the completion report. Remote publication and installed-service deployment remain unrequested.
