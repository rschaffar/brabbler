# ADR 0017: One-time cleanup artifact approval and reusable file/directory allowlist

- Status: Accepted by user (2026-10-08)
- Revises: ADR 0016's setting-only artifact authorization; other boundaries remain
- Revised by: [ADR 0019](0019-nested-cleanup-artifacts.md), extending exact artifact paths below top level
- Implementation: [cleanup artifact plan](../plans/archived/2026-10-08_cleanup-artifact-approval-plan.md)

## Context

Ordinary development leaves both ignored directories and generated regular files.
The initial `git_cleanup` implementation required every artifact to be a directory
already named in user settings. In session `01a11bfd-8c1e-740e-bb50-a9129468b55c`,
cleanup stopped at `.codegraph` before presenting an approval, while `next-env.d.ts`
could not be authorized even by editing the allowlist. A safety refusal without a
usable approval path does not meet the integrated-worktree cleanup goal.

## Decision

Keep `artifactRoots` and the version-1 `approvedArtifactRoots` setting compatible,
but accept literal top-level regular files or directories. The reusable setting
is explicitly user-owned, with no default paths or globs. Agents cannot write it.

Worktree removal proposes top-level ignored artifacts server-side, including when
`artifactRoots` is empty. Explicit arguments may add generated paths. Discovery
is not a statement that ignored data is disposable: if any proposed artifact is
absent from the effective allowlist, the exact cleanup requires one live browser
approval, even if `cleanupFeature` is Allow. Ask needs only that same single card.
Approve covers the captured artifacts/worktree/branch together and never writes
settings. Deny/Keep and stronger repository requirements remain authoritative.

Receipts record effective Ask/user-approved authorization for the one-time case,
with the configured operation permission's origin retained in provenance. Missing
UI, rejection, cancellation or failed receipt persistence cannot authorize effects.
With all artifacts permitted, existing operation Ask/Allow behavior is unchanged.

Freeze proposed paths before approval, and revalidate remaining contents and
identities between effects. Do not discover additional paths during execution.
Unselected unignored untracked paths still block. Never promote nested ignored
files into a parent that sweeps in source. Tracked/dirty source, symlink roots,
mounts, nested repositories, special files, main/caller/active/locked/prunable
worktrees and changed resources retain existing protection. Internal links are
inventoried without following them. Bounded inventories, managed-directory
reservations, honest partial outcomes and no-force/no-rollback behavior remain.

## Consequences

A user can approve one cleanup without opening Settings, or explicitly permit
recurring artifacts such as `next-env.d.ts` alongside dependency/build directories.
No blanket ignored-file authorization, new permission-writing tool or persistent
approval grant is introduced. Strict standalone worktree removal, the CLI,
remote/publication boundaries and external-writer limitations are unchanged.
