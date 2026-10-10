# ADR 0021: Bounded standalone project cleanup operations

- Status: Accepted direction through the approved project-worktree-manager plan
- Preserves ADRs 0014–0019

## Decision

Add one generic bundled-plugin project-action adapter and a no-chat operation host.
This is opaque action transport/audit storage, not a task framework. The Git
plugin alone validates cleanup payloads, policy and effects. Browser operations
use the existing executor, capture/effect engine, artifact authority, exact review
store, managed-use observer and directory reservations. An explicit executor
option unconditionally requires browser confirmation, even under configured Allow.
Preparing cannot dispatch cleanup; tools retain their existing Ask/Allow behavior.
Browser approval is recorded as user approval with configured-policy provenance.
No session overrides, fabricated session, private policy mutation or force removal.
Unignored untracked files block browser cleanup; no explicit artifact roots are
accepted. Idle chat history is warning-only; live starting/running sessions and
terminals block, as do main, invocation/source and target resources.

Authenticated same-origin routes authorize the selected physical registered
checkout through the shared file-access boundary. Related physical registered
checkouts of that admitted repository are deliberately admitted for browsing;
arbitrary paths and symlink aliases do not gain access. The operation saves a
physical project identity and surviving main checkout for historical authorization.
Removing the feature checkout or disabling the plugin does not remove reviews.

## Lifetime and persistence

A request UUID identifies one preparation in the private project-operation store.
Its canonical payload digest must match on duplicate lookup. A live in-process
operation owns its AbortController, confirmation promise and execution lifetime,
independently of HTTP requests. Prepare returns immediately; clients poll status.
Closing the dialog explicitly sends Stop. Disconnect alone cannot safely imply
cancellation, since a response may have been lost; pending reviews expire after
15 minutes. Stop rejects pending review or prevents undispatched steps, but native
effects settle without cancellation and reservations release only at settlement.
The process-wide live registry survives HMR. Restart never reconstructs authority:
unfinished persisted records become outcome-unknown/read-only, never replayable.

Records are private versioned JSON, atomically replaced and fsynced (including the
parent directory on supported platforms). Preparation, review references, decision
claims, authorization and executing intent are durably recorded before their
boundaries. A synchronous decision claim prevents duplicate approvals; repeat
identical decisions return status without replay, conflicting decisions refuse.
Prepared review IDs authorize reads only through that operation's saved reference;
review storage verifies integrity and supports paging/download independent of chat.
Relevant policy and repository state are rechecked by the existing executor.

The executing marker proves intent, not that a native effect occurred. Cleanup
also records dispatch intent and observed completed steps between effects. Failed
pre-effect writes refuse execution. A failed final write never implies rollback:
the live response reports persistence failure and saved history remains unknown
where settlement could not be observed durably. Records/reviews have no automatic
TTL deletion or historical cleanup. Reservations protect only this server's managed
activity, not external writers or other Pi Web processes.

## Read-only graph inventory

Inventory captures all local refs and NUL-delimited registered worktrees, then
optimistically revalidates them and physical identity. Detached, locked and missing
registrations remain diagnostics. Reads disable replacement/lazy-fetch/protocol
access, optional locks and fsmonitor, refuse grafts, and preflight filter attributes
before narrow status. Submodule status is ignored explicitly (no recursive project
command execution); the status DTO discloses this limitation.

Tip dates are committer dates, not filesystem/ref modification times. Containment
is graph ancestry; a shallow negative is Unknown. First-parent graph transition
into containment yields a merge commit's recorded committer date only, never the
actual time the target ref received commits. Ordinary/root transitions have no
recoverable integration date. Traversal is capped at 10,000 first-parent commits,
read subprocesses at 15 seconds and 8 MiB, and expensive row reads at concurrency
three. Budget failures are explicit unavailable/unknown results, not negative
containment or cleanup authority. Capture handles expire after 15 minutes or
restart; historical operation records do not depend on these display handles.
