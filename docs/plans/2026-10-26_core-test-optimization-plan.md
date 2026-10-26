# Core test optimization — investigation and proposed execution

**Status: P1–P3 complete and integrated; opportunity #4's bounded non-RPC
investigation is complete with a measured stop and no cache adopted.** P3 and its
Move correction were merged into local main at `666a75ef71ae6ae5057fa4e5b1b2124c6ebf3b19`; the five prior
feature worktrees/branches were subsequently cleaned up by explicit request.
Their retained-state narratives below are historical, not current resource claims.
The renewed P3 source-matched pair passes all levels. E tail shortens, but total
feedback is essentially unchanged; no meaningful whole-feedback speedup is established. P2 was subsequently merged into local main at
`ab6b2fa11e3d38fb4cc65a661f3ef9001e8ae534`; its earlier retained-state evidence below
remains historical. The first stop at `d532fedb44cc819b18085331168d9d78157a01b7`
was premature: it disposed only of the small owner-compilation slice, not the dominant
retained-import cost. The user explicitly requested thorough continuation in the
same retained worktree. P1 was merged
into local main at `0d5d914515057c957b47a7b92d9164ddacd98bc7`. A subsequent explicit
request authorized P2 only: measure repeated RPC fixture preparation, adopt only a
demonstrated simple reduction, preserve isolation, verify and retain local feature
commits. P2 integration was separately authorized afterwards. Opportunity #3 now
has its historical bounded authority below; the current #4 scope follows.
Opportunities #5–6 and the separate Node compile-cache candidate remain deferred.
Historical investigation and P1/P2 evidence retain their original identities.

## Goal

Reduce core feedback time without losing the real owners, original inputs,
assertions, error/settlement checks or native authority established by the completed
browser-retirement work. Distinguish less work, better scheduling, faster focused
feedback and faster complete acceptance; none implies the others.

**Opportunity #4 disposition: no repeated transformation target in the measured
navigation receiver.** The bounded scope was to inspect
`components/navigation-runtime.fixture.mjs` and/or
`components/browser-lower-runtime.fixture.mjs`, starting with one actual existing
receiver. Measure repeated actual source/configuration transformations, not loader
construction counts; inspect pinned module-cache behavior and attribute any dominant
import interval before stopping. Adopt only a demonstrated small fixture-local
immutable preparation reduction, preserving resolution/source reads, evaluation,
module-cache settings, all inputs/assertions/deadlines and lifetime/native fences.
No generic cache platform, compile-cache rollout, shared disk cache, production
feature change, lane promotion, wait/Git/browser work or next opportunity is
included. Independently review findings or a coherent candidate; adopted code
requires counterexamples, a matched four-slot comparison and complete acceptance.
Local feature commits are authorized; rebase, integration, publication, ordinary
session launch and resource cleanup require a separate request/approval.

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

**Original non-RPC spike proposal (measured disposition below):** a per-file memory
cache of successful pure transform results in existing repeated fixture construction,
initially one of
`components/navigation-runtime.fixture.mjs` or
`components/browser-lower-runtime.fixture.mjs`. Preserve existing resolution,
evaluation, module-cache settings and fences. Bound entries/bytes; key actual
source, filename and understood effective transform settings/implementation.
Bypass custom/stateful/unsupported options. Do not cache failures, Error objects,
exports, windows, stores, registries, promises or account/native bindings.

This targets repeated within-file transformation, not the first cold import of
every E process. It overlaps RPC preparation ideas: do not build both before
measuring and attributing their distinct contributions. The bounded navigation
receiver below showed no repeated transforms; no preparation store was adopted.

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

## Historical P1/P2 execution scope — completed; other opportunities separately authorized

Keep one writer, one active change and normal four-worker admission. Independent
review remains useful; packet counts and universal lifetime theorems are not gates.

- [x] **P1: cheap scheduling candidate.** Update only trust's missing estimate;
  verify runner/manifest contracts. Separate implementation commit and matched
  measurement are recorded below. P1-only completion does not authorize P2–P5.
- [x] **P2: targeted RPC preparation.** Reopened attribution demonstrated dominant
  repeated dependency transformation. The bounded opt-in code-string reuse preserves
  fresh evaluation; focused source/configuration/state/callback controls and full
  acceptance pass on identified inputs below.
- [x] **P3: first coherent checkpoint.** The first reviewed P2 candidate completed
  normal full four/four acceptance. No timer/Git/classification/browser or further
  cache slice was started; this checkpoint is the bounded finish.
- [ ] **P4: optional further slice, only if worthwhile.** Coordinator-only N review,
  one pure-transform cache site, or native wait overlap. Skip candidates with weak
  benefit-to-complexity, unresolved ownership or noise-sized savings.
- [x] **P5: bounded P2 close.** Record actual work removed and focused/complete
  results separately; retain the retracted stop and deferred risks. Other
  opportunities remain proposals, not automatic follow-on work.

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
Diagnostic instrumentation is removed. The first coherent reviewed candidate
`574cd1ad471f89639aa416593452cd78e5ecec32` completed the required four/four
checkpoint below; no optional expansion was started.

## P2 complete acceptance and final disposition

The coherent implementation commit is
`574cd1ad471f89639aa416593452cd78e5ecec32`. From its clean linked worktree:

```sh
nix run .#test -- all --workers 4 --jobs 4
```

**Passed:**509 files /4,177 tests /14 suites, all26 browser/terminal groups /59
exact receipts and the genuine Home Manager deployment VM. Zero skipped/cancelled
or failed core tests, uncertain core files or observed survivors. Every group
retained exact expected/completed coverage, settled resources, no harness errors
and a closed port. Deployment confirms settled clients, inactive service/MainPID0,
absent authenticated cgroup and refused port. This is bounded ownership evidence
under Nix containment, not certification of arbitrary escaped descendants.

Comparison to the retained P1 candidate summary confirms the same509 paths, lanes
and estimates and all4,171 original outcomes in their original order. Only the
startup-port file adds six outcomes (four top-level bodies plus two subtests).
Original test bodies/inputs/deadlines, native authorities and worker counts remain
unchanged. The production package remains
`/nix/store/9xqnp83zglbq9ww1fipc3kks8p4f310r-pi-web-0.9.3`; checked realized package
paths exclude the new/changed fixture support and registered test.

| Identity | Value |
| --- | --- |
| Immutable complete source | `/nix/store/fp3p25zznzpm1fi6ncdhqnbim5lsqq2f-source` |
| Outer content/mode digest | `7d59df8851b29e4dc37d01e90c16824bad30cb6a479bf21debe225301c47a3fe` |
| Source export and admission | `/tmp/pi-web-test-source-M5Psz5/{source.json,selection.json}` |
| Core report | `/tmp/pi-web-test-core.mIcbwF/run.json` |
| Immutable core output | `/nix/store/rkiavwx0vnicd3sn2l10isq98d2z96db-pi-web-core-checks` |
| Core detailed artifacts | `artifacts/run-KbDVuz/{summary.json,inventory.json,events.jsonl,*.tap}` within that output |
| Browser report | `/tmp/pi-web-test-browser.EfECLf/run.json` |
| Genuine deployment report | `/tmp/pwv-ASbqf0/run.json` |

Core's `static-inputs.json` binds Node24.21.0, runtime modules
`/nix/store/28vpp6bpxj0algr4b4xigfca399flcmi-pi-web-node-modules-0.9.3`, private
support `/nix/store/1gps3kh9225x4axd5j4b119i9dhchlln-pi-web-test-support-1.0.0`, typing
source `/nix/store/majsir19c2dywnj7fvrfb3sii6wwb4cv-source` and separate lint source.
Full acceptance reuses exactly the final restored-port run's typegen/tsc evidence
`/nix/store/qh06kmg2dbj3a3bpk8ypgflavl9w7bwk-pi-web-types` and lint evidence
`/nix/store/5y1llbfjqvh5lg9f2vqigkzpzvr67vgl-pi-web-lint`; those checks do not execute
again in the full command. Exporter contracts and all effectful tests execute fresh.
No separate preparation command preceded the full invocation beyond the recorded
focused checks. The source/dependency and pinned-Jiti file identities are retained
in `/tmp/pi-web-p2-retained.9zEye4/acceptance-summary.json`.

Native x86_64 Linux outer admission (`selection.json`) observed32 CPUs and
58,857,734,144 available bytes; the later core-local admission observed
58,055,184,384 bytes. Overlap was admitted with requested/effective four core
workers and four browser sandboxes. These are resource estimates at different
stages, not reservations. Full timings:

| Interval | Seconds |
| --- | ---: |
| Complete command wall including realization/export | 370.947 |
| Outer core | 365.953 |
| Outer core preparation before lifecycle / after lifecycle | 1.715 /0.278 |
| Core lifecycle | 363.960 |
| Lifecycle preparation / final-file settlement | 0.858 /0.074 |
| First-file start to last-file end | 363.028 |
| F/N pool / tail after pool | 259.812 /103.216 |
| Browser support / definition preparation | 3.684 /4.806 |
| Browser group-client envelope / outer browser | 240.238 /248.732 |
| Deployment outer / guest evidence | 25.356 /18.703 |
| Browser-through-deployment branch | 276.315 |

Cumulative F/N/E file elapsed is508.476/526.025/103.171s; those overlapping costs
are **not** whole-suite wall savings. RPC is13.984s in the full overlapping run,
not a matched comparison to its focused baseline. The focused observed file
reduction is **76.858s /86.74%** in the identified instrumented pair. There is no
new matched full-suite baseline and no whole-suite percentage, CPU-savings,
cold-cache, statistical, ARM or CI claim. The full370.947s result is acceptance
and observed feedback evidence, not a relabelled P1 comparison.

Raw full log/timestamps/exit and derived verification remain at
`/tmp/pi-web-p2-retained.9zEye4/{all.log,all.start,all.end,all.exit,acceptance-summary.json}`.
This final plan update is evidence/status only: executable, test, guide, manifest,
runner and dependency inputs remain at the accepted implementation commit. Its
proportional follow-up checks are documentation review, link targets, whitespace
and exact changed-path/input verification—not another full suite. Feature branch
`perf/rpc-fixture-preparation` and worktree
`/home/robert/projects/3rdparty/pi-desk-worktrees/rpc-fixture-preparation` remain.
No rebase/integration/publication/cleanup or other opportunity is included.
Final independent evidence review found no substantive blockers; its admission-
stage and stale-heading nits were corrected. Writer checks confirm that only this
plan differs from accepted implementation inputs, relative link targets exist
and `git diff --check` passes. These are source checks, not browser-link verification.

## Authorized Move blocker continuation

The user subsequently requested investigation/correction of the retained Move
failure, then completion of acceptance, with any performance control/candidate
receiving the same correction. Continue in the existing clean feature worktree
from `7f2b8a6d9531af3889c9e97b62c924cad664bdb4`; local main was rechecked and remains
`ab6b2fa11e3d38fb4cc65a661f3ef9001e8ae534`. Keep the two reviewed scheduling entries
fixed. This is not authority for another optimization, integration, publication,
cleanup or ordinary session launch.

- [x] Attribute the exact retained post-Move source reads using trace ordering and
  the actual navigation/Sidebar owners; distinguish product behavior from observer scope.
- [x] Correct only the responsible owner and add a deterministic red/green regression
  preserving missing/uncertain history and explicit checkout/navigation semantics.
- [x] Independently review the bounded fix, run focused real Move acceptance, then
  complete four/four core/static/plugin/browser/deployment acceptance. The
  same fix is present in both members of the renewed scheduling comparison.
- [x] Record identities, failures, measured limits and local commits; retain resources
  unintegrated and stop without expanding to opportunities #4–6.

### Move diagnosis and minimal correction

Independent retained-trace review `01a17841-e7be-7402-ad52-006fd15a07da` places the
failure **after** execute/reconcile, not in initial-page request observation:
execute12:31:40.781Z, reconcile40.873Z; destination-model reads with the selected ID
at40.900/.922Z; source account-selection at40.942Z returns400 `Valid cwd required`,
then source model/trust reads without session ID at40.943/.944Z; destination-session
reads resume40.955Z. RSC navigation to `/` begins40.956Z, before Close41.525Z.
This is consistent with an unbound source-composer interval, not merely an overly
broad initial-load observer. The actual product-owner reproduction below closes
causal attribution; the trace has no callback-level initiator stack.

`SessionBulkMoveDialog.execute` retains dispatch-time `onSettled` across awaited
execute/reconcile. That Sidebar callback retains the dispatch-time navigation
`handleSessionDeleted`, which formerly spread its captured source `selectedSession`
back into state when uncertainty settled. Canonical destination metadata can
arrive **before** that settlement. Restoring the old row then makes the real
Sidebar switch back to source, clear selection and expose a fresh source composer.

Only `hooks/useSessionNavigation.ts` changes production: settlement reads the latest
selected-session ref for both affected-ID guards and deletion's fallback cwd;
uncertainty functionally updates the current same-ID row to `unavailable`. It keeps
canonical path/cwd/project metadata and never clears an already-committed peer
selection. The intentional history-only remount, conservative unknown outcome,
confirmed-destination behavior and explicit project-switch semantics are retained.
No Sidebar synchronization rewrite, browser wait/assertion/deadline, SDK/native
mutation, scheduling entry or runner/orchestration change is included. The owning
session guide now documents settlement-time selection ownership.

The additive case in existing `components/AppShell.tab-session.test.mjs` captures
the actual production callback before real Sidebar catalogue refresh, verifies
canonical destination adoption, then invokes delayed uncertainty. It records all
primitive commit states, requiring no restored source row/composer, retained
current ID/destination/unavailable state, exactly the intentional remount and no
URL clearing/source working reads. Late undefined/null/confirmed settlement after
explicit peer selection cannot change peer identity/key/router. This mounted owner
is not full models/trust runtime proof; the unchanged installed Move group supplies
that receiving boundary. Existing original bodies and509-file discovery remain;
one new case makes expected complete coverage4,178 tests/14 suites.

Evidence, commands and counterexamples:

- First `core --jobs 4 --file components/AppShell.tab-session.test.mjs` failed at a
  **fixture precondition**: destination File/Git reads were undeclared. Report
  `/tmp/pi-web-test-core.NJgju9/run.json`, command39.315s; no production fix was in
  place. Declare the actual destination capabilities rather than filter failures.
- The corrected **invalidation-before-canonical** ordering passes unchanged product
  code:8 tests, `/tmp/pi-web-test-core.UmqRua/run.json`,40.639s. It does not reproduce
  the failed schedule and does not justify the initially suspected broader Sidebar
  rewrite; that proposal is not adopted.
- **Canonical-before-late-settlement red:** same focused command, source
  `/nix/store/b2yjapyxj94cwd2qfb2y683l668q73pq-source`, digest
  `f0980222d98eee6514eed2beb7f579bd6776ea3a4b5004917f0bbc61b47bbc6e`,
  report `/tmp/pi-web-test-core.ircFYw/run.json`,39.822s. The named runtime assertion
  fails with a restored source row followed by two unbound-source composer commits.
  Seven original cases pass; no cancelled/skipped/uncertain files or observed
  survivors. This is the original production behavior, not an import/setup red.
- Interim ref-snapshot correction passes4 files/29 tests,43.808s,
  `/tmp/pi-web-test-core.cbl14O/run.json`. Final code additionally applies the
  functional same-ID update recommended by independent review; do not relabel the
  interim run as final-code execution.

Final core iteration:

```sh
nix run .#test -- core --jobs 4 \
  --file components/AppShell.tab-session.test.mjs \
  --file components/AppShell.workspace-memory.test.mjs \
  --file components/SessionNavigation.cross-bridges.test.mjs \
  --file components/SessionNavigation.workspace-bridge.test.mjs \
  --file components/SessionBulkMoveDialog.behavior.test.mjs \
  --file components/session-catalog-helpers.test.mjs
nix run .#test -- e2e --group move
```

The core command passes6 files/44 tests plus29 exporter contracts and mandatory
static evidence, requested/effective four workers, no cancelled/skipped/uncertain
files or observed survivors. Command47.586s; outer core42.515s includes36.519s
pre-lifecycle static/realization and5.902s lifecycle. Report
`/tmp/pi-web-test-core.G10V8I/run.json`, source
`/nix/store/322wvbnh37gk7ha8di3fq5mpmp8j66gk-source`, digest
`8eaa7ba901a347aeaa630740e0937068a9603f8f14fc454b26544e513598b6d4`.
Typegen/tsc and lint executed for the final changed application, producing
`/nix/store/4g8znq0sjjgj7blcbiizf3hagafr0azr-pi-web-types` and
`/nix/store/qpv376hl2a50vk6baf4h7djwygn3pbr2-pi-web-lint`.
Raw logs/timestamps/source identities and phase evidence for all iterations remain
under `/tmp/pi-web-move-scope.BHLibi/`, including `focused-evidence.json`.
Independent exact-source review approves the minimal callback correction and
regression, with no blockers; no new F-lane native effect or helper cleanup
obligation was added.

Focused installed `e2e --group move` passes both unchanged desktop/mobile receipts,
with no harness errors, complete resources/pipe/group settlement and closed port:
`/tmp/pi-web-test-browser.psSxAv/run.json`, source/digest identical to final focused
core above. Output `/nix/store/q8nkgrnch1agk1wk20gcjr0aniv61hkb-pi-web-browser-move-diagnostics`.
Command113.472s includes87.019s support/package realization and4.898s definition
preparation; actual capsule17.259s. New package
`/nix/store/8a1h30ifi4xad0lph3rawqh4mxvrdvi9-pi-web-0.9.3` was built only by Nix in
an isolated builder. The unchanged browser assertion now passes with the current
selection correction, not a wait, retry, error filter or relaxed denial.

Renew the one complete four/four pair with this same hook/regression/package on
both sides. The control differs only by intentionally serializing the two reviewed
native entries (N→E in live metadata), not reverting the product fix. Warm each
manifest's declared static evidence before its full command; report that preparation
separately. Keep every original browser group/deadline and complete settlement gate.
The earlier373.800s/failed207.021s attempt remains historical, not the new baseline.

### Renewed complete acceptance and measured limit

Implementation: `6477aac61bbcf42be2caf39e937dd0219f912a69` on the retained feature
branch. Writers were paused; the existing fresh `core --jobs 4 --inventory-only`
export supplied the matched control copy (not execution/static evidence). Its
only change is E instead of N for the coordinator and skills-content entries;
reasons, estimates, holds, every original/new case, app fix, browser inputs and
orchestration are identical. Control preparation ran
`core --jobs 4 --file components/AppShell.tab-session.test.mjs`:8 passes,
40.885s, `/tmp/pi-web-test-core.lax8BD/run.json`, realizing control lint evidence.
This and the recorded candidate focused/Move preparation precede the measured
commands; none is hidden in a full-command speedup.

Sequential control then candidate, no other task-owned checks:

```sh
nix run .#test -- all --workers 4 --jobs 4
```

**Both pass:**509 files/4,178 tests/14 suites, zero failed/skipped/cancelled/todo,
uncertain files or observed survivors; all26 browser/terminal groups/59 exact
ordered receipts, no harness errors, complete collection/settlement and closed
ports; genuine Home Manager deployment with settled clients, inactive service,
MainPID0, authenticated absent cgroup and refused port. Peak/requested/effective
core width is four, E waits for full pool drain. Control316F/101N/92E becomes
candidate316F/103N/90E. Both promoted files run with three active peers in the
candidate; all78 original four-cohort cases remain unchanged.

| Identity | Matched serial control | Pooled candidate |
| --- | --- | --- |
| Immutable source | `/nix/store/vbwna4i873npx4zalyz23p9p0hsdxp1m-source` | `/nix/store/jllyqw19927nyq4cl4qgwby8bcln06dc-source` |
| Content/mode digest | `6d89fdf945391728d6cbc182f900c922c4e891b95b97fd50feccaf8b3ce11609` | `37fea9216bae99f229a8fdb713c530ba548f9f53bd2240e8bf39c104b305d93c` |
| Export/selection | `/tmp/pi-web-test-source-V1KBN8` | `/tmp/pi-web-test-source-2pGxVD` |
| Core report | `/tmp/pi-web-test-core.oFgkzf/run.json` | `/tmp/pi-web-test-core.L1xphv/run.json` |
| Core output | `/nix/store/8cwcrzfdamsx4qym35hw6ggnxxx0qxkn-pi-web-core-checks` | `/nix/store/7177z0gvk0k8khyfawhkqbsl7gsnjh6i-pi-web-core-checks` |
| Detailed directory within output | `artifacts/run-S9H09z` | `artifacts/run-mZDSb6` |
| Browser report | `/tmp/pi-web-test-browser.r2q4Kl/run.json` | `/tmp/pi-web-test-browser.9MhqaD/run.json` |
| Deployment report | `/tmp/pwv-csqB4R/run.json` | `/tmp/pwv-4iPoUp/run.json` |

All1,574 canonical file paths/modes match; only the two live JSON lane values
differ. All509 test-body hashes and paired registered/completed outcomes/counts
are identical. Compared with the original baseline, all4,177 original outcomes
remain in original relative order and only the one callback regression is added.
Both use application package `8a1h30ifi4xad0lph3rawqh4mxvrdvi9`, unchanged pinned
Node24.21.0/runtime/private dependencies, typing source `3z64ndjsgnhbhrqh3ls0w9l25sqbvk2z`
and type evidence `4g8znq0sjjgj7blcbiizf3hagafr0azr`. Full commands reuse their
prepared static outputs: control lint `dr54q6y0m32yjlzj3adb9qzzzi5xalc2`, candidate
lint `qpv376hl2a50vk6baf4h7djwygn3pbr2`; exporter contracts/effectful tests are fresh.
Every store identifier in this paragraph is under `/nix/store/` with the descriptive
suffix bound in `static-inputs.json`/reports, not a new freshness claim.

| Seconds | Serial control | Pooled candidate |
| --- | ---: | ---: |
| Full command including in-command realization/export | 349.302 | 348.897 |
| Outer core | 346.140 | 345.661 |
| Core pre-lifecycle / lifecycle / post-lifecycle | 1.599 /344.193 /0.348 | 1.596 /343.743 /0.322 |
| Lifecycle to first file / last file to settlement | 0.828 /0.071 | 0.828 /0.073 |
| File window | 343.294 | 342.842 |
| Shared F/N pool / E tail | 240.745 /102.549 | 246.967 /95.875 |
| Summed F /N /E file work | 481.232 /477.345 /102.504 | 478.589 /504.853 /95.832 |
| Summed all-file work | 1061.080 | 1079.273 |
| Pool occupancy, four workers | 99.543% | 99.552% |
| Browser support / definition preparation | 3.696 /4.774 | 3.650 /4.798 |
| Browser group-client envelope / outer | 222.107 /230.581 | 226.256 /234.707 |
| Deployment outer / guest | 73.362 /17.526 | 25.203 /19.396 |
| Browser-through-deployment branch | 305.953 | 262.023 |

The tail is6.674s shorter, while the pool is6.222s longer; the file window improves
only0.452s and command wall only0.405s. Summed file work **increases18.193s**, rather
than demonstrating work removed. Coordinator is4076.533→3978.282ms; skills is
1984.550→2968.714ms under contention. Native-tools remains E at3290.865→3240.653ms;
Pause remains E at2636.616→2684.330ms. These actual durations do not refresh other
hints or turn ideal `S-S/4` arithmetic into a scheduling bound.

**Measurement limit:** this is one source-matched fresh four/four pair, not a
statistical or machine-exclusive experiment. Outer admission observed32 CPUs and
58,381,451,264 /57,398,493,184 available bytes; core-local observations were
57,784,803,328 /56,713,695,232 bytes. An independently owned2-vCPU VM and normal
host load were observed; headroom admitted unchanged four/four, not a reservation.
Both core/static/browser/package prerequisites were warm. Control additionally
realized the new shared deployment closure/driver inside its command; candidate
reused the exact same `qbp39raxz8m8z204d53qq94rcf003dhl-pi-web-service-driver`.
Thus the full envelopes are **not a matched warm-prerequisite whole-feedback
benchmark**, and the roughly48s service-outer difference is not scheduling savings.
Core remains critical in both, but preparation/contention differences still preclude
a causal interpretation of a0.405s wall delta. Do not subtract overlapping branches
or compare this corrected-package pair directly with the earlier373.800s baseline.
No meaningful overall speedup, CPU savings, cold-cache/ARM/CI or escaped-descendant
claim is made; no extra timing campaign is justified by this noise-sized result.

Exact source/outcome/static/settlement assertions, raw command logs/timestamps and
reports are retained in `/tmp/pi-web-move-scope.BHLibi/`, particularly
`complete-comparison.json`, `pair-inputs.json`, `control-all-analysis.json`,
`candidate-all-analysis.json`, `control-preparation.json` and `run-pair.sh`.
The first coherent corrected candidate is fully accepted. The final evidence-only
plan commit leaves app/test/manifest/runner inputs at `6477aac`; proportional checks
are documentation review, whitespace and exact unchanged-input verification, not
another full suite. Feature branch/worktree and historical/current diagnostics
remain; no rebase, integration, publication, manual cleanup or further opportunity.
Final independent evidence review approves the acceptance/coverage/measurement
statements; its lane-only wording nit is clarified below. Writer checks confirm
only this plan differs from accepted inputs, the reviewed manifest hash and local
main are unchanged, and `git diff --check` passes.

## Opportunity #3 — bounded execution plan

Checked starting local main: `ab6b2fa11e3d38fb4cc65a661f3ef9001e8ae534` (clean).
Dedicated branch `perf/core-exclusive-cohort`, worktree
`/home/robert/projects/3rdparty/pi-desk-worktrees/core-exclusive-cohort`.
CodeGraph initialized before source research. One writer coordinates checks;
independent read-only pinned-effect/eligibility review is bounded to this cohort.
The original P2 acceptance is a reference, not this task's baseline.

- [x] Review the four actual receivers, helpers, pinned eager imports, native effects
  and success/failure settlement; adopt only justified lanes and precise holds.
- [x] Verify adopted receivers and existing manifest/discovery/settlement contracts;
  no helper changes require new regressions.
- [x] Independently review exact eligibility and unchanged original coverage.
- [x] Complete four/four comparison/acceptance after the separately authorized Move
  correction. The initial failed checkpoint is retained below; both corrected
  complete runs pass, without another unchanged retry or unmatched core substitute.
- [x] Record adopted files/holds, observed limits and reviewed local feature commits;
  retain branch/worktree unintegrated and stop before another opportunity. The
  shorter tail does not establish meaningful whole-feedback improvement.

Stop rather than expand if safety work becomes disproportionate to modest savings.
Source/path evidence alone does not qualify execution; separate processes do not
prove source-write confinement or arbitrary descendant closure. E does not fix leaks.

### Exact cohort disposition

For the **lane-only cohort change**, only live `nix/test-lanes.json` changes
executable scheduling. That change preserves original tests/helpers/production
code, discovery, existing pool estimates, workers, resource admission, browser
queues, deadlines and settlement gates. The separately authorized Move correction
and additive regression are common to both corrected comparison members above.
The immutable historical audit is untouched. No failure-cleanup fix is shipped.

| File | Adopted disposition | Source/native and failure-lifetime basis |
| --- | --- | --- |
| `lib/acceptance/coordinator.test.mjs` | **N**, advisory 3000ms | Real snapshots/settings/ledgers, synchronous Git probes and awaited `flock --no-fork` recovery are native despite the synthetic executor. Unique fixture project/agent roots contain writes. Disposal closes admission before fixture releases gates, joins serial tails/pumps and submissions, clears its timer, restores env and retains roots after drain failure. Actual held capture/verification/executor, rejection, uncertain settlement and persistence-failure cases remain. Default executor is imported but never invoked by the second denied coordinator. |
| `app/api/skills/content/route.test.mjs` | **N**, advisory 2000ms | Real FIFO/symlink/descriptor/path/permission operations remain. Exact pinned loader creates settings/package managers and resolves packages before filtering extensions: `noExtensions` alone is insufficient. Here private agent has no packages/settings; shared source has no `.pi/settings.json`; package-source lists and extension paths are empty. Project-trust lock/store is private, other resource/context/install annotations are reads, and no session binds `resources_discover`. Allowed-root catalogue awaits an empty private session scan (no dirty index/save timer). Requests finish before root removal. Re-review if source settings/packages or composition change; no actual source-write repair is justified. |
| `app/api/native-tools/route.test.mjs` | **Retain E** | Codemode registration/listing never executes a script; no QuickJS-worker hold is inherited. Ordinary replacement awaits retired-wrapper shutdown. Startup still constructs runtime/session owners before registry publication without a construction-failure disposal scope; fixture tracks IDs after successful status/body handling and sees current wrappers only. Failure/unpublished retirement ownership is not closed by this task. |
| `lib/session-pause.test.mjs` | **Retain E**, replace stale rationale | Existing cleanup already releases gates and awaits model refresh, abort, tracked work, SDK idle and wrapper shutdown. Suite root removal still lacks catalogue/scanner/background failure/timeout completion ownership. Catalogue and scanner barriers differ; captured-path index saves are distinct. Current transcripts are outside the default scanner directory, so no claim that every success leaves a dirty writer is made. Genuine10s deadlines remain real, not controlled clocks. |

New advisory hints round this task's baseline coordinator3152.243ms and
skills2212.857ms, not the historical opportunity table. The four baseline files
sum11.354s (native-tools3338.474ms; Pause2650.545ms). No ideal `S-S/4` arithmetic is
a scheduling bound or measured speedup.

Pinned runtime modules remain
`/nix/store/28vpp6bpxj0algr4b4xigfca399flcmi-pi-web-node-modules-0.9.3`.
Independent review found bounded eager SDK effects: package metadata reads,
`TOOLS_DIR` environment snapshot and process-local stream/provider registration;
barrel import does not run CLI `main()` or construct sessions. Plain pinned Jiti
retains ordinary module/native-import caching; runner `JITI_FS_CACHE=0` disables
disk transformations. Proper-lockfile's synchronous release clears its heartbeat
before returning. File processes isolate these globals, not the shared source cwd.
Pinned file hashes are retained in
`/tmp/pi-web-p3-cohort.1RK3PZ/pinned-imports.json`.

### Failure-path qualification (disposable diagnostic, not feature code)

After the baseline settled, a private copy of its exported source ran:

```sh
nix run .#test -- core --jobs 4 --file lib/acceptance/coordinator.test.mjs
```

The original held-capture case deliberately fails before normal gate release and
adds one rejecting peer disposal owner. The real fixture must still stop/drain the
actual coordinator, release the gate, reject both original tracked submissions as
`disposed`, clear pumps/timer, restore env and retain its root before its original
AggregateError. A bounded in-hook observer asserts each fact and emits
`P3_FAILURE_CLEANUP`. Other29 original cases pass; the one intentional failure is
not filtered, skipped or retried into a pass. Runner reports no uncertain files or
observed survivors. This diagnoses fixture failure ownership, not arbitrary native
descendants or a production supervisor's settlement from a synthetic result.

- First diagnostic: `/tmp/pi-web-test-core.YHnmel/run.json`, source
  `/nix/store/45453gxp4s8wyil9nkk8k99rprkjci9y-source`, digest
  `3adb268a19e766a7da92baac18a269892019d1a745ccbe3afe2ed576c1955168`,
  command43.623s. It reached the intentional body failure, but a later `t.after`
  observer did not run after the first hook rejected. That observation precondition
  did **not** qualify retained-root cleanup and is retained, not hidden.
- Corrected observation: `/tmp/pi-web-test-core.834Ibw/run.json`, source
  `/nix/store/1aadjnamljah7wj1b11nfrrb7x0zjap8-source`, digest
  `d2fe3f2ae853bf1193e2163282d1f9eb210eb451430033b224862442a92ee9bd`,
  command42.824s. Observer moved inside the original cleanup hook before its throw;
  all named predicates and the marker execute. This is a changed diagnostic, not
  an unchanged retry or helper fix. Both commands exit1 as intended, with30 tests,
  29 passes/1 controlled failure, zero cancelled/skipped and settled outer clients.
- Exact source copies, patches, logs/timestamps and exits remain under
  `/tmp/pi-web-p3-cohort.1RK3PZ/`; failed Nix derivations retain logs/build roots.
  No diagnostic/test/helper change enters the feature. Relevant original failure
  cases also run unchanged in focused and complete acceptance.

Independent read-only review `01a17820-c3ed-7402-ad52-005a5f017ed7` approves the
exact two N promotions and refined E holds, with no blocking finding. It confirms
receiver/helper bytes match baseline, original coverage is conserved and the
corrected failure observer runs before the original cleanup throw. Reviewed live
manifest SHA256: `ae712f5bb99a7fc9573e6a70af21a64b9045205253d6071d86138bc351f2e170`.
This is bounded pinned Linux composition eligibility, not general native lifetime,
escaped-descendant or speedup proof.

### Focused candidate verification

```sh
nix run .#test -- core --jobs 4 \
  --file lib/acceptance/coordinator.test.mjs \
  --file app/api/skills/content/route.test.mjs \
  --file app/api/native-tools/route.test.mjs \
  --file lib/session-pause.test.mjs \
  --file lib/test-runner.test.mjs --file lib/test-design.test.mjs \
  --file lib/test-lanes-audit.test.mjs
```

Passed7 files/127 tests plus29 exporter contracts and mandatory static evidence,
zero skipped/cancelled/uncertain files or observed survivors. Report
`/tmp/pi-web-test-core.8Pz7uz/run.json`, immutable source
`/nix/store/25z94ryr31i2bj2m9whi46aikvipnas2-source`, digest
`c5d78ffa713177c5378053044511e59a5384d88cb1206c6130862b92699eaab8`,
output `/nix/store/gqqkxr8alk6csmgp8832grg7pfg9x8dm-pi-web-core-checks`.
Requested/effective four workers; cases remain serial per file. Command49.545s,
outer core44.538s, pre-lifecycle32.499s, lifecycle11.949s, post-lifecycle0.090s.
Lint executed for the new manifest and produced
`/nix/store/grjzvkwmcyp0zmvrjgqgc8i8i6i74kp8-pi-web-lint`;
typegen/tsc evidence `/nix/store/qh06kmg2dbj3a3bpk8ypgflavl9w7bwk-pi-web-types`
and type source `/nix/store/majsir19c2dywnj7fvrfb3sii6wwb4cv-source` are reused.
This focused/static prewarming is separate from the complete comparison commands.
Exact Git diff assertions confirm only two new N entries, their two removed holds,
two refined retained holds and this plan; all existing reviewed entries, application,
original tests/helpers/runner and dependencies are unchanged. Evidence:
`/tmp/pi-web-p3-cohort.1RK3PZ/source-conservation.json`.

### First complete comparison attempt and bounded stop (historical)

Implementation commit: `6a5c60b80defb89070af248ba8b2b0beffdf508b`.
One sequential pair used the same command, physical worktree and orchestration:

```sh
nix run .#test -- all --workers 4 --jobs 4
```

Both selected native x86_64 Linux/Node24.21.0, four core workers/four browser
sandboxes and overlapping core/browser→deployment. Outer admission observed32 CPUs
and57,467,002,880 /57,787,777,024 available bytes; combined estimate remains16 CPUs/
28,991,029,248 bytes, not a reservation. No other task-owned checks overlapped.
Normal desktop/other task load means neither run is machine-exclusive.
Dependencies/package/type evidence were warm; baseline reused the P2 lint output,
candidate reused the changed-manifest lint output from the49.545s focused command.
No separate prerequisite build was performed. Nix logged an ignored invocation-
private SQLite eval-cache-busy message during candidate realization; execution
continued. The subsequent browser assertion, not that message, vetoed acceptance.

| Identity | Fresh baseline | Candidate (failed/incomplete) |
| --- | --- | --- |
| Git | `ab6b2fa11e3d38fb4cc65a661f3ef9001e8ae534` | `6a5c60b80defb89070af248ba8b2b0beffdf508b` |
| Immutable source | `/nix/store/hsi06bi09dykpv1l49iywna81z0zy674-source` | `/nix/store/z6l578k7rlj1hc31c6szy2774n5ab0f8-source` |
| Content/mode digest | `5e293c8ce501d45ae762a7d2bb59b887f54c4caf5c8fa595b59b39786ad2bb5b` | `44718b0ca74a89e35e37b52c913346710dc8eb4b6deccd40431c19d2b3b9896a` |
| Export/selection root | `/tmp/pi-web-test-source-Qk9sGl` | `/tmp/pi-web-test-source-ovxz5F` |
| Core report | `/tmp/pi-web-test-core.QLSme2/run.json` | `/tmp/pi-web-test-core.PKqCBW/run.json` |
| Browser report | `/tmp/pi-web-test-browser.Syllfr/run.json` | `/tmp/pi-web-test-browser.u1VAQW/run.json` |
| Deployment report | `/tmp/pwv-LZqdoe/run.json` | Not started: browser failed |

All1,574 exported file paths match; bytes/modes differ only at this plan and live
`nix/test-lanes.json`. Original test/helper/application/browser/source inputs and
package `/nix/store/9xqnp83zglbq9ww1fipc3kks8p4f310r-pi-web-0.9.3` are identical.
Manifest review conserves509 discovered files and4,177 tests/14 suites, with
316F/101N/92E →316F/103N/90E. These are planned candidate totals, **not** a claim
that aborted candidate core completed them. Evidence:
`/tmp/pi-web-p3-cohort.1RK3PZ/export-comparison.json`.

**Baseline passed:**509 files/4,177 tests/14 suites, zero failed/skipped/cancelled,
uncertain files or observed survivors; all26 browser/terminal groups/59 exact
receipts and genuine deployment. The VM confirms settled clients, inactive service,
MainPID0, absent authenticated cgroup and refused port. Core immutable output:
`/nix/store/s5yizhi5k2dl3xcc89gg7lj95qrb5b0p-pi-web-core-checks`, detailed
`artifacts/run-giJefl/{summary.json,inventory.json,events.jsonl,*.tap}`.

| Seconds | Baseline (complete) | Candidate (failed/incomplete) |
| --- | ---: | ---: |
| Full command including realization/export | 373.800 | 207.021 (failed; **not speedup**) |
| Outer core | 366.359 | 202.017 (aborted) |
| Core pre-lifecycle / lifecycle / post-lifecycle | 1.843 /364.189 /0.327 | No complete lifecycle output |
| Lifecycle to first file / last file to settlement | 0.897 /0.074 | Unavailable |
| File window / F-N pool / E tail | 363.218 /259.521 /103.697 | Unavailable |
| Summed F /N /E file work | 499.300 /533.891 /103.646 | Unavailable |
| Pool occupancy at four workers | 99.529% | No complete pool |
| Browser support / definition preparation | 3.767 /5.154 | 3.780 /4.939 |
| Browser client envelope / outer browser | 241.324 /250.248 | 193.105 /201.827 |
| Deployment outer / guest | 25.628 /19.171 | Not run |
| Browser-through-deployment branch | 278.021 | Incomplete |

Intervals overlap and are not additive; preparation is mixed realization/export/
static evidence/setup, not isolated CPU work. With incomplete candidate execution,
there is **no measured E-tail reduction, whole-feedback gain, cumulative-work delta
or valid matched speedup**. The baseline itself is not relabelled P2 evidence.

**Blocking failure:** `move/picker-recovery-native-v2@legacy-desktop`, at unchanged
`e2e/session-move.mjs:369` (`checkWorktreeMoveBridges`). After the selected-uncertain
native Move/unreadable-response/Close chain, `sourceWorkingReads` was expected to
be empty but contained actual `/api/models?cwd=…uncertain-source-desktop` and
`/api/project-trust?cwd=…uncertain-source-desktop` requests. The trace records these
fetches at12:31:40.943/40.944Z; the assertion fails at12:31:41.579Z. A400 console
error precedes failure; an incomplete-chunk/SSE error follows requested shutdown.
Those errors remain fatal/unfiltered. This locates the observed failure, **not**
its root cause or evidence that an unchanged retry would fix it. No browser
assertion/wait/deadline, production code, orchestration or lane width was changed.

Failed Move output:
`/nix/store/4ikszdrmbkkgc57da93vrzc6chkhfvbj-pi-web-browser-move-diagnostics`, with
`result.json` and `artifacts/{run.json,coverage.json,server.log,events.jsonl,context-1.zip,context-1-failure-0.png}`.
Its16.216s capsule retained complete diagnostics and confirmed service/pipe/group
settlement and closed port. Sixteen groups/39 receipts passed, one group failed,
nine were not run. All17 started capsules settled/collected and closed their ports
with no observed survivors/uncertainty. Core logs show **both promoted files passed
in the full pool** before peer abort (`candidate.log:585–637,843–898`), but there is
no finalized complete core summary. The outer Nix client reports interrupted and
settled, no observed survivors/uncertainty; this is not a complete inner-core native
settlement certificate. Nix owns outer builder containment. Deployment never starts.

Raw logs/timestamps/exits, failed diagnostic copies and derived summaries remain
at `/tmp/pi-web-p3-cohort.1RK3PZ/`, including `baseline-analysis.json`,
`candidate-failure-analysis.json` and `export-comparison.json`. No resources are
manually removed. The first coherent candidate is retained as **implemented,
focused-verified and independently reviewed, not fully accepted or ready to
integrate**. Resolving this browser blocker requires a separately bounded decision;
this task stops rather than expands or runs a repeated timing campaign. A final
evidence/status-only commit leaves all executable inputs at the implementation
commit; proportional checks review documentation, whitespace, exact changed paths
and unchanged application/test/manifest/runner inputs, not another full suite.
Final independent evidence review by the same reviewer found no documentation
blockers and confirms the incomplete-acceptance/performance/settlement limits.
Writer's `git diff --check`, exact changed-path/input comparison and unchanged
reviewed-manifest hash checks pass. Local main remains the starting `ab6b2fa`;
feature branch/worktree and historical/current diagnostics are retained. No rebase,
integration, publication, manual resource cleanup or next opportunity is attempted.

## Opportunity #4 — measured non-RPC stop

Checked starting local main: `666a75ef71ae6ae5057fa4e5b1b2124c6ebf3b19` (clean).
Dedicated branch `perf/non-rpc-fixture-preparation`, worktree
`/home/robert/projects/3rdparty/pi-desk-worktrees/non-rpc-fixture-preparation`.
CodeGraph initialized before code research. One writer coordinated source export
and checks; no other task-owned check overlapped. P2/P3 are historical references.

**Decision: stop without a cache.** The existing eight-case
`components/AppShell.tab-session.test.mjs` receiver constructs navigationRuntime
8 times but makes only **65 transformation requests for 65 distinct actual inputs**,
all in its first construction. There is no measured repeated pure work to remove.
A process/file-local store would not eliminate the first transforms; cross-file,
disk or Node compile-cache work is outside this task. This is not an all-fixture
census or a claim that cold transformations are free.

### Mechanism and attribution

Both named fixtures use `fsCache:false`, automatic JSX and `tsconfigPaths:true`,
without P2's explicit `moduleCache:false`. Browser-lower additionally supplies its
CSS aliases; it was inspected, not measured or changed. The pinned implementation
resolves a request, checks parent/native module caches, and returns loaded exports
**before** the source read/transform/evaluation path. New loaders use the same native
require cache; nested loaders inherit options/parent-cache boundaries. Eight new
Jiti objects therefore do not establish eight new dependency graphs. The probe
observes `moduleCache:true,fsCache:false` throughout and the same graph-export and
NavigationWork constructor identities after the first call. It adds no instance
sharing: each fixture still constructs its own work owner and DOM/root lifetime.

Only temporary scalar diagnostics changed navigationRuntime. The original callback
receives the same arguments/this and returns its original result or throws its
original Error; keys describe actual source bytes, effective filename and callback
options, including JSX/Babel settings. No code/result/module/failure cache is added.
A terminal root-after observation retains scalar rows across all fixture lifetimes,
including callbacks captured by an earlier graph. Its final rows exactly equal the
pre-render snapshots: **no late transforms during cases, render or cleanup**.

| Terminal-observed phase | Measured elapsed |
| --- | ---: |
| First construction's two imports | 933.402ms |
| Transformer callbacks within those imports | 842.791ms |
| First import residual, including 4.508ms hashing diagnostics | 90.611ms |
| Next seven constructions' imports combined | 1.047ms |
| Next seven constructions' loader setup combined | 1.892ms |
| Repeated transformation callbacks / elapsed | **0 /0ms** |
| All eight DOM mount/render envelopes / explicit rerender | 283.129 /6.974ms |
| All eight disposals | 10.274ms |

The first import residual is mixed resolution, source/native loading, VM compilation
and evaluation, not isolated CPU time; after removing measured hashing it is 86.104ms.
It is neither dominant nor repeated. Later cached import/resolution work totals only
1.047ms, so there is no unexplained large repeated import interval analogous to P2's
premature stop. Transformer time includes lazy pinned Babel initialization. DOM
phases include setup/effects, not just pure rendering; disposal includes the real
independent joins/restoration. Original controlled clock actions remain inputs;
this receiver adds no native sleep/deadline experiment and none was optimized.

### Commands, identities and verification boundary

Both discovery probes used the existing entry point, with unchanged original cases:

```sh
nix run .#test -- core --jobs 4 --file components/AppShell.tab-session.test.mjs
```

The first probe reported only import-time callbacks. The changed second probe adds
terminal observation to close that reporting blind spot; the first is retained, not
labelled full-lifetime evidence. These are **not a baseline/candidate speed pair**.
Both pass 8/8 tests, 29 exporter contracts and mandatory static checks, with zero
skipped/cancelled/uncertain files or observed survivors. Typegen/tsc and lint actually
execute for each diagnostic input; dependencies are already realized, with no
separate prerequisite-preparation command. Native x86_64 Linux, Node24.21.0,
32 observed CPUs and 54,506,127,360 /54,950,961,152 available bytes admit requested/
effective four core slots. Only one F file executes; there is no browser/service
overlap or claim of four busy peers. Pool window and summed file work equal the
selected file duration; E is empty.

| Seconds / identity | Import-time probe | Terminal-observed probe |
| --- | --- | --- |
| Complete command including realization/export | 40.988 | 39.553 |
| Outer preparation before lifecycle | 33.307 | 32.059 |
| Core lifecycle | 2.624 | 2.700 |
| Lifecycle preparation / final-file settlement | 0.843 /0.045 | 0.821 /0.049 |
| Selected file / summed file work | 1.736 | 1.830 |
| Lifecycle-to-outer-end | 0.089 | 0.089 |
| Immutable source | `/nix/store/kbqwsdldacyp15ir0yghdig301f0z1ah-source` | `/nix/store/vg5mr5dab0ac74lvhvzr312c41s6kg3b-source` |
| Outer content/mode digest | `98e347f347c925f7bd3ad5af9d2db536feb50dccdefee830cee70969b55829ef` | `9aadfbdecd828d299740dd9d89f2f5a197673f130121e616fb15164ab2851b57` |
| Core report | `/tmp/pi-web-test-core.MAW3DO/run.json` | `/tmp/pi-web-test-core.OOxDxH/run.json` |
| Immutable core output | `/nix/store/hwjhvcg8lixr0ki1knw9rm4winc08pqi-pi-web-core-checks` | `/nix/store/b2030lnd41nidvw87kzx3712klk6qpsj-pi-web-core-checks` |
| Detailed directory within output | `artifacts/run-g06XOu/` | `artifacts/run-RpPV0P/` |

Pinned runtime/private modules remain `28vpp6bpxj0algr4b4xigfca399flcmi-pi-web-node-modules-0.9.3`
and `1gps3kh9225x4axd5j4b119i9dhchlln-pi-web-test-support-1.0.0` under `/nix/store/`.
Each output's `static-inputs.json` binds its distinct diagnostic type/lint evidence.
Raw logs/timestamps/exits, exact patches, saved originals, pinned-Jiti file hashes,
analysis script and derived rows are retained at `/tmp/pi-web-p4-navigation.sd9zm6/`.
`lifetime-profile-analysis.json` owns the terminal numbers above; `profile-analysis.json`
retains the earlier observation's narrower scope. Preparation/time variation between
these changed diagnostics is not an optimization, CPU or whole-feedback saving.

All diagnostic edits were removed. Writer comparison confirms every executable
input equals starting main, including both named fixtures and the original receiver;
only this plan changes. No maintained guide behavior changes. With no executable
candidate, new cache counterexample controls, a matched candidate comparison and
complete core/browser/deployment acceptance are not applicable or claimed. This
evidence-only delta receives documentation/source-conservation checks instead.
Independent source/method/evidence review (`01a1787e-5b6d-7402-ad52-009e5e8e32c2`)
found no blockers and independently confirmed the plan-only diff. Writer checks
pass `git diff --check`, saved-original/base equality and relative link-target
existence (`source-conservation.json`); these are source checks, not browser-link
verification. Main remains at the checked starting tip. No rebase, integration,
publication, feature/historical cleanup or next opportunity is attempted.

- [x] Inspect pinned construction/cache behavior and measure the actual receiver,
  including full-lifetime callback observation and the import residual.
- [x] Record the bounded negative finding without adding reuse or changing semantics.
- [x] Independently review exact source, measurements and stop disposition.
- [x] Remove instrumentation and retain feature resources unintegrated; stop before
  another opportunity. The final feature tip is reported in the handoff.

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
P2 then had separate implementation authority, starting from that checked local
main in `/home/robert/projects/3rdparty/pi-desk-worktrees/rpc-fixture-preparation`,
branch `perf/rpc-fixture-preparation`; CodeGraph was initialized before research.
P2 is now integrated, and opportunity #3 has its separate bounded section above.
This multi-opportunity plan is not fully executed or archived.

### Initial P2 slice (historical stop, subsequently reopened and completed)

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
- [x] Independently review and complete core/static/plugin, browser/terminal and genuine deployment acceptance.
- [x] Record final evidence and retained resources; report the final feature tip in the handoff without integrating or expanding scope.

## Investigation provenance and known gaps

Six independent read-only sessions covered RPC (`01a1774e-fdd4`), native timers
(`01a1774e-fddf`), Git (`01a1774e-fdda`), exclusive tail (`01a1774e-fdd8`), caches
(`01a1774e-fddc`) and timing/simulation (`01a17612-7276`). Full sessions remain
inspectable; the findings above distinguish source facts from future experiments.

**Known gaps:** P1 has one matched fresh four/four pair, not repeated statistical,
standalone-core, cold-cache, ARM or CI timing evidence. Reopened P2 has one matched
focused instrumented pair and complete four/four acceptance, not repeated statistical
or a matched whole-feedback speed comparison. Remaining non-transform import costs are not further
decomposed, and no general Babel environment-transition guarantee is claimed.
Opportunity #3's two N files and minimal Move correction now pass full acceptance;
its single pair shows no meaningful whole-feedback speedup and has the recorded
deployment-realization/contention limits. Opportunity #4 measures one navigation
receiver under its existing default module caching, not all fixtures, browser-lower
execution or module-cache-disabled/environment-transition behavior; no speedup is
claimed. Native-tools/Pause failure-lifetime gates, opportunities #5–6, native
cache/fence compatibility and other SDK loader/resource
closures remain deferred. Simulations are not promises.
