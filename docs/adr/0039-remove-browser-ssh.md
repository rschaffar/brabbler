# 0039 — Remove browser SSH signing and managed agent selection

Date: 2026-10-31
Status: Accepted and implemented. Core/static/plugin, installed browser/terminal and genuine deployment VM acceptance passed; the [completed removal plan](../plans/archived/2026-10-31_remove-browser-ssh-plan.md) records the scope. Local integration and deployment remain separate operations.

## Decision

Remove the browser SSH feature instead of redesigning it. This supersedes ADR
0030 and the browser/managed-routing portions of ADR 0033. There is no browser
key enrollment, signing, receiver selection, unlock, request transport/polling,
SSH settings/sidebar/cards or management API, including in the static demo.

Remove the launcher-owned agent router/control sockets, persistent backend
selection, browser registration/recovery stores and legacy session-binding code
from the application. Do not retain compatibility endpoints or a disabled
illustration. The generic launcher keeps authentication checks, installed SDK
verification, request-header preload and child-process supervision.

Ordinary commands, helpers, sessions/subagents and PTYs preserve the native or
forwarded `SSH_AUTH_SOCK` supplied through their normal environment. Explicit
child environments and SSH configuration still win; native MCP keeps its existing
isolated allowlist. This is default agent inheritance, not interception of all
SSH traffic or a prohibition on private-key/other authentication methods.

Retain command-environment secret filtering, including the existing pinned SDK
patch. Filtering the retired private locator remains harmless defensive hygiene,
not a managed agent or a compatibility implementation.

## Rationale

Conventional agent forwarding already serves the intended workflow and existing
SSH identities. Browser WebAuthn needs a separate website-scoped credential and
adds origin, client/destination compatibility, native-prompt and browser-liveness
constraints. A push transport would not make a suspended browser available or
allow it to reuse existing resident `ssh:` credentials. Maintaining browser
ownership, grants, enrollment and recovery is not justified for this product.

## Operational consequences

The former managed No-agent startup default is gone: an intentionally inherited
native agent is available immediately under its own policy. Launch a service with
the intended socket/environment; a later unrelated SSH login does not update an
already-running process. Brabbler neither changes the host selector nor reconnects
forwarding. Forwarding carries signing authority and should reach only trusted
hosts/processes. Its loss prevents future signatures, not already-established
SSH connections.

Do not read, migrate or delete saved key metadata, authenticator credentials,
legacy markers or remote authorizations as part of removal. They become inert
application data; removal is not remote key revocation. Cleanup, host configuration,
service activation and any rollback remain separate operator actions. Browser-created
keys are not converted into native SSH keys.

## Verification boundary and assertion disposition

At base `fed9415359e3867a3c9bdd25801034d6e5c820ee`, all assertions in the removed
browser SSH client/protocol/enrollment/registry/router/lease/migration/signing/
notification tests and Settings fixtures belong exclusively to the retired
feature. Their obligations and desktop/mobile virtual-authenticator, skew,
handoff/unlock/recovery inputs are obsolete, not silently moved to mocks.

Preserve mixed authentication, subprocess, native SDK and PTY obligations.
`lib/next-launch.test.mjs` retains generic launcher/auth/wrapper/signal checks and
adds real synthetic native-agent inheritance without managed sockets.
`lib/sdk-command-env-launch.test.mjs` retains pre-spawn SDK refusal and trusted
worker environments. Existing main/subagent, command-secret and PTY tests remain.
`auth/local-cli-login-and-ssh-absence@en-desktop` preserves the former SSH suite's
CLI setup/confirmation/overwrite/corruption/throttle/Basic/cookie/rotation chain,
removes only retired SSH authorization assertions, and proves real browser login
and removed UI/API/client traffic. It has a new receipt, not the old complete-chain
identity. Live inventories retire the old SSH scenarios atomically; historical
acceptance records stay historical.

Complete verification still requires the common Nix core/static/plugin checks,
all remaining installed browser/terminal groups and genuine deployment VM. No
physical key, real forwarded agent, remote destination, host service or deployment
is required or authorized by this decision.
