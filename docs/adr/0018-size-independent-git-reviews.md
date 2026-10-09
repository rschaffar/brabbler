# ADR 0018: Size-independent Git operation reviews

- Status: Accepted; implementation verified on the feature branch (integration/deployment separate)
- Revises: ADR 0016 receipt presentation and ADR 0017 inventory resource budgets

## Context

A 1,476,834-character merge patch exceeded the generic card's 1,000,000-character
limit. Mandatory receipt validation rejected both Ask and Allow before Git ran.
Increasing that limit would expose the next 2 MiB subprocess limit and multiply
patch storage across every receipt stage. Presentation capacity must not decide
whether an otherwise supported operation can execute.

## Decision

Keep operation identity, authorization and exact-state revalidation separate from
bounded display. New Git cards reference a host-owned immutable review bundle.
The bundle records exact arguments, selected resources, message, checks, captured
comparison/fingerprint and the supplied presentation, followed by every raw Git
file-patch block. Byte framing preserves binary and pathological long-line patches
without parsing the whole diff. Later stage receipts repeat compact references,
not raw patches. Their authorization and outcome semantics remain unchanged.

The private `pi-web/reviews/` store publishes only completed, hashed bundles after
file synchronization and atomic directory rename (directory synchronization where
supported). Data, metadata and fixed-width entry indexes are integrity-bound.
GET validates a reference in the requested session's saved operation or interaction
receipt, including a prepared receipt; a live wrapper or approval is not required.
GET never accesses a checkout or authorizes an effect. Initial reads verify content
with bounded buffers; a bounded cache retains only verified filesystem identities.

The UI loads small patches (within a 256 KiB review bundle) using existing shared
review controls. Larger bundles use 40-entry pages and 256 KiB raw content pages;
individual small patches still use the shared renderer. Exact complete reviews,
complete patches and individual entries are downloadable as streams. Preview
failure does not remove the action footer. Approval always covers the entire
captured operation, never just visible content. Existing inline receipts remain
readable. Optional full-file context retains its existing availability rules.

The store is independent of cwd and creator-session paths. Copies of receipt
references authorize access through surviving forks; moves need no attachment
rewrite. Published bundles have no TTL or automatic deletion, including orphaned
bundles after interrupted preparation. Unpublished scratch is removed by its
writer. Session deletion revokes that session's read path, not another session's
copied references. A future garbage collector must trace every retained session
and branch; it cannot delete by creator or age. This initial retention choice
trades disk reclamation for not silently losing historical evidence.

Git preparation uses asynchronous streamed status/attribute/index reads and
pathspec files rather than fixed output or selected-file count ceilings. Captured
trees/refs are revalidated without regenerating the diff. Required checks drain
output while retaining a bounded display tail; optional `timeoutMs` is explicit,
with omitted/zero meaning no deadline. Cancellable processes receive termination
and escalation; native Git writes do not inherit cancellation/deadlines. Failures
never claim an uncertain process or native effect was rolled back.

Cleanup removes arbitrary root-count and cumulative scan-size/time ceilings, but
not validation. Inventories still read complete content/metadata, freeze roots,
and revalidate remaining resources between effects. Large directory sorting spills
to private scratch with bounded sort buffers. Complete source-name indexes and
explicit selected-resource metadata still require memory proportional to their
counts. Preparation yields, reports progress and supports cancellation. Filesystem
capacity, changing content, denied authority, source/mount/link protections and
managed-directory admission can still refuse operations. External writers remain
uncoordinated; partial effects stay explicit.

## Consequences

This is not unlimited hardware, unrestricted Git support or an authorization
bypass. Insufficient storage and failure to persist trustworthy review/receipts
still block pre-effect execution. Read-only review errors leave exact operation
scope and existing action permissions intact. No deployment, remote operation,
integration or cleanup authorization follows from this decision.

Review attachments are not in model context or SDK HTML export. Backups that need
complete new operation reviews must include `pi-web/reviews/` beside session JSONL.
Older application versions cannot render the new attachment UI; legacy inline
history is unchanged. Do not remove published attachments during rollback.
