# Composer, focus and mobile keyboard reliability

## Goal

Implement the user's approved four-behavior batch after the read-only assessment: Ask-here caret cleanup (`bc762a3e`), guarded desktop New focus (`12b157df`), mobile streaming action-row layout (`628d6ac7`), and model filtering above the keyboard (`cc041d8e`). Preserve exact prompts, drafts, native list undo/IME, mentions, deferred sends, Stop, pending cards, source-entry IDs, account/model identity and modal/portal ownership.

## Context

- Authorized in this session by “makes sense. implement. ask questions about decisions you may need”. No remote publication, live-provider use or installed-host deployment/probing is authorized.
- Base local `rst-main`: `1fe0a04c2d6d11e0c301457e379289d3a61f1508`; branch `fix/composer-keyboard-focus`, linked worktree `/home/robert/projects/3rdparty/pi-web-worktrees/composer-keyboard-focus`.
- Cached upstream: `/tmp/pi-web-upstream-review.KEkJjU/repo.git`, `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`. Parent is sole writer/test coordinator; independent reviewers are read-only.
- CodeGraph initialized successfully in this worktree. SDK 1.3.0, Node 24.21.0, Next 16.4.2 and Nix/dependency pins remain unchanged.

## Plan Relationship

The archived 2026-10-20 easy-wins, security-boundaries and upstream-followups plans own completed batches `6bc2c3f`, `8e6735a`, `1fe0a04`. Do not redo mobile model-filter autofocus or Markdown list continuation. Existing session/account/question/Explorer plans retain their contracts; no active plan owns these four behaviors. This plan ends at verified completion handoff; Git lifecycle receipts own actual integration and separately approved cleanup.

## Architecture and UI choices

- Quote cleanup preserves local asynchronous insertion; do not import unrelated upstream native mention-undo machinery (`012e805c`). The caret follows inserted text, not an arbitrary move to the entire draft's end.
- Explicit desktop New requests focus once on the intended fresh composer. Mobile, modal/native-dialog ownership, covered/inert chat and deliberate intervening focus win. Do not add general mount/update autofocus.
- Streaming mobile drafts stack above existing labeled steer/follow-up actions; idle and desktop layouts stay unchanged. Stop stays outside More.
- Port picker geometry/remeasurement and selective `390e70fd` zoom/IME/late-settling prerequisites. Do not port keyboard-driven toolbar/status hiding or redesign the native mobile toolbar. Keep the picker in its existing DOM ownership.

## Plan

- [x] Implement quote cleanup and mobile action-row behavior in root/demo; add meaningful core and real browser caret/geometry regressions.
- [x] Implement identity-bound desktop New focus and pure composer focus handle; verify restored drafts, mobile exclusion, modal/control/card focus races and superseded navigation.
- [x] Adapt picker positioning/remeasurement and viewport settling; test zoom, IME, late changes, event/timer teardown and short-screen bounds without changing model/account selections.
- [x] Update owning session/model/feature guides and browser documentation; obtain independent safety review and resolve findings.
- [x] Run focused Nix core/static and packaged desktop/mobile browser checks, preserving failures and exact evidence.
- [x] Reassess/rebase current local target, run complete fresh `nix run .#test -- all --workers 4 --jobs 4` if resource-admitted, and record exact source/input identity, artifacts, runtime and available preparation/execution intervals.
- [x] Resolve completion intent through the Git lifecycle and hand off the clean verified candidate for exact-state non-FF integration approval. No host deployment or remote publication.

## Focused evidence and scope correction

- First focused core/static invocation failed in 84s because a new core test tried to read independent demo files, which are deliberately excluded from the Nix application exporter. Core tests now explicitly target the maintained app; demo parity is reviewed separately. Original `/tmp/pi-web-composer-core.qXKY9G.log`, `/tmp/pi-web-test-core.oxgI7b/run.json`; no application assertion was relaxed.
- Corrected focused `core --jobs 4` selection passed 7 files / 92 tests plus exporter/typegen/typecheck/lint in 80s command wall time, overlapping the one-worker history preparation: `/tmp/pi-web-composer-core.j0ehZh.log`, `/tmp/pi-web-test-core.d3Ouky/run.json`.
- Packaged `e2e --group history` passed desktop/mobile New focus, literal parked drafts, Settings focus ownership, model filter shrink/pan/no-event IME and existing list undo/IME/draft chains: 194s command wall time including package realization, 55.356s capsule execution; `/tmp/pi-web-composer-browser.qEcfU4/history.log`, `/tmp/pi-web-test-browser.3kRp4m/run.json`. This predates the later Stop change.
- The combined focused shell had a 240s outer tool limit, which interrupted outer reporting for its second (running-forks) invocation. Do not treat its outer `status: running` as settled success: `/tmp/pi-web-test-browser.aOf33r/run.json`. The Nix capsule independently retained its completed failing diagnostic at `/nix/store/cyshxkmanfhcb0r5k2wnhl4416r6g8d5-pi-web-browser-running-forks-diagnostics/result.json` (40.314s). Trace/screenshot show that programmatic transcript selection cleared document ranges while the textarea still had focus, resetting the fixture's intended insertion point. The fixture now blurs before transcript selection, retaining exact text/replacement/caret/typing assertions.
- Corrected quote setup passed desktop exact caret/text and original-fork/card preservation. Mobile then failed the new visible-Stop assertion because Stop was already inside More in the base fork, contrary to the assessment's assumption: 23s command, `/tmp/pi-web-composer-forks.kgDskR.log`, `/tmp/pi-web-test-browser.Mfu7Ym/run.json` (13.897s capsule).
- **Retraction and explicit UI decision:** Stop was not already outside mobile More. After the observed failure, user chose **Show Stop directly** through `ask_user`. Root/demo now render a shared Stop button outside the mobile More owner, with desktop placement and abort semantics retained. The separate owner prevents More's same-row popover from occluding Stop. This is an authorized small scope addition, not a claim the action-row port introduced the old limitation.

### Settled focused candidate

- Latest focused core/static selection passed **7 files / 92 tests**, 152s command wall time including realization/static preparation, with concurrent focused browser preparation: `/tmp/pi-web-composer-core.WRz7V0.log`, `/tmp/pi-web-test-core.ZEmoZJ/run.json`.
- Updated packaged running-forks passed both desktop/mobile exact quote insertion/replacement/suffix/caret/typing, action-row width, mobile Stop visibility with keyboard and More open, original pending-card/source-ID preservation, and a separate genuine Stop/abort settlement chain. **283s command**, including production package realization; **33.712s** capsule execution: `/tmp/pi-web-composer-browser.bS4DIx/running-forks.log`, `/tmp/pi-web-test-browser.LvOb9T/run.json`.
- Latest packaged history passed desktop/mobile New/restored-literal-draft focus, Settings and real native-dialog ownership, picker keyboard simulation and pre-existing list/undo/IME/draft/history/compaction chains. **91s command**, **73.710s** capsule execution: `/tmp/pi-web-composer-browser.bS4DIx/history.log`, `/tmp/pi-web-test-browser.DBAMQw/run.json`.
- Independent read-only design review identified the same mobile Stop limitation; a second reviewer enumerated the actual tracked/untracked diff and found **no remaining blockers** after its correction. Source-only review does not certify physical devices. Root/demo parity was reviewed; the standalone demo is outside the maintained app's Nix acceptance/export.
- Local manifest/lock/Nix pins are unchanged; `git diff --check` passed. Existing unrelated ref-cleanup lint warnings remain warnings.
- **Acceptance coordination:** another task's two/two full run and focused activity run were observed. User chose **Wait, then run four/four** through `ask_user`. Do not reduce this batch's normal complete-acceptance width or touch the other task's processes/resources. Source writers remain paused during every export.

### Rebase and complete-acceptance iteration

- The coordinated peer runs finished before our full launch. Local target advanced to Activity Later merge `ef90c809970aebf4c412d340a67d9918a10eb1dc`; guarded rebase produced `61a837ab65a915e45a4a15444cae769609a916f5`. Range-diff confirms the feature patch is unchanged from `cdf717a9c26349042d4ea5df47a6b8f2afe5ba09`. Incoming Activity/terminal teardown changes are preserved.
- First `nix run .#test -- all --workers 4 --jobs 4` on `61a837a` failed in **179s end-to-end**, including in-command realization: `/tmp/pi-web-composer-all.JkLhov.log`, core `/tmp/pi-web-test-core.Yb7INA/run.json`, browser `/tmp/pi-web-test-browser.tSJjrV/run.json`. Admission had 32 logical CPUs/about 56 GiB available, with peer acceptance no longer active. Core stopped on two old `MobilePwaLayout.test.mjs` source-shape contracts: direct `requestAnimationFrame(update)` and compact-only textarea flex. The replacement assertions require the actual frame-clearing/update callback and capability-aware stacked layout, retaining the viewport-width invariant. Behavioral viewport/layout regressions remain unchanged. The runner cancelled/drained browser peers; no full browser/deployment pass is claimed from this run.

- Corrected layout contracts passed focused `core --jobs 4 --file components/MobilePwaLayout.test.mjs --file components/ChatInput.test.mjs --file hooks/useViewportHeight.test.mjs`: **3 files / 47 tests** plus static checks, **43s command wall time**; `/tmp/pi-web-composer-layout-core.MxVgzu.log`, `/tmp/pi-web-test-core.IEEltC/run.json`. No application inputs changed after `61a837a`.

## Complete acceptance and integration handoff

- Tested candidate **`c507c905e23d8b8dc75b401642ff949febce4e78`**, rebased onto clean local `rst-main` **`ef90c809970aebf4c412d340a67d9918a10eb1dc`**. Final archival changes are evidence/status-only, not a new application/test run.
- **`nix run .#test -- all --workers 4 --jobs 4` passed**, **752 seconds end-to-end command wall time**, including in-command realization, excluding model/review/coordination and the user's chosen wait. Native x86_64 Linux; 32 logical CPUs and about **57 GiB available** at admission. Requested/effective widths were **four browser sandboxes / four core workers**, overlapping with the conservative **16 CPU / 27 GiB** admission estimate, not reservations or machine-exclusive measurement. No additional prewarming was performed for this invocation; prerequisites had been realized during recorded iterations. All executions were fresh. This is not a cold-cache or performance benchmark.
- Full log: `/tmp/pi-web-composer-all.IzPtxI.log`; verified snapshot `/tmp/pi-web-test-source-WlV3iS`; outer content/mode SHA256 **`d0089210cb60202c1f13ebbe57a82d40e8dd9650368ad9ec0556868119e1753d`**; selection `/tmp/pi-web-test-source-WlV3iS/selection.json`.
- **Core/static/plugin:** **347 files / 2,619 tests / 12 suites**, all passed, none failed/skipped/cancelled/not-started, no observed surviving owned processes or uncertain settlement. `/tmp/pi-web-test-core.nGj3CT/run.json`; immutable output `/nix/store/lrnrddsln7wr0iyj44x55gy2ady3snwi-pi-web-core-checks`. Inclusive level interval **710.950s**, pre-first-file realization/static interval **52.851s**, file-execution window **655.871s**. Core filtered source digest `e2d4f5412f3ac3464e04679a934e2d69b1331f6ff418aecc34cc4de82be25b14`.
- **Browser/terminal:** all **24 groups / 53 exact expected/completed scenario receipts** passed, collected artifacts and settled execution/closed ports. `/tmp/pi-web-test-browser.pzmZYc/run.json`. Inclusive browser-driver interval **574.359s**, pre-first-capsule interval **7.314s**, inner-capsule timestamp span **566.490s**. Includes the new desktop/mobile/native-dialog focus, quote suffix/selection/caret/typing, model keyboard simulation, visible Stop/More and actual abort checks, plus the entire existing inventory.
- **Genuine Home Manager deployment:** `/tmp/pwv-glfVCD/run.json` passed activation/default-target startup, environment/permissions, durable HTTP write/restart, genuine HTTP PTY, collection/probe and client/service settlement. Inclusive service interval **167.066s**, evidence interval **27.389s**; the difference is not an independently measured build phase. Final service inactive/dead, MainPID zero, authenticated cgroup absent, TCP port refused. Same production package as browsers: `/nix/store/wydb8sk6166f77xxl81fnm9r9zc0ai6y-pi-web-0.9.3`.
- Overlapping level intervals must not be added to the command runtime. Historical failed/focused evidence above remains distinct; no retry was unchanged, no deadline increased, no inventory omitted and no console/HTTP error class suppressed.
- Independent actual-diff review found no remaining blockers; the subsequent test-only source-contract correction retains original invariants and has focused plus complete passing evidence. Root/demo source parity was reviewed; no standalone-demo build or physical-device verification is claimed.
- User chose **Integrate into local rst-main** via `ask_user` after complete acceptance. This archive records the completed implementation/verification handoff; the Git lifecycle owns exact-state unsigned non-FF merge approval/execution and separately approved cleanup. Its durable receipts, not this archive, own actual outcomes. No installed-host probing/activation, live-provider operation or remote publication was performed or authorized.

## Refreshed integration candidate after target advancement

- The first merge proposal for feature `35c5301034e5d51988c7faac70e597023ecbb211` into target `ef90c809970aebf4c412d340a67d9918a10eb1dc` was refused as stale **before any Git effect**. A concurrent approved local integration advanced `rst-main` to **`2da68ce2da0586ca2a5150e0df32e1ebfb66ed0b`**, adding validated append-tail session-list scanning and its tests/docs. No stale approval was reused or automatic merge retry performed.
- User explicitly chose **Rebase and reverify, then request fresh merge approval** through `ask_user`. Guarded rebase completed cleanly at **`b411f713ff41a84cfcc46c6f8c1fdc7c6c33eed4`**. Range-diff confirms all three feature patches are unchanged; incoming scanner behavior/docs are preserved.
- Fresh complete **`nix run .#test -- all --workers 4 --jobs 4` passed on `b411f71`**, **417s command wall time**, including in-command realization but excluding user wait/model work. Requested/effective widths remain **four/four**, with 32 logical CPUs/about **54 GiB available** at admission, conservative overlapping estimate **16 CPU / 27 GiB**. No additional prewarming; all executions fresh. This is not a comparison benchmark against the older 752s run.
- Log `/tmp/pi-web-composer-rebased-all.SEBCNX.log`; snapshot `/tmp/pi-web-test-source-8nuhEF`; outer content/mode digest **`d8993ae49ef5f9613ad5542943af4dbaa4877b246dfae042a9b4a08b1cf05889`**; selection `/tmp/pi-web-test-source-8nuhEF/selection.json`.
- **Core/static/plugin:** **348 files / 2,634 tests / 12 suites**, all passed, none skipped/cancelled/not-started and no uncertain settlement/observed owned survivors. `/tmp/pi-web-test-core.6KkOhq/run.json`; output `/nix/store/wxm02j9rhv29fmw7lwxskqn0rn67jw52-pi-web-core-checks`; filtered digest `d2a376bb6b33bce47e406b112349a0699eb0ddfa61148b7026ce803f19aa6253`. Inclusive **295.590s**, pre-first-file realization/static **36.583s**, file-execution window **258.613s**.
- **Browser/terminal:** **24 groups / 53 exact receipts**, all passed with artifacts, settled execution and closed ports: `/tmp/pi-web-test-browser.MhVVjn/run.json`. Inclusive **353.758s**, pre-first-capsule preparation/realization **83.594s**, capsule span **270.047s**.
- **Genuine deployment VM:** `/tmp/pwv-oqyUss/run.json`, every activation/environment/durable-write/restart/PTY/collection/settlement proof passed. Inclusive **56.053s**, evidence **17.892s**; final inactive/dead, MainPID zero, cgroup absent and port refused. Same production package as browser: `/nix/store/qw0hd0nlyjp1ryq05pyjanbzr0zigh0h-pi-web-0.9.3`.
- Level intervals overlap and must not be summed. This supersedes the earlier target's evidence for the refreshed integration proposal without relabeling either run. Subsequent changes record only this evidence; application/test inputs remain the accepted `b411f71` candidate. Exact-state merge and separate cleanup receipts still own actual effects; no host deployment or remote operation is authorized.

## Risks and verification limits

Browser event ordering is not established by source-regex tests. Upstream quote insertion is synchronous/native while local insertion is deferred. Upstream keyboard CSS assumes different toolbar structure and must not hide this fork's Stop. Native phone keyboards, Safari/PWA and physical IME behavior cannot be certified by Chromium viewport simulation; record that gap honestly. No persistent-format migration or credential handling is needed.

## Completion Checklist

- [x] Four scoped behaviors have passing meaningful tests and independent review, with preservation contracts intact.
- [x] Complete core/static/plugin, all browser/terminal groups and genuine Home Manager deployment VM acceptance pass on the settled candidate; failures and evidence identities are retained.
- [x] Durable documentation owns behavior; plan is archived only after implementation/verification handoff is complete.
- [x] Report exact feature/base IDs, test evidence, actual-device gap and retained/integrated state; integration, cleanup and deployment remain distinct.
