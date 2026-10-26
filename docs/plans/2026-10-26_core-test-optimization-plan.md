# Core test optimization — investigation and proposed execution

**Status: P1 complete and integrated; P2 implemented and focused-verified,
complete acceptance pending.** The first stop at `d532fedb44cc819b18085331168d9d78157a01b7`
was premature: it disposed only of the small owner-compilation slice, not the dominant
retained-import cost. The user explicitly requested thorough continuation in the
same retained worktree. P1 was merged
into local main at `0d5d914515057c957b47a7b92d9164ddacd98bc7`. A subsequent explicit
request authorizes P2 only: measure repeated RPC fixture preparation, adopt only a
demonstrated simple reduction, preserve isolation, verify and retain local feature
commits. No rebase/integration/publication/cleanup is authorized for P2. Other
opportunities remain deferred. Historical investigation and P1 evidence below
retain their original identities.

## Goal

Reduce core feedback time without losing the real owners, original inputs,
assertions, error/settlement checks or native authority established by the completed
browser-retirement work. Distinguish less work, better scheduling, faster focused
feedback and faster complete acceptance; none implies the others.

**Current bounded execution: P2 retained-import preparation.** Attribute the
79.645s retained-import interval before deciding materiality. Separate pure Jiti
transformation from resolution/evaluation, then adopt only a demonstrated small
immutable-preparation reduction with source/configuration controls and unchanged
fresh dependency/owner evaluation. One coherent candidate receives focused matched
measurement, independent review and complete acceptance before expansion. No generic
cache, initialized-graph sharing, Git/timer/classification, browser-retirement,
worker scaling, rebase/integration/publication or cleanup is authorized.

Start with the existing four-core-worker budget. There is no promised percentage
or hard 351.05-second gate: the user made the old performance targets informational.
Demonstrate any eventual improvement on comparable executions, not simulations.

## Plan Relationship and authority

- Follow-up to `2026-10-23_complete-test-ownership-plan.md`; that completed work
  owns the preserved coverage and browser/native bridges, not this optimization.
- `2026-10-15_parallel-nix-acceptance-plan.md` is completed historical work.
  ADR 0032 and `docs/testing.md` own current scheduling and acceptance contracts.
- Isolated planning checkout: `plan/core-test-optimization`, based on local main
  `3f3944e06b83f497b306e8254e54e8cf80054d63`. No application edits or integration
  were part of that investigation. P1 received a subsequent explicit user request.
- P1 implementation starts from current local main
  `b06f5a463756b539843839c29087c30895697371` (checked, not assumed), in linked worktree
  `/home/robert/projects/3rdparty/pi-desk-worktrees/project-trust-estimate`, branch
  `perf/project-trust-estimate`. CodeGraph was initialized there before code research.
  Implementation commit: `6de0a61a1eba61b1e8e66683418195d52b256366`.
  At that stage the user withheld rebase/integration/publication/cleanup authority;
  P1 was subsequently integrated by the separately authorized merge noted above.
- Do not reopen the browser retirement, invent another obligation census, share
  mutable test runtimes, weaken failure checks, or create a profiling/cache platform
  before a small experiment demonstrates its need.

## Evidence and measurement limits

The historical investigation timings in this section and the ranked opportunities
come from the existing successful x86_64 Linux/Nix run:

```sh
nix run .#test -- all --workers 4 --jobs 4
```

- 509 core files / 4,171 tests / 14 suites; all 26 browser/terminal groups and the
  genuine deployment VM passed. Recorded complete command wall: **386s**.
- Core: `/tmp/pi-web-test-core.17IFHZ/run.json`.
- Immutable detailed evidence:
  `/nix/store/5ywxa6frgl4lmsaka59cv02mnzsvzirj-pi-web-core-checks/artifacts/run-XhjVZm/`
  (`summary.json`, `inventory.json`, `events.jsonl`, per-file TAP).
- Source: `/nix/store/s7i5y24h0llqrqmxjhlxkk7r20flysgc-source`, digest
  `f59b90e6cca74fc87312f41c9ea456891998c122583caebb78d2015964906139`.
- Admission observed 32 logical CPUs and about 28.2 GiB available memory; requested
  and effective core width four. Core overlapped browser/service work. These are
  not standalone core CPU measurements, cold-cache promises or repeated samples.
- Core lifecycle **378.804s**, with **1.701s** before and **0.302s** after it.
  First-file start to last-file end: **377.881s**.

### Where the wall time goes

| Lane | Files / tests | Summed file elapsed | Execution shape |
| --- | ---: | ---: | --- |
| F | 316 / 2,464 | 448.120s | Shared four-worker pool |
| N | 101 / 913 | 618.340s | Same pool, not a second pool |
| E | 92 / 794 | 101.851s | Serial after pool drains |

The F/N pool takes **275.959s**, then E takes **101.922s**. E contributes about
27% of execution wall, despite only 8.7% of summed file work. Pool occupancy is
already **96.61%**. With frozen durations, work/4 is **266.615s**: perfect packing
can recover at most **9.344s**, not a minute.

The browser-through-service branch spans **311.025s** in this run. Core finishes
**69.942s** after service. Under unchanged branch durations, roughly 70s of core
improvement would shift the complete-run bottleneck. This is a planning observation,
not an immutable floor: changing CPU contention can also change other branches.

### Dominant files and individual cases

| File | File elapsed | Top-level TAP bodies | Principal finding |
| --- | ---: | ---: | --- |
| `lib/rpc-manager.test.mjs` | 132.534s | 129.985s | Twenty startup-fixture bodies account for 129.606s; 27 fixture invocations |
| `hooks/useAgentSession.reconciliation-mounted.test.mjs` | 97.286s | 96.864s | Native readiness 60.053s; native grace chain 31.239s |
| `plugins/git-workflow/cleanup.test.mjs` | 95.730s | 94.156s | Repeated real between-effect recapture, not large fixture bytes |
| `plugins/git-workflow/server.test.mjs` | 52.512s | 50.518s | Multiple genuine operations and caller/source matrices |
| `plugins/git-workflow/discard.test.mjs` | 49.714s | 48.164s | Real Git effects/revalidation dominate reported bodies |
| `lib/project-trust.test.mjs` | 23.811s | 22.819s | Missing estimate makes it the final pooled straggler |

RPC's highlighted startup matrices are 19.750s cold-child restoration, 18.629s
continuing startup, and 7.607s persisted tools. The two distinct natural provider
heartbeat cases take 15.651s / 15.647s and already substantially overlap.

**Residual is not compilation time.** Across all files, 867.814s is top-level TAP
body time and 300.499s is residual. Of that residual, 280.286s lies inside TAP's
own duration envelope, versus 20.213s outside it. For E the split is 52.477s inside
versus 3.208s outside. File-minus-TAP median is only 38.7ms. Loader/startup work is
worth investigating; eliminating process supervision is not supported as a major
win. Supervision can still interfere concurrently, so subtraction is not a CPU
profile. Repeated transformation inside a test is counted in its body.

## Ranked opportunities

### 1. Correct one scheduling estimate — cheapest, low risk

In the historical reference run, `lib/project-trust.test.mjs` has estimate zero.
It starts at pool second252.147 and finishes at275.959, after the other workers
have finished by264.519.

A frozen-duration replay of the actual scheduler gives:

| Simulation, four workers | Pool | E | Total | Change vs model baseline |
| --- | ---: | ---: | ---: | ---: |
| Current estimates | 275.912s | 101.851s | 377.764s | — |
| Trust estimate 0 → 23,811ms | 267.718s | 101.851s | 369.570s | -8.194s |
| All pool estimates set to observed durations | 266.636s | 101.851s | 368.487s | -9.277s |
| RPC file hypothetically halved | 259.345s | 101.851s | 361.196s | -16.568s |

**These are simulations, not measured savings.** The model omits dispatch gaps and
freezes interference; its baseline is0.117s below observed file execution.

Adopted P1: one `estimatedMs: 24000` entry in live `nix/test-lanes.json`, rounding
23,811ms to a coarse historical hint as `docs/testing.md` specifies. This is neither
a deadline nor a resource reservation. The scheduler, lane/reason/holds, process
isolation, cases and deadlines are unchanged; no other estimate is refreshed.
The historical simulation above is not relabelled as a measured result.

### 2. Remove repeated immutable RPC preparation — strongest targeted source lead

`lib/rpc-startup.fixture.mjs:12–109` repeatedly creates private roots, capabilities,
Jiti loaders and SDK-shaped fixture instances. `lib/backend-ownership.fixture.mjs:12–46`
unconditionally reads, transpiles, parses static imports and constructs an RPC
initializer on every invocation. Its retained-dependency loader uses
`fsCache:false, moduleCache:false`.

The expensive fixture supplies service discovery and session construction; these
rows are **not measured native SDK discovery time**. The true native model-config
integration file already reuses one production graph while preserving fresh SDK
managers/wrappers and native effects; its recorded process is3.330s.

**Proposed first slice:** measure just preparation, retained imports and fresh
initialization inside the existing fixture, using bounded scalar timings. Then
reuse only immutable source/transformation/static-import metadata where worthwhile.
Keep new module initialization, exports, controller, capabilities and lexical globals
per row. Do not begin with a general cache abstraction.

Potential follow-up: one typed re-export composition for contiguous real helper
imports, still initialized after the current environment boundary. Only consider
retained dependency reuse after checking captured environment, globals, class/Symbol
identity and mutable caches. A new Jiti object does not itself prove a new graph.

Do **not** share an initialized RPC module, session manager, wrapper, start/binding
promise, account context or a mutable “current row” capability dispatcher.
`SUBAGENT_CONTROLLER` and import-time configuration make that unsafe by default.
Earlier-row callbacks must retain their own original roots/errors after another
row starts. Keep all current trust/profile/toggle and native orphan-closure cases.

Original hypothesis (superseded for the immutable-owner slice by the P2 measurement
below): benefit was unmeasured and at most the duplicated preparation portion of
129.606s, not all of it. The hypothetical50% file reduction /16.568s model wall
improvement is not observed evidence. The measured owner compilation/parsing is a
small part of startup; the dominant retained-import interval remains effectful and
was not optimized.

### 3. Shorten the serial tail selectively — meaningful but not a new audit campaign

The twelve slowest E files sum49.844s. Source review did **not** establish that all
can safely enter the pool. First candidate: `lib/acceptance/coordinator.test.mjs`
(**4.747s**, plausible **N**, not F). Current fixture releases gates, stops admission,
joins disposal/submissions and removes roots only after successful drain. Real
`flock` recovery remains native. Finish its pinned eager-import/failure-cleanup
review and verify it; do not promote from timing or private paths alone.

Later narrow candidates:

| File | Elapsed | Remaining specific gate |
| --- | ---: | --- |
| `app/api/native-tools/route.test.mjs` | 3.193s | Pre-publication resource construction, replacement retirement, default loader effects; registration is not script execution |
| `app/api/skills/content/route.test.mjs` | 2.848s | Exact pinned loader/package-resolution behavior; `noExtensions:true` alone is insufficient |
| `lib/session-pause.test.mjs` | 2.538s | Transitive scanner/catalogue/background completion before root removal; current cleanup is stronger than its old hold rationale |

These four total13.326s. Ideal balanced reclassification arithmetic is about
`S - S/4`, or9.99s, before contention. Coordinator alone gives about3.56s. These
are idealized estimates assuming unchanged durations and balanced execution—not
scheduling bounds, eligibility or speedup evidence.

Retain other inspected holds unless their actual gate closes: native-resource
QuickJS/MCP closure; launch gates not failure-released; detached descendants still
covered by a1900ms sleep; subagent registration/refresh completion; SDK tests using
unawaited `destroy()`; nested supervisor/process timing. E does not repair a leak.
Do not launch another all-files isolation census to recover a few seconds.

### 4. Cache pure transformations, not runtime state — bounded experiments only

The installed Jiti implementation was inspected, not merely inferred from options:

- `JITI_FS_CACHE=0` supplies a default; explicit `fsCache:true`/directory wins.
  Removing the environment variable does not override explicit `false` fixtures.
- Its disk cache detects source-byte changes, including unchanged mtime, but does
  not comprehensively key arbitrary transformer/options identity. Its exposed
  `cacheVersion` was not found in the implementation path.
- Cache writes go directly to final paths, without observed atomic rename.
- Jiti VM wrappers are not demonstrated beneficiaries of Node's module compile cache.
- Metadata says Jiti2.7.0 while its bundled diagnostic constant says2.6.1: key any
  design by the actual pinned implementation, not that constant alone.

**Preferred general-cache spike:** a per-file memory cache of successful pure
transform results in existing repeated fixture construction, initially one of
`components/navigation-runtime.fixture.mjs` or
`components/browser-lower-runtime.fixture.mjs`. Preserve existing resolution,
evaluation, module-cache settings and fences. Bound entries/bytes; key actual
source, filename and understood effective transform settings/implementation.
Bypass custom/stateful/unsupported options. Do not cache failures, Error objects,
exports, windows, stores, registries, promises or account/native bindings.

This targets repeated within-file transformation, not the first cold import of
every E process. It overlaps RPC preparation ideas: do not build both before
measuring and attributing their distinct contributions.

**Separate candidate:** run-private Node24 compile cache outside source, propagated
explicitly through `privateEnvironment`, not a developer cache. It can target ordinary
module compilation across file processes. Its exact publication behavior and
interaction with native-denial fences remain unresolved. Internal runtime I/O may
bypass patched JS exports; never treat that as permission to weaken those fences.
Keep disabled where boundary compatibility is unestablished.

Defer shared transformed-code disk stores and Nix-precompiled test platforms.
They add atomic publication, configuration/provenance, mutated-source fallback,
read-only cache and lifetime work. Global Jiti disk-cache enablement is not an
acceptable first patch. No test-result caching or skipped fresh tests is proposed.

### 5. Overlap independent native waits — preserve the actual timing inputs

The60s readiness case proves60000ms registration, >=59900ms elapsed, original
shared promises/SAME timeout Error, one close and no late resurrection. Its separate
actual controller uses60000/1200; the hook uses60000/1000. Do not conflate them.
The grace case proves actual30000ms admission and two600ms rechecks, including
compaction, body failure and confirmed idle. Existing policy clocks do not control
these native timers. Two provider15s proofs differ at native callback delivery and
are not duplicates.

**Potential change:** one owned fixture overlaps the separate controller's60s wait
with the hook's unchanged31.2s grace chain. Keep serial React actions, separately
attributed sources/handles/cardinalities, original errors and independent release/
join/restore paths. No extra worker or child is needed in principle.

This could remove about31 occupied worker-seconds: roughly7.8s of ideal four-worker
throughput contribution, not31s suite wall. Source/ownership complexity may outweigh
that gain. Merely splitting files offers faster focused feedback but approximately
the same total work plus imports; do not sell packing as work removed.

Keep heartbeat proofs unchanged. Short prompt/bash waits total only about4.4 worker-
seconds (~1.1s work/4); new clock ports or relaxation of original native inputs are
not justified as an early optimization. Such a disposition needs explicit user input.

### 6. Git cost — measure fresh probe amplification, avoid seed infrastructure

The25-root cleanup case takes12.495s despite tiny generated files. Source expansion
indicates27 worktree captures plus a branch-only capture, about350 root inventories
and roughly1900 Git subprocess calls before extra reporting/settings probes. These
are **source-derived estimates**, not runtime counters. Mandatory fresh revalidation
between effects is the main amplification; no repository-result cache is proposed.
The server cross-repository case performs twelve real operations over both callers.

Low-risk possibilities: batch ordered private fixture setup dispatches while keeping
native commands, or materialize inert initial settings once in new private roots.
The latter intentionally stops exercising the updater for those initial writes, so
must exclude permission-change/revocation/durability cases and retain actual readers,
origins and later updates. Magnitude is unknown and likely modest.

Higher-risk, separately scoped possibility: batch demonstrably equivalent **fresh**
read-only native observations within the existing production checkpoints. Keep all
capture epochs, final registrations, ref-format/commit/direct-ref distinctions,
filter eligibility ordering, Unicode/newline path framing, error statuses and child
closure. If Git itself dominates, shell batching may save little or regress.

Do not build immutable repository seeds: the existing seven-sample pilot in
`docs/testing.md:305–320` found42.204ms fresh versus36.547ms materialized, only5.66ms
per fixture plus seed construction. Never copy linked-worktree administration,
hardlink mutable indexes/config/refs, reuse approvals or shrink actual fixtures.

## Execution scope — P1 complete; P2 reopened; other opportunities deferred

Keep one writer, one active change and normal four-worker admission. Independent
review remains useful; packet counts and universal lifetime theorems are not gates.

- [x] **P1: cheap scheduling candidate.** Update only trust's missing estimate;
  verify runner/manifest contracts. Separate implementation commit and matched
  measurement are recorded below. P1-only completion does not authorize P2–P5.
- [ ] **P2: targeted RPC preparation — reopened.** Owner-only compilation is small;
  attribute dominant retained imports, adopt only demonstrated immutable reuse and
  preserve fresh initialization. Verify source/configuration changes, current
  aliases/capabilities, fresh side effects and old callbacks retaining original
  roots/errors. Stop only on evidence about the relevant recoverable work, not by
  conflating owner compilation with all preparation.
- [ ] **P3: first coherent checkpoint and possible finish.** Review and measure
  the adopted P1/P2 candidate before expanding. P1 alone is a valid finish if RPC
  preparation savings prove immaterial; do not build a cache merely to complete P2.
  Run complete acceptance using normal definitions. Do not start timer/Git/cache/
  classification rewrites while this result is pending.
- [ ] **P4: optional further slice, only if worthwhile.** Coordinator-only N review,
  one pure-transform cache site, or native wait overlap. Skip candidates with weak
  benefit-to-complexity, unresolved ownership or noise-sized savings.
- [ ] **P5: close.** Record actual work removed and focused/whole results separately;
  leave rejected hypotheses and deferred risks visible. No automatic infinite loop.

### Proportionate validation and measurement

The original proposed command menu uses existing entry points. The P1 evidence
records only P1 commands; the separately identified P2 phase probe below is the
only new RPC preparation execution. This menu is not a list of completed checks:

```sh
# RPC preparation consumers / native counterpart
nix run .#test -- core --jobs 4 --file lib/rpc-startup-port.test.mjs
nix run .#test -- core --jobs 4 --file lib/rpc-manager.test.mjs
nix run .#test -- core --jobs 4 --file lib/rpc-manager-model-config.integration.test.mjs
nix run .#test -- core --jobs 4 --file lib/rpc-model-config-native-closure.test.mjs
# Relevant scheduling contracts, if changed
nix run .#test -- core --jobs 4 --file lib/test-runner.test.mjs
# Settled complete candidate
nix run .#test -- all --workers 4 --jobs 4
```

Select only actual receivers while editing; do not run all commands after every
line. Before acceptance, verify the affected importer set using current source.
For performance, compare sequential baseline/candidate selections differing only
by the reviewed optimization; keep dependencies, toolchain, widths and browser/
service orchestration unchanged and record both source identities.
Use fresh effectful executions; record static reuse, realization/export cost,
command wall, lifecycle, pool/E spans and cumulative file work separately. The old
run is a reference, not a matched new standalone baseline. Confirm an ambiguous
result proportionately; do not create a repeated whole-suite timing campaign.

For preparation/cache changes, targeted correctness must cover changed bytes at the
same filename/mtime, original→mutant→restored source, relevant transform/global-name
settings, current alias resolution, missing capabilities, fresh per-row exports and
side effects, distinct roots/accounts/windows, SAME errors, and failed initialization/
cleanup. Include only controls exercised by the changed boundary; reuse unaffected
native evidence. Never share a mutable capability dispatcher to make caching easy.

For scheduling changes, retain exact discovery/coverage, private environments and
actual worker/resource limits. A lane promotion requires specific source review and
fresh combined evidence, not a changed label. Preserve all native deadlines and
settlement checks. A non-pass is diagnosed from its exact logs; no unchanged retries,
filtering, assertion weakening, backgrounded native work or deadline inflation.

Eight workers is already a supported opt-in capacity experiment under ADR0032,
not code work removed or a new default. Evaluate separately if requested; never
compare eight-worker candidate timings with a four-worker baseline as an algorithmic
speedup. More workers cannot be assumed safe/free for native timing-sensitive cases.

## P1 implementation evidence — 2026-10-26

### Verification and comparable inputs

One sequential baseline/candidate pair used the unchanged entry point:

```sh
nix run .#test -- all --workers 4 --jobs 4
```

Both ran native x86_64 Linux, Node 24.21.0, 32 logical CPUs, requested/effective
four core workers, four browser sandboxes and overlapping core/browser→service
orchestration. Admission observed 48.797 / 54.629 GiB available memory; these are
estimates, not reservations or machine-exclusive runs. Dependencies/package/types
were already realized. Between pair members, the focused candidate command below
realized its changed lint evidence (41.193s command wall, including realization):

```sh
nix run .#test -- core --jobs 4 --file lib/test-runner.test.mjs --file lib/test-design.test.mjs --file lib/test-lanes-audit.test.mjs
```

Focused result: **3 files / 49 tests**, plus 29 exporter contracts and mandatory
static evidence passed; report `/tmp/pi-web-test-core.TZ6OLH/run.json`. Independent
read-only review found existing estimate-validation, ordering, exact-discovery,
private-worker and failure/abort-drain regressions sufficient. No test bodies changed,
and no new regression pins the precise advisory value. `docs/testing.md` already
owns the unchanged hint semantics; no guide/policy change is necessary.

| Identity | Baseline | Candidate |
| --- | --- | --- |
| Git candidate | `b06f5a463756b539843839c29087c30895697371` | `6de0a61a1eba61b1e8e66683418195d52b256366` |
| Immutable source | `/nix/store/jpvxgs8avv34lw2lw9yyd4xq7g1nldd5-source` | `/nix/store/dpld3ydr5r8w7shb15cnacn1rqni0zdm-source` |
| Outer source digest | `dccf7b820e858b2ce428c42ebe718b151b7cd9841f3f6a93ef87eba9cc05c022` | `cf7b966a40a8e42bcedc189649199175bb2ec7e02e216edbab262d9cf38e3bb9` |
| Export / selection root | `/tmp/pi-web-test-source-14h0oV` | `/tmp/pi-web-test-source-YqzDLi` |
| Core report | `/tmp/pi-web-test-core.FCCpIn/run.json` | `/tmp/pi-web-test-core.7QiRaQ/run.json` |
| Immutable core output | `/nix/store/vxyb0g6xi027gsa0i3g3ph52640q9dn9-pi-web-core-checks` | `/nix/store/52f1zbvkinda9aiap0x834b55l61jjh4-pi-web-core-checks` |
| Detailed artifact directory within output | `artifacts/run-FPxfy6` | `artifacts/run-MdFIpT` |
| Browser report | `/tmp/pi-web-test-browser.Sh2Ld7/run.json` | `/tmp/pi-web-test-browser.VvoPPu/run.json` |
| Genuine deployment report | `/tmp/pwv-L2IA3h/run.json` | `/tmp/pwv-ESjwHP/run.json` |

Exported file bytes/modes differ **only** at `nix/test-lanes.json`. Both inventories
have identical 509 discovered paths/body hashes, all planned lanes/reasons/holds
and all 4,171 original case outcomes/counts. Only trust's planned estimate changes
0→24000. Both pass **509 files / 4,171 tests / 14 suites**, **26 groups / 59 exact
receipts**, genuine Home Manager deployment and unchanged settlement gates, with
zero skipped/cancelled tests, uncertain core files or observed survivors. Core peak
workers are four; E starts only after pool drain.

`static-inputs.json` confirms changed static/lint inputs but identical typing source
`/nix/store/9n8y02gxgzrgl73skdmi7nx309srm2n5-source`, type evidence
`/nix/store/k4f9lpabgsdmavz87nbxnraqar6mqdss-pi-web-types`, runtime and dependency
identities. Full candidate acceptance reuses the lint evidence realized by focused
verification; static reuse is not fresh static execution. Both use production package
`/nix/store/9xqnp83zglbq9ww1fipc3kks8p4f310r-pi-web-0.9.3`.

### Observed timings and limits

| Interval (seconds) | Baseline | Candidate |
| --- | ---: | ---: |
| Full command wall, including in-command realization/export | 395.026 | 383.832 |
| Outer core command | 389.626 | 380.513 |
| Core realization/setup before lifecycle / after lifecycle | 1.748 / 0.250 | 1.570 / 0.256 |
| Core lifecycle | 387.628 | 378.687 |
| Lifecycle preparation through first-file start / final-file-to-settlement | 0.845 / 0.068 | 0.831 / 0.071 |
| First-file start → final-file end | 386.715 | 377.785 |
| Shared F/N pool | 286.771 | 278.476 |
| Pool drain → final E end (including ~2ms E dispatch) | 99.943 | 99.309 |
| Cumulative F / N / E file elapsed | 447.319 / 662.086 / 99.899 | 441.494 / 668.032 / 99.265 |
| Cumulative all-file elapsed | 1209.305 | 1208.791 |
| Browser support / definition preparation | 3.540 / 4.967 | 3.717 / 4.841 |
| Browser whole-group client envelope | 229.727 | 229.395 |
| Browser / deployment outer intervals | 238.237 / 26.073 | 237.956 / 25.141 |
| Browser-through-service branch | 266.325 | 265.328 |

Preparation intervals include mixed realization/export/static-evidence/setup costs,
not isolated evaluator/compilation CPU measurements; exporter contracts still run.
Core and browser/service overlap, so these intervals are **not additive**. Command
walls exclude model/review/wait time and the separately recorded focused prewarming.

Trust starts at pool second **262.797→100.262**, ends **286.771→138.385** and is no
longer the final pool straggler. Its own elapsed time increases **23.977→38.124s**
when scheduled earlier in the pool; total file work is nearly unchanged (**-0.514s**). Observed
pool improvement is **8.296s**, file-window improvement **8.930s**, lifecycle improvement
**8.941s**, and complete command improvement **11.194s (2.83%)**. The extra command-wall
delta includes preparation differences; it is not all scheduling savings. This one
fresh sequential pair supports the packing hypothesis, not less executed work, a
repeatable/statistical guarantee, standalone-core CPU savings or the simulated8.194s
as a measured value. No cold-cache/ARM/CI promise or numerical performance gate is
claimed. No further benchmark campaign or P2 work was started.

Raw command logs, exact derived comparisons and unchanged-input assertions are
retained at `/tmp/pi-web-p1-estimate.mcSrPK/{baseline.log,focused.log,candidate.log,comparison.json,source-comparison.json}`.
The evidence-only plan update follows the tested implementation commit; application,
test bodies, manifest and runner inputs remain unchanged. Feature resources and all
historical resources were retained at that stage; rebase, integration, publication
and cleanup then awaited separate user authority. P1's subsequent integration at
`0d5d914515057c957b47a7b92d9164ddacd98bc7` does not change these measurement identities.

## P2 initial measurement and superseded stop — 2026-10-26

**Retraction:** the phase measurements remain valid for their identified inputs;
closing P2 on that basis did not. The stop considered only top-level owner compilation,
leaving 79.645s of retained imports unattributed. It did not establish immaterial
recoverable preparation overall. The user requested continuation; current work
below owns that unresolved boundary, without discarding the original evidence.

### Command, inputs and validation

From the dedicated worktree based on checked local main
`0d5d914515057c957b47a7b92d9164ddacd98bc7`:

```sh
nix run .#test -- core --jobs 4 --file lib/rpc-manager.test.mjs
```

Only temporary scalar instrumentation was added to `loadBackend` and `rpcStartup`;
original test bodies, inputs, assertions, loader options and cleanup were unchanged.
The instrumentation patch is retained at
`/tmp/pi-web-p2-rpc.rAl0PV/baseline-instrumentation.patch`. It records elapsed source
read/setup, TypeScript transpilation, static-import parsing, retained-import loop,
VM initializer compilation and fresh owner evaluation. Startup's separate helper
interval includes its intervening fixture/seed setup; it is not isolated import CPU.
All instrumented source is preserved in the immutable export as well.

- Immutable source: `/nix/store/g36gdyjqk7jv5527ya7gkwq570appwvz-source`;
  content/mode digest `f34391adfcb6a7b552f144fbd090edd6e88a73cdd052b2bb01f03823243b3742`.
- Report: `/tmp/pi-web-test-core.YdsSfG/run.json`; output
  `/nix/store/5lllhm8krl9s596lliwxgi0mwa1mpndj-pi-web-core-checks`;
  detailed evidence `artifacts/run-YAwA3K/{summary.json,inventory.json,events.jsonl,0000.tap}`.
- Node24.21.0, native x86_64 Linux,32 logical CPUs,58,316,578,816 bytes available
  at runner admission; requested/effective four workers. Only one selected file
  executes, without browser/service overlap. This is not comparable orchestration
  to the historical132.534s full-run file measurement or P1's full-run pair.
- Runtime dependencies:
  `/nix/store/28vpp6bpxj0algr4b4xigfca399flcmi-pi-web-node-modules-0.9.3`;
  private support `/nix/store/1gps3kh9225x4axd5j4b119i9dhchlln-pi-web-test-support-1.0.0`.
  Typegen/typecheck and lint actually ran during this invocation, producing
  `/nix/store/rsm0ygxhmg9s512x1mj2js84zg3dfkrk-pi-web-types` and
  `/nix/store/ljz9xgkca0wlwdhjki9mkszrrqimqr5z-pi-web-lint`.
  The output's `static-inputs.json` binds their separate sources and toolchain;
  no fresh static execution is inferred merely from the reusable evidence path.
- Passed69 tests /52 top-level bodies, zero skipped/cancelled,29 exporter contracts,
  static checks and bounded settlement (zero uncertain files/observed survivors).

### Measured phases, not a speedup

All27 `rpcStartup` invocations completed. Intervals are serial within each measured
invocation, wall-clock scalars rather than CPU or transitive-compilation profiles:

| Phase | Sum across27 startups | Median per startup |
| --- | ---: | ---: |
| Source read + require/Jiti setup | 0.011797s | 0.411ms |
| Owner TypeScript transpilation | 2.800031s | 83.165ms |
| Owner static-import parsing | 0.346434s | 11.517ms |
| Retained static-import loop | 79.644748s | 2952.914ms |
| VM initializer compilation + small adapter setup | 0.007463s | 0.222ms |
| Fresh RPC owner evaluation | 0.004297s | 0.154ms |
| Separate startup helper/setup interval | 0.010725s | — |

Owner transpilation/parsing/VM compilation totals3.153928s. Excluding the first
invocation leaves **2.971039s** potentially recoverable by an ideal immutable reuse
implementation. This is a source-local upper estimate before lookup/revalidation
cost, **not measured savings**, and not a whole-core or complete-command estimate.
It is about3.46% of this85.890s focused file, while retained imports dominate. The
hypothetical cache would still require source/filename/global-name keys, fresh
exports/controller/capabilities/evaluation, admission checks and fault controls.
That small payoff does not justify adding it here. A tiny helper-composition change
also has no demonstrated payoff in the measured0.011s helper/setup interval.

The79.645s retained-import loop includes dependency transformation, resolution and
evaluation; it is not proven pure preparation or native SDK discovery. This probe
does not establish which of those costs is removable. Sharing initialized graphs
would cross an unverified environment/state/identity boundary; no such change was
made. A separately justified dependency-composition experiment remains possible,
not disproved or automatically authorized by this stop disposition.

| Command interval | Seconds |
| --- | ---: |
| End-to-end Nix command, including realization/export | 124.219 |
| Outer core interval | 119.452 |
| Outer setup/static realization before lifecycle | 32.621 |
| Core lifecycle | 86.734 |
| Lifecycle preparation to file start | 0.794 |
| Selected file execution | 85.890 |
| Final file to lifecycle settlement | 0.050 |
| Lifecycle end to outer core finish | 0.097 |

Raw command/timestamps and derived phase rows/identities remain at
`/tmp/pi-web-p2-rpc.rAl0PV/{baseline.log,baseline.start,baseline.end,baseline.exit,phase-measurement.json}`.
No separate prerequisite preparation, candidate comparison or full-suite benchmark
was run. Static preparation is included in command wall, not in the phase sums.

### Scope and review disposition

Independent read-only review (`01a177ce-9b70-7402-ad52-0010f932e3e0`) confirmed that
only inert preparation could be shared safely in principle; retained imports and
per-row initialization must remain fresh, and a fresh Jiti object is not proof of
a fresh dependency graph. Its proposed controls were not implemented because no
reuse candidate was adopted. Both instrumented helpers were restored exactly to
`HEAD`; only this plan changes. Fresh controllers, lexical globals, SDK types,
managers/wrappers, roots, original callback/work/Error identities, starts/binding
promises and release/join/restore/removal order therefore remain unchanged.

This follows the user's explicit stop condition for an immaterial recoverable
immutable-preparation slice. There is no coherent executable candidate, so no
candidate counterexample campaign or complete-acceptance checkpoint is claimed or
required for the final evidence-only delta. Earlier P1 acceptance retains its
original identities; it is not relabelled as P2 acceptance. No other opportunity,
rebase, integration, publication, session launch or cleanup was attempted.

## Reopened P2 candidate checkpoint

The deeper probe measured **11,799** Jiti transform requests for **130** distinct
actual source/configuration inputs across27 startups: **74.953s** of the **81.899s**
retained-import interval was inside the pinned transformer. This establishes a
substantial repeated pure-preparation target, unlike the small owner-only slice.

The receiving candidate adds only a fixture-local bounded memory store for pinned
successful transformation text. Each dependency still resolves/reads/evaluates as
before; owner transpilation/initialization, globals, capabilities and native paths
are unchanged. Only `rpcStartup` opts its fresh retained loader into this boundary.
`docs/testing.md` owns the maintained mechanism and limitations.

One sequential diagnostic pair used the same `core --jobs 4 --file
lib/rpc-manager.test.mjs` command and identical scalar instrumentation. All69 cases
and11,799 requests remain; source inventory differences are exactly the loader
opt-in seam, new preparation helper and RPC opt-in. Dependencies are identical.

| Seconds | Instrumented baseline | Instrumented candidate |
| --- | ---: | ---: |
| Command wall including realization/export | 127.859 | 51.261 |
| Outer preparation before lifecycle | 32.945 | 33.552 |
| Core lifecycle | 89.453 | 12.623 |
| Selected RPC file | 88.604 | 11.745 |
| Retained-import interval | 81.899 | 6.765 |
| Transform callback interval | 74.953 | 1.289 |

This is a focused observed reduction, not complete-command/core-wide savings or
isolated CPU time. Only one file executes despite four requested/effective slots;
neither run overlaps browser/service work. The130 inputs are measured unique
callback inputs, not an independently counted cache-hit total. The final candidate
also rejects non-enumerable options/proxies; ordinary measured inputs are unchanged.
Full comparisons, exact sources/digests/static/dependency identities, raw rows and
commands are retained at `/tmp/pi-web-p2-retained.9zEye4/{profile.json,profile-comparison.json,profile.log,candidate-profile.log}`.

Focused5-receiver verification passed **101 tests**, including the native model-
config and closure counterparts, report `/tmp/pi-web-test-core.UVBi9y/run.json`.
Controls cover same-filename/mtime original→mutant→restored bytes, fresh owner and
dependency state/classes/effects, current aliases/missing reads/capabilities,
original work/Error/root identities including earlier real registry callbacks,
default option parity, failure/result non-retention and unsupported configurations.

The deliberate omitted-source-key fault failed the named mutant-byte runtime
assertion and exposed suppressed parse failure; it was restored exactly. Independent
review then found a genuine non-enumerable-input key collision. A regression failed
specifically at that collision before the descriptor guard was corrected; it also
checks warmed-cache diagnostic failures and throwing getter Error identity. The
corrected port run passes8 tests, report `/tmp/pi-web-test-core.piWIRv/run.json`.
Failed evidence is retained at `/tmp/pi-web-test-core.{mW7bkM,9v0OyW}/run.json` and
`/tmp/pi-web-p2-retained.9zEye4/{source-key-fault.log,nonenumerable-red.log}`; no
unchanged-failure retry or assertion/deadline relaxation occurred.

Independent pinned-loader/design and final implementation review by
`01a177da-9860-7402-ad52-001546539dca` found no remaining blockers after that correction.
This is bounded source review, not general environment-transition certification.
Diagnostic instrumentation is removed. The first coherent reviewed candidate is
ready for the required complete four/four checkpoint; no optional expansion is
started while that is pending.

## Completion Checklist

### This analysis

- [x] Quantify the existing critical path and separate bodies, residual and wall.
- [x] Investigate six independent aspects with read-only subagents and source refs.
- [x] Rank concrete changes, simulations, safety gates and rejected/deferred options.
- [x] Produce this proposed implementation sequence without running or changing tests.

### Authorized P1 implementation only

- [x] Adopted change preserves original coverage, inputs, native authority and isolation.
- [x] Focused runner/manifest and relevant failure/settlement contracts pass on identified inputs.
- [x] One comparable pair records observed packing benefit and its single-pair limits, not simulated savings.
- [x] Complete core/static/plugin, browser/terminal and deployment acceptance passes.
- [x] Existing owning guide and live scheduling metadata match the unchanged advisory semantics.

P1 is complete and integrated at `0d5d914515057c957b47a7b92d9164ddacd98bc7`.
P2 alone now has separate implementation authority, starting from that checked local
main in `/home/robert/projects/3rdparty/pi-desk-worktrees/rpc-fixture-preparation`,
branch `perf/rpc-fixture-preparation`; CodeGraph was initialized before research.
Other opportunities remain deferred; this multi-opportunity plan is not fully
executed or archived.

### Initial P2 slice (historical; overall P2 remains open)

- [x] Measure existing owner compilation/parsing, retained imports and fresh initialization.
- [x] Decide whether simple immutable reuse is justified; stop with quantified finding.
- [x] Remove temporary instrumentation; verify executable inputs equal starting main.
- [x] Record exact command/source/dependencies, fresh/static execution and timing limits.
- [x] Not applicable: optimization correctness controls and complete candidate acceptance;
  no executable optimization candidate was adopted.
- [x] Independently review the evidence-only plan; retain feature resources unintegrated.
  Review found no blockers; writer's `git diff --check`, relative-link target check
  and exact changed-path/helper comparisons passed. Reviewer had file-reading tools
  only, so repository-wide equality is writer verification, not independent Git evidence.

### Reopened P2 completion

- [x] Attribute retained-import transformation and repeated actual inputs with the existing fixture.
- [x] Adopt only a demonstrated bounded reduction; retain fresh owner/dependency evaluation.
- [x] Verify affected consumers and source/configuration/capability/state/callback counterexamples.
- [x] Measure comparable focused baseline/candidate and record preparation/execution/wall identities.
- [ ] Independently review and complete core/static/plugin, browser/terminal and genuine deployment acceptance.
- [ ] Record final evidence, local feature tip and retained resources; do not integrate or expand scope.

## Investigation provenance and known gaps

Six independent read-only sessions covered RPC (`01a1774e-fdd4`), native timers
(`01a1774e-fddf`), Git (`01a1774e-fdda`), exclusive tail (`01a1774e-fdd8`), caches
(`01a1774e-fddc`) and timing/simulation (`01a17612-7276`). Full sessions remain
inspectable; the findings above distinguish source facts from future experiments.

**Known gaps:** P1 has one matched fresh four/four pair, not repeated statistical,
standalone-core, cold-cache, ARM or CI timing evidence. Reopened P2 has one matched
focused instrumented pair, not repeated statistical or whole-feedback speed evidence;
complete acceptance is pending. Remaining non-transform import costs are not further
decomposed, and no general Babel environment-transition guarantee is claimed.
Other opportunities, native cache/fence compatibility and some pinned SDK
loader/resource closures remain deferred. Simulations are not promises.
