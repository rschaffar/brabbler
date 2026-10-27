# Project-scoped scratchpad

## Goal

Replace the right Notes editor's session scope with project scope, preserving Global, immediate persistence, conflict protection and undo/redo. The user chose empty project notes with no migration/import UI; existing session files remain untouched.

## Status

Implementation, focused core and installed browser bridges are verified; final rebase/coordinated acceptance remain pending. One receiving branch/worktree: `fix/project-scratchpad`, based on `74c4fdaf659df2509a8ee3a452a82edaf3d5ff51`.

The original scratchpad plan (`archived/2026-10-21_scratchpad-plan.md`) remains historical evidence. This correction supersedes only its session-local right scope; existing autosave/history owners remain. Broad test-ownership migration is not part of this task.

## Current decision

- Notes follows the sidebar's selected workspace, independently of the open chat. Registered main/linked Git checkout roots share the physical common-Git-directory identity; non-Git folders (and separately selected repository subfolders) use their canonical folder identity, matching project grouping.
- Resolve the selected directory server-side through existing allowed-root and fresh registered-Git checks. Project note IDs address only the private notes collection, never authorize filesystem access or grant trust. Trust/native-default markers must not rename notes. No project files or Git markers are written.
- Keep the Global scope/storage key unchanged and keep legacy session endpoints/files compatible. Project keys are namespaced; the browser caches history/recovery by canonical project ID, not chat ID or checkout spelling.
- Selected-directory changes fence obsolete metadata completions. Saves remain owned by their originating controller across project switches. Global remains available when no project is selected or resolution fails.

## Plan

- [x] Add project identity resolution and namespaced API/storage addressing; prove native worktree sharing, directory separation, allowed-root refusal and legacy/global preservation.
- [x] Bind the real Notes panel/AppShell to selected-project identity, with visible project context and independent history; verify A/B/A switches and obsolete metadata handling with existing mounted owners.
- [x] Update affected owner recipes/browser inputs and maintained contracts; retain real native persistence/keyboard/geometry bridges, without creating a parallel runner or duplicating unrelated policy journeys.
- [ ] Review the settled candidate, rebase on current local main, run required coordinated acceptance once source is ready, and record input-bound evidence.

## Verification evidence / changed obligations

- Focused current-source core: 8 files / 95 tests passed in 50s, including real registered-Git/folder identity, route admission/global/legacy preservation, mounted metadata/history/lifetime, existing trust/native-default consumers and browser inventory contracts. Command selections/logs: `/tmp/project-scratchpad-restored.O6Hdzy/`; report `/tmp/pi-web-test-core.UeUIxd/run.json`; input digest `a90e65f0ba1af2f5d76a158d1762452b9739be70302f7a1c37abe2a0300874dc`. Not full acceptance.
- Meaningful production controls: replacing common-Git identity with checkout identity failed the native shared-worktree assertion; removing the metadata success generation fence failed `NT-project-metadata`'s current-context assertion after A/B/A. Original/fault sources, command logs and 42s/44s failing runs are retained at `/tmp/project-scratchpad-controls.kGqG44/`. Both faults were restored byte-for-byte before the green run above; no fault variant is a shipping candidate.
- Independent source review closed the trust-marker coupling finding: a fresh registration-only helper now serves Notes, while trust callers retain their original marker validation/key semantics. The native test covers malformed/aliased marker independence and existing trust consumers passed separately.
- The first browser attempt stopped on a fixture precondition: it waited for obsolete `.chat-input-editable` while the exact screenshot showed the new-chat composer present. The selector now uses production `.chat-input-textarea`; the original 30s bound is unchanged. Original failure/report: `/tmp/project-scratchpad-browser.Pr2ngB/`, `/tmp/pi-web-test-browser.2GYxKQ/run.json`. The corrected bridge passed all four appearance scenarios in 111s whole-command / 23.287s capsule execution: `/tmp/project-scratchpad-browser-restored.zkKbDr/`, report `/tmp/pi-web-test-browser.AdtFD0/run.json`. It uses the same `a90e65f…` candidate input as the 95-case restored core run; prerequisite realization is included in command time.
- Assertion disposition at base `74c4fda`: `ScratchpadPanel.policy` NT-scope's session-isolation premise is obsolete by the user's correction; its replacement is canonical-project/checkout-alias A/B/A plus the genuine native resolver owner. Existing button/coalescing/conflict/recovery/currentness/teardown assertions and literal corpus remain, now using project wire scopes. Legacy session API/storage owners remain unchanged rather than silently dropping compatibility.
- Changed installed receipt bodies have fresh IDs: `appearance/notes-native@en-desktop` → `appearance/notes-project-native-v2@en-desktop`, and `appearance/notes-touch-layout@en-mobile-short` → `appearance/notes-project-touch-layout-v2@en-mobile-short`. Both retired IDs are rejected before callback execution. Native keyboard/modal/roundtrip and distinct ED/390×600 touch inputs remain; new thin selected-folder/no-chat and genuine main/linked-worktree caller bridges cover the changed shell obligation. No conflict-policy matrix is added back to Chromium.

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
- [ ] Required final verification/review evidence is recorded for the rebased candidate; handoff to exact-state integration is explicit.
