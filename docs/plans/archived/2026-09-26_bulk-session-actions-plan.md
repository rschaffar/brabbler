# Bulk session actions plan

## Goal

Allow an explicit, unobtrusive selection mode in the project session list to archive, restore, or permanently delete multiple session families.

## Plan Relationship

`2026-10-18_session-archive-plan.md` owns archive persistence and the original Archived view; this plan only adds bulk interaction using the existing per-session routes.

## Plan

- [x] Add opt-in family-root selection with Select all and a Done exit in `components/SessionSidebar.tsx`; sidebar assertions and desktop/mobile browser runs verify normal browsing, scope, and the hidden-by-default controls.
- [x] Execute selected IDs sequentially through existing PATCH/DELETE routes; `lib/bulk-session-actions.test.mjs` verifies ordering, deduplication, and partial failures; desktop/mobile browser runs verify an archive conflict is retryable, plus restore and count-based confirmed delete.
- [x] Add labels for supported locales in `lib/i18n/messages/`; typecheck and lint pass.
- [x] Run `npm test` (1,377 passing), `node_modules/.bin/tsc --noEmit`, `npm run lint`, focused `E2E_BULK_ONLY=1 npm run test:e2e`, and full `npm run test:e2e` (desktop/mobile); all pass with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome)`. The downloaded Playwright Chromium cannot start on this NixOS host without `libglib-2.0.so.0`.

## Non-Goals

- Selecting search results, Activity or Starred rows, or subagents separately.
- Server-side atomic batch writes or a project-wide batch endpoint; the explicit client selection is the operation snapshot, and successful actions cannot be rolled back automatically.

## Rollback / Recovery

Archives can be restored individually or in bulk. Deletions use the existing irreversible per-session route and cannot be undone; failed IDs remain selected and successes are reported rather than treating a partial batch as atomic.

## Completion Checklist

- [x] Selection controls stay hidden until Select is clicked, and exiting selection returns ordinary row navigation (sidebar assertions, focused browser test).
- [x] Bulk archive/restore/delete act on only selected visible family roots, delete always requires explicit confirmation, and partial failures are visible and retryable (helper test and focused browser test).
- [x] Required verification passes with system Chrome; current behavior is documented in `README.md`, and the feature diff was reviewed before committing.
