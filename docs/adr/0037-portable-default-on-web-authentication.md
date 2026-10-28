# 0037 — Portable, default-on web authentication

## Status

Accepted for implementation by the release owner; verification remains tracked in
[the release plan](../plans/2026-10-28_public-release-plan.md).

## Decision

Brabbler requires web authentication by default, even on loopback. Missing setup
returns a locked/setup-needed response; enrollment remains local controlling-TTY
`brabbler auth setup`, never first-visitor browser enrollment. Preserve the existing
version-1 salted scrypt verifier and independent random cookie-signing key.

Use Node's filesystem/crypto APIs on Linux and macOS. Private owned directories,
single-link regular private files, no-follow file opens, bounded reads/KDF work,
cooperating-writer locks, exclusive staging and atomic publication remain. Resolve
aliases above the configured agent-data directory so system home/temp aliases are
usable; the agent directory and private application directories remain physical.
Remove the auth store's Linux-specific `/proc/self/fd` directory pinning. This is
not a sandbox against malicious same-user filesystem replacement or a compromised
host. Check/use races involving such an actor are outside this credential-store
threat model. Atomic visibility is distinct from power-loss durability.

`brabbler --no-auth` (or explicit `BRABBLER_NO_AUTH=1`) bypasses password admission
without reading or modifying saved credentials. Warn prominently on every bind;
the operator may explicitly use a non-loopback address. There is no implied trusted
network or confidentiality. Default bind remains loopback. Invalid flags and a
bypass conflicting with `BRABBLER_REQUIRE_AUTH=1` fail closed. The legacy value
`BRABBLER_REQUIRE_AUTH=0` alone does not disable the new protected default.

Home Manager defaults `requireAuth` to true. Explicit false emits the deliberate
no-auth startup flag; a stronger required-auth setting must not silently lose to
an opt-out. Maintained npm entry points use the same policy as the installed CLI.

No-auth mode supplies no session-signing key or artificial signed cookie. Browser
SSH key management continues to require genuine web login; it is unavailable in
no-auth mode. Host/Origin/CSRF checks, request-header guard, file authorization,
Git policy and plugin approvals are unchanged. Password mode still needs HTTPS
or a trusted encrypted transport beyond loopback.

## Consequences and verification

Existing credential records need no migration. Default-on admission is an
intentional operational change; fixtures must explicitly select no-auth rather
than rely on absent credentials. Existing credential/environment conflicts,
rotation/revocation, hidden input and error boundaries remain tested.

Linux acceptance does not certify macOS filesystem/TTY/native-terminal behavior.
The exact release tarball also needs the hosted macOS smoke check described by the
release plan; publication and remote execution retain their separate approvals.
