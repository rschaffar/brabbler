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

## Scope and next steps

The guided reader below adds a notebook manifest without changing `brabbler-review` v1.
There are still no executable cells, portable aliases or copyable app URL links.
The optional reviewer record described below adds explicit progress, answers,
feedback and dependency-based re-review accounting, not approval receipts.
Ordinary file links still open saved working content, not historical permalinks.

Keep test evidence honest in the prose: identify the tested candidate, command,
result, artifact and limitations. Opening is not reviewing; reviewing is not
approval; a coverage summary is not new execution evidence. Future progression,
notes and coverage support must preserve these distinctions.

## Guided folders

The guided reader and optional interactive reviewer record share the same evidence
readers. The [implementation record](plans/archived/2026-10-23_guided-review-notebooks-plan.md)
records complete candidate-specific acceptance; focused checks alone are not full
browser/deployment acceptance. Reading does not require enabling recording.

Open `index.md` in Files **Preview**, then choose **Start guided reading**.
Ordinary preview/scroll does not load chapters or notebook Git evidence. Start
loads only the declared index and chapters, then activates the first selected
step's first target. The outline and Back/Next navigate freely across chapter
files. **Evidence** selects a meaningful target by title; **Compare with** adds a
different target. Both remain visible, stacked on small screens. Each immutable
source retains its existing Source/File diff controls; feature ranges use the
same diff toolbar, Before/After, context and reading model as Explorer.

Local supported prose links inside a step can be explored in the evidence area;
**Return to current step** restores its selected targets and heading focus. Other
file links use ordinary Files navigation. **Return to document** unmounts evidence
and restores the Start trigger. All reader navigation is local to this file view,
not session cwd, sidebar checkout or terminal navigation. Evidence selection and reading
state remain in memory. The separately activated reviewer record persists resume,
explicit progress, answers and feedback; it does not persist every diff viewport. Step/target selection and source/diff mode survive target
switches, exploration and Back/Next during this activation. The last **32 immutable
file DiffReviewModels** retain Before/After, full/gap context, search and reading
anchors across renderer remounts (least-recently-used eviction). Returning still
reauthorizes and reloads the patch before reusing a matching model; comparisons
also require the same physical repository incarnation. Closing/Return to document,
Retry folder or originating cwd/index changes discards this state. Mutable assets
are never cached this way; each revisit reads a fresh labelled snapshot.

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

## Interactive reviewer record

1. Start guided reading. **Load saved review record** reads history and restores
   the last saved step without enabling writes. **Enable review recording** is a
   separate explicit action. The panel shows the physical notebook/index and fixed
   `review-data` destination: local files only, never automatically staged,
   committed or published. A reference-only index cannot authorize sibling reads
   or writes; read-only/unavailable recording leaves the reader usable.
2. Use Back/Next freely. Navigation only records a resume position after recording
   is enabled; it does not mark a step reviewed. Choose **Not reviewed**, **In
   progress**, **Needs attention** or **Reviewed** explicitly. Required authored
   questions need a *current-version recorded outcome* before Reviewed, not a
   correct answer. Answer, unsure, not-applicable and skip are distinct; all four
   count as recorded presence. Unsaved form fields alone do not count.
3. Add a question, finding or guide issue. **Anchor to this step** deliberately
   excludes a target/range. Alternatively capture a selected target or supported
   source/text selection. Pinned source includes exact OID/path/one-based range;
   diffs use Pierre's public committed-selection callback, actual side/range and
   loaded immutable context, forwarded through the shared source/commit/stack
   readers. Cross-side ranges are not guessed. Generic prose/text retains the
   quote/context without invented source coordinates. Native images/PDFs/web links
   support target-level feedback only, not image regions/PDF text coordinates.
   Source/prose selection also has explicit capture controls for keyboard users.
4. The tray spans chapters. Edit feedback or explicitly Resolve/Reopen it; neither
   Reviewed nor an agent reply resolves anything. Deleted step/target anchors,
   old answer definitions, marks and feedback edits remain accessible in history
   and recovery JSON; old coordinates are never silently rebased. Guidance-only
   anchors cannot become recorded findings through an edit or stored-history replay; text
   edits still preserve unavailable/deleted anchors.
5. Select items, then **Prepare in chat** to freeze item versions and their relevant
   guidance/question/evidence identities. Preview shows the exact delimited prompt,
   existing session ID/label and reply path. Selection and preparation send nothing.
   **Add batch to chat draft** checks the *currently selected* session still matches,
   appends after existing unsent text without replacing its selection, and keeps
   attached images. Missing/switched/unmounted chat refuses and retains the preview.
   It never creates a session or submits a model turn/agent-execution command.
   Revealing the existing chat may trigger its normal read-only tool catalogue
   request; that is not a prompt or execution. Normal chat **Send** is a second
   explicit action. Saved batch status is Prepared or Drafted, never a sent/executed
   receipt. No fixes, tests, Git operations or publication are authorized by it.
6. The prompt instructs the agent to write the batch's fixed raw JSON reply file,
   or return JSON for **Import pasted JSON reply** when file writing is unavailable.
   **Import agent reply file** uses the same validation/copy pipeline. Replies name
   the frozen batch/item versions and investigated fingerprint; unknown, duplicate,
   stale, orphan or forged reviewer fields refuse visibly. Partial replies are
   allowed and shown incomplete. Imported replies appear beside the original item;
   later feedback versions label their earlier investigation historical/stale.

### Authored questions

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

Text, single and multiple choice reuse `QuestionFields` and the pure selection
helper from live question sets; recommendations are not defaults, exclusive choices
remain exclusive, alternative text and additional details remain separate. Notebook
contexts use restricted file Markdown (no automatic images/live review cards), with
presenter work owned by the existing observer. Radio groups are scoped to each
live view. Reveal explanations are attributed to the author, not graded. Notebook
outcomes are an adapter, not a relaxation of live `normalizeSetAnswer`: a required
live question still rejects skip. No blocking request/receipt lifecycle is mounted.

### Revise a saved notebook safely

Before changing an existing notebook, check whether it has saved review data and
whether the requested correction changes reviewed material. Preserve the notebook
location and stable notebook/chapter/step/target/question/option IDs for the same
logical items; do not regenerate identities as part of a rewrite or reuse an old
ID for a different item. Preserve all saved review data, including `review-data`,
without copying private reviewer responses into examples or reports.

**Stable IDs do not keep answers current.** Brabbler fingerprints effective prose,
question definitions and evidence identities/bytes, not just IDs. Correcting an
OID, path, source range, comparison endpoint or substantive prose can keep earlier
answers and marks accessible as history while making them stale for the corrected
material. Required questions then need fresh current-version outcomes before
Reviewed. Even an OID change to identical source bytes changes the pinned identity.

If preserving current answers conflicts with the correction, stop before changing
that material and use `ask_user` to explain the affected steps and get the user's
choice: correct this notebook with earlier answers retained as historical and
re-review needed, or leave the reviewed version intact and author a separate
corrected notebook with a new notebook identity. Do not promise both corrected
material and unchanged current-answer status. A separate version must not move or
rebind the original review history.

Never edit/rewrite reviewer snapshots, hashes, fingerprints, saved answers or
imported history to make old answers appear current. Never silently rebind answers
or feedback to new material. After an agreed correction, report the affected steps
and expected staleness, and let the reviewer reload and record new outcomes through
the normal UI. History preservation is not current-answer preservation.

### Material changes, missing evidence and recovery

On explicit record loading/activation, current-step navigation, refresh and decision
writes, Brabbler checks that step's dependencies. Ordinary document previews and
other chapters do not trigger Git/media inspection. Fingerprints cover effective
step title/prose, question definitions, exact pinned target identities and relevant
local-asset bytes. They exclude branch-head advancement, branch authority labels,
chapter reorder and sidecar writes. JSON object key order is normalized. Prose
normalizes CRLF/CR to LF, trailing line whitespace and outer blank space only;
other prose/Markdown changes are material. Question-version fingerprints include
relevant step/evidence dependencies. Changed required questions need fresh outcomes.

Missing objects/authority/assets are **Unavailable**, not fabricated changed content.
Guidance has its own version identity: non-affirmative progress and plain step
questions/guide issues can still be recorded with explicit guidance-only provenance.
Unsure/not-applicable/skip can be recorded in an unavailable context, but cannot
silently satisfy a recovered material version. Reviewed/affirmative answers remain
fail-closed. Displayed mutable snapshots report their actual response/byte digest;
refreshing identity alone cannot record old displayed A as inspected B. Use **Reload
displayed evidence** and refresh identities, or reload changed authored chapters.
The UI never silently rebinds old prose, selections or answers to new material.
Reloading/changing a displayed mutable snapshot clears its current text selection:
capture again from the new snapshot, or use the target-level fallback. Historical
anchors remain unchanged.

Saving/Saved, Conflict, Possibly committed/no acknowledgement, and error states are
explicit. There is no automatic retry or last-write-wins overwrite. Reload the
record and reconcile the submission ID/exact operation (pasted reply bytes also
match the imported digest) before explicit retry/discard. Lost acknowledgement does
not prove nothing landed. Unsaved fields and batch-bound pasted replies recover
best-effort in browser localStorage, separately per file-view owner. The recovery
picker explicitly copies another pane/previous activation's record without changing
its original. Each record is at most 2 MiB, 512 question versions and 100 reply
drafts; inventory examines at most 256 browser keys. Nothing silently prunes history.
Malformed/oversized recovery bytes are preserved, never applied to React or silently
overwritten; export then explicitly discard. That action validates and persists
current fields before clearing the warning, so an immediate reload does not lose
kept edits; failure preserves the rejected record. Storage denial/quota failure warns and
keeps fields/export in memory. This is local browser recovery, not a secret store,
server save, live multi-tab collaboration or cross-device synchronization.

### Sidecar protocol and finite limits

```text
review-data/
  reviewer/0000000001.json        # complete version-1 snapshots, append only
  reviewer/0000000002.json
  replies/<batch-id>.json        # mutable agent raw output, imported only explicitly
  imported-replies/<batch-id>-<sha256>.json  # immutable exact-byte private copies
```

There is no mutable `current.json` authority pointer. GET validates without mkdir,
import, cleanup or migration. Writes independently reuse the lexical/physical
allowed-root boundary, regular no-follow bounded files, directory/index device/inode
identity and OS mode/access checks. They recapture/revalidate around asynchronous
request reads and effects. Only literal one-level folders (0700) and files (0600)
are created; existing paths are never chmodded and metadata never adds roots.
Snapshots carry notebook ID, consecutive sequence, previous exact-byte SHA-256,
submission ID and complete reviewer event history. Unknown/malformed history,
unsupported versions, holes and changed hashes preserve bytes and refuse.

Append stages random same-directory `wx` bytes, writes fully, fsyncs, revalidates
history/expected tip, exclusively **links** the next numbered slot, fsyncs the
directory, and validates committed history again. No overwrite rename or exclusive-
copy fallback exists. Only the owned stage under the same captured identity is
cleaned; known bounded private-stage leftovers have no authority and are not
silently removed. Unsupported hardlinks/directory fsync explicitly refuse recording.
Cooperating same-slot writers conflict; errors after installation are possibly
committed. Import checks the expected tip before effects, reserves staging/install
inventory capacity, validates the frozen investigation and privately copies exact
raw bytes (never hardlinks mutable agent output). Identical submission/bytes reconcile
without another revision; same submission with different bytes conflicts. A late
race after copy can leave a preserved unreferenced immutable copy, not a decision.

Limits: 2 MiB request/snapshot, depth 32, 512 reviewer events, 1,024 numbered revision
ceiling and 64 MiB reviewer-history bytes; every event consumes a revision, so the
512-event bound is normally reached first. At most 1,040 entries per sidecar child
directory (including known stages), reserving two entries for a pending stage/install;
reply JSON is 256 KiB, batches at most 100 items. Current-step local-asset inspection
consumes at most **32 MiB including overflow-sentinel reads**; it bounds each read
by the remaining budget before reading and stops later file bodies after exhaustion
or a failed read. Individual reader asset limits above remain unchanged. Resume
writes coalesce while another write owns admission. Quota errors retain drafts and
history; there is no silent pruning/migration on open.

These sidecars are not cryptographic reviewer attestations. Arbitrary external
editors are not strictly excluded; their changes are never overwritten, hashes and
expected tips are checked, and post-link ambiguity is surfaced. A fresh client
cannot detect a completely rewritten valid chain without an independent checkpoint.
Fsync/link tests are not a universal power-loss, filesystem or browser-plugin guarantee.
See [ADR 0036](adr/0036-guided-review-recording.md) for the ownership decision.

### Contextual authoring example

First inspect the actual feature range and relevant repositories, then use the
existing `ask_user` contract to brief the reviewer. For example (adapt the observed
scope rather than repeating generic questions):

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
