# Test-suite architecture and feedback overhaul

## Goal

Make the test suite materially faster and better designed for future features:
execute each contract at the lowest sufficient layer, remove redundant expensive
work, expose meaningful asynchronous completion, and make the efficient path the
normal contributor path. This is an architecture/testability overhaul, not merely
a scheduling change or a target reduction in test count.

Preserve application semantics and substantive authorization, filesystem, SDK,
browser and deployment guarantees. Individual test bodies, counts, internal APIs
and incidental assertion shapes are not frozen: consolidate or replace them when
an explicit contract-to-owner mapping establishes equivalent or stronger proof.

## Context and authority

The user explicitly expanded the reconciliation into a real overhaul, including
production refactors for testability and speed, addressing overdone slow tests,
and designing sane future additions. They selected retiring/changing internal
test APIs and named browser groups without compatibility adapters, while retaining
`nix run .#test -- core|e2e|service|all`. Update all repository callers and guides.
This does not authorize application behavior changes, remote publication, host
service contact or historical cleanup.

Worktree: `test/suite-architecture-overhaul`, starting from local `main`
`27d66ac6e3012c84002d83c6973e921f59964cf3`. Initial repository state was clean;
CodeGraph was initialized in the dedicated linked worktree. This document records
scope and execution gates, not proof that implementation or performance is done.
During design, main advanced to `e9e7510540298055389ad43cdb6c44b2b0739fe1`
with compact Activity actions and shared sidebar-readiness fixture changes. Carry
those forward before implementation/control capture; the older measurements below
are not a new composed-main benchmark or a reason to undo those fixture fixes.

### Existing evidence, not new overhaul execution

The source review inventoried **411 Node test files / 3,100 passing tests**, plus
static/export checks, **26 browser/terminal groups / 59 scenario receipts** and
real deployment acceptance. Representative assertions and helper closures were
inspected; this was not an individual audit of every assertion.

Latest recorded fresh complete command:
`nix run .#test -- all --workers 4 --jobs 4`, native x86_64 host with 32 logical
CPUs, warm prerequisites, **388s** command wall time. Core was **300.041s**
(**51.565s** pre-test preparation/static/realization; **248.099s** file execution),
browser **359.008s**, deployment **21.418s**. Overlapping intervals are not
additive. Tested implementation was `d9746ca9`; later documentation-only commits
compose into the starting main. Source digest:
`6ee8b2f46880d9ae63680e4677dfb349c5c40b192c81dad5f31c5b4d9e344f34`.
Evidence: `/tmp/pi-web-lane-final.bCPUv7/analysis.json`; maintained account in
[Testing](../testing.md). Available memory/admission and prerequisite state must
be captured from actual reports for new matched comparisons, not reconstructed
from this summary.

| Existing per-file elapsed time | Cases | Source review lead, not measured attribution |
| --- | ---: | --- |
| Git Workflow cleanup: 106.231s | 133 | Rebuilt histories, repeated capture/inventory, native policy matrices |
| Discard: 55.481s | 97 | Repeated authorization/evidence matrices plus distinct ref/graph safety |
| Server: 46.456s | 57 | Marker/merge matrices, repeated native previews and reviews |
| Project management: 39.172s | 38 | Public-status polling, durable host writes, fixture/import repetition |

These file times overlap and cannot be summed into a suite saving. Static source
inspection found eleven explicit Git setup calls per ordinary cleanup/discard/
project-management fixture, before runtime work. Nested cleanup adds five. A
normal two-checkout project-status poll can expand into nine management Git calls.
The 25-artifact cleanup path ordinarily performs 27 full worktree inventories.
These are source expansions, not runtime counters or a reason to remove security
revalidation. Attribute costs before selecting optimizations.

## Plan Relationship

- Preserve the current three mandatory Nix checks and genuine deployment boundary
  in [ADR 0025](../adr/0025-browser-and-deployment-acceptance.md), plus snapshot,
  credential, containment, evidence and settlement safeguards from ADRs 0020,
  0023 and 0024. The older Nix-native/parallel/development-verification plans own
  their completed historical work; do not reopen or rewrite them here.
- Preserve [ADR 0031](../adr/0031-project-acceptance-coordination.md): session
  Stop/Pause and observer disposal do not cancel independently admitted Acceptance
  jobs. Test ownership helpers must not change that product contract.
- [ADR 0032](../adr/0032-opt-in-acceptance-widths-and-reviewed-test-batches.md)
  owns current concurrency and reviewed classifications. This overhaul owns
  future behavioral ownership and leaner policy/evidence maintenance, not an
  automatic widening/promotion. The archived 192-file audit remains historical
  evidence rather than a competing live migration plan.
- The still-open [eight-worker benchmark](2026-10-22_eight-worker-acceptance-plan.md)
  retains its unverified 8/8 obligation. Do not claim that benchmark here or make
  it a prerequisite for this overhaul. Use four/four for matched complete runs.
- Current operations remain in [Testing](../testing.md) and the
  [browser guide](../../e2e/README.md). A new ADR must explicitly record any
  changed settled testing contract; this plan alone does not supersede one.

## Architecture

### One primary owner per contract, thin proofs across boundaries

| Contract | Primary owner | Complementary integration |
| --- | --- | --- |
| Parsing, policy/card truth tables, reducers, geometry | Direct production-module core tests, no SDK/Git/server setup | Only important wiring/interaction representatives |
| Owned asynchronous state transitions and persistence ordering | Real production owner with controlled capabilities, named gates and clocks | Real store/SDK/process composition where the boundary matters |
| React effects, closure freshness, cleanup and retained identity | Mounted real React/component harness | Actual layout, focus, capture and browser APIs remain Chromium proofs |
| Route input/authorization/orchestration | Actual route-handler requests | Thin installed-launcher HTTP proof; no duplicated full data matrix |
| Filesystem identities, refs/locks, descriptors, workers, native processes | Private-fixture native integration | Controlled orchestration matrices do not claim native equivalence |
| Layout, scrolling, observer/network wiring and end-user flows | Packaged-service browser/terminal scenarios | Lowest-layer matrices stay below; retain meaningful input variants |
| Home Manager startup/restart, permissions, PTY and service closure | Existing genuine small deployment VM | Never replaced by process-backed receipts or repeated for every feature |

Keep `node:test`, Jiti, React and Playwright unless a bounded pilot demonstrates a
specific missing capability. Do not migrate frameworks as a substitute for fixing
ownership. A pinned dev-only DOM dependency may be added only after proving actual
TSX import, a single React identity, `act`, Strict Mode, storage/event behavior,
cleanup, and Nix/package boundaries. Do not build a homemade DOM or pretend it
certifies geometry/native behavior.

Prefer small test helpers under `lib/testing/*.fixture.mjs` and domain fixtures
near their owners. Verify export and packaging exclusion: a naming convention is
not proof every package path excludes helpers. No universal testing framework,
fixture DAG/container, magic `flushEverything` or global-idle oracle.

### Testability is a production design boundary

- Use small instance-owned factories with real default composition for stateful
  hosts. Inject the capabilities actually needed: store, scheduler, observer or
  native boundary. Keep authentication/path-security/default singleton and HMR
  ownership intact. No test HTTP endpoints, request-controlled adapters, security
  bypass flags or writable global test APIs.
- Distinguish result availability, owned-work settlement and durable publication.
  Retain full run promises, including failure/persistence handlers. A terminal
  status, cancellation request or elapsed timeout is not closure proof.
- Teardown stops fixture admission, releases gates, requests only owned
  cancellation, joins started work and actual closure, restores globals, then
  removes private files. Failure paths obey the same order; preserve primary and
  cleanup failures. Never cancel independent Acceptance jobs merely on disposal.
- Prefer deferred request/operation gates and clocks for project-owned elapsed
  policy. Await the named outcome after advancing time; do not guess microtask
  counts. Separate wall time from monotonic budgets and real watchdogs.
- Bounded polling remains valid for externally observed native/HTTP/UI conditions
  without an owned completion channel. Reuse `e2e/async-condition.mjs` and
  `e2e/owned-routes.mjs`. Natural polling, native deadlines, expiry wiring and
  process closure retain selected real-time proofs; do not shorten production
  intervals or globally fake clocks to manufacture speed.

### Expensive execution must justify its boundary

Move exhaustive permission/evidence/state tables into actual production rule and
host tests. Retain native representatives for distinct kernel, Git, durability
and composition guarantees, not one destructive run for every Cartesian product.
Each additional combination must name the interaction it protects.

Do not cache an approved snapshot across checkpoints or remove fresh checks just
to make tests faster. Same-tip symrefs, graph-proof loss, different race stages,
ancestor swaps, mounts, nested metadata exemptions, source/ignored authority and
pre-/post-effect persistence failures remain distinct obligations.

Reuse immutable seeds only when measured worthwhile. Mutable refs, config, index,
worktree administration, filesystem identities, captured authority and live SDK
instances are not shared fixtures. Create fresh registrations and capture after
materialization; no hardlinked writable state or reset/clean-based safety fiction.

Browser recipes declare ordered fixture fragments, resources and expected session
IDs independently of what seeding happens to produce. Separate shared settings/
provider defaults from feature transcripts. Keep one new sandbox per group and
success-only whole-chain receipts. Name diagnostic stages before splitting large
chains; change owners only with an independent old-to-new contract/input map.

## Bounded migration portfolio

Mandatory families are the four heavy Git suites' policy/host boundaries;
project-operation and selected fixture completion (including the Acceptance pump
fixture gap); session-detail GET; one mounted React pilot (`useResizablePanel`);
the two thin listing/real-turn connections; browser recipes and the identified
stale-response/polling assumptions; obsolete contracts; and contributor rules.
Each has a named task and exit evidence below. This is not a promise to migrate
every existing source assertion or every asynchronous owner in the repository.

Broader model/file-viewer mounting, seed materialization, group splits and cache
refinement are gated by pilot capability/cost evidence. Record an explicit adopt/
defer decision and remaining owner for each. Additional work on the measured
browser critical path is required if the initial portfolio cannot meet the full-
command target; do not complete a core-only optimization under a full-speed claim.
Reassess classification for changed effects and selected known closure blockers;
unchanged default-E holds stay explicitly retained, not implicitly re-audited.

## Execution evidence and frozen targets

The user subsequently authorized implementing the entire bounded overhaul in this
worktree, continuing through verification and asking when decisions are needed.
A pause/restart cleared `/tmp`; the first baseline's outer report was lost, so its
surviving Nix results are partial evidence only, not a completed timing run.
Persistent private evidence/drafts now live at
`/home/robert/.cache/pi-web-suite-overhaul/run.zYOwpy`.

The replacement control at `566a6a7` passed fresh complete four/four acceptance in
**413s**, with **413 files / 3,104 tests / 12 suites**, all 26 groups/59 receipts
and genuine deployment. Core **314.900s**, pre-test **54.403s**, file window
**260.064s**; browser **381.120s**; deployment **24.935s**. Exact source digest:
`a8dd36ff898df22c8f456a45de7d2f6a2c58f53bd7ace272889814da82d7bf87`.
`baseline-analysis.json`, original reports and the verified `control-source` are
retained in that evidence directory. The run saw 32 effective CPUs and about
66 GiB available memory at browser admission; four effective core workers and
four group sandboxes ran. No dependency preparation overlapped this control.

Three fresh unchanged focused controls (`core --jobs 4 --file
lib/panel-layout.test.mjs`) passed in **42 / 41 / 39s**: median **41s**. Targets,
fixed before applying broad migrations, are (1) at least **50% less** warm focused
command time (median <=20.5s), and (2) at least **15% less** matched warm-prerequisite
complete command time at the same four/four width (initial reference <=351.05s).
Both require real fresh test execution; reused static dependencies are labelled.
Report separate preparation and any cold realization rather than hiding them.
Use the planned balanced pairs and control spread; inconsistent/noise-sized gains
are inconclusive and do not satisfy a causal performance claim. Structural goals
remain zero Git/SDK setup for pure policy matrices and joined owned completion.

## Implementation outcomes (final acceptance/performance still open)

Evidence remains under `/home/robert/.cache/pi-web-suite-overhaul/run.zYOwpy`.
Measurements bind the recorded immutable exports, not an implied future Git tip.
Main subsequently advanced to `da26f15` with only the process-wide SSH-agent plan;
rebase that documentation-only input before freezing the integration candidate.

| Migration | Primary owner and preserved bridge |
| --- | --- |
| Permission/card/root/graph matrices | Actual `artifact-rules.ts`, `operation-rules.ts`, `resource-cards.ts`, `discard.ts` leaves; `resource-rules.test.mjs` has nine zero-Git/inventory cases. Native Ask/Allow, physical aliases, ref/graph/CAS, mount/rm and distinct capture/dispatch windows remain. |
| Host and durable decisions | Instance-owned project-operation host/store/scheduler; review-ready versus full settlement, delayed load, expiry and failed writes. Native project-management/default composition and HMR/history/replay bridges remain. |
| Native settlement gate | Owned IPC readiness/release, real Git child close and executor join, not a fixed 250ms hold. The final registration race now names its existing read instead of counting checkout calls. |
| Detail and listing connections | Actual detail GET with 1,000 cap/full statistics; actual local package mutation into a warmed provider listing. Pagination retains uncapped helper semantics. |
| React and stale delivery | Real mounted resize hook, GitExplorer and Move picker (including A→B→A and post-unmount parent callback). Ignored-abort JSON genuinely returns; layout/capture/network remain Chromium owners. |
| Selected lifecycle fixtures | Awaited wrapper shutdown/startup/replacement work, real response body/descriptor closure, coordinator full pump/tail drain without cancelling independent jobs. Opaque SDK/native holds remain E. |
| Browser fixtures and turns | Separate ordered defaults/transcripts and independent expected IDs; only audited timestamps omits fork/manager setup. Owned stale-read barriers, natural polling observation, canonical real turn/persistence/reload. Ledger-only setup no longer manufactures question expirations; real question proofs remain. |
| Infrastructure and governance | Retired obsolete combined planner/receipt APIs and seven synthetic instances; current browser/deployment contracts retained. Historical audit immutable; live reviews/explicit E holds and AST architecture guards have current owners. |
| Focused inputs | Separate declared-input type/lint evidence; registered JS tests plus live classification do not invalidate unchanged types. Private DOM dependency closure is outside the application/runtime graph. |

The default proc-fd missing-support integration intentionally retains its builtin
probe/reimport: an injected false capability would not prove the real default
probe. Native mount/removal faults use named capabilities, and the fourth-checkout
read race has been replaced by its semantic final-capture checkpoint.

Focused evidence: `focused-2` passed 22 files/494 tests in 125s including fresh
static preparation. Late mounted/guard/checkpoint families passed in `focused-4`;
its incidental old weight-10 assertion failed, was replaced by declared-weight
wiring for every job, and the five remaining owners passed 85 tests/38s in
`focused-5`. `focused-6` passed four files/54 tests/38s after separating real fixture
fragments and asserting review-ready before joining an expected failure.
`focused-7` passed three files/16 tests/36s for the final typing/policy boundary.
These selections are not complete acceptance and their overlapping counts are
not additive. Original failures, dependency hash realization and corrections are retained.

The first complete browser diagnostic passed 26 groups/59 receipts in **414s**,
including cold package preparation: **not** a comparison with the 413s full
control. Activity was 208.270s and markdown 152.419s in that diagnostic. Measured
whole-group packing exposed stale hints (315.60s maximum lane sum versus a
270.99s counterfactual balanced sum); refreshed hints are not deadlines or a
measured reordered-run speedup. Keep all variants/chains. Split groups only if
matched complete-command evidence still requires it.

`native-count-comparison.json` records instrumented source variants: four native
owners used **43,367 → 37,613** explicit public Git dispatches and **325 → 281**
inventory starts. The server retained two additional held-HEAD checks. The leaf
matrix used **0/0**. Counts exclude internal Git children and runner validation;
instrumented times and earlier unmatched per-file times are not speedup evidence.
Fine import/store/teardown timing remains unpartitioned; coarse counts, setup and
browser spans are sufficient for this bounded choice, not a full profiler claim.

Adopt real mounted resize/Git/Move owners; defer full useAgentSession/FileViewer
mounting, retaining actual model callback/loader and Chromium owners. The three
model-switch source checks were retired only after strengthening their callback
replacements. Defer mutable seed infrastructure: seven balanced Nix samples gave
42.204ms fresh/11 explicit calls versus 36.547ms materialized/8 plus 42.638ms seed
creation, with real config/ref/registration/file/pack-inode independence. A 5.66ms
construction saving does not justify new infrastructure against capture/execution.

The initial root DOM devDependency was found in runtime and removed. Separate
private support now contains no React/node-pty; a realized package has no jsdom,
helpers or support closure (`package-boundary-proof.json`, isolated build 72s).
`graph2-proof.json` covers six input variants, including support-only dependency
changes not invalidating the package; `graph3-proof.json` proves an added JS test
**with its required classification** leaves types/application/runtime unchanged.
No production build ran in a checkout.

`oracle-analysis.json` retains nine independent assertion-red controls: wrong
route cap, resize direction/cleanup, Git/Move stale acceptance, premature review
publication, inherited parent artifact authority, ignored native mount records
and missing coordinator pump drain.
The original broad persistence-swallow mutation hung and was explicitly stopped;
its replacement uses the named review-ready boundary and a targeted publication
fault. One concurrent native diagnostic refused a source identity/mode change
before executing tests; its unchanged serial reexecution is a valid assertion-red,
**not** evidence that the unexplained exporter event was fixed. Ptrace was rejected
by the ordinary sandbox; counters used the existing C frontend and named inventory
start instead, with no sandbox relaxation or Node shim per Git invocation.

### First exact-candidate execution and bounded correction

Implementation was committed as `2135f03`, rebased onto `da26f15` as `fd7c68d`;
only the incoming SSH-agent plan changed content. Three warm focused samples
passed **9/7/6s**, median **7s versus 41s**, an **82.93% reduction**, below the
frozen 20.5s limit. `focused-comparison.json` records exact selection/source;
valid reusable types/lint and fresh selected Node execution are distinct.

The final-source package resolved to the same inspected immutable `dlf...` output
in **1s**. Genuine deployment preparation/execution passed in **81s**, including
new guest realization (`final-package-boundary-binding.json`). This is separate
from the later whole-command stopwatch and earlier warm 24.935s service execution.

`candidate-all-1` on `fd7c68d` failed after **281s**: mobile worktrees' independent
Node API listing GET reset after successful removal. The same endpoint had just
returned browser HTTP 200; requested backend shutdown followed the reset. Idle
Node keep-alive reuse is a hypothesis, not an established cause. Retain capsule
`hrvnxa0x2iawyp2x3rswbdr3yi1jggvq`, traces, receipts and
`worktrees-reset-analysis.md`. Core was interrupted, not assertion-red; pending
browser groups did not run. This is **not acceptance or a performance sample**.

An independent frozen-source core-only diagnostic then passed **421 files / 3,127
tests in 261s**. Its workload differs from the full concurrent control, so no causal
speedup follows. The correction generalizes the existing strict browser read for
all positive manager GETs, closing an actual trace/transport inconsistency while
retaining URL/status/body/ref/identity assertions and deliberate Node-API 409
negatives. It does not claim to repair the unexplained socket cause. Six callback
cases cover owned response completion, exact queries, review text, bad status,
malformed JSON and unswallowed transport/body failures. `focused-8` passed four
files / 33 tests / 46s including changed static preparation; no retry, timeout,
console exemption or production change was introduced. The focused installed
worktrees group then passed both input chains in **107s command / 94.945s capsule**
(`jv4c7846g17qwb0anczw6hq0pzf8242x`). This validates the corrected bridge, not the
cause of the prior reset or complete same-width acceptance.

### Corrected complete runs and unmet full-feedback gate

At `df8f418` / immutable `5q4...`, corrected warm samples passed **6/4/5s**,
median **5s versus 41s (87.8% reduction)**. Two complete four/four runs passed in
**409s and 411s**: **422 files / 3,133 tests**, all **26 groups / 59 receipts** and
genuine deployment/closure. Their median **410s** is only **0.726%** below the
initial 413s reference, not the required 15%, and exceeds **351.05s**. Functional
acceptance is established for that source; the full-feedback completion gate is
**unmet and not waived** (`full-comparison-incomplete.json`).

The unchanged `a8dd...` control repeat failed after **257s**, so it is not a valid
second timing sample. Its native Pause assertions succeeded; an untraced Node
cleanup DELETE reset afterwards. The backend was stopped only after that failure;
subsequent incomplete/refused browser requests are shutdown effects, not evidence
of a native panic. Retain capsule `93pkd6c951gyfzvwrj65gg89w057qkfi` and
`control-repeat-failure-analysis.md`. The reset cause remains unestablished.
Both failed transport capsules have persistent, bounded Nix GC roots in ROOT.

Generalize the strict positive browser body reader as `browser-http.mjs` for
manager GETs and successful Pause cleanup DELETEs. Preserve exact-200 versus
any-2xx semantics, body consumption, idle/gate/abort/privacy cleanup order and
AggregateError retention; deliberate Node-API 409 negatives stay unchanged. Retire
the manager-only helper without an adapter. `focused-http-1` passed four files /
50 tests in **37s**. These callback cases do not prove Chromium networking, native
shutdown or a cause/resolution for either observed reset.

### Bounded next experiment, not adoption

Measured complete-core scheduling is already near its invariant-duration lower
bound: cleanup starts first, and simple queue reordering has at most ~1.2s model
headroom. Preserve E-after/exclusivity and shared-source isolation assumptions;
E-first is **not contract-neutral** and is not adopted. Activity's three whole
input chains have a conditional boundary audit, but cold independent setup and
complete benefit are unproved; no group/input/ownership change is adopted.

A private recipe-bound mixed-pool experiment keeps maximum four total files,
limits N-classified files to two **only while F remains queued**, selects the
highest-priority eligible queue head and lifts the cap immediately on F queue
drain. Default/other widths retain LPT; every file, ID, E barrier/order and full
callback settlement remains. Invariant-duration replay predicts no intrinsic
speedup (+0.15s isolated / +0.29s full); changed cross-level overlap is a hypothesis,
not a contention diagnosis. Actual private mechanism checks passed three files /
79 tests in **39s**, including named-gate default/cap/empty/failure/abort/drain
contracts. No primary scheduler change or performance claim follows.

Additional prepared full diagnostics compare the same shared-HTTP correction at
LPT versus the private mixed policy, with unchanged four/four, complete inventory
and real VM. Their rationale is the measured unmet full target and retained failed
control, not retries to manufacture acceptance. Record any source/test differences
and do not attribute gains merely from unmatched phase envelopes.

### Remaining gates

The full-feedback target and final corrected same-source acceptance/integration
remain open. The final candidate needs complete native/browser/service proof;
failed or incomplete commands remain excluded from successful timing samples.
No integration or complete-command speedup is claimed.

## Plan

### 1. Establish cost attribution, targets and architecture decisions

- [x] Capture an immutable control and bounded critical-track attribution:
  core preparation/file windows, four native owners' Git/inventory counts and
  independent fixture-construction cost; browser setup/readiness/helper/trace/export
  spans. Keep unpartitioned import/store/teardown subphases explicit rather than
  manufacturing attribution. Use uninstrumented final comparisons; revisit finer
  profiling only if targets require it. No Node shim per Git spawn.
- [x] Inventory settling delays/poll loops and behavioral source checks in the
  named migration families: migrate, retain a justified real-time/native proof,
  or retire as redundant. Produce a contract-to-owner map, not another permanent
  catalogue of all 3,100 assertions. Reuse the prior hold review and inspect only
  affected effects/selected blockers; explicitly retained unresolved holds do not
  block completion or count as repaired.
- [x] Before broad migration, freeze separate numerical focused-feedback and
  same-width full-command targets, representative selections, preparation/cache
  state, benchmark budget and variance rule. Both targets must pass unless the
  user explicitly accepts a remaining performance gap. Structural targets: zero
  Git/SDK startup for pure policy matrices; no public-status Git polling to await
  owned host completion; no unexplained settling sleeps in migrated families.
  No speed percentage is yet established.
- [x] Record the architecture decision before changing settled contracts. State
  internal API/group retirement without adapters and stable core/e2e/service/all
  entry points, contract-to-replacement/bridge or obsolete-obligation disposition,
  and preserved native/evidence boundaries. Explicitly decide classification and
  cached-static evidence changes before implementing them; internal-API removal
  permission is not authority to weaken fail-closed coverage or freshness claims.
  Decision: [ADR 0033](../adr/0033-behavioral-test-ownership-and-feedback.md).

### 2. Build minimal reusable ownership and mounting support

- [x] Add small deferred/task-ownership helpers with immediate rejection
  observation, joined success/failure cleanup and watchdog tests; prove held work
  prevents teardown and cleanup errors are not swallowed. Reuse native completion
  contracts rather than pretending a helper creates missing SDK exit evidence.
- [x] Run the bounded mounted-React DOM spike, choose/document the smallest viable
  harness, and verify test-only dependencies/helpers do not enter the application
  graph. Keep geometry/native-browser tests in Chromium. Decide before replacing
  any source checks that lack an equivalent behavioral owner.
- [x] Add instance-owned completion/store/scheduler seams to project operations;
  preserve real default composition, HMR ownership, request admission and durable
  decision ordering. Prove review-ready and fully-settled behavior across delayed
  load, abort/reject, early/late save failure and 15-minute expiry boundaries.

### 3. Reconcile the expensive Git suites by actual safety ownership

- [x] Extract/import deterministic root grammar, overlap/authority decisions,
  authorization/card rules and host transitions; migrate repeated native truth
  tables into zero-Git production-module tests. Keep explicit native Ask/Allow/
  forced-confirmation, discovery/file/directory and default-wiring bridges.
- [x] Replace builtin patch/reimport and nth-read race injection with narrowly
  scoped store/mount/removal collaborators and named checkpoints. Prove injection
  occurred and native outside sentinels/refs survive. Retain real fresh capture,
  no-follow/lock/CAS, stage-specific races and pre-/post-effect failure proofs.
- [x] Replace project-management status polling and post-terminal delays with
  joined owner signals; replace the native commit gate's fixed 250ms hold with
  ready/release IPC. Await actual child close after release, including failure.
- [x] Measure an independently materialized Git seed against fresh setup; adopt
  only if net faster and identity/config/registration independence is proven.
  Record before/after subprocess and native-scan counts for the pilot migrations,
  then move remaining redundant cases using the reviewed replacement map.

### 4. Replace weak or disconnected proof with concise behavioral owners

- [x] Replace `app/api/sessions/detail-route.test.mjs` parsing/cap source checks
  with actual GET requests for omitted/invalid/normal/oversized tail and full
  statistics; retain uncapped helper semantics only in the pagination owner.
  Demonstrate a broken route cap fails the replacement.
- [x] Migrate `useResizablePanel` source checks to the mounted hook: directions,
  pointer/keyboard persistence, storage failure, rerender constraints, unmount and
  Strict Mode. Prove wrong direction, missing dependency or cleanup fails; retain
  pure geometry ownership and real browser geometry/capture coverage.
- [x] After the mounted pilot, decide the bounded model-selection/file-viewer
  follow-up: migrate selected optimism/rollback/stale-request or retained-reader/
  watcher/restoration seams if the harness is suitable, otherwise name the
  deferred owner and unsupported capability. Do not imply all those families
  were replaced. Delete only mapped duplicates; retain architecture/security
  and rendered-output guards and cover any newly changed behavior.
- [x] Add thin missing connections in existing fixtures: real local package
  mutation to fresh listing, and a real faux-provider turn through canonical
  completion/persistence/reload without duplicate messages. Keep controlled
  partial-stream simulations and avoid a new full browser matrix per connection.
- [x] Repair selected audited fixture closure: awaited wrapper shutdown, joined
  startup/replacement failure paths and consumed/cancelled descriptor responses
  with close evidence. Retain explicit native/SDK holds where actual exit cannot
  yet be observed; do not relabel shutdown acknowledgment as worker settlement.
- [x] Resolve or explicitly disposition the AcceptanceCoordinator fixture's
  active pump/held-executor drain gap: stop fixture-owned admission/scheduling,
  release injected gates and join the full pump/tail/executor completion before
  restoration. Unsubscribe/timer clearing alone is insufficient. Preserve
  ADR 0031: observer disposal must not cancel independently admitted running jobs;
  changed coordinator lifecycle semantics need their own prior decision.

### 5. Rebuild browser preparation and synchronization around scenarios

- [x] Extract faithful ordered fixture recipes and independently expected IDs;
  separate shared model/settings/auth defaults from feature-specific histories.
  First remove only proven unused manager/fork preparation from timestamps;
  verify its four inputs and exact catalogue. Audit dependencies before gating
  other groups, including session-launch's model-speed IDs.
- [x] Replace stale-response sleeps with owned arrival/release/transport or
  cancellation barriers plus application-level assertions. Put exhaustive late
  delivered-payload cases in mounted tests that can ignore abort deliberately;
  a cancelled browser request alone cannot prove stale-payload suppression.
- [x] Replace the file-viewer 16-second assumption with observation of natural
  polling and relevant application while retaining identity/zoom/scroll/source
  assertions. Move repeated timer/state permutations below the browser; retain
  an actual natural-interval proof rather than silently dropping it.
- [x] Extract named diagnostic stages from markdown/activity/history chains;
  split only proven independent owners with explicit prerequisite recipes and
  updated inventory/receipt mappings. Profile fixture, tracing and export costs
  separately; any diagnostic-policy change must preserve useful original failure
  evidence and receive an explicit decision, not silent evidence suppression.

### 6. Make efficient additions the default path

- [x] Retire the obsolete combined browser/VM planner/receipt API, its CLI and
  re-export, seven synthetic instances and unused evidence fixture. Move reviewed
  weight completeness into current browser planning first; retain reachable
  budget, registry, evidence, settlement and genuine deployment tests. Remove the
  subsumed compact-helper case and four duplicated hold assertions with owners.
- [x] Factor reusable static preparation and audit narrow core/browser inputs;
  verify graph changes for docs, test-only, app, fixture and dependency edits.
  Keep every required static check in complete acceptance and report cached
  versus fresh sub-evidence accurately. Do not introduce dev/host fallbacks.
- [x] Separate the immutable historical audit from live classification policy.
  Keep audit-to-plan reconciliation where applicable and fail-closed unknown
  handling. Require future files to have a reviewed pool rationale or an explicit
  resource/lifecycle hold, so silent default-exclusive accumulation is not the
  contributor workflow. Never infer isolation from a test-file hash alone.
- [x] Update the prior architecture decision with pilot outcomes and explicitly
  accepted deferrals; update `docs/testing.md` and `e2e/README.md` with the layer
  decision tree, canonical fixture/mount examples,
  completion/clock rules, cost expectations and a feature-addition checklist.
  Add narrow checks for production-to-fixture imports, recipe ownership and new
  unexplained settling sleeps; do not recreate fragile behavioral source tests.

### 7. Verify behavior and speed, then integrate the exact candidate

- [x] For each replaced family, retain a contract-to-owner map and meaningful
  red/green evidence: wrong route cap, missed lifecycle cleanup, premature
  authority publication, stale payload acceptance or a bypassed native boundary
  must fail at its intended owner. Use narrow Nix selections while editing.
- [x] Obtain independent coverage/ownership/security review after migrations;
  recheck changed helper effects and lane classifications. Resolve or explicitly
  accept material native/DOM limitations before final acceptance.
- [ ] Freeze writers for export and pass complete core/static/plugin, every
  reviewed browser/terminal input and genuine deployment/settlement on the stable
  candidate. Coordinate resources through configured managed acceptance where
  suitable, otherwise the existing Nix entry points. Do not change permissions.
- [ ] Collect matched uninstrumented performance evidence: three warm focused
  samples for selected pilots and, normally, two full four/four pairs in balanced
  control/candidate order. Limit ordinary full benchmarking to those four runs;
  a final candidate pass may also satisfy complete acceptance. Additional runs
  need a stated diagnostic/variance reason; failures are retained, never erased
  by unchanged retries. Record widths, admission, preparation, execution, wall
  time and counts. If paired improvements disagree or the median gain is no
  larger than observed control spread, report inconclusive timing rather than a
  causal win; use the predeclared variance rule for any bounded further work.
  Do not claim statistical/cold-cache/CI/ARM guarantees.
- [ ] Integrate reviewable commits into current local `main` using the required
  rebase, exact-state verification and unsigned non-FF approval. Publication and
  bounded feature-resource cleanup remain separate guarded operations.

## Unknowns and risks

- Native attribution is bounded: observed Git/inventory counts and fixture cost,
  not fully separated import/store/teardown spans. Do not infer a causal speedup
  from unmatched file times; use the pending same-width complete comparisons.
- DOM emulation may not cover required behavior; keep unsupported browser-native
  obligations in real Chromium and avoid maintaining a home-grown browser.
- Some pinned SDK termination paths do not expose actual native exit completion.
  Resolve with a bounded capability spike or retain the hold with a concrete
  blocker; a helper or longer delay cannot manufacture proof. SDK forks/upgrades
  and changed public lifecycle behavior require a separate explicit decision.
- New caching must bind its actual relevant inputs; reused sub-evidence is not a
  fresh execution of a new full snapshot. Resource estimates are not reservations.
- Shared seeds, globals and hot-reload state can hide cross-test interference.
  Keep destructive/race fixtures private and serial until positively reviewed.
- A replacement may reveal a real product defect. Preserve the red evidence;
  distinguish an equivalent testability refactor from changed product behavior
  and resolve the latter explicitly rather than weakening the assertion.

## Non-Goals

More workers as the primary improvement; live providers or credentials; a new
scheduler/megaframework; deployment/installed-service changes; weakened security
revalidation; blanket mocking of native safety; losing unique variants to hit a
test-count target; longer deadlines/retries/error suppression; remote operations;
and deletion of historical artifacts, backups or unrelated resources.

## Rollback / Recovery

Use coherent reviewable feature commits and explicit migration maps. Keep existing
coverage until replacements have meaningful red/green evidence; revert a failed
pilot on the feature branch without rewriting historical audit/evidence. Preserve
failed diagnostics and uncertain native resources. No persisted application-data
migration or host-service activation is planned. Rebase/review input changes
invalidate affected evidence and require reassessment, not relabelling.

## Completion Checklist

- [x] Future contributors have one clear layer-selection recipe and working
  examples; new policy cases do not require a Git history, SDK or browser by habit.
- [x] Expensive current families have been reconciled by contract, not just moved
  between files; removed native executions have identified cheaper owners/bridges.
- [x] Migrated asynchronous owners have meaningful, failure-safe completion;
  unexplained settling sleeps in the named families are removed, retained
  real-time/external polls are justified, and untouched holds/deferrals are clear.
- [x] Real native, authorization, input-variant, installed-browser and genuine
  deployment guarantees survive; all replacements have reviewed equivalence.
- [ ] Complete stable-candidate acceptance, focused-feedback improvement and full-
  command improvement each meet the separate targets fixed after the baseline
  spike, or the user explicitly accepts a named remaining gap. If not,
  report the blocker and revise/revert the costly design instead of declaring
  success from smaller test counts or increased worker widths.
- [ ] Decisions and contributor rules live in maintained owners; remaining holds
  have explicit reasons; integration, remote status and resource disposition are
  reported honestly. Archive this plan only after all obligations are completed
  or explicitly transferred to a named current owner.
