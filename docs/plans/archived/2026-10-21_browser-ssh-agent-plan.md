# Browser-backed FIDO SSH agent

## Goal

Provide an opt-in SSH agent in Pi Web whose signatures are made by a P-256 FIDO credential through the connected browser's WebAuthn API. Plan and implementation share `feat/browser-ssh-agent` in `/home/robert/projects/3rdparty/pi-web-worktrees/browser-ssh-agent`, based on local `rst-main` `e0e7ac10399b5a44fddee746c00ba525b42494bf`. The user requested planning followed by implementation; this plan records that authority, not deployment or publication authority.

## Context

Robert's NixOS configuration uses Ed25519-SK SSH keys with application `ssh:` and routes Pi Web to a stable local agent selector. Browser WebAuthn cannot reuse those credentials. OpenSSH's `PROTOCOL.u2f` defines P-256 WebAuthn signatures. This feature enrolls a separate browser-domain-scoped credential on the same physical authenticator without replacing the local agent or editing the NixOS repository.

Active plans were searched for SSH/WebAuthn/FIDO ownership; none owns this behavior. Existing session, terminal, request-security and Nix acceptance contracts remain authoritative.

## Architecture

- A browser-controlled ephemeral bridge owns a private Unix socket, one public credential and a random management capability. No private key or authenticator PIN reaches Pi Web.
- An authenticated same-origin browser enrolls a cross-platform ES256 credential, stores only public metadata locally, and proves possession with a fresh server challenge before its socket becomes usable. Reconnecting is explicit; persisted metadata is not signing authority.
- The server implements a bounded, deliberately small SSH-agent protocol: list identity, sign supported SSH userauth/SSHSIG messages, refuse key mutation and unknown extensions. It verifies WebAuthn assertions and encodes OpenSSH's WebAuthn signature format.
- Requests are delivered outside chat/JSONL through an authenticated capability-scoped channel. Every signature requires an explicit browser action and user verification. Expiry, disconnect lease, client close, cancellation and server shutdown fail closed. Queues, frames, clients and bridge counts are bounded.
- UI exposes enrollment/reconnect/disconnect, the authorized public key and socket export command, and opt-in binding for the selected session's built-in Bash execution. Other sessions, subagents, plugins and the global environment do not inherit it. Existing terminals may explicitly export the socket; their lifecycle stays unchanged.
- The initial implementation targets Unix sockets (Linux/macOS); unsupported platforms, absent password authentication, insecure non-loopback origins and unsupported browsers refuse activation. Remote use requires trusted HTTPS and a stable RP ID.
- Socket possession still permits same-user processes to request signatures. Request descriptions are untrusted display claims, not destination attestation. A compromised server/browser can solicit signatures; authenticator custody alone cannot prevent this.

## Non-Goals

- Reusing existing `ssh:`/Ed25519-SK credentials; a native helper or extension; SSH forwarding; arbitrary raw signatures; SSH CA management.
- Automatic trust/authorized_keys installation, automatic signing, PIN caching, global agent selection, remote publication, deployment or Home Manager activation.
- Claiming virtual-authenticator tests establish physical-token, Safari, Firefox or third-party SSH service compatibility.

## Plan

- [x] Close protocol unknowns against OpenSSH's verifier: exact challenge, RP ID, public key and signature encodings; record any blockers/retractions before building on them. Prove synthetic assertion compatibility with real OpenSSH in sandboxed tests.
- [x] Add isolated WebAuthn/SSH encoding and validation helpers with negative tests for tampering, wrong origins/RP IDs/challenges, absent UP/UV, unsupported keys/extensions, malformed data and excessive sizes.
- [x] Add the ephemeral bounded Unix agent and capability-authenticated HTTP lifecycle; test ownership/isolation, protocol refusals, queue limits, timeout/disconnect/cancellation, stale/duplicate replies and socket teardown.
- [x] Add browser enrollment/public-metadata persistence, explicit connection and signing UI outside chat, and selected-session Bash binding without mutating `process.env`; cover client cancellation, reconnect and session isolation.
- [x] Add real Chromium virtual-authenticator acceptance through the installed package, including a native SSH-agent/OpenSSH round trip, explicit denial/disconnect and isolated browser ownership; retain existing browser inventory.
- [x] Document usage, compatibility, security, recovery and hardware-verification limitations in a focused guide and maintained source map. Obtain independent read-only security review and address material findings.
- [x] Run focused Nix checks while editing, then complete `nix run .#test -- all --workers 4 --jobs 4` subject to resource admission. Record immutable candidate/input identity, artifacts, requested/effective widths and command/preparation/execution intervals. Leave unavailable or failing obligations open.

## Evidence and review

- Protocol research confirmed the challenge is the complete raw SSH payload, not its hash. Modern clientData suffix members are compatible. The initial feasibility assessment omitted the stock-client version restriction: OpenSSH 9.9/10.0–10.2 reject the agent signature algorithm; 10.3 contains the upstream fix. This restriction is now explicit in the UI and maintained guide.
- Initial focused core passed 7 tests (`/tmp/pi-web-test-core.hXlrtE/run.json`). Initial browser snapshot `4731cfc147e56c4f437807929c7f1bca3e051318e8bdc7db2635fb3206239511` passed desktop/mobile native WebAuthn/OpenSSH scenarios in 9.736s execution (`/tmp/pi-web-test-browser.sXkBJL/run.json`). These are focused evidence, not complete acceptance.
- Independent read-only security review identified five medium issues (marker errors, live-unbind ownership, high-bit protocol identifiers, approval cancellation, backpressure listeners); fixes and regression tests were added. Follow-up review found a browser/server clock-skew comparison; approval cancellation now uses server-authoritative request membership, with ±2 minute browser-clock scenarios added. Review identified no high-severity finding; it is not a security certification.
- An expanded focused core attempt failed a stale browser-inventory count after adding the group (`/tmp/pi-web-test-core.RCCnUz/run.json`); the expected unstarted count was corrected from 22 to 23, preserving all prior scenarios. The resulting five-file selection passed 43 tests plus exporter/typegen/typecheck/lint (`/tmp/pi-web-test-core.U8IijW/run.json`); two pre-existing ReviewFileBrowser lint warnings remain. Snapshot `17eff519aacb31f004fb8e9ee7bfc651647a8ac7a56e2b5a7519a97f10fe86f2` also passed the expanded browser scenarios (including native stalled-prompt cancellation) in 14.180s execution (`/tmp/pi-web-test-browser.5bVDHP/run.json`). Later clock-skew and signal-shutdown regressions still require the final candidate run.

- First complete four/four attempt on snapshot `1082ecdb5b69f98f81e3a7458912ad18bc5a3037c88d4786481c42920dca6c4f` stopped after 217s: another explicit inventory assertion in `lib/nix-test.test.mjs` still expected 24 groups rather than 25. Core had passed 299 files before fail-fast stopped remaining work; the browser peer was coordinator-cancelled and service never started. No complete acceptance is claimed. Diagnostics: `/tmp/pi-web-browser-ssh-all.DE4iyW.log`, `/tmp/pi-web-test-core.fqEYym/run.json`, `/tmp/pi-web-test-browser.TFY76o/run.json`. The inventory assertion is corrected, with an explicit SSH group assertion; other Nix/coverage count guards were searched before rerunning.

### Complete acceptance

`nix run .#test -- all --workers 4 --jobs 4` passed on immutable snapshot `19457f521c242e8e76a83cf3684709b35074f8dff503071ea5f21056bee8aa2c` (`/nix/store/96f9mbrx3gnsdakkbgk0nmb2bjmiqimw-source`), native x86_64 Linux, Node 24.21.0, Chromium 155 and OpenSSH 10.5p1. The corrected final focused selection also passed 48 tests (`/tmp/pi-web-test-core.euv35b/run.json`). Independent follow-up review closed all reported medium issues at source-review level with no additional high/medium finding.

- **393 core files / 2,941 tests / 12 suites** passed, none skipped/cancelled. Exporter, typegen, TypeScript and lint passed; two unrelated pre-existing ReviewFileBrowser warnings remain. Requested/effective core workers: **4/4**. Evidence: `/tmp/pi-web-test-core.86iZaF/run.json`; immutable detailed summary `/nix/store/pxnyi87nvqdjxgc1130cim0cpkip6bdq-pi-web-core-checks/artifacts/run-VPRr1i/summary.json`.
- **25 browser/terminal groups / 55 exact scenario receipts** passed, including native browser/OpenSSH signing, stalled-prompt cancellation, ±120-second browser clocks, isolation and reload/reconnect. Requested/effective browser workers: **4/4**. Evidence: `/tmp/pi-web-test-browser.fq9bDQ/run.json`.
- **All deployment proofs passed**, including real Home Manager activation, permissions, durable HTTP writes/restart, native PTY and shutdown/cgroup/port settlement. Evidence: `/tmp/pwv-BliX9V/run.json`; guest test **19.397s**. This is a synthetic deployment VM, not authorization to activate the installed host service.
- End-to-end command wall time: **403s (6m43s)**, including in-run realization. Core outer interval **330.959s**, with **47.250s** setup/static checks before the first test and **281.909s** test-execution span. Browser outer interval **329.629s**, with **6.537s** preparation/dispatch before the first capsule and **322.966s** capsule span. Service outer interval **66.415s** includes realization/driver execution/collection; the separately recorded guest test is **19.397s**. These overlapping intervals must not be summed. Prior focused/failed runs warmed application/tools/dependencies; this is not a cold-cache benchmark. Model, review and coordination time are separate.
- Admission recorded **32 CPUs / 54,629,158,912 available bytes** at combined selection, estimating **16 CPUs / 28,991,029,248 bytes** for overlap, not reserving them. Selection receipt: `/tmp/pi-web-test-source-rBaNo7/selection.json`. Full command log: `/tmp/pi-web-browser-ssh-all-fixed.QgZMX4.log`.

Physical tokens/PIN UX, actual remote SSH login, third-party destinations and non-Chromium browsers were not exercised; those limitations are explicit in the maintained guide and are outside this implementation's automated acceptance. No live credentials, hardware keys, deployment or remote Git operations were used.

## Rollback / Recovery

Disconnect closes this bridge, fails pending requests and removes only its owned socket/runtime directory. Clearing a session binding restores that session's ordinary inherited SSH environment; a binding whose bridge disappeared must fail closed rather than silently use another identity. Existing child processes cannot have their environment retroactively changed. Reload/restart invalidates bridge capabilities and requires explicit reconnection. Forgetting local public metadata does not delete the authenticator credential or revoke authorized keys: explain separate server-side revocation. No deployment or host-agent changes are part of this task.

## Git handoff

Implementation is committed as `6a674611eff990ca988b96264c115751f3d4136a`. The implementation, tests and maintained docs are complete; this status/archive follow-up changes no application, test, dependency or Nix inputs. The parent coding session remains the explicit owner of the required local Git lifecycle: resolve completion intent, rebase onto the current local `rst-main`, present exact IDs/evidence for the ordinary unsigned non-FF merge, then handle separately gated feature cleanup. Archiving this implementation plan does not claim those operations have executed. Hardware/destination verification and deployment remain separate human-authorized work, with current limitations owned by `docs/browser-ssh-agent.md`.

## Completion Checklist

- [x] Protocol compatibility and security/lifecycle tests pass with no private/hardware credentials accessed.
- [x] Browser and session integration is reviewed; ordinary local SSH behavior remains unchanged when disabled.
- [x] Required complete acceptance passes and evidence/timings are recorded; real-device limitations are explicit.
- [x] Maintained documentation owns the resulting behavior; plan status matches verified evidence.
- [x] A coherent unsigned implementation commit exists (`6a674611eff990ca988b96264c115751f3d4136a`); required integration/exact-state approval and separate cleanup are handed to this coding session's global Git lifecycle, targeting local `rst-main` by non-FF merge. This implementation plan does not grant those approvals, remote publication or deployment authority.
