# Project-scoped scratchpad

## Goal

Replace the right Notes editor's session scope with project scope, preserving Global, immediate persistence, conflict protection and undo/redo. The user chose empty project notes with no migration/import UI; existing session files remain untouched.

## Status

Completed and verified; handed off to the Git workflow's exact-state local integration gate. One receiving branch/worktree: `fix/project-scratchpad`, originally based on `74c4fdaf659df2509a8ee3a452a82edaf3d5ff51`, now rebased on local main `867bc2613b2662bd052626f78077d44237f5f98c`. No push or host deployment is authorized.

The original scratchpad plan (`docs/plans/archived/2026-10-21_scratchpad-plan.md`) remains historical evidence. This correction supersedes only its session-local right scope; existing autosave/history owners remain. Broad test-ownership migration is not part of this task.

## Current decision

- Notes follows the sidebar's selected workspace, independently of the open chat. Registered main/linked Git checkout roots share the physical common-Git-directory identity; non-Git folders (and separately selected repository subfolders) use their canonical folder identity, matching project grouping.
- Resolve the selected directory server-side through existing allowed-root and fresh registered-Git checks. Project note IDs address only the private notes collection, never authorize filesystem access or grant trust. Trust/native-default markers must not rename notes. No project files or Git markers are written.
- Keep the Global scope/storage key unchanged and keep legacy session endpoints/files compatible. Project keys are namespaced; the browser caches history/recovery by canonical project ID, not chat ID or checkout spelling.
- Selected-directory changes fence obsolete metadata completions. Saves remain owned by their originating controller across project switches. Global remains available when no project is selected or resolution fails.

## Plan

- [x] Add project identity resolution and namespaced API/storage addressing; prove native worktree sharing, directory separation, allowed-root refusal and legacy/global preservation.
- [x] Bind the real Notes panel/AppShell to selected-project identity, with visible project context and independent history; verify A/B/A switches and obsolete metadata handling with existing mounted owners.
- [x] Update affected owner recipes/browser inputs and maintained contracts; retain real native persistence/keyboard/geometry bridges, without creating a parallel runner or duplicating unrelated policy journeys.
- [x] Review the settled candidate, rebase on current local main, run required coordinated acceptance once source is ready, and record input-bound evidence.

## Verification evidence / changed obligations

- Focused implementation core: 8 files / 95 tests passed in 50s, including real registered-Git/folder identity, route admission/global/legacy preservation, mounted metadata/history/lifetime, existing trust/native-default consumers and browser inventory contracts. Command selections/logs: `/tmp/project-scratchpad-restored.O6Hdzy/`; report `/tmp/pi-web-test-core.UeUIxd/run.json`; input digest `a90e65f0ba1af2f5d76a158d1762452b9739be70302f7a1c37abe2a0300874dc`. Not full acceptance.
- Meaningful production controls: replacing common-Git identity with checkout identity failed the native shared-worktree assertion; removing the metadata success generation fence failed `NT-project-metadata`'s current-context assertion after A/B/A. Original/fault sources, command logs and 42s/44s failing runs are retained at `/tmp/project-scratchpad-controls.kGqG44/`. Both faults were restored byte-for-byte before the green run above; no fault variant is a shipping candidate.
- Independent source review closed the trust-marker coupling finding: a fresh registration-only helper now serves Notes, while trust callers retain their original marker validation/key semantics. The native test covers malformed/aliased marker independence and existing trust consumers passed separately.
- The first browser attempt stopped on a fixture precondition: it waited for obsolete `.chat-input-editable` while the exact screenshot showed the new-chat composer present. The selector now uses production `.chat-input-textarea`; the original 30s bound is unchanged. Original failure/report: `/tmp/project-scratchpad-browser.Pr2ngB/`, `/tmp/pi-web-test-browser.2GYxKQ/run.json`. The corrected bridge passed all four appearance scenarios in 111s whole-command / 23.287s capsule execution: `/tmp/project-scratchpad-browser-restored.zkKbDr/`, report `/tmp/pi-web-test-browser.AdtFD0/run.json`. It uses the same `a90e65f…` candidate input as the 95-case restored core run; prerequisite realization is included in command time.
- Assertion disposition at base `74c4fda`: `ScratchpadPanel.policy` NT-scope's session-isolation premise is obsolete by the user's correction; its replacement is canonical-project/checkout-alias A/B/A plus the genuine native resolver owner. Existing button/coalescing/conflict/recovery/currentness/teardown assertions and literal corpus remain, now using project wire scopes. Legacy session API/storage owners remain unchanged rather than silently dropping compatibility.
- Changed installed receipt bodies have fresh IDs: `appearance/notes-native@en-desktop` → `appearance/notes-project-native-v2@en-desktop`, and `appearance/notes-touch-layout@en-mobile-short` → `appearance/notes-project-touch-layout-v2@en-mobile-short`. Both retired IDs are rejected before callback execution. Native keyboard/modal/roundtrip and distinct ED/390×600 touch inputs remain; new thin selected-folder/no-chat and genuine main/linked-worktree caller bridges cover the changed shell obligation. No conflict-policy matrix is added back to Chromium.

## Final acceptance

- `nix run .#test -- all --workers 4 --jobs 12` passed at `007801cc91c654ad3823810346b0f92c09142031`: all 516 core files / 4,248 tests / 14 suites, all 26 browser/terminal groups / 59 scenario receipts, and genuine Home Manager deployment/PTY/shutdown proofs. No skipped/cancelled tests or uncertain settlement. Source digest `32b0549f8cdd54d47f0bec90828b511b368b367a8f78da6d4c46490f568a7457`; immutable source `/nix/store/d7j425kijgv3wjvkn9nabv98vqkmw1b3-source`.
- Whole command **374.020s**, including in-run realization. Core invocation 297.372s (2.712s before file execution; 294.286s file window); browser invocation 294.942s (support preparation 3.695s, definition preparation 6.724s, group-client window 284.519s); deployment invocation 71.886s, including fresh guest-image realization, with VM test script 21.16s. Overlapping intervals are not additive. Static/application prerequisites were partly warm from focused runs; no separate deliberate prewarming or timing comparison is claimed.
- Native x86_64 Linux: 32 effective CPUs, approximately 56.8 GiB available at launch; requested/effective core width 12/12, browser width 4. Aggregate 32-CPU/43-GiB overlap was admitted. Previously visible focused work had settled before launch; other sessions subsequently ran focused checks, so this is not a machine-exclusive benchmark.
- Exact retained evidence: `/tmp/project-scratchpad-final-acceptance.BsbhEu/` (command, context, wall time, log); core `/tmp/pi-web-test-core.7i5Y7X/run.json`; browser `/tmp/pi-web-test-browser.7V3vgd/run.json`; deployment `/tmp/pwv-64gVh1/run.json`.
- Main advanced during the run through documentation-only plan retirement. The follow-up rebase produced `00340e93de607d8489f87578ba859c91639383a9`. `git diff --exit-code 007801cc91c654ad3823810346b0f92c09142031 HEAD -- . ':!docs/**' ':!e2e/README.md'` confirmed all application/test/fixture/manifest/runner bytes unchanged; the package remains `/nix/store/ypbmq2wpxij6h6d5kcs4rdkgjdgxjjni-pi-web-0.9.3`. Dependency/static/type source and type/lint evidence identities match exactly.
- Proportional current-tip verification: `nix run .#test -- core --jobs 4 --file lib/e2e-coverage.test.mjs --file lib/browser-suite-fixtures.test.mjs` passed 43 tests in **8.862s** at the rebased tip, checking the maintained browser receipt/recipe contracts after those prose changes. Log `/tmp/project-scratchpad-rebase-docs.9UbCh9/`; report `/tmp/pi-web-test-core.IE0tHQ/run.json`. Full acceptance remains evidence for the explicitly named earlier commit, not a claim of re-execution at the rebased/archive tip.

Durable current behavior and ownership now live in `docs/feature-internals.md`, `docs/architecture.md`, `docs/test-writing.md` and `e2e/README.md`. No implementation blocker remains. This plan's final archive is evidence/status only; Git's separate integration/cleanup approvals remain required.

## Acceptance / Stop conditions

- Same-project chats and registered linked worktrees expose one Project note; another project exposes a different note. Notes work without a saved chat.
- Global bytes and legacy session files/recovery keys are not migrated or deleted. Old session notes are not copied into new project notes.
- Autosave/conflict/recovery and independent undo behavior retain their existing production owner; project metadata is not admission authority for files or agent context.
- Stop before destructive migration, changing canonical project semantics, broad test-ownership migration or a semantic rebase conflict. Full acceptance waits for settled source, final rebase and coordinated resource admission.

## Rollback / Recovery

Project notes use new namespaced private files. Reverting leaves them retained and leaves Global/legacy session files unchanged. No automatic merging, deletion, GC, new filesystem grants or trust/settings writes. Integration/cleanup remain owned by the Git workflow's separate exact-operation gates.

## Completion Checklist

- [x] New native/API and real mounted scope obligations pass, with existing autosave/history regressions retained.
- [x] Browser owner/recipe and maintained guide accurately describe Global + Project, including standalone and worktree behavior.
- [x] Required final verification/review evidence is recorded for the rebased candidate; handoff to exact-state integration is explicit.
