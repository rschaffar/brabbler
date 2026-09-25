# Session restart recovery

## Goal

After a pi-web server restart, reopen the selected chat from its saved transcript and visibly identify a *possible* interrupted prompt, without silently restarting work or implying that an in-flight tool action is safe to repeat.

## Context

`AppShell` already restores the per-tab chat selection. The RPC wrapper and prompt queues are in memory; a new process opens the session file as an idle session. Pi may acknowledge preflight before a new session file is flushed. A transcript ending with a user message is not an interruption marker. Retract the earlier idea that the last transcript role or `running: false` can identify an interrupted run.

## Plan Relationship

`docs/plans/2026-10-18_session-archive-plan.md` owns archive/restore, not restart recovery. Deletion must also remove this feature's recovery records.

## Architecture

Keep non-content, per-run start/settlement records outside Pi JSONL under the agent directory, keyed by session UUID and run UUID. Write a start at successful prompt preflight, before acknowledging the browser; write a settlement receipt when the prompt promise settles, not at `agent_end`. Never trust a stale start as proof of a crash: if its owner process still appears alive, or its outcome is not knowable, show no definitive crash claim. A start with no settlement after owner death means *possibly interrupted*. Separate receipts avoid competing read/modify/write on a session file. Recovery reads must not start the agent or append Pi entries. Acknowledgement hides a warning, not a run. Only IDs/timestamps/process identity are stored, never prompt text, tool arguments, or images.

## Non-Goals

- Automatically resume or replay model output, tools, queued follow-ups, or subagents.
- Reconstruct a newly created session if Pi never flushed its first JSONL file; a recovery record alone is not a chat transcript.
- Persist file viewer tabs, composer text/images, or terminal processes in this change; these are separate browser/PTY restoration features.
- Treat an SDK `agent_end` as the end of a prompt that might still retry or process queued work.

## Risks

- There is a narrow crash window between SDK preflight success and a durable start receipt, and another between SDK completion and settlement. The warning must say **may have been interrupted** rather than assert a lost prompt. SDK prompts deferred during `agent_settled` can resolve before their later execution; the enclosing pi-web prompt remains journaled while the SDK awaits deferred work, but a run initiated solely by an extension without a pi-web prompt is not covered.
- PID reuse or another live server can delay a warning; favor false negatives to avoid presenting a live run as crashed.
- JSONL can be missing for new sessions and session IDs may be invalid or attacker-supplied; validate IDs and don't derive arbitrary filesystem paths from them.
- Sidecar I/O errors must not change the already accepted SDK run result; report them to the server log and leave recovery status unknown.

## Rollback / Recovery

Records contain no transcript or credentials. Rolling back the feature leaves Pi JSONL intact; its sidecar directory may be removed manually after confirming no further need for interruption history. Deletion removes records for deleted session and child IDs. Never rewrite or auto-replay session history during recovery.

## Plan

- [x] Implement validated per-run start, settlement, acknowledgement, and classification in `lib/session-run-recovery.ts`; `node --test lib/session-run-recovery.test.mjs` passed (3 tests).
- [x] Hook prompt preflight and promise settlement into `lib/rpc-manager.ts`; `node --test lib/rpc-manager-shutdown.test.mjs` passed (accepted preflight journal evidence, no journal before acceptance or after settlement; existing rejected/overlapping admission cases).
- [x] Return recovery status in the session detail API, add acknowledgement route, and remove records on session deletion; `node --test app/api/sessions/runtime-route.test.mjs` passed (detail, wrong-ID rejection, acknowledgement, reload and deletion).
- [x] Show a persistent, translatable, dismissible possible-interruption banner in `components/ChatWindow.tsx` after saved history loads; `npm run test:e2e` passed with system Chrome at desktop/mobile widths, including reload, dismissal and saved history.
- [x] Document restart semantics in `README.md`; `npm test` (1329 passed), `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome) npm run test:e2e` passed in the linked worktree.

## Completion Checklist

- [x] A completed or rejected prompt creates no interruption warning; an unsettled accepted prompt from a dead server can be shown when the saved session is reopened, with no automatic execution (journal and route tests; browser flow).
- [x] Acknowledgement survives reload, deletion removes recovery records, and a live owner never produces a false crash warning (unit, route, and browser tests).
- [x] Required checks pass; implementation and operational behavior have a maintained documentation home in `README.md`.
