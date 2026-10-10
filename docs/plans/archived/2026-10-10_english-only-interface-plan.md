# English-only interface

## Goal

Remove non-English interface language support, including the demo and push notification copy. The user explicitly chose to preserve multilingual generated session titles. User/model/tool content and code highlighting are unchanged.

## Plan Relationship

Existing session archive/search plans touched locale parity as supporting work; this bounded task owns only interface localization removal, not their session behavior. No localization ADR exists.

## Plan

- [x] Keep the English catalog/interpolation API; remove Chinese catalogs, locale detection/persistence/switching and language controls/styles in app and demo. Focused tests pass.
- [x] Make push copy English even for stored non-English subscriptions; pin demo tutorial selection to English. Persisted-subscription regression and demo tests pass.
- [x] Update maintained localization/demo guides and browser assertions while preserving title-language controls. Current contracts live in `docs/i18n.md` and `demo/README.md`.
- [x] Review the stable diff and run full offline baseline and general browser acceptance. Independent source review approved; evidence below.

## Completion Checklist

- [x] English-only regression coverage passes, including Chinese browser locales and stored Chinese preferences.
- [x] Full core/static and general browser acceptance passes; no production build was run.
- [x] Reviewed implementation is ready for a feature commit; local integration and cleanup remain separate Git-policy decisions/approvals.

## Evidence

Worktree: `/home/robert/projects/3rdparty/pi-web-worktrees/english-only`, branch `feat/english-only`, base `6e337e5681c187c13e65b87cbcc7a2cde8d3d000`.

All commands used `nix develop --offline --no-write-lock-file .#test -c`:

- Focused `node nix/test-offline.mjs --file hooks/useI18n.test.mjs --file lib/i18n/registry.test.mjs --file lib/i18n/format.test.mjs --file lib/web-push.test.mjs --file components/SettingsPanel.test.mjs --file components/SettingsUi.test.mjs --file components/MessageView.test.mjs`: 69/69 pass. Lifecycle `/tmp/pi-web-test-offline.ZB3ieWok/lifecycle.json`.
- `node --experimental-strip-types --test demo/mock/locale.test.mjs`: 2/2 pass (89 ms Node test duration). The demo is deliberately excluded from the main offline source export.
- Full `node nix/test-offline.mjs`: 269 files, 1,733 tests pass, plus exporter contracts, type generation, typecheck and lint. Command wall time 135 s, excluding outer shell entry and agent/review time. Input SHA256 `4b5828e9076d35f465fd7337845562f2b8129ae8b92dbba8d890ab8d47cdd58b`; `/tmp/pi-web-test-offline.keZFrhyU/lifecycle.json`. Subsequent executable changes are solely the browser archive-readiness sequence; application and core/static inputs remain unchanged.
- Final full `npm run test:e2e`: pass at desktop/mobile sizes with Chinese locale/preference seeding and English timestamp/control assertions. Command wall time 387 s, excluding outer shell entry and agent/review time. Input SHA256 `31827cd4e631fd047a85cd31e7ea7bfac5afbac806a31a5aadd7e091d5c5176c`; `test-results/e2e/browser-puOlZl/run.json`, `lifecycle.json`, traces and source manifest. Fixture `/tmp/pwe-a3Rorb/fixtures` retained.
- `node --check e2e/browser-suite.mjs` and `git diff --check`: pass. Final independent read-only source review approved.

### Preserved failures and correction

The first focused run imported demo files unavailable in the offline snapshot. Tests were split into app and separate demo coverage rather than changing the exporter; failure retained at `/tmp/pi-web-test-offline.fMF0tXPa/lifecycle.json`.

First full browser run failed on a 409 during the mobile archive/restore sequence (`test-results/e2e/browser-COscwW`, fixture `/tmp/pwe-wEUpOr/fixtures`). Its exact trace body was `{"error":"Branch changed"}`: restore overlapped reopening/receipt reconciliation. The test now waits for successful reconciliation against the archived snapshot before restoring, without sleeps, deadline inflation or error suppression. This sequences ordinary acceptance; it does not claim to fix production concurrent restore/startup behavior.

The second full browser run timed out because the new readiness waiter incorrectly used `context.leafId`. Exact trace inspection confirmed the API exposes top-level `leafId`; corrected the waiter and asserted returned message entry IDs. Failure retained at `test-results/e2e/browser-urwqpS`, fixture `/tmp/pwe-pyuCHQ/fixtures`. The corrected full run passed. A separate archive-focused pass (`browser-pXYssC`, 59 s; fixture `/tmp/pwe-0x5zOP/fixtures`) did not exercise this exact general-suite sequence and is not its acceptance evidence.

Settled launchers removed only their owned regenerable dependency/generated/cache bulk. Snapshots, diagnostics and fixture state remain; no historical roots were cleaned.

## Known gaps

No demo production build or separate demo browser suite was run. Inactive bilingual tutorial fixture text remains, but runtime selection is fixed to English. The independently observed archive startup/restore race is outside this localization change; browser acceptance now serializes reopening before restoration and does not establish concurrent-restore safety.
