# Hidden projects in Activity

## Goal

Persist project concealment for screen sharing and reveal hidden Activity rows only through a temporary eye control. Implementation authorized by the user's “alright. implement”.

## Architecture

A private versioned server file stores canonical project keys, independently of sessions and archive state. Per-key writes re-read under a file lock and replace atomically. AppShell owns shared privacy state for General Settings and Activity. Unknown or failed privacy state withholds Activity content. Hidden project families are excluded before grouping, counts and project options are derived. Reveal is component-local, never persisted, and resets when leaving Activity (including mobile chat navigation).

Settings → General → Privacy lists searchable known projects plus saved hidden keys no longer in the catalogue. Switches save immediately. Other views and notifications remain unchanged.

## Plan

- [x] Add validated GET/POST privacy API and private locked store. `app/api/hidden-projects/route.test.mjs` verifies missing/corrupt files, concurrent per-key writes, restart reads, permissions and request security.
- [x] Add shared client state, searchable Privacy settings and all three bundled locale labels. `components/ProjectPrivacySettings.test.mjs` and focused browser acceptance verify persistence, search, safe loading/write failures and delayed GET/save races.
- [x] Add Activity family filtering and eye reveal. `lib/activity.test.mjs` and `components/ActivityOverview.test.mjs` verify all statuses, canonical worktrees, cross-project descendants, unresolved identities/ancestry and no private DOM/counts. Browser checks verify filter and reveal resets.
- [x] Update maintained `README.md` and `e2e/README.md`. No demo API change is required: the separately copied demo does not have Activity; expanding that older UI is outside this feature.
- [x] Run focused and full verification without production builds: full `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs` passes 256 files / 1,645 tests, type generation, typecheck and lint. Direct `node_modules/.bin/tsc --noEmit` and `npm run lint` also pass. Full `npm run test:e2e`, `E2E_ACTIVITY_ONLY=1`, and `E2E_PROJECT_PRIVACY_ONLY=1` pass through the Nix shell; focused browser checks cover 1280×800, 700×800 and 390×844.
- [ ] Commit the reviewed feature and request exact-state integration approval for local rst-main using an unsigned non-FF merge.

## Non-Goals

Global screen-sharing mode, sidebar/Starred/chat redaction, notification suppression, authentication changes, remote publication and cleanup.

## Risks

Settings failure must fail closed rather than treating corruption as an empty hidden list. Stale GET responses must not overwrite a newer switch save. Cross-project subagent labels must not expose a hidden ancestor. Settings synchronizes other clients on visibility/focus and periodic visible polling, not instant cross-device delivery.

## Rollback / Recovery

Revert the feature source to remove the UI; preserve the private hidden-projects file. Unhide projects through Settings to reverse concealment without affecting agents or review receipts. Corrupt private storage reports an error and is never silently overwritten.

## Verification Notes

The first full browser run failed in the new fixture because an awaited mocked registry poll raced a page reload (`Route is already handled`). The fixture now captures its registry snapshot before interception and fulfills each poll immediately. Full and both focused browser runs subsequently passed. The original failure artifacts remain at `test-results/privacy-full-failure-8Mk6rl/` in the feature worktree.

Review also caught provisional cwd-only worktree rows: these and orphan ancestry are withheld while any project is hidden, and unresolved project paths are not writable settings entries. Their regressions pass. No terminal integration changed; terminal acceptance is not applicable.

## Completion Checklist

- [x] Conceal/reveal and persisted switches meet the approved Activity-only design.
- [x] Required verification passes; the corrected fixture failure is documented above.
- [ ] Feature history and exact candidate are ready for separate integration approval; no remote or cleanup operations performed.
