# 0033 — Stable runtime-wide SSH routing and per-key browser verification

Date: 2026-10-22
Status: Accepted design; implementation incomplete. Synthetic launcher/router and registration-helper checks exist; the registry, browser policies, selector UI and complete application acceptance remain pending in the active plan.

## Context and supersession

The user explicitly replaced project/session agent binding with a process-wide choice, then approved the [implementation plan](../plans/2026-10-22_process-wide-ssh-agent-plan.md). This supersedes ADR 0030's no-global-environment-replacement, temporary manual exports, per-session binding markers, browser-local registration registry and universally UV-required browser assertions. Its origin/key/challenge verification, private-key custody, explicit approvals, request bounds and no-transcript invariants remain.

## Decision

The supported launcher owns one private Unix front socket before spawning Next. Maintained dev/start entry points use the same owner; route imports and production build workers never create brokers. Capture the original inherited socket first, publish only the stable front pathname as SSH_AUTH_SOCK, and keep management tokens out of inherited command environments. A private authenticated Unix control endpoint connects the application to the launcher owner. Runtime sockets/capabilities are isolated per invocation; saved backend selection is namespaced by stable listen-host/port identity under the agent directory, not shared live authority. A single-owner PID/nonce lease uses atomic unique-marker rename claims for release, exit cleanup and known-dead-owner recovery. No elapsed-time takeover of live PIDs is allowed. Empty/incomplete directories fence the final removal interval; unknown files, unverified execution context, boot/PID-namespace changes and ambiguous PID reuse require operator recovery rather than automatic reclamation. Fresh Unix acquisition is allowed without Linux context metadata, but automatic stale recovery requires verified matching boot/PID-namespace identity. Saves serialize revision checks and fsync both staged files and their directory; a post-rename failure is an uncertain acknowledgement, never permission to replay a mutation.

The router starts with No agent until explicit first setup, remembers an explicitly applied backend, never falls back on failure, and preserves the front pathname across switches. It forwards external agent protocol semantics without replacing destination constraints, while browser backends retain web-safe signing filters. Old exchanges are pinned and bounded; already-pending work drains on its original backend, then stale front connections retire. No replay of ambiguous requests. Deliberate sanitization/overrides, native MCP admission and isolated acceptance environments remain unchanged.

The remaining browser implementation will provide server-side public registrations for multiple named ES256 credentials; signing authority stays in short-lived owned browser connections, with an explicitly active signer. Each key defaults to requiring UP+UV for every signature. An explicitly enrolled session-unlock policy may accept UP-only signatures only during a server-verified exact-connection grant with a fixed monotonic 30-minute limit. Standby activity does not extend it. Lock/revocation/disconnect/restart invalidate it. A connected locked request may explicitly Unlock and approve using fresh nonce-bound UV followed by a separate raw-payload signing ceremony. Payload assertions never create grants.

Registration parsing alone proves neither possession nor attestation: keep the exact candidate pending until fresh assertion proof, with server-owned one-time challenge/owner/origin admission. Protection and discoverability reports remain unverified registration metadata even after that assertion; never label them authenticated hardware guarantees. The bounded helper intentionally accepts only five-label public ES256 COSE keys and rejects unsupported CBOR explicitly.

This is application authorization, not PIN caching or hardware attestation. Browser/authenticator policies may still require UV. Hardware removal and OS lock are not reliably detected. Report credential-protection results and compatibility limits without silently weakening policies. Destinations enforcing verify-required will reject UP-only signatures; Git signing-key configuration and nonstandard signing are deferred.

Management lives in dedicated SSH Settings with explicit Use agent, device-first status and key management. The sidebar reflects the effective backend and pending count. Global non-blocking cards require Review → Approve → FIDO; optional notifications alert only and never approve. Public metadata migration requires proof of possession; old binding enforcement is bypassed immediately under the front No-agent socket, while marker evidence is retained until migration acknowledgement.

## Security correction during implementation

Independent review identified that repeated SSHSIG payloads reuse the raw WebAuthn challenge: a payload assertion cannot prove fresh verification for a new unlock window. The user explicitly approved replacing the earlier single-ceremony inline-renewal expectation with **two sequential ceremonies** on Unlock and approve: fresh server-random UV proof, then the original SSH-payload presence/signature ceremony. Already-unlocked signing remains one ceremony; browsers/authenticators may still require verification there. Concurrent locked requests share the first fixed grant without extending its deadline. Original-payload assertion replay remains a protocol limitation, but it cannot create or renew a grant.

Publisher replacement is explicit revocation, not ordinary device/backend handoff: old browser exchanges are cancelled/fenced at the launcher even without a final old-controller poll. Native-agent exchanges continue their ordinary bounded drain.

## Verification and limits

Synthetic native-agent/child-process, real OpenSSH, virtual-authenticator/browser and complete sandboxed core/browser/deployment evidence must be recorded in the active plan. No hardware or deployment is authorized by this ADR. Firefox/Chrome on Linux/Android with physical USB/NFC tokens remain a separate supervised compatibility matrix; virtual tests do not establish those claims.
