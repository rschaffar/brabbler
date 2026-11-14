# ADR 0043: Explicit ignored-file disposal for integrated worktrees

- Status: Accepted through the user's scoped design decisions and implementation request
- Revises: [ADR 0017](0017-cleanup-artifact-approval.md) and
  [ADR 0019](0019-nested-cleanup-artifacts.md), only their mandatory exact-path
  authorization for every ignored artifact

## Context

An integrated feature worktree can accumulate unpredictable ignored build outputs
and caches. Setting integrated cleanup to Allow still requires a second approval
when those paths are absent from the reusable exact-path allowlist. Users cannot
always enumerate them before work begins. Integration preserves committed history,
not ignored or uncommitted working files, so removing that prompt needs distinct,
explicit user authority rather than an interpretation of merge approval.

## Decision

Add the saved `ignoredArtifactPolicy` setting with conservative default `exact-paths`
and explicit opt-in `all-in-integrated-worktree`. It uses the existing global →
project → own-session override hierarchy and remains separate from workflow choices,
presets and `cleanupFeature` operation permission. Existing settings are not migrated
to broader authority. Agents cannot change this setting for themselves.

The opt-in permits permanent deletion of all safely supported ignored files and
directories only when `git_cleanup` removes a verified integrated linked feature
worktree. Eligibility does not depend on who created the worktree. Settings help and
execution cards warn that ignored local configuration and data may be lost and that
no recovery copy is made. Operation Ask still asks; Deny and cleanup Keep choices
remain authoritative. Merge approval grants no cleanup authority or scheduling.

Git's fresh ignored-path enumeration, not agent arguments or a familiar filename,
determines which exact selected roots receive this standing permission. Initial
capture freezes targets and their inventory. Effect-stage enumeration can recheck
ignored membership but cannot add targets or redefine structural parents. Unignored
untracked files block this whole-removal mode even when explicitly listed as artifact
roots or named in the reusable allowlist. Tracked changes always block removal.

Artifact-only cleanup, strict `removeWorktree`, and browser manual discard do not
inherit the new permission. Their exact-path and live-confirmation behavior stays
unchanged, including manual confirmation even under browser Allow. The exact reusable
allowlist and one-time artifact approval remain available without this opt-in.

Relevant-setting changes invalidate waiting/undispatched cleanup. Integration/ref,
registration, physical identity, inventory, source, mount, nested-repository,
literal-path, symlink, active-use and managed-directory protections remain. Unsafe
or unsupported contents cause retention and a concrete report, never a force-removal
fallback. Authorization and partial/completed outcomes remain separate durable facts.

## Consequences and limits

With explicit ignored-file authority, cleanup operation Allow and resolved removal
choices, routine cleanup needs no second click after a merge. The change does not
enable those settings or deploy itself. Global permission deliberately covers eligible
worktrees in repositories inheriting it; project scope is the narrower alternative.

Ignored status is not a generated-data or secret classifier. Users opting in accept
loss of ignored local data, including data ignored through standard external Git
ignore rules. No backup, archive, automatic session relocation, remote deletion,
rollback or retry is introduced. Existing conservative filename/type restrictions
still apply. External filesystem writers remain uncoordinated; this is neither an
atomic filesystem snapshot nor an OS sandbox. Disabling the setting changes future
authority but cannot recover already deleted ignored data.
