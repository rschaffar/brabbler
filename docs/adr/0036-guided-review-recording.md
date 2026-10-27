# Guided review recording and explicit chat drafts

## Decision

Extend the existing guided reader with a separately activated, single-reviewer
record. Keep immutable readers, Markdown presentation and navigation owners; do not
create a parallel renderer, a blocking `ask_user` request, agent session or approval
lifecycle. `QuestionFields`/the selection helper serve live questions and notebook
forms; the notebook outcome adapter does not weaken live required-answer validation.

`NotebookReviewPanel` owns forms/tray/preview and recoverable local fields.
`lib/notebook-review.ts` owns strict operations, versioned histories and reviewer-only
resolution. `lib/notebook-review-store.ts` owns independently authorized native
storage; `/api/review-data` is the bounded request boundary. The maintained
[notebook guide](../review-notebooks.md) owns schemas, controls and finite limits.

## Authority, persistence and ambiguity

Opening or reading an index is not write activation. Each request independently
uses the existing allowed-root/physical boundary; metadata and transcript-only
references never grant siblings, writes or new roots. Capture and revalidate the
physical index/folders around async bodies and effects. GET does not create,
import, clean up or migrate anything. Create only fixed one-level sidecars with
private modes, never chmod existing paths.

Use numbered complete reviewer snapshots, consecutive revisions and previous
exact-byte hashes, with no mutable authority pointer. A server-side operation
reducer appends reviewer decisions; an agent reply cannot supply resolutions.
Stage `wx` bytes, write completely, fsync, revalidate history/expected tip, exclusively
link the next slot, fsync the directory and validate committed history. Do not use
overwrite rename or an exclusive-copy fallback. Known private-stage leftovers are
bounded, preserved and non-authoritative; cleanup touches only the owned stage
under unchanged physical identity. Unsupported hardlinks/directory fsync refuse
recording rather than weaken the protocol. Reader access remains independent.

Conflict is not last-write-wins. After-link failures and missing acknowledgements
are possibly committed. Exact submission/operation and imported-byte digests permit
reload/retry reconciliation without duplicate revisions. An import checks its
expected tip before installing bytes, validates the frozen batch and privately
copies exact bytes to a content-addressed sidecar, never linking mutable agent
output. Reserve inventory room for both stage and install. A later snapshot race
can leave an unreferenced immutable copy; preserve it, never silently prune.

This is cooperating-writer conflict safety, not strict exclusion of arbitrary
external editors, a reviewer attestation, universal power-loss durability or a
transaction across mutable asset reads and hostile external edits. Never overwrite
external bytes; detect hashes/expectations and surface post-install ambiguity.
A fresh client needs an independent checkpoint to detect a completely rewritten
otherwise valid chain.

## Evidence and reviewer decisions

Fingerprints use effective prose/title, question definitions, exact OIDs/paths and
relevant asset bytes, not branch-head advancement, chapter order or sidecar writes.
Displayed mutable snapshots report the bytes actually presented; a fresh inspection
hash cannot silently relabel an old displayed snapshot. Normalized JSON key order
and the documented limited prose normalization are cosmetic; other guidance changes
require re-review. Explicit current-step inspection has an aggregate read budget
including failed/overflow reads, not merely a sum of successful accepted assets.

Unavailable authority/objects are not fabricated content changes. A separate
authored-guidance identity permits non-affirmative progress, plain step concerns
and explicit unsure/not-applicable/skip with unavailable provenance. Such outcomes
never silently become outcomes for recovered material. Reviewed and affirmative
answers require available matching evidence. Old answers, marks, feedback edits,
resolutions and deleted anchors remain inspectable; no implicit line rebasing.

Anchors capture real source/Pierre public selection coordinates and quotes/context.
Unsupported image/PDF regions fall back honestly to target-level anchors. Shared
presenters retain their existing passive work observers; stale success and failure
callbacks cannot clear a newer selection.

## Handoff and recovery

Freeze selected feedback versions plus relevant step/question/evidence identities,
then preview exact content, existing session identity and fixed reply destination.
The only handoff is an optional callback through FileWorkspace/FileViewer to
AppShell's current composer. AppShell checks its latest selected session; insertion
appends a delimited batch while retaining existing text/images. Missing/switched or
unmounted destinations refuse. There is no automatic session creation or send;
normal chat Send remains a second explicit action. Persist Prepared/Drafted, not
sent/executed claims. The batch authorizes investigation and proposed changes only.

Validate raw or explicitly pasted JSON replies through one immutable import path.
Show partial coverage, rejected duplicates/unknown/stale identities, historical
replies and reviewer-only Resolve/Reopen separately from progress marks.

Browser recovery is bounded and best-effort, separately keyed per live file view.
Native radio groups are per live owner too. Keep batch-bound pasted JSON and the
selected preview, preserve newer edits during admitted writes, and offer explicit
copy recovery from another pane/activation. Reject malformed nested recovery data
without applying it or silently replacing its bytes; export/discard is explicit.
No private notes, live collaboration, hidden tests/fixes/Git or publication are added.

## Verification boundary

Actual reducer, mounted production forms/composer/Pierre and private native storage
owners exercise these contracts, including named same-slot process gates and failure
witnesses. The existing installed Markdown desktop/touch chain gains the workflow
bridge without retiring its read-only assertions. Focused checks are not complete
browser/deployment acceptance; the active plan records exact candidate evidence and
parent-owned remaining verification. Rough interaction direction was approved and
the user requested the whole plan, not another reader-only validation stop.
