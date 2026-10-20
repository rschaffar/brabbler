# Packaged-service browser and terminal acceptance

All acceptance uses the **actual Nix-built application and installed launcher**.
Complete browser/terminal scenarios run in ordinary Nix build sandboxes. A separate
small NixOS/KVM suite proves genuine Home Manager/systemd deployment. There is no
development-server, in-place, host-service or non-Nix fallback.

```sh
nix flake check --max-jobs 1 --cores 4 -L  # complete cacheable core/browser/service
nix run .#test -- all --workers 4 --jobs 4 # normal fresh complete acceptance, if admitted
nix run .#test -- e2e                      # full browser/terminal, admitted sandboxes
nix run .#test -- e2e --workers 2           # same coverage, two concurrent sandboxes
nix run .#test -- service                  # genuine deployment, fixed small VM
# Focused iteration, NOT full acceptance:
nix run .#test -- e2e --group markdown
nix run .#test -- e2e --group terminal
nix run .#test -- e2e --group git-plugin
```

Nix realizes pinned dependencies, package, Chromium and fonts automatically. No
`npm ci`, Playwright download or checkout-local modules are required. Browser tests
need ordinary Linux Nix sandboxing, not KVM or nspawn/experimental daemon features.
Only deployment needs native Linux/KVM. See [testing](../docs/testing.md) for snapshots,
offline operation, admission and cached/fresh evidence. Use four/four for complete
acceptance when resources permit; explain smaller budgets and report preparation
separately as specified there. Production builds occur only
in isolated Nix builders, never in checkout `.next`.

## Disjoint coverage inventory

`nix/e2e-groups.json` is the CLI/browser inventory: **23 browser groups and terminal**.
`e2e/scenarios.mjs` assigns reviewed scenario/input variants to exactly one owner.
The independent baseline inventory/order tests protect the extraction; runtime
`coverage.json` records completion only after each whole assertion chain returns.
Missing, duplicate, unowned, reordered or retried scenarios fail. Browser selection
must be exactly one known selector before allocating fixtures. There is no hidden
unselected `general` aggregate or account/API footer in unrelated focused groups.

| Group | Coverage |
| --- | --- |
| `state` | Installed-launcher rejection of reserved revalidation headers, API pagination/errors, externally appended JSONL, account validation/redaction/defaults/concurrent writes, live AGENTS reload and dependent durable account selection/deletion |
| `history` | Version reload, session/mobile identity, observer pagination/node identity, recovery acknowledgement, rendering/thinking/compaction, minimap and reading/branch cancellation chain |
| `extension-dialogs` | Complete inline extension select/input/editor dialogs, keyboard/focus/expiry and retained receipts |
| `mobile-sidebar` | Compact action geometry/keyboard, archive/search scopes, reconciled inline restore and subsequent project move |
| `worktrees` | Management inventory, paging, trust boundaries, stale/lost preparation recovery and bounded cleanup receipts |
| `session-launch` | Real SDK tool, exact approvals/settings, independent faux-provider sessions and receipt navigation |
| `running-forks` | Newly submitted live-prompt forks without reload using a faux-provider turn, plus historical/root/quoted forks while the original SDK extension waits for input |
| `model-speed` | Native writes, canonical packaged disk reader, persistence and ambiguous acknowledgement reconciliation |
| `trust` | Worktree/project grants, revocation and restriction |
| `git-plugin` | Bundled Git Workflow, approvals, immutable reviews, receipts, expiry/reconnect and cleanup |
| `appearance` | Default/full/reading widths, numeric legacy preference and fresh preference inputs, typography/reload |
| `timestamps` | Both en-US and legacy Chinese locale/preference variants |
| `diff-context` | Loaded Workflow absence, Git Explorer immutable contexts/navigation/wrapping/Wide and integrated merge graph, in prerequisite order |
| `markdown` | Markdown/KaTeX security, full-height Mermaid previews, math/themes/SVG, file-scroll/preview state, file links, external-reference denial/intentional-link sentinel fixtures and real user-file polling |
| `file-edit` | Panel setup, all modified/added/deleted/context diff variants, editor/read-only/draft retention |
| `archive` | Focused archive/restore flow, distinct from the mobile search/restore/move chain |
| `privacy` | Concealment/loading/failure behavior, independent contexts and tablet coverage |
| `activity` | Full overview, real worktree/subagent/recovery fixtures and tablet coverage |
| `accounts` | Separate created/deleted and shared-device OAuth variants, retaining locale and mobile-height differences |
| `questions` | Native tool ownership plus mixed question sets, draft/reload/cancel/receipts |
| `session-links` | Desktop/mobile copying and following the copied link |
| `bulk` | Bulk archive/conflict/retry/restore/delete |
| `move` | Full picker, plain/Git/worktree/Browse paths, superseded reads and proposal-only changes |
| `terminal` | Real shell/PTY, fonts, reconnect/restart/exit, creation cancellation and workspace/Explorer coexistence |

Preserve distinct viewport heights/locales/preferences, not just desktop/mobile
widths. History desktop acknowledges recovery before fresh mobile checks it;
Explorer precedes merge mutation; file panel precedes diff/edit draft checks.
Real polling, submission acknowledgement and expiry observations keep their original
deadlines. Embedded assertions in different integration chains are not duplicates.

## One ordinary sandbox per whole browser group

Fresh full execution admits **1..4 concurrent sandboxes**, estimating two CPUs and
4 GiB per group plus 2 GiB host headroom. Explicit `--workers` refuses insufficient
budget; focused selections default to one. Preparation has its own bounded estimate.
Cacheable group derivations use normal Nix scheduling: bound `--max-jobs` explicitly.
All selections retain the same package/inventory/deadlines; budgets are not reservations.

1. Realize immutable production package, test dependencies, complete tools, Chromium
   and fontconfig/fonts. Freeze a deterministic weighted queue plan. Each queue is
   serial, but **every group is a new build sandbox**, not a reused service user.
2. Before fixture allocation, require a non-root builder and loopback-only interfaces.
   Fresh runs additionally compare all network/PID/mount namespace identities with
   the outer invocation. Each sandbox can use 30141 without touching another sandbox
   or host service. Separate users alone would not provide this isolation.
3. Allocate private synthetic HOME/agent/projects/artifacts and launch the actual
   installed `bin/pi-web` with a sanitized production environment. This is explicitly
   the process backend, not a simulated systemd service. Bind the registered child
   generation/package; unexpected exit, spawn/log failure or incomplete stop fails.
4. Run each original browser/terminal assertion chain, collecting every context trace,
   server log, events and console/HTTP errors. The original scenario/input inventory
   and success-only coverage order are unchanged. Generated helpers resolve against
   the **installed package**, not a copied application or checkout dependencies.
5. Require exact package/source/nonce/group/coverage receipts, closed service port,
   settled child/pipes and absent original POSIX group. Inner observations do **not**
   certify escaped descendants: Nix owns outer builder containment.
6. Validate the finalized immutable evidence tree before reading it. A realized
   diagnostic capsule is not a pass; a separate verdict gate rejects failed assertions.
   Failure closes admission and drains started sandboxes, including report-write
   failures. Pending groups stay not run; no retries or deadline changes.

Async API readiness uses [the shared awaited poller](async-condition.mjs), not an
async `waitForFunction` predicate: the pinned poller treats the Promise itself as
truthy. One monotonic 30-second budget covers evaluations and delays; only resolved
falsy values poll again, and errors propagate. A timed-out read remains owned by
context shutdown, not a claim of cancellation. Trust decisions instead await one
non-prompt `get_state` startup/binding acknowledgement under the same bound.

No host HOME, credentials, user bus, installed service or live store mount is
forwarded. Synthetic providers and applications share only their sandbox loopback.
Live-file tests modify fixture projects/session data, not application source/HMR.

## Small genuine deployment VM

`nix/vm-test.nix` retains one restricted-network, closure-only NixOS guest, real
pinned Home Manager and ordinary `t0`/UID1000. Its immutable registry fixes the
package/launcher/controller, HOME, environment file, unit and port. Initial execution
target: **1 vCPU, 1536 MiB RAM, 2 GiB sparse state disk**; not a measured minimum.
The guest contains no Chromium or full browser harness/dependency copy.

Mandatory ordered proofs:

1. Activate real Home Manager while the user manager is inactive, then start the
   manager and prove its generated `default.target.wants` link launches the package.
   The controller cannot explicitly start a replacement application unit.
2. Inspect actual ordinary-user launcher environment, file-over-unit precedence,
   runtime substitution, UMask/private physical paths and denied reads as `nobody`.
3. Persist a real HTTP session rename in the synthetic session file/workspace.
4. Explicitly restart the genuine user unit; require a new InvocationID and the
   same durable session/name through HTTP.
5. Exercise real HTTP PTY creation/SSE output, proving TTY, UID, cwd, dimensions and
   synthetic environment. Leave its shell running for the final shutdown proof.
6. Settle clients, stop the exact service and require inactive state, MainPID zero,
   authenticated empty/absent cgroups and refused TCP port. Preserve diagnostics
   independently after failures; collection is not inferred from a stop command.

The read-only guest store image contains only declared package/support closures;
its writable overlay belongs to the guest. No host forwarding, host credentials,
user bus, developer `.next` or live host-store exposure is introduced.

## Diagnostics and settlement

Fresh browser execution prints `/tmp/pi-web-test-browser.*`: `run.json`, preparation
log and per-group driver logs/result links. Each immutable capsule contains
`result.json`, suite output, harness/coverage receipts, server log, events, Chromium
traces/screenshots and a failed-fixture archive on failure. Both cacheable and fresh
verdict gates reject failed diagnostic capsules; Nix owns their build-tree disposal.

Deployment prints `/tmp/pwv-*`: `run.json`, realization/driver logs, driver link,
plan/evidence, JUnit and `artifacts/guest/pi-web-evidence/` with `journal.log`,
`service.log`, `observations.json`, `fixtures.tar.gz`. The exact receipt binds their
guest-stage SHA-256 hashes computed **before** transfer. Root-owned staging rejects
symlinks/special/cross-device entries before the driver's host copy can follow them;
a host-only synthetic sentinel exercises the guard. Host collection independently
checks files/hashes. Private helper reports, including bounded failed HTTP bodies
and PTY transcripts, export separately under `artifacts/guest-helpers/`; an unsafe
helper vetoes complete collection without preventing safe journal export.

After complete retained evidence and confirmed driver/service settlement, only the
invocation's pinned runtime/tmp/cache bulk may be removed. Failed assertions alone
need not veto cleanup; interruption or unsafe/incomplete evidence does. No wildcard
or historical-root cleanup. See [retention](../docs/testing.md#diagnostics-and-retention).

Console/5xx suppression, forced clicks, retries and longer browser deadlines are
not acceptance fixes. Contract tests alone are not real Chromium, PTY or Home Manager
acceptance. A receipt grants no host operation, Git integration or deployment authority.
