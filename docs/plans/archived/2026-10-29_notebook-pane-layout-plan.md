# Guided notebook pane layout

## Goal

Give guided readers temporary control over outline, explanation and evidence visibility, and the explanation/evidence width split, without losing loaded reading state or changing notebook/reviewer data. Implementation is authorized in a dedicated linked worktree based on local `main`.

## Context

`GuidedReviewReader` owns activation and step navigation; `StepReader` owns selected evidence and mounted readers. Existing fixed columns stack by viewport width even when the actual Files pane has a different width. No active plan owns this layout behavior; the Git Explorer fullscreen plan owns a separate surface.

## Architecture

Keep visibility and the explanation share in the activation owner so navigation preserves them. Keep hidden panes mounted using `hidden`, with explicit CSS handling; hiding is presentation, not cancellation or a new evidence activation. Return to document/cwd/index changes reset layout. Add always-available pressed-state pane toggles and Reset layout. All-hidden is recoverable through those controls. Prose exploration reveals evidence.

Use a container-width breakpoint: narrow content stacks naturally at full width; sufficiently wide content gets a bounded 20–80% explanation/evidence divider. Pointer capture and Arrow keys (Shift for larger steps), Home/End, Enter/double-click reset, and Escape cancellation belong to the divider. No persisted preferences, new dependencies, notebook schema, reviewer fingerprints, API or Git authority changes. Outline keeps its existing width and can be hidden.

## Plan

- [x] Implement activation-local toggles, reset and an accessible captured-pointer divider; verify real mounted controls, retained nodes/requests, navigation, reset and drag cancellation in the existing guided-reader behavioral owner.
- [x] Add thin installed-browser geometry/capture/focus coverage at the existing desktop/touch notebook inputs; preserve all existing assertions and input ordering.
- [x] Update the maintained notebook guide with responsive layout, temporary lifetime and hidden-reader semantics.
- [x] Review the settled candidate, exercise a meaningful production defect, and run complete Nix core/browser/terminal/deployment acceptance with recorded selection, identities, timing and artifact locations.

## Evidence and current state

Implementation and documentation are present. The reviewed production candidate passed `nix run .#test -- core --file components/GuidedReviewReader.behavior.test.mjs`: 8/8 cases, type generation/typecheck/lint passed (seven existing warnings), 65s command wall time, report `/tmp/brabbler-test-core.iFiL4b/run.json`, immutable source digest `17323de6e84e30d34a007c18ed622c3c75b2876a3fd75d74250c1ce31ff6fd80`. This is focused evidence, not full acceptance. The existing exclusive test-file classification is retained; new cases use the same private DOM/controlled transport owner plus an external geometry/ResizeObserver double, not native layout proof.

Independent read-only review found missing drag cancellation on focus/visibility changes and weak native tab/diff assertions. The implementation now cancels/relinquishes capture on blur, hiding and zero-width resize, and releases it on unmount; scoped re-review has no unresolved findings. Browser checks now traverse past the last prose control and preserve a configured real diff/context renderer. The final browser additions and complete acceptance passed on the committed implementation as recorded below.

The initial focused failure was an overbroad test expectation of empty localStorage, despite existing reviewer recovery data. The corrected assertion compares storage before/after resizing; original failure evidence remains at `/tmp/brabbler-test-core.BcJ8Ol/run.json`.

### Complete acceptance

Candidate `be0d853108b3f5cb572d9fee7d298713ae4d980d` passed `nix run .#test -- all --workers 4 --jobs 4` in **580s** end-to-end, including in-run realization. Immutable source `/nix/store/517j85i4v2kgwlgf1lf58w4m7a83kgi2-source`, content/mode digest `bfbab0a26b21f71cc7f16240f57c85e01373dfa46931d099c9bc2d3c24025b5e`. Core requested/effective workers 4/4, browser sandboxes 4/4; admission chose overlapping levels with an estimated 16 CPUs/27 GiB. Approximately 38 GiB was available before launch, below the 43 GiB estimate for twelve/four. No other acceptance invocation was running.

- Core: **530 files, 4,392 tests, 14 suites**, all passed, none skipped/cancelled; type generation/typecheck/lint passed with the same seven existing warnings. Invocation 551.656s; core lifecycle 507.081s; test-file execution window 505.872s. Report `/tmp/brabbler-test-core.6QVve2/run.json`; exact file outcomes and worker admission in its `result/artifacts/run-CPq1nb/summary.json`.
- Browser/terminal: all **26 groups** passed, including actual wide drag capture/blur cancellation, narrow stacked geometry, hidden keyboard traversal, retained configured diff/context and image identity without new reads. Invocation 489.011s; package/support preparation 103.819s, definition manifest 5.930s, group-client execution window 379.258s. Report `/tmp/brabbler-test-browser.OuiGka/run.json`.
- Genuine Home Manager deployment VM: passed, invocation 83.781s including realization; guest test script 22.74s. Report `/tmp/pwv-MwQ8Ka/run.json`.

These overlapping intervals are not additive or a performance comparison. Preparation used only isolated Nix builders, not the checkout or installed host service. Full command log `/tmp/notebook-pane-all.log`; source/admission receipt `/tmp/brabbler-test-source-0vESYS/selection.json`.

A private exported-source fault forced the evidence pane to stay visible. The named layout-control runtime assertion failed (`controlled.hidden`, expected true, actual false), with 7/8 cases passing; report `/tmp/brabbler-test-core.HZ3gJm/run.json`, log `/tmp/notebook-pane-control.log`. The receiving worktree was never faulted; the unmodified production candidate passed both focused and complete checks. The earlier pre-review Markdown-only browser run also passed in 294s (`/tmp/brabbler-test-browser.5jWwOJ/run.json`), but does not replace the final complete run's corrected assertions.

Current behavior is maintained in `docs/review-notebooks.md` and `docs/feature-internals.md`. This implementation record is ready for archival. A following evidence/archive-only commit requires whitespace/document review and confirmation that application/test inputs remain unchanged, not a relabelled full run. Exact-state local non-FF integration and separate bounded cleanup remain governed by their live approval cards and execution receipts.

## Completion Checklist

- [x] Explanation/evidence resizing and independent pane hide/show work without remounting loaded content or resetting selected targets.
- [x] Keyboard/focus, narrow containment, all-hidden recovery and default restoration have owner-appropriate evidence.
- [x] Complete acceptance passes and the reviewed candidate is ready for exact-state local integration; separate resource cleanup remains separately approved. Remote publication is not authorized.
