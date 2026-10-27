# Guided review notebooks

## Goal

Extend review notebooks into agent-authored, chapter-based guided reviews: short
question-sized steps explain what to inspect beside synchronized evidence, while
reviewers navigate freely, record judgments and feed selected concerns back to an
agent. Deliver two usable increments: the guided reader, then the interactive
review loop.

**Authority:** The initial session authorized planning; the next request authorized
the sample chapter and static desktop/narrow-screen sketches. After reviewing
them, the user approved the rough interaction direction and authorized implementation,
including architectural refactoring and adaptation of existing components where
needed. The drawings are not a pixel-perfect contract. The later request explicitly
said to implement until done with the **full plan**; the old intermediate reader-only
user-validation stop is removed. This records authority, not invented live runtime
validation. Migration of another
repository's review material, external authoring-session launch, remote publication
and installed-service changes remain unauthorized.

## Context

Product decisions were gathered through six batched question sets in this session.
The primary outcome is thorough code review, not a slide presentation or an
approval workflow.

Historical pre-implementation evidence at local main `c8557e5afec41739801a756a1d8e0b496f0b316c`:

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

### Interaction draft

The [design specimen](assets/guided-review-notebooks/design.md) contains a real
commit-bound sample notebook, static desktop reader/interactive-review sketches
and a mobile Guide/Evidence/Compare storyboard. The sample's source references
use `76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92`; fictional feedback/replies and future
forms are labeled, with no live state files or new authoring syntax. The reader
and interactive increments are depicted separately. The user accepted the
three-region desktop layout, stacked mobile comparison and interaction boundaries,
then approved the specimen as a flexible design baseline after clarifying component
reuse. See the specimen's reuse/adaptation section. This is design acceptance,
not completed implementation or verification.

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

Reader contracts are merged. The receiving workflow candidate implements the
review-data/forms/handoff contracts, documented in `docs/review-notebooks.md` and
ADR 0036. These sections describe the agreed architecture, not another reader-only
milestone. Candidate verification and parent-owned final gates are tracked below.

### Package, identity and authoring

The implemented package uses strict index/chapters and the fixed numbered reviewer,
raw-reply and immutable-import sidecars described in the maintained guide:

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

Use the implemented single-reviewer initial UX with conflict detection for concurrent tabs
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
handoff. Draft through FileWorkspace/FileViewer into the existing selected chat, validating
the latest session ID in AppShell. Normal chat Send is a second explicit action;
do not launch sessions or agents automatically.
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

## Current receiving candidate

Writer checkout: `guided-review-workflow`, branch `feat/guided-review-workflow`, based
on main `74c4fdaf659df2509a8ee3a452a82edaf3d5ff51`. Sole source writer; parent owns Git
lifecycle, final independent review, installed bridge and complete acceptance. No
service access, dev server, checkout production build, staging/commit or remote
operation occurred; other repositories/worktrees were not mutated.

**Interactive implementation:** strict reviewer schema/reducer, fsync/exclusive-link
numbered snapshot store/API, explicit recording vs reading, reload resume/four
states, shared text/single/multiple fields, editable versioned outcomes, attributed
explanations, actual step/target/text/range anchors, cross-chapter editable tray,
versioned historical/orphaned records, frozen selected batches, exact current-chat
composer draft, immutable raw-file/pasted-JSON reply imports and reviewer-only
resolution. Per-live-view/workspace browser recovery validates nested shapes,
preserves rejected bytes/newer edits and keeps batch-bound pasted drafts/previews.

Dependency identities exclude branch advancement/chapter reorder/sidecars and bind
actual displayed mutable bytes. Unavailable evidence still permits guidance-only
non-affirmative progress/step concerns and explicit unsure/NA/skip; these never
silently satisfy recovered material or allow Reviewed. Current-step local-asset
reads are bounded by the remaining aggregate budget before body consumption.

Independent reviews of `/tmp/pi-web-test-source-mZbSDp/source` found three storage/
ID issues and eight UI/lifecycle issues. Their corrections include pre-effect import
CAS/capacity, exact-byte retry reconciliation, existing leading `_`/`-` question IDs,
displayed-snapshot binding, full recovery validation, stale selection failure fences,
restricted observed contexts, independent pane radios/recovery, per-batch JSON,
exact submitted-field revisions and explicit plain-step anchors. Parent additionally
identified aggregate read accounting and unavailable-evidence challenge gaps; actual
native/mounted regressions now cover corrections. These owners changed from that
snapshot: parent final delta review is required, not unchanged-source clearance.

**Latest delta from reviewed thNSFa:** enforce guidance-only/non-finding identity
for every feedback version and stored replay; invalidate a mutable snapshot's old
text selection on displayed body/generation changes; persist current fields before
explicitly discarding malformed recovery. Native/mounted regressions cover rejected
conversion without tip/byte effects, deleted-anchor text edits, both A/B selection
orders and immediate recovery reload. The UI mirrors the all-version Save gate;
incomplete local classification drafts remain recoverable without becoming reviewer
operations. Removing each correction meaningfully fails
its named runtime assertions; faults are restored.

Parent's installed Markdown attempt failed the new blanket agent-POST count on an
exact existing-session `get_tools` catalogue read, not an auto-prompt. The bridge now
retains method/path/body records for every observed agent request and allows only
that exact known read-only non-GET tuple for the fixture session. Prompt/execution,
other-session, extra-key, malformed and new-session commands fail in actual helper
regressions. No old native/read-only assertion or console/HTTP failure is filtered.
Parent browser failure and the required rerun are retained in the evidence ledger.

**Final focused evidence:** the post-review candidate passed **16 files / 82 tests**
and static checks in **70s**; exact selection/snapshot/artifacts are below. Earlier
thNSFa (15/79), correction regressions (6/39) and all first failures remain historical
input-bound evidence. Five earlier plus three latest actual production faults failed
named runtime assertions and were restored. Raw commands/reports/chronology:
[workflow evidence](assets/guided-review-notebooks/workflow-evidence.md). Final
composed focused evidence is recorded below. New test files retain explicit E
holds; no browser assertions/input chains were retired.

**Remaining gates are verification, not deferred feature scope:** parent independent
delta review, installed Markdown desktop/touch workflow and complete
core/browser/service acceptance. Application/test/bridge source writing is stopped;
only this final evidence/status text follows the pass. No browser/full-all execution
is performed by this writer.
The full plan stays active until these pass. No intermediate reader-only runtime
user-validation pause remains; rough interaction direction is already approved.
Parked authoring packaging/prompt work remains with its existing owner.

### Historical merged-reader implementation

The following describes the earlier reader candidate and its input-bound evidence,
not current workflow execution. Its parent used CodeGraph and targeted ordinary
reads. Complete reader acceptance remains historical evidence, not this candidate's.

**Implemented:** strict AST `pi-notebook` v1 manifest / top-level `pi-step` v1
boundaries; unchanged strict `pi-review` v1; distinct `pi-evidence` v1 compare,
mutable text-file and web-link targets. Package-global stable step/target IDs,
unique chapter IDs/paths, flat declared chapters and finite limits reject unsafe
or malformed packages. Physical cwd/branch/full OIDs support independent repos;
no alias mapping or authority transfer. Maintained guide contains an illustrative
folder and contextual `ask_user` briefing; parked packaging/prompt work untouched.

`GuidedReviewEntry` integrates Files Preview with explicit entry/Return, outline,
free cross-file Back/Next, primary/optional second target and local exploration /
Return preserving selected step/targets. `FileMarkdownBody` extracts existing file
Markdown owners without changing ordinary defaults. `ActiveReviewBlock` shares
source/commit readers, including `ReviewNotebookSource`; feature ranges reuse
`CommittedPatchDiff`, its `GitDiffToolbar` and `DiffReviewModel`, not a second engine.
No persistence, forms, human review state or session handoff was added.

Selected raster/PDF files now use the same independently authorized bounded
regular-file reader: 8 MiB raster / 16 MiB PDF, fixed MIME plus signatures, no
SVG/HTML/MDX/remote media. `NotebookBinaryEvidence` checks the response, creates only
owned typed blob URLs, and revokes them on exit. Images reuse `ImagePreview`; PDF
reuses the extracted `NativeDocumentPreview` from Files. No watch/edit/probe surface.
Admission is not full format, malware or decoded-pixel validation; native browser
viewer/decoder behavior remains a verification boundary.

`GuidedReaderState` retains step target selections, source/diff mode and the last
32 exact immutable file `DiffReviewModel`s (LRU) across target switches/exploration
and Back/Next. Re-entry still captures fresh authorization and reloads patches;
matching target/path/patch/incarnation can then reuse reading/search/full/gap context.
Closing, folder Retry or cwd/index changes discard the activation; mutable assets
always reload. The optional model factory is forwarded through source/commit/stack
readers, preserving inline/default consumer behavior. This is deliberately bounded
retention, not a promise to retain all 512 targets' complete context simultaneously.

Independent prior-snapshot findings are addressed: duplicate JSON properties,
escaped-equivalent keys and depth/byte ambiguity now refuse across ALL guided
metadata (including v1 targets; standalone v1 unchanged). Guided prose/assets opt
out of live review cards, including nested examples. Source/commit/diff/stack/source-
grammar and Reveal terminal work forward the optional observer. Mounted tests distinguish
exact expected context rejection objects/operations from unexpected failures and
change ACTIVE originating contexts while folder/evidence bodies remain pending.
The superseded slice description is retained in the earlier immutable source
export `/tmp/pi-web-test-source-NWqJFh/source`; it is not completion evidence.

The final independent review of `/tmp/pi-web-test-source-XepXDA/source` found one
remaining presenter-work ownership gap: prose/asset `CodeBlock` grammar imports
and Mermaid import/parse/render could outlive the fixture realm. The optional
observer now flows through `FileMarkdownBody`'s stable presenter context, direct
file evidence, review-card fallbacks, and nested Mermaid source. `CodeBlock` passes
it to the existing `usePrismLanguages` third argument (same root/admission/retry
policy); `MermaidBlock` publishes the original render promise including its catch
and state publication. Callback replacement does not restart/replay work, and absent
observers retain default behavior. The new E-held presenter owner reuses the actual
gated Prism loader and real Mermaid parser/renderer, holds native render through
unmount, and joins full originals plus independently captured native capabilities
before realm restoration. Unsupported SVG measurements are not browser layout proof.

GET-only folder reads independently authorize every contained regular UTF8 file;
no discovery/new roots/transitive index authority. Only explicit activation reads
chapters and selected evidence. Compare/compare-patch/compare-context separately
bind both endpoints, ancestor-only ranges, changed-file admission and physical
repository incarnation; first-parent operations are unchanged. No mutable fallback,
revision expressions, remotes, textconv or external diff. Ignored-abort body and
publication guards prevent obsolete reads/results from taking over the reader.

**Verified so far (focused Nix only):** actual parser policy, native folder/API
security, native endpoint-tree comparison (earlier+later commits, both endpoint
reachability, unchanged/escaped paths, divergence and replaced Git-directory
identity), mounted entry/step/target/focus/exploration/late success/error and active
context changes, selected blob URL ownership/MIME refusal and native binary API
admission, plus existing FileViewer behavior. Actual GuidedReviewReader →
CommittedPatchDiff → Pierre successfully loads patch/full context/Before/After,
reauthorizes on return, retains search/full/version state across target switching
and cross-file Back/Next, and fences obsolete context success/error. Capability
fixtures are not native browser geometry/decoding or Git authority. Source/commit
model-factory forwarding is implemented; the new complete mounted range-retention
witness covers comparison targets, not every multi-file commit-stack permutation.

Meaningful production controls: making Next a no-op fails the cross-file heading /
focus assertion; discarding the retained model fails the real mounted `Before file`
assertion after reauthorization. Both restored. A type-failing first retention fault
is preserved separately and is NOT the meaningful runtime red. The mounted
guided/presenter owner files retain explicit unresolved E holds, not unreviewed promotions. No browser
work/assertions retired. Static checks have 0 errors / 7 existing unchanged-owner
warnings after removing this slice's temporary unnecessary-dependency warning.

Final independent delta review reports no material findings: presenter terminal
work now reaches the fixture owner without changing default admission/retry.
The explicit E holds remain conservative scheduling classifications, not a claim
of universal import/descendant closure. The parent also corrected ordinary large
Markdown being misdiagnosed as an oversized notebook: negative marker admission
avoids a redundant parse; possible markers still use the strict AST validator.
Its actual regression fails without the guard and passes with it restored.

**Verified reader candidate:** `532a17656be3f38c06dc19c774a206b6d4eadac8`,
rebased onto local main `4422eedcdcd407f536c629a4c7eaf5fbc84a0d29`, passes complete
core/browser/terminal/service acceptance. Evidence below binds that exact candidate;
subsequent plan-only status text does not constitute a new runtime execution.

The old **intermediate user-validation stop** is superseded by the explicit request
to complete the full plan after rough interaction approval. No runtime validation
is invented. PDF region/text anchoring and cross-browser native-plugin guarantees
are not promised; the 32-model bound remains explicit. Interactive implementation
is now in the receiving candidate above.

## Plan

### 0. Close design boundaries before feature code

- [x] Inspect the then-current notebook, file/security/write, question, session and
  diff contracts, coordinating the separate authoring-guidance work; record exact
  reused owners and bounded extension points in this plan.
- [x] Specify package metadata, IDs, repository mapping, base/candidate comparison,
  non-code provenance/renderer limits and navigation state; validate with one
  example folder covering a feature range and a second repository.
- [x] Specify sidecar write authorization, schemas, conflict/recovery behavior,
  reviewer/agent ownership, invalidation rules and handoff transport; review these
  boundaries before implementing persistence or session integration.
- [x] Produce a desktop/narrow-screen interaction sketch and a realistic sample
  chapter containing explanation, two evidence targets, a required question and a
  finding/reply example; see the linked design specimen and rendered previews.
- [x] Obtain user acceptance of the interaction specimen; the user approved the
  rough design after clarifying existing-component reuse and separately authorized
  implementation and architectural refactoring. No remote/service authority given.
- [x] Map shared reader/form primitives and refactor cohesive production owners as
  needed, preserving existing defaults and regression coverage; avoid duplicating
  diff controls, reading state, immutable loaders or blocking-question lifecycles.

### 1. Usable guided reader

- [x] Add strict versioned package/step parsing with readable inert fallback and
  validation of chapter order, duplicate/missing IDs and bounded references;
  focused actual-parser, native missing-chapter and unchanged v1 tests pass.
  Full acceptance remains separate.
- [x] Add explicit Guided entry, chapter/step outline, cross-file Back/Next,
  synchronized primary/second evidence and Return; actual mounted currentness/focus
  tests and installed 1280/390 keyboard/touch geometry bridges pass in full acceptance.
- [x] Add independently authorized immutable feature-range and per-repository
  targets without changing first-parent operations; actual native endpoint,
  reachability/incarnation/path tests and mounted/shared-reader context tests pass.
- [x] Integrate Markdown, Mermaid/raster images, table/data and native PDF evidence
  with explicit mutable-asset limits and web links only; native admission, owned
  snapshot lifecycle and installed comparison/image/PDF transport bridges pass.
- [x] Document contextual `ask_user` author briefing and a complete folder format
  in the maintained guide; production parser/native reference validators cover its
  contracts. No parked prompt/packaging work or exact-mode behavior was changed.
- [x] Run focused checks, meaningful defect controls, independent boundary review
  and full Nix acceptance; exact candidate, command, results and artifacts below.
- [x] Remove the superseded reader-only validation stop: rough direction is approved
  and the user requested full implementation. No runtime user validation is invented.

### 2. Usable interactive review loop

- [x] Implement explicit authorized recording, numbered durable append/CAS,
  recovery, resume and four states. Actual native/model owners cover inert GET,
  independent roots/symlinks, async-body swaps, short writes/fsync ambiguity,
  tamper/holes, bounded inventory and gated two-process same-slot conflict.
- [x] Implement shared asynchronous text/single/multiple forms, editable versioned
  outcomes, attributed explanations and required-presence gating only for Reviewed.
  Actual model/mounted owners cover explicit outcomes, inherited/leading `_`/`-`
  IDs, retained drafts, unavailable contexts and unchanged live required-skip policy.
- [x] Implement step/target/source/Pierre range/text anchors and cross-chapter
  editable/resolved/reopened tray, retaining historical/deleted anchors. Mounted
  public-renderer callbacks cover held success/rejection/abort across new selections;
  native browser Selection/geometry bridge is separately parent-owned.
- [x] Implement frozen item/material batches, exact preview/current-session draft,
  validated raw/pasted replies/private immutable copies and reviewer-only resolution.
  Actual composer retains text/attachments; native import owners cover partial,
  stale/forged/duplicate identities, byte survival, pre-effect CAS, capacity and
  exact-submission retry reconciliation. No sent/executed/implementation authority.
- [x] Implement material/guidance/question identities, preserved history and
  displayed-snapshot binding. Native/mounted owners cover changed assets/questions,
  unavailable contexts and stale responses. Final composed focused selection also
  covers branch advancement/chapter reorder/sidecar/key-order exclusions.
- [x] Update maintained notebook/feature/architecture/question/session/test guides
  and ADR 0036. Add the full workflow tail to the original Markdown desktop/touch
  chains, keeping original assertions before writes and exact-batch shared-history
  reply assertions. This is browser source, not fabricated runtime execution.
- [ ] Parent verifies final focused candidate evidence and independent delta review,
  runs installed Markdown workflow then complete core/browser/service acceptance,
  and follows Git lifecycle. Archive only after real completion. No intermediate
  runtime-user-validation stop or partial-scope handback is authorized.

## Verification

This is an active implementation plan, not a planning-only handoff. Keep the
current slice and finite blockers above truthful. Documentation/link review and
`git diff --check` never establish application acceptance.

### Interactive focused verification

**Latest post-review candidate:**

- `nix run .#test -- core --jobs 4` with the exact 16 `--file` selections in
  `/tmp/guided-workflow-post-review-final-focused.log`: **passed, 16 files / 82
  tests**, no skips/cancellations, static 0 errors / 7 pre-existing warnings;
  requested/effective workers **4/4**. Includes all workflow owners, the new exact
  browser command-observation helper, and unchanged shared question/reader/Pierre/
  workspace/presenter/bounded-body owners. This is not full acceptance.
- Export `/tmp/pi-web-test-source-sgeNHO/source`, outer content/mode SHA-256
  `1b19c92c9ff46a91f6f3595bd0e123aed3443d84b04967f81c8d5301a44d5ca8`;
  `/tmp/pi-web-test-core.kIoCxM/run.json`; immutable diagnostics
  `/nix/store/v7qma0dd8p4q8zyrz8y5zby9h0gjd8vs-pi-web-core-checks`.
- **70s whole command** (whole-second wall clock), including in-run realization;
  core-driver envelope **65.131s**, before-first-file realization/static/setup
  envelope **41.724s**, file execution window **23.242s**. No separate prewarming,
  cold-cache/benchmark or universal closure claim; model/review time excluded.
- The latest native guidance-edit and mounted snapshot-selection/recovery
  regressions pass; their deliberate missing-invariant/stale-selection/remove-only
  faults fail named runtime assertions and are restored. The prior parent browser
  failure is retained in the evidence ledger. Installed bridge rerun and full
  core/browser/service acceptance remain parent-owned; no browser pass is claimed.
- Application/test/bridge writing is stopped. Subsequent edits record evidence and
  status only in docs. New helper test keeps an explicit E hold. Parent final review
  and full acceptance must bind the resulting candidate.

**Earlier thNSFa pass**, retained without relabelling it as later corrections or a
browser pass:

- `nix run .#test -- core --jobs 4` with the exact 15 `--file` selections in
  `/tmp/guided-workflow-final-focused-v2.log`: **passed, 15 files / 79 tests**, no
  skips/cancellations, static 0 errors / 7 pre-existing warnings; requested/effective
  workers **4/4**. This is focused execution, not complete acceptance.
- Exact immutable export `/tmp/pi-web-test-source-thNSFa/source`, outer SHA-256
  `de957f9e4d81c3dd2e4f6c8b5a2950fe15ac3d9ca303cba123a8c3507a2fdfc6`;
  run `/tmp/pi-web-test-core.GwfqPz/run.json`, immutable output
  `/nix/store/bzk9m6vwqfbvhd9mz51rndbq6p0mrs9q-pi-web-core-checks` (summary,
  individual TAP/errors, lifecycle/static manifests retained).
- **149s whole command** (whole-second wall clock), including in-run realization;
  core-driver envelope **139.843s**, before-first-file realization/static/setup
  envelope **106.293s**, file execution window **33.350s**. No separate prewarming
  or machine-exclusive/cold-cache/speedup claim; model/review/coordination excluded.
- Covers actual model/recovery/question policy, native store/API (including native
  Git fingerprint exclusions), mounted reader/snapshot/races/forms/tray/imports,
  actual composer/Pierre and unchanged default question/workspace/presenter owners.
  Installed-browser geometry/Selection/deployment remain parent-owned. No browser
  or full-all execution by this writer. New E holds remain explicit.
- Five restored meaningful production controls and failed setup/diagnostic runs
  remain in [workflow evidence](assets/guided-review-notebooks/workflow-evidence.md).
  Source writing was subsequently resumed only on the explicit post-review request
  for the three corrections and installed-bridge assertion fix above. Parent final
  review/acceptance must bind the resulting candidate, not this historical pass.

### Complete reader acceptance (historical)

- Tested commit: `532a17656be3f38c06dc19c774a206b6d4eadac8`, on main
  `4422eedcdcd407f536c629a4c7eaf5fbc84a0d29`; immutable source digest
  `a347597642b33b93da61d26d00182e948c75a0dcb71bc6e9ee0853988edce5ac`,
  export `/tmp/pi-web-test-source-tUhdUC/source`.
- `nix run .#test -- all --workers 4 --jobs 12`: **passed**, exit 0,
  **393s end-to-end command**, including in-run realization, excluding model work,
  approval wait and coordination. All **516 core files / 4,243 tests / 14 suites**,
  **26 complete browser/terminal groups / 59 scenario receipts**, and genuine Home
  Manager VM deployment/settlement passed. No skipped/cancelled tests or retired
  assertions.
- Explicit 4 browser / 12 core requested and effective, overlapping levels. Before
  launch the host had 32 CPUs and about 43.4 GiB available; runner admission stayed
  fail-closed. Exact admission: `/tmp/pi-web-test-source-tUhdUC/selection.json`.
- Core: **276.303s** outer envelope, **36.950s** realization/static/setup before the
  first file, **238.904s** file execution window. Browser: **325.509s** outer
  envelope, **101.468s** support preparation, **7.024s** definition publication,
  **216.376s** capsule execution envelope. Service: **60.403s** outer envelope,
  **19.40s** guest test script. Overlapping intervals are not additive; no cold-cache
  or speedup claim. Earlier runs warmed shared prerequisites; the composed changed
  application package was built in-run.
- Evidence: `/tmp/guided-reader-composed-all.ZSqi9O.log`,
  `/tmp/pi-web-test-core.ePKx16/run.json`,
  `/tmp/pi-web-test-browser.cLZIMq/run.json`, `/tmp/pwv-a1eQTs/run.json`.
  Core/static artifacts are retained at
  `/nix/store/vknf0l017ah562v7bhsmd1mpk3zf55fc-pi-web-core-checks`.
- The earlier candidate `dcc4150b1e78f583026a753feaf7d51b803b3c77` passed full
  4/4 acceptance in **388s** (`/tmp/guided-reader-all.1UFHJJ.log`). Main then
  advanced with independently authored Sidebar catalogue coalescing, so the merge
  gate refused stale state without Git effects. Rebase was clean; complete fresh
  acceptance above covers this composition instead of relabelling the old run.
  Different source and worker widths make the two durations non-comparable.
- Independent native/reader/presenter reviews found no remaining material issues.
  New mounted files retain their explicit conservative E holds; no scheduling
  promotion, universal closure claim or error suppression was used.

### Focused controls and retained history

Actual production defects meaningfully failed and were restored: Next no-op
(`/tmp/guided-reader-navigation-red.log`), lost retained comparison model
(`/tmp/guided-reader-retention-runtime-red.log`), missing presenter forwarding
(`/tmp/guided-presenter-forwarding-red.log`), and ordinary large-file misdiagnosis
(`/tmp/guided-reader-ordinary-red.rGBMJv.log`). Setup/type failures are not counted
as these runtime witnesses. Final focused guard/presenter/comparison green:
`/tmp/guided-reader-final-focused.e0SiJ5.log`,
`/tmp/pi-web-test-core.U9CUUf/run.json` (3 files / 8 cases, 43s command).
The earlier installed Markdown bridge passed at 1280/390 in **245s** total /
**123.031s** execution (`/tmp/guided-reader-markdown.KQ2mIy.log`); its evidence is
not relabelled as the final source run. Detailed earlier focused/failure chronology
remains in the preceding plan commit and retained logs, not a second work queue.

Implementation follows `docs/testing.md` and `e2e/README.md`: focused core files
and Markdown/file-workspace browser scenarios during editing, then complete core,
full browser/terminal inventory and genuine Home Manager deployment acceptance for
each settled runtime increment. Current preferred command when 12/4 overlap is
resource-admitted; use the documented 4/4 fallback otherwise:

```sh
nix run .#test -- all --workers 4 --jobs 12
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

- [x] User-approved rough sample/desktop/narrow interaction defines the workflow;
  schemas/current-chat-draft transport are resolved. Runtime validation is not
  invented and is no longer an intermediate implementation stop.
- [x] Reader implementation handles feature ranges, pinned architecture and
  independently authorized repository targets, selected evidence formats and free
  chapter/step navigation; complete reader acceptance is historical. The workflow
  has its own final verification gate above.
- [x] Interactive increment preserves answers, explicit progress, anchored
  feedback, selected batch context, item replies and reviewer-owned resolution.
- [x] Re-review accounting distinguishes content changes, lost authorization and
  unchanged pinned material, retaining inspectable historical records.
- [ ] Read/write/network/session boundaries have adversarial and race coverage;
  opened, reviewed, approved and tested remain visibly distinct.
- [ ] Parent final independent review and complete acceptance verify the entire
  workflow; maintained guides/ADR own delivered behavior. The rough interaction
  approval/full-plan request supersedes the old intermediate user stop.
- [ ] Local Git handoff follows repository policy. Remote publication, deployment
  and feature cleanup are separately authorized; no other project's review files
  are changed without that project's applicable authorization.
