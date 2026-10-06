# Persistent interaction cards

## Goal

Keep completed questions and approval cards in branch-aware chat history as collapsed, read-only receipts, including the exact displayed diffs, with no durable UI state or separate store. Implementation is authorized by the user's request; integration and cleanup require separate approval.

## Plan Relationship

Extends the completed inline-question-card presentation plan. The browser-ask-user plan retains ownership of the tool contract; Git plugin execution and policy remain unchanged.

## Architecture

The shared extension UI settlement boundary appends one versioned `pi-web:interaction-receipt` custom session entry and emits that entry to the browser before closing the request. Custom entries do not enter model context. Session history projects only recognized receipts to display messages. Live forms retain drafts; historical cards retain only local expansion state and unmount their bodies while collapsed. Approval receipts describe decisions, never execution success.

## Plan

- [x] Persist normalized decisions and exact displayed request payloads for answered, cancelled, expired and aborted interactions; verify with extension-UI tests.
- [x] Project receipt entries through branch-aware, paginated history and deduplicated live delivery; verify SDK reload/model-context and hook tests.
- [x] Render reusable read-only card contents with lazy historical diffs; verify component and desktop/mobile browser tests.
- [x] Update maintained documentation; run full developer tests, typecheck, lint and affected browser acceptance.
- [ ] Commit reviewed feature changes and present an exact verified non-FF integration candidate for local `rst-main` approval.

## Non-Goals

No backfill of lost historical approval payloads, pending-request recovery across server crashes, additional state database, persistent expansion preferences, Git policy changes, SDK HTML-export renderer changes, deployment or remote publication.

## Rollback / Recovery

Entries are additive and use the existing session tree. Older versions ignore unknown custom entries. Reverting the feature leaves saved receipts intact but hidden. Unsettled requests still use existing in-memory replay; abrupt process loss cannot create a completed receipt. No historical session rewriting.

## Completion Checklist

- [x] Completed cards survive reload, retain exact patches and cannot submit again.
- [x] Invalid/stale responses create no receipts; duplicate delivery does not duplicate cards; abandoned branches remain hidden.
- [x] Relevant automated verification passes or remaining failures are explicitly reported.
- [ ] Feature is committed, with no integration/deployment/publication inferred from implementation authorization.

## Evidence

Feature worktree: `../pi-web-worktrees/persistent-interaction-cards`, branch `feat/persistent-interaction-cards`, starting at `b79e8239e96c9437f553639c72804c631647ac03`.

On the implemented working-tree source before rebasing onto the latest local target:

- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: all 239 files and 1,563 tests passed; exporter contracts, type generation, typecheck and lint passed. Log: `/tmp/pi-web-receipts-full-acceptance.log`.
- Contributor baseline in a private HOME/agent environment with four-CPU affinity: `npm test` passed 1,564 tests, `node_modules/.bin/tsc --noEmit` passed, `npm run lint` passed. Log: `/tmp/pi-web-receipts-baseline.log`.
- `nix develop --offline --no-write-lock-file -c npm run test:e2e`: full desktop/mobile suite passed, including ordinary extension dialogs, questions, warm-session recovery and branch navigation. Log: `/tmp/pi-web-receipts-browser-final-4.log`.
- `nix develop --offline --no-write-lock-file -c env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e`: desktop/mobile exact historical patches, read-only collapse/reload, rejection, reconnect and Stop passed. Log: `/tmp/pi-web-receipts-git-final.log`.

Read-only review found reconnect/canonical-read races, ordinary-message duplication, mutable caller parsing, sibling-branch receipt delivery and omitted subtitles. Regression coverage now exercises deferred reads, canonical branch advancement, explicit navigation supersession, full server ancestry checks beyond the visible tail, detached request parsing and saved subtitles. Full-browser testing also caught warm-cache restoration and selectors that matched earlier hidden receipts; both were corrected without increasing native expiry deadlines.

Feature commit, rebase onto current local `rst-main`, exact-candidate verification and approval presentation remain pending. No integration, deployment, remote operation or feature-resource cleanup is authorized.
