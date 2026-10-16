# Testing Pi Web

## Nix-native acceptance

Nix owns the toolchain, built dependencies, production package and test environments.
There is no dependency-preparation step, non-Nix installation path or development-server
acceptance mode. Normal realization may fetch pinned inputs or substitutes. Test
execution uses synthetic data and no external providers.

The selected Nix runtime is Node **24.21.0** throughout modules, the application,
core/fresh runners and VM fixtures. Core's fail-closed runtime-major check requires
**24**; changing the runtime means updating that guard deliberately, not accepting
arbitrary ambient Node. Root/demo use TypeScript **6.0.3** and Node 24 typings.
The launcher/npm minimum is **24.0.0**; acceptance covers the pinned runtime, not
every version admitted by that minimum.

From the physical Linux working-tree root:

```sh
# Complete cacheable acceptance for the current native system:
nix flake check -L

# Fresh complete acceptance, one verified snapshot and resource-aware overlap:
nix run .#test -- all
# Or execute the two independent levels separately:
nix run .#test -- core
nix run .#test -- e2e

# Focused iteration (NOT complete acceptance):
nix run .#test -- core --jobs 2 --file lib/worktree.test.mjs
nix run .#test -- core --file plugins/session-launch/runtime.test.mjs
nix run .#test -- e2e --group markdown
nix run .#test -- e2e --group terminal
nix run .#test -- --help
```

Supported acceptance hosts/guests: native x86_64-linux and aarch64-linux with KVM
available to the Nix builder/user. Other Nix package targets do not acquire a host
or non-Nix testing fallback. A missing virtualisation capability fails explicitly.
No test uses, stops or restarts the installed host service on port 30141; the same
port inside the isolated guest is unrelated.

Plain `nix flake check` follows Git-flake source visibility: modified tracked files
are included, new untracked files are not. The fresh entry point safely exports and
verifies current source before passing that snapshot to Nix. Do not pass a populated
checkout to `path:.` or stage unrelated files just to make a check see them.

Use focused checks while editing; run complete core and E2E acceptance after source
and review changes settle. Record the input identity, exact command/selection,
result, command runtime and artifact path. A cached successful check is declared-input
evidence, not a freshly executed run, host permission-gate evidence or authority for
Git/deployment operations. Rebase or relevant source/toolchain/configuration changes
require reassessing the resulting candidate. Never relabel old evidence as a new-tip run.

### Two test levels, one application artifact

| Nix check | Coverage | Environment |
| --- | --- | --- |
| `checks.<system>.core` | Exporter contracts, genuine Next type generation, TypeScript, lint, recursive core and bundled-plugin Node tests | Nix sandbox with immutable shared modules |
| `checks.<system>.e2e` | Complete browser/terminal group inventory, real service activation and restart/persistence | One NixOS VM, real Home Manager module, ordinary user, packaged app and pinned Chromium |

Core does not depend on the production bundle or VM. E2E always uses the exact
Nix-built production package and installed launcher. There is no `next dev`, checkout
`.next`, manually launched application or stub-only Home Manager deployment test.
See [browser/terminal acceptance](../e2e/README.md) for groups and the guest lifecycle.

The package and tests share a manifest/toolchain/platform-keyed dependency output,
including native `node-pty`. Application, test and manifest filesets are separate:
documentation/test-only edits do not rebuild the application; application-only edits
do not reinstall dependencies. Next builds receive a private physical dependency
copy inside the builder; runtime and core checks use the immutable output.

**Never run `next build` or `npm run build` in a working checkout.** Production package
builds for acceptance are supported only in isolated Nix builders. They neither
activate a service nor publish an artifact. Manual `nix develop`/`npm run dev` remains
a separate workflow and is not acceptance.

### Source and credential boundary

The fresh entry point exports an explicit source/name allowlist, including untracked
helpers, while excluding Git, dependencies, `.next`, `.env*` and reviewed private or
generated paths. Symlinks and special files refuse. The original export and matching
manifest verification must succeed before Nix ingestion. This is not a secret-content
detector: review source admitted to approved trees.

Realization and fresh execution use private HOME/XDG/agent/TMP directories. Ambient
credentials, proxies, Node options, QEMU options/disk overrides and host user buses
are not inherited. The VM receives only its declared package/test closures, synthetic
fixtures and a restricted network; browser, fake providers and application communicate
on guest loopback. No real session/account files are copied into the guest or store.

Normal realization uses Nix's declared input/substitution machinery. Offline-only
operation is optional and must be explicit at both outer and inner invocation:

```sh
nix flake check --offline --no-write-lock-file -L
nix run --offline --no-write-lock-file .#test -- core --offline
```

Missing cached inputs then fail normally; there is no custom prerequisite-cache
scanner or hidden download/build fallback. Do not alter dependency markers or
symlink another checkout's dependencies to bypass a refusal.

## Coverage and selection

The core universe is recursive `*.test.mjs` under **app, components, hooks, lib,
public and plugins**. Browser scripts and `.fixture.mjs` helpers are not silently
added. Every discovered test participates; a new/unreviewed file warns and runs
exclusively until its scheduling classification is reviewed.

- Default desired core file workers: **8**; `--jobs` accepts canonical **1..32**.
  Effective workers are bounded by CPU affinity/quota, supplied Nix allocation and
  memory (1 GiB reserve plus 2 GiB per worker). Linux admission uses
  `MemAvailable`, not only unused pages; ancestor cgroup headroom remains binding.
- Files use private HOME/XDG/agent/TMP, pinned Git and Node file concurrency 1.
  Reviewed F/N files share the bounded pool; latency-sensitive E files drain it
  and run alone. Existing opt-in native test skips remain explicit in inventory.
- Failure stops new dispatch while started jobs settle. No automatic retries,
  timeout inflation, failure-to-skip conversion or suppression of general errors.
- `core --inventory-only` reports discovery without static checks/execution.
- A selected core run still performs static preparation. It is not full acceptance.

Do not append Node concurrency options to `npm test`. Npm test aliases delegate to
the Nix entry point; scheduling belongs to its options. Core and VM resource limits
are per invocation, not host reservations. One owner coordinates concurrent runs,
source export and CPU/RAM budgets; pause source writers during export. Fresh
entry points bound each internal realization to two Nix jobs/four build cores;
core workers are additionally clamped to that allocation. Outer Nix options control
only the outer realization, not an already running internal client.

VM profiles contain **1..4 isolated service lanes**, with two vCPUs and 4 GiB per
lane, plus a 16 GiB sparse state disk. Fresh E2E chooses the largest profile fitting
effective CPU/memory with 2 GiB host headroom; `--workers 1..4` fixes a profile and
refuses insufficient budget. Focused runs default to one lane. The cacheable E2E
check declares two lanes (four vCPUs/8 GiB); use appropriate host/Nix job budgets.
Profiles execute the identical complete inventory/package/deadlines, not a fallback.

`test -- all` exports/verifies once, preserves the VM's best admitted profile and
overlaps core (default two workers) only with enough additional CPU/memory headroom,
including each internal client's two-build/four-core realization peaks.
Otherwise it runs the levels serially rather than reducing browser resources or
hiding contention with deadlines. `selection.json` records this decision. A peer
failure signals the other owned invocation and awaits shutdown; interrupted or
incomplete evidence retains bulk. CI overlaps the independent levels on separate
runner machines. Keep deliberate contention tests separate from normal acceptance.

### Measured complete run

On the same native x86_64 Linux host (32 logical CPUs), the 2026-10-15 fresh
four-lane/four-core-worker run passed **304 files / 2,333 core tests** and all
**24 VM groups**, including every lane's real activation, restart/persistence,
collection and runner/application settlement.

| Command scope | Sequential baseline | Fresh parallel run |
| --- | --- | --- |
| Core | 6m27s, four workers | 8m03s, four workers overlapping VM |
| Packaged-service VM | 45m44s, one lane | 10m55s, four lanes |
| Complete acceptance | 52m11s, serial levels | **10m58s**, overlapping levels |

The measured complete command was `test -- all --workers 4 --jobs 4`. Admission
saw about 50.8 GiB available memory and selected an eight-vCPU/16-GiB guest;
its combined estimate required 16 CPUs/27 GiB including realization peaks.
Dependencies and the previously built production package were reused, but the
nonce-keyed sandboxed core and regular VM driver both executed freshly. This is
not cold-cache or GitHub-runner timing, and more resources alone do not establish
safe scaling. The core slowdown is included, not hidden by the combined result.

The VM driver took 602.37s; group elapsed times totaled 1,839.35s. Actual lane
work sums were 552.14/400.60/461.26/425.35s; Git plugin (281.36s) and worktrees
(185.28s) were the largest remaining groups. Initial partition weights remain
estimates, not an optimality claim. Exact inputs, retained failures, commands and
receipts are recorded in the [implementation plan](plans/2026-10-15_parallel-nix-acceptance-plan.md).

### Change-dependent evidence

| Changed area | Required evidence |
| --- | --- |
| Application/runtime behavior | Complete core and packaged-service E2E checks |
| Harness/Nix/package/service changes | Complete core and full VM checks, including failure/settlement contracts and source-input identity review |
| Focused feature iteration | Exact affected core files or named E2E groups; not a substitute for stable-candidate acceptance |
| Documentation only | Review commands, links and contracts; test changed executable instructions, not unrelated application suites |

Plugin, session-launch, Activity, trust, bulk and other previously focused-only
browser scenarios are part of the explicit full VM inventory. Their owning feature
guides describe assertions, not alternative acceptance environments.

## Diagnostics and retention

Core prints phase boundaries, inventory, summary, events and original bounded
TAP/stderr diagnostics. Fresh execution adds a nonce only to the check derivation,
so it executes once in the same Nix sandbox, not on the host. The printed user-owned
core root retains `run.json` and `driver.log`; successful runs link the exact store
output's artifacts/lifecycle/manifest. Its result link is an intentional GC root.
The separately printed safe source snapshot/manifest remains. Failed runs retain
original bounded diagnostics and `--keep-failed` builder state, without widening
nixbld permissions. Nix owns builder containment and eventual build-tree disposal;
the inner lifecycle still observes jobs before removing its own generated bulk.

Fresh VM runs print a private `/tmp/pwv-*` root. It contains `run.json`,
`realization.log`, `driver.log`, the immutable driver link, `artifacts/plan.json`,
`artifacts/acceptance.json`, JUnit, journals and per-group manifests/Chromium traces.
The versioned receipt matches the exact package/selection/partition, every group's
scenario completion and every lane's collection plus runner/application settlement.
One incomplete or unsafe lane vetoes bulk cleanup; failed assertions alone do not.
Failure screenshots/fixture evidence are retained. The driver uses private runtime
and temporary directories, not the host user's runtime namespace. After confirmed
driver/descendant settlement and evidence collection, the owner removes only that
run's pinned runtime/tmp/cache bulk (including qcow disks); interruption or uncertainty
retains it. The manifest distinguishes execution, settlement and cleanup outcomes.

For cacheable checks, successful evidence is part of the Nix output. Original
failures remain in `nix log <exact-derivation>` / `-L`; `--keep-failed` retains failed
builder trees. These can be private to nixbld: never widen permissions to inspect
or export them. Use the same definition's fresh runner for user-owned diagnostics.

A passing assertion, successful control command, requested stop, cached check or
saved report is not proof of process settlement. Browser errors/local 5xx, unexpected
service generations/restarts, uncertain cgroups, missing traces or failed diagnostic
collection fail acceptance. Investigate the exact logs/trace before a justified retry;
a passing unchanged retry is neither a diagnosis nor a fix.

No wildcard/age-based reapers or historical-root discovery. Existing failed runs,
backups, checkout dependencies, branches and worktrees need separately authorized
bounded cleanup. Nix GC does not clean ordinary `/tmp` directories. Report command
runtime separately from realization, reasoning, review and coordination.
