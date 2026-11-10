# Offline Git operation review conversion

The temporary tool is `tools/migrations/git-operation-reviews/cli.mjs`. It is not
shipped with Brabbler, loaded by the application, or run by a review GET. The tested
tool-containing revision is `61f1f60d7befd8cff60dfc0a597d0b863f50bd60`; retain it and
its lockfile through operational verification. Its actual tool/helper identity
`bfcd74fc8dc85c4adf7f19aee9d9b0b249eda1420e8cc451ec5582939c618d10`
(Node 24.21.0 / SDK 1.4.0) matches the independently reviewed all-mode private-copy
rehearsal. Complete application acceptance also passed at that revision. No live
cutover or tool retirement is claimed here.

## Supported boundary

Use Linux, the pinned Node 24 Nix development environment, Python 3 (extended
attribute refusal), `flock`, and local Git. No network, credentials, running agent,
auth service, current-ref lookup, object recovery or original SDK open is needed.
Session conversion supports strict UTF-8 JSONL **v3 only**, legacy Git v1 bundles,
recognized Git inline cards, and version-1 standalone operation JSON. Other session
versions, corrupt/unknown owners and partial graphs are explicitly blocked unchanged.
A pre-existing missing parent is not repaired or searched for elsewhere.

Attribute inspection must actually succeed before replacement. Fixed diagnostic
reasons distinguish nonempty attributes (`unsupported-extended-metadata`), an
unavailable listing syscall (`extended-metadata-query-unavailable`), another query
failure (`extended-metadata-query-failed`), and failure to launch/complete the probe
(`extended-metadata-probe-failed`). None admits a replacement; child stderr and
attribute names/values are not disclosed.

Nix 2.35.4 blocks attribute-listing syscalls in builders; 2.34.9 did not. The
external daemon owns this policy, independently of the flake's packaged client.
Run an operational rehearsal as an ordinary Linux process in the pinned development
environment, not inside a build sandbox. A development shell supplies tools; it
does not make its interactive command a builder. Do not disable filtering or treat
an unreadable query as an empty list. Core verifies refusal; the existing service
VM runs the complete converter matrix and genuine empty/user-xattr/POSIX-ACL cases
on its private writable filesystem. Hosted core/browser CI does not run that VM.

Select every retained session root explicitly, including archives/subagents/forks.
All branches and every operation/plugin-card occurrence are considered, not only
the current leaf or collapsed receipt. Provider/tool-result/model bytes and inert
serialized pause strings are not reference owners. Non-session files are inventoried
and reported preserved; there is no recursive UUID/prose rewrite.

The output root must be empty, private 0700, outside all selected input roots and
not an alias. Selected-tree directory identities and the held output ancestry are
checked before creating recovery artifacts or missing output components; lexical
separation alone does not authorize a bind-mount alias or aliased descendant.
It contains sensitive recovery artifacts: immutable manifest, stable
ID/edge mappings, exact original/staged copies, private reconstruction witnesses,
verified backups and an atomic progress journal. Do not publish these artifacts or
put real data in a checkout, test fixture, Nix input/store or public report. The
separate CLI summary contains only counts and fixed reasons. Private
`recorded-locators.json` supplies an exact finite locator/count list from already
validated bundle `operation.checkout` metadata, including scoped unreferenced
candidates. It is manifest-bound report context for a later explicit mapping
decision, not an admission. No locator is probed/normalized or inferred from prose;
incomplete sources remain unknown. Do not publish that private path list.

## Commands

First rehearse against a separately authorized, exclusively allocated private copy.
An unquiesced copy is not a live-consistency proof. These variables must name the
operator's explicitly reviewed roots; there are no agent/home defaults:

```sh
nix develop --offline --no-write-lock-file -c node \
  tools/migrations/git-operation-reviews/cli.mjs dry-run \
  --sessions "$COPY_SESSIONS" --operations none \
  --legacy "$COPY_OLD_REVIEWS" --output "$PRIVATE_RUN"
```

Repeat `--sessions` for additional roots. `--operations /absolute/selected/root`
selects standalone records; a genuinely absent explicit root is supported without
creating it. `none` means none selected, not a claim about global state.

Saved checkout paths never grant repository access. Initially omit admissions.
Trustworthy recorded OIDs/details survive with unavailable content. Optional
`--admit "$PHYSICAL_REPOSITORY"` grants read-only inspection of that explicit
physical checkout. A separately explicit
`--map "$OLD_SESSION_LOCATOR=$PHYSICAL_REPOSITORY"` requires that admission and
maps session review **content only**. It never changes standalone owner/project/
anchor/cwd, input/acknowledgment digests, timestamps, nonces or authorization.
Standalone content can use a directly admitted recorded checkout, not a session
locator map. Its runtime owner-anchor admission still applies independently.
Newly observed physical bindings say `offline-admitted`, never `captured`.

Review `report.json` and the complete private manifest. Dry-run rechecks original
membership/stat/byte hashes and writes only beneath the private output root. It
prints the exact manifest SHA-256. Apply, resume and restore require that exact
hash plus an explicit attestation that **all** selected-state writers are stopped:

```sh
# Same nix develop ... -c node prefix as above:
node tools/migrations/git-operation-reviews/cli.mjs apply \
  --output "$PRIVATE_RUN" --confirm "$APPROVED_MANIFEST_SHA256" \
  --writers-stopped I_STOPPED_ALL_SELECTED_WRITERS
node tools/migrations/git-operation-reviews/cli.mjs check --output "$PRIVATE_RUN"
node tools/migrations/git-operation-reviews/cli.mjs resume \
  --output "$PRIVATE_RUN" --confirm "$APPROVED_MANIFEST_SHA256" \
  --writers-stopped I_STOPPED_ALL_SELECTED_WRITERS
node tools/migrations/git-operation-reviews/cli.mjs restore \
  --output "$PRIVATE_RUN" --confirm "$APPROVED_MANIFEST_SHA256" \
  --writers-stopped I_STOPPED_ALL_SELECTED_WRITERS
```

The mutation modes refuse unresolved blocks by default. Only after reviewing the
**exact manifest's entire block list**, append
`--retain-blocked LEAVE_BLOCKED_INPUTS_UNCHANGED` to acknowledge retaining those
whole files/bundles unchanged. This cannot authorize partial rewriting of a blocked
file and does not turn it into a complete conversion. Exit 0 means no blocks;
exit 2 means reported retained blocks or an incomplete check; exit 1 means failure.
For mutation modes, even a journal failure can follow a successful per-file rename:
CLI output conservatively says `recovery-required`, `stateMayHaveChanged:true`, and
points to check/resume/restore using the same run and approved manifest. This is
not a zero-effects claim or permission for automatic rollback. Keep writers stopped,
inspect exact state and choose recovery explicitly. Read-only failures say refused.
Check distinguishes installed, pending and restored files; an unapplied plan is
not a verified migration. A second dry-run uses a new empty output root and is a
no-op for valid target-format owners.

## Preservation and recovery

- The original header, original IDs/timestamps/order/last physical entry, labels,
  compaction/context/branch targets and every non-reference field are preserved.
  Only exact source tokens and necessary referring parent tokens change. Removing
  the manifest's inserted hidden custom nodes and splicing edges reconstructs the
  original graph. Actual SDK context projections at all leaves/branch points and
  referring stages agree. SDK reopen validation uses separate LF-framed private
  copies because SDK open otherwise appends LF to unterminated tails; exact staging,
  original and backup bytes retain their original framing, including CRLF/trivia.
- Proposals are reused only on their ancestry. Every terminal occurrence gets its
  own linked settlement, including an unknown terminal with no trustworthy result.
  Session results require an exact ancestor invocation and unique unbranched local
  continuation to its structured result. Copies never consult a deleted parent,
  sibling, latest operation UUID or prose. Standalone joins are owner-local with
  distinct host/request/native/review IDs. Standalone plugin identity belongs to the
  outer owner; a valid record without an optional receipt has no review occurrence.
  Missing operation/action facts are not contradictory: owner-local result bytes
  stay intact and terminal actual results remain unproven. Session invocation proof
  requires the action/tool's required fields, not an empty/matching subset; optional
  frozen producer fields never read today's defaults. Unknown completion/check/effect-list
  facts remain absent, not false/empty. Missing sources/objects remain unavailable.
- Validated bundle metadata is retained once. Complete resource-only presentation
  rows survive without pretending to be a full typed physical capture. Exact
  rendered duplicates are elided only with a checked private reconstruction recipe;
  text is never parsed into execution authority. Patch bodies are streamed through
  aggregate/per-entry integrity checks, not buffered or installed in new metadata.
- Inputs, bundle members, private artifacts and same-directory replacements use
  held physical directory boundaries and no-follow nonblocking regular descriptors.
  Hardlinks, symlinks, special files, privileged/foreign ownership and extended
  attributes/ACLs on replaced files refuse. Supported ordinary modes are preserved;
  private backups stay 0600 and record the original mode separately. No ACL/xattr,
  hardlink-topology or hostile multi-writer transaction support is claimed.
- Every replacement has a verified byte/mode backup before the first installation.
  Interrupted existing backups are reverified through a held regular FD, fsynced,
  edge/stability checked and parent-directory synced before backup-ready publication;
  a cached hash alone does not establish durability. Exclusive same-directory files, file fsync, durable intent journal, atomic rename,
  parent fsync and installed journal state establish **per-file**, not dataset,
  atomicity. The private `flock` serializes converter invocations only. Stop other
  writers; do not run an old binary over a partially converted dataset.
- Resume recognizes exact before/after hashes and recorded replacement identity,
  including rename-before-journal interruption. It does not append duplicate records
  or replan changed inputs. Partial/corrupt backups or temporary artifacts refuse,
  rather than being silently trusted or deleted. Preserve failed artifacts; a new
  reviewed plan/output may be needed after resolving the exact failure externally.
- Restore verifies all backups and touches only exact files installed by this run.
  Changed/newer bytes, substituted paths and new membership refuse. Interrupted
  restore has the same exact before/after reconciliation. There is no whole-tree
  rollback, broad overwrite, bundle deletion or automatic cleanup. Retain original
  bundles, backups and all reports until separately authorized disposition.

Memory scales with the largest session/metadata/message and graph/manifest sizes;
SDK sessions are resident objects. Projection message hashes avoid repeatedly
serializing identical unbounded messages; this is not a content cache or new cap.
Patch hashing/copy I/O uses bounded buffers. Availability can later change with Git
object retention. Missing historical feature/base dependencies are unavailable,
not proof of a contradictory relationship. Qualified OIDs survive without extra
result materialization when the proposal-capture prerequisite is unavailable;
available type/tree/parent/base/ancestry contradictions still reject. Immutable
conversion check does not promise future availability. The frozen local-helper
identity includes the Git child environment helper and its reviewed local import
closure; changing those inputs refuses before state mutation.

The [metadata API](git-operation-review-metadata.md),
[temporary assertion ledger](../tools/migrations/git-operation-reviews/README.md)
and [active plan](plans/2026-10-31_git-backed-operation-reviews-plan.md) own the
implementation/evidence boundaries. Full acceptance, independent reviews, exact
live roots/stopped-writer control, deployment, deletion and retirement remain
separate gates; these commands grant none of them.
