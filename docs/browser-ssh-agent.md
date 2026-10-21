# Browser-backed SSH agent

The sidebar **SSH** button opens an optional SSH agent backed by a separate FIDO credential in your browser. The authenticator may be attached to a different machine from the Pi Web server. No native browser helper is required; the private key and authenticator PIN are not sent to Pi Web.

## Requirements and compatibility

- Pi Web on Linux/macOS with Unix sockets and a writable temporary directory whose socket path fits 100 bytes. Windows is not supported by this feature.
- A configured `PI_WEB_PASSWORD` and a signed-in browser. Basic/API authentication alone cannot manage browser agents.
- A secure, top-level page: trusted HTTPS with a stable DNS hostname, or `http://localhost`. For local use, open `localhost`, not the IP literal. A reverse proxy must preserve the public Host and actual browser Origin; rewriting Origin prevents correct WebAuthn verification. Do not broaden proxy trust to work around this.
- A browser exposing ES256 WebAuthn public keys and a cross-platform authenticator supporting P-256 and user verification (PIN/biometric). Registration requests a security key, not a platform passkey. Attestation is not requested: this does **not** establish hardware provenance or non-exportability. Backup flags are not proof of hardware custody.
- **OpenSSH client 10.3 or newer, or the agent-signature compatibility backport.** Older clients may support verification but reject WebAuthn signatures returned by an agent. See the [upstream fix](https://github.com/openssh/openssh-portable/commit/15fe1ceb29760d72398c6ac7df5a403416cba207). Destination software must support OpenSSH's P-256 security-key/WebAuthn verification; third-party SSH/Git services require their own compatibility checks.

Existing `ssh:` application credentials and Ed25519-SK keys cannot be reused through standard browser WebAuthn. You may use the same physical authenticator, but must enroll a new credential. Its SSH application is exactly the browser hostname (RP ID), not `ssh:`, a URL or a port. Changing hostname requires another credential; this implementation also pins the exact browser origin, including scheme/port.

## Use

1. Open **SSH → Enroll security key**, completing your authenticator's verification. Only the credential ID and public SPKI key are saved in this browser's local storage. If persistence is blocked, the page reports that metadata is available only for the current page lifetime.
2. Choose **Connect security key**. A fresh server challenge proves possession before publishing a private SSH-agent socket. Connection is never automatic after reload.
3. Copy **SSH public key** and authorize it on the destination through your normal administrative process. For OpenSSH destinations, consider the `verify-required` authorized-key option to enforce UV there too. Pi Web neither installs keys nor changes SSH trust.
4. Either copy **Terminal export command** into an existing server-side terminal, or choose **Use for selected session Bash** for an existing selected Pi session. The latter applies only to Pi Web's built-in Bash adapter and explicit `!` shell execution for that session. It does not replace a user-extension Bash owner, arbitrary extension/plugin commands, subagent environments, other sessions or the host's global agent selector.
5. Start your SSH/Git operation. Each request opens the SSH panel; review it and choose **Approve with security key** or **Deny signature**. Approval invokes WebAuthn with user verification required. Authentication and SSHSIG (including Git signing) are supported; arbitrary raw challenges, key mutation/provider loading and unsupported agent extensions are refused.

The displayed description is parsed from untrusted request bytes. The SHA-256 fingerprint identifies those bytes; it does not show or attest the SSH hostname, host-key trust, document contents or Git commit intent. Approve only a request you just initiated. The implementation does not validate `session-bind@openssh.com` or claim destination constraints. Do not forward the socket to untrusted processes or machines; forwarding is not made safe by a browser prompt.

## Disconnect, recovery and revocation

**Disconnect / cancel** aborts the current browser ceremony, closes this agent's clients/socket and fails queued requests. Closing or reloading the page attempts disconnect; a ten-second server lease (checked at least once per second) also expires missing heartbeats. Background-tab throttling, browser suspension, sleep or connectivity loss can expire the lease. Return to the page and reconnect explicitly; a reconnect gets a new capability/socket. Existing exported terminal paths must be replaced manually.

A session binding writes an empty, owner-only marker under `$PI_CODING_AGENT_DIR/browser-ssh-sessions/<session-id>` (normally `~/.pi/agent/browser-ssh-sessions/`). This stores no key, PIN, socket capability or signing payload. It prevents built-in session Bash from silently reverting to a host agent after browser loss or a Pi Web restart. The session remains fail-closed until you reconnect and bind again or explicitly choose **Clear selected session binding**. Filesystem errors/unsafe markers are errors, not permission to fall back. An active binding can be cleared only by its owning browser capability; an orphaned binding may be explicitly cleared by any signed-in browser. Losing the selected session does not automatically clear its binding.

Clearing a binding restores the ordinary inherited environment only for future Bash executions. Existing child processes retain their original socket pathname. Previously supplied signatures remain valid after disconnection.

**Forget credential metadata** removes the browser's local public metadata only. It does not delete a nonresident credential from the authenticator, revoke a destination's authorized key, or erase other browser profiles. Remove the public key from all destinations/allowed signers to revoke access. Keep a separate recovery SSH identity before experimenting.

## Security and implementation boundaries

- Each bridge is scoped to a random 256-bit capability, the exact web-login cookie identity and exact Origin. Capabilities live only in page/server memory and are never put in URLs or chat history. WebAuthn assertions are validated against original bytes, expected key, raw SSH payload, RP hash, Origin, UP and UV. No extensions are requested or accepted.
- Dedicated Unix directories/sockets use modes `0700`/`0600`. Same-UID processes and the Pi Web server remain trusted: socket access permits requesting signatures, not obtaining a private key. Other authenticated browsers cannot manage a live bridge without its capability/owner binding. They can explicitly recover orphaned session bindings as described above.
- Limits: eight bridges, eight native clients per bridge, four pending requests per bridge, 32 KiB agent frames, 2 KiB signing payloads, 4 KiB clientDataJSON, 16 KiB HTTP bodies, 60-second sign requests and a 65-second initial connection proof. HTTP requests are bounded to five seconds. Mutations and unknown extensions return agent failure; they are not acknowledged as enforced constraints.
- Signature requests/assertions are ephemeral and outside agent messages, session JSONL, interaction receipts and ordinary application logs. Browser/network inspection and explicitly enabled request-body logging can still expose signatures or management capabilities; do not enable such logging on this endpoint.
- Compromised server/browser code can solicit signatures or mislabel operations. Hardware key custody does not make compromised application code trustworthy. OpenSSH's signature format pins the RP application hash, not an exact origin/port policy at the destination. Use a dedicated SSH credential, not a login credential.
- This is an opt-in application feature, not a NixOS agent migration, deployment, security audit certification or automatic authorization to publish/use a real key.

## Verification

The common [Nix acceptance contract](testing.md) applies. Focused checks:

```sh
nix run .#test -- core --file lib/browser-ssh.test.mjs --file lib/browser-ssh-route.test.mjs
nix run .#test -- e2e --group ssh-agent
```

Core tests use synthetic P-256 keys, native Unix-agent clients and real `ssh-keygen` verification, including malformed/tampered assertions, ownership, marker errors, session environments and cancellation/teardown. The `ssh-agent` browser group uses native Chromium WebAuthn virtual USB authenticators at desktop/mobile sizes, real `ssh-keygen` agent signing/verification, denial, stalled-prompt cancellation, cookie/capability isolation, reload and reconnection. It does not use live credentials or hardware. Physical FIDO/PIN UX, actual SSH logins, third-party service compatibility and non-Chromium browsers remain separate supervised verification.
