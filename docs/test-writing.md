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

Mounted production components/hooks execute real **client-side** code: event
handlers, state, effects and subscriptions. Most functional permutations belong
there, not in Chromium merely because the feature is client-side. Establishing
that ownership and retiring duplicate browser execution are separate tasks; adding
middle-layer tests while keeping the duplicate flows does not finish a migration.

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
2. On terminal or failed-setup teardown, release/reject all known peers before
   the first teardown join, then await observer unmount as required. If observer
   unmount is itself a behavioral input, preserve its deliberately held work until
   that premise is asserted; emergency release must not change cancellation policy.
3. Independently attempt all real work/native joins, even if release/React fails.
4. Keep runtime-error and unexpected-admission collectors live through those joins.
5. Restore realm-owned descriptors before destroying the realm; restore host
   globals afterward. Remove private roots only after certain native completion
   and restoration. Preserve the primary and cleanup failures together.

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

Owning a callback's original promise does not automatically own new rejecting
promises created by its external dispatcher. If that boundary needs an adapter,
keep the original work and same Error references in live owners; distinguish the
transport acknowledgement from the operation result, and rethrow failures after
independent settlement. Unregister the exact registered adapter. A no-op catch or
global unhandled-rejection suppression is not ownership. For an admitted response,
join its body before status assertions that could bypass the join, including on
non-200 paths. A failed body join remains an error, not proof of native completion.

Preserve file/session/cwd/source/account/incarnation identities independently.
Host-request, native-operation and saved-review UUIDs can be independently
allocated; compare each with its actual owner, not another field with the same
syntax. Keep the endpoint's host/review identity separate from a native receipt.
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
Reuse existing fault/restoration evidence when relevant inputs and the contract
are unchanged. Add a control for a named uncovered changed obligation, not to meet
a count or repeat an unchanged review. Shared support needs its actual receiving
users and failure schedules, not a generic marker claimed to certify all cleanup.
Confirm selectors, translations and fixture policy from source before costly runs.

For sequential multi-item operations, fixture-array or checkbox-click order is not
necessarily request order. Bind the actual family/admission order independently
before choosing the last peer to hold. A timeout caused by holding the first
request cannot prove the intended final-peer barrier; preserve it as a failed
control precondition, without forcing DOM changes or extending deadlines.

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

### Retire browser work step by step

For **each retained step/input**, answer:

> What concrete failure can this browser step catch that its verified lower owner
> plus a thin installed-app bridge cannot catch?

Chromium primarily owns actual rendering/layout/responsiveness/overflow/scroll,
fonts/media, native focus/selection/pointer/keyboard/IME/clipboard/uploads/downloads,
and representative installed interaction→server→visible-result/restoration wiring.
The last category needs thin real connections, not every policy/state/retry/model/
settings/currentness permutation. One browser-dependent step does **not** retain
its surrounding functional journey. Split out that ceremony; delete redundant
execution, setup, navigation, transactions and waits, not merely assertions.

Record original receipt/step/input → actual lower test and meaningful proof →
smallest remaining native/default/browser bridge → concrete incremental failure →
delete/split/retain decision. Reuse already verified owners instead of discovering
fixtures again. Unknown ownership is a finite gap to resolve, not a blanket
whole-journey retain. Deduplication needs evidence that the removed input's relevant
state/identity is represented; do not normalize distinct physical/touch/locale/
height/preference or authority inputs merely because widths or labels match.

Preserve unretired IDs, inputs and dependent ordering. After exact review, bodies,
journeys and groups may be thinned, split, replaced or removed: historical counts
are not quotas. Changed bodies need truthful fresh IDs, atomic dispatch/inventory/
definition/validator updates and pre-callback retirement negatives. Never run a
shorter body under its old complete-chain ID or reconstruct expectations from
successes. Source/package/nonce freshness is not execution or retirement authority.

Keep genuine physical/native/security/service proof real and full failure/cleanup
ownership intact. Synthetic statuses prove geometry only, never authorize native
operations. A representative bridge does not certify unreturned/escaped work or
replace materially different native input/authority obligations.

The [Activity recipe](testing.md#activity-client-pilot-recipe) and
[Activity ledger](activity-testing.md) remain Activity-only. The
[completed batched rollout](plans/archived/2026-10-23_batched-behavioral-test-ownership-plan.md)
owns this subsequent finite adoption/disposition. A candidate census is not a claim
that every file has migrated. Additive mounts or focused greens do not themselves
retire old tests or constitute full candidate acceptance.

## Current cross-family recipes and limits

- `components/SettingsUi.test.mjs` mounts the real bundled-settings editor and
  SettingsPanel/PluginsConfig composition, including unchanged immediate-save
  Session Launch behavior. Its observer owns complete inner `Settings.load/save`
  I/O promises, not the void field/preset apply wrappers; DOM/act and native
  dialog-hidden assertions separately cover visible editor settlement. The eight
  session/cwd load/save A–B–A schedules protect the receiving instance's already
  settled error/draft/result, not an independently held current in-flight busy
  state. Jsdom dialog/scroll shims do not prove native layout or modality. The
  existing Git bridge owns desktop/mobile geometry, saved/inherited border cues,
  native focus/inertness/Escape and durable save/reset/readback, before its
  retained Git approval/reader/receipt/Stop chain.
- `ScratchpadPanel.policy.test.mjs` mounts the real Panel/Controller/default transport for Global + Project controls, independent history, parked saves, metadata A/B/A currentness and complete request/body/operation ownership. Declared metadata replies are external inputs, not a fake Git resolver. `scratchpad-server` and route tests retain real registered-worktree/folder identity, allowed-root refusal and unchanged Global/legacy storage. Appearance's project-native desktop receipt retains native keyboard/modal and one durable bridge, then selected-folder/no-chat and real linked-worktree shell connections; the distinct short-touch receipt only reads its persisted predecessor for native geometry/focus/reachability. Neither mount claims physical layout/native Git nor browser repeats the conflict policy matrix.
- `components/MarkdownBody.behavior.test.mjs` mounts actual local/blocked/reader
  links and scoped anchors; `MarkdownMedia.behavior.test.mjs` owns activation,
  visibility and effect/source lifetime, not browser decoding or native popovers.
- `components/ChatWindow.process-details.test.mjs` owns all three original deferred
  Thinking reads, complete cached loader/effect-tail work, current observer, cache,
  chronology and no-duplication policy. History retains one installed Process →
  Thinking → actual body at each original LD/LM profile; controlled effects do not
  replace native rendering, Clipboard, selection or the wider default connection.
- `components/ChatWindow.default-mounted.test.mjs` owns actual hook/Source partial-
  input, current Copy/refusal/canonical/message-end and full literal Tool corpus.
  Original Clipboard promises differ from complete Copy handlers; the real catch
  fulfills its handler, even across observer unmount. History retains native flat
  Clipboard/raw-keyboard/scroll/fonts at both original profiles and one installed
  dynamic write/edit path/Copy/result bridge, not another synthetic streaming page.
  Retained font overrides independently preserve primary and restoration errors.
- `e2e/upstream-easy-wins.mjs` keeps native undo/redo, selection replacement,
  profile-specific newline, filter/keyboard geometry and the unchanged Fresh/P1
  bridge; original list/false-exec/synthetic-composition policy stays in the two
  real ChatInput tuples and pure planner. Release peers and join captured original
  callbacks before exact last-interceptor removal: Playwright can otherwise resume
  the pending request ahead of its original fulfill. ACK is not raw/body success;
  native/API disposal, removal, close and original error identities stay distinct.
- The two Navigation cases in `ChatWindow.default-mounted.test.mjs` own actual
  hook/input/store saved return and actual default obsolete-body/locate generation.
  The sparse fixture's optional `composerDraftKey` is explicit external input,
  never a copied caller-key algorithm. Keep the installed AppShell saved-key bridge.
  `e2e/history-branch.mjs` retains actual branch controls/SDK context plus exact
  native body/finished/raw/e32/ACK/removal ownership; the inert agent reply remains
  controlled, not native SDK-write authority. Node body/ACK settlement is not the
  browser hook's hidden promise or a universal idle signal.
- `PluginCard.preview-cleanup.test.mjs` drives the actual default card/attachment/
  stack/Pierre chain for both original reader data tuples: retained per-file model,
  real renderer destruction/recreation, version/query/position, collapse and lazy
  serialized-parent remount/409/current response. Deliver the application's two
  navigation frames and Pierre's admitted render frame; jsdom's scroll shim also
  needs the actual post-render DOM scroll notification, not a copied anchor.
  A held transport/loader-finally is not an already-admitted JSON body. Abort and
  action ACKs can settle before that loader; observe an actual future JSON error
  before its catch only if consumption really occurs. Both cold installed readers,
  opaque/native subjects, mobile/history and physical Download remain distinct.
  Mobile's controlled before-image is desktop's Allow1280 payload, not baseline
  text; keep its actual shared native HEAD/tree and both original inline drawer
  selection/close ceremonies. Shared Pierre is warm; content/state rows are not
  viewport geometry or a new mobile exceptional-work execution.
- The opt-in default-chat/navigation composition reuses ONE guarded Jiti graph,
  DOM, transport and complete existing default owners. Pass the actual navigation
  binding and numeric key; never copy a creation/key policy or replay a supplied
  created-session row as public caller proof. Import under the admission fence,
  release all domain peers before joins, and keep unknown failures fatal. Check
  actual callback adoption before success-dependent readiness; a stream that a
  broken callback cannot admit must not become an unbounded test waiter.
- Large-review pagination uses the real public Card/review/picker with the
  original 46-entry boundary and new-versus-modified content rows. Declare only
  required page/entry capabilities; join the actual selected-entry continuation.
  Retiring page switching does not retire native cold bodies, fullscreen,
  approvals or 45-file effects. Keep Allow reloads as native persisted-default-UI
  evidence rather than constructing another migration merely to remove them.
- Historical Decision and Operation outcome wrappers forward the existing passive
  `onReadWork` observer unchanged to their actual child. Absent adds no handlers,
  requests, timers or policy. Test the real wrapper, its lazy/serialized source,
  complete original reads and read-only controls, not a copied live parent. Observe
  JSON-body Error E independently: after public Abort A, the real queue's handled
  worker/finally can fulfill. Never fabricate a SAME-E queue rejection from its
  body error. Keep Outcome support proportionate when no Allow replay retires;
  immutable native identity/body/download and current-file/HEAD boundaries remain
  installed even when synthetic historical 409 policy moves lower.
- Ordinary Git Cancel is not Reject, Stop or settings abort. Compose the actual
  inline public Card→real hook response (existing Probe/`ownControl`, same original
  promise) with the actual RPC cancelled-response→null receiver while the signal
  stays live, and the native exact tuple/full-origin/no-effect owner. Declared
  plain-response IDs admit only cancelled:true with no batch signal; existing
  batch/ordinary guards remain. This is not a mounted default Window or native
  geometry claim. Retain each original installed Ask/default-wire bridge and
  Allow/Large history. Failed FETCH E can reach the hook catch; JSON E is instead
  caught by `sendAgentCommand` decoding, so never invent a hook-catch witness.
- Selected Git policy belongs to the existing native server owner: caller/session
  policy is not the selected checkout's policy. The existing RPC UI case separately
  drives an external signal through actual `pluginCard`, original settlement,
  aborted receipt, pending-map/attention removal and no replay. Mounted receipt
  tests drive both matching `extension_ui_closed` and aborted-plugin-receipt paths
  without manufacturing responses. Preserve the original confirm/Stop inputs and
  both installed selected-checkout approval subjects. This is composed owner/wire
  evidence, not a new end-to-end SDK cancellation or per-policy-row startup claim.
- `lib/file-line-navigation.test.mjs` uses real isolated DOM trees; the actual
  FileViewer text/media mounts own request/body identities, watcher lifetimes,
  current links and Save races. Workspace mounts add stable hosts and independent
  active/presented admission. Native saves/security/scroll, grammar and incomplete
  supported-Diff/mode/queued-writer contracts keep their existing bridges.
- The literal Workspace/Explorer/upload-route owners preserve entered external
  revisions, actual tab/draft/Save wiring, both original upload tuples and sentinel
  authority. Observe the actual request matcher before an unadmitted ticket can
  replace its diagnostic; join admitted loads before failed-test assertions and
  use scalar DOM predicates rather than dumping React/Window graphs. Navigation's
  existing synchronous `check` guard retains the SAME callback error in its local
  diagnostic lane; this is not asynchronous-rejection observation.
  `e2e/explorer-uploads.mjs` retains real changed-row and search callers, external
  writer, native file-row/mention/picker/mixed-entry and one overwrite/watch/draft/
  discard/mobile-reconnect bridge. Preserve all six M16 same-node/native Save
  watcher inputs; a lower upload policy owner does not replace them.
  For intentional private terminal controls, close the actual outer-owned page
  and context with collectors live before rethrowing: suite failure starts backend
  shutdown before later context cleanup. Native trace/context-close originals,
  the fixture-close promise, helper originals/ACKs and final artifact errors are
  separate evidence. A clean pre-close collector or fulfilled fixture ACK cannot
  replace them; never filter late transport errors to manufacture acceptance.
- Archive/Tools/Agent Content/Skills mounted files and
  `hooks/useStreamingSelector.behavior.test.mjs` own their real controls/store
  transitions. Keep archive shell wiring, toolbar/narrow layout, usage SSR/default
  fetching, glyphs, Skills native policy and all genuine browser connections.
- `app/api/files/watch-route.test.mjs` executes the entire real route/SSE helper
  through the existing external-capability loader. Its controlled stat/watch/path/
  authority and heartbeat sentinels are not native filesystem/security proof.

The completed batched rollout **did not adopt** its model/session prototype:
unexpected asynchronous React ownership diagnostics remained unresolved, failed
source/reviews were retained and original bytes restored. That historical outcome
is not the final complete-ownership result: later qualified replacements and
browser retirements were accepted and integrated. The
[maintained ownership ledger](test-ownership.md#delivered-ownership-and-proof-limits)
owns the final family/bridge boundaries and explicit performance deferral; the
[archived execution record](plans/archived/2026-10-23_complete-test-ownership-plan.md)
retains exact evidence. Do not suppress the old diagnostics, infer a product defect
or treat an earlier private pass as shipping evidence by itself.

Future model/session, Files mode/Diff/grammar, parked/queued workspace and menu
changes retain their sufficient mixed/native/browser owners unless an exact
replacement is qualified. Broad-
import holds require actual dependency/effect/settlement review, not promotion from
a focused green or faster schedule. Reconcile existing maps rather than treating
historical pending language as a request to repeat completed discovery.

### Guided-review ownership

`lib/notebook-review.test.mjs` exercises the actual strict reducer/question adapter
and full recovery schema, including inherited-property and leading `_`/`-` IDs.
`lib/notebook-review-store.test.mjs` and `app/api/review-data/route.test.mjs` own private
native fsync/exclusive-link/history/import authorization and failure cases. Their
two real writers both signal ready immediately before real installation at the
same expected tip; a bounded named cross-process release gate is deliberate race
orchestration, never a sleep claimed as settlement. Join both original processes,
retain unexpected failures and inspect prior bytes; a serial stale-tip conflict is
not a replacement witness. These tests do not prove arbitrary external-editor
exclusion or universal power-loss behavior.

`NotebookReviewPanel.behavior.test.mjs` mounts actual forms/tray/recovery and the
actual guided reader/FileEvidence snapshot binding, with controlled HTTP bodies and
production reducer at the external boundary. It covers both evidence/inspection
orders, independent pane records/radio groups, newer edits during Save, unavailable
step concerns, per-batch pasted drafts and history/reply ownership. Guarded native
ports and original `onWork` promises stay live through realm restoration; controlled
transport is not native storage authority. `ChatInput.review-handoff.test.mjs` adds
the actual composer/attachment/cursor bridge. `CommittedPatchDiff.test.mjs` uses
Pierre's real public selection setters/callbacks, held context originals and SAME
error identities, not a copied coordinate or rendered-component algorithm.

The Markdown installed chain keeps its original read-only assertions *before* the
new desktop/touch workflow tail. No old assertion/input is retired. The browser owns
real geometry/Selection/native reload/composer transport, while core owners keep
policy/race matrices. New files retain explicit E holds pending independent review;
focused greens and meaningful production controls are bound in the active plan,
not relabelled as full browser/service acceptance.

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
time. Report actual retired browser work (including reloads/setup/transactions/
waits), summed group work, browser critical path/elapsed time and complete feedback
separately. Faster core, improved packing, added middle coverage or unchanged/fewer
receipts alone do not prove browser retirement. Match shared non-reduction changes,
prerequisites and worker widths between references; a cold/preparing command is not
a warm benchmark. Fewer repetitions need not move the whole-suite critical path.
Do not infer causal, cold-cache, CI/ARM, statistical, GC-stress or escaped-descendant
guarantees from a bounded local pass.
