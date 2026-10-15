# Packaged-service browser and terminal acceptance

All acceptance runs against the **actual Nix-built application**, started through
its installed launcher and real Home Manager systemd user units in one NixOS VM.
There is no development-server, in-place, host-service or non-Nix fallback.

```sh
nix flake check -L                         # complete, cacheable core + VM checks
nix run .#test -- all                      # fresh complete acceptance, one snapshot
nix run .#test -- e2e                      # fresh full VM, resource-admitted lanes
nix run .#test -- e2e --workers 2           # same coverage, explicit resource profile
# Focused iteration, NOT full acceptance:
nix run .#test -- e2e --group markdown
nix run .#test -- e2e --group terminal
nix run .#test -- e2e --group git-plugin
```

Nix realizes pinned dependencies/package/driver automatically. No `npm ci`,
Playwright download or checkout-local `node_modules` is required. Native Linux/KVM
is mandatory. See [testing](../docs/testing.md) for safe snapshots, offline operation,
resource admission and cached versus fresh evidence. Production builds occur only
in isolated Nix builders, never in a working checkout's `.next`.

## Disjoint coverage inventory

`nix/e2e-groups.json` is the CLI/VM inventory: **23 browser groups and terminal**.
`e2e/scenarios.mjs` assigns reviewed scenario/input variants to exactly one owner.
The independent baseline inventory/order tests protect the extraction; runtime
`coverage.json` records completion only after each whole assertion chain returns.
Missing, duplicate, unowned, reordered or retried scenarios fail. Browser selection
must be exactly one known selector before allocating fixtures. There is no hidden
unselected `general` aggregate or account/API footer in unrelated focused groups.

| Group | Coverage |
| --- | --- |
| `state` | API pagination/errors, externally appended JSONL, account validation/redaction/defaults/concurrent writes, live AGENTS reload and dependent durable account selection/deletion |
| `history` | Version reload, session/mobile identity, observer pagination/node identity, recovery acknowledgement, rendering/thinking/compaction, minimap and reading/branch cancellation chain |
| `extension-dialogs` | Complete inline extension select/input/editor dialogs, keyboard/focus/expiry and retained receipts |
| `mobile-sidebar` | Compact action geometry/keyboard, archive/search scopes, reconciled inline restore and subsequent project move |
| `worktrees` | Management inventory, paging, trust boundaries, stale/lost preparation recovery and bounded cleanup receipts |
| `session-launch` | Real SDK tool, exact approvals/settings, independent faux-provider sessions and receipt navigation |
| `running-forks` | Historical/root/quoted forks while the original SDK extension waits for input |
| `model-speed` | Native writes, canonical packaged disk reader, persistence and ambiguous acknowledgement reconciliation |
| `trust` | Worktree/project grants, revocation and restriction |
| `git-plugin` | Bundled Git Workflow, approvals, immutable reviews, receipts, expiry/reconnect and cleanup |
| `appearance` | Default/full/reading widths, numeric legacy preference and fresh preference inputs, typography/reload |
| `timestamps` | Both en-US and legacy Chinese locale/preference variants |
| `diff-context` | Loaded Workflow absence, Git Explorer immutable contexts/navigation/wrapping/Wide and integrated merge graph, in prerequisite order |
| `markdown` | Markdown/KaTeX security, Mermaid math/themes/SVG, preview state, file links and real user-file polling |
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

## One guest, isolated service lanes

Fresh full runs admit **1..4 lanes** using effective CPU/memory: two vCPUs and 4 GiB
per lane plus 2 GiB host headroom. Explicit `--workers` refuses insufficient budget;
focused selections default to one. The cacheable check declares two lanes. All
profiles execute the same complete inventory/package/deadlines. Resource estimates
are not reservations; keep deliberate contention tests separate.

`nix/vm-test.nix` generates one immutable root-owned registry and, per lane, a
separate ordinary user (`t0`…`t3`, UIDs 1000…1003), private HOME, fixed guest loopback
port (30141…30144), environment file, user manager and real Home Manager
`pi-web.service`. Each controller checks the guest marker and its literal UID,
forces its own bus/runtime path and names only that unit. The harness validates the
registry/package/controller/port binding; it never trusts ambient HOME for ownership.

1. Boot one restricted-network guest. Activate real pinned Home Manager for every
   configured lane. Start each user manager only after activation, proving its
   generated `default.target.wants` link starts the application. Verify lane-distinct
   smoke sessions, production UMask and live generation, then stop.
2. Freeze a deterministic duration-weighted partition (`artifacts/plan.json`). Each
   lane executes its queue serially; queues overlap. No work stealing or concurrent
   driver-machine connections. Each group gets private physical fixtures/evidence
   and a separate Node process, so process-global fixture environment changes cannot
   affect another lane.
3. A unique transient **system** runner unit, with the lane's unprivileged User and
   complete cgroup supervision, owns the suite/Chromium. It does not replace the
   application unit. Application startup still uses the real installed launcher and
   fixed Home Manager user service.
4. Bind application InvocationID/PID/restart count/**cgroup**. Capture every context
   trace, errors/responses/local 5xx and a generation-filtered service journal.
   Successful control commands are not proof the application stayed alive.
5. Before another group uses a lane, require passing harness/coverage receipts,
   stopped application, closed port and empty/absent runner descendants. A failure
   closes admission across all lanes; already-started groups drain without deadline
   changes. Pending groups remain explicitly not run.
6. On success, verify real restart/persistence against each used lane's final fixture.
   Finally settle **all runner cgroups before final application stops**, preventing
   late service acquisition. Collect every lane independently, even after failure.

The VM has no host port forwarding, host store mount or unrestricted external
network. Its read-only closure image contains only declared package/test inputs;
its writable store overlay belongs to the guest. No live host accounts/credentials,
installed service, developer `.next` or source/dependency copies are used. Helpers
and generated extensions resolve against the **installed package**. Live-file tests
modify synthetic projects/session data, not application source or HMR state.

## Diagnostics and settlement

Fresh execution prints its private `/tmp/pwv-*` root. `run.json`, `realization.log`,
`driver.log`, JUnit, `artifacts/plan.json` and `artifacts/acceptance.json` identify the
exact package, resource profile, partition, group/lane timing, result, collection and
settlement. Guest diagnostics are staged under a root-owned directory before export. Reject
symlinks/special entries there before the pinned driver's host copytree can follow
links. Every run exercises that guard with a synthetic host-only sentinel:

- `artifacts/guest/pi-web-evidence/journal.log`: complete boot journal once.
- `…/lN/runners/<group>.log`: original suite output from its owned transient unit.
- `…/lN/artifacts/<group>/run.json`: fixture/package, service generation and settlement.
- `…/<group>/coverage.json`: exact expected/completed scenario IDs.
- `…/<group>/server.log`, `events.jsonl`, `context-N.zip` and failure screenshots.
- `…/lN/<group>-failed-fixture.tar.gz`: failed/uncertain synthetic fixture evidence.

The version-2 receipt must match the exact pre-boot plan. Every lane's collection,
runner and application settlement is required; passing acceptance additionally needs
all selected groups, scenario completion, activation and used-lane restart proofs.
Failed assertions may still permit cleanup after complete retained evidence and
settlement. One incomplete/unsafe lane, interruption or unknown cgroup retains bulk.

Browser/context acquisition, traces and service stops retain separate bounds. No
blanket retries, console/5xx suppression, forced clicks or longer browser deadlines
hide contention. After confirmed driver/descendant settlement and valid evidence,
only that invocation's pinned runtime/tmp/cache bulk is removed; diagnostics remain.
Existing failures and other tasks' resources require separate bounded cleanup; see
[retention](../docs/testing.md#diagnostics-and-retention).

Core harness/service-owner contracts are not native browser acceptance. VM testing
grants no host operation, integration, publication or deployment authority.
