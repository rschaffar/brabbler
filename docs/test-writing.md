# Writing tests

This guide owns test-authoring and migration decisions. [Testing](testing.md)
remains the single authority for Nix entry points, resource admission, application
packaging, full acceptance and retained execution evidence. Do not introduce a
parallel runner, mandatory service, framework or development-server fallback.
[Browser acceptance](../e2e/README.md) owns installed-browser fixtures and receipts.
[ADR 0034](adr/0034-behavioral-test-ownership-and-feedback.md) records the decision.

## Name the obligation before choosing a fixture

State the contract, inputs and identities, primary production owner, required
bridges, and what the test cannot prove. Choose the lowest sufficient owner:

| Obligation | Primary owner | Retained bridge / limit |
| --- | --- | --- |
| Policy, projection, parsing, identity comparison | Import the actual production module with node:test/Jiti | No React wiring, real filesystem or native-authority claim |
| Ordering, elapsed policy, durable reconciliation | Actual instance-owned controller; named capability/body gates and controlled policy clock | Real default composition, persistence and native closure where required |
| Hooks, current closures, effect dependencies, Strict Effects, DOM actions | Mount the actual component/hook with application React | Not native layout, capture, browser networking or full shell composition |
| Git, mount/path/ref/account identity, SDK, descriptors, child processes | Real isolated native fixture and actual operations | Preserve authorization/race/error distinctions and full native settlement |
| Layout, scrolling, capture, decoding, browser transport, user connection | Installed-package Chromium | DOM geometry/media doubles cannot replace this |
| User-service activation, restart, PTY/cgroup and deployment | Genuine Home Manager/systemd NixOS VM | Browser process backend is not deployment proof |

A mocked React hook, extracted component body or copied algorithm cannot establish
React subscriptions, dependencies, state transitions or cleanup. Prefer a small
existing production leaf/composition rather than mounting the entire application
for every matrix. Name the narrower scope honestly: Content is not its fetching
panel, an Activity slice is not Sidebar/AppShell/router/metrics, and FileViewer is
not the whole queued workspace/navigation/security chain.

Actual SSR output is a legitimate presentation owner, not source-text matching.
Keep useful SSR privacy, summaries and markup assertions when adding DOM behavior.
Architecture, import/capability absence, CSS declarations, package boundaries,
cryptographic vectors and immutable native data can legitimately need source/data
inspection. Keep these tests explicitly scoped; do not relabel a behavioral source
spelling check as architecture merely to avoid replacing it.

## Production composition and narrow doubles

Use the existing [core and mounted recipes](testing.md#three-small-core-patterns).
`lib/testing/react.fixture.mjs` mounts real React/StrictMode by default, owns a
private jsdom realm and exposes awaited dispatch/rerender/unmount boundaries.
Keep cases serial inside a process-global DOM fixture. Do not introduce a second
React, global DOM swapping during another mount, or fake child decision logic.
A local typed re-export fixture can bind real contexts/stores/components in one
physical graph; see [default composition](testing.md#one-default-native-composition).

Replace external capabilities only: controlled fetch/Response JSON, named request
and body gates, resize rectangles, unsupported pointer/media/popover APIs, supplied
catalogues and external callbacks. Declare unsupported capabilities precisely.
Numeric rectangles prove target selection and assignment, not physical scrolling.
Media pause/load doubles prove invoked order and src removal, not decoding or I/O
closure. An empty style alias proves import compatibility, not visual layout.
Never substitute synthetic response tokens for genuine native mutation authority.

Guard effects before importing the production graph, not only after mounting.
Where a fixture claims no transport, deny unsupported host and realm transports;
fetch interception alone does not intercept WebSocket, XHR or native media loads.
Validate exact origin, method, query-key multiset, path/session/cwd/account identity,
request headers and body as appropriate. Share a production encoder for wiring
only; keep independent path/encoding/security owners. Do not pin incidental Strict
replay request counts unless replay itself is the contract.

Use `.fixture.mjs`, `.fixture.ts` and `.fixture.tsx` for private support. Disable
Jiti filesystem caching. Keep support in real static/type/lint inputs but outside
shipped application dependencies/package exports; no application import of test
support or registered tests. Retain the pinned private jsdom/application-React
boundary and verify discovery/source/package inventories when changing support.

## Async ownership, failures and cleanup

A result, complete work settlement and durable publication are distinct. Register
cleanup before import/admission. On success **and failure**:

1. Close the operation's own admission; request only cancellation it owns.
2. Unmount the observer and release/reject every accepted gate, including peers
   when a release or assertion fails.
3. Independently attempt all real work/native joins, even if release/React fails.
4. Keep runtime-error and unexpected-admission collectors live through those joins.
5. Dispose the realm, restore globals and only then remove owned private roots.
   Preserve the primary and cleanup failures together.

Use [named async owners](testing.md#three-small-core-patterns), complete promises
including body/catch/finally/nested continuations, and actual native closure.
A fetch gate, body-return marker, act boundary or drained fixture reply is not a
production terminal promise or universal idle. Document inaccessible void work and
exceptional mount-failure ordering rather than claiming it is joined. If necessary,
a minimal legitimate production completion owner may observe existing work without
changing admission, ordering, errors, cancellation or retry policy; do not add a
fake test-only replica of the operation. Unmount need not cancel admitted writes.
Observer disposal must not cancel independently admitted Acceptance jobs
([ADR 0031](adr/0031-project-acceptance-coordination.md)).

Use a live collector, not a copied error-array snapshot. Retain unexpected route,
late-admission, runtime/event and body errors even when production catches the
rejection. Expected controlled HTTP/body failures remain distinct from fixture
or React defects. A late-consumption tracking failure must enter the collector.
Do not broadly suppress console/5xx errors, retry unchanged failures, add sleeps
as joins, inflate deadlines or call repeated microtask flushing settlement.

Preserve file/session/cwd/source/account/incarnation identities independently.
Exercise A/B/A reuse, obsolete success/error/catch/finally after ignored abort,
current callbacks, current loading/error, Strict Effects and teardown when relevant.
A redundant generation fence can make an isolated mutation green: disclose that
instead of pretending a specific internal guard has an independent runtime witness.

## Bounded assertions and meaningful counterexamples

Do not pass React-owned DOM/fiber trees to failing strict/deep equality diagnostics.
Preserve the exact predicate but compare primitives:

```js
assert.equal(container.querySelector('audio') === null, true, 'no player');
assert.equal(container.querySelector('textarea') === original, true, 'same editor');
assert.equal(newTrigger !== oldTrigger, true, 'destination resets feedback');
```

Compare exact node identity separately from primitive options/counts; do not replace
identity with equal markup. Keep failure hints bounded, never dump whole DOM/store
objects. An OOM/killed file or unsupported API/import crash is not the intended
behavioral counterexample.

Run a scoped actual-production defect and require the named runtime assertion to
fail, then restore original production and green. Keep the first failure/log/source
and distinguish diagnostic/setup corrections from unchanged retries. Examples are
omitted line forwarding, broken active-and-visible gating, an ignored stale body,
missing direct dormant visibility/instructions, or unnecessary streaming commits.
Do not count a source guard, compile/import error, fixture admission bug or unrelated
exception as the intended red. Fault variants never become application inputs.

For a real streaming store, distinguish publications, state/reply identities,
selected values and React commits. A thousand synchronous publications need not
mean a thousand commits. To count committed renders, use an actual commit observer
that runs for every render, not a value-dependent effect. Establish baselines after
Strict replay; use a separately awaited publication when independent commit timing
is material. Keep Unicode/final-reply and no-op publication obligations.

## Exact migration and intentional retains

Before deleting an old assertion/input, record:

- Original file, immutable revision, case/assertion coordinates and input tuple.
- Semantic obligation and actual replacement case, with green and meaningful red.
- Retained default/native/browser/service bridge and exact proof limits.
- Intentional retain or reason an assertion is obsolete; never omit it silently.

Review mixed files assertion by assertion. DOM equivalence does not replace a
memoization/import-performance guard, glyph/usage SSR output or narrow-screen CSS.
A direct component click is not toolbar/shell wiring, package invalidation, native
file policy, real Pause ledger or browser restoration. A dormant row in querySelector
is not accessible if hidden by an ancestor; programmatic dispatch bypasses that.
A loop over zero content requests does not prove a real instructions child ran.

Keep original browser IDs, tuples, order and whole-chain receipts unless separately
reviewed. Retire repeated browser work only after every unique assertion has a
named replacement and genuine default/native bridge. Preserve keyboard/touch,
responsive geometry, persistence, current identities and real transport/media.
Synthetic statuses prove geometry only, never authorize native operations.

The [Activity recipe](testing.md#activity-client-pilot-recipe) and
[Activity ledger](activity-testing.md) remain Activity-only. The
[completed batched rollout](plans/archived/2026-10-23_batched-behavioral-test-ownership-plan.md)
owns this subsequent finite adoption/disposition. A candidate census is not a claim
that every file has migrated. Additive mounts or focused greens do not themselves
retire old tests or constitute full candidate acceptance.

## Current cross-family recipes and limits

- `components/MarkdownBody.behavior.test.mjs` mounts actual local/blocked/reader
  links and scoped anchors; `MarkdownMedia.behavior.test.mjs` owns activation,
  visibility and effect/source lifetime, not browser decoding or native popovers.
- `lib/file-line-navigation.test.mjs` uses real isolated DOM trees; the actual
  FileViewer text/media mounts own request/body identities, watcher lifetimes,
  current links and Save races. Workspace mounts add stable hosts and independent
  active/presented admission. Native saves/security/scroll, grammar and incomplete
  supported-Diff/mode/queued-writer contracts keep their existing bridges.
- Archive/Tools/Agent Content/Skills mounted files and
  `hooks/useStreamingSelector.behavior.test.mjs` own their real controls/store
  transitions. Keep archive shell wiring, toolbar/narrow layout, usage SSR/default
  fetching, glyphs, Skills native policy and all genuine browser connections.
- `app/api/files/watch-route.test.mjs` executes the entire real route/SSE helper
  through the existing external-capability loader. Its controlled stat/watch/path/
  authority and heartbeat sentinels are not native filesystem/security proof.

The model/session mounted prototype was **not adopted**: unexpected asynchronous
React ownership diagnostics remain unresolved. Its exact failed source/reviews are
retained with the rollout evidence, and original production/test bytes restored.
Do not infer a product defect, suppress diagnostics or treat that proposed named
maintenance join as shipped machinery. This batch adds no production seam and
leaves all browser matrices unchanged. The plan records exact original-coordinate
retirements and deliberately retained behavioral gaps, not an all-family rewrite.

Follow-up owners remain explicit here: model/session work must first establish
honest actual-work/React boundaries and rerun guarded startup/selection/event
proof before retirement; preserve the failed prototype rather than treating its
assertions as accepted machinery. Files mode/supported-Diff/grammar, parked/queued
workspace and menu connections retain the existing mixed/browser owners until
exact runtime replacements exist. Four broad-import E holds need actual dependency/
effect/settlement review, not promotion from a focused green or a faster schedule.

## Guards, classification and acceptance

`nix/test-design.mjs` keeps explicit migrated timing and behavioral-owner sets,
separate from F/N/E scheduling. Its bounded AST guard rejects obvious literal
implementation JS/TS/CSS reads and recognized Function/eval/VM extraction in those
selected owners, including supported FS aliases. It is not general taint/dataflow,
security, helper-transitivity or coverage proof. Human helper/copy review remains
required; legitimate separately scoped source/SSR/native tests remain possible.

Every new test needs reviewed live isolation rationale or an explicit unresolved E
hold. Re-review changed effects/helpers; do not rewrite the immutable historical
lane audit into current scheduling authority. Real React alone does not require N;
static imports alone do not prove invoked native effects or safe closure. Unknown
stays fail-closed; E scheduling does not repair missing error ownership or joins.

Iterate with exact existing core-file/browser-group selections, then follow
[Testing](testing.md#nix-native-acceptance) for complete static/core/browser/service
acceptance. Bind commands, source/candidate, outcomes and retained artifacts.
Separate preparation, test execution, overlapping envelopes and total command wall
time. Measure rather than assume savings; fewer browser repetitions need not move
the whole-suite critical path. Do not infer causal, cold-cache, CI/ARM, statistical,
GC-stress or escaped-descendant guarantees from a bounded local pass.
