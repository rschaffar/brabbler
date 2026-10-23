# Guided review: interaction draft

**Interaction direction approved; static specimen, not shipped UI.** This is the
interaction specimen for the [active plan](../../2026-10-23_guided-review-notebooks-plan.md),
not a competing plan or final serialization format. The user accepted the rough
layout and workflow, explicitly not a pixel-perfect specification, and separately
authorized implementation with architectural refactoring and component adaptation.

## Start here

1. Inspect the [desktop reader sketch](desktop-reader.png).
2. Inspect the [mobile storyboard](mobile.png): Guide, Evidence and Compare are
   three views of **the same step**, not three steps.
3. Read the [sample notebook](sample/index.md), especially step 1.2's paired targets.
4. Inspect the separately labeled [interactive review sketch](desktop-review.png).
5. Read the sample's finding/reply exchange, then answer the design-review
   questions below. Selecting a design does not authorize feature implementation.

Editable originals: [desktop reader](desktop-reader.svg),
[mobile storyboard](mobile.svg), [interactive review](desktop-review.svg).
PNG previews were rendered with `rsvg-convert` 2.62.3 in an offline temporary Nix
shell (`nix shell --offline --no-write-lock-file --inputs-from . nixpkgs#librsvg`)
and visually inspected. This is image review, not browser verification.

The SVGs are static illustrations. Drawn controls have no behavior. The sample's
existing `pi-review` fences can expand real pinned evidence in a supporting Pi
Web reader, subject to normal authorization. All other tour/forms/state behavior
is prose. No test run, live answer, finding or agent response is recorded here.

## The review journey

**Inspect → compare → judge → leave a concern → investigate later.** One coherent
question defines a step; file boundaries do not. A chapter groups related review
questions. The sample has a three-step chapter and a one-step follow-up chapter
so file-boundary navigation can be discussed concretely.

### Increment 1: guided reader

- Ordinary Markdown opens in Document mode. **Start guided reading** explicitly
  activates this notebook's first/selected step and its selected evidence. Opening
  or scrolling the document alone does not load historical evidence.
- Desktop: a collapsible chapter/step outline, a readable explanation column,
  and a larger evidence region. **Compare** divides the evidence region between
  two targets. **Focus evidence** temporarily gives code more space; it does not
  abandon the current step. The sketch is a wide-screen arrangement, not a
  mandatory three-column minimum at all desktop widths.
- Each step starts with the review question and a short Look at / Check for / Why
  it matters explanation. Optional context expands in place. Do not force every
  step into a fixed viewport or truncate a long explanation.
- Evidence selectors use meaningful names (Implementation, Immutable-source test),
  paths and revision/side labels, not anonymous tabs. Source / Diff is a view
  choice; selecting an excerpt does not imply there is a diff in that commit.
  Feature comparisons later identify explicit base and candidate endpoints,
  separately from a labeled first-parent commit diff.
- Back/Next changes review **steps**; a chapter menu changes chapters. From step
  1.3, Next opens step 2.1 in another Markdown file. At either tour end, disable the
  absent direction with a clear boundary label. Chapter jumps remain unrestricted.
- Exploring context or another file retains the current step and exposes
  **Return to step 1.2**. Do not reuse file-history Back for this action. Closing
  the guide cancels its navigation/read ownership, not a chat/terminal session.
- Show current location and **visited**, if shown, as reading position only.
  There are no Reviewed marks, answer fields, feedback counts or write activation
  in the reader-only increment. Do not display inactive forms as if they work.

### Narrow screens: same question, different projection

Use one pane at a time, keeping chapter/step location and the question visible.
**Guide / Evidence** changes the presentation of the same step and never advances
it. The Evidence view exposes target selection, source/diff mode and context.
Compare offers **stacked A + B** with both identities, independent horizontal code
scrolling and a clear **Back to guide** action. Target switching is separate from
step Back/Next. Do not squeeze two code panes side by side on a phone.

The persistent bottom step-navigation bar reserves content space and remains
keyboard-safe; forms in increment 2 may scroll it above the soft keyboard rather
than overlay inputs. The outline becomes a chapter/step drawer. On step changes,
announce the new location and focus its heading; on Guide/Evidence changes, keep
focus on the selected control. Return restores the previous local reading place.

### Increment 2: recording and feedback

**Enable review recording** is separate from guided reading. Before writes, show
`<notebook>/review-data/`, explain that these are local working-tree files and
that nothing is automatically staged, committed or shared. Resolve actual file
write authorization independently. Read-only/reference-only access remains a
useful reader; export/recover unsaved text rather than silently widening access.

After explicit activation, saves show Saving / Saved / Save failed / Conflict,
not optimistic success. Navigation must not discard an unsaved answer. A conflict
preserves the local draft and offers inspection/reload/export; no last-write-wins.

- Step state is an explicit menu: Not reviewed / In progress / Needs attention /
  Reviewed. Entering a step or answering a form does not change it automatically.
- A required prompt has an Answer path (text or authored choices, with an optional
  explanation) and distinct Unsure / Not applicable / Skip outcomes. Any explicitly
  recorded outcome satisfies response presence, not correctness or agreement.
- **Next remains enabled while a required prompt is unanswered.** Only Reviewed
  is unavailable, with a visible reason and a focusable link to that prompt. Other
  state choices remain available. Recompute the gate when question versions change.
- An open finding can coexist with Reviewed; it is not resolved by a state change.
  Needs attention is an explicit reviewer choice, not an inferred approval result.
- Questions, findings and guide issues attach to a step, target or supported
  selection. Selection feedback includes path, pinned revision, source range or
  diff side. PDFs/images always permit target-level feedback; more precise anchors
  require renderer support, not guessed coordinates.
- A review tray collects items across chapters. Selecting items does not send
  them. **Prepare batch** shows destination, exact selected IDs/versions, included
  text/evidence identities and “Investigate and propose — do not implement.”
  An explicit confirmation sends only that previewed request; busy/unavailable
  destinations retain the draft. Exact session transport is a later design task;
  no new session is launched by the notebook.
- Agent replies appear beside their original items, labeled as agent statements
  and bound to the investigated versions. The reviewer alone uses Resolve/Reopen.
  A reply may propose tests or changes but is not proof either was executed.

### Re-review and unavailable evidence

Show **Re-review needed: question or evidence changed** without deleting previous
answers. Preserve old item/reply anchors and make the previous version inspectable.
Flag only dependent steps; chapter reordering, branch advance over the same pinned
commit and ordinary sidecar updates are not material changes. Changed required
questions need a response to their current version before a new Reviewed mark.

Unavailable authorization/objects show **Evidence unavailable** with the authored
identity and Retry. Do not call that a new content version or show working files
instead. Non-code assets identify whether they are pinned/verified or mutable.
External references remain links and do not load automatically.

## Component reuse and architectural adaptation

The user approved this as a rough design after confirming that the evidence area
should reuse existing project components. The schematic boxes are not a proposal
for another rendering engine or another independent toolbar implementation.

- Reuse `CommittedPatchDiff` and its `GitDiffToolbar` for patches: existing
  Side by side / Unified / Raw patch, Wrap lines, Changes / Before / After,
  Show full file, change navigation, search, line jump and Wide view remain the
  behavior owners. The sketch's abbreviated Source / Diff row is not a replacement.
- Reuse `DiffReviewModel` for comparison-local reading/expansion/scroll/search
  state. Key retained instances by immutable comparison and target identity, not
  merely a path or mutable selected step.
- Reuse `ReviewNotebookSource` for unchanged/pinned excerpts; do not manufacture
  a patch just to reuse the diff component. It is presently a read-free excerpt
  presenter, not a full-file/context-navigation engine.
- Reuse `GitCommitViewer` / `GitPatchStack` when a target is a whole commit/file
  collection. Do not mount a nested file navigator for a single excerpt, or
  confuse its file previous/next with tour step previous/next.
- Add notebook-sized presentation options only where necessary: container sizing,
  toolbar density/disclosure and selection callbacks are candidates, not existing
  APIs. Prefer extracting cohesive shared production primitives to cloning JSX;
  preserve existing consumers' defaults and the reader's error/context behavior.
- A two-target comparison means two independent existing readers. It is not the
  diff renderer's internal Before/After split, and should not force two internally
  split diffs into unreadably narrow columns. Let container size influence a
  suitable presentation without silently rewriting saved preferences.
- Reuse safe file/Markdown/media presentation where compatible, keeping historical
  evidence loading separate from working-file navigation. Existing data-loading
  `FileViewer` is not automatically an immutable-view adapter.
- Reuse/extract question field presentation and safe validation concepts rather
  than mounting the live blocking `QuestionSetDialog`. Its request lifecycle and
  rule rejecting skipped required questions differ from notebook response semantics.

During implementation, refactoring means improving component/state ownership and
removing duplication across the project, not merely adding a notebook-specific
skin. Cover affected existing consumers with regressions. New feature-range reads,
notebook identity/progression and review persistence still need real new logic;
component reuse does not supply those contracts automatically.

## A concrete creation briefing

Use existing `ask_user` in the authoring session after inspecting the proposed
scope. Example contextual batch for this sample, not a new tool invocation:

| Question | Contextual choices |
| --- | --- |
| What are we reviewing? | Existing pinned-source behavior; a chosen base/candidate range; architecture at one revision |
| What needs the most scrutiny? | Content identity; response cancellation; authorization loss; evidence/test limits |
| What should the guide include? | Implementation, relevant test source, a small flow diagram; optional deeper context |
| What should I ask you to record? | A review judgment, an inspection checklist, an optional design preference |

The agent then writes the index/chapters/assets and verifies actual references.
This specimen deliberately does not settle future metadata or sidecar schemas.
The index's order table and IDs are explanatory text, not newly supported syntax.

## Design-review questions

The user approved the outline + explanation + evidence layout, stacked mobile
comparison, and recording/required-response/handoff semantics. The draft is a
flexible implementation direction, not a fixed visual contract. The questions
below document the review checkpoint; they are not live notebook forms.

1. Is the short question/explanation column sufficient, or should the explanation
   occupy more space before opening evidence?
2. Is primary + optional comparison evidence comfortable on desktop? On mobile,
   is stacked comparison acceptable, or would you mainly alternate A/B?
3. Are “Start guided reading”, “Enable review recording”, and “Send selected batch”
   clearly different commitments?
4. Does the unanswered-required-question example make it obvious that Next is free
   but Reviewed requires a recorded outcome?

## Scope and evidence limits

This sample uses one actual repository/revision to make the interactions readable;
it does **not** validate feature-range comparison, multiple-repository authority,
PDF/table rendering, historical Markdown rendering or final persistence schemas.
Those agreed requirements remain in the active plan. The flow diagram is a local,
mutable design asset, not a historical execution trace. Mock replies are not live
agent messages or authenticated reviewer history.

Source cards were checked against commit
`76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92` and reachable local `main`. Tests are
referenced as source only; none were run for this documentation/design task.
Static SVG/document checks are not browser acceptance or proof that filesystem
links open in Pi Web. No production service is contacted or changed.
