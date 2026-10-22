# 0030 — Browser-backed SSH signing without global agent replacement

Date: 2026-10-21

Superseded in part by [ADR 0033](0033-process-wide-ssh-agent.md): process-wide routing, central public registration and per-key verification policies replace the conflicting decisions below. This document preserves the historical rationale; implementation progress belongs in the active plan.

## Context

A remote Pi Web browser should be able to supply SSH signatures using its local FIDO authenticator, without exporting a private key/PIN or requiring a native helper. Existing OpenSSH `ssh:`/Ed25519-SK credentials cannot be used through ordinary browser WebAuthn. OpenSSH defines a P-256 WebAuthn signature format; stock agent consumers need OpenSSH 10.3 or its compatibility backport.

## Decision

Enroll a dedicated cross-platform ES256 credential scoped to the exact browser hostname. Keep only public credential metadata in browser-local storage. Each explicit connection proves possession against a fresh server challenge and obtains an ephemeral private Unix socket. Management is scoped by a random in-memory capability, web-login cookie identity and exact secure Origin; Basic authentication is not browser management authority.

Implement the minimal identity-list/sign agent surface. Filter challenges to structurally valid SSH public-key authentication for this exact key and SSHSIG envelopes. Preserve raw WebAuthn bytes, require UP/UV and verify the exact origin/RP/challenge/signature before producing OpenSSH encoding. Refuse unsupported extensions instead of claiming destination binding or provider-loading support. No signature/prompt/assertion is stored in session JSONL or sent to the model.

Do not replace `process.env.SSH_AUTH_SOCK` or the operator's agent selector. Existing terminals explicitly opt in with an export command. Existing Pi sessions may opt their built-in Bash adapter and explicit shell execution into a bridge. Extensions/plugins, user-owned Bash overrides, subagents and other sessions are not implicitly bound. Changes apply to future executions, never retroactively to child environments.

Retain an empty per-session marker under the agent directory when binding. A marker is negative/fail-closed policy, never signing authority: after disconnection or service restart, built-in Bash refuses rather than silently reverting to a host key. Reconnect/rebind or explicit clearing resolves that state. Live bindings require their owner/capability for clearing; signed-in browsers may explicitly recover orphaned bindings. Filesystem errors and unsafe marker objects fail closed.

Bound sockets, frames, pending requests, bodies and deadlines. A short browser heartbeat lease fails closed on suspension or loss; reconnection is explicit, with a new socket/capability. Independent application signal cleanup disposes sockets and pending requests without replacing existing launcher/RPC/PTY handlers.

## Consequences

- The same physical security key may be used, but destinations must authorize a new SSH public key. This feature does not modify remote trust or deploy itself.
- Hardware provenance is not established without attestation. A compromised server/browser can solicit signatures; UI descriptions are not destination/document attestation.
- The browser origin is checked by the bridge, but OpenSSH's public key pins the RP application hash rather than exact origin/port policy. Use a dedicated credential.
- Native helpers preserving existing identities, forwarding/destination constraints, arbitrary raw signing, SSH CA management and automatic signing are outside this feature.
- Suspension may interrupt signing. A durable fail-closed marker can block all built-in session Bash until explicitly recovered, which is preferable to identity substitution.
- Virtual-authenticator/OpenSSH tests establish protocol and lifecycle behavior, not physical-device UX, real remote SSH login or third-party service support. Operational details and verification limitations belong in [browser SSH](../browser-ssh-agent.md).
