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
- [ ] Reassess/rebase current local target, run complete fresh `nix run .#test -- all --workers 4 --jobs 4` if resource-admitted, and record exact source/input identity, artifacts, runtime and available preparation/execution intervals.
- [ ] Resolve completion intent through the Git lifecycle and hand off the clean verified candidate for exact-state non-FF integration approval. No host deployment or remote publication.

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

## Risks and verification limits

Browser event ordering is not established by source-regex tests. Upstream quote insertion is synchronous/native while local insertion is deferred. Upstream keyboard CSS assumes different toolbar structure and must not hide this fork's Stop. Native phone keyboards, Safari/PWA and physical IME behavior cannot be certified by Chromium viewport simulation; record that gap honestly. No persistent-format migration or credential handling is needed.

## Completion Checklist

- [x] Four scoped behaviors have passing meaningful tests and independent review, with preservation contracts intact.
- [ ] Complete core/static/plugin, all browser/terminal groups and genuine Home Manager deployment VM acceptance pass on the settled candidate; failures and evidence identities are retained.
- [ ] Durable documentation owns behavior; plan is archived only after implementation/verification handoff is complete.
- [ ] Report exact feature/base IDs, test evidence, actual-device gap and retained/integrated state; integration, cleanup and deployment remain distinct.
