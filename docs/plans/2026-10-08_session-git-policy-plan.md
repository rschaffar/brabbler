# Session Git policy, workflow presets and execution receipts

## Goal

Use explicit user-configured global/project/session choices instead of redundant lifecycle questions, retain `ask_user` for every workflow choice set to Ask, and persist honest execution cards for both interactive and policy-authorized Git operations.

Implementation is authorized. Worktree `feat/session-git-policy` starts at local `rst-main` `b86d47c791e28309c9f110c4cbfa04f3a6643e23`. Integration, deployment, publication and cleanup are not authorized. Existing lifecycle rules govern this implementation; new source does not grant this agent new permissions.

## Plan Relationship

Extends the optional bundled plugin and persistent-interaction-card behavior. ADR 0014's removal of managed Workflow remains in force; no old task registry, private settings, CLI integration or legacy approvals are revived. A new ADR will revise ADR 0015's resolution contract only by adding own-project session overrides. Generic host plumbing remains independent of Git semantics. Nix-managed skill/instruction alignment and standalone CLI inventory improvements belong to a separately isolated change in `~/nix/my_nix_os`; no installed configuration is edited directly.

## Evidence

A targeted review of nine recent Git-related Pi sessions found duplicate `ask_user` and plugin merge/removal approvals; five CLI cleanup failures with `workflow record too large`; repeated generated-artifact cleanup proposals; and cleanup approval invalidation when only the integrated target advanced. The Oct 7 README session (`01a11717…`) required five Git approvals per task. Successful automatically allowed commits had tool results but no persistent cards.

Retraction: a prior chat recommendation limited automatic cleanup to worktrees without ignored content. That is ineffective here because required CodeGraph initialization and normal dependencies/tests create ignored output. Ignored status or a familiar name alone must never authorize deletion.

## Architecture

- Resolution: defaults → global → selected repository → session **only when the selected repository equals the session's own physical common Git directory**. Cross-project calls use target-project settings without any caller/session overrides. Linked worktrees share identity. Session moves deactivate old overrides; forks/subagents do not inherit them.
- Store only explicit overrides privately on the server. In-session navigation never rewinds permission settings. Global disable remains authoritative; malformed settings fail closed. UI shows sources and reset-to-inherit. Relevant changes invalidate pending approvals and are checked again before effects.
- Workflow choices and operation permissions are distinct. Choices include workspace, completion, target selection, method selection, worktree cleanup, feature-branch cleanup and generated artifacts. Every choice supports Ask via `ask_user`. Named presets edit only workflow choices, never action permissions, checks or remote authority.
- Supply versioned, repository-scoped effective policy to the model and a read-only lookup tool for explicit foreign repositories. Execution resolves the same policy independently. No natural-language auto-answer interception and no permission-writing agent tool.
- Workflow Ask resolves an actual missing choice once. Exact operation approvals remain tool-owned; do not precede them with equivalent consent questions. Stronger explicit repository constraints remain unless deliberately aligned.
- Generic nonblocking operation receipts persist before checks/effects and after settlement, correlated by operation/tool-call identity. Record authorization source separately from outcome, exact bounded display data, checks and observed result. Ask/Allow share execution. Interrupted records remain unknown, never fabricated success. Historical receipts are read-only and outside model context.
- Bounded integrated cleanup identifies exact feature resources and verified integration, optionally removes explicitly permitted generated roots and branch, and reports partial results. No arbitrary ignored-content deletion, force fallback, remote actions or hidden retries. Target advancement alone does not stale cleanup when recorded integration remains reachable and resources match. Exact merge approval still stales on target/candidate changes.

## Plan

- [x] Implement/test own-project-only session settings, provenance, persistence and fail-closed validation in generic plugin settings plumbing.
- [x] Add typed workflow choices and named presets, with Ask explicitly routed through `ask_user` guidance; keep action permissions independent.
- [x] Add session-aware browser controls, trusted session lookup at routes, runtime policy context/read-only lookup, and change invalidation.
- [x] Add generic durable operation receipts and Git Ask/Allow integration, including failed checks, partial effects and restart-unknown presentation.
- [x] Add bounded cleanup mechanics, explicit generated-resource selection and optional feature-branch deletion with exact resource revalidation.
- [x] Align documented skill/harness policy and repository instructions; prepare the Nix source changes only in separately approved isolation.
- [x] Add regression coverage for recorded session scenarios; run focused tests while developing, then full offline/core tests, typecheck/lint and desktop/mobile browser acceptance. No production build.
- [x] Review and commit coherent feature changes; verify the rebased application candidate.
- [ ] Obtain exact-state local integration approval; retain feature resources until integration and cleanup are separately authorized.

## First-slice checkpoint (2026-10-08)

Implemented the first three steps, ADR 0016 and the focused plugin guide. Imported SDK sessions may have safe non-UUID IDs; actual ownership still comes from saved headers/runtime, never browser-supplied cwd. Missing configured integration targets can be answered per invocation without persisting the answer. Preset controls are editable previews and do not alter permissions. Added a session-header shortcut and layer-specific optimistic controls with failure rollback. The generated CodeGraph index is excluded from tracked source.

Verification for this working-tree slice:

- Full isolated offline run passed: 254 files, 1,630 tests, typecheck and lint (`/tmp/pi-git-policy-full-2.log`). This preceded restoration of the original route schema/origin regression alongside the added session cases.
- Subsequent literal `npm test`, `node_modules/.bin/tsc --noEmit`, and `npm run lint` all passed in disposable HOME/config with bounded CPU affinity: 1,637 tests (`/tmp/pi-git-policy-baseline-2.log`). The first baseline used TMPDIR inside HOME and exposed a path-abbreviation fixture mismatch; rerunning with sibling directories fixed the environment, not application/test code.
- Separate plugin suite passed: 39 tests (`/tmp/pi-git-policy-plugin-final.log`).
- Git-plugin browser acceptance passed at 1280px and 390px, including session scope/presets/reset and existing Git flows (`/tmp/pi-git-policy-browser-6.log`).
- Full browser suite remains **not accepted**: after the main mobile scenarios it reported an unexpected console 409 from `/api/sessions/e2e-archive-session/context?...&ancestorId=...` (`/tmp/pi-git-policy-full-browser.log`; retained `test-results/e2e/trace.zip` and `server.log`). The context route was not changed by this slice; its cause has not been established and the failure must not be suppressed or called resolved.
- Early external 240-second harness limits interrupted one offline run and one browser run; completed runs above supersede those incomplete attempts, without changing test deadlines. Stopped fixture lock metadata was retained under `/tmp/pi-git-policy-stale-lock.*`; no installed server was changed.
- A separate read-only review found the missing-configured-target issue above; fixed and covered by the passing plugin suite.

Execution receipts and bounded artifact/branch cleanup remain unimplemented. Current Allow still has ordinary tool results only; current strict removal still retains branches/refuses ignored contents. Skill alignment has not begun: read-only inventory found an unrelated modified `flake.lock` in the primary `~/nix/my_nix_os` checkout (local `main` at `e9a6386b1fb315f65169a23d5d8e454c3ee2a07c`). Preserve it and obtain direction before any mutation in that repository. No commits, integration, deployment, publication or feature cleanup have occurred.

## Complete implementation checkpoint (2026-10-08)

The user authorized continuing both repositories and creating the Nix worktree despite its unrelated primary-checkout `flake.lock` change. Created `/home/robert/nix/my_nix_os-worktrees/session-git-policy`, branch `feat/session-git-policy`, from committed local `main` at `e9a6386b1fb315f65169a23d5d8e454c3ee2a07c`; initialized CodeGraph. The dirty primary file was not copied, reset or included. Skill/default-instruction/guide/regression changes are prepared there, not installed.

Implemented generic append-only operation snapshots with host ordering, latest-on-branch read-only cards, reconnect/pagination deduplication, explicit unknown outcomes, and Ask/Allow provenance. Git tools require durable receipt support before effects. New `git_cleanup` uses separate default-Ask permission and explicit user-owned generated-root authority; combines bounded content inventory, verified integration reachability, worktree removal and conditional non-dereferencing local branch deletion. Generic managed-directory reservations block new prompt/startup/terminal admissions during final validation and effects; external processes remain outside that boundary.

Independent review caught and fixed symbolic-ref deletion, `..name` containment, final repository rebinding, missing root-enumeration revalidation, managed-admission races, repeated synchronous unbounded scanning and premature effect-start claims. Added regressions; inventories now yield with shared operation bounds, each deletion revalidates remaining resources, and partial results name completed/attempted steps. The README operation replay has four successful durable outcomes with only one merge approval (deterministic tool replay, not a live-model evaluation).

Latest verification:

- `npm test`: **1,659 passed**; `node_modules/.bin/tsc --noEmit` and `npm run lint`: passed (`/tmp/pi-git-policy-complete-baseline.log`). Disposable HOME/config, bounded CPU affinity.
- Full isolated offline runner: **258/258 files, 1,653 tests passed**, typegen/typecheck/lint passed, no unsettled observed processes (`/tmp/pi-git-policy-final-offline.log`). Earlier complete-run attempts exposed two stale test assertions after intentional receipt/startup changes; corrected and covered before this successful run.
- Separate plugin suite: **67 tests passed**, including the subsequent test-only README replay addition (`/tmp/pi-git-policy-final-plugin-tests.log`). Runtime inputs are unchanged from the full core/browser acceptance above.
- Full `npm run test:e2e`: desktop/mobile passed (`/tmp/pi-git-policy-complete-browser.log`). The earlier mobile archive/context 409 did not recur; its precise race remains unproven and no suppression was added.
- Plugin-only `npm run test:e2e`: desktop/mobile passed with saved Allow/Ask outcomes, single-card combined cleanup, original approval/diff/reconnect/Stop coverage (`/tmp/pi-git-policy-final-plugin-browser.log`).
- `npm run test:terminal`: desktop/mobile passed with disposable HOME and `PI_WEB_TEST_SHELL` pointing to Nix bash (`/tmp/pi-git-policy-terminal-2.log`). The first sanitized invocation fell back to nonexistent `/bin/bash`; no production/test deadline change was made.
- Nix worktree: `bash tests/git-worktrees-skill.sh home/presets/skills/git-worktrees/SKILL.md home/presets/pi/AGENTS.md home/presets/ai-agents.nix`, `bash -n`, ShellCheck and `nix build --offline --no-write-lock-file --no-link .#checks.x86_64-linux.git-worktrees-skill`: passed. No activation or CLI engine change.

Application work is verified; feature commits/local integration remain lifecycle steps, not deployment authority. The installed service/skill, remote repositories and primary `flake.lock` are untouched. No production build was run. Known limitations: live-model obedience to policy has not been evaluated; external Git/filesystem writers and other server processes are not coordinated; the prior archive/context race is not claimed fixed.

## Rebased candidate verification

Pi Web application commit `a8b1f71a0982b7811693064f452ccb050339ea72` is rebased onto current local `rst-main` `fe77710fd1c67abf8cc191fc3b5323679de77787` (question-set integration). Rebase completed without conflicts; reviewed the shared receipt/UI/runtime diff. The original pre-rebase feature commit was `6b70ac50228e1bb63c059e23fcc0cac6bd733850`.

On the rebased application commit:

- `npm test`: **1,669 passed**; `node_modules/.bin/tsc --noEmit`, `npm run lint`: passed (`/tmp/pi-git-policy-rebased-baseline.log`).
- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: **259/259 files, 1,663 tests passed**, including typegen/typecheck/lint (`/tmp/pi-git-policy-rebased-offline.log`).
- Separate plugin test selection: **67 passed** (`/tmp/pi-git-policy-rebased-plugin-tests.log`).
- Full desktop/mobile browser acceptance, including the newly integrated question sets: passed (`/tmp/pi-git-policy-rebased-browser.log`).
- Plugin desktop/mobile browser acceptance: passed (`/tmp/pi-git-policy-rebased-plugin-browser.log`).
- Terminal/browser-specific source is unchanged from the earlier passing real-terminal acceptance; core runtime/admission tests and browser startup flows were rerun above.

Nix feature commit `67c1de6d6b6adf9fb65ef73a089becd7ce5c2c1b` retains base `e9a6386b1fb315f65169a23d5d8e454c3ee2a07c`; its focused verification is recorded above. Both feature commits are unsigned with the existing author identity. Nix local integration remains blocked by the unrelated primary `flake.lock` modification. This final status update changes only this plan, not tested application inputs. No merge, publication, activation or feature cleanup has been performed.

## Risks and Recovery

- Prompt guidance is not an OS sandbox; shell access must not be presented as enforced containment.
- Existing Allow settings must not silently authorize new cleanup or workflow choices. New choices default Ask and new destructive actions default Ask.
- Known generated roots need explicit bounded ownership/selection, not blanket trust in `.gitignore`. External filesystem writers remain a race; no snapshot is advertised as atomic.
- Cross-repository operations and session movement are negative-test boundaries, not only UI conventions.
- Save settings atomically under locking; preserve old explicit overrides. Additive receipt entries remain harmless to older readers and never authorize execution. No historical backfill or legacy private-data migration.
- Source changes do not change the installed service or globally deployed skill until separately authorized activation.

## Completion Checklist

- [x] Global/project/session origins and reset work; session settings cannot affect another repository.
- [x] Every workflow setting supports Ask via `ask_user`; presets never grant action permission.
- [x] Reload/compaction preserve settings; branch navigation, forks, subagents and moves do not leak them.
- [x] Automatically allowed and manually approved operations both leave truthful durable outcome cards.
- [x] Normal approved generated artifacts do not require multiple cleanup approvals; unknown/changed resources block safely.
- [x] Exact merge state changes invalidate approval; unrelated target advancement does not alone invalidate cleanup.
- [x] README-only automatic-isolation/cleanup tool replay with merge Ask has one operation approval rather than five redundant approvals; live-model behavior remains unevaluated.
- [x] Required checks pass, or failed/unavailable checks and incomplete phases are explicitly retained here and reported.
