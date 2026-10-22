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

# Normal fresh complete acceptance, if resources admit four/four:
nix run .#test -- all --workers 4 --jobs 4
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
| `checks.<system>.e2e` | All 25 browser groups plus terminal, preserving existing scenario/input chains and deadlines | One ordinary Nix sandbox per whole group, installed production launcher, pinned Chromium and fonts |
| `checks.<system>.service` | Genuine Home Manager activation/default-target startup, environment/permissions, durable HTTP writes/restart, real HTTP PTY and shutdown ownership | Small restricted-network, closure-only NixOS/KVM guest |

Core does not depend on the production bundle, Chromium or VM. Browser and service
acceptance use the same Nix-built production package and installed launcher, not
`next dev`, checkout `.next`, a copied application or a fake deployment unit.
The deployment suite does not repeat the browser inventory. See
[browser and deployment acceptance](../e2e/README.md) and
[ADR 0025](adr/0025-browser-and-deployment-acceptance.md).

Package and tests share a manifest/toolchain/platform-keyed dependency output,
including native `node-pty`. Application, test and manifest filesets are separate:
documentation/test-only edits do not rebuild the application; ordinary application-
only edits do not reinstall dependencies. The manifest set also includes both
[SDK installation-policy](sdk-command-environment.md) bin helpers, so their changes
must invalidate the patched dependency output. Production builds receive a private
physical dependency copy inside the builder; runtime/core use the immutable output.

`nix/static-checks.nix` binds reusable **Next typegen + tsc** and **lint** evidence
separately to their declared inputs, dependencies, toolchain and check recipe.
`nix/sources.nix` retains the application tree/assets/configuration for typegen
and TS/TSX fixtures for typing, but removes registered `*.test.mjs` and live Node
scheduling metadata (`nix/test-lanes.json`) from the typing source. Architectural
guards reject typed imports of either. Adding a JS test **and its required live
classification** can therefore reuse an unchanged TS graph while invalidating
lint; prose-only edits can reuse both. Neither implies skipping checks:
every executing core selection requires both static outputs and runs its selected
effectful tests afresh through the fresh entry point. `static-inputs.json` and
`static.log` distinguish declared-input evidence (possibly cached) from execution.
`--inventory-only` is neither static nor execution evidence.

Application inputs exclude `*.test.*`, `*.fixture.*` and `lib/testing`; test/static
inputs still admit their required support. Keep `package.json`'s packed-file
exclusions in agreement and verify the realized package inventory and dependency
input graph when support changes. The package's `node_modules` symlink exposes the
full application module set, so a root devDependency would ship too. Do not add
jsdom to the root manifest. **`jsdom@27.0.1`** instead has a private manifest/lock at
`lib/testing/package.json` and `lib/testing/package-lock.json`. The separate
`nix/test-support.nix` output built successfully without React or node-pty and is
linked only at `lib/testing/node_modules` in private core/static workspaces. Root
application dependency versions and devshell preparation contract remain unchanged;
the application cache hash is bound to the changed packed-inventory manifest.
Mounted Nix checks verify that React resolves from the root application module set.

Source-set exclusions alone do not prove runtime absence. The packaging pilot
checked the realized package: no jsdom, own helpers or test-support closure. Nix
input-graph probes cover docs, classified JS additions, TSX fixtures, application
and dependency edits. Changing only the private support dependency leaves the
application/package/runtime-module identities unchanged. These are bounded graph
and packaging proofs, not substitutes for complete candidate acceptance.

**Never run `next build` or `npm run build` in a working checkout.** Production
builds run only in isolated Nix builders. They neither activate a service nor
publish an artifact. Manual `nix develop`/`npm run dev` is separate, not acceptance.

## Contributor ownership and recipes

Choose the **lowest sufficient owner**, then add only the bridges it cannot prove:

1. Policy/data decision? Import the production module with `node:test`/Jiti; vary
   inputs without a repository, SDK or browser. Source-text matching is not a
   behavioral substitute (retain genuine architecture/import guards).
2. Async ordering/persistence/elapsed-time policy? Exercise the real instance-owned
   controller through narrow capabilities, named operation gates and an injected
   clock. Keep a native bridge for its default composition and real writes/closure.
3. React effect, current closure or unmount? Mount the real component/hook using
   `lib/testing/react.fixture.mjs`. Callback extraction alone cannot prove React
   wiring, dependency arrays, Strict Effects or cleanup.
4. Git/path/descriptor/SDK/process identity? Use private native fixtures and join
   owned operations before deleting them. Do not replace revalidation/race stages
   with a cached approval or one generic error case.
5. Layout, real capture, scroll, media, browser networking or end-user connection?
   Keep installed-package Chromium. Activation/restart/PTY/cgroup closure belongs
   to `service`, not the browser's process backend.

### Three small core patterns

These use current APIs; paths below are relative to the shown existing test files.
Each example uses the `assert` and `test` imports in the first block.
For a pure production rule (`lib/session-worktree-filter.test.mjs`):

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { sameSessionDirectory } = await jiti.import('./session-worktree-filter.ts');
test('display equality preserves POSIX case', () => {
  assert.equal(sameSessionDirectory('/main/', '/main'), true);
  assert.equal(sameSessionDirectory('/Main', '/main'), false);
});
```

For owned async work, import from `./testing/async.fixture.mjs` in a `lib/` test
(or `./async.fixture.mjs` within `lib/testing/`). Register teardown **before** work:

```js
import { createTaskOwner, deferred } from './testing/async.fixture.mjs';
test('an admitted operation stays owned through completion', async t => {
  const owner = createTaskOwner(), entered = deferred(), release = deferred();
  t.after(async () => { release.resolve(); await owner.join(); });
  const work = owner.track('operation including its handlers', (async () => {
    entered.resolve();
    await release.promise;
    return 'complete';
  })());
  await entered.promise;
  release.resolve();
  assert.equal(await work, 'complete');
  await owner.join();
});
```

`track(label, work)` observes the supplied promise immediately and returns it;
include failure/persistence handlers in that promise. `join()` closes admission,
waits for all tracked work even after a peer fails, and retains failures in an
`AggregateError`; repeated joins share completion. It neither cancels nor proves
native closure. Close the operation's own admission before starting teardown;
never start new work and then try to track it after `join()`.

For real TSX/React (`lib/testing/react.test.mjs` uses this support probe):

```js
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from './react.fixture.mjs';
const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
const { MountProbe } = await jiti.import('./mount-probe.fixture.tsx');
test('events and rerender preserve the mounted instance', async t => {
  const props = { onMount() {}, onCleanup() {} };
  const view = await mount(t, createElement(MountProbe, { ...props, label: 'first' }));
  const button = view.container.querySelector('button');
  await view.dispatch(button, new view.window.MouseEvent('click', { bubbles: true }));
  await view.rerender(createElement(MountProbe, { ...props, label: 'next' }));
  assert.equal(view.container.querySelector('button'), button);
  assert.equal(button.textContent, 'next: 1');
  await view.unmount();
  assert.equal(view.container.childNodes.length, 0);
});
```

New behavior tests mount the **production** component/hook, not a copy of its
algorithm; see `hooks/useResizablePanel.test.mjs`. `mount(t, element,
{ strict = true, setup })` registers failure-safe disposal, owns one DOM realm at
a time and runs real React with StrictMode by default. `setup(window)` precedes
render; storage/events come from `view.window`. Dispatch/rerender/unmount are
awaited `act` boundaries, not universal background-work flushes. `unmount()` joins
React cleanup; `dispose()` additionally closes the window/restores globals and is
idempotent. Join externally owned async work separately before disposing its realm.
`pointerCaptureDouble(element)` is only an unsupported-API double, never native
capture/layout proof. Keep mounted cases serial within their file.

### One default native composition

When several real handlers/helpers belong to one default lifetime, a small local
physical re-export fixture can load that dependency graph once. See
`app/api/sessions/runtime-route.fixture.ts` and its single import in
`runtime-route.test.mjs`: the same real routes, storage and SDK bindings replace
contiguous pre-test imports. Keep the original loader options and runner's disabled
filesystem cache; this is ordinary composition, not a new execution/result cache.
Per-case temporary roots, current reads, mutations, invalidations and native
settlement remain mandatory.

Do not combine imports separated by environment/filesystem/ref changes, deliberate
reloads, mocks, or independent singleton lifetimes. Review module/class identity
and initialization order, run every original case, and measure before generalizing.
Typed `.fixture.ts` files stay in type/lint inputs but outside application/package
inputs; verify those identities rather than hiding dependencies from checking.

### Completion, cost and new-feature checklist

Result, complete owned-work settlement and durable publication are separate
assertions. On success **or failure**, stop admission, release every gate, request
only cancellation you own, join work/native closure, restore globals and only then
remove private roots. Preserve both assertion and cleanup errors; one failing peer
must not abandon another. Disposing an observer cannot cancel independently
admitted Acceptance jobs (ADR 0031).

Use named request/effect barriers and controlled clocks for project-owned elapsed
policy, including just-before/at-boundary assertions. Use bounded observation for
external/native conditions; retain selected genuine interval/deadline/close proofs.
No sleep-as-settlement, universal idle/microtask flush, retries or deadline inflation.
If a regression could publish a review instead of failing, observe `reviewReady`
and assert the absence of controls/authority before joining `fullySettled`;
otherwise an unanswered erroneous review can deadlock the test meant to reject it.

Pure matrices should not pay Git/SDK/browser startup per row. Mount only when React
is the obligation; native bridges and browser chains pay real setup, tracing and
settlement costs. Measure those phases before adding splits/caches. Group splitting
remains deferred. A seven-balanced-sample native seed pilot measured construction
medians **42.204ms fresh / 36.547ms materialized** (11 / 8 explicit Git invocations),
plus **42.638ms** one-time seed creation. Config/ref/registration/file/pack inode
independence was checked, but ~5.66ms (~13.4%) per fixture does not justify new seed
infrastructure against dominant capture/execution costs. Adoption stays deferred;
no approved snapshots are reused.

Private source-variant instrumentation measured fewer explicit Git dispatches and
inventory starts, including zero of either in nine leaf cases. The server's two
additional dispatches retain a stronger held-HEAD guard. These are source-versioned
operation counts, not final-candidate timing or a complete-command speedup; do not
sum overlapping wall intervals. Detailed counters belong with the plan's evidence.

For a new feature or replacement:

- Name the contract, primary owner and required native/browser/service bridges;
  keep distinct authorization, identity, race and persistence-failure obligations.
- Exercise real production behavior, a meaningful failing defect, success/failure
  settlement, stale completion and unmount where applicable; document proof limits.
- Keep helpers `.fixture.mjs`, typed compositions `.fixture.ts` and mounted probes
  `.fixture.tsx`; verify discovery, source graph and packed inventory. Never import
  registered tests from production.
- Review live F/N/E isolation and record an explicit rationale or unresolved E hold
  for every new test file. Re-review changed helper/native effects; do not edit the
  historical audit into current scheduling authority.
- Preserve browser IDs/input variants/order and whole-chain receipts when changing
  owners; name the replacement before retiring an assertion.
- Iterate with exact `core --file` / `e2e --group` selections, then obtain required
  complete static, `core`, `e2e`, `service`/`all` evidence at the verified candidate.
  Report static reuse, preparation, fresh execution, wall time and failures separately.

The three source-shape checks in retired `hooks/model-switching.test.mjs` now have
strengthened actual callback/loader owners in
`hooks/useAgentSession.model-selection.test.mjs`, plus real Chromium. Those extracted
production callbacks are **not mounted-hook proof**. Actual mounted GitExplorer/Move
ignored-abort tests are now present in
`components/GitExplorer.stale-delivery.test.mjs` and
`components/SessionMoveDestinationPicker.stale-delivery.test.mjs`, with genuinely
delivered JSON and joined failure cleanup, without production changes. Their focused
Nix checks and private stale-acceptance mutations exercise those assertions; complete
candidate acceptance remains separately required. Broader full
`useAgentSession`/FileViewer mounting is deferred. Do not describe all source-shape
families as migrated.

## Source and credential boundary

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

For fresh complete acceptance, normally select explicit **four browser sandboxes /
four core workers** with `nix run .#test -- all --workers 4 --jobs 4`, matching the
measured budget below. Confirm available CPU/memory headroom and coordinate other
resource-consuming runs first; admission estimates are not machine-wide reservations.
If constrained by resources or concurrent work, select a smaller supported budget
and state the concrete reason before launch. Record requested/effective widths and
admission from `selection.json` and the level reports. A read-only reviewer alone
does not justify reducing concurrency; a focused `core --jobs 2` example is not the
full-acceptance recommendation. Never bypass admission or increase deadlines.

This is invocation guidance, not a change to runner defaults: bare `all` uses two
core workers when overlapping (four when serialized), while browser width is
resource-admitted. Pass both flags explicitly for the measured four/four profile.
Nix `--max-jobs` / `--cores` control realization; the original builder's
`NIX_BUILD_CORES` also caps effective core file workers. Fresh core selections
with an explicit `--jobs` above four now request up to eight Nix cores per build;
without that selection the four-core allocation is unchanged.

Explicit `all --workers 8 --jobs 8` is an opt-in scaling experiment, not a new
recommended default or a measured speedup; [ADR 0032](adr/0032-opt-in-acceptance-widths-and-reviewed-test-batches.md)
records this bounded extension of ADR 0025's scheduling ceiling. Browser widths through eight are
supported explicitly; automatic browser admission remains capped at four. The
8/8 overlap estimate includes two eight-core core builders, eight browser
sandboxes, and worker memory: **32 effective CPUs / 51 GiB available RAM**.
Insufficient combined headroom serializes the levels normally. For an overlapping
benchmark, wait for admission rather than accepting that serial execution as
8/8-overlap evidence. Do not bypass resource estimates or change deadlines.

Report the full command's end-to-end wall time, including any realization within
that command, plus separately available prerequisite-preparation and test-execution
intervals. Identify any prewarming done before the command. Overlapping intervals
must not be added together or subtracted as if serial. Warm-prerequisite benchmark
times are not cold-cache promises; keep model/review/coordination time separate.

The core universe is recursive `*.test.mjs` under **app, components, hooks, lib,
public and plugins**. Browser scripts and `.fixture.mjs` helpers are not silently
registered as tests. Every discovered test participates. Runtime unknown/unreviewed
files still warn and fail closed to **E**, never disappear. The live review contract
requires an explicit isolation rationale or justified E hold for each new file;
`nix/test-design.mjs` enforces that requirement without weakening runtime fallback.
Live F/N/E entries in `nix/test-lanes.json`, including `manifest.holds` for explicit
unresolved E reasons, own current classification. The immutable
`nix/test-lanes-audit-2026-10-22.json` records its historical revision, not current
filenames, lanes, estimates or bodies.

- Core desired workers: **8**; `--jobs` accepts canonical **1..32**. Effective workers
  respect CPU affinity/quota, Nix allocation and memory: 1 GiB reserve plus 2 GiB
  per worker. Linux uses `MemAvailable` and ancestor cgroup headroom.
- Core files have private environments, pinned Git and Node file concurrency 1.
  Reviewed F/N files share the pool, ordered longest-first by optional manifest
  `estimatedMs` (positive safe integer; omitted means zero), with canonical path
  ties. Estimates are coarse historical priority hints, not deadlines, resource
  reservations or permission to skip work. E files retain their serial inventory
  order after draining the pool; unreviewed files still warn and default to E.
  E classification does not block an independent browser invocation.
- Git Workflow cleanup/discard/server/project-management are explicitly reviewed N
  files: separate file processes and private Git/agent/TMP fixtures isolate their
  globals, fault injection, settings and owned native effects. Their cases remain
  serial. The source cwd is still shared; future source-relative writes, fixed
  ports or unscoped process effects require another isolation review. Concurrency
  changes do not authorize weaker Stop, permission, stale-state or cleanup checks.
- A second reviewed batch adds synthetic RPC idle-timeout tests to F, and native
  Git Workflow runtime/policy, RPC shutdown/directory reservations, project-trust
  and worktree-manager routes, worktree management and external-session-write
  tests to N. Private fixtures/process-local maps isolate their effects; real
  journal/trust/settings/JSONL writes make the native cases N rather than F.
  Controlled clocks preserve the original 999/1000ms shutdown proof. The source
  cwd is writable, not filesystem-isolated, and source-relative writes remain a
  blocker. Large-operations and model-speed-lifecycle retain unresolved E holds
  pending stronger timeout-settlement/resource and asynchronous-teardown evidence.
- Browser fresh full execution admits explicit **1..8 concurrent group sandboxes**
  (automatic selection remains capped at four), estimating
  2 CPUs/4 GiB per group plus 2 GiB host headroom. `--workers 1..8` refuses an
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
run still requires typegen/tsc and lint evidence (possibly reused for their exact
inputs) and fresh selected effectful execution; `core --inventory-only` does neither.
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

### Current overhaul evidence boundary

The replacement control took **413s**. Focused candidate evidence passed **22 files /
494 tests in 125s**, including fresh static preparation, **before the late guard,
checkpoint and mounted-test additions**. It does not verify those additions or the
new isolated-support composition. A diagnostic candidate browser run passed
**26 groups / 59 receipts in 414s**, **including cold production realization**.
That is not a measured speedup or complete candidate acceptance; complete static,
core, browser and service acceptance and performance verification remain outstanding.
Browser packing hints live in `nix/browser-plan.mjs`: baseline values come from
candidate diagnostic `d44f40e5`; the expanded SSH whole-group hint is separately
refreshed from its post-rebase installed run. Each source is recorded beside the
values. Hints are not deadlines, admission or coverage authority.

### Historical timing

The following retained measurements and release/source narratives describe their
recorded candidates, not current live classification or overhaul acceptance.

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

### Measured reviewed-core scheduling

On the same native x86_64 host and four-core-worker/four-browser-sandbox budget,
a paired fresh comparison passed on 2026-10-16:

| Report interval | Corrected baseline | Reviewed N / longest-first |
| --- | --- | --- |
| Core | 414.377s | **287.462s** |
| Browser | 226.879s | 215.217s |
| Deployment | 23.512s | 21.722s |
| Complete command | 417.385s | **291.599s (4m52s)** |

Complete wall time fell **125.786s / 30.14% (1.431x faster)** without increasing
worker count. Both runs use the same application derivation, toolchain, browser
scenario inputs and exact cursor-specific history matcher. An earlier unchanged
trial failed because its broad history matcher consumed a late initial response;
that retained 119.028s failure is not the performance baseline. The approved
fixture correction changes no action/assertion/deadline and has meaningful red/
green regressions plus real history acceptance.

Both runs passed **308 core files / 10 suites**; core cases grew **2,399 → 2,404**
through scheduler regressions, with none skipped/cancelled. All **24 browser/terminal
groups / 53 exact scenario receipts** and every deployment/settlement proof passed.
The four Git files retain their **303** original cases and unmodified bodies;
actual full-run overlap is **34.833s**, with E waiting for the entire pool.
Individual files were slower under contention, but ran concurrently: no timeout
was increased or failure hidden. Serial E work fell **335.713s → 135.634s**.

Core remains the critical path, now about 50s beyond the browser/deployment track.
These are measured command times, not a cold-cache or machine-exclusive claim:
prerequisites were warm, executions fresh, admission 16 CPUs/27 GiB (estimates,
not reservations), host 32 logical CPUs/about 54 GiB available at browser admission.
Four-worker load is verified; broader-width timing, native ARM and CI execution
remain unverified. Exact identities, failures and evidence live in the
[completed core parallelism plan](plans/archived/2026-10-16_core-test-parallelism-plan.md).

### Measured second-batch file parallelism

A fresh four-worker/four-browser-sandbox pair passed on 2026-10-17, starting from
local `rst-main` `04a0ac6`. Nine more audited default-E files enter the existing
pool; no runner implementation, production code, existing test-body or deadline changes.

| Report interval | Unchanged control | Second reviewed batch |
| --- | --- | --- |
| Core | 292.028s | **251.489s** |
| Browser | 216.875s | 213.847s |
| Deployment | 24.277s | 21.369s |
| Complete command | 296.227s | **255.502s (~4m16s)** |

Complete wall time fell **40.725s / 13.748% (1.1594x faster)** at the same worker
budget. Serial E work fell **135.568s → 102.206s**; the pool absorbed the extra
work without a larger admission width. Both passed all **308 files / 10 suites**,
**24 browser/terminal groups / 53 receipts**, and genuine deployment/settlement
proofs. Tests grew **2,404 → 2,406** through two manifest contracts. All 307 other
files retained identical registered/completed outcomes and counts; the original
unit titles remain alongside the two additions. None skipped or cancelled.

Before ordinary acceptance, a separate diagnostic Nix run passed **416 tests**
with a peak of four active native files: all nine candidates overlapped cleanup,
and the E contract waited for the pool. Inotify watched 1,126 source entries with
zero observed mutation events. This checks the shared writable source rather than
assuming it is immutable; it is not a universal write/descendant guarantee or a
performance benchmark. The observer exists only in a diagnostic snapshot, not the
repository or ordinary acceptance runner. Large-operations and model-speed-lifecycle
remain exclusive, pending their separate settlement/resource/teardown evidence.

Both ordinary runs used the same production package, tools and Node 24/SDK 1.3
inputs. Prerequisites were warm, all test executions fresh; isolated preparation
was **8.722s control / 7.525s candidate**, separate from command runtimes. Native
x86_64 host: 32 logical CPUs, about **55 / 57 GiB** available at browser admission;
combined admission remains an estimated **16 CPUs / 27 GiB**, not a reservation.
This is one fresh pair, not cold-cache, statistically repeated, ARM, CI or
above-four-worker evidence; no per-worker RSS peak is claimed. Core is still the
critical track, now about **16s** beyond browser plus deployment. Exact inputs,
red/green checks, failures, artifacts and scope live in the
[completed second-batch plan](plans/archived/2026-10-17_core-exclusive-batch2-plan.md).

### Audited default-exclusive batches

The 2026-10-22 audit covers 192 formerly default-exclusive files (189 from the
measured core run plus three incoming scratchpad files). The hash-bound verdicts,
file-specific reasons, helper evidence and explicit unresolved holds are retained
in `nix/test-lanes-audit-2026-10-22.json`. Exactly **86 F / 42 N** files enter the
existing pool; **64** remain default-E. Existing manifest entries, substantive test
bodies, per-file serial cases, deadlines and resource admission are unchanged.
`lib/test-lanes-audit.test.mjs` protects the reviewed selection and holds.

These are scheduling reviews, not a blanket claim that all native effects are
safe. Process-local mocks are isolated by existing file workers; native promotions
use private fixture roots and joined operations. Deferred cases include SDK/native
shutdown uncertainty, descriptor-backed stream closure, real short timing/resource
holds and incomplete import-effect review. In particular, large-operations and
model-speed-lifecycle stay exclusive. Changes to audited fixture/effect code need
fresh review; stored hashes identify the audited revision, not future authority.

A separate diagnostic snapshot ran all 128 promotions, the four heavy native Git
files and the existing exclusive runner contracts: **134 files / 1,089 tests**
passed at four workers. All 42 newly pooled native files overlapped peer work;
original 133-file cases/outcomes matched control. Inotify observed zero mutations
across 140 source-directory watches, without overflow/watch loss, and final source
content/mode hashes matched. The observer exists only in the diagnostic snapshot;
ordinary acceptance is unchanged. This is bounded inotify/final-state evidence,
not certification of restored mmap/external-hardlink writes, arbitrary host effects
or escaped descendants.

The first ordinary four/four pair passed all coverage, but **did not demonstrate
an end-to-end speedup**: complete command **433s → 520s**, core **427.828s →
489.999s**, browser **382.850s → 485.108s**, deployment **24.346s → 26.727s**.
The identical application package and all 408 original core outcomes were checked;
new metadata adds three cases. Serial files fell **211 → 83**, while the observed
E tail fell **225.324s → 185.206s**. Broad timing inflation affected unchanged
browser groups too; this does not establish its cause or excuse the slower result.

A separate sequential **core-only, 16-effective-worker** control/candidate pair
using the same fresh core derivations passed **408/3,063 → 409/3,066** files/tests,
with all original outcomes identical. Command wall time was **383.823s → 254.658s**
(**33.65% less**); pre-test setup/realization/static intervals **53.634s → 39.339s**;
file execution **329.799s → 214.929s**; serial tail **203.426s → 109.738s**. Both used
one Nix builder allocated 16 cores (`fresh-core.nix`, selection `--jobs 16`), not a
claim that the normal fresh CLI's eight-core allocation cap was removed. Sixteen
was selected to leave headroom for another observed Nix build. These are single,
non-machine-exclusive pairs with fresh executions and warm dependencies, not
cold-cache promises or statistically repeated causal measurements. No separate
prerequisite prewarming was performed. The four/four and core-only results are
not interchangeable; full acceptance remains mandatory.

These paired measurements cover the pre-rebase audit candidate `172ce4d` and its
`27a5375b` control. Subsequent main composition is verified separately, not relabelled
as a new timing pair. The final current-main composition passed full ordinary
four/four acceptance in **416s (6m56s)**: core **332.438s** (54.337s pre-test,
277.588s file window, 143.468s E tail), browser **383.718s**, deployment **24.941s**.
All **409 files/3,084 tests/12 suites**, **26 groups/59 scenario receipts** and
settlement gates passed. Its application/runtime inputs include newer main changes,
so 416s is final acceptance evidence, not a matched comparison to the earlier control.
Exact identities, retained reports, review corrections and remaining holds live in
the [completed batch audit plan](plans/archived/2026-10-22_default-exclusive-audit-plan.md).

For the subsequent stable-main integration at `18abd376`, independent helper-delta
review retains all 128 promotions. Three changed held-file hashes are refreshed
without promotion; the new Acceptance runtime test remains default-E outside the
original 192-file audit. Its plugin registration/settings remain process-local or
private-fixture-bound, and first-command binding now awaits the existing settlement
promise. Earlier acceptance/timing results retain their recorded source identities;
this newer composition requires its own complete verification.

Its initial full run failed an existing file-panel resize assertion before complete
coverage. The trace showed a one-shot count immediately after viewport acknowledgment;
this was not hidden by an unchanged retry. A separately user-authorized fixture-only
correction now awaits disappearance of that same locator using the existing page
timeout, then retains the original strict assertion. Deterministic delayed-settlement,
error-propagation and strict-negative regressions fail without the wait and pass with
it; the real focused file-edit scenario also passes. No production behavior, browser
deadline, expected scenario or error filter changes. The corrected latest-target composition then passed full four/four acceptance in
**388s (6m28s)**: **411 files / 3,100 tests / 12 suites**, all **26 groups / 59 scenario
receipts**, genuine deployment and settlement. Core took **300.041s** (51.565s
pre-test setup/static/realization, 248.099s file execution), browser **359.008s** and
deployment **21.418s**. These overlapping intervals are not additive. The production
package matches the failed run; this is a fixture correction, not a production fix.
Failure evidence and exact final composition identity are retained in the completed
audit plan; it is not a new matched performance pair.

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
