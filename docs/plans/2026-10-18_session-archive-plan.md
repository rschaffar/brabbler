# Session archive plan

## Goal

Add a reversible archive action alongside permanent deletion. Archived sessions remain in their Pi JSONL files, disappear from the default session list and content search, and remain available in an Archived sidebar view for restore or delete.

## Plan

- [x] Add versioned, append-only archive metadata and ensure full and summary session scans preserve it through the private index; `lib/session-list-scanner.test.mjs` passes.
- [x] Extend session PATCH with archive/restore, reject transient and running sessions, and verify API persistence, list-version refresh, and errors in `runtime-route.test.mjs`.
- [x] Hide archived session families from the active sidebar and session-content search; add an Archived view with restore and delete actions and handle selection cleanup.
- [x] Add archive/restore labels in supported locales and keep the interactive demo mock session list/route/search consistent.
- [x] Run `npm test` (1316 passing), `node_modules/.bin/tsc --noEmit`, and `npm run lint` (all passing).
- [ ] Run `npm run test:e2e` in an environment with Chromium's `libglib-2.0.so.0` available; here browser launch failed before UI tests.

## Assumptions

- Archive applies to a top-level session/fork family, not individual subagent rows.
- Archive state is Pi-web metadata in the existing JSONL transcript; no file moves or changes to Pi's parent/fork structure.
- An active run cannot be archived until it is idle, avoiding competing writes to an append-only session file.

## Risks

- Summary listing and scan-index reuse can accidentally show stale archive state unless archive metadata is indexed and session-list caches are invalidated.
- Session search and project activity consume the broader session catalogue; archived items must not leak into the normal search or active listing.

## Completion Checklist

- [x] Archived sessions can be hidden, found in the Archived view, restored, and permanently deleted without changing transcript content or fork relationships (route/scanner tests and sidebar assertions).
- [ ] Browser E2E verification remains blocked by the missing `libglib-2.0.so.0` shared library; unit tests, typecheck, and lint pass.
