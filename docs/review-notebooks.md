# Review notebooks in Markdown

Use ordinary Markdown for an author-led explanation and opt-in `pi-review` fences
for expandable evidence. A stop can display a pinned source range or a complete
commit review and reveal that commit in Git Explorer. These are read-only views,
not executable notebook cells or Git-operation approvals.

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

```pi-review
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
Markdown readers show the fenced data. The fence language must be `pi-review`;
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
inside `pi-review` cards, whose commit identity remains pinned.

## Pinning and authorization

The authored **commit** pins the content. On activation Pi Web captures the named
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

The guided reader below adds a notebook manifest without changing `pi-review` v1.
There are still no executable cells, portable aliases, copyable app URL links,
human review acknowledgments, persistent notes or computed change accounting.
Ordinary file links still open saved working content, not historical permalinks.

Keep test evidence honest in the prose: identify the tested candidate, command,
result, artifact and limitations. Opening is not reviewing; reviewing is not
approval; a coverage summary is not new execution evidence. Future progression,
notes and coverage support must preserve these distinctions.

## Guided folders (reader slice)

**Status:** implemented reader slice, not completion of the full guided-reader
increment. Installed-browser/native decoding checks, independent review and complete acceptance remain pending in the
[active plan](plans/2026-10-23_guided-review-notebooks-plan.md). No forms, resume
sidecars, progress writes or agent handoff are implemented.

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
not session cwd, sidebar checkout or terminal navigation. Selection and reading
state are in memory only. Step/target selection and source/diff mode survive target
switches, exploration and Back/Next during this activation. The last **32 immutable
file DiffReviewModels** retain Before/After, full/gap context, search and reading
anchors across renderer remounts (least-recently-used eviction). Returning still
reauthorizes and reloads the patch before reusing a matching model; comparisons
also require the same physical repository incarnation. Closing/Return to document,
Retry folder or originating cwd/index changes discards this state. Mutable assets
are never cached this way; each revisit reads a fresh labelled snapshot.

### Versioned authoring contract

One **top-level** `pi-notebook` JSON fence in `index.md` contains exactly:

````markdown
# Request-boundary review

```pi-notebook
{"version":1,"id":"request-boundary","title":"Request boundary review","chapters":[{"id":"flow","title":"Request flow","path":"01-flow.md"},{"id":"failures","title":"Failure behavior","path":"02-failures.md"}]}
```
````

Each chapter contains one or more top-level `pi-step` fences followed by its prose
and top-level `pi-review` / `pi-evidence` targets, until the next `pi-step` or EOF.
A step boundary has exactly `version:1`, `id`, `title`. Before-step prose is not a
step. Embedded examples inside longer code fences and blockquotes are not markers.
Chapters cannot contain manifests. Chapters are a flat declared list, not recursive
includes: no discovery, cycles, traversal, repeated paths (case-insensitive), missing
chapters or duplicate chapter/step/target IDs. Step/target IDs are package-global;
chapter IDs are unique in the manifest. IDs and titles use the `pi-review` bounds.
Unknown fields/versions diagnose without activating a guessed interpretation.
All metadata admitted into a guided package (including `pi-review` targets) rejects
duplicate JSON properties, even escaped equivalents, and nesting beyond 32 levels.
Standalone inline `pi-review` v1 behavior is unchanged. Guided prose and Markdown
assets display review fences as literal examples, not additional undeclared cards.

`pi-evidence` is a **distinct** strict schema; never add these fields to `pi-review`:

| Kind | Exact fields in addition to `version:1`, `id`, `title`, `kind` |
| --- | --- |
| `compare` | `cwd`, `branch`, full lowercase `base`, full lowercase `candidate`, literal repository-relative `path` |
| `file` | Literal folder-relative `path` ending in `.md`, `.txt`, `.json`, `.csv`, `.tsv`, `.mmd`, `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp` or `.pdf` |
| `web` | Bounded `url` with HTTP(S), no embedded credentials; links only, never fetched/embedded automatically |

Comparison endpoints must each be reachable from the named local branch's
captured tip. Base must be an ancestor of candidate; divergent/reversed ranges
visibly refuse. This compares the **two endpoint trees**, including earlier feature
commits, not candidate's first parent. Unchanged files use pinned `pi-review` source
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
```pi-step
{"version":1,"id":"reject-before-extract","title":"Can a rejected request reach extraction?"}
```

Read the guard before the extraction call. Compare the complete feature's change
with the client assumption. Look for a failure path that reaches extraction before
validation. The listed tests cover ordering, not deployment or performance.

```pi-evidence
{"version":1,"kind":"compare","id":"server-range","title":"Whole server feature","cwd":"/home/me/projects/server","branch":"feature/request-boundary","base":"1111111111111111111111111111111111111111","candidate":"2222222222222222222222222222222222222222","path":"src/request.ts"}
```

```pi-review
{"version":1,"kind":"source","id":"client-assumption","title":"Client failure expectation","cwd":"/home/me/projects/client","branch":"feature/request-client","oid":"3333333333333333333333333333333333333333","path":"src/client.ts","start":24,"end":39}
```

```pi-evidence
{"version":1,"kind":"file","id":"test-record","title":"Test record (working asset)","path":"assets/test-record.md"}
```
````

Use another unique `pi-step` in `02-failures.md`, with prose on missing/error cases
and verified source or web-link targets as appropriate. Keep evidence limitations
explicit. This example does not install authoring guidance or modify exact prompts;
the separate authoring-guidance work remains with its existing owner.
