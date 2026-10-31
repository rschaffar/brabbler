# ADR 0039: Git-backed operation reviews

- Status: Accepted direction; reader/metadata foundation and P2 host/producer
  integration independently reviewed on the feature branch with focused checks.
  Full viewer/API wiring, connected-solution review, migration and deployment remain pending.
- Revises: ADR 0018's permanent, repository-independent patch archive when the new
  producer is activated; preserves its size-independent approval scope.
- Execution owner: [Git-backed operation reviews plan](../plans/2026-10-31_git-backed-operation-reviews-plan.md).

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

Use an explicit offline converter, with dry-run reporting, verified backups,
exact-file installation/recovery and native synthetic tests. Preserve recoverable
comparisons and recorded outcomes; mark missing content unavailable without
inventing original repository identity or cross-branch result facts. Do not
reconstruct missing Git history from old patches.

Legacy decoding belongs only to the temporary converter, outside the application
runtime dependency graph. After verified real conversion, remove the converter
in a separate change, leaving its tested historical revision and invocation in
the migration guide. Old-store deletion and backup disposal require separate
bounded authorization. Unmigrated cards retain their outcome and an unsupported
review placeholder; no production legacy bundle service remains after cutover.

## Consequences and current boundary

Session-only backups preserve review identifiers and outcomes, not Git content.
Ordinary repository backups and Git object retention determine historical diff
availability. Whole-repository moves/replacements can require an explicitly
admitted offline mapping or leave the view unavailable; saved paths are not access
permission.

P2 replaces new Git bundle production with hidden structured metadata, small v2
references and immutable linked settlement. Session save barriers and existing-owner
standalone persistence precede publication; failed final reporting cannot repeat a
native effect. Legacy decoding is no longer imported by production hosts/APIs.

This is not the finished viewer cutover: operation attachments/API materialization
are explicit pending placeholders until P3 reconnects the retained shared viewer.
The [schema/API map](../git-operation-review-metadata.md) names current exports and
unavailable legacy descriptors. No existing state has been converted or removed;
legacy codec relocation/package retirement, complete acceptance, connected-solution
review and operational authorization remain open. Do not advertise a finished rollout
from focused P2 evidence.
