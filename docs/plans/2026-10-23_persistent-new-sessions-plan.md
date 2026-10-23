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
- [ ] Review the settled diff independently and run complete `nix run .#test -- all --workers 4 --jobs 4` when resource admission permits. Record exact inputs, results, timings and artifact paths.

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

## Completion Checklist
- [x] Focused tests and browser regressions pass after the desktop-sidecar correction.
- [ ] Independent review and complete acceptance pass with retained evidence.
- [ ] Changes are committed and integrated into local main by approved unsigned non-FF merge; remote operations remain unrequested.
