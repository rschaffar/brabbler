# ADR 0019: Exact nested generated-artifact cleanup

- Status: Accepted through the user's implementation request
- Revises: [ADR 0017](0017-cleanup-artifact-approval.md), only its top-level-path restriction

## Context

Session `01a11bed-6707-740e-bb50-a90b0d4b6438` completed local integration but
cleanup refused `src/meetings/__pycache__` as an unknown resource before approval.
Discovery discarded nested ignored paths, explicit selection rejected slashes,
and selecting `src` correctly refused tracked source. Permissions could not fix
this capability gap.

## Decision

Keep version-1 settings and `artifactRoots` compatible while accepting exact
slash-delimited worktree-relative files/directories at any depth. Validate every
literal component; reject absolute/traversal/backslash/empty-component paths,
Git-metadata aliases, duplicate/aliased/overlapping explicit roots and unsafe
filesystem resources. Enumerate exact spellings and require physical directory
ancestors. Selected roots must not contain or alias tracked source. Sharing an
exact tracked directory parent does not authorize that parent or its siblings.

Worktree removal preserves Git's exact ignored paths, without promoting children
to source parents. If Git reports a wholly ignored directory containing an explicit
child, show and inventory that exact ignored parent once in the live approval.
Validate the original explicit child's existence, spelling and regular type even
when discovery replaces it with its wholly ignored parent.
Artifacts absent from the user-owned allowlist still require one-time approval,
even under Allow. Allowlist matching is exact selected-root matching, never
implicit permission inherited from a parent. No defaults, globs, settings writes,
new permissions or receipt-schema changes.

Nested deletion holds captured ancestor identities using Linux no-follow directory
opens and `/proc/self/fd` paths through the destructive call. A substituted ancestor
symlink cannot redirect deletion to an outside target. Where those capabilities
are unavailable, refuse nested cleanup before approval; do not fall back to unsafe
path traversal. Top-level cleanup remains supported as before.

Inventory ownership follows exact selected subtrees. Structural ancestors are
frozen separately so empty generated-only parents survive artifact-only cleanup.
Source entry structure, contents, identities and modes remain bound. Store direct
artifact-parent size/timestamps separately: compare them strictly through approval
and before effects; after a completed child deletion, exempt only that child's
direct parent from those volatile-field comparisons. Unaffected directories and
remaining artifacts retain strict metadata checks. Every inventory still refuses
observed concurrent metadata changes within that scan. Never refresh the entire
source baseline after deletion or discover new artifacts during execution.

## Consequences and limitations

Python caches beside tracked modules can reach the same combined cleanup card as
top-level build/dependency artifacts. Existing allowlist entries retain their
meaning; agents need not edit settings to propose nested paths. Source, alias,
symlink, mount, nested-repository, active/caller/main-worktree and exact integration
protections remain. Internal artifact links are inventoried without following
targets. Partial effects remain explicit, with no force, rollback or hidden retry.

The parent-metadata exception cannot prove absence of transient metadata-only
activity after a completed deletion. External writers remain uncoordinated; the
remaining check/use races for selected leaves and recursive artifact contents are
not eliminated or advertised as an atomic snapshot. No deployment or cleanup of the original session's resources
follows from this decision.
