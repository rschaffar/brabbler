# Process-wide SSH agent routing and browser signing

## Goal

Give a Pi Desk runtime one stable, private SSH-agent socket from startup. All children that inherit its environment receive that socket; an explicit Settings action chooses its actual backend. Preserve the socket while switching between the browser-backed agent, a discovered/custom system agent, and No agent.

**Authority/status:** The user approved recording this implementation plan after a question-led design discussion. Implementation, hardware access, deployment, and publication are **not authorized by this plan**. No implementation steps below have executed. Planning starts from local `main` `e9e7510540298055389ad43cdb6c44b2b0739fe1` in `docs/process-wide-ssh-agent-plan`, worktree `/home/robert/projects/3rdparty/pi-desk-worktrees/process-wide-ssh-agent-plan`.

## Context and plan relationship

Current code provides one credential per browser connection, temporary sockets, manually selected session Bash bindings, public metadata in browser-local storage, and UV-required assertions. The inherited system socket is currently passed through the launcher. Existing terminals inherit the server environment, while old browser bindings override only selected Bash executions.

Relevant owners: [browser SSH](../browser-ssh-agent.md), [terminal](../terminal.md), [feature contracts](../feature-internals.md), [session contracts](../session-internals.md), [architecture](../architecture.md), [native tools](2026-10-21_native-session-tools-plan.md), [testing](../testing.md), and [ADR 0030](../adr/0030-browser-backed-ssh-agent.md). Active plans were searched for SSH/FIDO/WebAuthn/socket ownership; none owns this redesign. The native-tools plan owns MCP admission/environment isolation, not SSH routing; preserve that boundary. Acceptance scheduling/coordination remains with its existing guides and ADRs, not this feature.

**Visible retraction:** The earlier proposal for global defaults plus repository/worktree overrides was explicitly rejected in favor of one process-wide choice. Do not implement project settings, profile groups, or per-session agent selection. The browser agent is one pool with multiple keys and one explicit active signer.

This design intentionally replaces ADR 0030's no-global-environment-replacement, browser-local metadata, temporary-export/per-session-binding decisions, and its universally UV-required assertion policy. A follow-up ADR must explicitly supersede those parts before code implements them; do not silently rewrite the old decision as if it had always described this design. Preserve its private-key custody, origin/security, explicit approvals, bounded lifetime and no-transcript invariants.

## Agreed scope

| Area | Decision |
| --- | --- |
| Environment | One stable socket for the lifetime of a Pi Desk runtime, installed before inheriting application children start. Capture the original inherited backend first. No host-wide shell/systemd environment or external agent-selector mutation. |
| Execution | Sessions, subagents, terminals, supported Git operations and other helpers that actually inherit Pi Desk's environment use the managed default. Explicit overrides and deliberate environment sanitization remain boundaries, not targets for circumvention. |
| Backend choices | Browser agent; startup inherited system endpoint; reachable known-location system agents; explicitly named custom/forwarded socket paths; No agent. |
| Discovery | On opening the selector or Refresh; known locations, ownership checks and bounded public-identity probes. No filesystem crawl or continuous scan. A socket-activated service may start when probed; explain this. |
| Applying | Separate currently effective backend from a draft selection. **Use agent** explicitly applies/persists the choice. Handle failed and ambiguous saves without falsely claiming a successful switch or silently replaying it. |
| First use | No agent / SSH setup needed until the user explicitly chooses once. Do not infer a global identity from old per-session bindings. Ordinary non-SSH commands continue. |
| Restarts/failure | Remember the backend choice. Unavailable remains selected/unavailable; fail agent requests promptly. Never silently substitute another backend. |
| Switching | New operations use the new backend; already-pending signatures finish on their original backend/key within existing bounds. No transparent retry. Established SSH connections and returned signatures cannot be changed retroactively. |
| Browser keys | Centrally persist named public enrollment records. Any signed-in browser at the same HTTPS origin can prove possession and use a registered physical key. No private key, PIN or CTAP PIN/UV token is stored by Pi Desk. |
| Active signer | One explicit browser/key signer for the browser agent. A laptop may explicitly take over while desktop remains connected as standby. Do not broadcast requests or select the most recently polling browser automatically. |
| Per-key policy | Offer Verify every signature and Unlock session then touch. **Verify every signature is the enrollment default.** No silent weakening of an existing key. |
| Unlock duration | Session-unlock mode has a fixed 30-minute maximum, not extended by signing/activity. A connected standby browser retains only the remainder of its original unlock. |
| Lock | Explicit Lock, expiry, connection loss and restart revoke the app unlock. A connected-but-locked request offers **Unlock and approve**, requiring fresh UV and starting a new 30-minute window. No automatic approval. |
| Platform | Browser UX target: Firefox and Chrome on Linux and Android, using a consistent HTTPS hostname/port. Server socket feature remains Unix-oriented; do not claim new Windows support. |
| Signing UX | Compact non-blocking card, no typing-focus theft or forced Settings navigation. Review in Pi Desk, Approve, then FIDO. Opt-in background notifications are alerts only. |
| Settings | Dedicated SSH section, compact sidebar effective-backend/signer status and pending count, device-first browser management. Paths/fingerprints/diagnostics are advanced details, not required manual exports. |
| Deferred | Git signing-key automation/configuration, nonstandard agent signing such as pam_rssh sudo, native browser helper, SSH CA management and project settings. Existing compatible SSHSIG/Git signing remains possible but cannot substitute another key for a pinned Git signing identity. |

## Security and compatibility contract

### Verification is not PIN caching

WebAuthn exposes verification preferences, not a website-controlled PIN cache. Native CTAP PIN/UV tokens are not available to page JavaScript. UV may mean a PIN or biometric; do not promise a literal PIN prompt when the platform chooses another verified gesture.

- **Verify every signature:** Require and verify UP+UV on each returned assertion. Request appropriate `credProtect` protection where supported, inspect enrollment results, and report the actual capability. Do not claim hardware-enforced policy or hardware provenance from a UI label or an unverified extension request.
- **Unlock session then touch:** Establish a fresh UV-verified grant scoped to the exact key, browser connection/owner and origin. While it is valid, request UV discouraged and require UP on every signature, preserving all challenge/key/origin/RP/cryptographic checks. Check the grant again when accepting a response. Both policy enforcement and unlock state are server-authoritative; changing JavaScript or submitting policy flags cannot unlock signing.
- A locked-but-connected request can use a UV-verified assertion for its exact raw SSH payload to approve that request and establish a new grant, without generating an unrelated cached signature or requiring two ceremonies for one approval. Explicit Unlock without a pending request uses a fresh bounded challenge. Never persist grants or revive them through copied metadata, another login, reconnect, notifications or server restart.
- Use a server monotonic deadline for grants and return remaining duration for UI display; browser clock changes must not extend or prematurely terminate them. Switching to standby does not reset the deadline.
- Explicit Lock/removing a key/connection revocation cancels affected browser approvals and rejects late replies. This is a deliberate revocation, distinct from an ordinary backend switch that allows already-pending work to drain.
- This is **application-enforced unlock**, not a hardware PIN-once guarantee. A touch-capable credential used outside Pi Desk is not protected by Pi Desk's unlock gate. Authenticator `alwaysUV`, credential protection, browser policy and Android platform mediation may still demand verification. A newly required credential would have a new SSH public key and need destination authorization.
- UP-only signatures will not satisfy an OpenSSH destination's `verify-required` policy. Pi Desk does not modify remote authorized keys or relax destination requirements. The browser signature agent-consumer requirement remains OpenSSH 10.3/backport.
- The user explicitly accepted that browser APIs cannot reliably detect USB/NFC removal/reinsertion or OS screen lock. Do not promise immediate relocking on those events. Browser page/connection loss is enforceable; background notification delivery cannot guarantee a suspended Android browser remains available.
- Reject unsupported/malformed policy outcomes clearly; never silently enroll a weaker credential or label a PIN-requiring combination as guaranteed touch-only. A compatibility failure requires an explicit supported choice, not an automatic policy change.

Primary references reviewed during design: [Yubico UP versus UV](https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/User_Presence_vs_User_Verification.html), [WebAuthn request options](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialRequestOptions), [credential protection extension](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions#credprotect), and [native CTAP PIN/UV tokens](https://docs.yubico.com/yesdk/users-manual/application-fido2/pin-uv-auth-protocols.html). These establish API distinctions, **not measured compatibility with the user's hardware**.

### Routing and trust

- Install a private front socket with private parent-directory/endpoint permissions. Capture the inherited logical socket before overriding `SSH_AUTH_SOCK`; refuse direct/indirect routing back to the managed socket. Revalidate custom paths and symlinks at use, not merely discovery, while preserving deliberately selected dynamic system-selector behavior and labeling it as such.
- Expose selection/registry/active-device mutation only through authenticated, same-origin management. Do not expose management operations via the public agent protocol or pass management secrets to project commands. Same-UID processes remain trusted; a Unix pathname is not an unforgeable process authorization boundary.
- System backends should preserve their protocol semantics and constraints through a bounded relay; browser backends retain the limited web-safe SSH authentication/SSHSIG surface. No agent key-loading/removal/locking UI for external agents and no direct PIN/passphrase handling. No agent signing during discovery.
- A backend switch must not route a request for key A to key B. Snapshot the admitted backend/connection generation for in-flight exchanges, preserve upstream session-binding constraints, drain only already-admitted work, and retire stale idle front connections rather than allowing them to sign indefinitely with the old backend. A client that cannot reconnect may need an explicit command retry; never replay a possibly dispatched request.
- No agent means no offered identities/refused agent signing, not a prohibition of SSH or other authentication. `IdentityAgent`, private-key files and deliberately overridden environments can bypass this default. Keep the same distinction for an unavailable backend; do not claim all SSH authentication is disabled.
- Preserve provider/account isolation, project trust, Git permission gates and immutable-review semantics. Do not broaden MCP environment inheritance, Underwrap gates, isolated Nix test environments or external-service credentials merely to meet a blanket SSH claim.
- Keep requests/assertions/unlock capabilities outside model context, session JSONL, interaction receipts, ordinary logs and notification payloads. Request descriptions and caller/destination names are untrusted claims unless independently established. Only the owning original browser can complete its admitted WebAuthn request.

## Architecture and implementation map

- **Runtime bootstrap/owner:** `bin/pi-web.js`, maintained dev/start entry points, existing `bin/process-lifecycle.js` and `instrumentation-node.ts`. Establish exactly one owner before Next/SDK/helper children are admitted; route/API imports and production build workers must not start extra brokers. A launcher-owned broker with a private server management channel is a candidate, not a pre-decided second daemon architecture; close the ownership choice with an early synthetic spike. Socket identity is stable within the runtime, isolated from other Pi Desk instances, and retained across backend changes.
- **Settings/discovery/router:** new small server-side modules for a bounded versioned settings schema, atomically serialized edits, candidate discovery and managed agent routing. Persist backend descriptors/public key records, never live socket authority or unlock grants. Decide the runtime/persistence namespace early so concurrent Pi Desk instances cannot adopt each other's live authority or socket. Keep explicit startup-system aliases distinct from direct agent choices even if they currently resolve to the same socket.
- **Browser core:** evolve `lib/browser-ssh-agent.ts`, `lib/browser-ssh-protocol.ts`, `lib/browser-ssh-client.ts` and `/api/ssh-agent`. Replace per-session binding/single-key state with registry entries, multiple bounded owned browser connections, explicit active signer and exact per-key verification/grant state. Split cryptographic validation from policy decisions rather than weakening a single global UV check.
- **Environment integration:** remove manual browser-binding overrides from `lib/project-command-env.ts`/RPC integration after migration, rely on the stable startup environment in PTYs and normal descendants, audit subagent/extension/provider/Git paths for inheritance and accidental bypass. Keep host-password and new management-secret redaction intact.
- **MCP boundary:** `lib/native-session-tools.ts` captures a frozen sanitized environment but uses a deliberately restricted `mcpBaseEnvironment()` and `inheritEnv:false`. Do not silently add SSH to that allowlist. Explicit existing `$SSH_AUTH_SOCK` references should resolve to the stable managed path while captured owner/admission/reconnect semantics stay intact. Report this deliberate non-inheriting boundary rather than claiming ambient credentials were granted to every MCP.
- **UI:** new SSH Settings content composed with existing `SettingsPanel`, settings navigation and shared settings components. Evolve `BrowserSshAgent`/`AppShell` into a lifetime-owned signing connection/controller plus separate settings, sidebar status and non-blocking request presentation; closing Settings must not disconnect signing. Use the English catalog for all visible chrome. Notification support must reuse existing opt-in infrastructure without treating push delivery as signer liveness.

## Presentation contract

```text
Settings → SSH
  Current agent: Browser · Laptop · Connected
  Choose agent: [Browser agent ▾] [Use agent]
  [Refresh agents] [Add socket path]

  Browser signing
    Active: Laptop · Blue YubiKey
    Policy: Unlock session, then touch
    State: Unlocked — 24 minutes remaining   [Lock]
    This browser: Desktop · Standby
    [Connect / make this browser active]

  Registered keys
    Blue YubiKey   [Copy public key] [Rename] [Remove]
    Backup key    …
  Advanced ▸ paths, fingerprints, diagnostics
```

Distinguish setup-needed, No agent, available, unavailable, browser disconnected, connected-but-locked, unlocked, standby, verifying and pending states. Sidebar status communicates the effective selection, not an unapplied draft, and uses text rather than color alone. Show when an old pending request belongs to the previous backend/key. Remote browsers may observe status but must not acquire another connection's response capability.

Signing cards are global to the workspace, compact, non-blocking, accessible on desktop/mobile, with Approve/Deny or Unlock and approve and expandable original-request details. Never steal composer focus, auto-open full Settings, auto-invoke FIDO, or record the request in chat. Opt-in notifications alert/focus the current request; notification clicks are not signing approval. Removing a registered key disconnects/revokes its local authorization but is not remote SSH revocation; say this explicitly.

## Plan

All implementation tasks are pending further implementation authorization.

- [ ] **Close bootstrap/proxy ownership with synthetic fixtures.** Audit launcher/dev/service ordering, child inheritance, existing Git/PTY/native-tool guards, multiple-runtime isolation, external-agent protocol/session-binding behavior and stale-connection retirement. Produce a small reviewed architecture/ADR update and executable failing tests before committing to a sidecar/preload arrangement. Do not widen deliberate non-inheriting boundaries.
- [ ] **Establish the browser-policy compatibility gate.** Test strict and session-unlock policies with native WebAuthn virtual authenticators and bounded original assertion/registration validation, then document a separate user-supervised matrix for Firefox/Chrome on Linux/Android with USB/NFC YubiKeys. Record exact browser/OS/key/firmware, transport, reported protection and observed UV/UP behavior. Real hardware testing requires fresh explicit authorization, user-entered PIN only, no automated retries and no firmware/security-setting changes. Unsupported combinations must remain explicit open evidence, not claimed passes.
- [ ] **Add versioned settings and public-key registry modules.** Cover No-agent first setup, remembered/unavailable backends, startup inherited endpoint capture, custom entries, per-key policies/default strict, bounds, same-origin mutations, concurrent/unknown acknowledgements, atomic saves and corruption fail-closed behavior. Verify with new exact core test files and synthetic private agent directories.
- [ ] **Implement the stable managed socket/router.** Cover None, browser and synthetic external backends; self/symlink recursion, backend disappearance, bounded frames/clients/backpressure, atomic switch admission, key/connection snapshotting, pending-request drain, stale connection retirement, no automatic replay and owned shutdown/partial-start cleanup. Verify using native Unix clients and OpenSSH, never live host agents.
- [ ] **Add known-location discovery and custom socket validation.** Capture startup original endpoint, known askpass/GCR/system-selector candidates and GPG directory lookup; deduplicate physical endpoints without erasing meaningful dynamic aliases. Query public identities with a bounded timeout. Tests use fake runtime directories, controlled symlinks and synthetic agents; assert no recursive scan, signatures, private-key reads or automatic backend selection.
- [ ] **Integrate runtime-wide inheritance.** Verify the exact same socket in installed launcher/server, session Bash/explicit shell, subagents, retained PTYs, representative inheriting helper and built-in Git spawns. Switch while children remain alive and prove subsequent native agent use changes backend without changing their environment. Preserve sanitized MCP/acceptance/OS-broker boundaries and explicit environment overrides. Native MCP explicit socket references remain stable through its frozen configuration/reconnect lifecycle.
- [ ] **Implement multi-key browser connections and both policies.** Preserve strict UP+UV validation; implement exact-connection UV grants, fixed monotonic 30-minute expiry, standby retention without extension, explicit takeover, inline Unlock and approve, Lock/revocation, original-request ownership and stale-response refusal. Cover clock skew, expiry at response, concurrent approvals, replay, policy tampering, reconnect/restart, key removal and pending requests during switches. Retain raw-payload OpenSSH verification and web-safe filtering.
- [ ] **Build the agreed SSH Settings/status/card UX.** Cover draft versus effective agent, explicit Use agent, discovery/Refresh/custom path errors, device-first activation/standby, labeled per-key enrollment/copy/remove, visible grant state/Lock, advanced diagnostics and accessible desktop/mobile non-blocking approval cards. Cover late/ambiguous saves, hidden Settings, focus/keyboard behavior, old-backend pending labels and no transcript/model exposure. Add opt-in notification denial/stale-click/expiry tests without granting background-signing authority.
- [ ] **Migrate legacy metadata and bindings safely.** Import the current browser's public enrollment metadata idempotently after authentication and fresh possession proof, default existing keys to strict with unknown hardware policy reported, retain originals until durable import acknowledgement, and preserve SSH public-key identity where supported. Inventory old session markers and bypass their environment-override enforcement as soon as the upgraded runtime installs its managed No-agent socket, even before setup. Preserve marker files separately as evidence until explicit migration/setup acknowledgement; do not replay them as routing authority. Test an orphaned marker after restart with no setup: ordinary Bash succeeds, every inheriting child sees the managed socket, and agent requests cannot fall back to a host identity. Unsupported/unsafe records report a recovery path, not deletion. No arbitrary file cleanup.
- [ ] **Update maintained owners and obtain independent safety review.** Add the superseding ADR, update browser SSH/terminal/feature/session/environment/native-tool caveats, source map and English catalog, remove obsolete manual-export/per-session instructions, and document deferred Git signing-key automation. Resolve concrete routing, UV-policy, lifecycle and UI findings; retain failures and limitations rather than hiding them.
- [ ] **Run complete application acceptance on the settled implementation.** Use focused Nix checks for the affected files and `ssh-agent`/`terminal`/native-tools groups while editing; then run the owning guide's complete core/static/plugin, entire browser/terminal inventory and genuine Home Manager VM checks. Normal fresh command: `nix run .#test -- all --workers 4 --jobs 4`, subject to resource/concurrent-run admission. Do not widen to experimental 8/8, change deadlines, use a host service or build in the checkout. Record exact candidate/source digest, commands, artifacts, requested/effective widths, end-to-end realization-inclusive runtime and separately available preparation/execution intervals. No older feature acceptance is evidence that this redesign passed.

## Rollback / recovery

No migration runs during planning. During implementation, version persistent public metadata/settings and retain the old browser metadata/marker evidence until acknowledgement; do not overwrite unrelated user files. Explicit first setup records the new process-wide authority. A remembered unavailable/invalid backend remains visibly unavailable rather than reverting to the startup system agent. Normal shell work must not depend on an unlocked browser.

On runtime shutdown, stop new proxy/management admission, bound drain/cancel as appropriate, revoke all grants/capabilities, settle children/clients, and remove only owned socket/runtime artifacts. Do not stop external agents or mutate the host's `ssh-switch`. Startup and rollback must never capture the front socket as its own backend or infer signing authority from a saved receipt. Rolling back a deployed version is a separate authorized deployment action; document safe No-agent/disconnect preparation and how the older code handles newer settings/legacy markers before activation. No automatic rollback to another signing identity.

## Unknowns and disposition

- Exact bootstrap owner/management transport and multi-runtime persistence namespace: early synthetic architecture gate, not permission to invent a general daemon framework.
- Existing credential protection and Firefox/Chrome/Linux/Android USB/NFC UV behavior: unmeasured; the hardware matrix is a supervised handoff, not authorization to inspect a token or PIN. A hard incompatibility reopens the affected promise and requires an explicit scope decision, never silent downgrade.
- Background suspension/notification behavior and usable lease durations: measure without inflating request deadlines or weakening disconnect revocation. Alerts do not promise mobile wakeup or continuous liveness.
- External agents can have differing extension/destination-constraint behavior: preserve their semantics or fail explicitly; do not acknowledge unsupported security constraints.
- Git signing-key selection and remote authorization are outside this implementation. Public-key registration grouping does not make different private keys the same SSH identity.

## Completion checklist

### Planning deliverable

- [x] Record the user's process-wide pivot, discovery, persistence, UI and per-key unlock decisions, including explicit retractions and limits.
- [x] Ground proposed owners in current launcher/browser/PTY/MCP/Git code and the maintained guides; identify ADR 0030 as requiring explicit supersession and preserve adjacent plan ownership.
- [x] Review/check this document's paths, local links, boundaries and actionable acceptance gates. UTF-8/whitespace/headings, eight local links, twelve current implementation owner paths and the unchecked implementation state passed a targeted documentation check; `git diff --check` passed. Independent read-only review identified a legacy-marker/first-setup conflict; the migration task now explicitly bypasses old overrides immediately in managed No-agent mode while preserving marker evidence. These are plan-only checks, not runtime acceptance.

### Later implementation completion — not executed

- [ ] Bootstrap/router/settings/registry/migration tests and independent reviews pass; all implementation tasks above have their recorded acceptance evidence.
- [ ] The agreed desktop/mobile Settings/sidebar/signing flows work without project/session bindings or manual socket exports; strict versus session-unlock behavior and unsupported combinations are clearly represented.
- [ ] Complete Nix acceptance passes for the exact implementation inputs; required hardware/browser claims are supported by separate supervised evidence or explicitly narrowed and accepted scope, with remaining obligations assigned to a maintained owner.
- [ ] Maintained guides/ADR own durable behavior, plan status matches evidence, and required local Git integration/publication/deployment/cleanup boundaries are resolved separately. Archive only when the implementation obligations are completed or explicitly handed off under the planning skill.
