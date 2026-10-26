# Pi Web production latency — profiling plan

**Status: bounded host-local profiling checkpoint complete; dominant production
bottleneck identified. No optimization implemented.** The user authorized local
Chrome timing-only capture under normal desktop load, metadata-selected chats,
authenticated read requests, and then one separately approved 20-second CPU probe
using the worker's temporary loopback inspector. The inspector is closed and the
service identity/listener are unchanged. No chat prompt was sent by the profiling
driver; no test, build, deployment, service restart, persistent app/service
configuration or dependency change, or credential export was performed. Retain the
worktree. Integration, publication, cleanup and fixes are not authorized by this
report. Real-device/Firefox and successful SPA pointer
measurements remain outside this completed checkpoint.

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
- Original static-analysis reference reported by `pi_web_source`: Pi Web 0.9.3 at
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

### Execution entry — 2026-10-26

The user approved `http://127.0.0.1:30141`, automatic selection using file metadata,
timing-only diagnostics, and proceeding now under normal desktop load. Reading
transcripts is also permitted if useful. Only session headers were opened; the
cache's first-message strings were parsed locally for aggregate byte counts, with
no text retained. Cookie-based direct reads are permitted; the method keeps
authentication inside the dedicated browser rather than extracting cookies into
arguments/files.
The user logged in manually in that browser. No authentication settings changed.

The running reference is now
`/nix/store/slv4p16p1ac1ag70gvsw3j5a79gqjjkz-pi-web-0.9.3/lib/node_modules/@agegr/pi-web`.
All 15 scoped source files match this checkout byte-for-byte; the old package's
four UI/lifecycle differences no longer represent current deployment drift.
Declared SDK is 1.3.0, Next 16.4.2; the actual server executable is Node 24.21.0.
The owned capture browser is Chrome 155 on Linux x86_64, not Firefox or a real
mobile device. The host exposes 32 logical CPUs; normal desktop load is present.
No active acceptance/build runner was apparent in the process-name check, which
is not a proof of machine exclusivity. The active service and its listening worker
were identified without reading environment/authentication files or application logs.

Private timing-only artifacts and task-local collection helpers live in
`/tmp/pi-web-production-profile.Gbcf7r/`. No raw HAR, DevTools trace, screenshots,
DOM snapshots, credential exports or message-body artifacts are collected.
A browser preflight initially landed on a different blank/headless configuration;
consistent explicit launch flags corrected that before measurement. This was a
capture-setup issue, not an application-latency sample.

### Measured checkpoint and next decision

**Main finding:** catalogue reconstruction repeats synchronous fork/subagent
metadata reads and parsing *after* the incremental scanner returns cached rows.
In one approved 20-second server sample, `buildSessionList` occupied **17.62 of
20.25 seconds of weighted V8 stack samples (87.0%)**; its relation-resolution
subtree occupied **17.23 seconds (85.1%)**. These inclusive subtrees overlap.
They are sampled main-thread stack residency, **not exclusive CPU-clock time,
whole-application CPU percentages or percentages of acceptance execution**.
Whole-worker CPU was 21.71 seconds over the 20.26-second observation, including
other threads/clients. Source correspondence was independently checked against
public compiled bodies, not inferred from minified names or a version string.

| Normal root reload | HTML load | First observed enabled composer, upper bound | Catalogue responses in first 20 seconds |
| --- | ---: | ---: | ---: |
| 1 | 169.5 ms | 10,908.5 ms | 5 |
| 2 | 33.7 ms | 7,260.2 ms | 5 |
| 3 | 31.0 ms | 7,253.9 ms | 5 |

Each response carried about **9.65 MB decoded JSON**; the five responses totalled
about **48.25 MB decoded / 12.5 MB transferred per reload**. Requests overlapped:
never add their durations as user elapsed time. Their delay also appeared after
headers on loopback, so apparent body-transfer time is not proof of network or
compression cost; shared-server blocking can delay response progress.

Other bounded observations:

- Two sequential ordinary, non-forced catalogue GETs returned the same version
  and counts: **4,447.8 ms then 450.0 ms**; browser JSON parsing was **12.5 /12.2 ms**.
  Whole-worker CPU windows were **4.35 /0.34 seconds**. This is consistent with
  rebuild/cache-wait versus warm-response cost, not an observed cache-hit counter
  or an isolated per-request CPU measurement.
- In two distinct 15-second quiet windows, six activity polls each had medians
  **6.30 /6.45 ms**, no observed long tasks, and **0.10 /0.27 seconds** of worker CPU.
  A third 15-second window naturally included two completed catalogue responses,
  **15.32 seconds** of worker CPU, and a **247 ms** maximum browser timer delay.
  The cause of that catalogue invalidation was not recorded. Quiet polling alone
  was not the dominant desktop cost in this capture.
- Valid short/long opening cases used explicit deep links, not a successful SPA
  row-click comparison. The **358,511-byte** chat requested history at **14,434 ms**;
  that request took **74 ms**. The **27,576,703-byte** chat requested history at
  **9,561 ms**; that request took **476 ms**. Most observed opening delay preceded
  history fetching. Both pre-open state reads reported no live wrapper; separate
  SSE readiness/SDK phase durations were not measured.
- A catalogue snapshot contained **5,305 sessions**, including **1,986 subagents**,
  **1,482 forks** and **2,215 archived rows** across 237 cwds. These categories
  overlap; snapshots changed during observation. An index snapshot had 5,304 rows
  and 10,866,884 bytes. Serialized `firstMessage` values accounted for **6,051,896
  bytes (55.7%)**. This is data-size attribution, not timing attribution.

The high-confidence production call path is
[summary/full list construction](../../lib/session-reader.ts#L242-L258) → each
[relation resolution](../../lib/session-reader.ts#L191-L207) →
[prefix/tail reads and JSON parsing](../../lib/session-reader.ts#L27-L154).
The scanner's [unchanged-file shortcut](../../lib/session-list-scanner.ts#L483-L486)
does not cover this second pass. Both summary and detail paths were represented
in preserved profile ancestry. Hidden native leaves remain unidentified; do not
label every filesystem/buffer-descended sample as a particular native operation.

**Next proposed implementation slice, requiring new authorization:** first reuse
relation metadata under current file-identity/fingerprint validation, rather than
rereading unchanged parents/subagents on every construction. Preserve append,
rewrite/truncation, status, identity, archive and admission semantics. Then address
bootstrap refresh amplification: retain freshness/invalidation but coalesce the
early summary/ordinary/forced/deferred refresh races. Compact preview/list payloads
are a further candidate only after consumer review; simply truncating stored first
messages is not a justified substitute for removing the dominant repeated work.
Do not start a general cache framework or change polling/security for this result.

Evidence is retained under `/tmp/pi-web-production-profile.Gbcf7r/`:
`findings-summary.json`, `reload-{1,2,3}.json`, `quiet-{1,2,3}.json`,
`catalogue-read-{1,2}.json`, `session-{short,long}.json`,
`index-size-attribution.json`, `cpu-probe-aggregates.json`,
`cpu-derived-summary.json`, `cpu-source-correspondence.json`,
`cpu-probe-settlement.json` and `post-probe-health.json`. These contain approved
numeric/aggregate/public-source data, not raw profiles, bodies or credentials.
The source-agent mapping and aggregation are independently interpretable from
these records. Temporary inspector PID/start/listener checks and cleanup were
reviewed before activation; actual settlement confirms closed TCP9229, joined
collector, unchanged worker/main PID and TCP30141 listener. A subsequent
authenticated application read returned **200 in 7.8 ms**. The task-owned browser
was then closed successfully; no personal browser profile was borrowed.

Two unsuccessful capture attempts are retained, not hidden as passing retries:
`quiet-attempt-1.json` records an unsuccessful uninterrupted 45-second browser
observation whose original transport detail was discarded by the privacy filter;
the three later 15-second windows are separate observations. A row-click-path
attempt failed target-adoption validation with a full resource buffer and did not
retain its in-memory timing record before the assertion. `session-open-attempt-1.json`
records that limitation; subsequent explicit deep links do not prove that pointer
path works or establish an application navigation defect. No further pointer,
mobile, cold-service or absent-index campaign was started once the leading
production owner was established. No speedup is claimed.

### Original source hypotheses and measured disposition

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

The measured disposition is now: catalogue relation reconstruction and refresh
amplification are the leading production costs; quiet Activity polling was small
in the observed desktop windows; selected-history work was smaller than its
preceding catalogue gate. SDK readiness and individual index-write/flush stalls
were not independently timed. Asset load, real-device/PWA/network behavior and
other scenarios are not globally exonerated by this host-local sample.

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

- [x] Obtain explicit execution authorization specifying permitted ordinary user
  actions, diagnostic outputs and privacy boundaries; confirm a capture window
  without competing acceptance/build/profile work. Record any unavoidable normal
  load separately, rather than stopping someone else's work or calling it idle.
- [x] Re-identify the installed package/source, actual runtime, browser/device,
  access path, cache/service-worker state and selected landing view. Record the
  relevant source differences from the profiling checkout. Do not silently
  substitute current main or a development build for the installed application.
- [x] With the user's selection, name a short chat and a long/tool-heavy chat by
  local opaque aliases; collect only approved sizes/counts, not message contents.
  Record visible-client/live-wrapper counts if the authorization permits them.
  Ordinary chat viewing can initialize SDK resources and perform normal cache or
  legacy-file maintenance: it is not a guarantee of read-only runtime behavior.

**Gate:** no profiling until authorization, identity, safe capture format and
coordination are settled. A needed service restart, inspector activation,
configuration change or instrumented deployment is a separate stop-and-ask point.

### 2. Capture the real user journey before adding instrumentation

- [x] Capture three desktop normal reloads with the dedicated browser's cache and
  warm service. Report individual values and range; enabled-composer median is
  7,260.2 ms, not p95 or a statistical guarantee. Navigation/resources and first
  observed enabled composer were recorded. Exact adoption/history paint and SSE
  readiness remain unknown. No focus/input-response measurement was performed;
  do not claim the original table's stronger composer-usability milestone.
- [x] Capture bounded visible quiet observations and short/long chat openings.
  The achieved scope is three distinct 15-second quiet windows and two deep-link
  openings; the failed continuous/row-click attempts above are retained. Resource,
  long-task and timer observations are not full browser CPU or exact paint metrics.
- [ ] Deferred: a successful normal SPA row-click/switch measurement. Do not relabel
  deep-link navigation as this scenario; the identified server bottleneck does not
  require extending this checkpoint into a navigation-correctness investigation.
- [x] If an already-authorized agent is naturally running, capture one user-selected
  sluggish action during that activity and compare with the quiet observation.
  Reuse the reload/switch action if it matches the symptom; do not add a broad
  scenario matrix or start an agent to create load. If unavailable, explicitly
  leave responsiveness-during-agent-activity attribution open.
  Global running snapshots showed 3 and 4 managed runs around the later probes;
  exact per-action membership and an isolated busy/idle A/B were not collected.
  Independent source-review subagents were research, not generated timing load.
- [x] Not available as an attributed event: a natural completion-to-refresh capture.
  Background catalogue requests were observed, but their exact invalidating event
  was not recorded. No prompt/tool/acceptance run was started to manufacture one.
- [x] Not applicable to the approved host-local capture: real mobile/PWA device
  comparison. No real-device access was supplied; no emulation is claimed as one.

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

- [x] Check existing `Server-Timing` from [lib/perf.ts](../../lib/perf.ts#L21-L67):
  it was not enabled, so no reuse is claimed and no configuration was changed.
  Its environment switch is read at module load;
  enabling it is not permission to restart/change the installed service.
  Handler timings do not include complete streamed compression/body delivery or
  browser parsing/paint. Correlate those boundaries separately.
- [x] If existing evidence cannot explain the leading delay, propose the smallest
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

- [x] Bound the single authorized CPU capture to 20 seconds at 100 Hz and one
  ordinary reload. Compare ownership with the baseline observations, not as a
  controlled timing A/B. Instrumentation overhead was not independently isolated;
  no overhead estimate or timing improvement is claimed. No repeated probe was
  needed. Any further probe requires a bounded reason and renewed authority,
  not reuse of historical collector scripts as permission.

### 4. Rank measured culprits and stop before fixes

- [x] Produce one findings table: symptom/milestone, source revision/call path,
  measured wall contribution, CPU/blocking evidence where available, trigger
  frequency, cache/client/session scale, confidence and remaining uncertainty.
  Report both one-off startup cost and recurring per-poll/per-completion/client
  amplification. Preserve unexplained time instead of assigning it by subtraction.
- [x] For each leading owner, distinguish directly measured work, a plausible but
  unproven causal explanation, and a hypothesis not supported by the capture.
  Correlate an expensive owner with the actual foreground delay/recurring stall;
  operation counts, static complexity and one flamegraph alone do not prove the
  cause of every reported symptom. Any controlled causal experiment is proposed
  separately; do not disable correctness/safety in the live app to create an A/B.
- [x] Map only the identified hot owners to existing retained test evidence/source.
  The [existing bounded relation test](../../lib/session-reader.test.mjs#L576)
  exercises one private child, stubs scanner rows and prohibits full SDK manager
  opens. It protects bounded reading/status semantics, not this 5,305-row production
  scale or a latency budget. The production hot pass is compiled catalogue work,
  not P2's repeated fixture transformations. No fraction of historical acceptance
  elapsed time can be inferred from this interactive profile.
  Keep fixture transformation/setup, deliberate timeout/failure proofs and repeated
  native production operations separate. Existing P2's 88.604→11.745-second file
  result is fixture preparation; P3's 348.897-second complete command is acceptance
  elapsed time. Neither measures interactive latency or production CPU share.
  Do not rerun tests or restart the full census to produce this mapping.
- [x] Recommend at most a few bounded fixes, ranked by observed user impact and
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
- **Operational changes:** no restart, deployment or persistent service
  configuration change occurred; the single explicitly approved temporary
  inspector was closed and its service restoration verified. Any further
  instrumented artifact, service action, configuration or profiler needs an exact owner,
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

### Bounded profiling checkpoint — measured, not an optimization

- [x] Explicit execution scope, privacy approval and a coordinated capture window
  are recorded; any additional instrumentation/deployment authority is separate.
- [x] Ordinary opening and recurring-work captures identify user-visible milestones,
  request waterfalls and browser/server boundaries on the actual deployed source.
- [x] The leading delays have bounded attribution evidence; uncertainty, unavailable
  scenarios and profiler overhead remain explicit rather than invented percentages.
- [x] Production costs, test machinery, intentional timing proofs and historical test
  elapsed times are distinguished, with a concise ranked findings report.
- [x] Next fixes are recommendations only; no unauthorized implementation, tests,
  service changes, publication or cleanup occur.

**Known gaps:** one bounded, non-machine-exclusive host-local Chrome dataset, not
statistical, cold-service, real Firefox/mobile/PWA or successful SPA pointer proof.
Composer timestamps are observed enabled-state upper bounds, not exact first paint
or INP. Other clients' counts and exact request initiators were not tracked; weighted
V8 samples are not per-request CPU-clock accounting and redacted native operations
remain unidentified. SDK readiness, individual index flush latency and profiling
overhead were not independently isolated. Further capture needs a bounded reason;
no optimization, application acceptance or speedup is claimed.
