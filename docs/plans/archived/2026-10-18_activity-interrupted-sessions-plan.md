# Interrupted sessions in Activity

## Goal

Show saved sessions with unacknowledged *possible* interrupted Pi Web prompts in a dedicated Activity overview section, so users can find them without opening each chat.

## Plan Relationship

The archived restart-recovery plan owns the durable journal and per-chat warning. The archived Activity plan owns live/review state. This change bridges those two existing features without changing the meaning of a settled prompt or restoring unsaved transcripts.

## Architecture

The journal supplies a read-only list of session IDs with a possibly interrupted run. A dedicated endpoint scans the small run-journal directory when Activity opens, regains visibility, or is refreshed; it does not reopen Pi sessions or run work. The browser intersects IDs with the existing session catalogue and applies Activity's archive/project filters. Precedence is live attention, working, queued, then interrupted, then browser-unreviewed completion. Selecting an interrupted item opens its saved chat; dismissing the per-chat warning refreshes Activity immediately. A hidden Activity panel does not poll. No journal contents, prompt text, or tool data enter the Activity payload.

## Non-Goals

- Discovering an unsaved new chat with no Pi JSONL file.
- Treating idle transcripts or stale subagent queue statuses as interruption evidence.
- Changing Activity's per-browser Ready to review semantics or auto-replaying prompts.

## Risks

- Scanning journals during the existing 2.5-second running poll would add unnecessary filesystem work: use an independent Activity-only refresh cadence.
- Dismissal, session deletion, and cross-tab changes must eventually remove rows; use immediate local refresh for dismissal and refresh on return to the page.
- A session with both live work and an older interrupted record must prioritize the live state; the old warning remains in the chat until dismissed.

## Plan

- [x] Add a read-only interrupted-ID listing to `lib/session-run-recovery.ts` and a dedicated API route; `node --test lib/session-run-recovery.test.mjs app/api/sessions/runtime-route.test.mjs` passes, with live/dead/acknowledged/missing journal cases.
- [x] Extend `lib/activity.ts` and `components/ActivityOverview.tsx` with a Possibly interrupted section, project filtering, selection and refresh; `node --test lib/activity.test.mjs` passes, including live precedence, archived/transient/uncatalogued exclusion and project filter.
- [x] Refresh Activity when the chat warning is dismissed and add translated labels and README guidance; `E2E_ACTIVITY_ONLY=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome) npm run test:e2e` passes at 1280px, 700px and 390px, including already-selected chat remount.
- [x] Run `npm test` (1344 passed), `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e` with system Chrome (all passed).

## Completion Checklist

- [x] Activity shows a saved interrupted session without visiting the chat; selecting it opens the warning and dismissing it removes the overview row (focused browser E2E).
- [x] Archived, unpersisted, live-owner and already acknowledged runs do not show as interrupted, and project filtering/other Activity statuses continue to work (unit, route and focused browser tests).
- [x] Required checks and focused browser tests pass; implementation behavior is documented in `README.md`.
