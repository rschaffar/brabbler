# Durable session pause (continuation-message variant)

## Goal

Add Activity Pause → Pausing… → Resume for main sessions, Pause for subsessions, and global Pause all / Resume all. Persist pause information across server restarts. Resume sends an explicit continuation message to the main session with saved waiting-card context and paused child information; it does not restore an old execution.

## Context

User decisions, 2026-10-21:

- Finish the current assistant response/tool batch rather than killing tools. Long-running tools can keep Pausing indefinitely.
- Parent Pause includes nested subsessions. Individual subsessions can be paused, but have no direct Resume button. The main session receives their IDs/tasks/available partial results so it can decide what to do.
- All buttons apply globally, including concealed projects, independent of Activity filters.
- **Retraction:** the initially selected faithful SDK checkpoint design was dropped after explaining its size. The user explicitly selected the simpler continuation-message variant. No SDK patch, arbitrary suspended-tool restoration or faithful queue-schedule restoration is required. Accepted late inputs still need durable full-envelope context.
- Explicit Pause may cancel pending question/approval cards, preserving their contents so the main session can ask again after Resume. Old approvals never grant permission. This replaces exact live-card recovery after restart.

Discovery: SDK `finishTurn` is awaited after tool results; returning end alone is insufficient because AgentSession can continue its outer loop. Calling public `session.abort()` without awaiting inside that boundary sets its cancellation flag synchronously; the boundary must return before abort can settle. Accepted queued messages should drain before stopping to avoid losing images or other envelopes; new browser prompts/steering are refused during pause. Existing foreground child waits finish with a paused partial result rather than remaining suspended.

## Plan Relationship

Extends Activity and existing session/subagent lifecycle. Completed receipts, Activity Read/Later and Session Launch retain their separate contracts. Question/receipt plans still own format/history; this plan owns explicit-Pause cancellation/context handoff, not exact pending-card restoration. Unknown arbitrary effects after an unprepared restart remain interrupted, never replayed.

## Plan

- [x] Investigate wrapper/Activity/subagent/question/restart paths and pinned SDK boundaries; resolve user-selected semantics.
- [x] Prove cooperative stop after a full tool batch through public SDK APIs, with queue-drain, cancellation and no-next-request regressions using synthetic providers.
- [x] Add private versioned durable pause records, exact-generation transitions, cold-start uncertainty and idempotent resume admission; test malformed storage and process restart.
- [x] Integrate wrapper pause requests, pending-card context capture/cancellation, prompt admission refusal and completion suppression; publish Paused only after settlement and persistence.
- [x] Integrate child pause/queued cancellation, retained worktrees and partial-output reporting; do not wake paused parents from background notifications or allow new children from a pausing parent. Children whose accepted creation finishes during Pause inherit it even in a full queue.
- [x] Add validated per-session/global controls, family expansion and a literal main-session continuation message with child/context information; refuse direct subsession Resume and prevent duplicate submissions.
- [x] Add Activity paused/pausing states and per-row/global controls using the existing poll. Focused packaged browser coverage passed at desktop/tablet/mobile widths; final-source full acceptance remains below.
- [x] Update owning session/feature/question guides and run independent safety review. Material queue-admission, persistence, child-settlement and branch-deduplication findings were corrected; final targeted source review found no further material issue. Review is not execution sign-off.
- [x] Run complete sandboxed acceptance after freezing source: `nix run .#test -- all --workers 4 --jobs 4`. Attempt 2 passed every level; identities, actual widths, intervals and artifacts are below.
- [x] Commit coherent reviewed changes and record the user's selection to prepare local integration into `rst-main`. Hand off the remaining exact-state unsigned non-FF approval/execution to the global `git-worktrees` lifecycle under the Project Git Profile; this implementation plan does not authorize or claim integration, deployment, publication or cleanup.

## Architecture

Pause intent and captured UI context live in owner-private Pi Web metadata, bound to canonical session IDs, not copied actionable transcript history. Pausing survives as intent, but process loss before settlement cannot become a certified safe pause. Main-session Resume is an explicit new prompt, not re-execution of the original task/tool. Saved child records and transcripts remain inspectable; a child result marked paused is incomplete, not successful completion. Preserve worktrees and partial text. Queued input drains before stopping; if late steering lands after its old run became idle, save its complete text/image envelope as explicitly undelivered context before clearing queues. Snapshot/write/clear is synchronous and supports one-at-a-time modes without text-only reconstruction. Persistence failure remains visibly unconfirmed, never falsely Paused. SDK preflight disposition reclassifies queue versus initial-run ownership; admitted initial requests must not deadlock behind asynchronous steering hooks.

Pending cards cancel on explicit Pause after their exact payload is saved. No active question or approval Promise is restored after restart. The continuation explains what was waiting and instructs fresh questions/validation. Custom TUI output is context only, never serialized executable state. A stopped tool batch cannot auto-continue via SDK retries, before-settle extensions or background notifications.

## Non-Goals

Exact SDK execution/queue restoration; suspended JavaScript/OS processes; automatically restarting subsessions; direct child Resume buttons; retroactive recovery of already-lost cards; automatic startup continuation; replay of interrupted tools or unknown effects; historical approval authority; deployment or remote publication.

## Rollback / Recovery

New records are additive, private and versioned. Retain them on rollback; unknown versions fail visibly. Never rewrite transcripts to fabricate tool results, reconstruct permissions or delete old receipts/reviews. If restart interrupts Pausing or a Resume submission, expose uncertainty and reconcile saved history rather than auto-retrying. No host-service restart for acceptance; use isolated synthetic fixtures and the deployment guest.

## Completion Checklist

- [x] The requested controls work for main/subsessions with global scope and survive restart.
- [x] No next model request follows a settled pause; accepted queue contents are not discarded; pending cards are saved before cancellation.
- [x] Main Resume is one explicit continuation prompt containing useful paused-child/context information; children have no direct Resume and old permissions are never reused.
- [x] Paused child worktrees/partial output remain available, and pause creates no false completion/acknowledgement or completion sound.
- [x] Core/static/plugin, full browser/terminal and genuine deployment acceptance pass, with material review findings resolved.
- [x] Maintained documentation, tested identities and Git/resource status accurately describe the delivered implementation handoff.

## Workspace

`/home/robert/projects/3rdparty/pi-web-worktrees/durable-session-pause`, branch `feat/durable-session-pause`, based on local `rst-main` `6a3675e64ecb2140b755b605b7ac69b2dfbd73f4`. Worktree-local `codegraph init` succeeded. The primary checkout was clean at initial inspection. Implementation is present in this feature branch; no integration, deployment, publication or cleanup yet. Local `rst-main` has subsequently advanced to `176441bf446afc6d5aa95d3fc6f8aa77520ef8f6`; the user selected integration preparation and the rebase below completed. Exact-state merge approval/execution remains with the global Git lifecycle at this implementation handoff.

## Iteration evidence (not complete acceptance)

Synthetic providers only; all application checks execute in isolated Nix environments. Exact source identities/selections are retained in each run's source manifests and logs. Earlier passing snapshots are not claims about the latest source.

| Run | Result / command scope | Command wall time | Retained evidence |
| --- | --- | --- | --- |
| Focused core 7 / 8 | Eight selected files, 166 / 167 passed | 57s / 75s | `/tmp/pi-web-pause-focused-7.log`, `/tmp/pi-web-test-core.tcheAW`; `/tmp/pi-web-pause-focused-8.log`, `/tmp/pi-web-test-core.AIEorc` |
| Packaged Activity 1 | Activity group, widths 1280/700/390; native card cancellation, batch drain, literal main Resume, child controls and concealed global scope passed | 386s | `/tmp/pi-web-pause-activity-1.log`, `/tmp/pi-web-test-browser.VabVss`; source `ae1f29713a01552dbffd7dd3c026e3da5cb4d28b9e36102c5ad8a41e806a7bee` |
| Deployment 1 / 2 | Failed synthetic provider admission; generated `.mjs` extension was not discovered by SDK 1.3. Corrected to `.js`, without weakening assertions | See original logs | `/tmp/pi-web-pause-service-1.log`, `/tmp/pwv-DcGd7B`; `/tmp/pi-web-pause-service-2.log`, `/tmp/pwv-gC3G0V` |
| Deployment 3 | Genuine guest restart passed: native question → Pause → restart/no automatic continuation → explicit Resume with saved context | 221s | `/tmp/pi-web-pause-service-3.log`, `/tmp/pwv-lmxPxw`; source `c0327f46c7bca675805ea2b16412674dd90e676593b9b13c888111afa5933f55` |
| Focused core 9 | Static checks passed; newly expanded native file hung. Stopped the exact owned driver with SIGINT; failed/interrupted, settled CLI, no observed survivors | 230s | `/tmp/pi-web-pause-focused-9.log`, `/tmp/pi-web-test-core.FgqjZX/run.json` |
| Focused core 10 | New bounded synthetic cases exposed two async-input deadlocks (28 passed, 2 cancelled). Fixed unconditional admission waiting; no timeout inflation | 71s | `/tmp/pi-web-pause-focused-10.log`; failed Nix derivation retains original TAP |
| Focused core 11 | Native pause/subagent files, 53 passed; includes branch re-handoff and late child settlement regressions | 57s | `/tmp/pi-web-pause-focused-11.log`, `/tmp/pi-web-test-core.Bh8R4Q`; source `f057eb1f11e9398d1a1d0fa532604fe0dc55f08fa8d025a6384f40f2870580c4` |
| Focused core 12 / 13 | Eight files, 173/174 passed in each; new queued-creation fixture used the wrong parent-context and faux-counter APIs. Corrected to the real parent SDK session and `faux.state.callCount`; actual queued-inheritance assertions passed in 13 | 55s / 53s | `/tmp/pi-web-pause-focused-12.log`, `/tmp/pi-web-test-core.nroPWU`; `/tmp/pi-web-pause-focused-13.log`, `/tmp/pi-web-test-core.EFJaE9` |
| Focused core 14 | Eight files, all 175 passed; typegen/typecheck/lint passed, no skipped/cancelled cases or observed survivors | 55s | `/tmp/pi-web-pause-focused-14.log`, `/tmp/pi-web-test-core.PqgSBe`; source `b6bf384ef6adf5f23562b57528c37e83fbc7bed22cea2940dcb1f2876686ac46` |
| Focused core 15 | Prior eight files plus sidebar, all 200 passed after the full-run sidebar correction; static checks passed | 54.935s | `/tmp/pi-web-pause-focused-15.log`, `/tmp/pi-web-test-core.9dJfeU`; source `46b5b5ff59b1c9121ffcac5a572d6dfcd83c81e753bfa8c91768e7714d9824e2` |

Latest source also includes live cold-Resume claims in Pause all, before any RPC wrapper exists; an active claim is not mislabelled as a restart interruption. A regression verifies superseding that setup without a model request. Its backend regressions passed focused core 14; the subsequent rebased sidebar follow-up passed focused core 15. Frozen-source complete acceptance subsequently passed attempt 2 below. Focused jobs=2 were iteration budgets, not a selected full-acceptance width. Final acceptance must record separate preparation/execution intervals and explicit requested/effective widths. No historical roots or failed evidence were removed.

## Integration preparation and complete acceptance

The user selected preparation for local `rst-main` integration, not merge/deployment/publication approval. Feature commit `2c9b124226dc5c4872d793455ae2e5b6aed66064` rebased cleanly onto `176441bf446afc6d5aa95d3fc6f8aa77520ef8f6` as `1df4a1897b75ace99e79fdb0f6726aecf1d4aa57`; range-diff changed only an AppShell import-context hunk from the target's independent media feature.

Complete attempt 1: `nix run .#test -- all --workers 4 --jobs 4`, source `670c6bcc8acdfdc12595d6008d2478dd27d0d45890112f0cd128ea10cfe69156`, candidate `1df4a1897b75ace99e79fdb0f6726aecf1d4aa57`, **failed in 161.274s**. Four/four overlap was admitted at 32 CPUs/about 39 GiB available (estimated aggregate 16 CPUs/27 GiB, not reservations). Core passed 80 files and failed one (860/861 cases passed); 298 files were not started. The sidebar's structural contract still expected the old five-argument Activity callback. Browser execution was interrupted/awaited by the peer-failure gate; deployment did not start. This is not browser failure evidence or complete coverage.

Retained: `/tmp/pi-web-pause-all-1.log`, `/tmp/pi-web-test-source-WRR89m/selection.json`, `/tmp/pi-web-test-core.OEbMCl`, `/tmp/pi-web-test-browser.XHglLR`. The failed run exposed a related guard omission: pausing a later run could notify against an older unread completion. The follow-up preserves ordinary notification eligibility, explicitly excludes paused session IDs, and updates/extends the sidebar regression rather than weakening sound assertions. Complete acceptance required a rerun on the changed candidate.

### Complete attempt 2 — passed

- Candidate: `561c9158d112eb3f472fea6542bd64edce17bcb9` (tree `2bc59dd24c28159e6a3fd9ac0fad15d685810d5b`), still based on current local target `176441bf446afc6d5aa95d3fc6f8aa77520ef8f6`.
- Command: `nix run .#test -- all --workers 4 --jobs 4`; outer source digest `bb6a9503b29e4f07a426b410e49de08834c97d63ac18da91ffd26bee4a0304bc`; exit 0 in **526.667s (8m46.7s)**, including in-run realization/export. Shared tool prerequisites were warm from iteration; no separate changed-application prewarming was performed for this run. This is not a warm-prerequisite benchmark comparison.
- Native x86_64 Linux, 32 available CPUs/about 35.9 GiB available at admission. Browser requested/effective width **4**; core requested/effective workers **4/4**. Overlap admitted at an estimated 16 CPUs/27 GiB, not a reservation. Deployment retained its fixed 1-vCPU/1536-MiB/2-GiB profile.
- Core/static/plugin: **379/379 files, 2,851/2,851 tests, 12 suites**, no skipped/cancelled cases. Stage 357.311s; 41.995s through preparation/static work to the first runner event; runner event window 314.840s. Typegen, TypeScript and lint completed successfully.
- Browser/terminal: **24/24 groups, 53/53 exact scenario receipts**. All coverage matched, no active scenario remained, all capsules used the same installed package as deployment, and settlement checks passed. Stage 423.371s; first capsule started 96.272s after stage start (includes prerequisite realization/scheduling); first-to-last capsule execution window 326.940s.
- Genuine Home Manager deployment: all five ordered proofs passed, including the new native question/Pause/restart/no-auto-continuation/explicit-Resume assertions. Stage 96.145s; VM evidence reports 18.928s of check execution. The rest includes realization, launch and collection; it is not relabelled as pure preparation. Final service inactive/MainPID zero, authenticated group absent and TCP refused; clients and observed owned processes settled.
- Core/browser overlap, and browser/deployment serialize: do **not** add these intervals. Timing excludes model work, review, coordination and Git operations.
- Evidence: `/tmp/pi-web-pause-all-2.log`; `/tmp/pi-web-test-source-XYQ7dw/{source.json,selection.json}`; `/tmp/pi-web-test-core.RCn4xl`; `/tmp/pi-web-test-browser.zJ6Ora`; `/tmp/pwv-1ziJQL/{run.json,artifacts/acceptance.json}`. Historical failures remain retained. Only current-run bulk was removed by the authorized runners after successful settlement/evidence validation.

### Documentation handoff

The accepted direction and limits live in ADR 0028; operational contracts live in `docs/session-internals.md`, `docs/feature-internals.md`, `docs/questions.md` and `e2e/README.md`. Archive this implementation plan after the evidence-only update. That update changes no application, test or Nix input; verify its links/format and tested-input identity instead of claiming a new full run on its tip.

At handoff, local integration still requires the global `git-worktrees` lifecycle's exact-state permission gate, required `rst-main` target/non-FF method, and result verification. That lifecycle is the explicit current owner of the remaining Git approval/execution obligation. Deployment, remote publication and feature-resource cleanup are separate authorities. No live provider calls or host-service changes were used for acceptance.
