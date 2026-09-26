# Move sessions between projects

## Goal

Move a persisted session and its subagent descendants to another selected project, preserving their IDs, transcripts, and parent/fork links. Independent forks stay in their existing projects.

## Plan Relationship

The session archive plan owns archive/restore; this plan owns relocation only. Neither operation should silently change the other.

## Assumptions

- The destination is an existing directory selected as the new session cwd; worktree project identity continues to be resolved by the existing project resolver.
- A move is refused while any member of the family is running. The selected session and its nested subagents move together; independent forks remain where they are and retain their origin link.

## Risks

- JSONL files, parent paths, and in-memory session managers must change together; a partial move could hide sessions or break forks. Validate all paths and prepare rewritten files before replacing originals. Keep originals until new files are in place; restore them on failure.
- Another Pi process can write session files independently. Reject changes to the source files detected between preparation and finalization; cross-process writes during the final rename window are not coordinated by Pi Web.

## Rollback / Recovery

On failure before commit, remove staged destinations and leave original files intact. If finalization fails, restore original files from staged copies and report the error rather than silently claiming a move. Original transcripts remain recoverable until successful completion.

## Plan

- [x] Implement a validated, collision-safe move service for persisted JSONL family and external fork references in `lib/`; focused `move-route.test.mjs` covers nested paths, fork repair, collision, running and queued rejection.
- [x] Add the session move route with destination validation and idle-only wrapper shutdown; `move-route.test.mjs` passes.
- [x] Add destination selection and explicit confirmation to sidebar actions; `SessionSidebar.test.mjs` checks destination options, browse, touch action, and selected chat handling. Browser E2E remains open below.
- [x] Document behavior in `README.md` and `AGENTS.md`; `npm test` (1,374 passing), `node_modules/.bin/tsc --noEmit`, and `npm run lint` passed after the queue-safety change.
- [x] Verify affected desktop and mobile browser flows with `E2E_MOVE_ONLY=1 npm run test:e2e` and a temporary `LD_LIBRARY_PATH` assembled from available x86-64 Nix store libraries; both move flows passed.
- [x] Run the full `npm run test:e2e` with the same temporary library path: desktop and mobile flows, including the mobile move, passed after returning to Active sessions before moving the restored fixture.

## Verification note

The scroll-restoration assertion at `e2e/run.mjs:553` timed out twice on earlier runs before reaching the move flow; a later run passed it without changes to that test or product scroll logic. This was timing-sensitive, **not** evidence that move blocked restoration. The subsequent run exposed an error in this plan's own E2E test: after restoring the archived fixture, the sidebar remained in Archived view. The test now returns to Active sessions before moving; the complete suite passes. No scroll behavior was changed by this feature.

## Completion Checklist

- [x] Session and subagent files open under the new cwd and appear in the destination project; forks still resolve their origin and retain their cwd (`move-route.test.mjs`).
- [x] Running and queued sessions and destination collisions do not modify files (`move-route.test.mjs`); transient sessions are refused by the move service and lack a sidebar action.
- [x] Unit tests (1,374 passing), typecheck, lint, focused desktop/mobile browser moves, and the full browser suite passed. The intermittent scroll assertion remains noted above.
