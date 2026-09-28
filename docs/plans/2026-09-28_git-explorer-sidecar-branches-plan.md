# Git Explorer sidecar and local branch browsing

## Goal

Keep the selected worktree's read-only Git graph and commit/diff detail adjacent in a wide panel beside chat, with a local-branch selector defaulting to the worktree's checked-out branch and copy controls for full commit ID and message.

## Plan Relationship

The completed worktree Git Explorer plan introduced checkout-HEAD-only browsing in the sidebar and a separate file tab. This follow-up owns the layout and explicit local-branch read boundary; it does not change session Git review or integration approvals.

## Architecture

The selected physical worktree still determines filesystem authorization. Requests for another local branch resolve its exact `refs/heads/` name and capture its tip; pagination, commit and patch reads recheck that ref and restrict objects to the captured tip. Selecting a branch never checks it out. The new top-bar Git panel is separate from chat-bound Git controls and uses the sidebar's selected checkout, not the selected chat's cwd. On desktop the wide panel holds graph and diff in neighboring scroll regions beside the chat; on mobile the list and detail are successive views.

## Non-Goals

No arbitrary OID browsing, remote refs, Git checkout/fetch/writes, persistent branch preference, change to file/terminal tabs, or worktree cleanup.

## Plan

- [x] Extend `lib/git-explorer.ts` and the GET route for exact local-branch/tip anchoring. Focused Node tests pass for divergent, stale, unknown and nonlocal branches; the selected ref is rechecked around each read.
- [x] Move graph/detail to the wide top-bar Git panel; remove the sidebar Git toggle/commit tabs. Focused browser E2E passes branch switching (including a delayed old response), checkout switching, copy controls, adjacent desktop layout, intermediate widths and mobile list/detail navigation.
- [x] Update `README.md`, `docs/worktrees.md`, and `AGENTS.md` with the panel, read-only local branch selector and captured-tip boundary.
- [x] Run final `npm test` (1,538 pass), `node_modules/.bin/tsc --noEmit`, `npm run lint` and full `npm run test:e2e` (all pass). Full browser runs first hit unrelated scroll-restoration and provider-account settings timeouts; both passed on an unchanged retry. Focused browser and API checks also pass.

## Completion Checklist

- [x] A selected worktree opens on its checked-out branch and can read a divergent local branch without changing any Git ref or checkout; stale ref and unreachable commit requests fail closed (focused Node and browser E2E).
- [x] Desktop graph and commit/diff share one panel alongside chat; mobile list/detail navigation and individual copy buttons work; file/terminal tabs remain independent (focused browser E2E).
- [ ] Feature candidate is committed and verified on a dedicated linked worktree; local non-FF integration into `rst-main` requires separate exact-state approval. Publication and cleanup are separate.
