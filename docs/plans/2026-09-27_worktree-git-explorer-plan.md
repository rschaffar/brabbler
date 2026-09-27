# Worktree-scoped read-only Git Explorer

## Goal

Let a user choose a worktree in the sidebar, then browse its current branch's visual commit graph, commit metadata, changed files and per-file patches without opening or modifying a chat. No integration policy, remote request, Git mutation or additional server.

## Plan Relationship

`2026-09-27_agent-git-review-plan.md` owns session-bound approvals and still has an open cleanup transaction. This plan owns only independent, read-only worktree history; it does not replace guarded integration review.

## Architecture

- A Git Explorer beside File Explorer consumes the sidebar's effective worktree cwd (`selectedCwd`), never the open chat's saved cwd or integration target. Worktree changes invalidate in-flight history and details. Show local checked-out branch HEAD ancestry (including merged parents), with bounded incremental pages and a refresh to pick up new commits.
- New GET routes validate the physical checkout against Pi Web's file-root allowlist and Git's checkout top-level. Git is executed without a shell, inherited Git override environment, external diffs, textconv, or pager. Full OIDs and a captured HEAD bind pagination/detail/patch requests. Only commit OIDs reachable from that HEAD may be inspected; file patches must match a path returned by the commit's own changed-file listing. Bounded metadata, page size, and patch output fail closed, not truncated.
- Adapt only the MIT-licensed active-lane graph layout from [binaryplease/git-graph](https://github.com/binaryplease/git-graph/blob/main/shared/graphLayout.ts), preserve attribution/license, and render graph rows locally. Do not embed its Bun/Elysia server, copy its checkout actions, or require its unpublished private package. Existing Git review's `getGitTreeDiff` is a reference for safe diff flags and bounds. Prefer a small in-app patch display for the first slice; `@git-diff-view/react` (MIT) is an optional future renderer if it proves worthwhile.

## Non-Goals

- No writes, switching branches from the graph, fetch, remote publication, worktree removal, session relocation, or integration approval.
- No all-ref/global DAG selector, arbitrary OID lookup outside selected HEAD, file blame, or editing historical files in this slice.
- No promise of atomicity against external Git writers or verified Windows behavior.

## Plan

- [x] Add bounded, session-independent worktree history/commit/file-patch helpers and GET routes; verify allowlist/physical-root, OID membership, first-parent merge semantics, root commits, ref staleness, binary and oversized patches in disposable-repo tests. Evidence: `node --experimental-strip-types --test app/api/git/explorer/route.test.mjs lib/git-explorer.test.mjs`.
- [x] Adapt and attribute the small MIT graph layout; test merges, disconnected visible tips, truncated pages, and lane stability when older pages append. Evidence: `lib/git-graph-layout.test.mjs` in the focused test run; MIT notice included in the npm file list.
- [x] Add a responsive Git Explorer view alongside File Explorer, showing graph rows, paging and commit metadata/changed files/on-demand patches in a right-panel tab; test selection based on worktree cwd even while another chat stays open, stale response cancellation, and no-session access. Evidence: focused `E2E_GIT_WORKFLOW_ONLY=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=... npm run test:e2e` passes checkout switching while an old history request is delayed, no-session browsing, mobile sidebar bounds, and existing Git workflow flows.
- [x] Update `README.md`, `docs/worktrees.md`, and `AGENTS.md` with actual UI and boundaries; verify focused tests, `npm test` (1,526 passing), `node_modules/.bin/tsc --noEmit`, `npm run lint`, and full browser E2E (including merge inspection). Never run a production build.

## Completion Checklist

- [x] From a selected checkout without a chat, navigate the current local branch's graph and inspect a merge/root/ordinary commit's file patch, without mutation or remote access. Disposable-repo tests cover all three; browser E2E covers ordinary and root in a no-chat checkout and merge after explicit local integration.
- [x] Switching the sidebar worktree changes Git Explorer but not an already open chat or its integration target; stale responses never render in the new checkout. Browser E2E intercepts and delays a refresh while switching checkout.
- [ ] The verified exact feature candidate is committed in a linked worktree; local integration into `rst-main` requires a separate exact-state approval. Cleanup and publication remain separate.
