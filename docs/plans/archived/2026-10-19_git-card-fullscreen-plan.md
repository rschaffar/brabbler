# Git operation fullscreen review

## Goal

Provide an in-app fullscreen view for Git operation cards, with one shared sticky diff toolbar and selected-file navigation: desktop sidebar, mobile searchable drawer plus previous/next controls.

## Context

The user selected fullscreen for all Git operation cards, including details and approval controls; not browser-native fullscreen, Git Explorer or ordinary file views. Opening files never changes approval scope. Existing immutable reviews, downloads, limits, authorization, cancellation and receipt semantics remain unchanged.

## Plan Relationship

This owns the presentation follow-up to the integrated Git workflow and size-independent reviews. The Git Explorer fullscreen plan retains its independent host and remaining coverage obligations. It does not redesign questions or session-launch cards.

## Architecture

Use generic patch/review-bearing card presentation, not Git-specific logic in chat. Every current Git operation has an exact-review attachment, including metadata-only cleanup/worktree operations; unrelated text-only/session-launch cards are unchanged. Keep the same mounted card inside a native dialog that switches between inline and modal display. Escape restores inline presentation; nested readers/drawers get first refusal. Native modal isolation plus shadow-aware boundary Tab wrapping protect covered chat controls. Reuse a selected-file browser for supplied patches and paged durable reviews; keep Explorer's existing stack. Pass shared preferences to the selected renderer, retaining per-file review models. Large entries retain bounded content pages and complete exact downloads.

## Plan

- [x] Add whole-card fullscreen to the generic shell's patch/review-bearing presentations; verify focus, Escape, fixed actions and retained body identity.
- [x] Add desktop selected-file navigation and mobile searchable drawer/previous-next; verify exactly one mode selector, shared preferences, local reading state and bounded large-review pages.
- [x] Extend Git browser regressions for live, historical, no-patch, desktop/mobile and paged/error reviews without changing approval scope.
- [x] Update maintained Git review documentation and obtain independent safety review.
- [x] Run focused checks, then complete Nix core/browser/terminal/deployment acceptance; record exact inputs, command runtime and retained artifacts.

## Review and retained iteration evidence

Independent source review identified and resolved unbounded parsed-patch retention across large-review pages, an unanchored binary-marker detector, and conflicting inline presentation-role naming. Large reviews now retain only lightweight navigation positions/offsets between entry reads, not patch/context contents. Aggregate-patch errors are separate from inventory errors so a later inventory success cannot hide a failed patch or its selected-entry fallback.

- Initial focused core/static run: `nix run .#test -- core --jobs 2 --file components/BlockingCard.test.mjs --file components/GitPatchStack.test.mjs`, 11/11 tests and every static phase passed. Execution interval 37.388s; artifacts `/tmp/pi-web-test-core.3t7zTv/run.json`. Outer source `140ce8b078baf3b176c295a88bee5a933e6349f2e4737872c0e3010717b75f69`. This predates review fixes and is not final acceptance.
- First focused browser run: `nix run .#test -- e2e --group git-plugin`, failed in 114.002s total (26.253s browser execution). Metadata-only reviews automatically displayed duplicate exact-operation JSON, breaking the unchanged exact-inventory count (6 vs 5). Fixed by retaining collapsed metadata details; no assertion was relaxed. Artifacts `/tmp/pi-web-test-browser.wKKNbb/run.json`, immutable capsule `/nix/store/0fr2v1yrp256ihqmbqkyvmgk29n7hn2b-pi-web-browser-git-plugin-diagnostics`.
- Second focused browser run: same command, failed in 97.439s total (11.387s execution). New Shift+Tab containment regression found focus left the native fullscreen dialog; added explicit shadow-aware first/last focus wrapping without weakening the assertion. Screenshot/trace retained in `/nix/store/a2nspdfisg0np2iz97jqa2dcab5yzd78-pi-web-browser-git-plugin-diagnostics`, driver `/tmp/pi-web-test-browser.5KLRxQ/run.json`.

Times are command/execution observations, not model/review/coordination time. Failed runs are not acceptance or proof of an unchanged retry fix.

### Settled implementation and acceptance

Isolation: `feat/git-card-fullscreen`, worktree `/home/robert/projects/3rdparty/pi-web-worktrees/git-card-fullscreen`, starting local `rst-main` `5594e5a249c6a49b740c8a297e4d844d9a50430c`. Implementation commit: `4c84803d065d96c14896ecabedc9473f6df1a0c1` (tree `cf7c3354d3661b0105aeab25a3369df37661a79e`). Maintained behavior was handed off to `docs/git-workflow-plugin.md` and `docs/feature-internals.md`; no acceptance or deployment instructions changed.

- Focused core/static: `nix run .#test -- core --jobs 2 --file components/BlockingCard.test.mjs --file components/GitPatchStack.test.mjs --file lib/panel-focus.test.mjs`, passed all static phases and 15/15 tests in 47.681s command time. Evidence `/tmp/pi-web-test-core.SsOMa4/run.json`.
- Focused browser: `nix run .#test -- e2e --group git-plugin`, passed desktop/mobile in 181.453s command time, 90.152s capsule execution. Evidence `/tmp/pi-web-test-browser.9Dct9d/run.json`, capsule `/nix/store/hs8i3mz3ivzg4s9xhlfhx72jvqqkzgv2-pi-web-browser-git-plugin-diagnostics`. Both focused runs used source `d4ffcfc9a7b10e1776db84fa5db563ee318269144f2c0618f31f1df21edd45e5`, before the final resize fallback and page-control consolidation; not final acceptance.
- First complete acceptance: `nix run .#test -- all --workers 4 --jobs 4`, passed all 310 files / 2,431 tests / 10 suites, all 24 browser/terminal groups / 53 scenario receipts, and genuine deployment proofs in 412.177s command time. Source `87ff7fa04e8f712df63d8b4432935d45fe94986e33b474bf4f7c94594a6f2cda`. Evidence `/tmp/pi-web-test-core.XdA49n/run.json`, `/tmp/pi-web-test-browser.7SZXm6/run.json`, `/tmp/pwv-i2lHpT/run.json`. This included the mobile 390→900→390 focus regression, but preceded removing duplicate page controls from inside the drawer; page controls now appear only in the shared toolbar.
- Final-source first attempt: same complete command, stopped after 6.550s before static/application tests because the guarded inner Nix-store export reported `Source open changed: lib/session-list-scanner.ts`. Core evidence `/tmp/pi-web-test-core.qt0tFV/run.json`; browser prerequisite realization was cancelled and drained (`/tmp/pi-web-test-browser.IlC3Yx/run.json`). Original Nix log `/nix/store/s5cf6ngxhzla3rrs64apaphrygncsqdy-pi-web-core-checks.drv` and protected retained builder tree remain untouched. No permissions were broadened to inspect it. Read-only comparison found zero byte mismatches between every admitted checkout file, frozen manifest, and immutable store input; subsequent stat observations were stable. The exact metadata-change cause remains unproven. No source, exporter guard, deadline, suppression or test was changed for the retry; later success is not a code fix for this failure.

**Final complete acceptance:** `nix run .#test -- all --workers 4 --jobs 4` passed in **423.847s (7m03.847s)** on native x86_64-linux. All exporter/typegen/typecheck/lint phases, **310 files / 2,431 tests / 10 suites**, all **24 browser/terminal groups / 53 exact scenario receipts**, and genuine Home Manager deployment/HTTP/PTY/restart/shutdown proofs passed. No tests were skipped/cancelled. Admission used four core workers/four browser sandboxes; VM execution retained its existing 1-vCPU/1536-MiB profile.

| Evidence | Retained artifact |
| --- | --- |
| Final frozen source and complete matching manifest | `/tmp/pi-web-test-source-UkH6TV/source.json` |
| Core/static and settlement | `/tmp/pi-web-test-core.793Eqd/run.json` |
| All browser/terminal groups, coverage and settlement | `/tmp/pi-web-test-browser.fa8R3E/run.json` |
| Genuine deployment proofs and settlement | `/tmp/pwv-OP8XFu/run.json` |
| Complete outer command output | `/tmp/pi-web-git-card-all-final-2.log` |

Final content/mode digest: `e5e7e1db2ed982c8ec70021525139aa481d9143b9b84192e5cf5351292e6bd7b`. Every admitted checkout file still matched that accepted content/mode manifest immediately before the implementation commit. This plan's subsequent archive/evidence-only changes do not alter application, tests, dependencies or harness inputs and receive documentation/whitespace and unchanged-input checks, not relabelled earlier tests.

Command time includes Nix realization/preparation but excludes model work, review and coordination. Browser lead-in (prerequisite realization plus first-sandbox admission) was 90.361s; browser capsules spanned 245.983s. Core's complete driver interval was 300.240s, overlapping browser work. Deployment's complete interval was 81.863s, including realization; VM test-script execution was 20.59s. Do not add overlapping intervals or present these observations as a cold-cache benchmark.

Independent safety review confirmed the cache, binary-marker, ARIA, keyboard-boundary and resize-focus fixes. Browser regression assertions were retained, not weakened. Native fullscreen preserves the mounted review and fixed footer; selection-away/back preserves file reading state; nested drawer/Wide Escape and whole-card restoration emit no decisions/abort traffic. Historical cards remain read-only. Complete downloads and operation scope remain available for paged/error reviews. Explorer retains its original stacks. No installed service, remote, publication or deployment activation was touched.

## Non-Goals

New Git operations, changed authority or review storage, browser Fullscreen API, Explorer redesign, deployment, publication and remote operations.

## Completion Checklist

- [x] Agreed desktop/mobile review works without duplicate mode selectors or lost reading state.
- [x] Fullscreen/drawer Escape cannot cancel a live operation or stop the agent; historical cards remain read-only.
- [x] Required acceptance and review pass; feature history is committed as `4c84803d065d96c14896ecabedc9473f6df1a0c1`. The Git-tool lifecycle owns the separately selected local integration and cleanup; no saved plan grants that authority.
