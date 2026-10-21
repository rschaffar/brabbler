# Persistent scratchpad

## Goal

Provide one-click personal notes with Global and This session editors together, immediate persistence and independent undo/redo. The user selected the two-editor design. Implementation is authorized by the feature request; local integration remains separately gated.

## Architecture

- A top-bar Notes trigger opens a native modal with two plain-text editors side by side, stacked on narrow screens. It does not replace chat, Files or terminals. Escape closes only Notes and restores trigger focus.
- Global notes are shared by this Pi Web installation. Session notes use the saved session ID, independent of cwd, branch or transcript navigation. New unsaved chats explain why session notes are unavailable. Notes never enter model context automatically.
- Private per-note JSON files under the agent directory use hashed identifiers, bounded text, locked atomic replacement and optimistic revisions. Other clients cannot silently overwrite a newer version.
- Each input synchronously records a per-tab browser recovery draft and starts a serialized, coalescing server save without a typing debounce. Save failures and conflicts preserve edits; explicit retry, copy and conflict resolution remain available. The panel can close during saves.
- Undo/redo histories are independent, bounded, and remain in memory across panel/session switches. Reload restores text, not undo history. Recovery storage failure is visible, not described as persistence success.

## Plan

- [x] Implement and test bounded revisioned note storage and guarded API; prove separation, stale refusal, concurrent writes, private modes and corrupt-file preservation.
- [x] Implement and test client autosave/recovery/history coordinator; prove pending input, lost acknowledgements, failed writes and independent note lifetimes.
- [ ] Add the accessible two-editor panel and top-bar trigger; verify real browser autosave, undo/redo, reopening, session separation, reload, conflict recovery and mobile geometry.
- [x] Document current storage, privacy, retention and undo behavior in the feature guide (`docs/feature-internals.md`, source map and browser inventory).
- [ ] Review settled source, run complete Nix acceptance and record exact input/results/artifacts; keep any failures open.
- [ ] Commit coherent feature history and resolve completion intent, then rebase/integrate only through required exact-state approval.

## Evidence

- Preliminary focused core: `nix run .#test -- core --jobs 2 --file lib/scratchpad-client.test.mjs --file lib/scratchpad-server.test.mjs --file app/api/scratchpad/route.test.mjs` passed 3 files / 14 tests, static checks and 29 exporter contracts. Export digest `87bf3703da78b0f1214415ea3b02fd030f34a90e874e9840c9f55e1d1e3dfb18`; report `/tmp/pi-web-test-core.5DBoU0/run.json`. This predates review regressions and is not final-candidate acceptance.
- Independent read-only review identified lost-response-after-undo, conflict-refresh and composing-Escape defects. All three were fixed; the reviewer confirmed the fixes with no further findings. New regression cases cover both uncertain-write paths and simulated IME cancellation.
- First appearance run (`nix run .#test -- e2e --group appearance`) failed the new desktop Undo assertion: an `insertText` bulk replacement was grouped with subsequent typing. Original failure retained at `/tmp/pi-web-test-browser.XJeLzq/run.json`, export `178caeb3ad39f770c5f3665f6642d6d90376987518b033184264d56f40fa3245`. The fix limits grouping to contiguous small inserts/deletions and ends groups on blur/navigation; an explicit core regression precedes the next run. No assertion/deadline was weakened. This is a failed preliminary run, not acceptance.

- The next focused core run correctly refused incomplete appearance receipt coverage: the independent receipt-test inventory still used only historical scenarios. Retained `/tmp/pi-web-test-core.1FjDPk/run.json` (90s whole command). Both inventory equality and completion now use an independent current expected set, retaining the original 52-case baseline unchanged.
- Reviewed focused core passed **4 files / 30 cases**, static checks and exporter contracts in **98s whole-command wall time**: `nix run .#test -- core --jobs 2 --file lib/scratchpad-client.test.mjs --file lib/scratchpad-server.test.mjs --file app/api/scratchpad/route.test.mjs --file lib/e2e-coverage.test.mjs`; export `db70c81f5bb88d2103a5eca0d7ae86828f75dfb470109beab678c1b01ba58741`; `/tmp/pi-web-test-core.QBK43c/run.json`. The separately selected `lib/nix-browser.test.mjs` also passed before the coverage-fixture correction.
- Reviewed focused appearance passed all **four exact scenarios** (including desktop and short-touch Notes) in **251s whole command / 103.021s browser capsule**, with production prerequisite realization inside the command: `/tmp/pi-web-test-browser.uSuPll/run.json`, diagnostic `/nix/store/5xs3lcpcz5qmr00nas2b3gany63pak8l-pi-web-browser-appearance-diagnostics`. Final cached-editor focus and background-shortcut containment refinements still require final full acceptance; this focused result is not relabelled as a new-tip run.

## Non-Goals

Rich text, Markdown preview, attachments, automatic prompt injection, collaborative editing, automatic note deletion, and persistent undo history are excluded.

## Rollback / Recovery

Removing the feature leaves private note files untouched. Failed reads/writes must never replace corrupt data with empty text. Per-tab recovery drafts survive reload; server revisions gate recovery writes. Conflict resolution explicitly selects the server version or saves the local draft against the reviewed version, with another conflict if the server advances again. Notes are retained when sessions are deleted; there is no automatic GC in this change.

## Completion Checklist

- [ ] Both scopes persist independently with honest save/error status and undo/redo.
- [ ] Core, full browser/terminal inventory and genuine deployment checks pass with recorded identities and runtimes.
- [ ] Independent review findings are addressed and documented contracts match the implementation.
- [ ] Local integration/retention and remote/cleanup boundaries are reported accurately.
