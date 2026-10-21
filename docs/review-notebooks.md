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

This first increment deliberately has no executable cells, repository manifest,
portable aliases, copyable app URL links, immutable side-pane tabs, human review
acknowledgments, persistent notes or computed change accounting. Ordinary file
links still open saved working content and are not historical permalinks.

Keep test evidence honest in the prose: identify the tested candidate, command,
result, artifact and limitations. Opening is not reviewing; reviewing is not
approval; a coverage summary is not new execution evidence. Future progression,
notes and coverage support must preserve these distinctions.
