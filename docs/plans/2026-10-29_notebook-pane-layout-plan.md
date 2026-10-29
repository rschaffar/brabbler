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
- [ ] Add thin installed-browser geometry/capture/focus coverage at the existing desktop/touch notebook inputs; preserve all existing assertions and input ordering.
- [x] Update the maintained notebook guide with responsive layout, temporary lifetime and hidden-reader semantics.
- [ ] Review the settled candidate, exercise a meaningful production defect, and run complete Nix core/browser/terminal/deployment acceptance with recorded selection, identities, timing and artifact locations.

## Evidence and current state

Implementation and documentation are present. The reviewed production candidate passed `nix run .#test -- core --file components/GuidedReviewReader.behavior.test.mjs`: 8/8 cases, type generation/typecheck/lint passed (seven existing warnings), 65s command wall time, report `/tmp/brabbler-test-core.iFiL4b/run.json`, immutable source digest `17323de6e84e30d34a007c18ed622c3c75b2876a3fd75d74250c1ce31ff6fd80`. This is focused evidence, not full acceptance. The existing exclusive test-file classification is retained; new cases use the same private DOM/controlled transport owner plus an external geometry/ResizeObserver double, not native layout proof.

Independent read-only review found missing drag cancellation on focus/visibility changes and weak native tab/diff assertions. The implementation now cancels/relinquishes capture on blur, hiding and zero-width resize, and releases it on unmount; scoped re-review has no unresolved findings. Browser checks now traverse past the last prose control and preserve a configured real diff/context renderer. Current browser additions and complete acceptance remain pending.

The initial focused failure was an overbroad test expectation of empty localStorage, despite existing reviewer recovery data. The corrected assertion compares storage before/after resizing; original failure evidence remains at `/tmp/brabbler-test-core.BcJ8Ol/run.json`.

## Completion Checklist

- [ ] Explanation/evidence resizing and independent pane hide/show work without remounting loaded content or resetting selected targets.
- [ ] Keyboard/focus, narrow containment, all-hidden recovery and default restoration have owner-appropriate evidence.
- [ ] Complete acceptance passes; local integration and separate resource cleanup use exact-state approvals. Remote publication is not authorized.
