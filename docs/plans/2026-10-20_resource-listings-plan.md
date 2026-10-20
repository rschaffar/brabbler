# Lighter resource listings

## Goal

Reduce repeated extension execution for settings/provider and skill listings without changing session/account/catalog ownership or loaded-skill content authorization.

## Context and Plan Relationship

User authorized implementation after a read-only assessment and chose to retain explicit session Reload for extension-code updates. Start: `rst-main` `1fe0a04c2d6d11e0c301457e379289d3a61f1508`; branch `perf/resource-listings`, linked worktree `/home/robert/projects/3rdparty/pi-web-worktrees/resource-listings`. Parent is sole writer/export/test coordinator; independent reviewers are read-only. CodeGraph initialized successfully.

Adapt cached upstream `feb40f6354704cf987739247ace0b872b7300c83`, with corrected test timeout ownership from `74e6722a`. Prior 2026-10-20 ports remain intact. Idle ModelRuntime refresh and MCP UI have separate assessments and are excluded. No remote operations, live providers/credentials/session data, installed-service probes or host activation. Preserve SDK 1.3.0, Node 24.21.0, Next 16.4.2 and immutable dependency inputs.

## Architecture and Risks

- Fresh skill loaders skip extensions; no skill-result cache. Keep trust resolution, annotations and exact current membership for content authorization.
- A separate Pi-default, explicitly project-excluded settings runtime shares construction for ten minutes and serializes each offline refresh plus detached projection. Session/account/auth/network-refresh builders remain private. `/api/models` caching and account bypass remain unchanged.
- Enabled-model edits operate once on detached catalog data with fresh request-specific settings; never replay mutations on cache invalidation.
- Structural invalidation owns only the agent-directory listing scope. Existing model-response invalidation remains separate. Plugin attempts invalidate before/after effects; ambiguous failed parallel SDK updates disable retention for that scope until process restart, without claiming sibling settlement.
- Invalidation is not cancellation or SDK factory-cache flushing. Extension code updates retain explicit Reload; offline refresh can still execute extension-provider hooks. Resource resolution retains existing package behavior.
- No persistent migration. Reverting feature commits restores previous listing behavior. Retain failures and feature resources; integration/cleanup/publication/activation are separate lifecycle operations.

## Plan

- [ ] Implement extension-free fresh skill discovery; prove parity and content revocation with synthetic SDK fixtures.
- [ ] Implement isolated settings listing cache and deterministic ownership/queue/expiry/failure/invalidation regressions.
- [ ] Migrate provider and enabled-model listings; retain fresh settings and one-shot writes, account isolation and existing scope semantics.
- [ ] Wire plugin and both session reload invalidators; test failure paths and unchanged auth/runtime boundaries.
- [ ] Update owning guides and packaged browser fixtures; independently review and resolve findings.
- [ ] Run focused Nix checks, then complete fresh `nix run .#test -- all --workers 4 --jobs 4` if admitted; record exact inputs, commands/results, artifacts and timing.
- [ ] Commit coherent reviewed work and hand the verified candidate to the Git lifecycle for completion choice/exact-state non-FF integration into local rst-main and separate cleanup.

## Completion Checklist

- [ ] Listing optimization verified without weakening account/trust/content authorization.
- [ ] Independent review and complete core/static/plugin/browser/terminal/deployment acceptance pass.
- [ ] Maintained guides own behavior; evidence and unexecuted lifecycle/deployment boundaries are explicit.
