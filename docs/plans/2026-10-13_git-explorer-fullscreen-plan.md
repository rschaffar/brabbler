# Git Explorer fullscreen

## Goal

Let the entire Git Explorer fill the Pi Web app viewport, like the existing terminal/files-panel expand control, and restore its normal side-panel layout without losing the selected branch, commit or reading state.

The user explicitly selected **the whole Git Explorer**, not just commit diffs and not browser-native fullscreen. This request authorizes this plan only; implementation requires a later request.

## Context

Research baseline: local `rst-main` at `ed89fd5a0f3cb69ae66f0c9742d0303280932f2a`.

- `components/AppShell.tsx` owns the terminal/files panel's `rightPanelExpanded` state. Its full-width mode is an in-app fixed viewport panel; other panes become inert without unmounting. The control is hidden on mobile, and entering mobile or closing the panel resets expansion.
- `components/GitExplorerPanel.tsx` currently offers only Close. Its selected commit and list/detail state are local; `AppShell` keys it by `activeCwd`.
- `app/globals.css` caps `.git-explorer-host` at `min(860px, 70%)`. Graph/detail use separate views at viewport widths up to 1100px; at larger widths they appear together. Mobile already overlays the chat, but leaves app chrome visible.
- `components/CommittedPatchDiff.tsx` already provides a native-dialog **Wide view** for individual files. Its Escape handling stops propagation. Global Escape in `hooks/useKeyboardShortcuts.ts` can stop the running agent; fullscreen restoration must not fall through to it.
- `e2e/git-explorer.mjs` covers history, branch/checkout selection, committed patches and context. `e2e/file-panel.mjs` owns the existing expanded files-panel browser checks. These are acceptance fixtures, not proof of coverage for this new feature.

## Plan Relationship

`2026-09-28_git-explorer-sidecar-branches-plan.md` owns the existing sidecar and local-branch read boundary. This plan adds a presentation mode without reopening its API design. `2026-09-27_git-explorer-split-diff-plan.md` owns the earlier diff presentation work; fullscreen does not replace current Pierre rendering or individual-file Wide view. Neither adjacent plan owns whole-Explorer fullscreen.

Current contracts remain in `docs/worktrees.md`, `docs/feature-internals.md`, `docs/terminal.md`, `docs/testing.md` and `e2e/README.md`.

## Assumptions

- Match terminal behavior on desktop and compact desktop (>640px). On mobile, keep the existing full-width list/detail flow and hide the redundant expand control. Crossing into mobile restores normal mode; do not automatically re-expand when returning to desktop.
- Add an expand/restore icon beside Close in the Explorer header, with accessible names **Expand Git Explorer** / **Restore Git Explorer**, `aria-pressed`, `aria-controls`, tooltip and visible keyboard focus. Keep Close distinct from Restore.
- Escape restores fullscreen, unless a nested dialog/control owns that Escape. Close dismisses Explorer and resets expansion. Reopening or reloading starts in normal mode; do not persist fullscreen.
- Restore preserves prior pane visibility and saved split widths. Expansion does not close chat, terminals or files, discard drafts, stop agents, or change cwd.
- Preserve the existing graph/detail breakpoint rather than introducing a new responsive redesign: large fullscreen viewports show both; compact viewports keep **Back to commits** navigation.

## Architecture

Keep fullscreen layout ownership in `AppShell`, with controlled expansion props/callbacks passed to `GitExplorerPanel`. A local expansion flag is effective only while `activeOverview === "git"` and the viewport is non-mobile. Reset it on close, leaving Git Explorer, or entering mobile; changing checkout still uses the existing keyed reset for repository data.

Change the existing Explorer host's CSS class/geometry rather than rendering a second instance, changing its key for layout, moving it between React parents or portaling the whole Explorer. Layout toggles must not reset branch/history pages, selection, loaded patches/context, file expansion or reading anchors, nor trigger a history refresh or ref capture.

The fixed fullscreen host covers sidebar, top bar, chat and terminal/files panes, respecting safe-area insets and `--app-viewport-height`. Keep those panes mounted and their visibility/width preferences unchanged. Inert and focus management belong to the covered sibling regions: **do not make the center ancestor inert**, because it contains the Explorer. Cover or disable resize handles and backdrops too. Keep one effective expanded panel at a time; if a terminal/files panel is later expanded, restore Explorer first, without remounting either viewer.

Handle fullscreen Escape at the Explorer boundary in the bubbling phase, consuming it before the window-level agent-stop shortcut. Nested Wide view and other controls retain first refusal. On expansion, keep focus within Explorer; constrain keyboard traversal so it cannot reach covered controls. On restoration return focus to the expand/restore button, and on Close to the top-bar Git Explorer trigger. Native diff dialogs remain above the fullscreen surface and continue restoring focus correctly.

No changes to `/api/git/explorer`, captured-tip authorization, path security, lazy-read concurrency, immutable context boundaries or Git plugin semantics. No new dependencies expected.

## Non-Goals

Browser Fullscreen API, fullscreen Activity/Starred, draggable graph/detail splitters, persistent fullscreen preferences, terminal lifecycle changes, new Git operations, API changes, installed-service activation or remote publication.

## Plan

- [ ] Add expansion ownership and lifecycle transitions in `components/AppShell.tsx`; verify close/reopen, overview changes, mobile transition and coexistence with terminal/files expansion using focused shell-state regressions, preserving current pane visibility and widths.
- [ ] Add controlled expand/restore controls to `components/GitExplorerPanel.tsx`; verify labels, pressed state, keyboard activation and distinct Close behavior in a new `components/GitExplorerPanel.test.mjs`. Follow `docs/i18n.md` for new English messages rather than reusing file-specific labels.
- [ ] Add fullscreen host styling in `app/globals.css`; verify viewport bounds, safe-area handling, internal scroll containment and restored sidecar dimensions at 1280px, compact 900px and mobile 390px in the browser fixture. Preserve the existing graph/detail breakpoint.
- [ ] Add inert/focus/Escape handling at the correct sibling boundaries; verify tab containment, focus restoration and that restoring Explorer or closing nested Wide view cannot stop a running fixture agent or answer an approval. Keep shared global keyboard semantics unchanged unless a narrowly justified change is needed.
- [ ] Extend `e2e/git-explorer.mjs` and, where needed, existing diff-context fixtures to verify selection, history pages, graph/detail scroll, file expansion/context and reading anchors across expand/restore; assert toggling alone performs no new history/detail/patch/context reads. Include no-chat, empty/non-Git checkout, close/reopen, branch refresh/checkout reset, mobile transition and coexistence with an open files panel. Use existing no-provider fixtures; do not duplicate repository discovery.
- [ ] Update `docs/worktrees.md` and the Git Explorer section of `docs/feature-internals.md` to describe whole-Explorer expand/restore, mobile behavior and its distinction from per-file Wide view; review links and unchanged read-only contracts.
- [ ] Verify the settled implementation candidate through the complete Linux offline pipeline, ordinary browser acceptance, focused diff-context acceptance and real terminal acceptance listed below; record input identity, selection, result, wall time and artifact paths. Review the resulting diff before any integration proposal.

### Verification commands for implementation

Focused iteration (after the new test exists):

```sh
nix develop .#test -c node nix/test-offline.mjs --file components/GitExplorerPanel.test.mjs --file components/AppShell.terminal.test.mjs
nix develop .#test -c env E2E_DIFF_CONTEXT_ONLY=1 npm run test:e2e
```

Final acceptance:

```sh
nix develop .#test -c node nix/test-offline.mjs
nix develop .#test -c npm run test:e2e
nix develop .#test -c env E2E_DIFF_CONTEXT_ONLY=1 npm run test:e2e
nix develop .#test -c npm run test:terminal
```

The complete offline pipeline satisfies common tests/typegen/typecheck/lint; do not duplicate the npm baseline. Real terminal acceptance is required because AppShell's shared layout/inert behavior changes even though PTY code should not. Plugin acceptance is conditional on changes to shared approval/diff components or plugin behavior, not automatically required for an Explorer-only host/control change. Use isolated snapshots/free-port servers, not the installed service; no production builds. Pause writers during export and retain exact-run failure evidence under the documented retention policy.

## Risks

- Making the wrong ancestor inert disables Explorer itself. Browser keyboard checks must cover the actual DOM, not just source assertions.
- A fullscreen-only remount or resizing virtualized diffs can lose reading state. Preserve component identity and assert semantic reading anchors as well as graph/detail scrolling; avoid requiring impossible pixel equality after reflow.
- Escape propagation can accidentally stop the hidden running chat. Test a real blocked no-provider agent and nested Wide view, not just a mocked handler.
- Overlay/backdrop stacking can let the right panel obscure Explorer or intercept clicks. Test with both panes open at desktop and compact widths.

## Completion Checklist

- [ ] Whole Explorer fills the app viewport through a single header action; Restore and Escape return to the previous sidecar layout, and Close remains a separate dismiss action.
- [ ] Branch/commit/history and loaded review state survive layout toggles without a new repository capture; actual checkout/branch changes retain their existing resets and stale-read safeguards.
- [ ] Covered panes remain mounted but inaccessible; drafts, live terminal process identity, active chat and saved pane widths remain intact. Nested Wide view restores independently and Escape never aborts hidden work.
- [ ] Desktop, compact, mobile transition, no-chat and empty-checkout acceptance pass; focused and full required checks have exact-candidate evidence or an explicitly accepted blocker.
- [ ] Maintained documentation is updated. Implementation authorization, reviewed feature commits and separately approved exact-state non-FF integration into local `rst-main` are handled; publication and resource cleanup remain separate.

## Planning Handoff

This artifact records researched scope and the user's fullscreen choice. Implementation and acceptance tasks deliberately remain unchecked. Saving or integrating this document does not implement, verify or activate the feature.
