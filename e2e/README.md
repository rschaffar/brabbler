# Packaged-service browser and terminal acceptance

All acceptance uses the **actual Nix-built application and installed launcher**.
Complete browser/terminal scenarios run in ordinary Nix build sandboxes. A separate
small NixOS/KVM suite proves genuine Home Manager/systemd deployment. There is no
development-server, in-place, host-service or non-Nix fallback.

```sh
nix flake check --max-jobs 1 --cores 4 -L  # complete cacheable core/browser/service
nix run .#test -- all --workers 4 --jobs 4 # normal fresh complete acceptance, if admitted
nix run .#test -- e2e                      # full browser/terminal, admitted sandboxes
nix run .#test -- e2e --workers 2           # same coverage, two concurrent sandboxes
nix run .#test -- service                  # genuine deployment, fixed small VM
# Focused iteration, NOT full acceptance:
nix run .#test -- e2e --group markdown
nix run .#test -- e2e --group terminal
nix run .#test -- e2e --group git-plugin
```

Nix realizes pinned dependencies, package, Chromium and fonts automatically. No
`npm ci`, Playwright download or checkout-local modules are required. Browser tests
need ordinary Linux Nix sandboxing, not KVM or nspawn/experimental daemon features.
Only deployment needs native Linux/KVM. See [testing](../docs/testing.md) for snapshots,
offline operation, admission and cached/fresh evidence. Use four/four for complete
acceptance when resources permit; explain smaller budgets and report preparation
separately as specified there. Production builds occur only
in isolated Nix builders, never in checkout `.next`.

## Fresh definition publication and owned execution

After unchanged support realization and strict metadata/source checks, the driver
owns one selected definition-manifest build through `nix/fresh-browser.nix`.
Only constant references to fresh capsule definitions are published/rooted; their
outputs are not built before lane admission. The manifest binds source, system,
run UUID, digest, observed host namespaces, original support and exact selection.
It is bounded immutable dispatch data, never an execution verdict or saved authority.

The original weighted queues then build each exact `.drv^out` individually with
one job/two cores, without reevaluating the flake expression per group. Physical
output equality supplements—not replaces—the evidence-tree and strict capsule
verdict. Nonces, whole chains, budgets, isolated namespaces, installed launcher,
errors and service/pipe/group/port settlement remain mandatory. Preflight failure
admits no capsule; execution/persistence failures close admission and drain peers.
Support, manifest, client and validation timings are separate mixed phase envelopes,
not evaluator-only time. Per-run manifest/result out-links are retained evidence;
no manifest cache, destructive GC or broader cleanup is implied.

## Disjoint coverage inventory

`nix/e2e-groups.json` is the CLI/browser inventory: **25 browser groups and terminal**.
`e2e/scenarios.mjs` assigns reviewed scenario/input variants to exactly one owner.
The independent baseline inventory/order tests protect the extraction; runtime
`coverage.json` records completion only after each whole assertion chain returns.
Missing, duplicate, unowned, reordered or retried scenarios fail. Browser selection
must be exactly one known selector before allocating fixtures. There is no hidden
unselected `general` aggregate or account/API footer in unrelated focused groups.
These counts and the feature-family table describe an inventory, not a quota or
permission to retain every historical step. Reviewed retirement changes the current
source-derived inventory and fresh receipts; the historical baseline stays intact.

| Group | Coverage |
| --- | --- |
| `state` | Installed-launcher rejection of reserved revalidation headers, API pagination/errors, externally appended JSONL, account validation/redaction/defaults/concurrent writes, live AGENTS reload and dependent durable account selection/deletion |
| `history` | Version reload, session/mobile identity, observer pagination/node identity, recovery acknowledgement, rendering/thinking/compaction, flat/nested/write/edit argument views, full/raw clipboard access, escaped strings, keyboard/mobile geometry and synthetic partial-input completion/handoff, minimap and reading/branch cancellation chain; short/overflow bottom-on-send without artificial padding, committed streaming follow and scroll-up/down/button detach/reattach; immediate empty New with restrictive saved presets, literal unsent-text/session reload and navigation, provisional-draft recovery after reload before acknowledgement without creation replay, explicit desktop New/modal focus and mobile model filtering through simulated keyboard shrink/pan/late IME settling |
| `extension-dialogs` | Complete inline extension select/input/editor dialogs, keyboard/focus/expiry and retained receipts |
| `mobile-sidebar` | Compact action geometry/keyboard, archive/search scopes, reconciled inline restore and subsequent project move |
| `worktrees` | Management inventory, paging, trust boundaries, stale/lost preparation recovery and bounded cleanup receipts |
| `session-launch` | Real SDK tool, exact approvals/settings, independent faux-provider sessions and receipt navigation |
| `running-forks` | Newly submitted live-prompt forks without reload using a faux-provider turn, plus historical/root/quoted forks while the original SDK extension waits for input; real Ask-here caret/typing with retained draft suffixes, streaming action-row geometry and visible Stop with a simulated mobile keyboard |
| `model-speed` | Native writes, canonical packaged disk reader, persistence and ambiguous acknowledgement reconciliation |
| `native-tools` | Inert MCP catalogue, selected-session Code-mode/MCP apply, native stdio/QuickJS and read-only denial, parent nested-call progress/error-success/history, unrelated busy-session independence, stable-ID/draft preservation and lost-ack reconciliation; inert project-default save/reset, linked-worktree inheritance, explicit fresh-composer opt-out before connection and unchanged existing-session intent at desktop/mobile sizes |
| `trust` | Worktree/project grants, revocation and restriction |
| `git-plugin` | Bundled Git Workflow, approvals, immutable reviews, receipts, expiry/reconnect and cleanup |
| `appearance` | Default/full/reading widths, numeric legacy preference and fresh preference inputs; all thirteen palette swatches plus System, native-radio arrows, reload/dark classification/contrast and constrained Settings geometry; font families/base weights, independent resets, cross-tab sync and draft remeasurement; standalone Notes native modal with global/session persistence, undo/redo, reload/conflict recovery and desktop/short-touch geometry |
| `timestamps` | Both en-US and legacy Chinese locale/preference variants |
| `diff-context` | Loaded Workflow absence, Git Explorer immutable contexts/navigation/wrapping/Wide and integrated merge graph, in prerequisite order |
| `markdown` | Lazy source grammars, selection/source-coordinate preservation and deferred/streaming fences in additional service-worker-blocked chunk-interception contexts (existing scenarios retain their normal context); Markdown/KaTeX security, full-height Mermaid previews, math/themes/SVG, file-scroll/preview state, file/source links, explicit per-document Follow routing versus one-shot splits with consecutive/repeated same-file highlights and independent chapter destinations, lazy revision-bound review notebooks in chat/file previews with immutable source/diff context, explicit/reordered Explorer reveal and read-only navigation, explicit local media loading/playback/seeking/errors/session authorization and teardown, CSV/TSV virtualization, scoped fragments/headings, loaded-skill document navigation and concurrent provider/enabled-model/skill/content reads without repeated extension factories, model endpoint/adaptive save/inheritance/stale tests and native idle same-row reselection (save/resource reload remain non-rebinding), blocked preference storage, interactive read-only external-reference/watch/reopen sentinel proofs and real user-file polling |
| `file-edit` | Panel setup, all modified/added/deleted/context diff variants, editor/read-only/draft retention; Explorer root/nested/file/Changes-row drops, closed-folder refresh, keyboard/touch pickers, conflicts, filtered-search refresh and upload-driven clean/dirty viewer sync |
| `archive` | Focused archive/restore flow, distinct from the mobile search/restore/move chain |
| `privacy` | Concealment/loading/failure behavior, independent contexts and tablet coverage |
| `activity` | One complete desktop golden Question→Later→reload→answer→Ready→Read and real completion/archive/new-generation/peer/bulk persistence chain, plus complete native subagent, row/global Pause and Acceptance job chains once; three legacy inputs retain initial restoration, worktree/interruption/Starred navigation and complete Agents/usage/disclosure/reduced-motion proof. Mobile cross-project New leaves covering Activity/Starred views and saves an editable empty session before the responsive tail. Honest tablet/mobile responsive receipts retain working/question/Ready/control geometry, natural genuine polling before real Enter/tap completion receipts/reload, actual Acceptance status/Settings-switch/bounds/Escape/focus, and real mobile model-suffix Settings. Synthetic layout state never claims native execution or supplies mutation identities. |
| `accounts` | Separate created/deleted and shared-device OAuth variants, retaining locale and mobile-height differences |
| `questions` | Native tool ownership plus mixed question sets, draft/reload/cancel/receipts |
| `session-links` | Desktop/mobile copying and following the copied link |
| `bulk` | Bulk archive/conflict/retry/restore/delete |
| `move` | Full picker, plain/Git/worktree/Browse paths, superseded reads and proposal-only changes; independent stale-worktree filters, archive-inclusive recovery, missing-child subtrees and native-modal bulk Browse/Move |
| `ssh-agent` | Native Chromium virtual WebAuthn creation/fresh possession proof; process-wide No-agent/explicit selection; real SDK Bash/Shell/GUI PTY inherited socket and OpenSSH sign/verify; nonmodal Review/Approve without composer/terminal focus theft or overlay occlusion; denial/native prompt cancellation; nonce-then-payload locked approval and fixed non-renewing session grants; exact-cookie active/standby takeover, original-client drain, disconnect/reload without restoration; public metadata recovery with immutable existing policy or new strict import; Settings-close discovery cancellation, desktop/mobile sizes and wall-clock skew |
| `terminal` | Real shell/PTY, retained Nerd/System families with shared mono base/bold weights, live palette/font-size changes without PTY/SSE replacement, coarse-touch portrait modifier/arrow input, reconnect/restart/exit, creation cancellation and workspace/Explorer coexistence |

Keyboard simulations verify Chromium layout/focus and preserve the same filter node/value; they do not certify native iOS/Android keyboards, Safari or installed-PWA behavior. Physical keyboard/IME/device verification remains separately reported.

Preserve distinct viewport heights/locales/preferences, not just desktop/mobile
widths. History desktop acknowledges recovery before fresh mobile checks it;
Explorer precedes merge mutation; file panel precedes diff/edit draft checks.
Real polling, submission acknowledgement and expiry observations keep their original
deadlines. Duplication is judged by the exact obligation/input and sufficient owner,
not merely by membership in different integration chains. Preserve the necessary
connection or physical step, not all of its functional neighbors.

The Markdown media helper seeds synthetic PCM WAV and a tiny VP8 WebM from reviewed inline bytes (with provenance/hash), not downloaded fixtures or runtime ffmpeg. Desktop/mobile checks observe zero eager media/remote requests, native playback and seeking, session-scoped external-reference range reads/denials, corrupt-file feedback and explicit repair reload, narrow layout, covered-pane/session teardown and no automatic resumption. Direct authorization negatives use Node HTTP, preserving unfiltered browser console/5xx reporting. These are native Chromium proofs, not every browser/codec combination; the static demo and Markdown-file previews are outside this feature's scope.

## Contributor recipes and proof boundaries

Keep browser ownership thin: production-module/controller tests own decision
matrices, actual mounted React owns client-side handlers/state/effects/closures/
cleanup, and private native fixtures own Git/path/SDK resources. Building those
owners and **retiring duplicate browser execution** are separate obligations.
Chromium retains actual layout/responsive/overflow/scroll/fonts/media and native
focus/selection/pointer/keyboard/IME/clipboard/upload/download behavior, plus thin
representative installed interaction→server→visible-result/restoration bridges.
Callback or emulated-DOM tests cannot replace those native facts; their existence
does not justify repeating every functional permutation in the browser.

For every retained **step/input**, name the concrete failure that its verified lower
owner plus a thin installed bridge cannot catch. One browser-dependent step never
retains a whole functional journey. Split out that ceremony and remove redundant
setup, navigation, transactions and waits—not just assertions. An unresolved step
gets a finite gap, not a blanket whole-journey retain. Reuse verified ownership maps.
See [Writing tests](../docs/test-writing.md#retire-browser-work-step-by-step) and the
existing [core recipes](../docs/testing.md#contributor-ownership-and-recipes).

Map each exact old step/input to its actual lower test/proof, smallest remaining
native/default/browser bridge, unique retained failure and delete/split/retain
verdict. Preserve materially distinct physical/authority inputs and dependent
ordering. After review, thin/remove/replace journeys or groups without preserving
historical counts as targets. Changed bodies need truthful fresh IDs and atomic
inventory/dispatch/definition/validator updates; reject retired IDs before their
callbacks execute. No old complete-chain receipt for a shorter body, skipped inputs,
expectations harvested from successes or replayed native authority.

For example, exhaustive real palette-control and actual first-paint-script tests
can own selection/storage/restoration permutations. Keep compiled CSS/contrast,
needed swatch geometry, native keys/media and a representative installed reload;
do not automatically reload every palette again in every context. Measure actual
removed work and browser critical-path time separately from full-feedback time.
Faster core or advisory scheduling alone does not complete browser retirement.
The inventory above describes checked-in chains, not adoption of private cuts. The
[active ownership plan](../docs/plans/2026-10-23_complete-test-ownership-plan.md)
separates verified private reductions from source-only and conditional proposals.
Reuse exact unaffected bridge/control evidence; new controls need a named changed
boundary, not a quota. Final complete acceptance remains mandatory.

`browserFixtureRecipe(group)` and `prepareBrowserPrelude(group, options, stage)` in
`browser-fixture-recipes.mjs` describe the reviewed ordered prelude. Expected IDs
are independently declared, not harvested from seed return values. **Only
`timestamps`, `appearance`, `activity` and `markdown` omit running-fork transcripts
and worktree-manager repositories.** These omissions have source ownership review
and installed whole-chain evidence, not a name-based owner assumption. Every recipe
retains separate shared model-speed defaults and transcript fragments; those IDs
also serve session-launch. Other groups retain both shared fragments plus the
running-fork and manager recipes. Retaining input variants does not require each
variant to repeat a complete functional journey; review the steps by the rule above.
Activity keeps the complete native subagent/Pause/Acceptance chains once at desktop,
plus both named responsive inputs and their genuine layout/input/default bridges;
Markdown keeps both preview/line-link chains.
Base/other-project Git resources remain. Independent exact startup inventories have
16 appearance, 20 Activity and 27 Markdown IDs. Their direct contracts exercise the
real comparator; installed whole chains prove the runner's assembled expectations.
Removing unrelated rows/roots intentionally changes catalogue/history/root exposure,
not every observable behavior's equivalence. `assertStartupSessionCatalogue`
compares sorted arrays, preserving duplicate rejection; never filter actual responses
or derive expectations from writers. Other setup stays in `browser-suite.mjs`'s
original order. Do not infer owner-only seeding from a group name or drop shared
inputs opportunistically.
Removing redundant scenarios/groups is ordinary reviewed ownership retirement,
not blocked by the old inventory. Regrouping solely to exploit scheduling/concurrency
and immutable-seed experiments remain separate from this ownership rule.

### Activity ownership and responsive receipts

`activity/golden-native@legacy-desktop` retains the genuine question/answer,
completion/receipt/peer/reload and bulk-store bridges, then all original SDK
subagent/Pause/Acceptance assertions. `activity/responsive@legacy-tablet` and
`activity/responsive@legacy-mobile` retain the700×800 and390×844 legacy locale/
preference/touch inputs, not falsely passed old complete native-chain IDs. There
is no extra group or concurrency. Initial restoration and early Starred/interruption
checks remain at all three inputs. Mobile additionally keeps both incoming
cross-project New/persisted-empty-session/editable-composer assertions before its
responsive return. The same complete `activity-family-usage.mjs` fragment runs at every width: this pilot does **not** mount the wider AppShell
metrics/Agents composition, so its browser proof is not deleted.

Controller and mounted client matrices live in the [Activity core recipe](../docs/testing.md#activity-client-pilot-recipe).
Native Pause ledger negatives and the actual Acceptance-job/Activity-observer
independence bridge remain native-owned. Responsive geometry can augment read-only
status, but must never POST a synthetic question/pause identity. Geometry and the
child-only metrics augmentation have separate joined route lifetimes. After both
are removed, passively observe an actual natural application GET/body, verify the
real completion identity and rendered transition, then use genuine Enter/tap Later/
Read with exact native response/body barriers and reload. Unroute, a substitute API
read, headers or optimistic disappearance alone is not that default-composition
proof. Parent titles are matched exactly; unread children may display that title
in metadata after their reviewed parent leaves the section.

Both responsive inputs keep actual Acceptance status/profiles, global Settings
Plugins switch/PATCH, dialog bounds and native Escape/trigger focus without
repeating its five-job process matrix. Mobile also retains actual Sub-agents
Settings suffix availability/Save using the real desktop fixture's retained model
and project, never fake `/api/models`. Generic mobile More/Stop remains with the
unchanged real running-forks/composer input owners; the never-prompted queued-child
identity matrix remains native desktop, not falsely claimed at mobile.

The initial Acceptance loading/layout bridge gates its own browser request after
navigation and requires consumed real JSON. It no longer adds a Node `route.fetch`
proxy there; this does not establish the historical reset's cause or fix arbitrary
shared route-callback error ownership. Errors, original deadlines, native admission,
whole-input trace/context settlement and failed diagnostics remain mandatory.

For superseded reads, use `holdBrowserRead(page, { pathname, query }, { json })`
from `browser-read-barrier.mjs` (omit `json` to continue the genuine response):

1. Install the barrier before triggering the read, then await `arrived()`.
2. Commit/observe the newer selection before `releaseAndObserve()`.
3. Inspect returned read outcomes and assert the actual newer UI; always await
   `dispose()` in `finally`, including assertion failure. Teardown releases gates
   and joins registered routes before restoring the read observer.

A `consumed` outcome means the application consumed JSON; `cancelled` means its
fetch/body rejected with an actual signal-backed `AbortError`. Route fulfillment,
`response.finished()` or an abort request alone does not establish either. The
narrow route-error exception requires the exact request's `net::ERR_ABORTED`;
unrelated failures propagate. Rendering opportunities allow a continuation/commit,
not proof of arbitrary settlement. **A real browser abort does not prove that a
late response would be suppressed if cancellation were ignored.** The actual mounted
GitExplorer/Move tests now present in
`components/GitExplorer.stale-delivery.test.mjs` and
`components/SessionMoveDestinationPicker.stale-delivery.test.mjs` address that
separate obligation with ignored-abort JSON genuinely delivered and joined failure
cleanup, without production changes. These are not native network/layout proofs.
Full useAgentSession/FileViewer mounting remains
deferred; existing actual callback/loader tests and Chromium retain their
respective owners.

Acceptance's held initial status uses this barrier to continue Chromium's original
GET after observing its loading UI, then joins actual body consumption and restores
the observer before later navigation. Do not reintroduce a `route.fetch()`/fulfill
copy: that extra APIRequestContext hop can select an idle Node pooled socket while
the server closes it. No retry, fabricated status body or HTTP-error exemption is
needed to test the initial-read ordering.

For natural polling use `observeBrowserReads(page, specs, { natural: true })`,
await `wait()`, assert UI/scroll, and await `dispose()` in `finally` (see
`file-panel.mjs`). Observe the application's new reads and JSON consumption with
a visible document; do not dispatch synthetic focus/online/visibility/activity
events, issue substitute reads or advance application timers. Interruptions,
cancellation and read errors fail natural-poll evidence.

Partial-stream simulations in `tool-arguments.mjs` / `source-highlighting.mjs`
exercise intermediate rendering, not saved provider turns. Never invent durable
IDs or rewrite SDK-owned JSONL to make them look canonical. The real SDK/faux-provider
turn in `running-session-forks.mjs` independently verifies canonical prompt/final
IDs/content against persisted JSONL, one rendered row per ID and an actual document
reload with unchanged history/no duplicate or restarted turn. Preserve both owners.

Independent positive manager GETs and successful session-Pause/native-subagent
family cleanup DELETEs use `readBrowserJson` / `readBrowserResponse` from
`browser-http.mjs`: actual browser
fetch, no cache, unchanged URLs/methods/bodies and fully consumed text/JSON, so
requests and responses appear in retained traces. Manager GETs require status 200.
Both cleanup callers preserve their existing any-2xx success check and text-only
body read. Subagent cleanup still navigates away from its selected child before
removing the family; gate release, abort, idle wait, privacy restoration and
AggregateError retention remain unchanged. Deliberate HTTP-409 writes retain Node API transport without
browser-console error exemptions. Neither transport swallows failures or retries.
Callback unit tests prove body/error ownership, not Chromium networking, native SDK
shutdown, or the cause or resolution of either observed socket reset.

## One ordinary sandbox per whole browser group

Fresh full execution admits explicit **1..8 concurrent sandboxes**, estimating two CPUs and
4 GiB per group plus 2 GiB host headroom. Automatic selection stays capped at four;
widths above four are opt-in scaling experiments, not measured default guidance.
Explicit `--workers` refuses insufficient budget; focused selections default to one. Preparation has its own bounded estimate.
Cacheable group derivations use normal Nix scheduling: bound `--max-jobs` explicitly.
All selections retain the same package/inventory/deadlines; budgets are not reservations.

1. Realize immutable production package, test dependencies, complete tools, Chromium
   and fontconfig/fonts. Freeze a deterministic weighted queue plan. Packing weights
   live in `nix/browser-plan.mjs`, refreshed from candidate diagnostic `d44f40e5`;
   they include whole-group settlement/export cost, not deadlines, admission budgets
   or coverage authority. Each queue is serial, but **every group is a new build
   sandbox**, not a reused service user.
2. Before fixture allocation, require a non-root builder and loopback-only interfaces.
   Fresh runs additionally compare all network/PID/mount namespace identities with
   the outer invocation. Each sandbox can use 30141 without touching another sandbox
   or host service. Separate users alone would not provide this isolation.
3. Allocate private synthetic HOME/agent/projects/artifacts and launch the actual
   installed `bin/pi-web` with a sanitized production environment. This is explicitly
   the process backend, not a simulated systemd service. Bind the registered child
   generation/package; unexpected exit, spawn/log failure or incomplete stop fails.
4. Run every reviewed current browser/terminal chain, collecting each context trace,
   server log, event and console/HTTP error. Unretired inputs and dependent ordering
   remain intact; reviewed shorter/replacement bodies use their fresh current IDs,
   exact source-defined inventory and success-only receipts. Generated helpers
   resolve against the **installed package**, not a copied application or checkout
   dependencies.
5. Require exact package/source/nonce/group/coverage receipts, closed service port,
   settled child/pipes and absent original POSIX group. Inner observations do **not**
   certify escaped descendants: Nix owns outer builder containment.
6. Validate the finalized immutable evidence tree before reading it. A realized
   diagnostic capsule is not a pass; a separate verdict gate rejects failed assertions.
   Failure closes admission and drains started sandboxes, including report-write
   failures. Pending groups stay not run; no retries or deadline changes.

Async API readiness uses [the shared awaited poller](async-condition.mjs), not an
async `waitForFunction` predicate: the pinned poller treats the Promise itself as
truthy. One monotonic 30-second budget covers evaluations and delays; only resolved
falsy values poll again, and errors propagate. A timed-out read remains owned by
context shutdown, not a claim of cancellation. Trust decisions instead await one
non-prompt `get_state` startup/binding acknowledgement under the same bound.

Fixture clicks must follow settled layout, not merely a visible descendant. Privacy
and Acceptance Settings navigation wait for the open sidebar's width transitions,
unclipped content and horizontal scroll to settle. Acceptance configuration waits for the initial status
read to remove its loading row before one native summary click; a gated real response
with two saved profiles protects that ordering. These waits preserve the ordinary
30-second budget, assertions and no-retry policy.

No host HOME, credentials, user bus, installed service or live store mount is
forwarded. Synthetic providers and applications share only their sandbox loopback.
Live-file tests modify fixture projects/session data, not application source/HMR.

Budget production/dependency realization separately from fixture setup, scenarios,
trace/export and service settlement; focus is not permission to skip static core
checks or weaken complete inventory. Record candidate/source, selection, budgets,
static reuse, preparation, fresh execution, whole-command time and artifact paths
in the implementation plan. An isolated group, complete core-only run or diagnostic
including cold package realization is not matched complete-command speed evidence.
Keep historical comparisons bound to their original inputs.

## Small genuine deployment VM

`nix/vm-test.nix` retains one restricted-network, closure-only NixOS guest, real
pinned Home Manager and ordinary `t0`/UID1000. Its immutable registry fixes the
package/launcher/controller, HOME, environment file, unit and port. Initial execution
target: **1 vCPU, 1536 MiB RAM, 2 GiB sparse state disk**; not a measured minimum.
The guest contains no Chromium or full browser harness/dependency copy.

Mandatory ordered proofs:

1. Activate real Home Manager while the user manager is inactive, then start the
   manager and prove its generated `default.target.wants` link launches the package.
   The controller cannot explicitly start a replacement application unit.
2. Inspect actual ordinary-user launcher environment, file-over-unit precedence,
   runtime substitution, UMask/private physical paths and denied reads as `nobody`.
3. Persist a real HTTP session rename in the synthetic session file/workspace.
4. Explicitly restart the genuine user unit; require a new InvocationID and the
   same durable session/name through HTTP. The same fixture also pauses a native synthetic-provider question before restart, verifies durable paused state/no automatic continuation afterwards, and explicitly Resumes once with the saved question context.
5. Exercise real HTTP PTY creation/SSE output, proving TTY, UID, cwd, dimensions and
   synthetic environment. Leave its shell running for the final shutdown proof.
6. Settle clients, stop the exact service and require inactive state, MainPID zero,
   authenticated empty/absent cgroups and refused TCP port. Preserve diagnostics
   independently after failures; collection is not inferred from a stop command.

The read-only guest store image contains only declared package/support closures;
its writable overlay belongs to the guest. No host forwarding, host credentials,
user bus, developer `.next` or live host-store exposure is introduced.

## Diagnostics and settlement

Fresh browser execution prints `/tmp/pi-web-test-browser.*`: `run.json`, preparation
log and per-group driver logs/result links. Each immutable capsule contains
`result.json`, suite output, harness/coverage receipts, server log, events, Chromium
traces/screenshots and a failed-fixture archive on failure. Both cacheable and fresh
verdict gates reject failed diagnostic capsules; Nix owns their build-tree disposal.

Deployment prints `/tmp/pwv-*`: `run.json`, realization/driver logs, driver link,
plan/evidence, JUnit and `artifacts/guest/pi-web-evidence/` with `journal.log`,
`service.log`, `observations.json`, `fixtures.tar.gz`. The exact receipt binds their
guest-stage SHA-256 hashes computed **before** transfer. Root-owned staging rejects
symlinks/special/cross-device entries before the driver's host copy can follow them;
a host-only synthetic sentinel exercises the guard. Host collection independently
checks files/hashes. Private helper reports, including bounded failed HTTP bodies
and PTY transcripts, export separately under `artifacts/guest-helpers/`; an unsafe
helper vetoes complete collection without preventing safe journal export.

After complete retained evidence and confirmed driver/service settlement, only the
invocation's pinned runtime/tmp/cache bulk may be removed. Failed assertions alone
need not veto cleanup; interruption or unsafe/incomplete evidence does. No wildcard
or historical-root cleanup. See [retention](../docs/testing.md#diagnostics-and-retention).

Console/5xx suppression, forced clicks, retries and longer browser deadlines are
not acceptance fixes. Contract tests alone are not real Chromium, PTY or Home Manager
acceptance. A receipt grants no host operation, Git integration or deployment authority.
