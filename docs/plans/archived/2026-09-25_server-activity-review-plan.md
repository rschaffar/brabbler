# Server-side activity review

## Closure — completed (2026-10-27)

Integrated lineage `8eb2d81` is on audited main. Later accepted Activity coverage
includes peer acknowledgement and reload persistence; native disk re-read remains
the accepted persistence proof, not a newly claimed full browser-server restart.
Current owners are `docs/feature-internals.md` and `docs/activity-testing.md`.
See the [closure evidence](../README.md#closure-evidence). Original pending checks
and integration notes below are historical, not an active queue.

## Goal

Make Pi Web-managed run completions and their Ready to review acknowledgements shared by devices using the same Pi Web server and agent directory. An acknowledged result must disappear on other devices, and unreviewed results must survive a Pi Web restart.

## Context

`lib/rpc-manager.ts` currently keeps the last 1,000 settled completions only in process memory; `lib/activity-review.ts` and `components/SessionSidebar.tsx` store per-session review timestamps and root/subagent unread IDs in browser localStorage. The existing `/api/agent/running` poll shares live state but not review state. Server-side stars already use versioned private files, stable-path locking, and atomic writes. The user chose to persist both completions and acknowledgements, not just read receipts.

## Non-Goals

Syncing navigation, drafts, layout, audio, theme, or model/tool preferences; reconstructing completions from external Pi CLI/Herdr sessions or uncertain restart-recovery records; pushing live events to inactive browsers. The store is shared only where devices use the same server/agent directory.

## Plan

- [x] Add `lib/activity-review-server.ts` with a versioned, private, locked and atomically written bounded completion/acknowledgement ledger. Evidence: `node --test lib/activity-review-server.test.mjs` passes six tests, including separate processes, file re-read, eviction, malformed storage and clock rollback.
- [x] Record settled completions through that store in `lib/rpc-manager.ts`, expose the same snapshot in `GET /api/agent/running`, and add a validated same-origin JSON acknowledgement endpoint. Evidence: `node --test app/api/activity/review/route.test.mjs app/api/sessions/runtime-route.test.mjs` passes; invalid, foreign-origin and unrecorded requests are rejected.
- [x] Derive root and subagent review markers from the server snapshot in `components/SessionSidebar.tsx`, acknowledge selected completions, reconcile other devices on visible-tab polls, and retry pending receipts. Evidence: `E2E_ACTIVITY_ONLY=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/etc/profiles/per-user/robert/bin/google-chrome npm run test:e2e` passed at 1280/700/390px; a separate browser context sees and then clears a result. Disk re-read tests cover the restart boundary; a full browser-server restart was not exercised.
- [x] Import timestamped legacy receipts only for recorded completions; drop unverifiable ID-only flags and document migration in `README.md`. Evidence: route import and store tests, and focused Activity E2E's assertion that old browser-local keys are gone.
- [ ] Run `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e` (Chrome path on NixOS); verify the exact feature tip, then request exact-state approval for the required non-fast-forward merge into local `rst-main`.

## Risks

The newest 1,000 distinct session completions are retained; older entries can age out even if unread. A corrupt or unwritable ledger must fail visibly rather than silently replace data or acknowledge an unrecorded run. Concurrent browser acknowledgements must never overwrite one another. Historic browser unread IDs without a retained settled completion cannot be faithfully migrated.

## Rollback / Recovery

The ledger is Pi Web-only metadata in `~/.pi/agent/pi-web/`; session transcripts and credentials remain untouched. Reverting the feature leaves that file intact for a future version; do not delete it as part of a rollback. A failed write leaves the previous file intact via atomic replacement; a failed read returns an error rather than replacing the file. No NixOS rebuild, remote push, or deployment is authorized by this plan.

## Completion Checklist

- [x] Store/API tests demonstrate monotonic multi-process acknowledgements, bounded durable completions, and safe malformed-file handling (six store tests plus route tests).
- [ ] Browser tests demonstrate another context clearing a read item and no false initial/backlog sound; repeat all required checks on the committed integration candidate.
- [x] `README.md` describes cross-device review semantics, 1,000-session retention, and migration; a full server-restart browser test is not included, but file re-read coverage verifies persistence.
- [ ] Exact-state approval and local integration comply with the repository Git profile; remote publication and cleanup remain separate approvals.
