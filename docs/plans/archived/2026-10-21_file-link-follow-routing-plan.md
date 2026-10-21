# Explicit follow-link destinations

## Goal

Make a notebook's linked reading pane explicit from its local-link hover controls: retain one-time opens, and offer an action that opens the selected target and remembers the destination for subsequent links from that document view.

User authorized implementation after diagnosis of the one-shot/persistent-route mismatch. Isolated branch `fix/file-link-follow-routing` starts at local `rst-main` `0af22d0c616836c0d50da34f33cdefa37baca328`. The separate unfinished guidance worktree remains untouched. After the repository/branch rename, the user explicitly selected the updated local `main` target rather than the older worktree's `rst-main` instructions; unsigned non-FF integration still requires its exact-state approval.

## Plan Relationship

ADR 0027 already owns explicit per-document routing and one-shot overrides. This adds a discoverable explicit opt-in, not implicit routing after ordinary opens. The authoring-guidance change and its dependency-cache mismatch investigation remain separate.

## Non-Goals

No global/chat-wide routes, automatic pane creation on ordinary clicks, historical `pi-review` reader relocation, reload persistence, server/file authority changes, dependency-pin refresh, document conversion, deployment or remote publication.

## Plan

- [x] Add an atomic model intent for open-and-follow into a valid existing or new split destination; reject absent origins, self/stale destinations and preserve dirty/save ownership, preview reuse and subsequent navigation generations. Verify focused reducer tests.
- [x] Expose Follow links only for originating file views, with explicit new right/below/existing-pane choices; label one-shot actions Right once / Below once, retain keyboard/touch/Escape and no inline spacing. Verify component contracts and real Markdown browser chain.
- [x] Regress the user's consecutive-link path, same-file range/repeated jumps, cross-file pane reuse and per-document independence; retain all existing scenario inventory/deadlines.
- [x] Update maintained feature documentation, independently review safety, and run complete resource-admitted Nix acceptance after focused checks settle. Record exact candidate, commands/results/artifacts and separate timing intervals.
- [x] Resolve completion intent, rebase/reverify as needed, and use exact-state unsigned non-FF integration approval; cleanup remains separately approved.

## Evidence so far

- Focused Nix core command: `nix run .#test -- core --jobs 4 --file lib/file-workspace.test.mjs --file components/MarkdownBody.test.mjs --file components/FileViewer.test.mjs --file lib/file-link-popover.test.mjs`; 4 files / 60 tests passed, 78 seconds end-to-end including realization. Coordinator `/tmp/pi-desk-follow-core.TUCGxv`; runner `/tmp/pi-web-test-core.rBMToi/run.json`. Requested/effective core workers 4/4. The Nix-runner interval was 70.5 seconds; body/static preparation before the first test was 66.2 seconds, followed by a 1.4-second test interval (overlapping file work, not summed case durations).
- First focused packaged Markdown run failed in a new assertion that matched lowercase `preview` against the established translated `Preview` tab suffix. Exact failure screenshot showed the correct reused preview and highlighted source. Corrected the selector, not application behavior; retained `/tmp/pi-desk-follow-markdown.yC5eZ6` (163 seconds).
- Corrected focused `nix run .#test -- e2e --group markdown` passed the complete existing desktop/mobile chain, including new right/existing-pane following and one-shot regressions: `/tmp/pi-desk-follow-markdown-label.189lGW`, `/tmp/pi-web-test-browser.qlwu3d/run.json` (164 seconds end-to-end; 150.147-second sandbox interval). Subsequent test-only strengthening checks the actual desktop reader viewport identity and mobile below-follow. Its first run (`/tmp/pi-desk-follow-markdown-responsive.bm8hda`, 168 seconds) wrongly assumed phone width alone requires single-pane projection; the exact failure screenshot showed both fitting stacked readers and correct line 40. The corrected test explicitly shrinks height to exercise existing-pane Follow plus Back to guide, consecutive/repeated commands and cross-file reuse in genuine projection, then restores the original viewport. The strengthened `nix run .#test -- e2e --group markdown` passed both exact desktop/mobile scenario receipts: `/tmp/pi-desk-follow-markdown-projection.eD7ct4`, `/tmp/pi-web-test-browser.7xvk4w/run.json`. End-to-end command 301 seconds including realization/export; browser runner 276.3 seconds, with 12.7 seconds before the 263.126-second sandbox interval. Requested/effective browser width 1/1 (focused default), 2 CPUs / 4 GiB admission; native x86_64 Linux, Node 24.21.0, installed Nix package and pinned Chromium. Other sessions were concurrently accepting their changes, so this is not a machine-exclusive timing comparison. Pinned source `/nix/store/y45fpc8k5gckz8b6vg5hjq5jzgcdcw1h-source`, digest `42d6068e24d264ad9b5eb1b4a46fe060bd8459836d08917a21e99297cf57d72b`. All nine changed application/test files were byte-compared with this source before committing; subsequent changes only refine maintained documentation wording and record plan status. Neither earlier run is claimed for these later test inputs.
- Independent read-only model/UI review found no concrete regression in origin-only routing, atomic open/save protection, split capacity, captured context or one-shot/focus semantics. No checks were delegated.
- Maintained behavior is in `docs/feature-internals.md`; reader workflow is in `docs/review-notebooks.md`. No dependency pin, deployment, remote operation or parked guidance work was changed.

## Rebased acceptance

- After the user requested merge preparation, cleanly rebased `ca20003f6d8b65ab83a2b6c5999b26242da5b9ab` onto current local `main` `c9ab433a542b44de1d22bde07afe026c2815f4ba`. Tested candidate: `45e0929671fb864f7fccc417c9b819dfa9df1740`. `git range-diff` reports the identical feature patch; existing independent review remains applicable.
- Launched `nix run .#test -- all --workers 4 --jobs 4` only after rebase/source/review settled and no other acceptance coordinators were observed. Native x86_64 Linux: 32 CPUs, approximately 40 GiB available memory. Requested/effective core and browser widths 4/4; overlap admission estimated 16 CPUs / 27 GiB including realization, not a reservation.
- Core/static/plugin checks passed **398 files / 2,987 tests / 12 suites**, none skipped/cancelled. All **26 browser/terminal groups** passed. Core `/tmp/pi-web-test-core.5yxunf/run.json`: 388.4-second runner interval, 43.9 seconds before first test, 344.1-second test interval. Browser `/tmp/pi-web-test-browser.m9cAvX/run.json`: 441.9-second runner interval, 91.9 seconds before first capsule, 349.8-second capsule interval. These overlapped and are not additive.
- The Pi Desk restart interrupted VM prerequisite image construction, not application execution. Preserve failed/interrupted `/tmp/pwv-cp4cIb/run.json`; the original all-command did not complete successfully, and its shell coordinator did not retain a final wall-time record. No source changed, and no application fix or continuous all-command pass is claimed.
- After restart/continue, ran only `nix run .#test -- service`: **passed** activation, environment/permissions, durable HTTP writes/restart, production PTY and shutdown/collection/settlement proofs. Coordinator `/tmp/pi-desk-follow-service-resume.WHFAl7`, VM `/tmp/pwv-E2w1XU/run.json`: **82 seconds end-to-end** including realization/export, 78.4-second runner interval, 25.21-second VM test-script interval / 24.019-second deployment evidence interval. Preparation was not separately timestamped. Guest execution retained the fixed 1-vCPU / 1536-MiB / 2-GiB profile.
- All three successful levels use identical store source `/nix/store/8f5zcqy63sd1xfqc46y8c52bm25q9g9f-source`, export digest `45d1a6cc655921d502546306f8c6997d19d490856dae56ff12f4a5d113339303`. Original export `/tmp/pi-web-test-source-gSuCaT/source`, resumed export `/tmp/pi-web-test-source-TAxm1B/source`. Together they complete the required acceptance matrix for `45e0929`; core/browser were not needlessly rerun after the external interruption.
- Coordinator, admission, exact candidate and retained evidence: `/tmp/pi-desk-follow-acceptance.S37BxP/evidence.md`. This follow-up changes only plan status/evidence, not tested application or test inputs; it needs documentation/diff review rather than another full application run.

## Current handoff

Integrated into local `main` by approved unsigned non-FF merge `581fd63b21e7595b5d239af1010dfba9f0d80180`, with verified parents `c9ab433a542b44de1d22bde07afe026c2815f4ba` and `75fc2d6690a790a24b3e3d40cb49bad1d6b4cfbd` and exact accepted tree `159586763946589123260e08e9ad6d2f08d680cb`. Primary checkout was clean after integration; author email `robert@projektbuero.at`, no signature header. This documentation-only follow-up archives the completed plan; maintained mechanisms remain in the feature/notebook guides. Feature cleanup still needs its separate approval. No remote publication or host-service deployment occurred; the separate authoring-guidance work is untouched.

## Completion Checklist

- [x] One-time opening remains one-time; Follow opens the first target and binds only the source document's later links, reflected in Links destination controls.
- [x] Existing readers, navigation/highlighting, dirty/save protection, responsive return behavior and authorization remain intact with regression evidence.
- [x] Focused checks, independent review, full core/browser/terminal/VM acceptance and maintained-document handoff are recorded honestly.
