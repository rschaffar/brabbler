# Guided review notebooks

## Goal

Extend review notebooks into agent-authored, chapter-based guided reviews: short
question-sized steps explain what to inspect beside synchronized evidence, while
reviewers navigate freely, record judgments and feed selected concerns back to an
agent. Deliver two usable increments: the guided reader, then the interactive
review loop.

**Authority:** This session authorizes planning and this document only. No feature
implementation, migration of another repository's review material, agent launch,
remote publication or installed-service change is authorized. Implementation tasks
below remain pending a separate request.

## Context

Product decisions were gathered through six batched question sets in this session.
The primary outcome is thorough code review, not a slide presentation or an
approval workflow.

Current evidence at local main `c8557e5afec41739801a756a1d8e0b496f0b316c`:

- `docs/review-notebooks.md`, ADR 0029 and `lib/review-notebook.ts` define strict,
  opt-in version-1 `pi-review` source/commit fences. Source is pinned to a full
  commit ID; a currently authorized local branch supplies reachability authority.
- `components/ReviewNotebookBlock.tsx` lazily expands immutable source and commit
  readers. Its file diff compares that commit to its first parent, **not** an
  entire multi-commit feature. Parsing, mounting and scrolling do no Git reads.
- `components/FileWorkspace.tsx` supplies split panes and return-to-guide behavior.
  Prose file links read saved working content; they are not historical permalinks
  and do not synchronize historical `pi-review` readers.
- There is no notebook-level chapter model, persistent review state or answers.
  `lib/question-set.ts` already models text/single/multiple-choice questions, but
  its complete-set submission and live interaction lifecycle must not be silently
  inherited by asynchronous notebook forms.

### Product decisions

| Area | Agreed direction |
| --- | --- |
| Creation | The coding agent inspects context, asks a short contextual briefing through existing `ask_user`, then authors a notebook folder. No new creation-form UI is needed. |
| Package | An index, Markdown chapter files, assets, and separate review-data sidecars beside the notebook. Several steps per chapter; not one file per tiny step. |
| Step | One review question, potentially supported by multiple evidence targets. |
| Layout | Explanation beside synchronized evidence; optional second evidence pane for comparisons. |
| Navigation | Back/Next, chapter navigation and freely selectable steps. No enforced reading sequence. |
| Scope | Whole feature ranges across commits, pinned subsystem/architecture reviews, and changes spanning multiple repositories. Individual-commit evidence remains useful. |
| Evidence | Highlighted source ranges; diffs with Before/After and context; multiple targets and two visible together; rendered Markdown, diagrams/images, tables/structured data, PDFs, and external web references. |
| Reader record | Resume position and explicit Not reviewed / In progress / Needs attention / Reviewed states. |
| Reader feedback | Questions, findings and guide issues, attached to a step, evidence target or selected lines/text. Private scratch notes and a separate editable overall conclusion are not initial requirements. |
| Authored questions | Capture judgments, guide inspection, collect design preferences/decisions, and check understanding. Text, single/multiple choice, explanations, and distinct unsure/not-applicable/skip responses. Evidence attachments to answers are not an initial requirement. |
| Completion | Unanswered questions never block navigation. Designated required questions need a recorded response before a step can be marked Reviewed; this is not a correctness test. |
| Handoff | Select a batch of feedback; ask an agent to investigate and respond item by item with proposed changes. This does not authorize implementing fixes. |
| Replies | Agent responses appear beside the original feedback in the notebook. Reviewer resolution remains explicit. |
| Revision | Preserve history and flag affected state for re-review when guidance/evidence changes. Branch advancement alone does not invalidate unchanged pinned evidence. |
| Delivery | Increment 1: reader. Increment 2: interactive review loop. |

### Inspiration, not imported behavior

- [Microsoft CodeTour](https://github.com/microsoft/codetour): ordered explanations
  tied to file/line selections, previous/next and linked tours. Do not import its
  executable command links, code insertion or mutable-reference semantics.
- [Quarto code annotations](https://quarto.org/docs/authoring/code-annotation.html):
  explanations linked to highlighted lines. Borrow the connection, not its
  annotation syntax or execution engine.
- Independent creative review proposed inspection recipes (Look at / Check for /
  Why it matters), focused context expansion and return-to-step navigation.
  Optional branching detours and elaborate recaps remain future ideas, not
  mandatory initial scope.

## Plan Relationship

- The archived `2026-10-21_review-notebooks-plan.md`, ADR 0029 and the maintained
  notebook guide own the existing read-only schema and authority boundaries.
  This plan owns guided structure and reviewer interaction, previously deferred.
- The separate, unfinished `2026-10-21_review-notebook-guidance-plan.md` in worktree
  `review-notebook-guidance` owns packaged authoring-reference discovery and exact
  prompt boundaries. Do not absorb or edit its dirty worktree. Coordinate future
  guidance changes with that owner rather than implementing competing hints.
- Git Explorer and file workspace own their readers/layout primitives. Git
  operation approvals, exact-operation reviews and receipts remain separate.
- `docs/questions.md` owns live browser `ask_user`. Notebook forms are persistent
  document interactions, not pending session questions or approval receipts.

## Architecture

The following boundaries are proposals to validate before implementation, not a
final file format or API design.

### Package, identity and authoring

A conceptual package, with exact sidecar names/schema still to be designed:

```text
review/
  index.md
  01-request-flow.md
  02-failure-handling.md
  03-tests-and-gaps.md
  assets/
  review-data/
```

Keep prose in Markdown. Define explicit, versioned declarative metadata for
notebook identity, chapter order, stable step/target/question IDs and references.
Decide whether the index carries this metadata or a small companion manifest is
needed. The folder presentation is agreed; serialization is not. Unknown versions
or malformed metadata remain inert diagnostics with ordinary documents readable.
Preserve existing v1 fences rather than adding unrecognized fields to them.

A repository mapping may resolve logical IDs to physical checkouts for portability,
but it grants neither file access nor Git authority. References retain full
revision identities. Reordering a chapter must not change step identity or lose
feedback. Duplicate IDs, cycles, missing chapters and escaped paths must diagnose
visibly; discovery must be bounded, not a recursive filesystem crawl.

The creation briefing asks about review scope/base/candidate and repositories,
risk/emphasis, familiarity/depth, and which material/questions to include. Derive
choices from inspected context rather than repeating a generic long questionnaire.
The agent authors a narrative, verifies historical coordinates and assets, then
validates every declared reference. Missing evidence is explicit, never invented.

### Reader and navigation

Start in an ordinary document preview with an explicit Guided entry. Starting the
guide or choosing a step/target is the user's read activation; only then may the
reader load that step's evidence without another expansion click. Merely mounting
or scrolling ordinary Markdown must retain current no-read semantics. Do not
prefetch unrelated chapters' evidence without an explicit bounded design.

A notebook-scoped navigation model owns chapter/step selection, primary/secondary
targets and Return to current step. It does not change session cwd, sidebar checkout
or terminal identity. Back/Next crosses chapter-file boundaries in authored order;
chapter jumps and exploration remain available. Reuse immutable readers without
routing pinned targets through mutable working-file links.

Allocate navigation generations before reads, cancel obsolete work, and reject
late responses after a newer step, close or originating-context change. Preserve
appropriate reader context and keyboard focus on Back/Return. Distinguish tour
navigation from file-history navigation. On narrow screens, make the same evidence
and comparisons accessible without requiring three simultaneously visible panes.

### Evidence identity

- Historical code uses full commit IDs, physical-root authorization and bounded
  immutable reads; never substitute current working files or fetch missing objects.
- Feature comparisons need an explicit full base/candidate pair and well-defined
  diff/context semantics. Preserve current first-parent commit views separately.
  Authorize and revalidate both endpoints, including repository identity; no
  arbitrary revision expressions or branch-tip content substitution.
- Each repository is independently authorized. One successful target must not
  authorize another checkout; moving the notebook must not silently rebind it.
- Local non-code targets need provenance: prefer versioned content or verified
  recorded bytes/hashes, otherwise label them mutable. A hash identifies content,
  not permission to read it. A changed asset must never display under an old
  verified identity. External web references start as links, not embedded pages or
  automatic network retrieval.
- Establish finite size/type limits and safe renderer fallbacks for Markdown,
  Mermaid/images, CSV/JSON or other declared table/data formats, and PDF. Reuse
  safe existing viewers where compatible; never add executable HTML/MDX/cells.
  Define anchoring capability per renderer. Native PDF text selection or detailed
  image-region anchoring must not be promised without a proven supported path;
  target-level feedback must remain available with an honest limitation.

### Review data and writes

Separate authored guide definitions, reviewer-owned state/answers/resolutions,
and agent-authored replies. Review-data sidecars are an explicit working-tree
write surface, not immutable evidence and not automatically staged or committed.
Opening a notebook does not grant write permission. Design explicit write
activation through the established file/security boundary; reference-only access
must stay read-only. Do not create a new broad allowed root from notebook metadata.

Propose a single-reviewer initial UX with conflict detection for concurrent tabs
and external/agent edits, not live collaboration. Validate versioned schemas,
bounded payloads, literal destinations and physical containment; reject symlink
escapes and unexpected files. Use atomic durable writes and expected-revision
checks. Show saved/unsaved/conflict/error states, preserve recoverable drafts, and
never last-write-wins over another writer. Resume persistence must not write to
sidecars merely because an unactivated document rendered.

Reviewer record and reply files preserve identity, revisions and provenance.
These are not cryptographic attestations: an agent with ordinary filesystem write
authority can edit files. The UI must distinguish human decisions from imported
agent claims and must never treat a reply's serialized status as reviewer consent.

### Forms, state and feedback loop

Store resume position separately from review state. Record state transitions and
explicit reviewer choices; displaying evidence or submitting a form does not mark
Reviewed. Required questions gate only the Reviewed action. Explicit unsure,
not-applicable or skip counts as a recorded response, visibly distinct from an
answer endorsing the implementation. An unanswered required question does not.
Open findings and review progress remain separate; define transitions without
silently resolving feedback when changing step state.

Authored questions are asynchronous, editable/versioned forms. Reuse safe question
shapes/UI conventions where appropriate, not the live `ask_user` request/receipt
lifecycle or its all-questions-at-once submission constraint. An optional revealed
explanation is authored guidance, not an automatically verified correct answer.

Feedback has stable IDs, kind, content, status and a revision-bound anchor:
step, target, or selected lines/text plus sufficient context to diagnose an orphan.
Selections must retain source identity, line side for diffs and actual rendered
coordinates; never guess an anchor against newer material.

A selected feedback batch freezes item IDs/versions and relevant guide/evidence
identities. Preview its destination, request and included content before explicit
handoff. Decide whether the transport drafts into an existing session or performs
an explicitly confirmed send; do not launch sessions or agents automatically.
Submitted review prose is untrusted task material, not system instructions.

Replies reference the exact batch/item versions and investigated material, with
conclusions, evidence and proposed changes. Validate and display them beside the
original item; partial, duplicate, stale or unavailable replies are explicit.
Only the reviewer resolves/reopens an item in the UI. Sending a batch does not
approve fixes, rewrite the guide, run tests, or authorize Git operations.

### Change accounting

Define dependency fingerprints for step guidance, target identities/content,
question definitions and relevant assets. Preserve previous answers and marks;
flag affected items with an understandable reason when these dependencies change.
Keep deleted items as recoverable historical/orphaned records. Do not auto-rebase
line selections or attach old answers to materially different questions.

Exclude changing branch tips, mere chapter reordering and reviewer-sidecar writes
from material-change invalidation. Establish explicit policy for cosmetic prose
changes and relocation rather than making every edit reset the whole notebook.
If authorization is lost but material identity is unchanged, show Unavailable,
not a fabricated content change. Stale responses remain historical responses, not
answers to a new question version.

## Non-Goals

- Executable notebook cells, command links, automatic test execution or fixes.
- Git approvals, permission changes, review receipts as execution authority, or
  claims that Reviewed means approved/tested/correct.
- A new creation wizard, full visual authoring editor, chat-embedded guided mode,
  live multi-reviewer collaboration or public sharing service.
- Arbitrary embedded web pages, network fetching/export publishing, automatic
  missing-object fetches or mutating other repositories' existing documents.
- Automatic grading, AI-driven resolution, automatic branch tracking or silent
  line rebasing. Optional branching routes are not required initially.

## Plan

### 0. Close design boundaries before feature code

- [ ] Inspect the then-current notebook, file/security/write, question, session and
  diff contracts, coordinating the separate authoring-guidance work; record exact
  reused owners and bounded extension points in this plan.
- [ ] Specify package metadata, IDs, repository mapping, base/candidate comparison,
  non-code provenance/renderer limits and navigation state; validate with one
  example folder covering a feature range and a second repository.
- [ ] Specify sidecar write authorization, schemas, conflict/recovery behavior,
  reviewer/agent ownership, invalidation rules and handoff transport; review these
  boundaries before implementing persistence or session integration.
- [ ] Produce a desktop/narrow-screen interaction sketch and a realistic sample
  chapter containing explanation, two evidence targets, a required question and a
  finding/reply example; obtain user acceptance of the interaction, not authority
  to execute fixes.

### 1. Usable guided reader

- [ ] Add strict versioned package/step parsing with readable inert fallback and
  validation of chapter order, duplicate/missing IDs and bounded references;
  verify parser tests against valid and adversarial fixtures and unchanged v1.
- [ ] Add explicit Guided entry, chapter/step outline, Back/Next across files,
  synchronized primary evidence, optional comparison evidence and Return to step;
  verify keyboard/touch/narrow layouts, focus and rapid/reordered navigation.
- [ ] Add authorized immutable feature-range evidence and pinned multi-repository
  targets, retaining per-commit first-parent behavior; verify endpoint/context
  identity, unchanged-source context, authorization loss and no working fallback.
- [ ] Integrate the selected Markdown, diagrams/images, table/data and PDF evidence
  types under declared limits/provenance, with external references as links;
  verify safe fallbacks, changed/missing assets and absence of automatic networking.
- [ ] Extend the coordinated agent authoring guidance with contextual `ask_user`
  briefing and a complete folder example; verify agents can validate generated
  references without source reverse engineering or expanding exact prompt modes.
- [ ] Run focused reader/parser/security checks, independent boundary review and
  complete Nix acceptance; record candidate, commands, results, timings and
  artifacts, then obtain user acceptance of this usable reader increment.

### 2. Usable interactive review loop

- [ ] Add explicitly activated, authorized sidecar persistence for resume/review
  states with atomic writes, expected revisions and recovery; verify read-only
  access, reload/restart, path escapes, interrupted writes and conflicting tabs.
- [ ] Add asynchronous authored forms and versioned answers, including required
  response gating only for Reviewed; verify text/choice/explanations, distinct
  unsure/NA/skip, answer editing, free navigation and no live agent blocking.
- [ ] Add anchored questions/findings/guide issues and a selectable review tray;
  verify exact source/diff/text identity, supported renderer selections, target
  fallback and preservation of orphaned/deleted anchors.
- [ ] Add previewed explicit feedback-batch handoff and validated per-item agent
  replies beside originals; verify frozen batch identities, partial/duplicate/stale
  responses, no implicit implementation authorization and reviewer-only resolution.
- [ ] Add dependency-based stale/re-review accounting with preserved history;
  verify changed evidence/questions/assets affect only dependent items and that
  branch advance, reorder and sidecar updates do not invalidate pinned reviews.
- [ ] Update the maintained notebook/feature/architecture/question guides and ADR
  boundaries as appropriate; run focused contracts and independent safety review,
  then complete acceptance and user validation of the full feedback loop.

## Verification

For this planning-only document, review the decision record against session
answers, check local links and Markdown structure, and run `git diff --check`.
No application acceptance is claimed by a plan or a documentation-only check.

Implementation follows `docs/testing.md` and `e2e/README.md`: focused core files
and Markdown/file-workspace browser scenarios during editing, then complete core,
full browser/terminal inventory and genuine Home Manager deployment acceptance for
each settled runtime increment. Normal fresh command, when resource-admitted:

```sh
nix run .#test -- all --workers 4 --jobs 4
```

Coordinate resource admission and immutable source export; use only isolated Nix
builders, no host service or checkout production build. Record exact candidate and
input identity, selection, result/artifact path, end-to-end command runtime and
separate preparation/execution intervals where available. Preserve failures before
a justified retry. Do not label focused or older runs as complete new-tip evidence.

## Risks and Recovery

- Multi-format/cross-repository evidence and sidecar writes are substantial scope;
  close unsupported renderer and authorization cases in discovery, not by silent
  fallback. The two agreed increments remain independently usable.
- Sidecars can contain sensitive reviewer text and dirty the notebook repository.
  No auto-stage/commit/publish. Before write activation, show the destination and
  explain portability; a read-only location must remain usable as a reader.
- Version all persistent records. Unknown or malformed data is preserved and
  diagnosed. Migration requires an explicit reviewed design, original-data backup
  and tested recovery before any destructive replacement; do not migrate on open.
- Removing Guided mode must leave Markdown readable and sidecars intact. Retain
  old versions/anchors, allow exporting recoverable feedback, and never delete
  history just because a step or repository disappears.

## Completion Checklist

These boxes describe feature completion, not completion of this planning session.

- [ ] User-accepted sample folder and desktop/narrow interaction define the agreed
  reader and feedback workflow; remaining schema/transport decisions are resolved.
- [ ] Reader increment handles feature ranges, architecture and multiple repos,
  all selected evidence formats, comparisons and free chapter/step navigation.
- [ ] Interactive increment preserves answers, explicit progress, anchored
  feedback, selected batch context, item replies and reviewer-owned resolution.
- [ ] Re-review accounting distinguishes content changes, lost authorization and
  unchanged pinned material, retaining inspectable historical records.
- [ ] Read/write/network/session boundaries have adversarial and race coverage;
  opened, reviewed, approved and tested remain visibly distinct.
- [ ] Each runtime increment has independent review, complete acceptance evidence
  and user validation; maintained guides/ADRs own delivered behavior.
- [ ] Local Git handoff follows repository policy. Remote publication, deployment
  and feature cleanup are separately authorized; no other project's review files
  are changed without that project's applicable authorization.
