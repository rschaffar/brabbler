# Navigable question sets

## Goal

Implement the approved chat design: one `ask_user` call can present 1–6 related independent questions, with mixed single/multiple/text answers, free navigation, review and atomic submission. Every batch question supports a written alternative main answer and separate additive details. Keep legacy single-question calls compatible.

## Plan Relationship

Extends the browser-ask-user contract and persistent-interaction-card receipt mechanism; does not replace their lifecycle or own their outstanding verification/integration obligations. User authorized implementation in a linked worktree, not integration, publication or cleanup.

## Architecture

- Add a bounded ID-based question-set contract and pure whole-set validation. The existing tool accepts either legacy `question` or `questions`, never both.
- Carry batches through a distinct internal `ask_user_batch` request on the existing pending UI/receipt lifecycle. No partial results, conditional branching or new server store.
- A navigable inline card owns draft answers, review, explicit cancellation and retry. Same-tab sessionStorage recovery is scoped to session, request and immutable question payload. Settlements clear drafts.
- Alternative text replaces the main choice(s); additional details accompany either choice(s) or text. Optional skip is explicit and distinct from an empty multi-selection.
- Existing single questions retain their shape; additive comments also work with freeform answers.

## Plan

- [x] Implement schema, bounded normalization, atomic server validation and redacted tool events; focused unit/runtime tests pass.
- [x] Implement accessible desktop/mobile navigation, review, alternatives/details, cancellation and draft recovery; desktop/mobile browser tests pass.
- [x] Extend history receipts and attention routing; replay, timeout/Stop, duplicate submissions and read-only receipt tests pass. Reconnect carries authoritative pending IDs; acknowledgement waits are bounded.
- [x] Document the contract, storage limits and agent guidance in `docs/questions.md`; full unit, typecheck, lint and browser acceptance pass without a production build.
- [ ] Review and commit the feature, then present the exact verified local non-FF integration candidate for approval.

## Non-Goals

Conditional questions, cross-device drafts, pending-request recovery after server restart, external Pi TUI changes, deployment and remote publication.

## Rollback / Recovery

Additive request/receipt variant; older app versions ignore unrecognized receipts. No history migration. Browser drafts are session-local and bounded, never model context; server restart still ends pending requests. Reverting leaves completed receipt data on disk without granting historical tool authority.

## Completion Checklist

- [x] Mixed sets preserve every draft through navigation, collapse and same-tab refresh.
- [x] Alternative main answers and additive details reach both model results and history intact.
- [x] Only explicit whole-set submission settles; invalid/partial/stale answers cannot release a subset.
- [x] Single-question compatibility, desktop/mobile keyboard flows and failure recovery pass.
- [x] Verification evidence and limits are recorded below; integration and cleanup remain separately approved.

## Verification evidence

Worktree `../pi-web-worktrees/question-sets`, branch `feat/question-sets`, base `b86d47c791e28309c9f110c4cbfa04f3a6643e23`.

On the final application working-tree source before this evidence-only plan update:

- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: all 254 files and 1,634 tests passed; exporter contracts, type generation, typecheck and lint passed. Log `/tmp/pi-question-sets-full-final.log`.
- `npm test && node_modules/.bin/tsc --noEmit && npm run lint` inside the Nix shell with private HOME/XDG/agent/TMP and four-CPU affinity: 1,640 tests passed; typecheck and lint passed. Log `/tmp/pi-question-sets-baseline.log`.
- `nix develop --offline --no-write-lock-file -c npm run test:e2e`: full desktop/mobile suite passed, including the real 15-second acknowledgement-timeout/retry path. Log `/tmp/pi-question-sets-e2e-final.log`.
- Terminal acceptance is not applicable: no terminal integration or external TUI changes.

Read-only review findings were addressed with regression tests: explicit stale/accepted acknowledgement, authoritative reconnect cleanup, canonical receipt parsing, and bounded acknowledgement waits. Fatal receipt-persistence failure rejects both the tool and HTTP acknowledgement; it ends the request rather than retrying a potentially partly appended SDK entry. Same-tab-only recovery and lack of server-restart recovery are intentional limits documented in `docs/questions.md`. Initial fixture-binding and retention-order test failures were corrected; the final runs above pass.
