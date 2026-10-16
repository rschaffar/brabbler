# Testing Pi Web

## Nix-native acceptance

Nix owns the toolchain, immutable dependencies, production package and test
environments. There is no dependency-preparation step, non-Nix installation path
or development-server acceptance mode. Execution uses synthetic data and no
external providers. Normal realization may fetch pinned inputs or substitutes.

The selected Nix runtime is Node **24.21.0** throughout modules, the application,
core/fresh runners and VM fixtures. Core's fail-closed runtime-major check requires
**24**; changing the runtime means updating that guard deliberately, not accepting
arbitrary ambient Node. Root/demo use TypeScript **6.0.3** and Node 24 typings.
The launcher/npm minimum is **24.0.0**; acceptance covers the pinned runtime, not
every version admitted by that minimum.

From the physical Linux working-tree root:

```sh
# Complete cacheable acceptance; bound independent Nix builders explicitly:
nix flake check --max-jobs 1 --cores 4 -L

# Fresh complete acceptance, one verified snapshot and resource-aware overlap:
nix run .#test -- all
# Or execute the three levels separately:
nix run .#test -- core
nix run .#test -- e2e
nix run .#test -- service

# Focused iteration (NOT complete acceptance):
nix run .#test -- core --jobs 2 --file lib/worktree.test.mjs
nix run .#test -- core --file plugins/session-launch/runtime.test.mjs
nix run .#test -- e2e --group markdown
nix run .#test -- e2e --group terminal
nix run .#test -- --help
```

Core and browser acceptance use ordinary Linux Nix build sandboxes. Only the small
Home Manager deployment suite requires native Linux/KVM, available to its builder
or fresh-driver user. Neither building/running Pi Web nor browser acceptance needs
nspawn, namespace-root UID allocation or experimental Nix-daemon features.
Missing sandbox/KVM capabilities fail explicitly; there is no host-run fallback.
Native x86_64-linux and aarch64-linux definitions exist; a definition is not evidence
of a measured run on that platform.

No test contacts, stops or restarts the installed host service. Port 30141 belongs
to each browser sandbox's separate network namespace or the deployment guest.
Separate users alone would not isolate TCP ports.

Plain `nix flake check` follows Git-flake visibility: modified tracked files are
included, new untracked files are not. The fresh entry point safely exports and
verifies current source, including admitted untracked helpers. Do not pass a
populated checkout to `path:.` or stage unrelated files to make a check see them.
The fresh entry point exports the **physical current directory**, even when its
program was selected through a different frozen flake path; change into the
intended snapshot before invoking it.

Use focused checks while editing, then complete acceptance after source and review
changes settle. Record candidate/input identity, command/selection, result, command
runtime and artifact path. Cached success is declared-input evidence, not fresh
execution, host permission-gate evidence or authority for Git/deployment operations.
Rebase/relevant input changes require reassessing the candidate; never relabel old
evidence as a new-tip run.

### Three test levels, one application artifact

| Nix check | Coverage | Environment |
| --- | --- | --- |
| `checks.<system>.core` | Exporter contracts, genuine Next type generation, TypeScript, lint, recursive core and bundled-plugin tests | Ordinary Nix sandbox, shared immutable modules |
| `checks.<system>.e2e` | All 23 browser groups plus terminal, unchanged scenario/input chains and deadlines | One ordinary Nix sandbox per whole group, installed production launcher, pinned Chromium and fonts |
| `checks.<system>.service` | Genuine Home Manager activation/default-target startup, environment/permissions, durable HTTP writes/restart, real HTTP PTY and shutdown ownership | Small restricted-network, closure-only NixOS/KVM guest |

Core does not depend on the production bundle, Chromium or VM. Browser and service
acceptance use the same Nix-built production package and installed launcher, not
`next dev`, checkout `.next`, a copied application or a fake deployment unit.
The deployment suite does not repeat the browser inventory. See
[browser and deployment acceptance](../e2e/README.md) and
[ADR 0025](adr/0025-browser-and-deployment-acceptance.md).

Package and tests share a manifest/toolchain/platform-keyed dependency output,
including native `node-pty`. Application, test and manifest filesets are separate:
documentation/test-only edits do not rebuild the application; application-only
edits do not reinstall dependencies. Production builds receive a private physical
dependency copy inside the builder; runtime/core use the immutable output.

**Never run `next build` or `npm run build` in a working checkout.** Production
builds run only in isolated Nix builders. They neither activate a service nor
publish an artifact. Manual `nix develop`/`npm run dev` is separate, not acceptance.

### Source and credential boundary

Fresh execution exports an explicit source/name allowlist, excluding Git,
dependencies, `.next`, `.env*` and reviewed private/generated paths. Symlinks and
special files refuse. Export and matching inventory verification must succeed
before Nix ingestion. This is not a secret-content detector: review admitted source.

Realization and execution use private HOME/XDG/agent/TMP directories. Ambient
credentials, proxies, Node options, QEMU options/disk overrides and user buses are
not inherited. Browser capsules require an ordinary builder UID and loopback-only
network interfaces; fresh capsules also prove network/PID/mount namespace identities
differ from their outer invocation. Package/source/nonce/group/coverage bindings
are checked independently of diagnostic publication. An outer digest records
entry-point provenance; an arbitrary ambient digest in a direct `test-e2e` call is
not independent export verification or authorization.

The deployment guest has no host forwarding, live host-store mount, credentials or
user buses. Its read-only store image contains declared closures, with a guest-only
writable overlay. Synthetic providers and applications communicate on isolated
loopback; real session/account files are never copied into a builder or guest.

Offline operation is optional and explicit at outer and inner invocation:

```sh
nix flake check --offline --no-write-lock-file --max-jobs 1 --cores 4 -L
nix run --offline --no-write-lock-file .#test -- core --offline
```

Missing cached inputs fail normally. There is no prerequisite scanner, hidden
fallback, dependency-marker rewrite or cross-checkout dependency symlink.

## Coverage and resource admission

The core universe is recursive `*.test.mjs` under **app, components, hooks, lib,
public and plugins**. Browser scripts and `.fixture.mjs` helpers are not silently
added. Every discovered test participates; new/unreviewed files warn and run
exclusively until reviewed.

- Core desired workers: **8**; `--jobs` accepts canonical **1..32**. Effective workers
  respect CPU affinity/quota, Nix allocation and memory: 1 GiB reserve plus 2 GiB
  per worker. Linux uses `MemAvailable` and ancestor cgroup headroom.
- Core files have private environments, pinned Git and Node file concurrency 1.
  Reviewed F/N files share the pool; latency-sensitive E files drain that pool and
  run alone. E classification does not block an independent browser invocation.
- Browser fresh full execution admits **1..4 concurrent group sandboxes**, estimating
  2 CPUs/4 GiB per group plus 2 GiB host headroom. `--workers 1..4` refuses an
  insufficient budget; focused groups default to one. Each weighted queue is serial,
  and each group acquires a new sandbox/process environment, not another lane in a
  shared network namespace.
- Browser prerequisite realization has a separately recorded CPU/memory estimate,
  capped to effective resources and the admitted width; its metadata references the
  complete tools/font closure. Fresh group realizations use one builder/two advisory
  cores. Cacheable checks use normal Nix scheduling; bound `--max-jobs` explicitly
  instead of assuming a machine-wide reservation.
- The deployment VM has one ordinary user/service and a fixed **1 vCPU/1536 MiB RAM/
  2 GiB sparse state disk** execution target. This is not a measured minimum or its
  prerequisite-build budget. Its realization remains bounded to two jobs/four cores.

Failure closes new admission; started work drains. Report-write failures also close
admission and await peers. No automatic retries, longer browser deadlines,
failure-to-skip conversions or suppression of console/HTTP errors. A selected core
run still performs static preparation; `core --inventory-only` does not execute it.
Do not append Node concurrency flags to `npm test`; aliases delegate to Nix.

`test -- all` exports/verifies once. It runs browser then deployment, overlapping
core only when aggregate CPU/memory headroom includes internal realization peaks.
Otherwise levels serialize without reducing coverage or inflating deadlines.
`selection.json` records this estimate. A peer failure aborts/awaits the owned peer;
service cannot start after a browser failure. CI runs the three checks on independent
machines. Budgets are estimates, not reservations or hard partitions. One owner
coordinates source export and concurrent runs; pause writers during export, then
execute from the verified snapshot. Keep deliberate contention separate.

### Change-dependent evidence

| Changed area | Required evidence |
| --- | --- |
| Application/runtime behavior | Complete core, browser/terminal and deployment checks |
| Harness/Nix/package/service changes | All three complete checks, relevant failure/settlement contracts and source-input identity review |
| Focused iteration | Exact affected core files/named groups; not stable-candidate acceptance |
| Documentation only | Commands, links and contracts; execute changed instructions proportionally |

Plugin, session-launch, Activity, trust, bulk and all other previously focused-only
browser scenarios remain in the full browser inventory. Owning guides describe
assertions, not alternative acceptance environments.

### Historical timing

The previous all-browser-in-VM architecture passed fresh complete acceptance in
**10m58s** on 2026-10-15 (32-logical-CPU native x86_64 host), down from 52m11s.
That result is historical, **not a benchmark for this split**. Its exact inputs,
resource estimates, prerequisite reuse and failures remain in the
[parallel-acceptance plan](plans/2026-10-15_parallel-nix-acceptance-plan.md).
Implementation and complete evidence are recorded in the
[completed sandboxed-browser plan](plans/archived/2026-10-16_sandboxed-browser-acceptance-plan.md).

### Measured browser/deployment split

The composed Node 24/TypeScript 6/Pi SDK 1.3 candidate passed fresh
`test -- all --workers 4 --jobs 4` in **418.482s (6m58s)** on 2026-10-16:
**308 core files / 2,395 tests / 10 suites**, all **24 browser/terminal groups /
53 scenario receipts**, and every genuine deployment proof. No tests were skipped
or cancelled; execution/settlement and artifact validation passed.

| Scope | Previous parallel VM architecture | Browser/deployment split |
| --- | --- | --- |
| Core, overlapping browser work | 483s | 414s |
| Browser plus deployment | 655s in the shared VM | 223s browser + 22s deployment |
| Complete acceptance | 658s | **418s**, about **36% less wall time** |

Browser and deployment are serial with each other and overlap core; do not add
all three times to obtain complete runtime. The native x86_64 host had 32 logical
CPUs and about 54 GiB available memory at browser admission. Four core workers/four
group sandboxes were selected, estimating 16 CPUs/27 GiB including realization—not
a reservation. The guest used its verified initial 1-vCPU/1536-MiB/2-GiB profile;
browser resource needs moved to ordinary builders rather than disappearing.

Package/support and the deployment driver were prepared in isolated Nix builders
in a separately recorded **117.572s** before this run. All core/group/guest
executions were fresh. Preparation, model/review/coordination time is not part of
418.482s. The earlier Node 22/SDK 1.2 checkpoint passed in **403.590s (6m44s)**,
with 307 files/2,393 tests and the same 53 scenario receipts; do not relabel it as
Node 24 acceptance. These are historical observed comparisons, not cold-cache or
single-variable A/B benchmarks. Native ARM and GitHub execution remain unverified.
Core is now the critical path: exclusive files consume about **343s** of aggregate
work, led by Git Workflow cleanup/discard/server tests. This change does not
reclassify or weaken them.

## Diagnostics and retention

Core retains inventory, summary, original bounded TAP/stderr and lifecycle evidence.
Its printed private root contains `run.json`, `driver.log` and the exact store
output link (an intentional GC root). Fresh execution keys only the execution
derivation with a nonce. Nix owns builder containment and build-tree disposal; inner
lifecycle observations remain bounded, not certification of escaped descendants.

Browser execution prints `/tmp/pi-web-test-browser.*`: `run.json`, preparation log
and per-group driver logs/result links. Each immutable diagnostic output contains
`result.json`, suite output, exact `coverage.json`, harness receipt, server log,
events, Chromium context traces/screenshots and a failed-fixture archive on failure.
A realized diagnostic capsule **is not a pass**: fresh and cacheable verdict gates
require exact coverage, successful execution and settlement. Before reading final
output, reject symlinks/special/cross-device entries. Child/pipe/original POSIX-group
observations do not certify escaped descendants; **Nix owns outer containment**.

Deployment execution prints `/tmp/pwv-*`: `run.json`, realization/driver logs, driver
link, `artifacts/plan.json`, `artifacts/acceptance.json` and JUnit. Guest evidence
contains `journal.log`, `service.log`, `observations.json` and `fixtures.tar.gz`,
with authoritative SHA-256 hashes computed in root-private guest staging **before**
copy and checked again on the host. Helper reports (including bounded failed HTTP
bodies/PTY transcripts) are separately exported under `artifacts/guest-helpers/`.
An unsafe helper tree vetoes complete collection without suppressing safe journals.
The driver rejects unsafe trees before host copy and tests rejection with a
host-only synthetic sentinel. Acceptance requires the exact plan, all ordered proofs and final inactive
service, zero MainPID, empty/absent authenticated cgroups and refused TCP port.

Only after verified driver settlement and complete evidence may the owner remove
that run's pinned runtime/tmp/cache bulk. Failed assertions alone need not veto
cleanup; interruption, unsafe/missing evidence or uncertain settlement do. The
manifest distinguishes result, settlement and cleanup. Diagnostics remain.

Cacheable evidence belongs to the Nix output. Failed derivations retain original
`nix log <exact-derivation>`/`-L` diagnostics; `--keep-failed` retains builder trees,
which can be private to nixbld. Never widen permissions. Fresh runners expose
user-owned reports without executing applications on the host.

A successful control command, requested stop, cached result or saved receipt is
not process-settlement proof or new authority. Diagnose exact logs/trace before a
justified retry; an unchanged passing retry is not a fix. No wildcard/age-based
reapers or historical-root discovery. Existing failures, backups, dependencies,
branches and worktrees require separate bounded cleanup; Nix GC does not remove
ordinary `/tmp` roots. Report command runtime separately from preparation, model
work, review and coordination.
