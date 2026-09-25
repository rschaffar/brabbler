# Agent Activity overview

## Goal

Show Pi Web-managed sessions and subagents in a cross-project Activity view: actual requests for human input, work in progress, live queued subagents, and results not yet reviewed in this browser. Keep the chat alongside the queue on desktop and provide a list-to-chat path on mobile.

## Plan Relationship

`2026-09-25_browser-ask-user-plan.md` owns dialog behavior; this plan only surfaces its outstanding requests elsewhere. `2026-10-18_session-archive-plan.md` owns archive state; archived families stay out of Activity. Neither plan's outstanding browser-suite check is claimed here.

## Architecture

Reuse the existing session catalogue and visible-tab running poll. Expose a registry-only pending-blocking-request snapshot from `lib/rpc-manager.ts` in `/api/agent/running`; it must not load session files or create wrappers. Prefer real pending requests over running/unread states. A bounded in-memory completion ledger covers turns shorter than the poll interval; a first-browser baseline and cross-tab per-browser acknowledgement prevent replaying historical or reviewed runs. Browser-observed transitions remain a fallback for non-prompt work. The selected session's existing `ChatWindow` owns answering; the overview must not establish SSE connections for every row. Project identity uses `workspaceKeyOf`, not a displayed cwd.

## Non-Goals

External Pi CLI, Herdr and remote agents; transcript-wide historical completion inbox; push notifications; new answer protocols; automatic integration or publication.

## Plan

- [x] Expose pending human-input IDs and safe reason summaries from the in-process wrapper registry; `lib/rpc-manager-extension-ui.test.mjs` covers answer, expiry, Stop, custom close, teardown, and `runtime-route.test.mjs` verifies registry-only snapshots.
- [x] Feed snapshot and browser-local completion markers from `SessionSidebar` to `AppShell`, including subagent transitions without falsely marking all idle sessions unread; `lib/activity-review.test.mjs`, sidebar tests, and focused browser tests cover first-browser baseline, short runs, reload and two-tab acknowledgement.
- [x] Add pure Activity grouping and precedence logic (needs you, working, queued, ready to review), filter by project and archive state, nest selectable subagents; `lib/activity.test.mjs` covers precedence, nesting, stale queues, project identity and archives.
- [x] Add accessible, localized Activity UI and badge to `AppShell`, retain chat in a desktop split and provide a mobile list-to-chat/back path; `E2E_ACTIVITY_ONLY=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome) npm run test:e2e` passes at 1280px, 700px and 390px.
- [x] Document the Pi Web-only status boundary in `README.md`/`AGENTS.md` and focused browser flow in `e2e/README.md`; `npm test` (1327 passing), `node_modules/.bin/tsc --noEmit`, `npm run lint`, focused and full `npm run test:e2e` pass with system Chrome.

## Risks

Out-of-order polls must not erase newer attention state. A pending dialog can remain after a running flag changes; attention takes precedence. A subagent may finish while its parent keeps running. Browser-local review state may disappear on refresh if not persisted. Avoid promoting unknown external sessions to working/done.

## Completion Checklist

- [x] A background Pi Web session with a live blocking request appears under Needs you and opens its existing dialog; answering removes it without falsely reporting completion (focused browser run).
- [x] Root/subagent running and queued states, short completed results, nesting, project filtering and archive exclusion are covered by pure tests and focused browser navigation; subagents do not produce a completion sound.
- [x] Desktop, compact desktop, mobile and required checks pass with system Chrome; work remains on isolated `feat/agent-activity` for review.
