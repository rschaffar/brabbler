# ADR 0016: Own-project session Git policy and workflow choices

- Status: Accepted direction by user; implementation tracked in the [plan](../plans/2026-10-08_session-git-policy-plan.md)
- Scope: Optional bundled Git plugin; ADR 0014 remains in force
- Revises: ADR 0015's settings hierarchy, not cross-repository operation support

## Decision

Resolve defaults → global → selected repository → session, but apply the last layer only when the selected repository, session's own repository, and saved session override's repository binding agree. Use physical common Git-directory identity so linked worktrees share policy. A session may operate in another repository, but none of its session overrides or home-project policy applies there. Session identity comes from SDK context for tools and a validated saved session header for settings routes, never model/browser-supplied ownership. Moves deactivate mismatched overrides; new IDs for forks/subagents do not copy overrides. Branch navigation does not rewind settings.

Keep workflow choices separate from action permissions. Every workflow choice supports Ask through the actual `ask_user` tool. Named presets replace only workflow fields in the explicitly selected settings scope and never change action permissions, checks or remote authority. Individual fields remain editable/resettable. Per-invocation target/method choices can answer Ask without modifying saved settings; configured choices cannot be silently replaced.

Expose current effective values and origins in the UI, a read-only `git_policy` tool and request-local plugin context refreshed for each model request. No policy snapshot is persisted as a user instruction, and settings are not reconstructed from compacted or branched conversation history. Tools independently resolve/recheck policy. Global disable remains authoritative. The harness is not an OS sandbox for shell access.

Workflow Ask is not an exact-operation approval. Applicable instructions must recognize the shared `pi-web:git-policy/v1` contract before saved intent replaces their mandatory questions. Exact-action Ask belongs to the tool card, not an equivalent preceding `ask_user` question. No settings change authorizes this implementation session to skip its current lifecycle.

## Consequences

Version-1 private settings accept an optional session map while retaining existing global/project overrides. Existing permission values retain their meaning; new workflow choices default Ask. Session settings are live server-side data, outside the transcript, and only authenticated settings routes write them. Invalid settings fail closed. No legacy Workflow store, task registration or permission-writing agent tool is introduced.

Both Ask and Allow persist generic append-only `pi-web:operation-receipt` stage snapshots outside model context, correlated to the operation, SDK tool call and any separate decision receipt. The newest on-branch snapshot owns the read-only card. Authorization provenance and observed execution are distinct; interruption without settlement remains unknown. Pre-effect persistence failure blocks effects, while post-effect reporting failure never implies rollback. The generic core knows no Git semantics.

`git_cleanup` has a separate default-Ask `cleanupFeature` permission and explicit feature/integration IDs. Generated roots require a user-owned permitted-directory setting with no defaults, not model-supplied names or ignored status. Bounded content inventories and exact resource revalidation authorize a single combined artifact/worktree/branch operation. A short-lived generic directory reservation excludes new managed activity during cleanup, not external writers. Unknown/changed resources block; partial effects remain explicit. Symbolic ref deletion and main/caller cleanup are refused. Target advancement alone is irrelevant while the pinned integration remains reachable. Original strict worktree removal remains branch-retaining and refuses ignored files; the standalone CLI is unchanged. Presets do not grant either cleanup permission or generated-root authority.
