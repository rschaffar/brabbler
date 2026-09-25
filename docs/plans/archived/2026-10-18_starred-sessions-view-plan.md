# Separate Starred sessions view

## Goal

Give starred chats a dedicated top-bar ⭐ view separate from ◉ Activity, while keeping an always-visible star beside starred session titles in each project's session list.

## Plan Relationship

The archived Activity plan introduced the starred list and browser-local star storage. This change moves its view, not its persistence or the active Needs you/Working/Queued/Possibly interrupted/Ready grouping. The sidebar's star/unstar action remains intact.

## Architecture

`AppShell` owns one mutually exclusive center-panel view (`activity` or `starred`) and one mobile list/chat navigation state. The new `StarredOverview` reads the existing `useStarredSessions` hook, filters the current session catalogue by project, and reuses the Activity panel layout without showing Activity statuses or fetching interruption data. `ActivityOverview` retains only its live/review sections. `SessionSidebar.SessionItem` renders a passive star marker in the title regardless of hover/touch controls; browser-local storage and cross-tab events remain the source of truth.

## Non-Goals

- Changing the star storage format, cross-browser sync, or how session families are grouped.
- Turning stars into Activity notifications, or moving an archived session's file.
- Adding a new URL route or server endpoint for a browser-local view.

## Risks

- Mobile back/close behavior must work independently for both views; switching between buttons must be exclusive without hiding the wrong list.
- The project selector must still show a selected project even after its final star is removed, and starring/un-starring in either view must update the sidebar promptly.
- Restored selected chat and existing Activity review semantics must not remount unexpectedly when opening Starred.

## Plan

- [x] Extract the starred list from `components/ActivityOverview.tsx` into `StarredOverview` with project filter, selection and unstar; focused Activity/Starred E2E confirms separate panels and cross-project filtering.
- [x] Add a mutually exclusive ⭐ top-bar toggle, mobile back/close behavior and always-visible sidebar row marker in `AppShell.tsx`/`SessionSidebar.tsx`; focused E2E passes at 1280px, 700px and 390px, including reload and unstar.
- [x] Update translations and `README.md`; `npm test` passes (1354/1354), `node_modules/.bin/tsc --noEmit` and `npm run lint` pass, and both full and focused `npm run test:e2e` pass with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome)`.

## Completion Checklist

- [x] The focused browser E2E checks ★ without hover, restoration after reload and disappearance after unstar.
- [x] The focused browser E2E checks distinct Starred and Activity views, two-project filtering and mobile navigation.
- [x] Required unit, type, lint and browser checks pass. `README.md` owns current behavior. The default downloaded Playwright shell cannot launch on this NixOS host without `libglib-2.0.so.0`; the system Chrome override passed both browser suites.
