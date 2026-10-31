# Operation review metadata and read API

**Checkpoint:** P2 persistence/producer safeguards are retained. P3 connects the
registered read-only provider, session/standalone GETs and existing per-file viewer.
Focused native/mounted checks pass; installed-browser verification and independent
P3 review are recorded in the active plan. This is not complete acceptance,
live conversion, deployment or an authorization to delete legacy state. The
[offline converter](git-operation-review-migration.md) remains separate from runtime.

## Generic host boundary

- `lib/plugins/review-reference.ts` is client-safe: `OperationReviewReference`
  (`{version: 2, id, operationId}`), its validator, `isOperationId`, and
  `OPERATION_REVIEW_TYPE`. UI validators never import server metadata/Node crypto.
- `lib/plugins/review-metadata.ts` owns detached JSON snapshots and integrity:
  `OperationReviewRecord` is `{version: 1, id, pluginId, operationId, format,
  payload, sha256}`. `snapshotOperationReview` refuses lossy/non-JSON values;
  `readOperationReview` validates integrity. Metadata is not model input or
  execution authority. `findOperationReview` resolves the exact ID on the
  referring entry's ancestry, not the latest record sharing an operation UUID.
- `PluginUiContext.saveOperationReview(pluginId, operationId, format, payload)`
  returns a small v2 reference only after saving succeeds. Operation receipts and
  both card ports validate reference ownership/ancestry before publication.
- Session metadata is an ordinary hidden custom entry. `flushSessionEntries` and
  `sessionSaveBarrier` force SDK custom-only first flush, fsync the session file
  and the supported parent-directory boundary before exposing references or
  receipts. Failed SDK appends may leave memory behind: after append/flush/barrier
  failure, the owner is quarantined, not merely its operation ports. Ordinary SDK
  appends and live history/tree/context reads refuse, so tool-result continuation
  cannot parent an unwritten receipt or present rejected memory as saved history.
  Quarantine preserves all file bytes and existing entries for inspection; it does
  not rewrite uncertain history, fabricate a terminal receipt or retry Git. A fresh
  owner must load actual disk history after the failed owner settles. Runtime list
  projection omits the quarantined owner rather than failing unrelated reads.
  Metadata-only `fork_branch` copies are flushed before reopen. Clone establishes
  its own file/directory barrier after its final preference append and before
  publishing the child identity or retiring the source; failed copies keep the
  source alive and unchanged.
- `resolveSessionReview(sessionId, reviewId)` returns server-only
  `{ref, pluginId, metadata?, resolveLinked?}` from an exact persisted reference
  occurrence. Linked resolution stays on that same ancestry and operation.
- `StoredProjectOperation.reviewMetadata` holds the same records inside the
  existing standalone operation JSON. `resolveProjectOperationReview(pluginId,
  hostOperationId, reviewId)` returns the admitted owner snapshot and its exact
  owner-local linked resolver. No extra directory/database exists. Normal
  status/list DTOs explicitly omit full metadata before cloning.

The standalone host/request ID is not the Git receipt operation ID or review ID.
Settlement does not recalculate original input/acknowledgment digests or accepted
consent timestamps. Historical evidence cannot restore live approval authority.

## Plugin-owned Git payload

`plugins/git-workflow/review-data.ts` exports **`GitReviewPayload`**, its constituent
types, `GIT_REVIEW_FORMAT = "git-operation/v1"`, `readGitReviewPayload`, comparison
validators, `gitReviewResult`, and `resolveGitReviewSettlement`.

| Discriminant | Complete metadata |
| --- | --- |
| `proposal` | Exact operation, fingerprint, cwd, full native arguments/check definitions, optional postflight baseline; source is a captured Git comparison, complete resource capture, or explicit unavailable descriptor. New producers do not also save an unbounded presentation card. |
| `settlement` | Exact proposal reference, outcome/effect/check facts, structured settled postflight, optional captured result or unavailable-result descriptor, optional resource observations, and `same` / `different` / `unknown` relation. |
| `legacy-unavailable` | Only recoverable operation/fingerprint/check/argument facts, an explicit unavailable descriptor and lossless details. Missing facts never become an exact proposal or a proven result. |

`GitReviewResources` retains complete worktree/ref/registration facts or cleanup
artifact counts, bytes, digests, paths and permission distinctions outside card
limits. `GitReviewDetails` is the once-only home for **legacy presentation-only**
fields/sections/text, including complete cleanup artifact rows. These metadata
fields have no card text/count ceilings and contain no patch/ref/action fields.

`GitReviewUnavailableComparison` can retain trustworthy full comparison/tree OIDs
without a repository binding. Omit unknown identity. A binding observed/admitted
by an offline converter uses `bindingOrigin: "offline-admitted"`, never invented
`"captured"` provenance. Reasons distinguish missing legacy binding/endpoints,
unavailable repository/objects, unproven result and unsupported legacy data.

The decoder validates complete nested resource inventories, permission/parent
records, worktree/head/registration observations, check definitions and optional
resource results. Unknown body fields and malformed counts/digests refuse; array
and text lengths are not card-bounded. Incomplete metadata is not silently promoted
to a typed resource capture.

Legacy settlement `outcome.completed`, `checksStarted` and `effects` are optional:
absence is unknown, not false or an empty list. Existing live producers still supply
full facts. Every migrated terminal occurrence links its own settlement even when
its proposal is `legacy-unavailable`; that no-result link cannot label a proposal
as actual. A settlement-local optional `resultBasis` contains only action/refs/
candidateTree/mergeMethod display facts, never fictional physical execution guards.
It is strictly decoded and independently matched to proposal OIDs, operation and
frozen argument grammar. It cannot coexist with a full live proposal baseline.
Actual results still require `completed === true`, started effect, succeeded phase,
the unchanged finalization/action/parent/tree/relationship gates and repository-bound
capture. Missing admission/objects retains trustworthy endpoints as unavailable.

`review.ts` composes proposals and settlements; `compactGitCard` only bounds
presentation. Result endpoints come from finalized, verified postflight with its
exact baseline/relationship guards, then repository-bound capture. Summary prose,
`report.commit` alone, current HEAD or an equal operation UUID are not proof.
Missing capture preserves verified endpoint facts as unavailable, not a fabricated
result. A saved settlement **does not prove a terminal receipt was persisted**.
Native-success/reporting-failure remains completed and must not be repeated.

Original captured objects are checked before live preview can regenerate a missing
candidate tree. Historical Git reads remain the optional plugin's
`review-reader.ts` responsibility, with independent owner/path admission, immutable
endpoints, no lazy fetch, no current-file substitution and no retention refs.

## Registered read-only composition

`BundledPlugin.reviewProvider` explicitly registers formats and a read capability,
independent of execution enablement. `lib/plugins/review-provider.ts` checks the
exact envelope/ref/plugin/operation/format and wraps linked resolution with those
same bindings. Git payload decoding, trustworthy settlement validation and source
selection live in `plugins/git-workflow/review-provider.ts`, not generic chat.
The client-safe protocol/error types are separate from registry dispatch to avoid
an initialization cycle. Disabling execution never enables tools through a GET.

The session route resolves only persisted operation/interaction receipt occurrences.
`review-session-entries.ts` opens a non-writing descriptor, validates the header and
entry IDs/parent shape, checks file identity/stability, and closes it on every exit.
Only tree-bearing session versions 2/3 are supported; older/unknown/torn/conflicting
owners fail closed without migration. Lookup uses `allowCatalogueScan:false`;
normal chat SDK readers are unchanged. Unknown IDs cannot persist a catalogue scan
or admit roots. Ownership is not repository permission.

Content uses only fresh already-known allowed roots/explicit admissions through the
existing lexical/physical file-security boundary. Saved paths/OIDs do not add roots.
Standalone review resolution retains its physical owner-anchor admission **before**
content fallback and revalidates it around reads. A surviving allowed captured primary
checkout can supply content after feature removal, never bypass owner admission.
Cold unknown/expired root snapshots fail closed until an ordinary independently
authorized surface admits the project; review GETs never scan home/sessions to do so.

Both existing review endpoints accept the same strict query protocol:

| `op` | Additional query keys | Response |
| --- | --- | --- |
| `overview` (default) | none | Permitted views, default, per-view availability/labels/full endpoint IDs, relation and details capability; no complete lists |
| `page` | `view=proposal\|result`, `start` (multiple of 40) | Generated 40-file inventory; numeric file IDs belong to that exact comparison |
| `preview` | `view`, `file`, optional byte `offset` | Selected-file 256 KiB raw preview and complete byte count/next offset |
| `context` | `view`, `file` | Immutable complete file context under existing per-side/line limits |
| `patch` | `view`, optional `file` | Complete streamed binary/full-index patch download, no aggregate buffering/size cap |
| `details` | optional byte `offset`, optional `download=1` | Bounded metadata preview, or complete metadata download on explicit demand |

Duplicate/unknown keys, paths/revisions/repos and noncanonical numeric IDs refuse.
The operation lookup accepts only own known keys, including normal 400 JSON refusal
for prototype names. Selected patch downloads validate the numeric file against the
same native immutable inventory **before** attachment headers (400 for absent IDs,
including file 0 of an empty comparison), then repeat selection/guards while
streaming. Complete empty comparisons still download successfully. Every content read regenerates/validates inventory selection and brackets Git reads
with physical binding and endpoint/object checks. Downloads are pull-based; abort
and stream cancellation terminate/join the owned iterator/native child. Mid-stream
failure errors the body, never reports a complete successful partial download.
There is no lazy fetch, content/index cache, patch file or retention ref.

Settled trustworthy results default to **Actual result** (or **Rebased feature
changes**). Explicit pre-effect false facts may default to **Original proposal**;
absence/unknown is not false. Missing actual remains unavailable even if proposal
works. `different` is a neutral file-version observation; `unknown` is not a known
difference. The proposal switch uses the same ReviewFileBrowser/CommittedPatchDiff,
not another viewer. Lightweight reading state is source/view/file scoped; selected
contents/context are released on unmount and restored intent reloads only that file.
Restoring Before/After without context shows truthful loading/unavailable feedback
and the unchanged patch, never a nonexistent-file claim; only a loaded explicit null
side means absence. Retry restores the saved clean version/query/anchor.
`ReviewNavigationState` shares a 128-entry / 64 KiB payload-weight LRU across positions
and preview offsets. Retained queries are at most 4,096 UTF-16 units and expansion
maps 128 rows; oversized/default convenience state is omitted. Snapshots are detached
and contain no patch/parsed file/context. Eviction loses only reading convenience,
not content/operation/approval access. Weight is conservative payload accounting,
not a JavaScript RSS bound; active search and operations have no new size limit.
Late ignored-abort replies cannot publish over the new view. Complete metadata and
resource lists are lazy/paged, not duplicated in polling/cards. Generic supplied
patches/notebook storage are unchanged.

Legacy/unknown formats retain cards and outcomes with an unavailable overview (200);
materialization requests return unsupported (501). The UI's v1 placeholder performs
no bundle request. The old codec/tests now live only under
`tools/migrations/git-operation-reviews`, admitted to tests via one classified bridge,
not application/package inputs. Its README records continuing assertion dispositions.
The isolated converter implements unknown legacy outcome adaptation, exact graph/
byte preservation and private rehearsal; its [guide](git-operation-review-migration.md)
defines the supported contract and recovery boundaries. Independent P4 review and
full acceptance remain separate. No facts are recovered from prose or current HEAD.

See [the plan](plans/2026-10-31_git-backed-operation-reviews-plan.md) and
[ADR 0040](adr/0040-git-backed-operation-reviews.md). Focused native/SDK/mounted tests
are not full browser, deployment or migration acceptance.
