# Non-destructive forks from running sessions

## Goal

Allow **New session** from a persisted user message while its source session is running, without stopping, replacing, or changing the source. Apply the same safe-copy behavior to **Ask in new chat** from a saved response.

## Context

The user requested this implementation. The existing fork paths already use separate `SessionManager` instances, but retain busy/replacement guards; `fork` additionally shuts down its source. No active plan owns these per-message actions. Work is isolated on `fix/fork-running-session`, based on local `rst-main` at `32a3469d6af4d276f790953c352ebf4fb60fedb6`.

## Plan

- [x] Remove replacement/busy behavior from `fork` and `fork_branch` in `lib/rpc-manager.ts`; verify source IDs, leaf, bytes, active work, and event subscription remain unchanged in runtime regressions.
- [x] Enable independent-copy controls in `components/ChatWindow.tsx` and `hooks/useAgentSession.ts`; retain busy protection for in-session navigation and clone, verified by focused hook/runtime tests.
- [x] Add desktop/mobile browser coverage for a real blocked source prompt, historical-message fork, original prompt continuity, and child history; verify with `npm run test:e2e`.
- [x] Update `AGENTS.md` and `README.md` with the non-destructive behavior; run the isolated full core suite, typecheck, and lint, then review the exact diff.

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
- The core run preceded the final browser-only fixture corrections; application/core-test inputs remained unchanged. Local `rst-main` advanced during validation, so any rebased candidate needs fresh relevant checks.

## Completion Checklist

- [x] Focused runtime/hook tests pass, including busy source cases, invalid targets, and root/history boundaries.
- [x] Desktop/mobile browser checks prove independent child creation and source continuation without a live provider.
- [x] Isolated full core suite, TypeScript, and lint pass; unavailable evidence remains explicit.
- [ ] Maintained documentation is accurate, diff reviewed, and feature committed.
- [ ] Completion intent is resolved through `ask_user`; integrate into local `rst-main` only after exact-state approval, or retain the feature unintegrated if requested.
