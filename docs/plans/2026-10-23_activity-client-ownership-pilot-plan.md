# Activity client ownership and UI-functional testing pilot

## Goal

Separate Activity's client-side orchestration, mounted React behavior and native
browser proof so that each contract has a small, meaningful owner. Prioritize
confidence, explicit lifecycle ownership and precise failures over a particular
Activity runtime. Reduce duplicated browser work only after replacement proof.

## Authority and agreed decisions

**Implementation authorized.** After reviewing this plan, the user requested the
complete Activity work and refactor in one continuous effort, with questions only
for important issues. This authorizes the bounded pilot below, not a suite-wide
migration or product redesign. Exact-state local integration and resource cleanup
retain their separate harness approval gates; no remote publication is authorized.

The previous overhaul and this original planning-only document were integrated at
`76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92`. Implementation starts from that local
main in `refactor/activity-client-ownership`, linked checkout
`/home/robert/projects/3rdparty/pi-desk-worktrees/activity-client-ownership`.
Evidence is retained under
`/home/robert/.cache/pi-web-activity-pilot/run.civBQj`.

The user selected:

- Activity first, as a complete pilot, not a suite-wide migration.
- A dedicated Activity controller with thin React adapters.
- Mounted tests of the real Activity/Starred feature slice and production wiring,
  rather than a copied algorithm or an entire unrelated AppShell environment.
- One representative real E2E journey: **Question → Later → reload → answer →
  Ready → Read**, plus focused viewport/keyboard/touch/layout checks.
- Ordinary core tests with clear filenames and a contributor recipe; no new
  framework, runner, mandatory check or CLI family.
- Preserve intended user-visible behavior, APIs and persisted formats. Report
  suspected bugs and worthwhile architectural improvements explicitly; do not
  silently include a behavior/UX redesign.
- No new Activity-specific runtime cutoff. Measure the result and retain the
  existing focused/full performance gates and verification safeguards.

Historical planning checkout: `test/suite-architecture-overhaul`, initially
`89592d32447942314685b69adbd5fc5e48be1e46`. Local main was observed at
`b2730a7edec8f3f81453fab8e837ffa916b51544`; its incoming difference was an unrelated
planning document, not an Activity implementation. Revalidate current sources and
instructions before any future implementation or integration. This plan does not
rebase, merge, or modify that other plan.

## Context and plan relationship

The recorded Activity capsule took **214.4s** at the same four-browser/four-core
budget: overview **129.4s**, native child lifecycle **12.3s**, Pause/Resume **38.2s**,
Acceptance **26.2s**, other boundaries **8.4s**. Three sequential complete chains at
1280/700/390px repeat much of that functional work. Traces show repeated 2.3–2.8s
state-visibility waits; the production running-state poll is 2500ms. These are
observations, not proof that all waiting is redundant or removable.

The prior verified executable source `8mrm41dja657y412m71vpjzjmxyss3jc` passed full
347/345s runs (median346s), 436 files/3369 tests, 26 groups/59 receipts and genuine
Home Manager deployment. Focused Panel samples were 5/5/4s (median5s). Those are
historical input-bound evidence, not acceptance of this unimplemented pilot.

- [Feature contracts](../feature-internals.md) own current Activity/Starred,
  privacy, explicit Read/Later, restoration and native Pause behavior.
- [Testing](../testing.md), [browser acceptance](../../e2e/README.md) and
  [ADR0034](../adr/0034-behavioral-test-ownership-and-feedback.md) own the existing
  layering, mounted support and proof limits.
- [ADR0031](../adr/0031-project-acceptance-coordination.md) owns Acceptance jobs
  independently of sessions/observers. This pilot must preserve that contract.
- The [server-side activity review plan](2026-09-25_server-activity-review-plan.md)
  owns its ledger/API feature and legacy outstanding checklist. This pilot does
  not declare those obligations complete, rewrite its history, or change the
  server receipt format/authorization/retention policy.
- The [archived overhaul](archived/2026-10-22_test-suite-architecture-overhaul-plan.md)
  owns prior migrations and evidence. Its guarded Git closeout completed before
  this implementation; this is a new, bounded pilot, not a reopened general overhaul.

## Architecture

### Production owners

```text
Existing backend/core owners: rules, receipts, persistence, native lifecycle
                                |
                 Activity client controller (one app instance)
                                |
                 Thin production React adapters/composition
                                |
                    Sidebar / Activity / Starred
```

The controller is a **client coordinator, not another backend or universal store**.
Reuse `lib/activity.ts`, `lib/activity-review.ts` and existing authoritative receipt
identities. Keep catalogue loading/navigation, privacy storage, star persistence,
selected ChatWindow/SSE/question submission, native SDK execution and Acceptance
jobs with their existing owners. Feed their relevant snapshots/changes through
narrow boundaries; do not absorb the whole Sidebar into a new god controller.

Candidate seams are a client-only module such as `lib/activity-client-controller.ts`
and a thin hook such as `hooks/useActivityController.ts`; names are provisional.
Use the real production composition in both application and mounted slice tests.

The controller should own:

- Shared running/attention/review/pause snapshot observation and reconciliation.
- Read/Later queues keyed by exact displayed completion/request identity, including
  writes queued during an in-flight request and lost-response confirmation.
- Request generations/context identity so stale, ignored-abort and out-of-order
  deliveries cannot overwrite current state or hide newer work.
- Stable observable snapshots/selectors and narrow action/subscription boundaries.
- Owned polling/request lifecycle and explicit completion handles for teardown.

Transport, scheduler/clock and visibility/event inputs are narrow capabilities with
real defaults. Keep current production polling cadence and validated retry rules;
controlled tests advance owned time, not product deadlines. Do not introduce blind
retries of ambiguous mutations or security-bypassing production test flags.

### Lifetime and React boundary

One app-owned instance serves all three views. Closing one panel removes that
consumer; it must not stop the remaining consumers or cancel independent work.
Construction must be side-effect free. Specify replay-safe observation activation/
deactivation separately from terminal admission closure/disposal: React StrictMode
setup/cleanup/setup must not reuse an irreversibly disposed owner, duplicate polling,
or leak the discarded instance. Final teardown stops admission and joins complete
owned promises, including failures, before restoring globals/removing fixtures.

Preserve visibility-aware observation and the distinct interrupted-journal demand:
do not move journal scans into every frequent running-state poll. Existing privacy
owners still fail closed when identity/state is unresolved. Initial catalogue
restoration is not explicit user navigation and must not close an overview the user
opened meanwhile. Pause/Resume commands use existing routes/identities; observing
or disposing this controller confers no native cancellation or Acceptance authority.

### UI-functional tests: the missing middle

- **Direct controller cases:** real production transitions with controlled response
  gates/time; no SDK/browser merely to vary a client decision.
- **Mounted feature slice:** real React, Activity/Starred components and their real
  adapter/controller composition. Exercise DOM events, current closures, pending/
  error states, subscriptions, rerenders and cleanup. Reuse
  `lib/testing/react.fixture.mjs` and `async.fixture.mjs`, with StrictMode on.
- Replace only external boundaries, not the state machine, selectors or callback
  wiring under test. Avoid a test-only host that reproduces AppShell's algorithm.
- jsdom does not prove geometry, CSS layout, native focus traversal, real touch,
  cross-tab browser events, native networking or process closure. Keep appropriate
  installed-Chromium/native bridges. Mounted cases stay serial within their file;
  other file lanes require actual closure/effect review, not automatic promotion.

## Initial contract-to-owner map

This is a migration starting point, **not permission to delete assertions**. First
inventory each current assertion/variant and record its exact replacement/bridge.

| Current obligation | Primary lower owner | Retained browser/native bridge |
| --- | --- | --- |
| Status precedence, nesting, project filtering and concealment | Existing `lib/activity.test.mjs`, plus explicit missing cases discovered by inventory | Rendered labels/filter interaction, indentation and responsive layout |
| Read/Later identity, new completion/question, durable merge/contention | Existing review helper/store/route tests; new client queue/reconciliation cases | Golden journey, explicit navigation is not Read, representative persisted reload/other-context observation |
| Optimistic updates, stale polls, visibility and restoration | New controller plus mounted production slice; existing source-regex checks alone are insufficient | Actual API-to-render update/polling connection and initial-restore interaction |
| Bulk Read, exact callback targets, pending/disabled/error controls | Mounted slice plus existing server/native action owners | Focused keyboard/touch/geometry and any indispensable default-wiring representative |
| Pause/Resume, queue drain and branch/race protection | Preserve genuine `lib/session-pause.test.mjs` integrations; add missing ledger/wiring proof before migration | Retain a small real control/native bridge if lower composition cannot prove that connection |
| Acceptance queue/cancel/dispose/process/lock behavior | Preserve `lib/acceptance/` controller and actual process/lock tests | Preserve indispensable configuration/status/action/independence wiring, without repeating lifecycle matrices at every viewport |
| Stars/storage migration | Keep existing owners and representative legacy/reload/cross-tab guarantees | No storage-subsystem redesign or expanded migration matrix in this pilot |

Native core is not synonymous with pure mocks: private filesystem, kernel identity,
SDK/process closure and intentional contention remain real. Serialize integration
where globals/native ownership require it; do not serialize pure matrices by habit
or remove deliberately concurrent race tests.

## Required behavioral acceptance cases

The user made the following five areas explicit pilot obligations:

| Priority | Required counterexamples and outcomes |
| --- | --- |
| Critical: stale/out-of-order | Deliver A after B and across A→B→A/context changes; deliver JSON despite abort and after consumer teardown; newer state/receipt identity must win. |
| Critical: failed/ambiguous writes | Lost acknowledgement after durable success reconciles correctly; rejected writes preserve existing feedback/retry semantics; stale Read cannot hide a newer completion; old Later cannot hide a replacement question; enqueue B during A and drain it after A succeeds. |
| Critical: lifecycle/shared ownership | Multiple consumers produce one observation loop; closing Activity leaves others live; hidden/visible transitions and StrictMode replay do not duplicate work; final disposal waits for gated success/failure callbacks and leaves no owned timer/request/subscription. |
| Critical: privacy/restoration/context | Unknown/concealed project state stays concealed; stale responses after project/selection changes cannot leak into the current view; initial restoration cannot close a user-opened overview; explicit navigation retains its current behavior. |
| High: actions/independence | Bulk Read targets only eligible ready children in scope, not parents/live/blocked/queued/interrupted/Later rows; request/completion identities are correct; double-submit/pending/error behavior is preserved; observer/session disposal does not cancel independent Acceptance/native jobs. |

Use meaningful controlled defects to prove these owners reject failures. Observe a
wrong publication before joining if joining it could otherwise deadlock the oracle.
Fixture failure paths release all gates, join owned work and retain primary plus
cleanup errors. A helper promise is not proof of native closure.

## Execution evidence and current limits

Evidence root: `/home/robert/.cache/pi-web-activity-pilot/run.civBQj` (exact commands,
logs, exported sources, reports and private rejected variants retained).

- Original `76e5fe4d…` control failed **209s** at the tablet Acceptance fixture's
  Node `route.fetch` GET with `ECONNRESET`, followed by an unhandled Playwright route
  continuation. Failed builder retained; inner logs were inaccessible and no gate
  was bypassed. This is not a timing sample or an established socket-cause diagnosis.
- A planned control changed **only** that initial status bridge to the existing
  browser-read barrier, requiring consumed native JSON after navigation. Full fresh
  `all --workers 4 --jobs 4` passed **348s**, **436 files/3369 tests/12 suites**, all
  **26 groups/59 receipts** and genuine deployment. Activity **215.361s**. Source
  `/nix/store/mwckg60mj0jshb0p4djyah4al5wvnrya-source`, export digest
  `35939a9c447f9106f3ee12f109bf66dfee322b3ce91847468bebae368766c4d9`.
  Core/browser/VM reported intervals **298.082/317.631/23.647s**; core/browser overlap.
  Browser support/manifest **3.713/4.686s**, unchanged application package. Admission
  recorded 32 CPUs/about54GiB available, effective four browser/four core. These
  mixed intervals are not evaluator-only costs or a cold-build promise.
  The exact bridge is committed as `3db6eea9682ea981f4fe3c0131fa7f97867f0604`.
- Production ownership/mounted/native selections: **6 files/95 tests/40s**, then
  **8 files/129 tests/44s**. Earlier39s failure exposed a wrong test-text oracle and
  accidental microtask batching; corrected actual UI text and immediate original
  A-before-B admission. Passing selections include static input-bound evidence;
  these are not complete-candidate acceptance or the Panel timing gate.
- Five private runtime defects failed at their intended assertions (**37/36/35/36/
  38s**): stale post-JSON publication; using current rather than rendered token;
  fail-fast catalogue join; swallowed teardown-time request; native Pause wrongly
  recording completion. Zero cancellations/uncertain files/observed survivors in
  their bounded runner summaries. The old copied failure collector with the same
  late-request defect incorrectly passed14tests/40s, proving the live collector's
  counterexample. No private mutant was adopted; no escaped-descendant certificate.
- A further actual Acceptance coordinator/native-process bridge passed **5 tests/
  43s**: dispose the actual Activity observer while an admitted watched-file-gated
  child retains its kernel identity/unaborted signal/running ledger, then release
  that job's own gate and require durable success and real process closure. Its
  first52s failure was an under-budget logical fixture admission (512MiB versus
  128+1024 required); corrected to2048MiB within sandbox budget and valid ESM.
  A second42s failure compared volatile process state R/S as identity; now compare
  PID/start/parent/group/session and require a live nonsuspended state. No deadline
  increase. The existing detached-child E hold remains unresolved and unchanged.
- Independent source ownership review found no P1/P2 production blocker. Exact old
  assertion inventory and amended disposition are retained as
  `browser-assertion-map.md`, `browser-reduction-contract.md`,
  `browser-reduction-addendum.md` and `browser-disposition-review.md`. Review caught
  missing compact/mobile Acceptance bounds, Escape/focus and Plugins switch proof;
  those are explicitly retained before any browser deletion. Actual private browser
  extraction still needs source review, adoption and installed acceptance.
- Scope limits remain explicit: mounted ActivityViews/notification adapters are not
  full Sidebar/AppShell/router/metrics mounting. Native/default/browser owners stay
  real. The shared `owned-routes` event-rejection escape and socket cause remain
  unresolved, not silently declared fixed by removing one Node proxy read. Existing
  unbounded-batch/retention edge risk was flagged separately, not redesigned.

## Plan

- [x] Pin the then-current composed source and its relevant timing baseline before
  implementation edits; do not relabel the historical214.4s run as a new control.
  Inventory `e2e/activity.mjs`, its browser-suite chain, native subagent, Pause and
  Acceptance helpers, and current core/component coverage. Map every
  assertion and viewport/input obligation to an owner, bridge or explicitly obsolete
  contract; identify source-regex-only and static-render-only gaps. Review that map
  before deleting/reducing any browser case.
- [x] Specify the client snapshot/action identities, narrow ports and replay-safe
  lifetime contract. Trace catalogue/privacy/star/navigation ownership and all
  existing consumers/events. Call out architectural improvements and suspected bugs
  separately; obtain a decision before changing visible semantics or settled ADRs.
- [x] Add the real instance-owned controller and small core cases for stale delivery,
  queue/reconciliation and shared lifecycle. Preserve default transport/cadence/API
  behavior; prove intended red/green failures and complete teardown.
- [x] Connect thin production React adapters and mount the real Activity/Starred
  feature slice. Prove clicks target exact identities, current props/closures,
  privacy/restoration, pending/errors and StrictMode/multiple-consumer disposal.
  Retire only source checks whose actual behavioral replacement is established.
- [x] Reconcile native/composition gaps without weakening existing real SDK/store/
  process/race tests. In particular, do not mistake pause/transcript assertions for
  explicit proof that a pause creates no Activity completion/acknowledgement.
- [ ] Replace repeated browser matrices with the agreed golden journey and focused
  viewport/input checks, using the reviewed map. Preserve necessary real polling,
  reload/cross-tab, native control and Acceptance-independence connections. Update
  scenario IDs/independent inventories honestly; do not rename omitted proof as
  covered or split groups merely to increase effective concurrency.
- [ ] Obtain independent ownership/security/lifecycle review, then run focused Nix
  core/mounted/native selections and the complete focused Activity group. Freeze
  writers during export; retain failures/traces and distinguish owner defects from
  runner/environment failures using evidence.
- [ ] Complete stable-candidate Nix acceptance and before/after measurements at the
  unchanged four-browser/four-core budget. Record exact source/commands, coverage,
  available resources, phase timings and artifacts; preserve the original focused
  ≤20.5s/full≤351.05s gates unless the user explicitly revises them. No additional
  Activity cutoff, speed promise, cold/CI/ARM claim, retries or deadline inflation.
- [ ] Update maintained contributor recipes and Activity contracts; record durable
  architectural decisions in ADR0034 or a new ADR if a settled contract changes.
  Revalidate current main/exact candidate for any separately approved integration;
  report remote/resource status honestly and archive only after completion/handoff.

## Non-Goals and risk disposition

- No authority is inferred from this plan itself. The subsequent implementation
  request is recorded above; integration/cleanup still require their exact-action
  approvals. No remote publication or modification of the installed deployment.
- No suite-wide/Markdown migration, new mandatory test layer/backend/CLI, universal
  state/testing framework, polling acceleration, shared mutable native fixtures or
  cached approval/results. Broader Sidebar extraction is allowed only where needed
  for this Activity boundary, not as a general navigation/catalogue rewrite.
- No new pending/error UX or storage-format migration. Preserve validated retries,
  exact identities, fail-closed availability/privacy and existing star migration.
- Avoid duplicated truth: keep server receipt authority and existing projections;
  retain a genuine default-composition browser/native bridge, not only mocks.
- Measured Activity improvement is desirable, not evidence of complete-suite gain:
  another browser queue previously determined the critical path. Do not infer saved
  wall time from summed overlapping cases or automatically widen/reclassify lanes.
- Remaining unknowns are the exact per-assertion migration map, StrictMode-safe
  app-owner/consumer lifecycle, necessary native UI bridges and measured new cost.
  Resolve them as early tasks, not assumptions hidden in the final browser deletion.

## Rollback / Recovery

Keep coherent controller/adapter/test commits and the old assertion map until new
proof passes. Preserve external APIs and durable files; reverting the pilot must
not delete ledgers, sessions, stars, snapshots or unrelated resources. A semantic
conflict or new bug pauses that affected migration for a user decision; retain the
red and original proof instead of weakening assertions or changing timeouts.

## Completion Checklist

- [ ] Every former Activity obligation has a reviewed lower owner/necessary bridge;
  removed source/static/browser assertions have meaningful replacement evidence.
- [ ] All five selected behavioral priorities pass on real production controller
  and mounted composition, including failure/teardown paths and controlled reds.
- [ ] Native/security/persistence/SDK guarantees and Acceptance independence remain
  real; deliberate races and current exclusivity holds have explicit disposition.
- [ ] Golden journey and focused viewport/keyboard/touch checks prove real wiring
  and browser-specific behavior without triplicating the functional matrix.
- [ ] Stable-source core/static/plugin, complete browser/terminal inventory and
  genuine deployment pass; input-bound evidence and fresh execution are distinct.
- [ ] Focused/Activity/full timings and coverage are reported at unchanged widths;
  existing gates pass or a blocker is reported without a silent waiver.
- [ ] Maintained guides/ADR own the final mechanism and proof limits; any residual
  obligation has one named current owner; integration/publication/cleanup authority
  and actual execution are not inferred from plan status.
