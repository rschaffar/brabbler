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
- [x] Implement/review the accessible composer status and compaction-only recovery;
  pass the focused core files and `history` browser group, retaining failures.
- [x] Commit the settled application candidate and pass complete Nix acceptance:
  `nix run .#test -- all --workers 2 --jobs 4`, recording exact inputs, runtime,
  core/browser/deployment results and retained manifests.
- [x] Resolve local completion intent under the Git policy and hand off guarded
  finalization: the user selected local `rst-main` integration. The coordinating
  agent owns exact merge approval/execution and separate cleanup, recorded by
  durable operation receipts and the completion report rather than this plan.

## Verification evidence

Iteration results below are historical; final acceptance is recorded separately.

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

- [x] Desktop/mobile progress, reload/reconnect, missed end, cancellation, failure,
  toolbar and slash-command completion pass with unchanged scenario ownership.
- [x] Production callback regressions cover stale session/prompt/compaction reads,
  late manual completion, unmount cleanup and accessible live-region ancestors.
- [x] Complete core/static/plugin, all browser/terminal groups and genuine Home
  Manager deployment VM acceptance pass on the recorded candidate inputs.
- [x] Durable behavior is documented in `docs/session-internals.md`; the local
  completion decision, finalization owner and verification limits are recorded
  below. Nothing is remotely published.

## Final acceptance

Candidate: `0c36159c38344892e6cb04e8810f9bc18b1f362b` (application inputs
unchanged from `776bb818fab4136abf0d5f8aa369e32f474bad9d`).

```sh
nix run .#test -- all --workers 2 --jobs 4
```

Passed fresh on native x86_64 Linux: **2,424 core tests / 310 files / 10 suites**,
all **24 browser/terminal groups / 53 scenario receipts**, and every genuine
Home Manager deployment proof with confirmed shutdown/collection. No skipped,
cancelled or missing core cases; all browser capsules passed and settled.

- Exported source: `/nix/store/ckm8wn9fibgl9yznpgydnr4ws6kx2vcf-source`.
- Outer content/mode digest:
  `2840ffdb7222a03053460d36caa2f800c06827e219ffa365c0a8c482fe44358f`.
- Log: `/tmp/pi-compaction-acceptance-r3.log`.
- Core: `/tmp/pi-web-test-core.hVeCn3/run.json`.
- Browser/terminal: `/tmp/pi-web-test-browser.AZeXOC/run.json`.
- Deployment: `/tmp/pwv-GLMlQO/run.json`.
- Export/admission: `/tmp/pi-web-test-source-Sid7As/selection.json`.

Whole-command runtime: **517.614 seconds**, including its Nix realization and
preparation, but not model work, review or coordination. No separately timed
external preparation was run. Manifest intervals are 280.480s core, 443.338s
browser and 67.329s service (the latter includes realization; guest execution
itself was 21.032s). Levels overlap and must not be added. Host admission saw
32 logical CPUs and about 38 GiB available memory; the combined conservative
estimate was 16 CPUs/19 GiB, not a reservation or benchmark claim.

The synthetic protocol fixtures exercise the real packaged UI without live model
requests. Live-provider compaction was not exercised. The installed host service
was not changed; no remote operation was authorized or performed.

## Git finalization handoff

The user chose integration into local `rst-main` using the required unsigned
non-fast-forward merge. At archival, exact approval/execution and separate
cleanup remain owned by the coordinating agent's guarded Git finalization;
the durable operation receipts and completion report own the resulting IDs and
resource disposition. This handoff is neither merge approval nor proof of success.

The evidence/archive-only follow-up must leave every application/test input
byte-identical to the accepted candidate; verify that bounded diff and the
Markdown handoff before proposing the exact merge. No full-suite rerun is needed
solely for an evidence-only commit ID change.
