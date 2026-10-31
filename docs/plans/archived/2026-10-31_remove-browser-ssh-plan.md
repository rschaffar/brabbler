# Remove browser SSH management

## Goal

Remove browser-backed SSH signing and browser-controlled agent selection entirely. Ordinary commands and terminals retain conventional inherited SSH agent forwarding. Do not delete private saved key metadata, authenticator credentials, destination authorizations or historical recovery data.

## Context

The user requested removal rather than a redesign. ADR 0030 and ADR 0033 describe the retired feature; ADR 0039 and the updated terminal/session guides own the new boundary. This implementation plan is complete; the receiving session owns the separate Git-integration handoff. This is implementation authority, not deployment, remote publication, credential deletion or approval to change the host agent configuration.

## Plan

- [x] Remove the browser controller, SSH settings/sidebar/cards, management API, signing/registration/recovery code and static demo illustration. The installed `auth` browser group verifies absent UI/API/client requests; the separate demo is source-reviewed.
- [x] Remove managed socket routing and legacy session bindings from launchers and command adapters; retain auth checks, child lifecycle, command-environment hygiene and explicit MCP isolation. Fourteen focused core files / 203 tests pass, including synthetic native sockets and explicit overrides. A private dropped-socket production fault fails both inheritance owners; the receiving source stays unchanged and green.
- [x] Retire feature-only tests/scenarios as obsolete with their removed owners; preserve mixed authentication, launcher, subprocess and PTY obligations. Live inventories, documentation and ADR 0039 are updated. Retired scenario IDs/selector are rejected; the retained installed CLI/login chain passes under its new auth receipt.
- [x] Run focused checks and review the final diff. `nix run .#test -- all --workers 4 --jobs 12` passed core/static/plugin checks (516 files / 4,263 tests), all 26 browser/terminal groups (58 scenarios) and the genuine deployment VM on source `9ff90e3a56aff79cea2ac44354be8f7dfeb89d5de10f2cdb78b1a0c180403fb4`. Exact receipts, prior failures and fault evidence remain in the private task results.
- [x] Prepare the reviewed implementation/evidence handoff for required local-main integration. The receiving session owns the feature commit, current-main rebase, exact-state approval for an unsigned non-fast-forward merge and separately gated cleanup. Archiving this plan does not claim those operations executed.

## Risks and recovery

Inherited agent access replaces the former managed No-agent default. A long-running service must be started with a deliberately supplied native/forwarded socket; an unrelated later SSH login cannot change an existing process environment. Disconnecting forwarding prevents future signatures but does not revoke established SSH connections. No fallback identities, host selector changes or credential cleanup are introduced. Existing private feature data becomes inert and remains recoverable; rollback/deployment is a separate action.

## Completion Checklist

- [x] No browser SSH interface, signing transport or managed broker remains in production or demo source.
- [x] Native/forwarded SSH socket inheritance and command-secret filtering have passing regression evidence.
- [x] Updated live test inventory and full acceptance pass on the final source candidate; subsequent plan/ADR archival is documentation-only.
- [x] The verified implementation is handed off for separately approved local integration; no cleanup, deployment or remote publication is implied.

## Verification scope

Complete command runtime was 476 seconds, including in-run realization. Production package/dependency prerequisites were warm from focused checks; test execution was fresh. Requested/effective core width was 12/12 with four browser sandboxes and admitted overlap on 32 CPUs with about 45 GiB available. Core execution/static preparation and per-level timing receipts are retained separately; overlapping intervals are not added together. The dropped-socket fault was confined to a private source copy, never the receiving candidate. The static demo was source-reviewed, not independently built; real forwarded agents, hardware keys and remote destinations were not accessed.
