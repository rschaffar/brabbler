# Remove managed Git Workflow

## Goal

Remove the managed Git Workflow completely and restore a useful Pi Web with fast, reliable developer tests. The user's final removal decision supersedes the live-settings migration, four-tool redesign, earlier delivery/acceptance obligations, and their product ADRs. Historical source verification is not acceptance of this removal.

Implementation and source verification are authorized in the existing `feat/live-git-settings` linked worktree. Preserve unrelated work and existing private data/history. Local integration into current `rst-main` requires exact-state approval and an unsigned non-FF merge; publication, deployment and resource cleanup remain separate approvals.

## Plan

- [x] Remove RPC tool/guidance/approval wiring, Workflow UI and feature-only API entry points.
- [x] Delete unreachable feature-only engines, settings/authorization/evidence/recovery machinery and tests. Preserve Git Explorer, read-only status/diff and standalone worktrees, file access, ordinary sessions/forks/subagents/terminals and SDK project trust.
- [x] Repair surviving imports and remove hidden Workflow gates from ordinary session and worktree operations. Stop reading/writing obsolete private Workflow data without migrating or deleting it.
- [x] Simplify current contributor documentation and remove obsolete Workflow browser flows/lane entries. Keep `package.json` and the existing parallel developer runner stable; fix only demonstrated test blockers.
- [x] Run focused surviving-feature checks and full tests/typecheck/lint on stable source, plus ordinary desktop/mobile browser and terminal acceptance. Pre-rebase evidence is below; exact prepared-candidate verification remains the final gate. No removed-feature E2E/containment or production builds.
- [ ] Produce reviewed feature commits, prepare against current local `rst-main`, verify the exact candidate and request integration approval.

## Entry points and shared dependencies

Feature entry points: RPC inline extensions and Git approval UI; AppShell Workflow home and ChatWindow controls/action cards; `/api/git` workflow/mutation/authorization/recovery/history routes; feature coupling in session creation/move/fork, subagent context, project trust and standalone worktree routes.

Preserve: `lib/git-explorer.ts`, graph layout/license, committed patch viewer, `git-changes`/`git-status`/`git-types`, sanitized `git-exec`, ordinary `lib/worktree.ts` and its file-root protections. SDK project trust remains required for project-controlled extension loading, but its Workflow authority instrumentation does not.

## Completion Checklist

- [x] No managed Git tools, Workflow controls, injected notices, dormant execution/retirement paths or feature-only active imports remain. Source/import search and fresh-copy typecheck confirm removal; browser acceptance is separate.
- [ ] Genuine surviving coverage passes; commands/results and unavailable acceptance are recorded honestly.
- [ ] Reviewable commits and exact integration candidate are presented, unintegrated pending approval.
- [ ] Handoff explains that integration and a separately authorized rebuild/activation are still needed; installed service/global configuration/private history/resources remain untouched.

## Evidence

Earlier disposable-copy runs covered superseded source, not removal.

- Removal-focused disposable checks passed for RPC/dialogs, move/read, subagents, trust, worktrees, Explorer and rendering. The runner's obsolete selected-runtime contract failed and was deleted with its feature-only hardcoded count map; the remaining 24 runner contracts passed. No scheduling/settlement safety guard was relaxed.
- First full removal run stopped on one mobile-toolbar assertion still requiring Workflow; 107 assertions passed, one failed, remaining coverage was unstarted. Removed only that obsolete button expectation; ordinary toolbar coverage remains and focused follow-up passed.
- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: **227/227 files, 1,487/1,487 tests**, no failures/skips/unstarted files/settlement uncertainty. Exporter contracts, fresh typegen, nonincremental typecheck and lint passed. Log `/tmp/pi-workflow-removal-full.7Ui8sY.log`; artifact root `/tmp/pi-web-test-offline` is printed there. This pre-rebase snapshot preceded unused CSS cleanup and the browser fixture-label correction; final-candidate verification remains required.
- Browser attempt passed ordinary API/context/account/reload flows, then exposed an obsolete Explorer fixture label; corrected it. A separate copy with symlinked modules failed Turbopack's filesystem-root boundary before readiness; no config widening/fallback was used. Retained it and retried with a new verified export and copied dependencies: all desktop/mobile browser scenarios reached their final passes (`/tmp/pi-workflow-removal-browser.9Cb8gm.log`). Terminal initially failed because the scrubbed test environment omitted `SHELL` and its fallback was unavailable; using Nix's actual Bash executable passed both viewports, exit 0 (`/tmp/pi-workflow-removal-terminal.hkCIMI.log`). No source behavior, assertion or native protection was weakened.
- Unsigned feature commit `50ad9b8` includes the preserved prepared developer command; clean preparation onto local `rst-main` `e0c2e33` produced `6b00df8`, with no retained scratch or target mutation. Final post-rebase checks/receipts and the exact approval candidate belong in the handoff, not inferred from the pre-rebase runs above.
- Post-rebase `npm test` passed **1,488/1,488 tests** with eight-CPU affinity and a private credential-free environment; fresh isolated source/typecheck/lint also passed via the lifecycle verifier. Browser acceptance then exposed an invalid off-screen reading-fixture capture (9,190px). Requiring a visible settled anchor exposed a genuine sentinel/pagination race during saved-position restoration. The existing restoration ref now prevents that competing pagination; the executed-callback regression passed **7/7**. Strict browser restoration assertions and SDK deadlines remain unchanged; current-source browser/full verification is still required.
- No integration, deployment, publication, installed-service/global configuration change or old-resource cleanup occurred.
