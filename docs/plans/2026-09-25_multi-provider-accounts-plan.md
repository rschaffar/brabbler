# Multiple model-provider accounts

## Goal

Authorize several identities for the same model provider and select the credential independently for each Pi Web session, with a project-wide default for **new** sessions. An existing session never silently follows a changed project default.

## Context

Pi currently stores one credential per provider in `~/.pi/agent/auth.json`. The SDK accepts an injected `CredentialStore` through `ModelRuntime.create({ credentials })`, and session services accept an injected `ModelRuntime`; OAuth refresh invokes `CredentialStore.modify`. Live wrappers retain their runtime, so changing a global active credential would mix concurrent sessions. Project identity from `resolveProject(cwd)` groups linked worktrees. `pi-web:tool-selection` custom entries are the precedent for session-specific metadata. This plan does not change Pi CLI's auth file or Pi Web's browser password.

## Architecture

Keep the existing `auth.json` credential as the named *Pi default* choice. Store additional accounts in a Pi Web-owned, permission-restricted file under the agent directory, with opaque IDs, provider IDs, human labels, credential types, and credentials. Never return credentials to browsers. Use serialized, locked modifications for independent OAuth refreshes and account writes; do not expose secrets in logs or errors. Persist project defaults keyed by canonical `projectRoot`, outside project repositories. Persist a versioned `provider → account ID` snapshot as session custom entries at creation; absent entry on an old session means Pi default, not the current project default. Bind an account-aware credential-store view before constructing a session's model runtime. A bound but deleted/unavailable credential fails closed, including when ambient credentials are available. Subagents inherit their parent's runtime. Forks/clones inherit the binding stored in copied session history (or explicitly copy it when forking before the entry).

An idle-session switch appends a new binding and replaces its wrapper before the next prompt; it must reject running sessions. Avoid a separate mutable process-global active account. Continue using the existing provider/model identity for catalog and model scope. Existing provider-wide auth routes remain compatible for the Pi default identity.

## Non-Goals

- Multiple Pi Web users or a multi-tenant server.
- Changes to Pi CLI's credential format or default account.
- Automatically changing existing sessions after a project-default change.
- Publishing or remotely synchronizing credentials.

## Resolved unknowns and verification gap

- `lib/provider-accounts.test.mjs` exercises the pinned SDK's `ModelRuntime.getAuth()` with a selected account, then removes it and verifies that auth rejects instead of using Pi default. `ModelRuntime.create()` also accepts a pending account only for account authorization.
- The chat composer exposes account management, project defaults and session selection; secondary OAuth uses the existing SSE login route with an account-bound credential store and its manual-code callback protocol.
- A real external OAuth callback/device-code flow has not been exercised without a live provider account. Account-scoped OAuth cancellation and an actual provider's refresh still need an integration test or operator verification.

## Plan

- [x] Implement a versioned, locked account store and project-default mapping under `lib/`; `lib/provider-accounts.test.mjs` covers permissions, malformed data, concurrent account modifications, metadata-only listing and linked-worktree project identity.
- [x] Implement session selection entries and project-default resolution; `lib/session-accounts.test.mjs`, `lib/rpc-manager.test.mjs` (fork/clone) and `e2e/run.mjs` (snapshot and transient switch) cover legacy and new sessions.
- [x] Inject session-bound credential stores into `ModelRuntime` in `lib/rpc-manager.ts`; `lib/provider-accounts.test.mjs` covers same-provider isolation, SDK auth and deleted-account failure; `e2e/run.mjs` covers wrapper recreation and simultaneous switches; `lib/subagent-runtime.test.mjs` guards subagent inheritance wiring.
- [ ] Add account management and OAuth/API-key authorization routes under `app/api/auth/`; metadata redaction, capability rejection, invalid OAuth account and legacy routes are tested, but real account-scoped OAuth callback and cancellation are not verified.
- [x] Add a project-default selector, session selector, and account-management UI; `e2e/run.mjs` covers idle switching, displayed unavailable accounts and explicit recovery; `lib/rpc-manager.test.mjs` covers busy rejection.
- [x] Document storage, precedence, deletion behavior, and the distinction from Pi CLI auth in `README.md`, `AGENTS.md`, and `docs/adr/0006-provider-account-binding.md`.

## Rollback / Recovery

Leave `auth.json` untouched by added-account operations. The new Pi Web account file is additive; disabling this feature leaves the Pi default usable, but sessions pinned to extra accounts should report a missing account rather than silently falling back. Do not delete a user's account file to roll back; retain it until explicit removal is requested. Back up and validate any future schema migration before replacing data.

## Completion Checklist

- [x] Run focused account/session/auth tests, `npm test` (1,314 passed), `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e` (account APIs, browser selection/deletion and existing flows passed using NixOS-provided x86-64 shared libraries for Playwright). Browser scroll restoration intermittently failed in earlier exploratory runs; the final run passed after isolating new selector tests from existing navigation tests.
- [ ] Review secret exposure and isolation tests, and verify the exact feature commit; leave remote operations and integration for separate approval.
