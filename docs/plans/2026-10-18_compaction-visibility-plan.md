# Compaction visibility

## Goal

Make automatic and manual compaction visibly understandable on desktop and mobile,
including reload/reconnect and missed completion, without changing thinking bubbles.

## Context

The user authorized implementation after the separate policy-cache fix merged as
`1f189f56bdf01745c672705b4b78e4ee563ee613`. Work is isolated on
`feat/compaction-visibility` in the linked `compaction-visibility` worktree, based
on that local `rst-main` tip. No active plan owns this progress indicator; the
archived policy-cache plan does not own compaction UI.

Existing modern/legacy SSE events and mount state already track compaction, but
mobile hides its control under More controls. Recovery previously required a
running prompt. Initial state uses `/api/sessions/[id]/state`; periodic recovery
uses `/api/agent/[id]`.

## Non-Goals

- No thinking-bubble, provider transport, cache, compaction algorithm or persisted
  session format changes; no invented percentage or ETA.
- No live model experiments, host-service deployment/restart or remote operations.
  Browser activity is scoped synthetic SSE/HTTP over existing history fixtures.

## Plan

- [x] Trace existing events, state restoration, composer ownership and reusable
  history fixtures; verify both state endpoints and modern/legacy event handling
  in `hooks/useAgentSession.ts` and `e2e/browser-suite.mjs`.
- [ ] Implement/review the accessible composer status and compaction-only recovery;
  pass the focused core files and `history` browser group, retaining failures.
- [ ] Commit the settled application candidate and pass complete Nix acceptance:
  `nix run .#test -- all --workers 2 --jobs 4`, recording exact inputs, runtime,
  core/browser/deployment results and retained manifests.
- [ ] Resolve local completion intent under the Git policy; integrate only after
  exact-state approval, or explicitly retain the feature. Record the outcome.

## Verification evidence

- Initial focused regression run exposed missing compaction-only recovery.
- First focused green: 54 tests in three files; `/tmp/pi-compaction-core.log`,
  `/tmp/pi-web-test-core.LiK0ct/run.json`. Later race fixes supersede its inputs.
- First history run failed after 126 seconds at the first status wait. Its trace
  showed an initial real idle state arriving after synthetic start. The fixture
  intercepted only the recovery endpoint, and initial restoration lacked a
  compaction version guard. Evidence: `/tmp/pi-compaction-history.log`,
  `/tmp/pi-web-test-browser.thIans/run.json`.
- Second focused core passed 59 tests in three files, static checks included,
  in 40 seconds: `/tmp/pi-compaction-core-r2.log`,
  `/tmp/pi-web-test-core.VzPcaH/run.json`. Later command-ownership fixes supersede
  these application inputs.
- Second history run completed desktop checks, then hung on mobile: Enter inserts
  a newline there, while the synthetic POST-start barrier had no deadline. The
  outer tool timed out at 240 seconds. Its exact remaining owned Nix client was
  interrupted; this is not successful acceptance or complete settlement evidence.
  Log: `/tmp/pi-compaction-history-r2.log`; incomplete manifest:
  `/tmp/pi-web-test-browser.TswaTv/run.json`. The corrected fixture clicks Send and
  bounds admission with the existing 30-second response waiter, without changing
  browser deadlines. Incomplete roots are retained.
- Independent review also identified stale recovery/manual completion races and
  an `aria-busy` ancestor suppressing `/compact` announcements. Read versions,
  phase ownership and the active-compaction busy exception address these.
- Third focused checks passed: 59 core tests/static checks in 47 seconds
  (`/tmp/pi-compaction-core-r3.log`, `/tmp/pi-web-test-core.GqOLzi/run.json`),
  and both desktop/mobile history chains in 112 seconds for the whole command,
  including preparation; browser execution itself was 21.176 seconds
  (`/tmp/pi-compaction-history-r3.log`,
  `/tmp/pi-web-test-browser.BOWBIt/run.json`). Subsequent ownership work changes
  the hook, not the indicator or browser fixture; full final-candidate coverage
  remains required.
- Final ownership regression checks passed all 59 focused tests in 40 seconds:
  `/tmp/pi-compaction-core-r4.log`, `/tmp/pi-web-test-core.SFQ6TB/run.json`.
  They cover both commands, own SSE completion and superseded success/error,
  asserting suppressed stale outcomes and loading reloads. A cleanup-ref lint
  warning was corrected by capturing the stable phase object; final static
  acceptance must verify that follow-up.
- Final independent read-only re-review found no further actionable regressions.
  Current behavior is handed off to `docs/session-internals.md`; full acceptance
  and the local completion decision remain pending.
- First complete attempt on `776bb818fab4136abf0d5f8aa369e32f474bad9d`
  (`all --workers 2 --jobs 2`) failed in 188.157 seconds: the pre-existing workspace-memory test executes
  production cleanup in an isolated VM and lacked its newly captured
  `compactionPhase` binding. Core stopped admission; the browser peer was
  interrupted and service did not start. Evidence:
  `/tmp/pi-compaction-acceptance.log`, `/tmp/pi-web-test-core.WUQkoZ/run.json`,
  `/tmp/pi-web-test-browser.7K6IZB/run.json`; exported source digest
  `6017622f506f39ea3a49469c3231c1dc2ba1af4816b5e1904cdc6db3c02feabc`.
- Expanded focused iteration then exposed the analogous missing
  `compactionVersionRef` binding in the existing warm-cache restoration fixture
  (42 seconds; `/tmp/pi-compaction-core-r5.log`,
  `/tmp/pi-web-test-core.5zqiV9/run.json`). Both fixtures now bind the new state;
  original assertions remain unchanged. Application bytes are unchanged from
  `776bb81`. The expanded seven-file rerun passed all 98 tests and static
  checks in 43 seconds: `/tmp/pi-compaction-core-r6.log`,
  `/tmp/pi-web-test-core.DcJWmd/run.json`.
- Second complete attempt on `ae237842a01966bb358b54a139c7d1b1522473c8`
  failed in 209.153 seconds because the existing composer-locking source
  assertion required unconditional `aria-busy`, contradicting the deliberate
  compaction live-region exception. It now requires that exception while
  preserving the disabled-control assertion and submission-locking checks.
  Evidence: `/tmp/pi-compaction-acceptance-r2.log`,
  `/tmp/pi-web-test-core.xQkCor/run.json`,
  `/tmp/pi-web-test-browser.7U620Z/run.json`. No application change; complete
  acceptance remains pending.
- Expanded source-consumer selection passed all 191 tests across 20 files,
  static checks included, in 47.687 seconds: `/tmp/pi-compaction-core-r7.log`,
  `/tmp/pi-web-test-core.9Joir1/run.json`. This includes every test directly
  mentioning `ChatInput` or `useAgentSession`, plus scenario ownership contracts.
  The final full run admits four core workers and two browser sandboxes under
  the existing resource checks, with no concurrent source/review writers.

## Completion Checklist

- [ ] Desktop/mobile progress, reload/reconnect, missed end, cancellation, failure,
  toolbar and slash-command completion pass with unchanged scenario ownership.
- [ ] Production callback regressions cover stale session/prompt/compaction reads,
  late manual completion, unmount cleanup and accessible live-region ancestors.
- [ ] Complete core/static/plugin, all browser/terminal groups and genuine Home
  Manager deployment VM acceptance pass on the recorded candidate inputs.
- [ ] Durable behavior is documented in `docs/session-internals.md`; local Git
  outcome and any accepted gaps are recorded. Nothing is remotely published.
