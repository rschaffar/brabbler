# Git Explorer fullscreen

## Goal

Let the entire Git Explorer fill the Pi Web app viewport, like the existing terminal/files-panel expand control, and restore its normal side-panel layout without losing the selected branch, commit or reading state.

The user explicitly selected **the whole Git Explorer**, not just commit diffs and not browser-native fullscreen. The initial request authorized this plan only. The user subsequently requested implementation and explicitly chose to keep the work on its dedicated branch, without local integration.

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

- [x] Add expansion ownership and lifecycle transitions in `components/AppShell.tsx`; verify close/reopen, overview changes, mobile transition and coexistence with terminal/files expansion using focused shell-state regressions, preserving current pane visibility and widths.
- [x] Add controlled expand/restore controls to `components/GitExplorerPanel.tsx`; verify labels, pressed state, keyboard activation and distinct Close behavior in a new `components/GitExplorerPanel.test.mjs`. Follow `docs/i18n.md` for new English messages rather than reusing file-specific labels.
- [x] Add fullscreen host styling in `app/globals.css`; verify viewport bounds, safe-area handling, internal scroll containment and restored sidecar dimensions at 1280px, compact 900px and mobile 390px in the browser fixture. Preserve the existing graph/detail breakpoint.
- [x] Add inert/focus/Escape handling at the correct sibling boundaries; verify tab containment, focus restoration and that restoring Explorer or closing nested Wide view cannot stop a running fixture agent or answer an approval. Keep shared global keyboard semantics unchanged unless a narrowly justified change is needed.
- [x] Extend `e2e/git-explorer.mjs` through `e2e/git-explorer-fullscreen.mjs` to verify retained graph/detail nodes, branch selection, file expansion/context and virtualized reading anchors across expand/restore; assert toggling loaded review state performs no new history/detail/patch/context reads. Include no-chat, close/reopen, existing branch refresh/checkout reset, compact/mobile transitions and an open files panel. Real blocked SDK, quote-composer draft and shadow-DOM gap controls pass. Empty-cwd controls pass in `GitExplorerPanel.test.mjs`. Evidence: browser-D8VAOv and browser-y9DEtp below.
- [ ] Add dedicated fullscreen browser cases for already-paginated graph/history scrolling and an unsupported/non-Git checkout; verify expanded controls and restore preserve existing history/error state. These original coverage obligations remain owned by this plan, not silently treated as passed by the inherited API tests or three-commit browser fixture.
- [x] Update `docs/worktrees.md` and the Git Explorer section of `docs/feature-internals.md` to describe whole-Explorer expand/restore, mobile behavior and its distinction from per-file Wide view; review links and unchanged read-only contracts.
- [x] Verify the settled implementation candidate through the complete Linux offline pipeline, ordinary browser acceptance, focused diff-context acceptance and real terminal acceptance listed below; record input identity, selection, result, wall time and artifact paths. Review the resulting diff before any integration proposal.

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

- [x] Whole Explorer fills the app viewport through a single header action; Restore and Escape return to the previous sidecar layout, and Close remains a separate dismiss action.
- [x] Branch/commit and loaded review state survive layout toggles without a new repository capture; actual checkout/branch changes retain their existing resets and stale-read safeguards. Retained graph identity protects its local page state; dedicated paginated browser coverage remains above.
- [x] Covered panes remain mounted but inaccessible; drafts, live terminal process identity, active chat and saved pane widths remain intact. Nested Wide view restores independently and Escape never aborts hidden work.
- [x] Desktop, compact, mobile transition and no-chat browser acceptance plus empty-cwd component checks pass; focused and full required checks have the candidate/input evidence below. The two additional browser cases above remain open.
- [x] Maintained documentation is updated and implementation is authorized and committed. Not applicable: integration into `rst-main`, publication and feature-resource cleanup; the user explicitly selected retention on this branch. No rebase, merge, remote operation, production build or installed-service activation was performed.

## Planning Handoff

This artifact records researched scope and the user's fullscreen choice. Implementation is authorized; completed tasks are checked only against the evidence below. This plan stays active because dedicated pagination/unsupported-checkout browser coverage remains open. Work stays on `docs/git-explorer-fullscreen-plan` in the linked worktree `git-explorer-fullscreen-plan`; integration and activation are not authorized.

Focused iteration passed: `nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs --file components/GitExplorerPanel.test.mjs --file components/AppShell.terminal.test.mjs` completed all static phases and 7/7 tests across 2 files. Evidence: `/tmp/pi-web-test-offline.glwzruY5/artifacts/run-g3kMWX` and `/tmp/pi-web-test-offline.glwzruY5/lifecycle.json`. This predates browser fixture/documentation changes and is not final acceptance.

### Acceptance evidence

Implementation candidate: `b874d07af1cd40e3859c8695cba0913f9c87c65b`; separate bounded account-fixture repair: `1c42e47fbde9e9c0129dafd71457f65bd3e28170`. Final checkout/browser-export content-mode digest: `f16580ae75c3e94867f5d72f8267d456e2d8377768eee799d5d27ef523186882`. All runs used Linux Nix test tooling and private snapshots; browser/terminal acceptance used isolated Chromium contexts and owned free-port Turbopack servers. No live model or provider credentials were used.

| Command / selection | Result and input scope | Command wall time | Retained evidence |
| --- | --- | --- | --- |
| `nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs` | PASS: 284/284 files, 1,835/1,835 tests; exporter/typegen/typecheck/lint passed. Inner source digest `0f857e01b6abeb4b897a7d11d6304704050292b6e63763a7b18d51231a398093`. | 167s | `/tmp/pi-web-test-offline.WWs1qPSl/artifacts/run-gHBj6K`; lifecycle and source-input manifest in its parent root |
| `nix develop --offline --no-write-lock-file .#test -c env E2E_DIFF_CONTEXT_ONLY=1 npm run test:e2e` | PASS: Explorer fullscreen plus Explorer/Files long-context and desktop/mobile reader acceptance. Export digest `9f0b75f40b381175c867dd0dba927058cf42e60db828e5414c3a4e2b7a9b3c8d`. | 108s | `test-results/e2e/browser-D8VAOv`; fixture root `/tmp/pwe-A0GTSG/fixtures` |
| `nix develop --offline --no-write-lock-file .#test -c bash -c 'export PI_WEB_TEST_SHELL="$(command -v bash)"; npm run test:terminal'` | PASS: real shell acceptance at 1440px/390px including Explorer round trip with retained PID/environment. Export digest `59715a4fbd44d03a0269d991ee4c6a2e5d208d6568efd46a47fe8c2223f7ffae`. | 55s | `test-results/e2e/terminal-o5riqQ`; fixture root `/tmp/pwe-cXGmUY/fixtures` |
| `nix develop --offline --no-write-lock-file .#test -c env E2E_ACCOUNT_ONLY=1 npm run test:e2e` | PASS: synchronized account-fixture persistence and clearing; no account implementation change. | 50s | `test-results/e2e/browser-SJXg6c`; fixture root `/tmp/pwe-6tTP8t/fixtures` |
| `nix develop --offline --no-write-lock-file .#test -c npm run test:e2e` | PASS: complete ordinary browser acceptance on candidate `b874d07`, including fullscreen, Files, questions, quoting/forks, session launch and manager flows. Export digest matches final checkout above. | 1,061s | `test-results/e2e/browser-y9DEtp`; fixture root `/tmp/pwe-yax9cS/fixtures` |
| `nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs --file components/GitExplorerPanel.test.mjs --file components/AppShell.mobile-toolbar.test.mjs --file components/AppShell.terminal.test.mjs --file lib/panel-focus.test.mjs` | PASS on committed `b874d07`: fresh complete static phases and 23/23 focused tests across 4 files. Not full-suite acceptance. Inner source digest `1406da261b23995b6c16d3085c1587e84a1207ea36195e31846edb8049ed7226`. | 36s | `/tmp/pi-web-test-offline.n6ayZ49K/artifacts/run-3JY1mC`; lifecycle and source-input manifest in its parent root |

Times above measure each command, not model work, review or coordination. Browser suite times excluding outer preparation were 103.3s focused and 1,055.3s full; terminal suite time was 48.4s. The full core inner pipeline took approximately 161.6s, with the remaining command time in outer shell/export preparation. These are run observations, not hardware-independent benchmarks.

Content-hash comparison of full-core and final-browser source manifests found only `e2e/browser-suite.mjs` and `e2e/terminal-suite.mjs` changed: application source, core-discovered tests, manifests, lockfile and toolchain inputs were unchanged. Do not relabel the earlier full baseline as a new-tip run; final-tip static/focused and full browser checks are separate evidence. Terminal application inputs are likewise unchanged by the later account-fixture-only commit. The evidence-only follow-up needs document review, not another application acceptance cycle.

### Review and retained failures

Independent read-only review found two concrete isolation gaps: a body-portaled quote composer could remain interactive above Explorer, and light-DOM-only focus traversal skipped Pierre gap controls. Both were fixed, re-reviewed and exercised by the passing browser suite. Current behavior was handed off to `docs/worktrees.md`, `docs/feature-internals.md` and `e2e/README.md`.

Failures remain retained, rather than hidden by automatic retries or widened deadlines:

- `browser-UVFrPP`: restored-width assertion captured the files-panel opening animation; the fixture now waits for the actual animation's completion.
- `browser-4ozDYh`, `browser-A6XPSt`: exact accessible-name mismatches for the arrow-prefixed Back control and quote dialog were corrected against source/catalog labels.
- `browser-qTu2MU`: an open quote composer occluded the file-panel toggle; the fixture now opens that panel first and uses ordinary Enter activation for expansion. No forced click.
- `browser-rOwRQQ`: the shadow-gap assertion incorrectly required a native BUTTON tag; it now asserts Pierre's actual `data-expand-button` control. The screenshot already showed focus on that shadow control.
- `/tmp/pi-web-test-offline.Mb0xCQdl`: an existing source-contract assertion required the old expand callback statement order; it now also requires clearing Explorer expansion, preserving the top-panel-dismissal assertions. This failed run left 255 files unstarted; only the later complete full run establishes baseline acceptance.
- `terminal-sV7xsO`, `terminal-JACAQJ`: mobile fixtures tried to click the top bar through a full-width terminal or reopen files while the mobile Git list hid that toolbar. The test now hides the mounted terminal before opening Explorer and tests simultaneous panes only on desktop; both real-shell viewports subsequently passed.
- `browser-opUHex`: broad run failed after fullscreen scenarios at the account-persistence assertion. Exact server/event logs showed canonical GET before the selection PUT completed; `1c42e47` waits for the exact successful PUT before retaining the same persistence assertions. Account-focused and complete broad acceptance subsequently passed.

Run-owner cleanup removed only observed-settled current-run dependency/generated bulk under the repository's retention policy. Source snapshots, manifests, traces, diagnostics and fixture state remain. No historical artifacts, feature worktree or branch were removed.
