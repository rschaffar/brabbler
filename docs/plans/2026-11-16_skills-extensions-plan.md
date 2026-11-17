# Scoped skills and extensions — shared-worktree coordinator plan

## Goal

Control which skills and external Pi extensions a session receives, and therefore
what they add to context, through one **Skills & extensions** view with groups,
native packages, individual resources and Global → Project → Session overrides.

**Status:** implementation resumed by explicit owner request under the execution reset
below. Reinspection confirmed the existing branch, HEAD and intentional dirty handoff.
Keep the existing shared worktree, scoped implementers and independent reviewers. The visual
direction, compact enabled-status row and incomplete intermediate checkpoints remain
accepted. Live migration, deployment, publication and cleanup are not authorized.
Foundations are implemented, but no end-to-end UI-to-runtime flow is connected.

## Current handoff

**Accepted decisions:** [configuration handoff](2026-11-16_pi-resource-configuration-handoff.md),
[ADR 0044](../adr/0044-scoped-agent-resources.md) and [catalog contract](../agent-resource-catalog.md)
own installed-path identity (superseding permanent IDs/placement review), flat single-parent groups, direct parent gates,
retained preferences, independent Pi/Brabbler availability, Nix-owned contents, global v1/location,
`agentDir` preferences, Enabled baseline, unambiguous package-Off and automatic first-use import.
Project overrides require registered checkout roots; disabled-skill inspection retains independent trust/path/profile/access checks.

| Unit / verified scope | Evidence and review state | Private evidence labels (current task root) |
| --- | --- | --- |
| W01 actual SDK 1.5.2 observations | Reviewed post-load whole-record suppression: ten faux requests, 0.715s; valid-image bytes retained, 0.866s. Not host lifecycle proof. | Original SDK reports retained |
| W02 external Plugins teardown | Static + 51/58; seven expected obsolete-UI failures; separate i18n 5/5. Reviewed, no material source findings; defect-red qualification open. | w02/, w02-review/, w02-i18n/ |
| W03 pure scoped resolver | Static + 19/19; independent review accepted. Binding/storage/runtime unwired. | w03/handoff.md |
| W04a/W04b aligned reader/catalog | Static + 36/36 (18 each), 41.808s; independent reviews closed findings. Producer format aligned locally; no Nix changes. | w04b-verification/, w04b-implementation-review/, reader-alignment-review/ |
| W05a isolated preferences store | Static + 26/26; independently reviewed; no live wiring. | w05a-verification/, w05a-review/ |
| W06a isolated import receipt transaction | Static + 38/38, 40.461s; reviewed; admitted choices + completion/provenance include empty imports. | w06a/, w06a-review/, w06a-qualification/ |
| W05b context/store/import receipt guards | Static + 83/83, 44.056s; final guard rereview **CLOSED both findings**. No endpoint/live writer connected. | w05b-guard-repair/, w05b-context-review/ |
| W06b actual native-import library | **UNCONNECTED**; both alias/hierarchy findings closed by conservative pre-commit refusal. New actual-SDK/resolver/no-receipt regressions: static + 48/48, 44.232s; independent correction review accepted. Prior 106/106 remains bounded evidence, not end-to-end proof. | w06b/, w06b-review/; resumed import-fix/, import-review/ |
| W06c old availability writers | Package enable/disable and skills PATCH return 410; static + 4/4, 44.407s. Original-handler defect witness retained; independent review accepted, no material findings. | w06c/report.md; resumed legacy-review/ |
| W09a reusable state controller | Static + 13/13, 42.518s; independently reviewed. Not a host idle detector. | w09a/report.md, w09a-review/report.md |
| Scoped HTTP / first-use connection | Actual GET/PATCH → canonical context/catalog/import/store connected; static + 8/8, 52.951s. Independent review accepted within supported pilot. Desired state only; live notification/application disconnected. | resumed scoped-api/, scoped-api-review/ |
| Saved selection → real startup/reopen | Actual host/SDK requests and explicit skill expansion honor saved choices; native-Off resources restored in memory. Initial static + 48/48; two loader review findings then closed with real regressions, static + 10/10, 45.178s. Required factories/native prompt handling retained; child evidence remains bounded. | resumed runtime-loader/, runtime-loader-review/, runtime-loader-fix/, runtime-loader-fix-review/ |

Latest verified inputs: W05b `4f4ffb0c6beb8547859d175b819ff56758830605e2cfa7301aaa03798d420aca`;
W06b `56c10c06db2c4b5f6e8c330ccd6da308cb7ea9a2fa88eadbea302b15b1c3d568`.
W06b private stale-evidence run: 43/45, two intended failures, 46.023s; not a green run.
Resumed correction input: `a74584486ad76a49773a5e1addd17d030098928f16960a1de5724323407269c3`;
new regressions first exposed three intended failures (45/48), then passed 48/48.
Resumed loader-fix input: `241755feb544d33e0ec41592688545ca934bbbdd7bb38cb3d08a7748929126f3`.
Resumed evidence labels refer to the new coordinator's private task root, not the prior evidence tree.

**Limits/blockers:** these are bounded unit/reader/catalog/store/controller results, not full-feature or full-acceptance evidence.
Actual-SDK ordinary-record suppression is accepted; retained sends/bus/providers and initialization remain possible.
This supersedes pre-import exclusion as a requirement; no SDK patch/monkeypatch or non-circumventable guard is approved.
W09b host admission/settlement, W10 live idle application and replacement UI remain pending.
W07/W08 now reach real startup/reopen, but full lifecycle coverage and child own-Session
choice copying remain open; cold-child ceiling checks are not a fresh-child model-request proof.
Project-local source admission currently refuses before import: the SDK trust-status reader
creates native lock files. Managed-global Project overrides work; read-only canonical
Project-local trust admission remains a concrete final-support blocker.
Ordinary persisted reopen is proved within the loader fixture. Native-enabled host replacement,
detailed recovery/lifecycle boundaries and composed acceptance remain unproven; no power-loss durability claim.

**Retention:** raw private reports retain original reds, fixture/EACCES/invocation/restoration failures and defect witnesses
(W03 six, W04a two, W05a four, W09a two, W06a one, W05b eighteen intended failures).
W04a's mislabeled mutant is not green; its reviewed identity-verified pristine result remains valid.
W06a's extra pristine run never started because of an unnecessary process scan; original green/red remain valid.
Later normal 83/106 regressions use **new inputs**, not relabeled old restoration evidence. No process-inventory gate or unchanged-check repetition is required.

**Progress checkpoint:** `08eada71` on existing `design/skills-extensions-mockup` preserves
the inherited dirty handoff plus reviewed import correction; source before that commit was
based on `cc3bbf20`. `20e45e03` checkpoints the reviewed scoped HTTP connection.
The reviewed runtime-loader connection is the next checkpoint, not full acceptance.
Preserve existing dirty UI/i18n/test-lane/plan changes, expected user handoff and new docs/modules.
The owner additionally authorized periodic progress commits; they are unfinished checkpoints,
not integration or acceptance. No live import, deployment, remote action or cleanup is authorized.
**Active next connection:** publish committed saves to actual live owners, reuse the idle-change
controller and host admission/replacement lane, then connect the hierarchy view. The first
UI → idle application → advertising milestone remains incomplete. Do not start more detached foundations
merely because they can proceed independently. The previous implementing/reviewing agents are
stopped; the resumed coordinator owns new assignments. Preserve the worktree and Git boundaries.

## Execution reset — one connected flow first

The owner requested tighter scope after excessive edge-case depth and verification
orchestration delayed integration. These rules change execution priority, not the
agreed feature behavior or final acceptance requirements.

1. **First integrated milestone:** change one supported managed package/resource choice
   in the new view, save it at a valid scope, apply it when the actual runtime is idle,
   and verify the resulting advertised resources. Include explicit skill invocation
   exclusion where the selected resource is a skill. Unit counts alone do not satisfy
   this milestone; it is an unfinished-feature checkpoint, not a release or merge gate.
2. **Order the next connections:** finish the bounded import corrections/review, connect
   first-use import and scoped APIs, connect actual runtime filtering/idle application,
   and connect the hierarchy view. Then finish remaining scopes/lifecycle cases, recovery,
   package actions and documentation before composed review and full acceptance.
3. **Every task must close a named connection or a concrete correctness/safety blocker.**
   Defer hypothetical cases and generalization. Unsupported arrangements get actionable
   errors rather than a discovery framework, alias registry or guessed migration.
4. **Freeze scope:** no SDK patch, other-setting integration, second catalog format,
   additional generalized framework or extra migration machinery without an explicit
   owner decision. Finish and reuse existing components rather than adding layers.
5. **Keep verification proportional:** run required focused checks and independent
   review, reuse unchanged evidence, and perform full acceptance on the finished
   candidate. Do not invent process scans, redundant private-copy/restoration runs or
   other gates solely for an agent's reporting convention. Real failures remain retained.
6. **Report connected behavior:** at handoffs, briefly state what works end to end,
   what is still disconnected, and the next connection/blocker. Keep detailed evidence
   private and linked by its existing labels; do not present accumulated unit passes
   as proof of feature completion. The coordinator stays at plan level and delegates
   bounded implementation and independent review with one repository writer.

No implementation resumes from this documentation update alone.

## Shared-worktree working agreement

This is **one unfinished feature**, divided into session-sized editing tasks—not a
series of independently shippable releases.

- All implementing sessions/subagents continue the **same feature branch and physical
  worktree**, including its recorded unfinished/uncommitted changes. No per-unit
  branches, isolated agent worktrees, cherry-pick queue or per-unit integration.
- One writer at a time. The coordinator joins the writer before updating the plan
  or admitting another writer. Independent read-only research/review may overlap.
- Intermediate gaps are allowed: the old view may disappear before its replacement;
  a new component may be unwired; imports/types/tests may temporarily fail because a
  later task supplies the dependency. No requirement to keep all Brabbler usable.
- Do not build temporary compatibility adapters, feature flags, dual UIs, fake APIs,
  no-op runtime switches or migration bridges solely to make each checkpoint green.
  Real compatibility/recovery requirements for existing durable data still apply.
- A handoff is not a release, necessarily a commit, or a claim of verification.
  Record **implemented/verified at this scope**, **implemented but unverified**, or
  **incomplete**, with exact known failures and the task that will close each gap.
- Still run the narrowest meaningful required checks. Record expected dependency
  failures honestly; preserve unexpected failures for diagnosis. Do not skip tests,
  suppress errors, change permissions or bypass configured Git checks to obtain green.
- If a configured commit check blocks an incomplete checkpoint, retain the changes
  uncommitted with a precise handoff. Do not force a commit, invent a passing receipt,
  reset/stash the work or recreate it in another worktree.
- Full acceptance, completed safety/correctness obligations and required independent
  review gate the **finished candidate and integration into main**, not every editing
  handoff. No intermediate checkpoint is deployed or used to migrate live settings.

Example sequence: remove external entries from Plugins → leave no replacement for
one checkpoint → introduce the hierarchy → connect preferences → connect runtime
application → restore package-management actions → verify the composed feature.

## Agreed final behavior

These are final-result requirements, not a demand that every intermediate edit
already delivers them:

- External skills/extensions/packages live together, not in Plugins. Show
  group → package → resource relationships and allow ungrouped resources.
- Global resources support Global → Project → Session availability. Project-local
  resources start at Project; absent project/session scopes cannot be edited.
- Resolve each object's own scoped choice, then parent gates. A session can enable
  a globally disabled group; a child cannot bypass its effectively disabled parent.
  Parent disablement never rewrites child preferences; children remain inspectable
  and editable while gated off.
- Disabled skills are absent from advertising and explicit skill invocation, not
  merely hidden from automatic selection. Preserve authored invocation metadata.
- Extension Off means practical whole-record contribution suppression, not guaranteed
  non-execution. Initialization and retained SDK capabilities/effects may remain;
  remove ordinary advertised tools/commands/instructions/handlers. No SDK patch solely
  for zero-import or non-bypassable availability. Keep source/trust/profile hard ceilings.
- Save choices immediately; apply by idle replacement after admitted work and accepted
  queues settle. Refuse fresh input visibly before hooks while pending; no hidden
  retries or mid-run/per-model-turn switching. Already-consumed instructions remain.
  Resource construction may admit a fixed old snapshot before a child is scheduled;
  no scheduler-time recopy/reconstruction is required. See ADR 0044.
- Enabled status: **✓ Included in next-turn selection**, compact and without a
  subtitle/operation-permission warning. Disabled states explain useful reasons.
- Distinguish skill advertising/full instructions from extension tool descriptions
  and extra instructions. Do not claim exact token savings or complete introspection
  of arbitrary extension code.
- Availability does not grant operation permissions or sandbox code. Preserve built-in
  feature permissions; optional supported settings links do not imply a generic
  third-party settings framework.

## UX reference and scope

The reviewed HTML prototype and screenshot are intentionally not repository
artifacts. This plan is self-contained; implementation does not depend on those files.

Approved layout direction:

```text
Skills & extensions                    Project / Session context

Group / package / resource hierarchy    Selected item's name and kind
  Core                                 ✓ Included in next-turn selection
    CodeGraph [package]
      Tools [extension]                Global       Project       Session
      Guidance [skill]                 Enabled      Inherit       Inherit
  Research
  Ungrouped                            Effective choice and parent-gate reason
  Project-local                        Context contributions / members / source
  Unavailable · preferences retained
```

Use collapsible hierarchy navigation and search on desktop, with the selected item's
scopes/details alongside it. On mobile, use list/detail navigation with a Back action
and stacked scope controls. Distinguish saved choices from effective/applied state;
show the disabled parent's name without preventing edits to child preferences.

The prototype's scenario/reset/next-turn buttons are demo controls, not production
requirements or lifecycle proof. Temporary new UI may show honest “not connected yet”/
unavailable states; it must not pretend a resource was applied to a live session.

The accepted final home is **Built-in features** for Git Workflow, Session Launch and
Acceptance, without relaxing their existing scope/permissions. New group/package gates
affect only skills/extensions; prompt templates/themes keep existing native behavior.

Out of scope: a universal permission/sandbox system; replacing MCP/native-tool or
built-in tool selection, accounts/models/trust/AGENTS instructions; nested Pi packages;
implicit dependency auto-enablement; live activation, publication or cleanup.

## Plan Relationship and architecture

The companion configuration effort owns Home Manager package construction, installation
and Pi declarations. This plan owns Brabbler's catalog, selection, lifecycle and UI.
Agree interchange and live cutover ordering; do not guess the other effort's schema.
The companion effort is planning, not implementing or activating configuration; its
owner decisions are recorded in the linked configuration handoff.
Plain Pi must still understand native packages without Brabbler's logical groups.
Duplicate standalone installations must not bypass package selection.

Read the relevant maintained owners before edits:
[feature contracts](../feature-internals.md), [session contracts](../session-internals.md),
[native tools](../native-session-tools.md), [test writing](../test-writing.md),
[testing](../testing.md), and [English messages](../i18n.md).

Existing implementation leads, not instructions to copy their entire designs:

| Area | Existing owners / limitations |
| --- | --- |
| Skills | `lib/skills-service.ts`, `app/api/skills/content/route.ts`: fresh validated membership and bounded contained Markdown reads, not a complete off/missing inventory |
| Packages | `app/api/plugins/route.ts`: sources, filters, metadata, install/update/remove. Current enable resets resource filters; not a lossless child-selection switch |
| UI | `SkillsConfig.tsx`, `PluginsConfig.tsx`, `SettingsPanel.tsx`, `SettingsUi.tsx`, `lib/settings-navigation.ts` |
| Runtime | `lib/rpc-manager.ts`: creation, binding, Send, reload and retirement; `lib/session-model-refresh.ts::registerModelRuntimeSession` wraps direct SDK ingress |
| Children | `lib/subagent-runtime.ts`, `lib/subagents.ts::SubagentResourceSnapshot`: construction/resume and saved ceilings; construction may precede queue/admission |
| Persistence | `lib/project-native-resources.ts`: revisions, bounded locked writes/replacement checks; `lib/plugins/settings.ts` and `session-context.ts`: own-session applicability. No existing owner supplies all required semantics unchanged |

Proposed implementation home: `lib/agent-resources/` and `/api/agent-resources`;
agree final names in W00. Keep management inventory, desired selection and actual
live applied selection distinct. Reading the management inventory must not execute
extension factories, install/fetch packages or create sessions. Off-resource
inspection needs independent source/trust/physical-path admission, not arbitrary
filesystem access. Reuse canonical project/session boundaries; do not repurpose
trust or native-default markers for this feature.

### Research already available

Two independent read-only investigations at base `9eac9fff` inspected Pi SDK **1.5.2**
and current owners. Reuse these source findings; they are not executed lifecycle proof:

- `skillsOverride` can filter initial and later extension-provided `resources_discover`
  skills; filtering only initial discovery is insufficient.
- `extensionsOverride` runs **after imports/factories**. Active-tool filtering alone
  leaves commands/events/deferred paths. Later actual-SDK proof confirms whole-record
  filtering removes ordinary session contributions, with retained SDK capabilities
  explicitly accepted as a limit of practical Off; it is not pre-execution exclusion.
- SDK reload is nontransactional; native-enabled wrappers already use idle replacement.
  Shutdown failures and arbitrary unowned extension effects need explicit treatment.
- Input hooks/skill expansion can happen before queueing. `agent_end`, `agent_settled`
  or `isStreaming === false` alone is not an admission fence. Preserve accepted input.
- Factory-free resource reload can still install missing packages; inventory needs
  an explicit no-install path. Preserve Pi package/source normalization, physical
  deduplication and skill-name collision diagnostics instead of creating copies.

## Decisions for W00

Questions are now authorized and welcome. Reuse the configuration handoff's accepted
owner decisions rather than asking them again. Unknowns block only dependent work.
The handoff approves neither a concrete interchange schema nor runtime feasibility.

| Decision | Recommendation / unresolved boundary |
| --- | --- |
| Groups and metadata | Accepted: flat groups, at most one controlling parent; CodeGraph ungrouped. Align solely to actual producer v1 at `<agentDir>/resource-catalog.json`, flat package-referencing resources; see catalog contract. No dual format or Nix changes. |
| Identity | Accepted: installed source/member paths and group keys; same installed path across store-target updates retains choices. No permanent-ID registry or guessed aliases. |
| Project/inspection scope | Accepted: Project overrides only at registered checkout roots, shared across linked worktrees; elsewhere Global/own Session where applicable. Disabled skill Markdown inspection allowed only under independent source/trust/path/profile/access admission and contained-reference bounds. |
| Missing/moved/replaced resources | Accepted: retain unused choices, same-path return restores them, moves are new objects, changed parent gates apply directly. Broken declared sources/conflicting copies error. No placement-review workflow. |
| Legacy/authored state | Accepted: separate state per `agentDir`, not provider account; one-time proven import, unambiguous whole-package Off becomes package gate Off including new members. Ambiguity errors. Exact evidence, authored metadata handling and writer cutover pending. |
| Defaults | Accepted: eligible objects inherit an Enabled baseline; parent gates, trust, authored invocation rules and profile ceilings remain independent. |
| Built-ins/package operations | Accepted: existing scoped Git Workflow/Session Launch/Acceptance controls under Built-in features; new gates affect only skills/extensions, preserving native prompt/theme handling. Nix owns managed contents/registration; runtime must not mutate them. Unmanaged source mutation timing pending. |
| Admission/dependencies | Accepted simplified idle application: save immediately, drain admitted work, refuse fresh input visibly while pending. New IDs copy current own Session choices once at creation, not permissions/effective inherited values. Child construction may admit a fixed pre-import snapshot; no scheduler-time recopy. Executable settlement/host-loader proof remains open. |

Record durable accepted decisions in an ADR. UI source removal can precede migration
implementation, but **activating a new durable writer/source of truth cannot** precede
its approved recovery protocol.

## Plan — editing units, not release gates

Unit IDs are handoff references, not a rigid execution order. Choose a ready unit in
the same worktree. In particular, W02 can go first and W11/W12 can precede full runtime
completion. Source contracts may be used before their implementation is wired.

| Unit | Bounded result | Real prerequisites |
| --- | --- | --- |
| W00 | Accepted data/ownership decisions | User/configuration coordination |
| W01 | SDK lifecycle feasibility proof | Independent of UI teardown |
| W02 | Remove external resources from old Plugins UI | Agreed removal scope; no replacement dependency |
| W03 | Pure selection types/resolver | W00 |
| W04 | Inert catalog/discovery adapter | W00, W03 |
| W05 | Scoped store/API | W00, W03; catalog wiring can follow W04 |
| W06 | Reconciliation and legacy migration | W04, W05, approved state semantics |
| W07 | Skill selection in real sessions | W01, W03, W05; migration must pass before live use |
| W08 | Extension selection on create/reopen | W01, W03, W05; migration must pass before live use |
| W09 | Serialized admission/settlement boundary | W01; coordinates existing runtime ingress |
| W10 | Next-turn application and recovery | W07, W08, W09 |
| W11 | New hierarchy/detail UI | W00, W03; can be unwired and use controlled test props |
| W12 | Scope editing/recovery UI wiring | W05, W11; W06/W10 outcomes wired as they arrive |
| W13 | Restore package operations and finish Settings wiring | W02, W04, W05, W06, W10, W12 for final completion |
| W14 | Composed review, full acceptance, integration handoff | All final obligations W00–W13 |

Each unit below states its **editing result** and its **verification obligation**.
A session may hand off an unfinished result or tests blocked by later units; label
those checks pending and continue with the named dependency. Do not check off a
verification obligation until its evidence actually passes. Module/test names are
proposed owners, not claims that future files already exist.

### W00 — Decide contracts

- [x] Agree global v1 groups/path identities/current placement, origin versus setting
  scope, conflict errors, supported Project boundary and producer ordering; captured
  in ADR 0044 and the synthetic catalog contract. Project metadata production deferred.
- [ ] Define lifecycle/admission, profile ceilings, legacy authority and recovery policy.

**Verify:** examples have unambiguous expected outcomes and plain Pi compatibility.
This is decisions/documentation only; do not make implementing agents decide user policy.

### W01 — Prove supported SDK lifecycle

- [ ] Use one synthetic SDK fixture with import/factory counters, tool, prompt guidelines,
  commands/events and owned async cleanup. Test pre-execution exclusion and supported
  reload/replacement, including held work and failed shutdown/loading.
- [ ] Return a supported strategy and explicit limits. Keep scratch data private;
  reuse the fixture later instead of rediscovering it per unit.

**Verify:** actual SDK requests/registrations demonstrate future context exclusion;
no fake registry or hidden-tool-only proof. If a loader patch or lifecycle restriction
is required, scope/approve that dependency before claiming runtime support. Arbitrary
unowned extension side effects are not a sandbox guarantee.

### W02 — Remove the old external Plugins UI first

- [x] Remove external Pi package/standalone-extension rows and their old availability
  controls from Plugins; retain built-in permission/settings behavior. Package actions
  inventoried privately for W13. Static and new mounted boundary cases passed;
  independent review found no material issues. Full acceptance remains W14.
- [x] Leave the honest external-UI gap without a temporary duplicate or replacement.
  Seven obsolete assertion failures remain explicitly assigned to W11–W14.

**Verify:** inspect the source/diff and run the narrow relevant checks; document old
UI tests now expected to fail and their replacement owners. This source-only teardown
must not uninstall resources, edit user settings, activate migration or change Git
permissions. Dead imports/routes can be removed as their later owners are settled;
no backend compatibility layer is required solely for the gap.

### W03 — Pure selection model and resolver

- [x] Add immutable identities/choices, scope provenance and effective parent gates.
- [x] Cover inheritance/explicit values, session override of global-off groups,
  project-local scope limits, standalone items, conflicts/cycles and missing parents.
  Verified 19/19 actual-module tests, six intended parent-gate defect reds, restored
  19/19 and independent source/evidence review; see current handoff.

**Verify:** actual-module tests (suggested `selection.test.mjs`) prove child choices
never mutate and cannot bypass off parents. Storage, UI and SDK need not work yet.

### W04 — Inert discovery/catalog

- [ ] Adapt package declarations, validated skills, standalone extensions and group
  metadata into the management inventory, including off/missing/collision diagnostics.
- [ ] Preserve source/trust eligibility and deduplication. Report known contribution
  types honestly, not complete runtime introspection or invented token counts.

**Verify:** native catalog fixtures include read-only/Nix-like symlink sources,
excluded resources and sentinel factories; no import/factory, install/fetch or session
creation occurs. This inventory does not itself grant content-read authority.

### W05 — Scoped persistence and API

- [ ] Add dedicated versioned, revision-checked locked preferences and bounded APIs,
  with Global/Project/Session identity, reset-to-inherit and invalid-scope refusal.
- [ ] Expose desired revisions without pretending sessions applied them. No writes
  to skill frontmatter, read-only package trees or unrelated Pi declarations.

**Verify:** native store/route tests cover stale/concurrent writes, corrupt/unsupported
state, shared-worktree identity, foreign-session refusal and project-local no-Global
behavior. Runtime observation belongs to W10; do not build that merely to finish W05.

### W06 — Reconciliation and migration

- [ ] Implement accepted path-based disappearance/return/move behavior and direct new
  parent gates, retaining unused own choices; no identity guesses, aliases, placement
  review or automatic expiry. Same-path store-target updates retain choices.
- [ ] Define migration trigger, authoritative store per phase, legacy-writer fencing
  or fail-closed detection, commit point, interruption recovery and rollback/re-upgrade.
  Transfer only proven legacy choices; preserve authored metadata and unrelated state.

**Verify:** synthetic tests cover standalone ↔ grouped transitions, removed parents,
source revisions, duplicates, repeated migration, interruptions, concurrent legacy
writes and rollback/re-upgrade. New and old controls cannot become competing persistent
sources of truth. W02's removal of UI does not relax this final/live-state gate.

### W07 — Skill selection in real sessions

- [ ] Filter advertising and explicit commands, including later `resources_discover`
  skills. Preserve authored invocation rules and existing hard source/trust gates.
- [ ] Cover creation/reopen/fork/BTW/child/move semantics and bounded management
  instruction inspection for off skills without widening exact profiles/file access.

**Verify:** captured actual model requests and actual skill command handling exclude
disabled skills. Previously-expanded/consumed input remains unchanged. UI may still
be absent or incomplete; no need for a temporary view or fake selection endpoint.

### W08 — Extension contribution selection on creation/reopen

- [ ] Filter whole optional extension records with existing public SDK composition;
  preserve required host factories, profile/trust ceilings and saved child restrictions.
  Initialization is allowed; this is not a sandbox/unload guarantee.
- [ ] Exclude ordinary tool descriptions, snippets/guidelines, commands, handlers and
  dynamic resources, retaining honest limits for initialization-held SDK capabilities.

**Verify:** actual host startup/reopen fixtures exclude ordinary disabled contributions
while enabled/required ones work. Do not assert zero imports/factories or complete
execution isolation. Live-wrapper switching remains W09/W10.

### W09 — Admission/settlement boundary

- [ ] Extend existing host admission/replacement ownership across HTTP, direct SDK
  and extension ingress before hooks/skill expansion; visibly refuse fresh input
  while desired selection waits for idle replacement. No parallel mutex/polling system.
- [ ] Preserve accepted queued text/images and active effects. Count fixed pre-import
  child resource construction, held preflight and queued children as ownership even
  when not streaming. Existing admitted children may start under their old snapshot;
  no scheduler-time factory deferral, recopy or mid-run model-turn switching.

**Verify:** held work/async input, steering/follow-up, child construction/scheduling
and Stop/Pause cannot bypass or deadlock ownership. Save does not wait for settlement;
application does. No streaming/event flag alone proves idle. W10 supplies actual
replacement; an unwired guard is not a working switch.

### W10 — Apply selection at the safe next-turn boundary

- [ ] Connect W07/W08 selection to W09, observing global/project/session revisions
  without a connected browser. Coordinate model/native replacement rather than race it.
- [ ] Track desired versus actually applied state, join retirement/replacement and
  handle failure/reopen/repeated changes without replaying started effects.

**Verify:** held old work settles unchanged; next eligible work uses the new coherent
selection. Model-request and handler evidence proves actual exclusion. Failed application
is an honest error/admission block, never a fake applied version or silent rollback.

### W11 — Build the new hierarchy/detail view early if useful

- [ ] Replace the old skills presentation with the approved group/package/resource
  layout using existing React Settings composition, styling and English message keys.
- [ ] Add search/expand, focus, scope display, compact effective status, contribution
  details and bounded instructions/settings links. The view can be visibly incomplete
  while APIs/runtime arrive; do not keep a second polished UI alive for the transition.

**Verify:** mount the actual component with controlled test props for presentation and
navigation. Fake test data stays in fixtures, not fabricated production status. Defer
real API/application evidence to W12/W14; note missing wiring rather than hiding it
behind a temporary feature flag or demanding the whole app pass now.

### W12 — Connect editing and recovery UI

- [ ] Connect scoped controls/reset, effective reasons and revisions to W05; off parents
  never disable editing of child preferences. Add W06's actionable broken-source and
  ambiguity diagnostics; no historical-placement review workflow.
- [ ] Connect W10's desired/applied/error state when ready. Preserve scope identity,
  draft/conflict handling and focus through rapid switching and obsolete responses.

**Verify:** mounted controls cover A/B/A, ignored aborts, stale save responses, unmount,
retry and keyboard behavior; native owners prove durable writes and runtime application.
Checks depending on W06/W10 remain explicitly pending until connected, not fake-green.

### W13 — Restore package operations and finish integration wiring

- [ ] Rehome install/update/remove/search/version actions inventoried in W02, preserve
  mixed-package prompt/theme handling without expanding availability semantics, and
  finish navigation/static demo/built-in settings links with no duplicate controls.
- [ ] Own catalog invalidation, source-generation checks and desired/applied refresh
  around update/remove, coordinated with W10. Defer source mutation or pin supported
  contents while affected work runs; preserve source ownership and selection choices.
- [ ] Retire remaining obsolete frontmatter-toggle paths/tests with exact replacement
  assertion dispositions. Finish W06's writer/reader cutover only after its protocol
  and companion configuration ordering pass on synthetic fixtures.

**Verify:** existing skill/package/native/mounted owners plus held-turn update/remove
and partial-failure tests. Next admission uses an approved coherent source/selection
snapshot or reports failure. No implicit Home Manager declaration removal, guessed
replacement identity or change to built-in operation permissions.

### W14 — Finish, review and verify the composed feature

- [ ] Close all recorded missing wiring, expected failures and deferred verification;
  settle independent review of context exclusion, identity, migration and cleanup.
- [ ] Update owning feature/session/architecture guides, accepted ADRs and configuration
  handoff. Run full acceptance on the settled candidate and obtain exact-state local
  integration approval. No partial work is merged/deployed because a unit ended.

**Verify:** full core/static/plugin, browser/terminal inventory and genuine Home Manager
VM acceptance under [Testing](../testing.md). Rebase/reassess changed inputs and use
the required non-FF local integration. Deployment/publication/cleanup are separate.

## Coordinator execution and handoff

A future request can authorize the whole agreed plan or a named subset. Within that
scope the coordinator advances without asking for each editing task; unresolved user
policy and native-operation approval remain gates. Prefer ready tasks that unblock
others, not numerical ceremony or repeated discovery.

1. Read this plan/instructions and inspect the **same worktree**, HEAD, recorded dirty
   diff and owned untracked files. HEAD alone does not describe an unfinished handoff.
   Stop on unexplained changes; never reset an inherited dirty checkpoint for convenience.
2. Delegate one bounded unit to a fresh `general-purpose` implementing subagent with
   explicit checkout, allowed modules and expected result. Disable automatic isolation;
   no new branch/worktree, nested writers, integration, cleanup or remote operations.
3. Have it return a focused diff, known missing connections, attempted checks and
   exact results/evidence. An expected dependency failure is a checkpoint fact, not
   permission to delete/skip the test. Unexpected failures need targeted diagnosis.
4. Join the writer. Review proportionally: inspect ordinary intermediate diffs; obtain
   independent review for high-risk contracts/safety changes and the final composition.
   Do not require repeated whole-feature review or full acceptance per unit.
5. Record a small handoff: implemented scope; exact unfinished/failed checks; dependency
   that closes each gap; tracked/untracked owned changes; next ready task. Unverified
   obligations stay open even if another writer can productively continue.
6. Commit only when appropriate for a coherent change and live configured checks.
   There is no one-unit/one-commit rule. Preserve an uncommitted handoff when checks
   block; never bypass them. Keep all feature history/work in this one worktree.
7. Pause writers for immutable acceptance export. After the finished composition passes,
   follow the required rebase, exact-state approval and local non-FF integration.
   Do not activate configuration, publish or clean up as an implied next step.

### Implementing-subagent brief

```text
Work on Wxx in docs/plans/2026-11-16_skills-extensions-plan.md.
Checkout: <same explicit feature checkout>; HEAD: <OID>.
Inherited checkpoint: <owned dirty/untracked files, unfinished wiring, known failures>.
Allowed writes: <bounded modules/tests and required test classification>.
Read: unit, accepted contracts, relevant owning guides and previous handoff.
This is one unfinished feature: a partial/unbuildable checkpoint is allowed.
Do not add temporary compatibility glue or perfect unrelated areas to make it green.
Preserve user data, trust/permission boundaries and recorded inherited work.
You are the only writer; no isolation worktree, nested writer, remote, deploy or cleanup.
Return the actual diff, incomplete items, attempted checks/evidence and next dependency.
Do not label unverified work complete, bypass checks or claim full acceptance.
```

### Coordinator continuation prompt

```text
Coordinate the authorized scope of docs/plans/2026-11-16_skills-extensions-plan.md.
Reuse the existing shared feature worktree and inherited dirty checkpoint.
Delegate fresh implementing subagents one bounded editing unit at a time; one writer.
Intermediate missing UI, unwired code and expected integration-test failures are allowed.
Do not invent shims, duplicate UIs or per-unit release gates just to keep Brabbler green.
Resolve product/interchange/lifecycle decisions only before their dependent work.
Keep verification obligations open and record exact missing wiring/failures/next tasks.
Run meaningful focused checks and obey configured Git checks; never bypass them.
Finish and independently review the composition, then run full acceptance before
required exact-state local integration. No live activation, publication or cleanup.
```

## Verification strategy

Intermediate tasks run the narrowest meaningful required checks. If a missing later
module blocks execution, record that exact blocker and pending owner; do not run full
acceptance repeatedly against deliberately unfinished source or claim it passed.
Final correctness/security/recovery obligations are not waived by allowing incomplete
checkpoints. Existing native Git checks remain authoritative and cannot be bypassed.

```sh
# Example focused owner after its implementation exists:
nix run .#test -- core --file lib/agent-resources/selection.test.mjs
# Existing installed browser bridges when the feature is connected:
nix run .#test -- e2e --group markdown
nix run .#test -- e2e --group extension-dialogs
# Finished candidate only; admit resources/concurrent work first:
nix run .#test -- all --workers 4 --jobs 12
```

Each new test needs live F/N/E classification and meaningful actual-module/component/
SDK ownership. Keep narrow native and installed-browser bridges; record dispositions
when removing old assertions. Full acceptance follows the repository matrix, not the
prototype driver. The coordinator owns source export and resource admission: normally
12 core/4 browser workers, or a concretely justified lower budget. Record source identity,
commands, requested/effective widths, results/artifacts and timing. No checkout production
build, host-service test, development-server acceptance or increased-deadline fallback.

## Rollback / Recovery

Intermediate UI removal/source edits are recoverable through feature history/checkpoints;
they do not authorize installing that state or deleting anything from user configuration.
No automatic cleanup of inherited working files or unavailable preference records.

Production migration still needs original-state provenance, versioning, ambiguity refusal
and interruption/rollback/re-upgrade tests. Reverting source alone does not revert durable
settings. Recover failed runtime replacement without replaying tools. Application-state
recovery belongs here; installed-source rollback/activation belongs to the companion
configuration effort. Rehearse with synthetic data before separate live authorization.

## Evidence and Completion Checklist

Prototype evidence on 2026-11-16, base `9eac9fff` plus assets:

- HTML SHA-256: `519f0d6c3a461e1e06afa02927f7b2e4af86e67ce5bc7ff4d7f2c7546e241cc6`.
- **16 actual standalone browser checks passed**, no page errors. Desktop/mobile
  screenshots inspected; 320px project detail fit without horizontal page overflow.
- Desktop/mobile accessibility audits reported no violations, with one incomplete
  symbol-only contrast check each. Prototype review findings were fixed/rechecked.
- These are not application acceptance or executed extension-lifecycle evidence.
  Source-only research and an earlier independent plan review supplied the recorded
  lifecycle/migration concerns. Superseded plans/raw evidence remain privately retained.

This revision explicitly supersedes the previous requirement-like expectation of green,
fully wired, independently complete units. It retains the underlying final verification,
recovery and safety requirements, while moving integration polish to W13/W14.
Independent read-only review of this shared-checkpoint revision found no material
issues. Documentation link/dependency/whitespace checks passed; the HTML is unchanged.

- [x] Produce/test the prototype and obtain acceptance of its visual direction.
- [x] Record one shared worktree and explicitly allowed incomplete editing checkpoints.
- [ ] Resolve dependent W00 decisions and prove W01 lifecycle feasibility.
- [ ] Implement the authorized editing units; retain honest incomplete/unverified handoffs.
- [ ] Close every deferred obligation and verify the finished selection/migration/UI.
- [ ] Complete independent composed review, maintained documentation and full acceptance.
- [ ] Approve/verify final local integration; infer no deployment/publication/cleanup.
