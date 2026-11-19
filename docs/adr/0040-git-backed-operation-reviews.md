# ADR 0040: Git-backed operation reviews

- Status: Accepted; implementation, independent review and complete original
  acceptance are delivered and integrated. Old-history migration explicitly declined
  on 2026-11-19; temporary converter retired from current source. Current-runtime
  readability of converter-specific metadata is no longer a requirement.
- Revises: ADR 0018's permanent, repository-independent patch archive; preserves
  its size-independent approval scope.
- Maintained owners: [metadata/API](../git-operation-review-metadata.md),
  [historical migration guide](../git-operation-review-migration.md) and
  [retirement ledger](../git-operation-review-retirement.md). The
  [archived plan](../plans/archived/2026-10-31_git-backed-operation-reviews-plan.md)
  preserves implementation evidence.

## Context

Git already stores the immutable file versions needed to reconstruct a review.
A second permanent archive of raw patches adds storage and retention machinery.
The product accepts that historical diffs become unavailable when their repository
or necessary Git objects disappear. Permanent repository-independent recovery is
therefore not required.

## Decision

Keep the existing per-file diff viewer. Store exact comparison identifiers,
repository binding and operation details as hidden metadata in the session; the
standalone worktree manager uses its existing operation record instead. Stage cards
carry small references. Metadata is not model input or execution authority and
must not be copied into ordinary navigation/list/status response bodies.

Generate inventories, selected-file patches, full context and complete downloads
from the captured Git objects on demand, under independent host ownership/path
admission. Do not reconstruct a historical comparison from current HEAD, index or
working files. Branch movement does not change the recorded content. Local read
commands cannot execute external diff/textconv/fsmonitor helpers, fetch missing
objects, recurse through submodules or create storage/refs. Reads retain bounded
pages/previews and joined stream cancellation without an aggregate patch-size cap.

Pending commit reviews use the existing immutable candidate tree, not live staging.
Keep exact-state revalidation and operation permissions. A missing captured object
requires an unavailable/expired proposal, not silent regeneration under its old
approval. Session restart does not restore approval authority.

Completed cards default to a trustworthy recorded actual result. A differing
proposal is a small labelled alternative in the same viewer, not a comparison
dashboard. Equality compares changed file paths, old/new versions and modes, not
commit IDs or semantic patch equivalence. Unrelated unchanged files do not matter.
Uncertain/partial postflight observations cannot become proven result history.
A legitimate divergent integration is not itself an authorization violation.

There is no permanent patch cache, hidden retention ref, object archive or new
repository registry. An object identifier is not a retention promise. If one view
becomes unavailable, the other can still be displayed with an accurate label.

## Legacy history

The historical offline converter used dry-run reporting, verified backups,
exact-file installation/recovery and native synthetic tests. It preserved recoverable
comparisons and marked missing facts unavailable without inventing original
repository identity or cross-branch results. This is a historical contract, not
an application upgrade path. Reproducing conversion or reading its output requires
matching historical software; current code neither reconstructs missing history from
old patches nor interprets converter-only shapes as current review metadata.

Legacy decoding never belongs in the application runtime dependency graph. The
original sequence required verified real conversion before converter removal.
The maintainer instead explicitly declined migration and approved repository-only
retirement, accepting unavailable old diffs. The migration guide retains the exact
tested historical revision and invocation. Old-store deletion and backup disposal
still require separate bounded authorization. Unmigrated cards retain their outcome
and an unsupported review placeholder; no production legacy bundle service remains.

## Consequences and current boundary

Session-only backups preserve review identifiers and outcomes, not Git content.
Ordinary repository backups and Git object retention determine historical diff
availability. Whole-repository moves/replacements can leave the view unavailable;
the current reader accepts only originally captured bindings. Saved paths are not access
permission.

New Git operations save hidden structured metadata, small v2 references and immutable
linked settlement. Session save barriers and existing-owner standalone persistence
precede publication; failed final reporting cannot repeat a native effect.

The existing per-file viewer and read-only APIs use the registered Git provider.
Actual-result/proposal selection, unavailable states and bounded convenience state
retain the same renderer and approval scope. Legacy decoding and converter-output
support stay in the matching historical source, outside current runtime composition. The
[schema/API map](../git-operation-review-metadata.md) owns current interfaces.

This decision and repository retirement claim no live conversion, deployment or
data deletion. The recorded real-history rehearsal used a private copy and restored
it; source acceptance is not live execution evidence. Existing stores, backups and
private evidence remain retained under the migration guide's maintainer-owned
retention boundary. No operational migration obligation remains open.
