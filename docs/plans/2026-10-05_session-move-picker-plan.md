# Session move destination picker

## Goal
Improve only the existing Move to project destination picker with Project and Worktree/directory selection, including the current project. Keep the existing relocation endpoint and standalone worktree management unchanged.

## Plan Relationship
The Git Workflow removal is already merged. This bounded picker change does not revive any superseded Workflow plan or functionality.

## Plan
- [x] Add proposal-only destination controls using GET /api/worktrees, exact-directory exclusion, loading/error handling, cancellation and Browse.
- [x] Cover same-project and other-project worktrees, current directory, plain/Browse destinations and pending project switching in focused tests and desktop/mobile browser checks. Snapshot Browse's initial path so a pending listing cannot reset its navigation.
- [x] Run focused then full tests, typecheck and lint without production builds; review the small change. Focused disposable checks passed 30/30; full isolated checks passed 228 files and 1,493 tests (before the Browse snapshot fix, subsequently browser-tested). After that fix, npm test passed 1,494/1,494, tsc --noEmit and npm run lint passed. Final exact-tip verification belongs in the local lifecycle receipts.

## Completion Checklist
- [x] Confirm the move route and relocation implementation are unchanged and busy-session restrictions remain.
- [ ] Obtain exact-state approval of the verified feature and rst-main tips for an unsigned non-fast-forward local merge. Integration remains pending; publication and feature cleanup are separate approvals. Retain this plan until the local approval handoff is resolved.
