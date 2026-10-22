# Persistent scratchpad

## Goal

Provide one-click personal notes with Global and This session editors together, immediate persistence and independent undo/redo. The user selected the two-editor design. Implementation is authorized by the feature request; local integration remains separately gated.

## Status / Integration Handoff

Implementation and coordinated final verification are complete. The earlier acceptance hold was lifted by the user's **rebase and continue** request. This plan closes at verified implementation handoff; the Git workflow in this session owns the separately gated exact merge, execution receipt and cleanup, not this plan.

- Feature branch: `feat/scratchpad`; worktree used: `/home/robert/projects/3rdparty/pi-desk-worktrees/scratchpad` (moved from the former `pi-web-worktrees/scratchpad`).
- Final tested candidate: `989d919068b17fea0d6f3e0cd954331dc92c05b1`, rebased onto `main` `c19cf2ab8b5dc9dd7d8936d30120b0a62a69ea75`. Both Notes and Acceptance imports, messages and media-cover guards survive the mechanical conflict resolution; independent read-only integration review found no issues.
- Historical candidates: `42dceb2279870bca2e3c3c34e08efa3d92d38e99` on the former `main` `c9ab433a542b44de1d22bde07afe026c2815f4ba`, and original feature commit `25419c8a5ff5448a578fba1a2a6c424feceb70b2` starting from `ff69773a13d8b29249440320d54ebaa2df42e435`. The pre-rebase backup `backup/scratchpad-pre-rebase-20261022-030221` remains separately retained; feature cleanup does not authorize its deletion.
- The user selected local **main**, superseding the old `rst-main` target; current instructions and policy agree. At this handoff no merge, publication, host service deployment or feature cleanup is claimed. Git tools own exact-state approval/effects and separate cleanup; all remote actions remain separately authorized.
- Archiving changes only evidence/status documentation. Application and test inputs remain those of the tested candidate; do not relabel the full run as a later-tip execution or repeat it solely for the archive commit.

## Architecture

- A top-bar Notes trigger opens a native modal with two plain-text editors side by side, stacked on narrow screens. It does not replace chat, Files or terminals. Escape closes only Notes and restores trigger focus.
- Global notes are shared by this Pi Web installation. Session notes use the saved session ID, independent of cwd, branch or transcript navigation. New unsaved chats explain why session notes are unavailable. Notes never enter model context automatically.
- Private per-note JSON files under the agent directory use hashed identifiers, bounded text, locked atomic replacement and optimistic revisions. Other clients cannot silently overwrite a newer version.
- Each input synchronously records a per-tab browser recovery draft and starts a serialized, coalescing server save without a typing debounce. Save failures and conflicts preserve edits; explicit retry, copy and conflict resolution remain available. The panel can close during saves.
- Undo/redo histories are independent, bounded, and remain in memory across panel/session switches. Reload restores text, not undo history. Recovery storage failure is visible, not described as persistence success.

## Plan

- [x] Implement and test bounded revisioned note storage and guarded API; prove separation, stale refusal, concurrent writes, private modes and corrupt-file preservation.
- [x] Implement and test client autosave/recovery/history coordinator; prove pending input, lost acknowledgements, failed writes and independent note lifetimes.
- [x] Add the accessible two-editor panel and top-bar trigger; verify real browser autosave, undo/redo, reopening, session separation, reload, conflict recovery and mobile geometry.
- [x] Document current storage, privacy, retention and undo behavior in the feature guide (`docs/feature-internals.md`, source map and browser inventory).
- [x] Review settled source, run complete Nix acceptance and record exact input/results/artifacts; keep any failures open.
- [x] Commit coherent feature history and resolve completion intent: the user selected local `main`; the first clean rebase produced candidate `42dceb2`.
- [x] At the coordinated integration window, rebase and finish full acceptance on `989d919`; prepare the verified handoff. Exact merge approval/effects, receipts and cleanup are transferred to the Git workflow in this session.

## Evidence

- Preliminary focused core: `nix run .#test -- core --jobs 2 --file lib/scratchpad-client.test.mjs --file lib/scratchpad-server.test.mjs --file app/api/scratchpad/route.test.mjs` passed 3 files / 14 tests, static checks and 29 exporter contracts. Export digest `87bf3703da78b0f1214415ea3b02fd030f34a90e874e9840c9f55e1d1e3dfb18`; report `/tmp/pi-web-test-core.5DBoU0/run.json`. This predates review regressions and is not final-candidate acceptance.
- Independent read-only review identified lost-response-after-undo, conflict-refresh and composing-Escape defects. All three were fixed; the reviewer confirmed the fixes with no further findings. New regression cases cover both uncertain-write paths and simulated IME cancellation.
- First appearance run (`nix run .#test -- e2e --group appearance`) failed the new desktop Undo assertion: an `insertText` bulk replacement was grouped with subsequent typing. Original failure retained at `/tmp/pi-web-test-browser.XJeLzq/run.json`, export `178caeb3ad39f770c5f3665f6642d6d90376987518b033184264d56f40fa3245`. The fix limits grouping to contiguous small inserts/deletions and ends groups on blur/navigation; an explicit core regression precedes the next run. No assertion/deadline was weakened. This is a failed preliminary run, not acceptance.

- The next focused core run correctly refused incomplete appearance receipt coverage: the independent receipt-test inventory still used only historical scenarios. Retained `/tmp/pi-web-test-core.1FjDPk/run.json` (90s whole command). Both inventory equality and completion now use an independent current expected set, retaining the original 52-case baseline unchanged.
- Reviewed focused core passed **4 files / 30 cases**, static checks and exporter contracts in **98s whole-command wall time**: `nix run .#test -- core --jobs 2 --file lib/scratchpad-client.test.mjs --file lib/scratchpad-server.test.mjs --file app/api/scratchpad/route.test.mjs --file lib/e2e-coverage.test.mjs`; export `db70c81f5bb88d2103a5eca0d7ae86828f75dfb470109beab678c1b01ba58741`; `/tmp/pi-web-test-core.QBK43c/run.json`. The separately selected `lib/nix-browser.test.mjs` also passed before the coverage-fixture correction.
- Reviewed focused appearance passed all **four exact scenarios** (including desktop and short-touch Notes) in **251s whole command / 103.021s browser capsule**, with production prerequisite realization inside the command: `/tmp/pi-web-test-browser.uSuPll/run.json`, diagnostic `/nix/store/5xs3lcpcz5qmr00nas2b3gany63pak8l-pi-web-browser-appearance-diagnostics`. At that point cached-editor focus and background-shortcut containment refinements still required final full acceptance; the final run below now covers them. This focused result is not relabelled as a new-tip run.

- The first full run on original candidate `25419c8` was interrupted by the repository/session move, not accepted. All failed in-flight core/browser executions recorded `interrupted: true`, settled ownership and no observed survivors; reports remain `/tmp/pi-web-test-core.NoqpwN/run.json` and `/tmp/pi-web-test-browser.eMhv6Q/run.json`. No deployment run started.
- After rebase, `nix run .#test -- all --workers 4 --jobs 4` exported candidate `42dceb2279870bca2e3c3c34e08efa3d92d38e99` with digest `910efa23d764d336a930d7636c3d99e52d81075076f114c158a804c543fbed0a` (`/tmp/pi-web-test-source-ZP0SHK/selection.json`). Four browser sandboxes/four core workers were admitted with 32 CPUs and about 38 GiB available, accounting for a separate focused browser run. The user then requested coordinated final acceptance only after concurrent sessions settle. The owned coordinator was stopped gracefully with SIGINT; **472s whole-command wall time**, exit 1/interrupted, **not a pass**. Both core (`/tmp/pi-web-test-core.3XKPZu/run.json`) and browser (`/tmp/pi-web-test-browser.TlOiav/run.json`) recorded settled executions, no observed survivors, and interruption of every failed in-flight group. No deployment run started. Reports/logs remain; no further acceptance run is scheduled by this plan status update.

## Final Acceptance — 2026-10-22

- Command: `nix run .#test -- all --workers 4 --jobs 4`, exit **0**, **531s (8m51s) end-to-end wall time**, including in-run realization. Candidate `989d919068b17fea0d6f3e0cd954331dc92c05b1`; complete source content/mode digest `13fb75fe938ef2fd477d4f07c729f752acdaa7ddcdd63c81e5793cad6e03497a`; input/selection manifests under `/tmp/pi-web-test-source-8r000w/`.
- Native x86_64 Linux, 32 observed CPUs/about 43 GiB available at admission. Requested/effective **four browser sandboxes / four core workers**, with an overlapping admission estimate of 16 CPUs/27 GiB, not a reservation. No peer test run was observed at launch; source writers were paused during export.
- Core/static/plugin acceptance: **408 files / 3,060 cases / 12 suites**, all passed with zero skips/cancellations or uncertain settlement. Core command interval **397.205s**, including realization/static preparation. Report: `/tmp/pi-web-test-core.qFF3eq/run.json`.
- Browser/terminal acceptance: all **26 groups / 59 exact scenarios**, passed with settled clients, no interruption and closed service ports. Overall browser command interval **447.420s**; the recorded capsule execution window spans **356.143s**. Pre-execution realization/startup window **91.150s** includes the isolated production package build (**75s build phase**), not a separately timed pure preparation metric. Report: `/tmp/pi-web-test-browser.WWQume/run.json`.
- Genuine deployment VM: all activation, permissions, durable HTTP write/restart and real PTY checks passed; final service inactive, MainPID zero, cgroup absent and port refused. Overall service interval **75.015s**, including realization; guest evidence execution **18.906s** (driver test script **19.01s**). The guest image build phase took **40s** inside that interval. Report: `/tmp/pwv-nlmLRY/run.json`.
- Core overlaps browser; deployment follows browser. Do not sum overlapping intervals or compare this realization-inclusive run with a warm-prerequisite benchmark. No separate prewarming command was run; existing cache entries were reused. Full outer log/status: `/tmp/scratchpad-final-acceptance.J6y8u7/`.
- Current behavior/storage/privacy/undo contracts live in `docs/feature-internals.md`, source ownership in `docs/architecture.md`, and browser inventory in `e2e/README.md`. This archive retains measured evidence and earlier failures; the Git workflow owns the remaining integration/cleanup receipts.

## Non-Goals

Rich text, Markdown preview, attachments, automatic prompt injection, collaborative editing, automatic note deletion, and persistent undo history are excluded.

## Rollback / Recovery

Removing the feature leaves private note files untouched. Failed reads/writes must never replace corrupt data with empty text. Per-tab recovery drafts survive reload; server revisions gate recovery writes. Conflict resolution explicitly selects the server version or saves the local draft against the reviewed version, with another conflict if the server advances again. Notes are retained when sessions are deleted; there is no automatic GC in this change.

## Completion Checklist

- [x] Both scopes persist independently with honest save/error status and undo/redo.
- [x] Core, full browser/terminal inventory and genuine deployment checks pass with recorded identities and runtimes.
- [x] Independent review findings are addressed and documented contracts match the implementation; see the review and focused regression evidence above.
- [x] Verified local integration handoff identifies the candidate, `main` target and non-fast-forward method; Git tools own actual approval/effects/cleanup receipts. No publication, host deployment or cleanup is inferred from test success.
