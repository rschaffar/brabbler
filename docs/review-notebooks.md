# Review notebooks in Markdown

Use ordinary Markdown for an author-led explanation and opt-in `brabbler-review` fences
for expandable evidence. A stop can display a pinned source range or a complete
commit review and reveal that commit in Git Explorer. These are read-only views,
not executable notebook cells or Git-operation approvals.

## Choose references before authoring

For every step, decide whether it reviews an introduced change, a deliberate
multi-commit range or final behavior. A commit containing a symbol is not
necessarily the commit that introduced or changed it. Pinning everything to the
final branch tip can show an unrelated commit in the reader's commit view, even
when the source excerpt exists there.

- **Introduced change:** inspect Git history and the actual patch, then use the
  introducing/change commit for that claim. Check each symbol separately: records
  and an interface discussed in one step may have different introducing commits.
  Split evidence targets or steps when necessary; do not assign them one commit
  merely because they appear in the same explanation.
- **Single-commit diff:** normally compare the change commit with its parent.
  `brabbler-review` source/File diff and commit views use the first parent (the empty
  tree for a root commit). Do not substitute the branch base or final tip for
  that parent without explaining the different review scope.
- **Multi-commit range:** use explicit `brabbler-evidence` comparison endpoints. Label
  the target and explain which commits the range includes, why they belong
  together and that the diff compares endpoint trees, not one commit's patch.
- **Final-candidate source snapshot:** legitimate for reviewing final behavior.
  Label it as a snapshot at the exact candidate, not an introducing commit. If
  the step also explains history, supply the introducing commits separately.
  Keep test-result claims tied to the exact tested candidate, command, result,
  artifact and limitations; test source or a later snapshot is not a pass receipt.

Use read-only local Git inspection, for example (variables are verified local
identities; paths and symbols below are generic):

```sh
git log --reverse --format='%H %s' "$base..$candidate" -- src/records.ts src/reader.ts
git log -p -S 'interface RecordReader' "$candidate" -- src/reader.ts
git show --format=fuller "$change" -- src/reader.ts
git rev-parse "$change^1"           # first parent, if the commit has one
git cat-file -e "$change^{commit}"
git show "$change:src/reader.ts"    # inspect coordinates in this version
```

A search match is a lead, not proof of introduction: inspect the patch, follow
renames or earlier history where needed, and verify the symbol's meaning matches
the prose. Resolve full commit IDs before writing metadata; revision expressions
such as `$change^1` belong in inspection commands, not authored `oid` fields.

### Audit the whole notebook

Before delivery, and after correcting an existing notebook, audit **all steps and
targets**, not just the first reported mismatch:

- Check each physical checkout, literal local branch, commit object and branch
  reachability. Do not fetch missing objects or substitute another revision.
- Verify paths, file types and one-based inclusive source ranges at each pinned
  commit, not against the working file. Verify comparison endpoint existence,
  ancestry/order and the changed path; use pinned source for unchanged context.
- Read the actual patch/source beside the step's prose and evidence title. Does
  each reference support the claimed introduction, change, range or snapshot?
  Object existence and schema validation alone cannot establish that history.
- Check test-evidence candidate identities independently. Report unavailable or
  unverified material honestly; distinguish Git/source checks from browser checks.

Write direct, simple English. Explain the review question, relevant mechanisms,
risks and evidence limits without patronizing analogies or elementary programming
tutorials. Simpler wording must not remove technical depth. Use generic examples;
do not copy private code, branch names or saved reviewer responses into guidance.

## Write a source stop

Place the explanation before the fence: what problem this code solves, what to
notice, and which judgment the reviewer should make. Keep optional detours and
test-coverage reasoning in normal Markdown.

The following values are illustrative. Replace `cwd`, `branch`, `oid`, path and
coordinates with an actual authorized checkout, existing local branch, full commit
ID and known source range. Do not use `HEAD`, a short hash or a guessed line number.

````markdown
## Authentication must precede extraction

Read these calls in order. Why can no parsed policy escape before authentication?

```brabbler-review
{
  "version": 1,
  "kind": "source",
  "id": "authentication-before-extraction",
  "title": "The candidate validation sequence",
  "priority": "thorough",
  "cwd": "/home/me/projects/core",
  "branch": "feature/revocation",
  "oid": "0123456789abcdef0123456789abcdef01234567",
  "path": "src/RevocationCandidateFactory.cs",
  "start": 77,
  "end": 99
}
```

The tests establish ordering and extraction parity, not deployment acceptance.
````

**Expand source** loads only that range, with original one-based line numbers.
**Show file diff** displays the entire file's change in this exact commit against
its first parent, not just the highlighted range or the branch's entire change.
An unchanged file is valid source context; it has no diff in that commit. A file
introduced earlier needs a separate commit block for its introducing change.
**Before/After**, full/gap context, search, wrapping and Wide view reuse the normal
immutable Git diff reader. Nothing reads current working files as a fallback.

## Write a commit stop

Use the same identity fields, but `"kind": "commit"` and omit `path`, `start` and
`end`. **Expand commit** opens metadata and the existing lazy, collapsible changed-file
stack. A root commit compares with the empty tree; a merge compares with its first
parent. Expanding all file sections does not eagerly load all full-file context.

## Version 1 fields and limits

| Field | Contract |
| --- | --- |
| `version` | Exactly `1`; unsupported versions remain inactive. |
| `kind` | `source` or `commit`. |
| `id` | Stable author-assigned stop ID: 1–128 letters/digits/hyphens/underscores, beginning with a letter or digit. Keep IDs unique within a guide. No completion state is inferred from them. |
| `title` | Nonempty single-line label, at most 240 characters. |
| `priority` | Optional effort classification: `thorough`, `focused`, `brief`, `tooling`. Not approval or test status. |
| `cwd` | Absolute physical checkout root; POSIX, Windows drive and UNC forms are accepted syntactically. Server authorization remains independent. |
| `branch` | An existing literal local branch name, not a tag, remote ref or revision expression. |
| `oid` | Full lowercase 40- or 64-character commit ID reachable from that local branch. |
| `path` | Source only: literal repository-relative Git path with forward slashes; no traversal, empty components or absolute paths. |
| `start`, `end` | Source only: inclusive positive integer coordinates, at most 400 lines, both within the pinned file. |

Unknown fields are rejected, rather than accidentally implying support for
commands, URLs, comparisons, symbols or repository aliases. A block is limited to
16,384 JavaScript string code units. Source must be regular UTF-8 text, at most
1 MiB/50,000 lines; symlinks, submodules, binary/invalid text and unavailable objects
refuse. Empty files have no valid positive source range.

Invalid fences show an inactive diagnostic and their escaped JSON. Ordinary
Markdown readers show the fenced data. The fence language must be `brabbler-review`;
ordinary `diff`/`patch` fences remain syntax-highlighted text, not live Git views.

## Reading and navigation

Blocks activate in settled ordinary user/assistant chat text and Markdown-file
previews. Skill expansions/instructions, questions, thinking, receipts and other
Markdown consumers do not opt in. Streaming chat fences remain literal until the
message settles. Initial rendering and scrolling perform no notebook Git reads.
Each expansion is explicit; collapsing aborts pending browser reads and unmounts
the reader. Reopening captures fresh authorization and reloads pinned material.
This first delivery does not retain per-stop diff/context state across collapse.

**Reveal in Git Explorer** validates the reference and opens that exact commit,
branch and captured history tip in a labelled **Referenced repository** view. It
does not change the session cwd, selected sidebar checkout, URL or terminal. On
mobile it opens commit detail; Back shows the graph. If the commit is older than
the loaded graph page, the detail is still exact and a notice asks you to load
older pages to locate its row; history is never fetched without bound.
**Return to workspace history** restores ordinary selected-checkout browsing.
Closing also drops the temporary reference. Expanding/restoring the panel keeps
its mounted reader; repeated Reveal is a fresh navigation command.

### Prose links and a linked reading pane

In a notebook's Markdown-file Preview, **Follow links** on a prose file link opens
that target and sends later links from this tab to the same existing or new pane.
The notebook's **Links** selector shows the destination; select **Here** there to
stop. **Right once / Below once** only open the selected link and do not establish
following. Routes belong to individual document views: another chapter starts
without one, even in the same pane. Use **Open here** for a chapter transition.

These prose links read saved working files and highlight their requested source
lines. They do not relocate or synchronize the historical source/diff readers
inside `brabbler-review` cards, whose commit identity remains pinned.

## Pinning and authorization

The authored **commit** pins the content. On activation Brabbler captures the named
local branch's current tip and uses the existing Explorer reachability/anchoring
checks around immutable reads. A later branch advance can authorize the same
pinned commit without updating a guide; it never changes the requested source
version. Movement during a read, deletion, rewritten ancestry, missing checkouts or
missing objects fail visibly. Retry recaptures authorization, not content identity.
There is no automatic `HEAD` fallback or line rebasing.

A path inside a document grants no new file root, directory access, editing or Git
permission. The checkout must independently pass the existing physical allowed-root
boundary. External files readable only through a session reference do not grant
Git access to their containing repository. Reads never fetch missing objects,
contact remotes, switch branches, invoke an agent or run commands/tests.

## Scope

The guided reader below adds a notebook manifest without changing `brabbler-review` v1.
There are no executable cells, portable aliases, copyable app URL links, recorded
answers or completion gates. Ordinary file links still open saved working content,
not historical permalinks. Discuss or revise a step through ordinary conversation.

Keep test evidence honest in the prose: identify the tested candidate, command,
result, artifact and limitations. Opening is not reviewing; reviewing is not
approval; a coverage summary is not new execution evidence.

## Guided folders

The guided reader uses the same immutable evidence readers as inline stops.
It is a walkthrough, not a review-management system. The original
[implementation record](plans/archived/2026-10-23_guided-review-notebooks-plan.md)
records historical candidate-specific acceptance; current changes and their
verification are tracked in the [authoring plan](plans/2026-11-05_notebook-authoring-plan.md).
Focused checks alone are not full browser/deployment acceptance.

Open `index.md` in Files **Preview**, then choose **Start guided reading**.
Ordinary preview/scroll does not load chapters or notebook Git evidence. Start
loads only the declared index and chapters, then activates the first selected
step's first target. The outline and Back/Next navigate freely across chapter
files. **Evidence** selects a meaningful target by title; **Compare with** adds a
different target. Both remain visible, stacked on small screens. Each immutable
source retains its existing Source/File diff controls; feature ranges use the
same diff toolbar, Before/After, context and reading model as Explorer.

**Outline**, **Explanation** and **Evidence** toggle each pane independently. Hidden
panes stay mounted: selected targets, loaded snapshots and reading state survive,
and already admitted reads may finish. Hiding is not cancellation or reloading.
The controls remain available even with all panes hidden. **Reset layout** shows
all panes and restores the default one-third explanation/two-thirds evidence split;
it does not reset evidence selections.

When the step has at least 720px available, drag the divider to resize explanation
and evidence (20–80% explanation), or click **More explanation / More evidence**.
Focus the divider and use Left/Right (Shift for larger steps), Home/End for limits,
Enter or double-click to reset, and Escape to cancel a drag. Narrow steps stack at
full width instead, based on the actual Files pane rather than viewport width.
Hiding either pane gives the other the full width. Layout choices survive step
navigation within this activation, including Reload guide/Retry, but are not saved and
reset on Return to document or a changed originating cwd/index. Following a local
prose link reveals evidence if hidden.

Local supported prose links inside a step can be explored in the evidence area;
**Return to current step** restores its selected targets and heading focus. Other
file links use ordinary Files navigation. **Return to document** unmounts evidence
and restores the Start trigger. All reader navigation is local to this file view,
not session cwd, sidebar checkout or terminal navigation. Evidence selection and reading
state remain in memory, not saved reviewer records. Step/target selection and
source/diff mode survive target switches, exploration and Back/Next during this activation. The last **32 immutable
file DiffReviewModels** retain Before/After, full/gap context, search and reading
anchors across renderer remounts (least-recently-used eviction). Returning still
reauthorizes and reloads the patch before reusing a matching model; comparisons
also require the same physical repository incarnation. Closing/Return to document,
Reload guide/Retry or originating cwd/index changes discards this state. Mutable
assets are never cached this way; each revisit reads a fresh labelled snapshot.

**Ask about this step** appends context to the currently selected existing chat's
unsent draft and reveals chat. It preserves existing text and images and does not
Send, create a session or run the agent. The context identifies the notebook,
chapter, stable step, displayed-step SHA-256 and pinned target definitions. It is
bounded to 32 KiB UTF-8, reports omitted references, and is not an edit request or
write capability. Add your question or requested change before sending. A changed
step/destination or unavailable composer refuses instead of choosing another chat.
Ordinary catalogue/maintenance requests from revealing chat are not agent execution.
A fresh session can work from the explicit notebook path and step ID too.

After an agent edits the files, choose **Reload guide**. The reader reloads the
package, retains the current stable step and layout where possible and refreshes
evidence state. If the step was removed or the notebook identity changed, it
returns to the first step with a notice. Failed reloads keep the last displayed
guide with an error rather than replacing it with incomplete material. Return to
document/reopen does not persist a cross-activation reading position.

### Versioned authoring contract

One **top-level** `brabbler-notebook` JSON fence in `index.md` contains exactly:

````markdown
# Request-boundary review

```brabbler-notebook
{"version":1,"id":"request-boundary","title":"Request boundary review","chapters":[{"id":"flow","title":"Request flow","path":"01-flow.md"},{"id":"failures","title":"Failure behavior","path":"02-failures.md"}]}
```
````

Each chapter contains one or more top-level `brabbler-step` fences followed by its prose
and top-level `brabbler-review` / `brabbler-evidence` targets, until the next `brabbler-step` or EOF.
A step boundary has exactly `version:1`, `id`, `title`. Before-step prose is not a
step. Embedded examples inside longer code fences and blockquotes are not markers.
Chapters cannot contain manifests. Chapters are a flat declared list, not recursive
includes: no discovery, cycles, traversal, repeated paths (case-insensitive), missing
chapters or duplicate chapter/step/target IDs. Step/target IDs are package-global;
chapter IDs are unique in the manifest. IDs and titles use the `brabbler-review` bounds.
Unknown fields/versions diagnose without activating a guessed interpretation.
All metadata admitted into a guided package (including `brabbler-review` targets) rejects
duplicate JSON properties, even escaped equivalents, and nesting beyond 32 levels.
Standalone inline `brabbler-review` v1 behavior is unchanged. Guided prose and Markdown
assets display review fences as literal examples, not additional undeclared cards.

`brabbler-evidence` is a **distinct** strict schema; never add these fields to `brabbler-review`:

| Kind | Exact fields in addition to `version:1`, `id`, `title`, `kind` |
| --- | --- |
| `compare` | `cwd`, `branch`, full lowercase `base`, full lowercase `candidate`, literal repository-relative `path` |
| `file` | Literal folder-relative `path` ending in `.md`, `.txt`, `.json`, `.csv`, `.tsv`, `.mmd`, `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp` or `.pdf` |
| `web` | Bounded `url` with HTTP(S), no embedded credentials; links only, never fetched/embedded automatically |

Comparison endpoints must each be reachable from the named local branch's
captured tip. Base must be an ancestor of candidate; divergent/reversed ranges
visibly refuse. This compares the **two endpoint trees**, including earlier feature
commits, not candidate's first parent. Unchanged files use pinned `brabbler-review` source
instead of a fabricated empty diff. Each comparison captures and revalidates an
opaque physical repository incarnation, branch tip and endpoints for patch/context
reads. Identity is not authority. Multi-repository targets carry independently
authorized physical cwd/branch/full OIDs, without aliases or implicit rebinding.

Limits: 32 chapters, 256 total steps, 512 total targets; guided metadata 16,384 UTF-8
bytes / depth 32, index/chapter/local text asset 256 KiB each and index+chapters
2 MiB total. Text must be regular UTF-8; NUL/binary and invalid UTF-8 refuse.
Selected raster assets are at most **8 MiB**, PDFs **16 MiB**. All files must be
physically contained and individually allowed by the existing file-root boundary;
symlinks and special files refuse.
The GET-only `/api/review-notebook?index=…` reads declared chapters; `&asset=…` reads
one selected supported local asset. Exact reference-only index access cannot
authorize sibling chapters/assets, grant new roots, write, watch or probe editing.

Local evidence is explicitly labelled **Mutable working asset** and read as a
bounded snapshot, without FileViewer edit/Git probes/watchers. Markdown/diagrams
reuse sanitized file Markdown and Mermaid; CSV/TSV uses the existing table, JSON
and text the escaped code presenter. No HTML/MDX execution. Automatic images in
guided prose/assets are replaced by labels, including remote images. A selected
raster/PDF target instead reads bounded bytes from the notebook API: extension and
signature must match a fixed MIME, served with `nosniff`, no-store, same-origin
resource policy and a restrictive sandbox CSP. SVG, HTML, MDX and remote media URLs
are not supported. Signatures are admission checks, not full document validation.

`NotebookBinaryEvidence` accepts a local index/path, never an authored browser URL.
It checks response MIME/size/signature again and constructs an owned typed blob URL.
Images reuse `ImagePreview` (including its explicit zoom action); PDFs reuse Files'
`NativeDocumentPreview` native viewer, not an HTML renderer. URLs are revoked on
exit/context change; obsolete bodies cannot create a player or revive a URL. There
are no watch/edit/probe APIs or remote URL embeds. Image decode failures are visible;
PDF support depends on the browser's native viewer, with Download this snapshot as
fallback. Native decoding/plugin behavior and memory limits remain browser-owned;
byte admission is not a full malware/content or decoded-pixel validator. Pinned code
never uses this mutable asset API. No PDF selection anchors are promised. Ordinary
document previews retain their existing defaults.

## Legacy questions and saved records

Recording, answers, findings, frozen batches and JSON-reply import have been retired.
Existing `review-data/` files and browser recovery keys remain untouched. No private
feedback is copied into notebooks or chat. `/api/review-data` returns HTTP 410 for
admitted GET/POST requests without opening saved data. See the
[manual recovery and retirement guide](notebook-recording-retirement.md) for retained
locations, private export steps, historical formats and assertion dispositions.

### Legacy authored questions

A top-level `brabbler-question` fence belongs to the preceding step (up to six per step).
It has `version:1` plus the existing question-set fields (`id`, `shortLabel`,
`question`, `type`, optional `context`, `required`, `options`) and optional
`explanation` (8,000 characters). IDs/options use the existing 1–64 character
`[a-zA-Z0-9_-]` grammar, including leading underscores/hyphens. Question identity is
step-scoped; options are question-scoped. All fields/options are strict; duplicate
properties, unknown fields, excessive nesting and duplicate question IDs refuse.

````markdown
```brabbler-question
{"version":1,"id":"_boundary","shortLabel":"Boundary","question":"Which failure paths deserve closer inspection?","type":"multiple","required":true,"options":[{"id":"early","title":"Early rejection"},{"id":"late","title":"Late extraction"},{"id":"none","title":"None","exclusive":true}],"explanation":"Author guidance: inspect both call order and failure propagation; this is not grading."}
```
````

The reader shows question/context/explanation and option titles/descriptions as
**Author guidance (optional)**. There are no form controls or saved outcomes;
`required`, recommendation and exclusive-choice metadata have no interactive effect.
Contexts use restricted file Markdown (no automatic images/live review cards).
New guides should use ordinary Markdown prompts instead of question fences. Live
`ask_user` questions are separate and keep their normal required-answer validation.

### Revise a notebook safely

Read the current notebook and identify the stable step before editing. Preserve
location and stable notebook/chapter/step/target IDs for the same logical items;
do not regenerate them for a prose revision or reuse an old ID for a different item.
Use a targeted Markdown edit rather than rewriting unrelated chapters. Do not read
private saved feedback unless recovery or another explicit request requires it;
leave sidecars and browser recovery untouched. There is no current-answer status
to preserve, negotiate or recreate in this reader.

After a requested change, report the affected steps and ask the reader to use
**Reload guide**. Historical answers cover their original material only. Never edit
snapshots, hashes or old anchors to imply a review of changed prose/references.
Preserving sidecars does not retain missing Git objects or the original notebook.

After a rebase, validate any proposed old-to-new OID mapping with the actual local
history and evidence. Equivalent patches do not establish equivalent source ranges,
first-parent diffs, prose or test results. Do not substitute branch tip, match solely
by subject, fetch objects or mutate Git as a side effect of editing a notebook.
Unclear mappings should remain explicit unresolved cases, not guessed references.
Ordinary read/edit tools remain usable; native inspect/update/reference-refresh
operations below need no browser pane or original conversation.

### Native inspect and step update

- `notebook_inspect({ indexPath })` reads only the explicit `index.md` and declared
  chapters and returns a compact validated outline. It does not read assets, Git
  objects, browser storage or `review-data/`. Malformed packages refuse explicitly.
- Add `stepId` to obtain that complete step's Markdown (including its leading
  `brabbler-step` fence), pinned reference definitions, writability and `binding`.
- Alternatively pass `inventory: {}` for target definitions, stable target/step IDs,
  chapter paths, counts and a whole-package `revision`, without loading Git or assets.
  Inventory replaces the outline; it cannot be combined with `stepId`. Continue
  with `inventory: { offset: page.nextOffset, revision }`; a positive offset requires
  that revision, and any changed chapter/manifest/edit identity refuses continuation.
  Optional `limit` is 1–32 (default 32). The complete JSON response, including its
  envelope, is bounded to 48 KiB UTF-8, so always follow `nextOffset`, not a presumed
  fixed page width.
- `notebook_update_step({ indexPath, stepId, binding, source })` replaces exactly
  that step. Pass the unmodified binding from a fresh inspection and the complete
  replacement source, retaining its stable ID and a separator before its neighbor.
  Manifest revision, notebook identity, resolved chapter and whole-chapter revision
  must still match. The whole package is validated; outside-step bytes and parsed
  neighbors are preserved. A changed or moved step requires another inspection.
- Inspect requires the active tool and `read`; update additionally requires `edit`
  (`write` or shell access is not a substitute). Grants and cancellation are checked
  again after asynchronous preparation and immediately before saving. Paths do not
  grant roots. Chat-only stays tool-free; extension-enabled children retain their
  resolved selectors and saved allowlists, without fallback grants.
- Saves use the ordinary file editor's per-file compare-and-replace semantics for
  cooperating in-process writers, not a lock against arbitrary external writers.
  A successful result names the actual path and old/new revisions. If a result is
  lost or uncertain, reread first; never replay a possibly completed write blindly.

These tools neither send chat messages nor run Git operations/tests. Schema and
reference inspection do not prove that the prose is correct or that a candidate
passed tests. Ask the reader to **Reload guide** after an explicit saved revision.

### Refresh pinned references after rewritten history

Use `notebook_refresh_references` in two explicit phases. First supply
`mode: "analyze"`, `indexPath` and `mappings`: one entry per physical checkout,
with its `cwd`, `targetIds` and `pairs` of full `oldOid`/`newOid` values. Select
explicit stable target IDs, or use `targetIds: "mapped"` to discover matching Git
references throughout the declared notebook. Discovery includes only that exact
checkout's targets with at least one old OID in the supplied map; it excludes
file/web targets and other checkouts, even with identical OIDs. A partially mapped
comparison is selected but unresolved, not silently omitted. For a comparison,
map **both** endpoints; an unchanged endpoint uses an explicit identity pair. The
agent must first establish correspondence through authorized local Git inspection. Subjects, similar patches and branch tips are not mappings.

Analysis processes the **whole selection**, then returns whole-selection counts,
a bounded result page and an opaque full-selection `binding`. Paging is presentation,
not a smaller analysis or acceptance scope. Named-target calls default to full
results; mapped discovery defaults to compact rows. Use optional
`report: { detail: "full", filter: "attention", limit: 8 }` for proposals and source
previews of unresolved or prose-review targets. The filter is optional (`all` by
default); `detail: "compact"` omits repeated reference/repository data and previews.
Each row retains its stable target/step IDs and chapter location. Full results
include original/proposed targets, separate byte-evidence axes and unresolved cases.
Source previews contain at most 2,048 bytes per side, an explicit truncation flag,
complete excerpt byte length and SHA-256; a preview is not the complete excerpt
when truncated.

Follow `page.nextOffset` with `report: { offset, binding, ... }`, using the original
mappings and the prior full-selection binding. A positive offset requires that
binding. Every page reanalyzes current admitted inputs; package, mapping, destination,
repository or branch changes refuse stale continuation. Filters/detail/width do not
change the binding. Pages contain at most 32 rows and the complete JSON response
is at most 48 KiB UTF-8; a byte-limited page can be shorter. An individual full row
that cannot fit refuses with a diagnostic; use compact detail and inspect the step. No plan database, background job or cross-call
Git cache is introduced. To reduce Git work, select a smaller named target set,
not a smaller report page.

Analysis reads explicit locally present old objects even when unreachable, while
new references must satisfy normal reader admission. It never infers checkout, branch or path changes. Multiple entries for the same checkout,
repeated/split/squashed mappings, missing objects, invalid destinations,
ambiguous relocation and incomplete/unsupported evidence remain unresolved. Other
independently valid targets remain available. Analysis never guesses a new path.

For a known source destination, add `destinations` to its checkout mapping, for
example `[{ "targetId": "reader-source", "path": "src/reader.ts", "start": 24,
"end": 39 }]`. Each entry names a selected source target and overrides its path,
range, or both. Paths remain literal repository-relative Git paths; ranges require
both endpoints and the existing 1–400-line/actual-EOF bounds. Duplicate, unselected,
empty or malformed destinations refuse; non-source overrides are unresolved. A
path-only override may still propose a unique exact multiline relocation. An
explicit range is used exactly, never replaced by an inferred match elsewhere.
All overrides enter the full analysis/application binding and destination admission.
Equal bytes at an explicitly changed path/range are `moved`, not `unchanged`; changed
excerpt bytes are `changed`. Neither proves semantic equivalence.

- Source results distinguish exact excerpt bytes, location, surrounding-file
  identity and that file's first-parent material. `unchanged` for a source means
  the **excerpt at the same path and coordinates**, not equivalent behavior or an unchanged
  surrounding file. Only a unique complete multi-line byte span can propose new
  coordinates; a single-line match cannot relocate a reference.
- Commit equality requires the complete bounded canonical changed-file inventory,
  both versions/modes and available blob bytes, using the first parent or empty
  tree. Rename-aware reader presentation is not equivalence evidence.
- Comparisons retain explicit endpoint-tree and delete/add semantics. Both new
  endpoints must be reachable, ordered by ancestry, and the path must change.
- `evidenceScope` distinguishes `source-excerpt`, `whole-commit-first-parent` and
  `comparison-path`; structured `reviewReasons` distinguish changed path/range,
  excerpt, surrounding file, first-parent inventory or comparison endpoint files.
  `proseReviewRequired` highlights changed evidence/context. Even exact bytes do
  not prove semantic equivalence or rerun tests. Old test claims remain pinned to
  their original candidate; no tool rewrites those claims automatically.

After inspecting the affected prose and proposals, invoke `mode: "apply"` with the
**same** `indexPath` and `mappings`, the returned `binding`, and explicit
`acceptedTargets`. Only validated targets can be accepted; the binding itself is
not authority. Analyze requires `read`; apply also requires `edit`, with the tool's
own name active. Current grants/cancellation, package revisions, physical checkout/
Git-directory identities and captured local branch tips are rechecked. A stale
proposal requires fresh analysis, never automatic rebinding.

Apply changes only selected metadata fences, preserving outside-fence bytes,
prose, stable IDs and unselected references. It validates the combined projected
package before the first save, then uses ordinary per-file revision-checked saves.
This is **not a transaction**: results distinguish completed files/revisions,
not-written failures, attempted-but-unknown outcomes and unattempted files. Stop
on partial/uncertain results, reread, and analyze anew. Never replay a possibly
completed save or roll back over newer changes. Use **Reload guide** after saving.

Bounds remain conservative: at most 8 checkout mappings, 512 selected/accepted
stable targets total and 64 OID pairs per mapping; existing notebook limits still
apply. Apply accepts explicit target IDs, not an entire report page or status class.
`report` is analyze-only. The same bindings and original mappings are required for
application, including every explicit source destination.

Git analysis/application still shares one 60-second, 2,048-process, 32-MiB aggregate
output budget, with joined cancellation and per-read limits. Verified immutable
commit/blob/tree/first-parent material is reused only during that operation, with
an additional 8,192-entry ceiling. Binary/symlink blobs remain valid for complete
commit inventories; source text uses the ordinary reader's decoder/type/line rules.
Reachability reuse includes the captured head and physical repository identity.
Current grants, physical-root admission and mutable repository/ref probes are never
cached: analysis captures each used checkout/branch once and freshly guards every
capture before returning, including targets with unresolved evidence. Apply starts
fresh and guards the distinct repositories again before each file save. Aggregate
work exhaustion is sticky even through translated Explorer errors and cannot yield
an applicable incomplete analysis; use a smaller explicit target selection rather
than resetting budgets per page or repository. Cache-heavy analysis yields to the
event loop between bounded target batches so pending cancellation can be delivered.
The 512-target selection bound is not a guarantee that arbitrary large objects or
comparisons fit the work budget. Commit metadata is capped
at 64 KiB/16 parents, complete commit inventories at 256 changed paths, and each
blob at 1 MiB; text readers retain their line/type limits. Unsupported submodule
objects cannot establish whole-commit equality. Bound exhaustion never counts as
partial equality. Operations disable helpers/lazy fetch and write only selected
chapter metadata. They execute no Git mutations or tests; reviewer history and
browser recovery are neither read nor written. There is no CLI, automatic
correspondence discovery or background repair.

### Contextual authoring example

First inspect the actual feature range and relevant repositories. When scope or
depth is unclear, use the existing `ask_user` contract to clarify it; a questionnaire
is not mandatory. For example (adapt the observed scope rather than repeating
generic questions):

```json
{
  "title":"Request boundary review",
  "context":"I found a three-commit request-validation change and a separate client adapter. The high-risk boundary is rejection before extraction; deployment has not been tested.",
  "questions":[
    {"id":"scope","shortLabel":"Scope","question":"Review the entire feature range or focus on the server boundary?","type":"single","options":[{"id":"range","title":"Whole range plus client adapter","recommended":true},{"id":"server","title":"Server boundary only"}]},
    {"id":"depth","shortLabel":"Depth","question":"How familiar are you with the request pipeline, and which failure cases deserve extra explanation?","type":"text"},
    {"id":"material","shortLabel":"Material","question":"Any additional design references or test evidence to include?","type":"text","required":false}
  ]
}
```

After the answer, author `01-flow.md` like this. Values below are illustrative;
replace physical checkouts/branches/full OIDs and verify paths/coordinates before
claiming availability. The index above plus this chapter and a similarly structured
`02-failures.md` form a folder; there are no required sidecars.

````markdown
```brabbler-step
{"version":1,"id":"reject-before-extract","title":"Can a rejected request reach extraction?"}
```

Read the guard before the extraction call. The server comparison deliberately
spans all three request-validation commits, from the pre-feature base to the final
candidate; it is not a single introducing commit. Compare that range with the
client's final-source snapshot, which shows the resulting failure expectation,
not its introduction. Look for a failure path that reaches extraction before
validation. The test record must identify the exact tested candidate and command;
ordering coverage does not establish deployment or performance.

```brabbler-evidence
{"version":1,"kind":"compare","id":"server-range","title":"Three-commit server range: pre-feature base to final candidate","cwd":"/home/me/projects/server","branch":"feature/request-boundary","base":"1111111111111111111111111111111111111111","candidate":"2222222222222222222222222222222222222222","path":"src/request.ts"}
```

```brabbler-review
{"version":1,"kind":"source","id":"client-assumption","title":"Client final-candidate source snapshot (not introduction)","cwd":"/home/me/projects/client","branch":"feature/request-client","oid":"3333333333333333333333333333333333333333","path":"src/client.ts","start":24,"end":39}
```

```brabbler-evidence
{"version":1,"kind":"file","id":"test-record","title":"Test record (working asset)","path":"assets/test-record.md"}
```
````

Use another unique `brabbler-step` in `02-failures.md`, with prose on missing/error cases
and verified source or web-link targets as appropriate. Keep evidence limitations
explicit. This example does not install authoring guidance or modify exact prompts;
the separate authoring-guidance work remains with its existing owner.

### Separate introducing commits in one step

Suppose a branch adds `Entry` records in commit A, adds `RecordReader` in commit B,
then changes logging in final candidate C. A step about introducing the records and
interface must pin them to A and B respectively, not C. These illustrative full
IDs, paths and ranges must be replaced with verified values:

````markdown
```brabbler-step
{"version":1,"id":"record-contract","title":"Records and reader contract"}
```

Commit A introduces the records. Commit B introduces the reader interface that
uses them. Inspect each target's File diff against its own commit's first parent.
The later logging commit C introduces neither declaration.

```brabbler-review
{"version":1,"kind":"source","id":"entry-introduction","title":"Entry records introduced in A","cwd":"/home/me/projects/catalog","branch":"feature/record-reader","oid":"1111111111111111111111111111111111111111","path":"src/records.ts","start":1,"end":12}
```

```brabbler-review
{"version":1,"kind":"source","id":"reader-introduction","title":"RecordReader introduced in B","cwd":"/home/me/projects/catalog","branch":"feature/record-reader","oid":"2222222222222222222222222222222222222222","path":"src/reader.ts","start":1,"end":8}
```
````

For an intentional combined A–B comparison, set `base` to A's parent and `candidate`
to B, and label it as a two-commit range. A separate final-behavior target may pin
C, titled **Final-candidate source snapshot at C — not the introducing commit**.
Do not transfer test results from A or B to C without execution evidence for C.
