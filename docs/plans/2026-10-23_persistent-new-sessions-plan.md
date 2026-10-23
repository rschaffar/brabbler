# Persistent new sessions and browser drafts

## Goal
Explicit New actions save an empty session without a model turn, restore unsent text in the same browser, and reveal the destination chat on mobile even from an overview.

## Context
New currently creates only a temporary composer; SDK startup itself can defer its first JSONL flush. Composer drafts are memory-only. Mobile New does not close covering overviews. No active plan owns this behavior; Session Launch owns agent-created sessions, not browser New.

## Plan
- [x] Persist ordinary startup snapshots through the existing setup-only flush boundary; focused route/RPC tests verify empty creation, subsequent SDK appends and failed-write refusal.
- [x] Initialize explicit New composers (not passive project browsing), retain draft identity through asynchronous creation/navigation, and close covering overviews; focused hook/AppShell/tab regressions pass, including restrictive startup preferences and account selection waiting.
- [x] Add best-effort browser-local text draft storage, preserving memory-only images and rejected-submission/rekey behavior; focused tests pass for reload, corruption, unavailable storage and failed clears.
- [ ] Extend installed-browser coverage for empty-session listing/reload, literal draft restoration and mobile cross-project New; update session contracts.
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

## Completion Checklist
- [ ] Focused tests and browser regressions pass.
- [ ] Independent review and complete acceptance pass with retained evidence.
- [ ] Changes are committed and integrated into local main by approved unsigned non-FF merge; remote operations remain unrequested.
