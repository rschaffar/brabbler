# Operation review metadata — P2 API

**Checkpoint:** new Git producers use metadata, not patch bundles. Session and
standalone save/publication integration is implemented, focused-tested and
independently reviewed. P3 must connect the retained full per-file viewer and read
APIs before rollout; operation
cards currently show an explicit pending placeholder. Legacy cards retain outcomes
but require offline conversion. No migration or deployment is implied.

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

## Next-stage composition and limits

P3 must resolve the exact envelope/format, decode the plugin payload, resolve a
settlement's proposal through the supplied linked resolver, validate result evidence,
and dispatch to the existing Git reader under independent path admission. Wire the
retained shared per-file viewer and generic supplied-patch support; do not replace
them with another viewer. The current session/project review GETs return explicit
501 pending/unsupported replies after ownership admission, not materialized content.
The final review GET path must use read-only persisted-entry lookup: normal SDK
session opening can migrate older files and is not a no-write history reader.

The dormant `lib/plugins/review-store.ts` codec has no production host/API imports;
its isolated tests retain legacy integrity/byte/descriptor obligations for P4.
Physical converter relocation and package/source retirement remain open. P4 must
use occurrence/branch-local evidence, preserve unknown outcomes and original
acknowledgment history, and never recover results from prose or today's HEAD.

See [the plan](plans/2026-10-31_git-backed-operation-reviews-plan.md) and
[ADR 0039](adr/0039-git-backed-operation-reviews.md). Focused native/SDK/mounted tests
are not full browser, deployment or migration acceptance.
