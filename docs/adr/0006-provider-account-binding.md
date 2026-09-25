# 0006 — Bind provider credentials to sessions, not a global active account

## Status

Accepted.

## Context

Pi's `auth.json` holds one credential per provider and is shared with the CLI. Pi Web needs several identities for the same provider without changing that shared credential or allowing two concurrent sessions to use each other's identities. OAuth access tokens may refresh during a request. A linked worktree belongs to the same project as its main checkout.

## Decision

- Keep pi's normal provider auth (`auth.json` plus its ambient sources) unchanged as **Pi default**. Pi Web stores additional, labeled credentials and project defaults in its own owner-readable/writable file under the agent directory. Project defaults use `resolveProject(cwd).projectRoot` rather than the worktree cwd.
- Every new session snapshots the project's provider-to-account map in a versioned custom session entry. A session with no entry is a legacy session using Pi default, not one that follows today's project default. A project default change affects only sessions created afterward. Forks, clones, and subagents carry the parent binding, including when the copied history omits the original custom entry.
- The SDK `ModelRuntime` receives a session-bound `CredentialStore` before services and extensions load. The store delegates unbound providers to Pi default, reads each bound provider only from the specified account, and serializes account changes and OAuth refreshes under a file lock. A deleted, missing, or unauthorized bound account **fails closed** rather than using an environment variable or `auth.json`.
- Changing an idle session's account appends a complete new selection and rebuilds the wrapper. Session switches are serialized by session ID; prompts wait for a switch before using the wrapper. An active session cannot switch. An initialized unsaved composer preserves its model, thinking level, and tools when it is replaced.
- Account metadata APIs never return credential values. The existing provider-wide login/logout routes continue to manage Pi default; additional accounts have account-scoped authorization routes.

## Consequences

- Existing sessions and the CLI keep their old behavior. Secondary accounts are Pi Web-only until explicitly selected, and existing sessions do not change when a project preference changes.
- `GET /api/models` must use the selected session or project account snapshot and bypass its cwd-only cache for account-bound requests. A provider usage panel in the Models settings still describes Pi default, not a secondary chat-session account.
- The additional account file contains live credentials and needs the same care and backup policy as `auth.json`; session files contain opaque IDs only. Removing an account does not rewrite prior sessions, which will show it as unavailable until explicitly switched.
