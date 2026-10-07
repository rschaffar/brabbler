# Cross-repository Git plugin tools

## Goal

Allow `git_commit`, `git_rebase`, `git_merge` and all `git_worktree` actions to operate on an explicitly selected registered checkout in any local repository, independently of the calling session's cwd. Apply the selected repository's settings without weakening approvals, required checks or native safety guards.

The user authorized implementation in `fix/cross-repository-git-tools`, based on local `rst-main` `e675596cf03d400ebce1d513b27e4bdc678bdeff`. Integration, publication, deployment and feature-resource cleanup are separate approvals.

## Plan Relationship

This bounded change belongs to the optional bundled plugin in `plugins/git-workflow/`, not the removed managed Workflow. The managed-Workflow removal checklist and ADR 0014 remain unchanged; no task, session-policy or evidence engine is restored.

## Non-Goals

No permission/settings migration, remote operation, session relocation, new execution sandbox or force worktree removal. File-browser authorization remains separate. No production build or installed-service change.

## Plan

- [x] Validate selected checkouts against their own physical repository registration; keep related worktrees in that repository and protect the caller's checkout, including a subdirectory cwd.
- [x] Resolve action permissions, targets, methods, checks and pending-approval revalidation for the explicitly selected repository; verify callers in unrelated repositories and non-Git directories.
- [x] Update tool descriptions and the maintained plugin guide; record the cross-repository decision without reviving the removed Workflow. Durable owners: `docs/git-workflow-plugin.md` and ADR 0015.
- [x] Add and pass real-Git regression tests for commits, rebase, merge, create/attach/remove, selected-project Deny/Ask/Allow, settings cancellation and stale selection/state.
- [x] Verify the real Pi tool-registration path, common tests/typecheck/lint and plugin desktop/mobile browser flows using private fixture storage; report failed or unavailable checks honestly.

## Risks / Recovery

Selecting another repository must never import the caller project's permissions or check recipes. Approval snapshots must still bind the physical selected repository and its relevant state/settings. Worktree removal must remain limited to another registered linked checkout of the selected repository, never main/source/caller. No persistent schema changes are needed; ordinary source rollback restores the former restriction. Existing external-writer races remain outside atomic snapshot guarantees.

## Completion Checklist

- [x] All six Git actions work across repositories while registration, stronger instructions, approvals, checks and removal guards remain in force.
- [x] Focused plugin regressions and relevant common/browser acceptance have recorded evidence.
- [x] Maintained documentation describes the verified behavior and clearly leaves integration, installed activation, publication and cleanup separate.

## Evidence

- Before the implementation, regressions reproduced the same-repository restriction, caller-policy leakage and unsafe removal from a subdirectory caller. An empty-directory test cleanup error was also corrected.
- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: **239/239 files, 1,565/1,565 tests**, no failures/skips/unstarted files or settlement uncertainty; exporter contracts, typegen, typecheck and lint passed. Log: `/tmp/pi-cross-repo-core.FWnQAO.log`. Subsequent application code is unchanged; later edits only extend tests/browser fixtures and documentation.
- Contributor baseline in a private credential-free environment with eight-CPU affinity: **`npm test` 1,566/1,566 passed**, `node_modules/.bin/next typegen`, `node_modules/.bin/tsc --noEmit` and `npm run lint` passed. Log: `/tmp/pi-cross-repo-baseline.UowPZS.log`.
- Separate `node --experimental-strip-types --test "plugins/**/*.test.mjs"` in the offline Nix shell: **25/25 passed**, including actual model-issued calls through Pi's credential-free faux provider, all six operations from Git/non-Git callers, live disable/re-enable and successive repository selections. Log: `/tmp/pi-cross-repo-plugin-final.oCHEn8.log`. Initial SDK fixture attempts exposed missing test teardown (`session_shutdown` must precede `dispose`, as in Pi Web) and a cumulative faux-provider call counter; both fixture issues were corrected without production lifecycle changes.
- `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` in the offline Nix shell: **1280px and 390px passed**, including cross-repository commit approval, selected checks and settings cancellation, unchanged caller refs, all approval layouts, history, reconnect, disable and Stop. Log: `/tmp/pi-cross-repo-browser.uz4Ibe.log`. The first cross-repository browser fixture was correctly refused by the settings API's allowed-root check; selecting its private fixture directory via ordinary `/api/cwd/validate` fixed the fixture without weakening the API boundary.
- Independent read-only five-file code review: no findings. `git diff --check` passed. Terminal acceptance is not applicable: no terminal integration changed. Verification is Linux/source/fixture evidence, not installed activation or Windows acceptance.
- Source implementation is complete and this plan is archived. Integration into local `rst-main`, rebuilding/activating the installed service, publication and feature-resource cleanup remain separate lifecycle decisions.
