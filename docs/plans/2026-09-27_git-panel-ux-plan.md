# Git panel and worktree-switching UX

## Goal

Make the three top-bar Git icons open their content in one click, styled and positioned like Activity, and replace the repeated per-worktree Continue/Fork button list with a single destination selector and contextual actions.

## Plan Relationship

The agent Git review plan owns the agent tool and future cleanup transaction. The separately integrated worktree Git Explorer owns project-level history; this plan changes only the manual session Git controls. It preserves session checkout identity, confirmation boundaries, policy saving, and existing Git routes.

## Plan

- [x] Present Workspace workflow, Review & commit, and Local integration review as Activity-like side panels, open immediately from their own top-bar icons; keep chat/session-bound behavior and mobile accessibility. Evidence: `GitToolbarPlacement.test.mjs` and the 1280px/390px `E2E_GIT_WORKFLOW_ONLY=1 npm run test:e2e` fixture pass.
- [x] Replace the worktree list in `GitWorkflowSettings` with a labeled select showing registered worktrees, current checkout context, one Continue and one Fork action, and unchanged per-action confirmation and safety guards. Evidence: focused move/fork tests and the browser fixture (including selection-change cancellation) pass.
- [x] Update `docs/git-workflow.md`, `docs/worktrees.md`, `README.md`, `AGENTS.md`, and affected test expectations for the new UI without changing approval or backend semantics.
- [x] Run `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e` on the feature tree. Evidence after rebasing onto the Git Explorer: 1,526/1,526 unit tests, typecheck, lint and full browser E2E pass (including both Explorer and Git-panel flows). No production build.

## Non-Goals

- No general project commit-history browser, agent-driven worktree cleanup, branch deletion, changed Git authorization, or remote operation.

## Completion Checklist

- [x] One click on each Git icon reveals its complete Activity-style side panel with no second disclosure link; closing it restores the chat on desktop and mobile. Evidence: Git browser fixture and panel placement test.
- [x] A single registered destination can be selected; continuation and fork remain distinct, idle-only, explicitly confirmed operations tied to the real session cwd. Evidence: move/fork tests and Git browser fixture.
- [x] Repeat required checks on the committed feature tip; integration into local `rst-main` still requires separate exact-state approval. Evidence: the original feature tip passed all four `git workflow verify` checks. After rebasing onto the Git Explorer, `npm test`, `tsc --noEmit`, lint, and full E2E passed again on feature tip `eca3c69fb8ce180170a6fbeb46ae9d434b062dce`.
