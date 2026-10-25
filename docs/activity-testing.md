# Activity behavioral ownership

[Testing](./testing.md) owns the single Nix acceptance/resource/evidence contract;
[Feature contracts](./feature-internals.md) own product behavior. This is the
Activity assertion migration ledger, not a new runner or acceptance level.
The measured pilot below is historical. The complete-ownership plan records current
source-bound verification; source review alone is not a pass.

## Production boundaries

`lib/activity-client-controller.ts` coordinates one app-instance observation and
exact Read/Later queues. `hooks/useActivityController.ts` supplies root/consumer
leases, rendered-token actions and the actual Sidebar notification adapter.
`components/ActivityViews.tsx` is the same production composition in AppShell and
mounted tests. Catalogue/navigation, privacy/star persistence, selected-chat
SSE/questions, interrupted-journal demand, native SDK and Acceptance remain existing
owners. Release is replayable; terminal dispose closes admission and joins its own
complete promises, not independent native work. React unmount is not an I/O join.

`ActivityOverview`'s interrupted-journal work remains separate. Optional
`onRecoveryWork`, forwarded by actual `ActivityViews`, passively observes the same
original post-catch promise without a new awaited return, request, retry or timer.
Recovery remains15000ms; controller polling remains2500ms. Fixtures release known
peers, join original controller/recovery/body/descendant work, restore REALM before
close and HOST afterward. None of this cancels independent Acceptance work.

## Primary behavioral owners

| Owner | Contract and proof boundary |
| --- | --- |
| `lib/activity.test.mjs`, `lib/activity-review.test.mjs` | Existing real projections/precedence/nesting/project identity/exact receipt helpers; no browser/native execution claim. |
| `lib/activity-client-controller.test.mjs` | Real controller, controlled transport/body/time/events: ignored-abort A/B/A, current error/finally, exact tokens, failed/ambiguous confirmation-before-retry, B during A, shared leases and full callback/body joins. |
| `components/ActivityViews.behavior.test.mjs` | Real views/root/consumer/notification hooks under StrictMode; actual controls/current callbacks, target eligibility, privacy/restoration inputs, errors, stars and teardown admission. Not full Sidebar/AppShell/router/metrics mounting or CSS/native touch/networking. |
| `components/ActivityOverview.test.mjs` | Complementary SSR privacy withholding and rendered structure; static markup is not click/effect proof. |
| `lib/activity-review-server.test.mjs` and native review routes | Real locked durable ledger/API/migration/contention identities; controlled client replies do not replace these. |
| `lib/session-pause.test.mjs` | Real SDK/tool/queue/pause/race settlement. Entire real Activity ledger is compared around tool drain and waiting-card Pause, including an older unread completion: no new completion/Read/Later. |
| `lib/acceptance/process.test.mjs` | Actual admitted coordinator snapshot/ledger/native child remains alive across Activity-owner disposal, then its own gate/result/closure. Existing separate detached-child E hold is not resolved or promoted. |
| Existing Acceptance process/lock/coordinator and SDK/native tests | Keep real ownership, authorization, races and durable settlement; a browser/controller receipt is not new authority. |

Unexpected observer/subscriber defects remain console errors; expected operational
write/read failures retain current unavailable/reconciliation behavior. Test cleanup
uses a live error collector through gate release/joins: a transport assertion during
teardown must not disappear because production caught the rejected request.

## Installed browser owners

All remain in one Activity group/ordinary sandbox with the original three serial
legacy inputs and whole-input trace/context closure before success:

| Receipt | Coverage |
| --- | --- |
| `activity/native-state-recipe-owned-v4@legacy-desktop` | 1280×800 legacy preferences: complete native question→Later→reload→answer→Ready→Read; actual short completions/archive/new generation/independent peers/bulk receipts; complete subagent, row/global Pause and five-job Acceptance/default-tools/independence chains once. |
| `activity/compact-state-recipe-owned-v4@legacy-tablet` | 700×800: retained early restoration/Starred/worktree/interruption plus working/question/Ready/control geometry, full shared metrics, natural genuine default observation and actual Enter completion receipts/reload, real Acceptance Settings/status/bounds/Escape/focus. |
| `activity/compact-state-recipe-owned-v4@legacy-mobile` | 390×844 touch/legacy preferences: corresponding actual navigation/back/touch fragments, full metrics tap/Enter, real completion tap receipts/reload, real Acceptance Plugins switch/focus/layout and actual Sub-agents model-suffix Settings. Incoming persistent-New assertions stay in the early mobile segment. |

`activity-layout.mjs` preserves all original action-box predicates and worktree
metadata/bounds checks. `activity-family-usage.mjs` retains real four-ID native
stats/no-ack observations and physical disclosure, overflow, focus, Enter and touch
at all three inputs. `AgentSessionPanel.usage.behavior.test.mjs` owns literal family/
selected arithmetic, errors, currentness and filter/selection policy; the repeated
synthetic browser stats transactions and waits are removed. One desktop selected-
toolbar/URL/default bridge remains. Native stats bodies are joined before status
assertions and after independent click failure, preserving original cleanup errors.
Responsive read-only synthetic question/pause/running statuses prove geometry only;
none is submitted to mutation endpoints. Remove and join those routes, then
positively observe a natural genuine application GET/body, exact real completion
and rendered transition before real Later/Read. Unroute/headers/substitute API
reads/optimistic disappearance alone cannot supply that bridge.

## Original assertion disposition

Coordinates below pin the original `76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92`
`e2e/activity.mjs` (A), `subagent-lifecycle.mjs` (S), `session-pause.mjs` (P) and
`project-acceptance.mjs` (X), not changing current line numbers. The exhaustive
pre-edit assertion/wait inventory and independent reviews are retained with the
implementation plan's evidence root.

| Original obligation | Current primary owner and retained bridge |
| --- | --- |
| A9–40,92–118: initial adoption, late interruption, actionless row, same-chat dismissal | Existing restoration/journal owners plus actual browser early segment at every input; mounted inputs do not replace router/journal/default wiring. |
| A48–91 and calls111/137/157/174/175/197/235/299: badge/name/bounds, four action-box predicates, 24px/11px targets | Shared browser layout helper at original/retained responsive states. Dormant main-checkout negative is not claimed previously exercised. |
| A120–211: legacy/server stars, visible sidebar actions, idle/working dots, filter/reload/navigation/back/empty state | Existing star persistence + mounted real Starred events, with the entire early browser fragment retained at all three inputs. |
| A212–311: exact native question/Later/reload/answer/Ready/Read, labels/colors, pending-question no Read and peer observation | One complete desktop native golden bridge, exact real receipt-body barrier; controller/mounted own client token/queue/state variants; responsive geometry/input stays real Chromium, not another native question claim. |
| A315–369: short native completions, navigation-not-Read, archive/project precedence and independent no-local-marker peer | Existing ledger/projections plus controller/mounted action matrix; real desktop completion/archive/peer/default bridge retained. |
| A370–410: durable Later success with unusable reply, held confirmation poll/unavailable recovery, peer convergence | Controlled controller/mounted ambiguity cases plus unchanged genuine desktop store/API/lost-response/peer bridge. |
| A412–470: archived live/question precedence, actual ack, stable emptied filter, reload/new completion invalidation | Real projections/controller/mounted matrix plus complete desktop actual persistence/generation bridge. Responsive synthetic-status geometry is separate from subsequent genuine default polling and real completion input. |
| A471–488,583–617: real seed, exact bulk eligible targets, B during A, unchanged unrelated receipts and reload absence | Real controller/mounted bulk actions and existing native store; complete two-target genuine desktop bulk/default/reload bridge retained. |
| A490–582: family/header usage/selected toolbar, native tap/Enter/disclosures, reduced motion/count transitions, four-ID store/network no-ack | Actual AgentSessionPanel owns literal arithmetic/currentness/error/selection. All three browser inputs retain native four-ID/default/no-ack and physical disclosures; one desktop selected-toolbar/URL/count bridge remains. ActivityViews alone is not a wider metrics owner. |
| A618–627: OTHER-reviewed result and shared reset | Actual OTHER assertion desktop only; checked ack-all cleanup every input, never relabelled individual review proof. |
| S47–185: actual Agent/Git/UUID/history/missing-folder networking/refusal/settings suffix/slot/never-prompted Stop/persistence | Complete genuine desktop native chain unchanged, extracted actual Settings suffix UI additionally mobile. Generic actual mobile More/Stop remains unchanged running-forks/composer owners; combined queued-child scenario is not falsely claimed mobile. |
| P88–319: row and global native Pause, accepted tool-batch drain/card receipts/main-only continuation/concealed peer/no completion | Entire native two-cycle desktop chain unchanged; complementary real core ledger negatives. Responsive synthetic controls only prove geometry. |
| X20–end: actual configure/profiles/tools/five jobs/join/queue/reload/disable-not-abort/explicit cancellation/re-enable/history | Entire native desktop chain unchanged. Both responsive inputs retain real status/Plugins switch/PATCH/bounds/Escape/trigger-focus without repeating the jobs. |

The incoming persistent-New/session/sidecar work remains independent: preserve its
actual mobile Activity/Starred New behavior and desktop sidecar/browser/mounted
owners when composing this pilot, not by declaring them covered by the controller.

`openAcceptanceWithHeldStatus` in `e2e/project-acceptance.mjs` is the canonical
initial-loading gate: hold the original application GET, observe Reading before
release, require consumed (not cancelled) JSON, then join/unregister and restore
the observer. Incoming `lib/browser-suite-fixtures.test.mjs` exercises that actual
export with HTTP200/503, forbids Node fetch/fulfill copies and checks exactly one
continuation/body plus restoration. Primary and cleanup errors are both retained;
a sole failure remains the original error. Responsive status observation remains
a separate real passive read, not another native-job matrix.

The initial Acceptance browser-read correction does not diagnose the old socket
reset or solve arbitrary shared route-callback rejection ownership. Preserve failed
diagnostics and native settlement guards; no retries/deadline inflation/error
suppression follows from this mapping. See the execution plan for exact evidence
and remaining rollout status, not an inferred suite-wide migration.

## Measured pilot boundary

The post-rebase warm `all --workers 4 --jobs 4` command passed in **347s**:
**440 files/3425 tests/12 suites**, **26 groups/59 receipts**, genuine deployment,
effective four/four and32availableCPUs/about48.5GiB. Panel samples **4/5/5s**,
median**5s**. Original **351.05s full /20.5s focused** gates passed without a new
Activity cutoff. Full Activity capsule **125.140s** is not a full-suite speedup.

The executed candidate was `6d927289341b22bca383315e0b09ad605b0e7562` on main
`b2e66c9da6ee95ddf8994abb2a59af077c3e3ef1`, export
`/nix/store/1xbn7jy4ybi4rp7qfajqhcsrc6qzid7j-source`, digest
`c87860ac909a09651791ca6ac7fd942787c584172efdd4b8fab9a711a2aeac2c`.
Core **265.357s** and browser **320.729s** envelopes overlap; browser support/
manifest **2.613/4.960s** are mixed preparation intervals. Service **23.730s**
contains actual VM evidence execution **18.661s**. Never add overlapping intervals
or describe them as evaluator-only costs.

Before this single explicitly authorized warm measurement, exact-source focused
core/Activity/Move/mobile-sidebar/service commands passed in **40/195/41/24/61s**;
some preparation overlapped, so these are not summed. They realized the changed
application and actual guest/driver closure. The earlier **388s** full correctness
pass/performance miss is retained, not relabelled fixed by retry or subtraction.
Earlier348s/215.361s control and347s/125.140s pilot results have incoming-main and
workload differences; no isolated causal full-suite gain, CI/ARM/cold-cache or
escaped-descendant guarantee follows. Exact commands, inputs, failed witnesses
and preparation/measurement metadata are retained in
`/home/robert/.cache/pi-web-activity-pilot/run.civBQj`.

Separate Activity client/API follow-up: large mutation batches versus the existing
1000-entry API bound and retention/reconciliation edges remain a flagged risk,
not a redesigned policy or a fixed bug. This guide owns that follow-up; changing
batch/retry behavior requires a separate decision and real API/store proof.
