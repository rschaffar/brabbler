# Non-destructive forks from running sessions

## Goal

Allow **New session** from a persisted user message while its source session is running, without stopping, replacing, or changing the source. Apply the same safe-copy behavior to **Ask in new chat** from a saved response.

## Context

The user requested this implementation. The existing fork paths already use separate `SessionManager` instances, but retain busy/replacement guards; `fork` additionally shuts down its source. No active plan owns these per-message actions. Work is isolated on `fix/fork-running-session`, originally based on local `rst-main` at `32a3469d6af4d276f790953c352ebf4fb60fedb6`.

The user requested **rebase first**, then approved local integration. Feature tip `3d0e35498d6cccfc349de0e1fc74a2b2f07abdb7` was merged into local `rst-main` at `e4ca21d914b0c49f44dbb5f3e50a0d60a1e82a56` by an unsigned non-fast-forward merge. Exact parents (`277db2349ede6a5e261a84ef3b6afc25083095d6`, then the feature tip), feature-matching tree and clean checkouts were verified. Both pre-rebase backup branches are retained.

## Plan

- [x] Remove replacement/busy behavior from `fork` and `fork_branch` in `lib/rpc-manager.ts`; verify source IDs, leaf, bytes, active work, and event subscription remain unchanged in runtime regressions.
- [x] Enable independent-copy controls in `components/ChatWindow.tsx` and `hooks/useAgentSession.ts`; retain busy protection for in-session navigation and clone, verified by focused hook/runtime tests.
- [x] Add desktop/mobile browser coverage for a real blocked source prompt, historical-message fork, original prompt continuity, and child history; verify with `npm run test:e2e`.
- [x] Update `docs/session-internals.md` and `README.md` with the non-destructive behavior; run the isolated full core suite, typecheck, and lint, then review the exact diff. The session contract moved out of `AGENTS.md` in the new integration target.

## Non-Goals

- Changing clone, in-session navigation, or editing semantics.
- Copying partial unpersisted assistant output, running tools, queued messages, or blocking UI into the child.
- SDK/dependency changes, production builds, publication, or installed-service activation.

## Rollback / Recovery

Forks write new child files only; never rewrite source JSONL. Preserve the existing before-user-message versus through-selected-response boundaries, parent links, account selection, and model speed. Keep the feature resources if verification or local integration is blocked; do not stop a user's live session for testing.

## Verification Evidence

- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: 263/263 files and 1,693/1,693 tests passed; exporter contracts, route type generation, TypeScript, and lint passed. Artifacts: `/tmp/pi-web-test-offline.vXhRjzTY/artifacts/run-LSkQby`.
- `nix develop --offline --no-write-lock-file -c env E2E_RUNNING_FORKS_ONLY=1 npm run test:e2e`: desktop 1280×800 and mobile 390×844 passed, including before-message/root/quoted-response boundaries, independent child command completion, and original question replay/completion.
- `nix develop --offline --no-write-lock-file -c npm run test:e2e`: full browser suite passed after isolating fork fixtures in their own project and scrolling to the actual Language control rather than assuming it ends Settings. Earlier fixture-readiness, auto-send, virtualized-sidebar, and Settings-section-order failures were corrected in test code, not bypassed. Traces/screenshots/server log: `test-results/e2e/`.
- Read-only independent review found no concrete defects. `git diff --check` passed. Production builds, live provider calls, installed-service changes, and remote operations were not used.
- The original core run preceded the final browser-only fixture corrections. These results predate rebasing; fresh matching evidence follows.

### Rebased acceptance and retained diagnostics

The target advanced first to `c09460c1a8e2c9fb16a69a60235e6bfa28a05fbf`, then to `277db2349ede6a5e261a84ef3b6afc25083095d6`. Mechanical conflict resolution retained both trust/fork fixture sets, adopted the target's shared browser harness, and moved the fork contract into its new documentation owner. Runtime changes remain the same independent-copy implementation.

- Complete offline pipeline on committed `c4ba9c8bf4fe033de1390aadaaa0ab9f3f497f1b`: `node nix/test-offline.mjs` inside `nix develop --offline --no-write-lock-file` passed 267/267 files, 1,716/1,716 cases, exporter contracts, type generation, TypeScript and lint. Artifacts: `/tmp/pi-web-test-offline.4CrnhkhU/artifacts/run-5MJlGn`; retained bulk root: `/tmp/pi-web-test-offline.4CrnhkhU`. Wall time after shell entry: 143 seconds.
- Subsequent input is that commit plus the three-line fixture-only wait for visible **Steer** after returning to the source. Application code, common core-test files and the response-wait helper implementation are unchanged. This evidence/status update changes no tested behavior. `node --test lib/running-session-forks-e2e.test.mjs` passed 2/2 cases again after browser acceptance.
- `E2E_RUNNING_FORKS_ONLY=1 npm run test:e2e` inside the same offline Nix shell passed both viewports in 23 seconds. Artifacts: `test-results/e2e/browser-J61JsQ`; retained fixtures: `/tmp/pw-browser-VuRVTw`.
- Full `npm run test:e2e` passed, including both running-fork viewports, in 345 seconds. Artifacts: `test-results/e2e/browser-SZfAUc`; retained fixtures: `/tmp/pw-browser-WcuSpg`.
- `E2E_TRUST_ONLY=1 npm run test:e2e` passed both viewports in 25 seconds. Artifacts: `test-results/e2e/browser-EcCLYl`; retained fixtures: `/tmp/pw-browser-iGTU01`.
- Timings are command wall times excluding shell entry on this NixOS checkout, not portable performance comparisons; hardware measurements were not collected. Browser fixtures remain offline/private, at 1280×800 and 390×844.
- Independent review found an unobserved-response-waiter failure path; commit `c4ba9c8` fixes it without swallowing the original awaited rejection and adds its two regressions. Follow-up review found no remaining concrete defect.
- The first full rebased browser run failed on an immediate busy-action assertion before the warm-session GET completed (`test-results/e2e/browser-m87ItV`). A preliminary **Stop** readiness wait then failed because that button is inside collapsed mobile More controls, not because busy-state restoration was broken (`test-results/e2e/browser-xxwLS8`). The corrected visible **Steer** wait preserves the action assertions and original deadlines; both failed runs and their fixture roots remain retained.
- Initial preflight also refused a lingering generated lock. No active checkout server/lock holder was found; generated state was retained at `/tmp/pi-web-running-forks-preflight.3DCcRN`, with subsequent observed-released lock files retained in task-specific temporary directories. A later short-lived process/lock cleanup race delayed trust acceptance; the process exited and lock disappeared before the successful run. No installed service was stopped or restarted, and no feature, backup or retained-diagnostic cleanup was performed.

## Handoff

The maintained session contract is in `docs/session-internals.md`; browser fixture readiness and response-waiter safeguards are documented in `e2e/README.md`. This archived plan retains measured acceptance and failure evidence. The global `git-worktrees` lifecycle owns remaining documentation-only integration and separately approved feature/artifact cleanup through its exact-state tools and operation receipts. This handoff does not grant cleanup or publication authority.

## Completion Checklist

- [x] Focused runtime/hook tests pass, including busy source cases, invalid targets, and root/history boundaries.
- [x] Desktop/mobile browser checks prove independent child creation and source continuation without a live provider.
- [x] Isolated full core suite, TypeScript, and lint pass; verification scopes and retained failures are explicit.
- [x] Maintained documentation is accurate, diff reviewed, and feature committed.
- [x] Completion intent was resolved through `ask_user`; the later rebase-first request was honored before the user resumed integration.
- [x] Obtain exact-state approval, integrate the verified implementation into local `rst-main` by unsigned non-fast-forward merge, and verify the exact parents, tree and unsigned result at `e4ca21d914b0c49f44dbb5f3e50a0d60a1e82a56`.
- [x] Hand off remaining Git/cleanup obligations to their explicit current owner, the global `git-worktrees` lifecycle and exact-state operation receipts; no cleanup is claimed by this plan.
