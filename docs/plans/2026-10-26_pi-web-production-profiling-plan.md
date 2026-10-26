# Pi Web production latency — profiling plan

**Status: proposed; profiling has not started.** The user authorized saving this
plan in a separate linked worktree, not executing it. No instrumentation,
application/test/configuration/dependency changes, profiling, browser automation,
application/API probes, tests, benchmarks, builds, service actions or model calls
are authorized by this document. Retain the planning worktree. The user subsequently
authorized a documentation-only commit and rebase onto current local main; that
Git-only request does not authorize integration, publication, cleanup or profiling.
Execution needs a new explicit user request. Conditional service/configuration
changes need their own exact authorization rather than being inferred from that
request.

## Goal

Find where Deep Thought's installed Pi Web loses time during opening/reloading
and ordinary use, particularly with a large saved-session catalogue. Rank the
actual foreground critical-path costs and recurring responsiveness costs, rather
than treating static complexity or acceptance-file elapsed time as attribution.
Deliver measured findings and a small set of justified next changes, not fixes or
a permanent profiling framework.

## Context

The user's priorities are opening/reloading and general sluggishness, possibly
while agents run, in the installed Nix/Home Manager service on Deep Thought,
using desktop browsers and mobile browser/PWA. No particular chat, screen or
provider has been identified as the sole symptom.

The read-only source investigation began at local main
`666a75ef71ae6ae5057fa4e5b1b2124c6ebf3b19`. The planning worktree starts from checked,
clean local main `e8a0ba6be95dcd25882ebdb2146d2d464663dccf`:

- Branch: `plan/pi-web-production-profiling`.
- Worktree: `/home/robert/projects/3rdparty/pi-desk-worktrees/pi-web-production-profiling-plan`.
- Installed reference reported by `pi_web_source`: Pi Web 0.9.3 at
  `/nix/store/v7m9pjsf7qhn25rkrfxwg1bmayb591a4-pi-web-0.9.3/lib/node_modules/@agegr/pi-web`.
- Catalogue reader/scanner, Activity helpers, atomic writer and the cited session
  history/SSE routes were compared byte-for-byte with that reference. Several UI
  and lifecycle files differ. Matching version strings do not establish source
  equality; installed UI observations below refer to that immutable copy.

A metadata-only inventory on Deep Thought on 2026-10-26 used Python 3
`os.scandir` and file `stat`, without reading contents, over
`/home/robert/.pi/agent/sessions/*/*.jsonl`:

| Inventory observation | Value |
| --- | ---: |
| Regular JSONL files | 5,283 |
| Nonempty / total session directories | 237 / 270 |
| Summed file size | 7,646,545,813 bytes (7.12 GiB) |
| Median / largest file | 464,564 / 172,045,652 bytes |
| Files at least 64 MiB | 7 |
| Disposable catalogue index size | 10,795,948 bytes |

These are changing filesystem counts, not validated/active Pi Web session counts,
distinct project counts, retained heap measurements or latency measurements.
Archived/subagent composition and browser-tab/live-wrapper counts were not read.
The existing scanner reuses unchanged metadata and validated append-tail scans;
ordinary refreshes must not be described as rereading the entire 7.12 GiB.

### Source-grounded hypotheses, not measured causes

1. **Catalogue startup and refresh amplification.** Installed
   `components/SessionSidebar.tsx:569–632,754–775` waits for the summary catalogue
   before initial session adoption, then schedules forced detail hydration after
   750 ms. That timer is not an additional awaited chat-opening gate.
   [Summary/detail routing](../../app/api/sessions/route.ts#L19-L38) reaches
   [enumeration/stat/scanning](../../lib/session-list-scanner.ts#L468-L518), then
   [synchronous relation prefix/tail reads and project attachment](../../lib/session-reader.ts#L141-L258).
   Relation work is outside the incremental transcript cache. Run completion,
   catalogue-version observation and selected-row hydration can also initiate
   overlapping catalogue requests. Project resolution has stale-while-revalidate
   caching; distinguish cold Git resolution from warm/background refreshes.
2. **Recurring client Activity work.** Accepted visible-tab polls
   [publish fresh snapshot identities](../../lib/activity-client-controller.ts#L135-L159)
   even without semantic changes. Installed `components/AppShell.tsx:184–186`
   constructs all Activity sections for its badge. The
   [section-ordering child search](../../lib/activity.ts#L109-L127) is quadratic
   in each populated section, not necessarily in the entire catalogue. Idle
   history still incurs catalogue-wide linear work. Poll scheduling is 2.5 seconds
   after settlement; one controller is shared within a page, not across clients.
3. **Selected-chat history and SDK startup.** The
   [history route](../../app/api/sessions/[id]/route.ts#L63-L89) builds the full
   tree and all-entry statistics despite returning a bounded message window.
   A [manager cache miss](../../lib/session-reader.ts#L468-L547) opens/parses the
   file synchronously; files above 64 MiB are not retained in that cache. A live
   wrapper can avoid that open. Installed `hooks/useAgentSession.ts:1067–1094`
   maintains the selected chat's SSE connection, whose
   [cold path starts the SDK wrapper](../../app/api/agent/[id]/events/route.ts#L16-L30).
   Installed `lib/rpc-manager.ts:3002–3297` constructs session-bound resources.
   This warm-up runs alongside history loading; do not add them as serial costs.
4. **Periodic synchronous persistence.** A dirty scan queues a five-second
   coalesced [full index serialization/write](../../lib/session-list-scanner.ts#L448-L465)
   through the [synchronously flushed atomic writer](../../lib/atomic-file.ts#L9-L21).
   Background scheduling does not make that work nonblocking. It is conditional
   on dirty scans, not a guaranteed write on every idle poll.

The investigation has not measured the impact of any of these paths. Asset
loading, hydration, network delay and service-worker/PWA effects remain possible
contributors to the same journey and must be visible in the first trace rather
than excluded by the shortlist.

## Plan Relationship

- [Core test optimization](2026-10-26_core-test-optimization-plan.md) owns fixture
  transformations, scheduling/native-wait opportunities and its existing evidence.
  Opportunity #4 now has a recorded bounded negative finding on main. This plan
  neither restarts that work nor assumes other tasks have stopped; coordinate
  with their owners before future capture, and never use their worktrees/checks.
- The older [server Activity plan](2026-09-25_server-activity-review-plan.md) covers
  shared completion/review semantics, not performance attribution. Do not reopen
  it or reuse its historical command menu. Current
  [architecture](../architecture.md), [session](../session-internals.md),
  [feature](../feature-internals.md) and [testing](../testing.md) guides govern.
- This plan owns interactive production profiling only. It is not another test
  optimization slice, a change to Activity acknowledgement or a Git-cost census.

## Non-Goals

No optimization implementation, broad subsystem audit, new telemetry platform,
provider benchmarking, generated load, repeated acceptance campaign, altered
native timers, cache deletion, forced GC, credential inspection or copying live
chats into fixtures/builders. Preserve security, trust, freshness, ancestry,
account/session isolation and durable-write guarantees. Do not declare a safety
check unnecessary merely because it appears in a hot stack.

## Plan

### 1. Authorize and bind the measurement environment

- [ ] Obtain explicit execution authorization specifying permitted ordinary user
  actions, diagnostic outputs and privacy boundaries; confirm a capture window
  without competing acceptance/build/profile work. Record any unavoidable normal
  load separately, rather than stopping someone else's work or calling it idle.
- [ ] Re-identify the installed package/source, actual runtime, browser/device,
  access path, cache/service-worker state and selected landing view. Record the
  relevant source differences from the profiling checkout. Do not silently
  substitute current main or a development build for the installed application.
- [ ] With the user's selection, name a short chat and a long/tool-heavy chat by
  local opaque aliases; collect only approved sizes/counts, not message contents.
  Record visible-client/live-wrapper counts if the authorization permits them.
  Ordinary chat viewing can initialize SDK resources and perform normal cache or
  legacy-file maintenance: it is not a guarantee of read-only runtime behavior.

**Gate:** no profiling until authorization, identity, safe capture format and
coordination are settled. A needed service restart, inspector activation,
configuration change or instrumented deployment is a separate stop-and-ask point.

### 2. Capture the real user journey before adding instrumentation

- [ ] Capture a desktop normal reload with the existing browser cache and warm
  service, followed by a small repeat sample. Start with three comparable reloads;
  report individual values, median and range, not p95 or a statistical guarantee.
  Record navigation start, shell availability, catalogue/adoption, visible history,
  usable composer and SSE/agent readiness as distinct milestones. Identify which
  readiness milestones are actually awaited by the user's action.
- [ ] Capture a short visible, quiet interval (initial budget: 45 seconds) and one
  normal short/long-chat switch. Attribute main-thread tasks, parse/render work,
  request frequency and recurring pauses even if no catalogue version changes.
- [ ] If an already-authorized agent is naturally running, capture one user-selected
  sluggish action during that activity and compare with the quiet observation.
  Reuse the reload/switch action if it matches the symptom; do not add a broad
  scenario matrix or start an agent to create load. If unavailable, explicitly
  leave responsiveness-during-agent-activity attribution open.
- [ ] If an already-authorized agent naturally completes during the window,
  capture that transition's catalogue requests and initiators. Do not send a new
  prompt, start tools or run acceptance merely to create a completion. Mark the
  scenario unavailable if none occurs in the bounded window.
- [ ] Capture one comparable real mobile/PWA journey if device access is approved;
  separate browser execution from network transfer and compare cache/SW state.
  Desktop viewport emulation is not evidence of real-device CPU/network behavior.

Define each endpoint before capture, using allowlisted event types/counts and
relative timestamps, never displayed text or transcript payloads:

| Milestone | Observation |
| --- | --- |
| Navigation start | Browser navigation time origin; record reload versus in-app navigation |
| Shell available | First presented primary navigation/workspace controls; if observed manually, record its coarser timing precision rather than claiming frame accuracy |
| Catalogue/adoption | Summary response-body/JSON completion, then selected-session adoption commit, recorded separately |
| History visible | First presentation after the selected history commit, with cache source/counts only; no message text or DOM snapshot |
| Composer usable | Composer enabled and a user-approved local focus/input action handled/presented; no submission or modification of an existing draft |
| SSE/agent ready | Existing `connected` handshake observed by event type/timestamp only, separately from HTTP stream opening; this certifies the connection, not all future model/tool readiness |

If a boundary cannot be observed safely without instrumentation, leave it unknown
and use it to justify a specific stage-3 probe. Do not infer it from another timer.

For each capture, separate DNS/connection/network and TTFB/body transfer, bundle
parse/evaluation/hydration, response JSON parsing, React/DOM/layout work, and
background activity overlapping the foreground. Record request issue/body/commit
boundaries rather than timing only a fetch promise or treating a spinner as all
of application readiness. Preserve errors and outliers; no unchanged retry is
silently substituted for a slow/failing observation.

Browser/process cold start and empty caches are separate scenarios, not synonyms
for normal reload. Do not restart the service, clear the real browser profile or
remove the catalogue index to manufacture them. Request a separate bounded
scenario only if the baseline points to it.

**Gate:** produce a first critical-path waterfall, marking the largest waits and
unobservable boundaries, then choose probes that can explain them. Attribution
need not already be complete to justify a probe. If an unlisted path dominates,
follow that specific owner rather than instrumenting all four hypotheses
indiscriminately.

### 3. Attribute only the leading costs with bounded probes

- [ ] Reuse existing `Server-Timing` from [lib/perf.ts](../../lib/perf.ts#L21-L67)
  only if already enabled. Its environment switch is read at module load;
  enabling it is not permission to restart/change the installed service.
  Handler timings do not include complete streamed compression/body delivery or
  browser parsing/paint. Correlate those boundaries separately.
- [ ] If existing evidence cannot explain the leading delay, propose the smallest
  additional phase counters/spans or short CPU sample for the exact owner/process.
  Obtain authorization before implementing instrumentation, enabling an inspector
  or changing the measured deployment. A diagnostic production-mode artifact must
  match the installed application source, dependencies and relevant effective
  runtime configuration except for the probes; record that comparison without
  exposing credentials or copying live authentication/session files into builders.
  If relevant parity cannot be established, label its results separate-system
  evidence, not installed-service attribution or an instrumentation-overhead
  estimate. Any production build must remain inside an isolated Nix builder.
  No in-place `next build`, development-server timing substitute or Nix-store edit.

Select only probes justified by the waterfall:

| Owner | Minimal attribution and counts | Distinguishing result |
| --- | --- | --- |
| Catalogue | Separate enumeration/stat, cache hits/tail/full scans and bytes, relation prefix/tail parse, project-resolution Git count/wall, live-row projection, merge/JSON serialization; identify request reason and scan generation | Global metadata/relationship cost versus changed transcript bytes, cold Git, response handling or duplicate refreshes |
| Activity client | Poll acceptance/publication count, semantic changes, catalogue/section sizes, classification/order duration, React commits and layout; distinguish hidden view from hidden document | Repeated browser computation on unchanged observations versus actual server/network waiting; measure populated sections, not an assumed catalogue-squared cost |
| Selected chat | File open/parse/cache source, entries/tree/context/stats, response parsing/render; separate SSE readiness, native/resource setup and extension loading, with startup-lock reuse counts | Full-file/derived-history cost versus SDK startup versus browser work; warm wrapper versus cold wrapper without forced teardown |
| Index persistence | Serialization and flushed-write wall time, bytes/frequency, event-loop delay and coincident request/stream pauses | Scheduled persistence causing shared-process stalls versus merely being background work with little observed effect |

Use aggregate per-operation counters, not per-file/token logging or global monkey
patches. Distinguish elapsed wall time, sampled CPU, synchronous event-loop blocking,
async/thread-pool/disk/network wait and overlapping background work. A CPU profile
alone cannot charge blocked disk time. Never sum inclusive spans or concurrent
requests as if they were serial contributions to user latency.

- [ ] Bound each targeted capture to the affected action/short interval; compare
  against the baseline and estimate instrumentation overhead. At most a small
  targeted repeat should resolve an ambiguity; otherwise document the limitation
  and request a revised scope rather than starting an open-ended benchmark loop.

### 4. Rank measured culprits and stop before fixes

- [ ] Produce one findings table: symptom/milestone, source revision/call path,
  measured wall contribution, CPU/blocking evidence where available, trigger
  frequency, cache/client/session scale, confidence and remaining uncertainty.
  Report both one-off startup cost and recurring per-poll/per-completion/client
  amplification. Preserve unexplained time instead of assigning it by subtraction.
- [ ] For each leading owner, distinguish directly measured work, a plausible but
  unproven causal explanation, and a hypothesis not supported by the capture.
  Correlate an expensive owner with the actual foreground delay/recurring stall;
  operation counts, static complexity and one flamegraph alone do not prove the
  cause of every reported symptom. Any controlled causal experiment is proposed
  separately; do not disable correctness/safety in the live app to create an A/B.
- [ ] Map only the identified hot owners to existing retained test evidence/source.
  Keep fixture transformation/setup, deliberate timeout/failure proofs and repeated
  native production operations separate. Existing P2's 88.604→11.745-second file
  result is fixture preparation; P3's 348.897-second complete command is acceptance
  elapsed time. Neither measures interactive latency or production CPU share.
  Do not rerun tests or restart the full census to produce this mapping.
- [ ] Recommend at most a few bounded fixes, ranked by observed user impact and
  confidence, with preserved contracts and a smallest confirming measurement.
  Examples such as fingerprint-keyed relation reuse, linear child ordering or a
  badge-only projection remain options, not preselected implementations or promised
  speedups. Hand off a separately authorized implementation/verification slice.

**Stop condition:** finish once the leading observed delays are attributed well
enough to select the next bounded change, or the remaining uncertainty requires
new access/deployment/measurement authority. A slow owner not reached by the
measured journey is not a demonstrated user bottleneck. No fixes execute here.

## Risks and Rollback / Recovery

- **Privacy:** approve an allowlisted timing-only capture format before using real
  sessions. Exclude screenshots, DOM snapshots, response/request bodies, auth
  headers, cookies, live environment values, heap dumps and transcript/tool payloads.
  Also exclude URL/query credentials, session identifiers, page titles, private
  filesystem paths and arbitrary user-timing metadata; use route templates, opaque
  aliases and approved source-frame identifiers. Raw HAR/browser/CPU traces can
  contain sensitive metadata despite innocent timing intent. If the tool cannot
  exclude it, stop and choose a safe method or obtain explicit sensitive-artifact
  handling authorization **before collection**; saving raw output and redacting
  later does not bypass this gate. Keep approved diagnostics private/local and
  commit only content-free aggregates/source references after review.
- **Measurement effects:** recording, resource initialization and ordinary polling
  can perturb timing. Keep one capture owner, note normal activity and profiler
  overhead, and separate cold/warm and real-device differences. No task cancellation,
  load generation, deadline inflation or error suppression to obtain tidy results.
- **Operational changes:** this plan changes none. Any later instrumented artifact,
  service action, configuration or temporary profiler must have an exact owner,
  bounded lifetime and approved restoration path. Restore only owned changes;
  never overwrite another task, clear live caches/chats or delete existing evidence.
  Restoration/diagnostic cleanup is not permission for unrelated Git/resource cleanup.

## Completion Checklist

### Planning artifact

- [x] Record the clarified symptoms, metadata-only scale, source identities and four
  unmeasured production hypotheses in a separate planning worktree.
- [x] Review the proposed measurement sequence, privacy/operational gates and source
  links; confirm the saved diff contains only this document and no runtime work.
  Independent method/safety review supplied the endpoint, naturally-running-agent,
  diagnostic-parity and trace-metadata refinements above. Plan whitespace and local
  file/source-line target checks pass; these are source checks, not browser-link
  verification or application acceptance.

### Future profiling — not authorized or executed

- [ ] Explicit execution scope, privacy approval and a coordinated capture window
  are recorded; any additional instrumentation/deployment authority is separate.
- [ ] Ordinary opening and recurring-work captures identify user-visible milestones,
  request waterfalls and browser/server boundaries on the actual deployed source.
- [ ] The leading delays have bounded attribution evidence; uncertainty, unavailable
  scenarios and profiler overhead remain explicit rather than invented percentages.
- [ ] Production costs, test machinery, intentional timing proofs and historical test
  elapsed times are distinguished, with a concise ranked findings report.
- [ ] Next fixes are recommendations only; no unauthorized implementation, tests,
  service changes, publication or cleanup occur.

**Known gaps:** no interactive latency/CPU/event-loop measurements exist yet; live
wrapper/tab counts, catalogue composition, device/access details and the availability
of safe existing timing collection remain to be established at execution entry.
