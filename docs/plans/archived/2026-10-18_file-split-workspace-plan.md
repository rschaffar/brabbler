# File split workspace — UX proposal

Status: **Implementation and complete acceptance finished.** The user authorized implementation and confirmed both opt-in link destinations per document and parked-editor recovery without changing chat. Work remains isolated on `docs/file-split-workspace-design`. This status grants no integration, publication or activation authority; completion/integration remains a separate Git workflow decision.

## Goal

Read an author-led review with the guide continuously visible while following source links. Support two, three, four or more simultaneously visible files through explicitly created side-by-side and stacked panes. Ordinary browsing must never keep creating splits.

**The mental model: split the workspace, not every link. Each pane has tabs; a guide can send links to a chosen pane.**

## Context

Research baseline: local `rst-main` at `1fe0a04c2d6d11e0c301457e379289d3a61f1508`. Research used repository source and the supplied review-session excerpt, not a live browser inspection of the linked session or a verified Herdr comparison.

- `components/AppShell.tsx:1091–1117` opens every file in one shared group and activates it. A Markdown guide therefore disappears when its source link activates another tab.
- `components/TabBar.tsx` has one tab list; `components/file-tab-state.ts` keys tabs by path and protects pending jumps and in-flight saves. Merely adding CSS columns would not give independent navigation or safe duplicate views.
- `components/MarkdownBody.tsx` and Markdown links in `components/FileViewer.tsx` already resolve file links and source targets. `lib/file-links.ts:20–26` deliberately handles Ctrl/Cmd-click in-app for local files: preserve this instead of inventing browser-tab semantics.
- [File/link/editing contracts](../../feature-internals.md) already own relative-root restrictions, reference-only reads, source jumps, drafts and save ownership. These remain authoritative.
- Files and terminals currently share the right panel; the panel can expand without dismissing chat. Git Explorer and per-file diff Wide view have separate expansion/focus contracts.

## Plan Relationship

No existing active plan found for file tab groups or cross-pane document links. [Git Explorer sidecar](../2026-09-28_git-explorer-sidecar-branches-plan.md) and [Explorer fullscreen](../2026-10-13_git-explorer-fullscreen-plan.md) own adjacent surfaces, not a general file workspace. This proposal does not reopen their Git APIs, immutable review rendering or outstanding checks.

The supplied review document is an example workflow, not an input to change or copy into this repository.

## Experience

[Static visual concept](../assets/file-split-workspace.svg) — three-file review layout, routing indicator and a four-file variation. This is a wireframe, not a working prototype.

### 1. Start ordinary; opt in from the guide

Opening the review from chat behaves exactly as today: it opens in Files. No new pane and no automatic “review mode.”

The rendered guide toolbar adds a compact **Links: Here ▾** control. Choosing **New pane right** or **New pane below** both creates an empty destination and sets that guide's route in one action. Existing panes appear as destinations too. This setting belongs to this guide view, not every Markdown file, chat message or workspace.

Once configured, the control reads **Links → Pane 2 ▾**. Its menu shows a small layout map and each pane's stable number plus active filename; spatial words alone become ambiguous in nested layouts. Selecting a destination briefly outlines it. Pane numbers are stable until the layout is discarded; they are not renumbered after closing a neighbor.

The first source link opens at its requested line in Pane 2. The guide keeps its scroll position, text selection and keyboard focus. Further source links reuse Pane 2, not a new split. A subtle destination highlight and polite screen-reader announcement confirm the navigation.

**No global “always split links” preference. No hidden destination determined by whichever pane was clicked most recently.**

### 2. The recommended review layout

Two files:

```text
┌──────────────────────────┬───────────────────────────────┐
│ 1  Walkthrough.md        │ 2  CandidateFactory.cs         │
│ Links → Pane 2 ▾         │ ← →    Keep open    Split ▾   │
│                          │                               │
│ Explanation and links    │ Source at the clicked range   │
│ Stay where you are        │ This pane follows the guide   │
└──────────────────────────┴───────────────────────────────┘
```

Three files: split the code pane **below**, then use the test link's **Open in pane… → Pane 3** action. Splitting initially duplicates the code view; opening the test in Pane 3 makes the comparison below. The guide still targets Pane 2:

```text
┌──────────────────────────┬───────────────────────────────┐
│ 1  Walkthrough.md        │ 2  CandidateFactory.cs         │
│ Links → Pane 2 ▾         │ Follows the guide's links      │
│                          ├───────────────────────────────┤
│ Read at your own pace    │ 3  CandidateFactoryTests.cs    │
│                          │ Kept for comparison           │
└──────────────────────────┴───────────────────────────────┘
```

Four files can use a 2×2 grid, or three on the right beside a full-height guide. Repeat **Split right** / **Split below** on any pane: there is no fixed two-pane limit. Initial guide/code proportions are approximately 45/55, and stacked children start at 50/50; every divider is adjustable. These are design starting points, not measured usability optima.

Use the existing **Expand Files** control to give this entire layout the viewport when chat is not needed; restore brings chat back without losing panes. Do not maximize just the last clicked file or automatically hide chat when a link opens.

### 3. Keep another file without changing the guide's destination

The receiving pane has one replaceable **preview tab**, shown with italic text and an accessible “Preview” label. Routed links reuse this slot. A twenty-link walkthrough therefore produces one following code view, not twenty tabs.

- **Keep open**, double-clicking the preview tab, or entering Edit promotes it to an ordinary retained tab. Clicking another link then creates a new preview tab in the same pane.
- Keep open protects the tab from replacement, **not its continued visibility**. To keep a file visible while following further links, use **Split right/below** or move it into another pane.
- A tab's **Split right/below** opens a second view of that file in a new pane, initially at the same reading location. The original stays visible; subsequent scrolling is independent. Split alone never changes any guide's destination.
- **Move to pane…** moves a tab into an existing group. It does not duplicate the document or silently close other tabs. An emptied source group collapses.
- Normal, non-routed opens retain today's open/activate-tab behavior; preview replacement is not a surprise change to all file browsing.

### 4. Per-link actions, without changing future clicks

Local-file links have a Pi Web action menu, available by right-click, a small focused/hover affordance, keyboard context-menu action, and touch long-press. Keep Copy link available. Do not apply these actions to web links or rejected local paths.

```text
Open here
Open in pane…       [layout map + existing panes]
Open in new pane right
Open in new pane below
Copy link
```

These are one-shot overrides. **Only the guide toolbar changes its remembered route.** This distinction matters: inspecting a test in Pane 3 should not make every later guide link land there.

New-pane actions are relative to the originating pane, never an inferred neighbor. For chat links, which have no source file pane, explicitly name the last active file group as the split base in the menu; if no Files workspace is open, offer Open in Files first instead of a geometric action without a visible base. Menus use **right/below**, with tiny layout icons, instead of the ambiguous “vertical/horizontal split.” Both orientations remain available.

Ctrl/Cmd-click on local links retains the existing in-app behavior and follows the same routing policy; it is not required to discover splits. Existing web-link modifier behavior is untouched. No new shortcut is essential to the first delivery; choose optional shortcuts only after auditing browser, editor, terminal and accessibility conflicts.

## Navigation contract

| Action | Destination | New pane? | Reading/focus behavior |
| --- | --- | --- | --- |
| Ordinary link from a guide with no route | Its own group | Never | Open/activate the target tab; keep the guide as a tab |
| Ordinary cross-file link with a valid guide route | That exact group | Never | Reuse its preview or existing target tab; retain focus in the guide |
| Open here | Originating group | Never | Bypass any route for this click |
| Open in pane… | Explicitly selected existing group | Never | One-shot; no change to the guide route |
| Open in new pane right/below | New sibling of the origin | Yes, once | One-shot; no change to the guide route |
| Links menu → New pane right/below | New sibling of the guide | Yes, once | Also remember it as this guide's destination |
| File link from chat | Last explicitly active file group, or the original group if none | Never | Existing ordinary open behavior; do not inherit a guide's route |
| Same-document heading/footnote or source-line link | Originating document view | Never | Scroll locally, even if the guide has a route |
| Ordinary external URL | Existing web-link behavior | Never | No file workspace routing |

Routing applies to cross-file local links of **all file types**; do not guess whether a filename means “code” or “next chapter.” A link to the next Markdown chapter would follow the route too. **Open here** is the explicit chapter-navigation action; the new chapter starts with Links: Here. Applying one route across a chapter series is deliberately deferred rather than silently making per-document opt-in a workspace rule.

A chosen destination always wins over global de-duplication. If the file is visible in another pane, open a view in the requested pane rather than jumping the user elsewhere. Within a group, an open reuses an existing matching-resource view: prefer the active matching view, otherwise the most recently active match. Independent instances of the same file have independent scroll, mode, history and line-highlight state. Move/join/reset operations retain view IDs rather than silently coalescing same-file views; if both land in one group, disambiguate their tabs with view numbers. Preserve each view's route, pending jumps and draft-owner association; any route that becomes self-targeting becomes invalid. Only explicit tab closure removes a view, under the ordinary edit/save protections.

Each pane has **Back/Forward** for visited file locations, including source line/range, PDF page and reading position. Preview replacement does not destroy the way back. Consecutive identical history locations may coalesce, but an explicit repeat click still performs a fresh jump. These controls are local to the pane, not browser-history navigation or chat switching. First-delivery history is memory-only and bounded to the latest 100 locations per group; branching navigation clears Forward.

If the destination is closed, **do not create another pane, choose a different pane or replace the guide**. The toolbar shows **Choose destination**. A subsequent link action offers a compact choice of existing panes, a new pane or Open here; until chosen it does not navigate. Clearing the route explicitly restores Links: Here. Moving the guide itself retains its route unless it would now point at its own group, in which case routing becomes invalid and requires a new choice. Restored, stale or removed IDs follow the same rule.

Reference-only or denied files retain their usual read-only/error presentation **inside the destination**. An error must not remove the guide, create more panes or authorize a different path. Navigation carries the originating source-session and cwd context; changing layout is never a new file-access grant.

## Pane controls and responsive behavior

- A compact header includes pane number, tab strip, Back/Forward and **Split ▾**. The rendered guide's link-routing control belongs to the document toolbar, so another tab in that group does not inherit it.
- Split menu: **Split right**, **Split below**, **Move tab to pane…**, **Focus this pane**, **Close pane**. Focus temporarily fills the Files workspace; restore returns the original layout. Whole-workspace Expand Files remains a separate action.
- Closing a tab uses existing unsaved/save protections. Closing a pane with retained tabs asks to **Move tabs to [pane]**, **Close tabs**, or Cancel; Close tabs requires the same dirty-draft decisions as individual closes. An empty pane closes immediately. Removing a destination invalidates incoming routes visibly, even if its tabs were moved elsewhere.
- Dividers have pointer/touch hit areas wider than their visible line, keyboard resizing and a reset-to-equal action. Proposed minimum leaf content area: 320px wide × 200px high, excluding headers. If a requested split cannot fit, keep it disabled with an explanation and offer Expand Files or rearrangement. Do not create unreadably tiny panes or hide the source automatically.
- On a narrow viewport, project the saved tree into a **one-pane-at-a-time** view with a compact pane switcher. A routed link displays its destination and an explicit **Back to [originating guide]** return action; return resolves that view's current pane and restores its exact reading position and focus, even after the guide moves. Other pane tabs remain available. Disable new geometric splits that cannot fit; retain the tree and restore it when space returns. Never destroy panes because the phone rotated or a sidebar opened.
- Tree reshaping can rearrange tab groups, not clone chats. Chat remains the single current session with its existing SSE, questions and composer.

### Accessibility and focus

Each group is a labelled region with its own tab list; labels distinguish “Pane 2 — Factory.cs” from another view of the same file. Active-pane styling and destination styling are visually distinct and do not depend on color alone. The destination is also named in the guide's toolbar.

All operations are available without dragging, hovering or modifier-clicking. Retain roving tab focus in each tab list; make splitter orientation/value and keyboard instructions accessible. Provide a menu-based next/previous-pane command. Plain routed clicks do not steal focus; users can explicitly focus the destination via its header/menu. Narrow-screen navigation is an exception because only one pane is presented, and must move focus to its labelled content region.

Nested menus/dialogs and diff Wide view consume Escape first; then pane Focus restores; then whole-workspace expansion restores. Escape must never fall through to Stop a running agent, answer an approval, discard an edit or close the workspace. Expanded/hidden regions follow existing inert/focus rules; reduced-motion users get no destination pulse animation.

## Architecture

The following is the historical proposal, not the current API reference. Implemented ownership/lifetime decisions now live in [ADR 0027](../../adr/0027-file-split-workspaces.md), current behavior in [Feature contracts](../../feature-internals.md), and the source map in [Architecture](../../architecture.md).

- Introduce a client-side workspace model with a recursive layout tree: a split has an explicit left/right or top/bottom axis, ratio and two children; a group has a stable ID, ordered view IDs, active view, optional preview and bounded location history. UI words remain right/below.
- Separate **resource**, **view**, **group** and **link intent**. A resource preserves the existing path/access/source context. A view has its own ID and viewer state. A guide view optionally names a destination group. An open intent carries origin view, source-session/cwd, path, line/page and explicit disposition. Capture origin context when the user acts; do not later substitute the currently selected chat.
- Use one pure navigation reducer to choose destinations, coalesce tabs within a group, invalidate stale routes, manage preview promotion/history and reject invalid tree mutations. Keep it outside the large AppShell component; test transitions without rendering.
- Keep the existing path-resolution and server-access boundary. Do not replace it with browser string equality, normalize away Windows/UNC identity or union permissions between two views. Reference-source changes remain explicit. Live-file viewers are still live saved files, not immutable Git snapshots; historical Explorer and approval content stays in its current renderer.
- Lift draft/save ownership from one visible tab to the authorized resource owner. Allow multiple saved-content views, but **only one Edit owner** for a given physical writable file. Another occurrence offers **Go to editor in Pane N**, not a second writable draft. Reference-only views never become editors through sharing. Preserve revision checks and pending navigation until a save settles; dirty previews are promoted before they can be replaced. A denied/symlink/ambiguous identity cannot acquire edit ownership.
- Mount each visible group's active file viewer; inactive tabs do not add watchers. Narrow/focused projections suspend non-visible reads/watchers after safe settlement. Old callbacks are guarded by view/resource/navigation generations, not just path. Preserve semantic reading anchors across resize, restoration and moving a view; avoid a remount from every layout action.
- Existing terminal tabs remain singleton views with unchanged PTY/lifecycle ownership. A file Split never duplicates a terminal. Moving/joining groups must not remount the PTY or kill a shell. A layout-owner spike must establish retained host identity before implementing group moves; terminal splitting and new terminal controls are not part of this feature.
- Park file workspaces by originating session ID plus saved cwd; no-chat workspaces use the selected cwd identity. Returning to a chat restores its review, not another session's routing. Terminals retain their existing independent workspace/lifecycle scope. Session relocation/cwd changes must invalidate or explicitly rebind old workspace metadata rather than reuse authority.
- First delivery preserves workspaces **in memory**, including across chat switches, pane focus and responsive projection. A browser reload returns to the current ordinary single-group starting state; retain existing unsaved-edit warnings and terminal restoration behavior. Reload recovery is a follow-up, not a gate for the essential review workflow. Any later persistence design must be bounded/versioned navigation metadata only, never contents or drafts, and must reauthorize every restored resource.
- No new package is assumed. First verify whether the existing resize/focus primitives can support nested axes without becoming a collection of global CSS widths. Choose a library only if that spike establishes a concrete need.

## Preliminary implementation direction

Requested follow-up: a solid implementation idea and justified restructuring, **not a detailed execution plan or authority to implement**. Prefer a bounded file-workspace extraction over an AppShell rewrite or general docking framework.

### Boundaries worth introducing

1. **Workspace model/controller.** Move file groups, view membership, active group, preview slots and routing into a focused `file-workspace` module. Pure transitions decide navigation and layout changes; a small React controller binds reads, edit sessions and callbacks. AppShell retains outer panel visibility/expansion and chat/session integration. Initially adapt the existing single-group behavior, rather than changing structure and UX simultaneously.
2. **Domain types independent of tab presentation.** Today `components/TabBar.tsx:8–24` defines a Tab containing file identity, reading state, drafts, save flags and pending navigation; `file-tab-state.ts` imports that UI-owned type. Move domain types out of TabBar. Its new input is presentation metadata and callbacks, not the owner of file operations.
3. **Distinct identities.** A read resource captures path plus originating cwd/source-session; a view has an opaque ID, navigation generation and reading/mode state; a group owns ordered view IDs; an edit session owns draft/baseline/save generation and its editor view. Same-file views share no scroll state, and sharing an edit lock grants no read/write authorization. Authoritative writable-path identity is an early design check: use a narrowly scoped edit-response identity field if existing metadata is insufficient, not browser path-string guesses or a new access API.
4. **Explicit navigation commands.** Replace positional, context-poor file opens at the workspace boundary with an intent object carrying captured origin, target location and disposition. Ordinary opens adapt to it; resolved Markdown links do not choose panes. Existing `OpenFileLink` callers can migrate through an adapter instead of a repository-wide callback rewrite. Each explicit jump gets a navigation ID consumed by its existing viewer; do not put that ID into the React key. Source/session changes are separate identity transitions, not just new line targets.
5. **Edit ownership outside the renderer.** Extract TextFileViewer's draft/save transaction lifecycle into a resource edit-session controller. The current local draft is mirrored to AppShell; it is not a controlled shared session. Making two copies of `initialDraft` would therefore create divergent editors. Preserve current revision checking, typing during save, conflict display and delayed navigation. A single editing owner is enough; other views show saved content and Go to editor. The user subsequently confirmed that a parked editor should open in Files without changing chat, with a visible context banner and return control; do not depend on switching to an old session/cwd to recover its draft. Do not add collaborative editing or a shared content cache.

Suggested ownership, not committed filenames:

```text
AppShell                         outer shell, chat integration, expansion
  FileWorkspace                  workspace controller and stable hosting
    PaneGroup / TabBar           tabs, group controls, focus
    FileViewHost → FileViewer    scoped read/view commands and edit binding
    Terminal hosts               existing singleton runtime, retained parent

lib/file-workspace/              domain types, transitions, navigation, geometry
hooks/useFileEditSession         draft/save ownership and subscriptions
```

Keep frequently changing editor text and scroll reports out of whole-AppShell renders. Use per-session/per-view subscriptions or local refs as appropriate; a new global state library is not justified for this feature.

### Layout tree is data, not viewer lifetime

Prefer a binary split tree for geometry, with **stable sibling hosts** for pane chrome and live content. Derive rectangles and separator positions from the tree and available container size. Split, focus, mobile projection and moving a view then change geometry/visibility rather than its React ancestry. A naive recursive `Split → Group → FileViewer` renderer can remount surviving content when a leaf gains a split parent, even with unchanged keys. Likewise, a portal whose target changes is not a keep-alive solution.

Prototype the exact stable-host DOM and its labelled regions/tab panels before committing to this rendering strategy. It must preserve browser focus/selection and semantic reading anchors, remain accessible in visual traversal order, and avoid mounting every inactive tab. Retain only visible viewers and lifecycle owners that must settle; keep terminal hosts mounted under one unchanged parent, matching the existing lifetime model. Layout shape must not trigger PTY creation/restore calls. Distinguish visible from focused: current terminal activation focuses xterm, so visibility in a multi-pane workspace cannot stand in for keyboard focus.

Use the existing resize hook's pointer/keyboard behavior as the starting point: `hooks/useResizablePanel.ts` already supports both axes. Extract its input mechanics if useful, but give nested separators parent-local ratios and subtree-derived minimum sizes; do not proliferate outer-panel CSS variables, global resize listeners or localStorage keys per split. Leave the outer Files-panel resizer alone.

### Reuse the current viewer, with narrow seams

Do not rebuild source, Markdown, media, CSV or Pierre diff renderers. Extract edit-session ownership and explicit navigation handling from TextFileViewer, then keep its rendering pipelines. Share a small resolved-local-link action component between chat Markdown and file Markdown for menus/dispositions; retain their different base-directory, sanitization and source-position behavior. Do not unify the two complete Markdown renderers merely to add a link menu.

Capture resource context when the view opens. Today AppShell passes `activeCwd` at render time (`components/AppShell.tsx:2632–2665`); the new controller must not accidentally rebind an old guide's reads, edit probes or delayed link navigation to a subsequently selected sidebar checkout/session. Existing server authorization remains final, and immutable Git Explorer/approval views stay outside this live-file workspace.

### Shape of the first implementation

First extract a behavior-preserving single-group workspace and its types; then establish stable hosting, independent view IDs and edit ownership. The first useful vertical slice is the guide plus a reusable code destination plus one independently visible third file, using both split axes. Preview replacement follows only once dirty/save protection is resource-owned. Menus provide creation/movement; no drag-and-drop, reload persistence, docking library, terminal feature work or broad shared-data cache is needed. Extend existing file-state, source-link, edit and terminal evidence rather than claiming pure reducer tests prove browser lifetime/focus behavior.

This narrows the main implementation uncertainty to stable hosting/accessibility and authoritative edit identity. Resolve those with a small prototype before writing a detailed task sequence or estimating the feature.

## Non-Goals

An IDE, multiple simultaneous chats, terminals in new geometric splits, synchronized scrolling, symbol lookup, historical line rebasing, Git snapshot links, browser-window management, arbitrary website embedding, persistent cross-device workspaces, review completion tracking, automatic chapter recognition, service activation or publication. Tab dragging is a possible later enhancement; first-delivery menus provide every required split/move action.

## Risks and recovery

- The main UX risk is an invisible route. Persistent source/destination labels, one-shot overrides and explicit stale-destination recovery make it observable and reversible.
- Duplicate views can introduce save races or lose reference-only boundaries. Resolve the draft-owner/identity spike before implementing duplicate editing controls; test actual saves and denied reads, not only reducer state.
- Reparenting active viewers can lose reading state or terminal identity. Require retained-host/anchor browser evidence before accepting drag/move-like transitions.
- Three files plus chat may be cramped. Workspace expansion and geometry admission solve space honestly; arbitrary automatic collapsing would undermine the user's chosen layout.
- Layout recovery must not mean data loss. Expose **Reset file layout**: join retained tabs into one group without coalescing view IDs, clear routes/ratios, and preserve drafts/terminal processes. It is not Discard all or a filesystem cleanup action and must not affect server files or chat history. A future reload-persistence feature needs its own stale-state/schema/reauthorization acceptance.

## Plan

The user has authorized implementation. No item is complete until its evidence exists. First establish the stable-host/edit-identity seams and a testable three-pane vertical slice, then complete the remaining controls and acceptance. The earlier separate disposable user-prototype step is superseded by testing the actual interactive implementation; no unobserved usability validation is claimed.

- [x] Not applicable: the separate disposable user-prototype step was superseded by authorization to implement and browser-test the actual workspace. The user confirmed per-document opt-in and unchanged-chat parked recovery; no unobserved usability study or Herdr comparison is claimed.
- [x] Resolve writable-path identity, stable hosting and nested geometry in the actual implementation; record the rationale in ADR 0027 and preserve the existing authorization/PTY boundaries. Core identity/geometry tests and real save/terminal checks provide evidence, not the original sketch alone.
- [x] Add `lib/file-workspace.ts`, `file-workspace-store.ts`, domain types and transition tests for nested groups, routing, preview/history, duplicates, stale destinations and geometry refusal; focused core selections pass.
- [x] Finish grouped/lazy tab-panel semantics in the existing Files host; wide/compact/mobile independent-view and keep-open checks pass, including valid inactive-panel ARIA targets without mounting readers/subscriptions.
- [x] Carry captured open context through chat/file Markdown and ordinary entry points. Source-link, traversal, absolute-reference and session-switch browser checks pass. A real two-page PDF regression proves repeated page intents reload only the embed while retaining its host, guide scroll and focus.
- [x] Add per-view destination controls and shared accessible link actions. Existing Markdown inventory checks confirm opt-in routing, one-shot overrides, source jumps and keyboard/menu navigation without requiring dragging or modifiers.
- [x] Add server-identified single-owner edits, typing-through-Save protection and guarded close/join/reset. File-edit acceptance proves real saves/conflicts; Markdown acceptance proves cross-view/cross-session ownership and reference-only no-probe/no-write boundaries.
- [x] Add in-memory scoped parking, responsive projection and explicit return to the moved guide/parked owner. Browser checks prove reader scroll restoration, pane/menu/Escape focus and unchanged-chat recovery; terminal checks prove live PTY identity. Missing-file failures stay inside the unchanged per-view error path. No reload persistence is claimed.
- [x] Hand current behavior to `docs/feature-internals.md`, module ownership to `docs/architecture.md`, PTY invariants to `docs/terminal.md`, labels to the English catalog and accepted tradeoffs to ADR 0027. This proposal is historical, not the operational owner.
- [x] Run complete acceptance on `14c4107788e7b000ba2bc3181a8ae05c66fbc53e` with `nix run .#test -- all --workers 4 --jobs 4`; all 345 core files / 2,617 tests, all 24 browser/terminal groups and the genuine deployment VM pass. Exact input, effective widths, intervals and artifacts are recorded below. The earlier full pass and focused checks remain separate evidence.

Focused commands should select the actual new reducer test file through `nix run .#test -- core --file <new-test-path>`; existing integration owners are `e2e --group markdown`, `file-edit`, `diff-context` and `terminal`. Register new scenarios in the maintained group inventory instead of adding a second unsupported runner. [Testing](../../testing.md) and [browser acceptance](../../../e2e/README.md) own execution, containment and evidence requirements.

## Completion Checklist

- [x] A walkthrough stays visible while at least five consecutive source links reuse one chosen pane, without creating additional panes or retained tabs.
- [x] The user can keep three and four file views visible using both right and below splits, rearrange them via menus and restore after temporary pane/workspace focus.
- [x] Two guides can target different panes; chat and unrelated documents retain ordinary behavior. A one-shot override changes no saved route; a closed destination never silently replaces the guide.
- [x] Preview retention, Back/Forward, repeated source/PDF jumps, duplicate views, unsaved edits, save conflicts, stale callbacks and denied references pass focused core and real browser checks.
- [x] Keyboard-accessible menus and touch-capable controls provide the workflow; browser checks prove responsive projection, Escape isolation, parked restoration, existing reload/terminal safeguards and live terminal identity. No manual assistive-technology or user study is claimed.
- [x] Maintained guides/ADR and complete Nix acceptance describe the settled application candidate. Evidence/archive follow-ups use documentation-only checks; any local integration remains a separate authorized Git lifecycle.

## Evidence and handoff

The earlier design-only claim ("Application checks are not claimed for a document-only proposal") is superseded by explicit implementation authorization and the evidence below. The initial 45/55 ratio, graphical mini-map and content-minimum figures were recommendations, not user findings: first delivery uses equal splits, constrained parent-local geometry and native labelled controls as documented in the feature guide. No measured usability optimum or user study is claimed.

Current mechanisms and accepted decisions have moved to the maintained guides and ADR 0027 named above. Reload persistence, dragging and a separate layout mini-map are explicitly deferred, not unfinished first-delivery obligations. Integration, activation and publication remain separate workflow/permission boundaries.

### Earlier acceptance and corrections

- `af4f8a3c1e592365204ba56869dddfb8c7c7b6bd`: `nix run .#test -- all --workers 4 --jobs 4` passed in **346 seconds end to end**, including in-run realization. All 345 core files / 2,617 tests, all 24 ordinary-sandbox browser/terminal groups and the genuine Home Manager NixOS VM passed. Requested/effective core and browser widths were four/four; admission observed 32 CPUs and roughly 54 GiB available memory, with no competing browser client at launch. These estimates are not reservations.
- That run's core interval was 327.7s outer, with 52.6s before the first test and 274.5s test execution; browser interval was 258.3s outer, with 7.1s before the first capsule and 251.0s across sandbox execution. VM outer time was 79.7s, with 22.3s evidence execution; remaining time includes realization/setup/collection and has no separate preparation timer. Intervals overlap and must not be added. This is not a cold-versus-warm benchmark comparison.
- Evidence: `/tmp/pi-web-file-workspace-acceptance-final.pHvpyZ/output.log`; `/tmp/pi-web-test-core.xGSQVH/run.json`; `/tmp/pi-web-test-browser.uZ53M3/run.json`; `/tmp/pwv-xxAXH5/run.json`. Matching input snapshot: `/tmp/pi-web-test-source-NIlORK/source`, digest `a3a551fe98b004015389948d03ae48338a155610103d5fc3747aee28c7cdd5c1`. Runtime was pinned Node 24.21.0 / Chromium 155 on x86_64 Linux, using the isolated production package, not the installed host service.
- Full attempt `/tmp/pi-web-file-workspace-acceptance.Qksdjy` at `20160261518b5c5138941e41f94580ae8167f02d` failed an obsolete hook source assertion requiring `setFileTabs([])` on project change. Its peers drained; it was not acceptance. The replacement retains stale-composer guards and requires hidden/scoped, nondestructive Files state; 56 focused tests passed (`/tmp/pi-web-test-core.8v1nJM/run.json`) before the successful full run.
- Focused parked-recovery failures were retained in `/tmp/pi-web-file-workspace-parked-checks.BKYBAY` (peer fixture inventory, before scenarios) and `/tmp/pi-web-file-workspace-parked-final.dSHL6f` (incorrectly requiring a clean reader's DOM identity across chat switches). The latter now tests saved-scroll recovery and live identity across subsequent layout changes. `/tmp/pi-web-file-workspace-settled-focus.mJQ1MF` passed static preparation, 116 affected tests and desktop/mobile Markdown acceptance.
- Closing the checklist exposed repeated PDF-page navigation under stable hosting and inactive tabs' missing ARIA panel targets. The PDF fix passed static preparation plus 46 tests and desktop/mobile Markdown acceptance (`/tmp/pi-web-file-workspace-pdf-focus.EVKgeV`, browser `/tmp/pi-web-test-browser.5aIXzx/run.json`). Candidate `2787904` adds empty inactive panel targets without mounting their readers; final complete evidence follows separately.

### Settled-candidate acceptance

Attempt `/tmp/pi-web-file-workspace-settled-acceptance.BAdDfV/output.log` at `2787904440e59d31f3340c08e4b05978c1c2158a` stopped on the source assertion that previously removed inactive panel hosts along with readers (core 515 passed / 1 failed; peers drained). The implementation now deliberately retains an empty hidden ARIA target, not a reader/subscription. Its guard contract is updated to assert the same selected/draft/saving predicate and conditional provider mounting. This failed attempt is not acceptance. Immutable input: `/tmp/pi-web-test-source-PYsydU/source`.

The post-correction complete run passed on **`14c4107788e7b000ba2bc3181a8ae05c66fbc53e`**:

- Command: `nix run .#test -- all --workers 4 --jobs 4`, **399s end to end**, including in-run realization but excluding model/coordination work. Requested/effective browser and core widths: **4/4**. Admission observed 32 CPUs and about 43.1 GiB available memory; no competing browser-group client was present, but host load was 10.4, so this is not a machine-exclusive or benchmark claim.
- Core/static/plugin acceptance: **345/345 files; 2,617/2,617 tests; zero skipped/cancelled**. Outer 387.0s; 69.9s before the first test; test-execution interval 316.7s. Evidence: `/tmp/pi-web-test-core.lySSS4/run.json`, output `/nix/store/xdxdmahkhgc94b1s4dppm3g0923zsfgr-pi-web-core-checks`.
- Complete browser/terminal inventory: **24/24 groups**. Outer 331.1s; 7.4s before the first capsule; 323.6s across sandbox execution. Evidence: `/tmp/pi-web-test-browser.9ZaPpX/run.json`. This includes the repeated PDF/embed, lazy ARIA target, saved-scroll, four-pane, independent-guide, move/reset, parked-owner, real edit/save and PTY checks.
- Genuine Home Manager deployment VM: activation, environment permissions, HTTP write, restart persistence and production PTY all pass. Outer 61.2s; evidence execution 18.6s. The remainder includes realization/setup/collection; a finer dedicated preparation interval is unavailable. Evidence: `/tmp/pwv-BPSe6k/run.json`. Stage intervals overlap and must not be added.
- Matching immutable source: `/tmp/pi-web-test-source-ALM8In/source`, pinned `/nix/store/zcf65pdzlr2k6giiys9h2mjixpvzxrrd-source`, digest **`c14a328015e19b491c88d45f84e018e70d073569923da188f50105843e6b7cec`**. Coordinator log/status: `/tmp/pi-web-file-workspace-acceptance-qualified.MUlEFu/`. The run used the pinned isolated production package/Node 24.21.0/Chromium 155, not a host development or installed service.
- Representative browser captures: `/nix/store/i62wmxgj9shysai05a4spc76a8dzwq9b-pi-web-browser-markdown-diagnostics/artifacts/file-workspace-three-panes-1280x800.png` and `file-workspace-four-panes-1280x800.png` in the same directory. These are synthetic sandbox scenarios, not the supplied live review session.

Between `14c4107` and `38027ba`, only evidence/archive paths changed; that documentation follow-up received local-link, whitespace/static-asset and unchanged-input checks. The acceptance above belongs to `14c4107`, not a relabelled later tip. The subsequent rebase changes inputs and requires the fresh evidence below. There is no activation, publication or cleanup authorization in this handoff.

### Integration preparation on the advanced local target

The user selected preparation for local `rst-main` integration. The guarded rebase onto `d999db0c0b25daab143f978859e33dca57811c46` encountered one mechanical source-map conflict in `docs/architecture.md`; it was aborted first and the clean original feature tip restored. Backup `backup/file-split-workspace-pre-rebase-20261020T210359Z` retains `38027ba8c6b75dbd68a45ec4ee7024eb99e56dae`. The user explicitly approved retrying while retaining both module lists. All ten feature commits then rebased; guarded no-op confirmation established `9bec0ebfeeb5ed05c19fb63f083f7187e66da602`. Range-diff and independent read-only review found no lost composer-focus, appearance, history-only session, Activity Later or terminal behavior.

Complete acceptance at `9bec0eb` (`/tmp/pi-web-file-workspace-rebased-acceptance.qqJl2c`) passed all **362 core files / 2,717 tests**, including the newer upstream tests. Browser acceptance stopped on the new constrained-appearance assertion; this was not a complete pass. Exact browser evidence: `/tmp/pi-web-test-browser.Q42gS7/run.json`.

The diagnostic-only appearance selection `/tmp/pi-web-file-workspace-overflow-diagnosis.hBUiGw` reproduced and measured the failure: viewport 1280px, document 1281px; the collapsed panel was 0px wide and statically positioned, while its absolutely positioned 1px live region used an outside containing block and escaped clipping. The unchanged assertion failed with these bounded diagnostics (`/tmp/pi-web-test-browser.kgHDDb/run.json`). This is evidence for a fix, not a passing unchanged retry.

Setting `position: relative` on `.file-workspace` keeps that live region's containing block inside the clipped outer panel, without global overflow hiding, remounting readers or changing deadlines. The complete appearance group then passed desktop/mobile, constrained Settings, theme and typography checks: `/tmp/pi-web-file-workspace-overflow-fixed.Fu8Ai1`, `/tmp/pi-web-test-browser.2I9V5I/run.json`; **129s command runtime including package realization, 43.244s sandbox execution**. A new complete run on the corrected rebased candidate remains required before merge approval.
