# Server-persisted session stars

## Goal
Store session stars on the Pi Web server so they survive browser resets and are shared across browsers using the same server.

## Architecture
The server owns a small versioned JSON file under the Pi agent directory. A guarded API reads stars and applies per-ID set/unset or a one-time legacy-browser import (union). The browser hook loads from the API and imports its old localStorage list once; the legacy list is removed only after a successful import. Changes from other browsers refresh on focus/visibility; sidebar and Starred view share one in-tab snapshot. The server serializes writes with a file lock and replaces the JSON atomically.

## Risks
A second browser with old local stars can import an outdated star once and reintroduce it. This tradeoff preserves legacy stars across browsers; subsequent edits use the server alone. Server read/write errors should not erase existing stars.

## Rollback / Recovery
The new file is independent of sessions and can be backed up or removed. Old localStorage is cleared only on confirmed import, so failures remain retryable. A rollback to an older Pi Web does not automatically copy server stars back into browser storage.

## Plan
- [x] Implement validated read and serialized atomic per-ID mutations/import in `lib/starred-sessions-server.ts`; route tests cover concurrent writes, corruption and union import.
- [x] Expose guarded GET/POST in `app/api/starred-sessions/route.ts`; route tests cover validation and persisted responses.
- [x] Move `hooks/useStarredSessions.ts` to server-backed reads/writes and legacy import; focused `E2E_ACTIVITY_ONLY=1 npm run test:e2e` passes at 1280px, 700px, and 390px.
- [x] Update `e2e/activity.mjs`, `README.md` and `AGENTS.md` for server persistence and migration; the focused browser test covers import, server writes, and reload.

## Completion Checklist
- [x] `npm test` (1358 pass), `node_modules/.bin/tsc --noEmit`, `npm run lint` pass.
- [x] `npm run test:e2e` passes (full suite; first run timed out on unrelated scroll restoration, retry passed). On NixOS, `LD_LIBRARY_PATH` was assembled from lib directories in the existing Nix Playwright test store closure so Chromium could load.
- [x] Feature commit reviewed and ready for exact-state integration approval; integration itself still requires separate approval under `AGENTS.md`.
