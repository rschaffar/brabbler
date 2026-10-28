# Git Workflow override matrix

## Goal

Implement the user-approved sparse override matrix in the actual Git Workflow settings panel: **All repositories → named repository → This session**, simultaneously visible. Show saved values, inheritance and the winning value without a fourth editable/result column. Preserve existing policy authority and storage semantics.

Implementation is authorized by the user's “apply” request. Workspace creation was explicitly approved. Starting local main: `7aeb430f803556125abc24213ecd46f87c262efb`; receiving branch `feat/git-settings-override-matrix` in `/home/robert/projects/3rdparty/brabbler-worktrees/git-settings-override-matrix`.

## Context and scope

- The selected design is the matrix, not the other standalone study layouts. Cell clicks edit their own column; inherited origins are not write destinations.
- Same-value saved overrides, explicit false/null/empty check arrays and absent values stay distinct. Built-in is a labeled fallback, not another editable scope.
- Enablement remains app-wide. Manual browser discard ignores session overrides and retains exact live confirmation under Ask and Allow. Unavailable/foreign session scopes remain unavailable.
- Presets affect workflow choices only, in an explicit selected destination; permission/check/target/method values are not silently changed.
- Keep Git semantics plugin-owned through declarative metadata and generic settings presentation. Other bundled plugins retain their current layout.
- The separate Firefox/HTML-preview investigation is not owned by this change. No installed service, real user settings, browser profile or remote publication changes.
- No active main-checkout plan owns this settings redesign. The old `feat/git-settings-proposals` branch is already integrated and is not the receiving candidate.

## Plan

- [x] Add generic client-safe field-scope/value projection and opt-in presentation metadata; verify inheritance, same-value pinning, explicit false/null/[], applicability and prospective set/reset effects with production-owner tests. Resolve browser-only session applicability without invalidating legacy stored settings.
- [x] Implement the native React matrix and scope-specific editor, including clear context, grouped human-readable fields, explicit Follow/custom modes, effective-result preview, same-value pin intent, empty checks, live save failures, focus and preset previews; verify actual mounted production handlers and retained complete-work observation.
- [x] Add responsive three-column styling and centralized English messages; confirm deep-link focus, no-session/foreign-session states, app-wide enablement, manual browser scope restrictions and unchanged non-opted-in plugin UI.
- [x] Migrate the exact existing bundled-settings assertions without dropping their rollback, observer, identity and preset obligations. Add a thin installed desktop/mobile bridge for native cell geometry, keyboard/dialog focus and one durable save/reset; retain existing Git approval/receipt browser chains.
- [ ] Update `docs/git-workflow-plugin.md` to own current UI behavior, independently review the settled candidate with strong reviewers, and complete required Nix acceptance with exact input identities, results, artifacts and timing.
- [ ] Prepare verified local non-FF integration into current local main; obtain exact-state approval through the integrated Git tool. Keep publication and cleanup separate.

## Verification

Focused core: new production projection tests plus actual matrix mounts and affected `SettingsUi`, plugin settings/session and policy owners. Focused browser: `nix run .#test -- e2e --group git-plugin`.

Complete acceptance: `nix run .#test -- all --workers 4 --jobs 12` if current admission supports 32 CPUs / 43 GiB available; otherwise explicitly use `all --workers 4 --jobs 4` when its 16 CPU / 27 GiB overlap budget fits. Initial observation: 32 CPUs, approximately 36 GiB available, no other acceptance invocation observed. Reassess immediately before final acceptance and record the actual selected/effective widths. No development-server or non-Nix acceptance fallback.

## Rollback / recovery

There is no schema migration or automatic settings deletion. Reverting this UI change does not require rewriting user settings. Explicitly cleared overrides are user edits: restore only a user-selected value, never overwrite later settings from an old snapshot. After an unconfirmed save, reopen/read the actual server state before choosing a retry. All verification writes target disposable Nix fixtures, not this installed service or the user's live settings.

## Completion Checklist

- [x] Matrix and editor implemented with no changes to operation approval/cleanup authority, own-repository session binding or settings schema version.
- [x] Existing functional assertions accounted for; new behavior has focused runtime green and a meaningful scoped production-defect counterexample where required by the testing guide.
- [ ] Installed desktop/mobile UI and complete core/browser/terminal/deployment acceptance passed, or material blockers explicitly reported without calling the work complete.
- [ ] Maintained documentation, independent review and exact-state local integration approval completed; feature resources retained unless cleanup is separately authorized.

## Proof limits

Passive work observation binds the original complete `Settings.load/save` promises. Editor apply wrappers remain void at event entry and add only post-await UI/error/ref updates; mounted act/DOM assertions and native dialog-hidden checks cover visible settlement, not separately observed wrapper promises or universal idle. The eight A/B/A schedules cover obsolete work after the receiving instance's settled error/draft/result, not independent protection of a still-pending current busy state. Native tests own modality, background inertness, full-cell alignment/clipping and transport; jsdom doubles do not establish these.

## Current status

Implemented with focused verification, not complete acceptance. Parent is the only repository writer. Opt-in manifest presentation metadata and one pure projection now drive server reads, optimistic state and previews. Browser-only session sets are rejected separately from tolerant legacy reads/reset. Display-only related-choice metadata explicitly does not declare target/method defaults inactive for browser consumers. Native dialog cancel propagation and replacement/search focus restoration address independent safety findings; styles remain scoped in `app/settings.css`.

Focused source export `c646bf66b060895fa9dadb5bb051318d00810a06ff7ed26711ab0201b29aebbf` passed real SettingsUi (33), projection (6), native settings (7) and native session settings (5) tests. Commands are `nix run .#test -- core --file <owner> --jobs 4`; evidence `/tmp/brabbler-matrix-checks.1zqn1r/*-focused.log`, roots `RXKqTq`, `q5DA8b`, `DcdMLn`, `GFzQ3W` under `/tmp/brabbler-test-core.*`. End-to-end times: 45.383s / 6.347s / 6.064s / 6.077s; the first included static realization, later selections reused matching static prerequisites. An earlier expanded run failed only a mistaken `.is-active` fixture selector, corrected to the real `aria-current`; it is not a production-defect witness.

Meaningful control: removing the production inner `onCancel` propagation stop failed exactly “inner cancel must not reach an enclosing manager dialog” (32/33); source/log retained in the same evidence directory and `/tmp/brabbler-test-core.9la41y`. Byte-identical restoration (`88d84d153f240bc23913a649dde0f64244060f9b6c5c7939eebe1461a94c352f`) returned 33/33 in a fresh run, `/tmp/brabbler-test-core.cW3imn`, 8.209s. Keyed-instance and active/live guards jointly establish currentness; no independent witness is claimed for redundant guards.

Original `SettingsUi.test.mjs:571–709` at the starting main is retained semantically: all seven exact writes, both original preset inputs, same complete parent/Settings promises, masking source distinctions, held reset/unmount/readback, and unaffected target/checks. Selector and obsolete English-label assertions now target three scope cells plus explicit editor actions, not a removed scope selector. No old native Git/reader/approval step is retired. The installed settings prefix keeps Enabled → session Allow → session Always ask → Follow reset → session shortcut at both original desktop/mobile inputs, adding native geometry/focus and fresh readback. Changed bodies have `git-plugin/matrix-settings-v9` receipts with atomic inventory/dispatch/independent expectation updates and v8 retirement negatives; Nix plans derive the same inventory.

Receipt-owner check passed 27/27 (`/tmp/brabbler-test-core.E4Wd5j`, source `03c3a4601cd78744aa36dbe874bfe4b0dfdc4c26fea7b2f9cdd58b68ed819238`, 43.220s including static realization). Production follow-up found no new concrete blockers; subsequent test/native review qualifications are accounted for below.

Resolved native findings: first installed bridge failed its newly added Tab-containment assertion on the second Tab, while the native editor remained open. Geometry, Enter and initial dialog focus passed. Exact failure `/tmp/brabbler-test-browser.bFsgeP/run.json` and `/nix/store/294bwq1l49b99n9hw0iszn56y2cacrfg-brabbler-browser-git-plugin-diagnostics/artifacts/context-1.zip`; total 98.314s, support preparation 82.246s, definition 4.745s, browser execution 5.552s. A diagnostic run (`/tmp/brabbler-test-browser.7tbw1S`, 19.345s) established `document.hasFocus() === false`, active BODY, and the modal still open: native Chromium traversed browser chrome, not background application content. The corrected assertion permits only that exact unfocused-document/BODY state, still rejects all background-content focus, verifies `:modal`, and explicitly checks that native inertness refuses background programmatic focus. No production focus trap, deadline increase or unchanged retry is used. The corrected native test then exposed a genuine outer-Settings Escape close (`/tmp/brabbler-test-browser.VzU6Wm`, trace/screenshot under `/nix/store/89jllghjfi84nrgasr6q4mcv2c5b8i5c-brabbler-browser-git-plugin-diagnostics/artifacts`). The matrix now stops Escape in React capture, before SettingsPanel's document listener, while retaining native cancel/select-popup priority. Mounted composition now includes actual SettingsPanel as well as PluginsConfig. The capture fix passed the actual SettingsPanel/PluginsConfig owner (33/33, `/tmp/brabbler-test-core.vhoM3Q`, 48.051s) and the full retained Git native chain at both original desktop/mobile inputs (`/tmp/brabbler-test-browser.hsmcgi`, source `c54bdce94e669c5792f9fa4d3d0195f30fe538b18b9b366328f6e647090a3308`). End-to-end command runtime 129.455s; native execution 35.392s, support preparation 83.725s and definition 4.643s are separate. Screenshot pair was visually inspected in `/nix/store/72maj7c3xqfpxgv30gfjzl7ighvaiw6i-brabbler-browser-git-plugin-diagnostics/artifacts/git-settings-matrix-{1280,390}.png`. A final test-only refinement explicitly names the prior Follow-control focus before the inertness attempt; complete acceptance will exercise it.

Receiving application commit: `39111efe44e9fb5b0d0e14f30de6361d59de1588`, rebased on local main `474b75ab912717d88948b72aee6ffd1d9142ac05`, which separately integrated HTML-preview guidance. The initial conflict was aborted and the original clean tip retained at `backup/git-settings-matrix-pre-rebase-20261028-131150`. A deliberate mechanical retry retained both adjacent receipt rows: Git matrix v9 and incoming file-edit preview v5. No source-semantic conflict was resolved by guessing.

Both independent strong-model reviews finished without new production/migration/receipt blockers. Their remaining qualifications are addressed by the explicit proof limits above, ancestor/viewport clipping and Connection-close assertions, and one actual non-session preset preview/save case. SettingsUi now passes 34/34 on the combined base (`/tmp/brabbler-test-core.EOV5mN`, source `77db50147aebbd12e2a9c020c9383a5c62c1134558f6521fe61d72dd50d4ba17`). Hard-coding the production preset preview to session scope failed exactly that new destination-value assertion (33/34, `/tmp/brabbler-test-core.wYMEPU`); byte-identical restoration (`dc6ce038f7c388ec4fc29cbcf1b6a724dd28a0592abed6c6e8cdb956650c0c98`) returned 34/34 (`/tmp/brabbler-test-core.5o3tbL`, 13.341s). The earlier whitespace-only fixture assertion failure is retained as diagnostic evidence, not a production counterexample.

After the explicit restart continuation, the saved edits/evidence were intact and no additional saved input was found. Local main advanced independently to `0c239e29d96753e81a82ba9ad0f87ea8fa14a042` with approved robot branding. Next: commit the bounded test/review follow-up, rebase onto that current local main, and run complete acceptance with coordinated resource admission. Integration remains pending.
