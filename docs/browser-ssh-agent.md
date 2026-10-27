# Process-wide SSH agent and browser signing

**Settings → SSH** selects one agent for this Brabbler runtime. The sidebar shows
the effective backend and pending count; signing cards are global and nonmodal.
The [completed implementation record](plans/archived/2026-10-22_process-wide-ssh-agent-plan.md) records
verification and retained failures. [ADR 0033](adr/0033-process-wide-ssh-agent.md)
supersedes the former manual-export/session-binding workflow.

## Select an agent

Supported installed and npm dev/start launchers create one private, stable
`SSH_AUTH_SOCK` **before** starting Next and its descendants. First startup is
**No agent / SSH setup needed**, never the inherited system agent automatically.

1. Open **SSH** and choose Browser agent, Startup system agent, a discovered
   endpoint, a named custom socket, or No agent.
2. Review the draft and click **Use agent**. Saving a custom entry alone does not
   select it. Refresh reconciles uncertain outcomes; mutations are never retried.
3. Existing inheriting shells, sessions, helpers and PTYs retain the same socket
   pathname. Future requests follow the effective choice. Pending work stays at
   its originally admitted backend/key; stale channels retire after bounded drain.

Selection is process-wide, not project/worktree/session-specific. A remembered
unavailable backend fails closed without substituting a host or standby identity.
An unsuccessful/uncertain save must be reconciled against **Current agent**, not
assumed to have left the old choice unchanged. Established SSH connections and
already-returned signatures are not revoked by switching.

Discovery happens only on opening SSH Settings or **Refresh agents**, using
bounded known locations and identity-only probes, not filesystem crawling. It
may activate a socket-activated agent. Closing Settings cancels its discovery
admission; already-started server probes remain bounded. Results are snapshots;
passive endpoint presence is not proof of usability. Dynamic selector aliases
can change externally. Brabbler never edits the host's selector, loads external
keys through this UI, or stops external agents.

Explicit environment exports, SSH `IdentityAgent` and deliberately isolated
helpers remain separate. Native MCP retains its explicit environment allowlist,
not automatic ambient SSH access. **No agent is not an SSH prohibition**: private
key files and other authentication methods may still work.

## Requirements

- Unix sockets (Linux/macOS server), writable private runtime/state directories,
  and socket pathnames within 100 bytes. Windows server sockets are unsupported.
- Configured local CLI authentication (`brabbler auth setup`) or explicit `BRABBLER_PASSWORD`, and a signed web login. Basic/API authentication
  alone cannot manage SSH. Exact same-origin/public-Host checks apply.
- Browser signing needs a secure top-level DNS origin: trusted HTTPS or
  `http://localhost`, not an IP literal. Native selection/status also works on
  loopback IPs. Reverse proxies must preserve public Host and browser Origin;
  do not broaden trust or rewrite Origin to bypass checks.
- A browser exposing ES256 WebAuthn public keys and a cross-platform P-256
  authenticator with user verification. Enrollment requests a security key, not
  a platform passkey. PIN/private-key custody remains outside Brabbler.
- **Browser-agent consumers need OpenSSH 10.3+ or the compatibility backport.**
  Older clients may verify signatures yet reject agent-returned WebAuthn ones.
  See the [upstream fix](https://github.com/openssh/openssh-portable/commit/15fe1ceb29760d72398c6ac7df5a403416cba207).
  Destination software/service compatibility is separate. This minimum does
  not apply merely to selecting a conventional external agent.

Existing `ssh:` application credentials and Ed25519-SK keys cannot be reused
through standard browser WebAuthn. A separate credential is required, even on
the same physical token. Its SSH application is the hostname/RP ID, not `ssh:`,
a URL or a port; Brabbler additionally pins the exact origin, including port.

## Register keys and connect devices

1. **Enroll security key** with a name and immutable policy. Default is
   **Verify every signature** (UP+UV). Session mode requests a touch-compatible
   credential policy. Unsupported combinations fail, never silently weaken.
2. Creation is followed by a **separate fresh verified possession proof** before
   central public registration. Only public metadata is saved server-side.
   Credential protection/discoverability are reported data, not attestation or
   proof of hardware provenance, custody or non-exportability. Unreported
   protection requires explicit application-only acknowledgement.
3. Select a registered key and device name, then **Connect and make this browser
   active**. This requires fresh verification but does not select Browser agent
   as the routing backend: **Use agent** remains a separate explicit action.
4. Copy the public key from **Key details** and authorize it through your normal
   destination administration. Brabbler does not install keys or configure Git
   signing identities. Keep a separate recovery identity.

There can be multiple registered keys and connected devices but only one active
browser signer. Takeover leaves the previous device standby; selecting it later
uses only its remaining grant time. Disconnect does not activate another device.
Another browser discovers central public keys but needs its own login, exact
connection and possession proof; capabilities are not shared in status responses.

## Review and approve

Start an operation, then use the global card's **Review → Approve with security
key** or **Deny**. Arrival does not focus the card, open Settings or replace a
composer/terminal draft. Closing Settings leaves the signer connected. Optional
local notifications contain no request details; clicking focuses/reviews only a
still-live owned request, never signs or reconnects. Delivery may be unavailable
on browsers requiring service-worker notifications; suspension is not prevented.

Descriptions are parsed from **untrusted request bytes**. A request fingerprint
identifies those bytes, not the SSH hostname, host-key trust, document contents
or Git intent. Approve only an operation you initiated. Authentication and SSHSIG
(including Git signing) are supported; arbitrary raw/PAM challenges are not.
Browser agents reject key mutation/provider loading and unsupported extensions;
they do not acknowledge destination constraints as enforced. Do not forward this
socket to untrusted processes or machines. External backends preserve their own
protocol/constraint semantics instead of receiving browser policy substitutions.

### Optional 30-minute application unlock

Session-policy keys may explicitly unlock after fresh UV, optionally during
connection. The server owns a fixed, monotonic **30-minute maximum**, scoped to
that exact live connection/key/origin. Activity, signing, concurrent approvals,
ordinary backend switching and standby selection never extend it.

A locked **Unlock and approve** uses **two sequential ceremonies**:

1. Fresh server-random, one-use UV proof, bound to the live request/connection.
2. Separate user-presence signature for the original raw SSH payload.

A live grant skips the first ceremony without renewing time. Payload assertions
never create/renew grants: identical SSHSIG payloads can repeat, so their UV flags
cannot establish fresh unlock verification. Raw-payload assertion replay remains
a protocol limitation, not a way to reopen an application grant.

Every signature still requires presence; browsers/authenticators may also demand
verification. This is not PIN caching or a touch-only guarantee. **UP-only cannot
satisfy a destination's `verify-required` policy**; Brabbler does not relax it.
Cancelling the second ceremony denies signing but does not undo an already
completed unlock—use **Lock**. Lock/revocation cancels affected pending approvals;
ordinary handoff preserves already-admitted ownership and remaining time.

## Disconnect, revocation and metadata recovery

**Disconnect / cancel**, key removal, connection loss, restart and expiry revoke
application authority. Pagehide attempts disconnect; the ten-second server lease
also expires missed heartbeats. Background throttling, sleep and network loss
can expire it. Reconnect is explicit, gets new authority and cannot revive a
grant. The launcher-owned front socket remains stable. Physical token removal
and OS screen lock cannot be reliably detected, nor browser PIN caches cleared.

Public local metadata is inert. Explicit import uses authentication and fresh UV;
**new imports are strict** with unknown protection explicitly acknowledged. An
already-registered record retains its immutable server policy: fresh verification
can acknowledge it after an uncertain response, without connecting/unlocking.
Revision/record-ID guards refuse stale recovery after removal.

New enrollment metadata is staged per credential, including an in-page copy if
storage fails. Generic legacy/staged originals are retained even after durable
acknowledgement so older tabs cannot erase each other's recovery. Inert hints
hide duplicates only while current server status confirms the exact record,
origin and public credential. Malformed/unsafe data is reported, never guessed,
erased, or converted into authority. Resolve retained stages before enrolling
another credential; changing origin can leave read-only recovery items.

Removing a central registration disconnects its devices and cancels approvals,
but does not erase the authenticator credential or revoke remote authorized keys.
Remove public keys at destinations/allowed signers to revoke remote access.

## Runtime storage and implementation

- Launcher: `bin/ssh-agent-launch.js`, `ssh-agent-router.js`, `ssh-agent-client.js`
  and `ssh-agent-lease.js`; private directories/sockets are `0700`/`0600`.
- Backend settings: `$PI_CODING_AGENT_DIR/ssh-routing/<listen-host-port-hash>.json`.
  Public credential registry: `lib/ssh-key-registry.ts`. Neither saves grants,
  private keys, PINs, signatures or live management capabilities.
- `lib/managed-ssh-agent.ts` owns connections, publisher epochs and grants;
  `browser-ssh-agent.ts` owns native browser sockets/bounds; enrollment/protocol
  modules verify original creation/assertion bytes and OpenSSH encoding.
- `hooks/useSshAgent.ts`, `SshSettings`, `SshSidebarButton` and `SshSigningCards`
  own the interface. `/api/ssh-agent` admits only authenticated same-origin
  management; there is no session binding or caller-provided unlock authority.
- Public socket inheritance is preserved while command environments omit server
  login/control fields. [Modular SDK subprocess hygiene](sdk-command-environment.md)
  covers twelve version-pinned targets at installation; startup checks read-only.
  Trusted Next workers retain their server environment. Arbitrary
  trusted in-process extensions are not sandboxed.

Settings/public saves use revision CAS and atomic durable writes. Post-rename
failure is uncertain acknowledgement, not permission to replay. A companion
`.json.lock` uses PID/nonce fencing, not an elapsed-time heartbeat takeover.
Known-dead recovery requires verified matching boot/PID-namespace context;
unknown/incomplete/foreign/reused PID state requires operator recovery. Confirm
the old owner stopped and preserve unfamiliar files—never recursively delete
state or select a fallback to bypass ownership.

Managed commands ignore legacy `$PI_CODING_AGENT_DIR/browser-ssh-sessions/`
markers immediately, even before setup; marker evidence is retained, never
replayed as routing authority. Explicit **Use agent** records the new setup.
There is no automatic legacy/historical-artifact cleanup. Rolling back deployment
is separate authorization: prepare No agent/disconnect and account for older
versions honoring retained binding markers rather than assuming a host fallback.

Limits include 32 registered keys, eight browser bridges, eight native clients
and four pending requests per bridge, 32 KiB browser frames/2 KiB signing payloads,
4 KiB clientDataJSON, 16 KiB HTTP bodies, 60-second sign requests and bounded proofs.
The front relay separately bounds 64 clients/256 KiB frames. Assertions and
capabilities stay out of chat, JSONL, interaction receipts and ordinary logs;
request-body logging/browser inspection can expose them and must be treated
accordingly. Compromised application code can solicit/mislabel signatures;
hardware custody does not make that code trustworthy.

## Verification and compatibility matrix

Use the [Nix acceptance contract](testing.md); focused selections are not complete
acceptance:

```sh
nix run .#test -- core --file lib/managed-ssh-agent.test.mjs --file lib/ssh-agent-router.test.mjs
nix run .#test -- e2e --group ssh-agent
```

Core uses synthetic P-256 keys, real Unix/OpenSSH clients, replay/expiry/ownership
negatives, native-agent constraints and child environments. Browser acceptance
uses real Chromium WebAuthn **virtual** USB authenticators and real SDK
Bash/Shell/PTY consumers at desktop/mobile sizes, not a live token or actual
remote SSH login. Exact receipts/failures belong in the [completed implementation record](plans/archived/2026-10-22_process-wide-ssh-agent-plan.md).

On 2026-10-22, `nix run .#test -- all --workers 4 --jobs 4` passed on candidate
`a500167eb6f0c28375bce286d3586d67471b06d5`, source digest
`67c896d25cc964ff28f405132f0e2e784d2359c0456e6ef488cb8f4e730dba0b`:
**427 core/static/plugin files, 3,258 tests, all 26 browser/terminal groups
(59 scenarios), and the genuine Home Manager deployment VM**. End-to-end runtime
was **637.732 s**, including preparation; package/dependency prerequisites were
warm from focused checks, while executions were fresh. This is acceptance of the
recorded inputs, not physical-device certification or host deployment approval.

| Target | Status |
| --- | --- |
| Chromium virtual authenticator, desktop/mobile viewport | Passed automated assertion chain; see completed implementation receipts |
| Firefox/Chrome on Linux with physical token | Unmeasured; separately authorized supervised verification |
| Firefox/Chrome on Android, USB/NFC and PIN/biometric UX | Unmeasured; separately authorized supervised verification |
| Third-party destinations, forwarding/nonstandard signing | Not certified; browser forwarding constraints/raw signing unsupported |

This guide owns the deferred supervised compatibility matrix. After fresh explicit
authorization, record exact browser/OS/key/firmware, USB/NFC transport, reported
protection/discoverability and observed UP/UV/PIN-or-biometric behavior. The user
enters any PIN; do not automate retries or alter token settings. An unsupported
combination remains unsupported, never silently downgraded. Browser maintainers
also own optional real notification-delivery/background-suspension measurements;
alerts promise neither wakeup nor continuous signing availability. Git signing-key
automation and remote destination authorization remain outside this feature.

Do not infer attestation, touch-only behavior, removal/OS-lock detection, native
mobile keyboard compatibility or hardware provenance from virtual tests. No
hardware access, live deployment, Git identity automation or publication is
authorized by this feature guide. The static demo's SSH section is deliberately
inert and issues no credentials, discovery, grants or signatures.
