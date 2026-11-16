# Scoped skills and extensions — shared-worktree coordinator plan

## Goal

Control which skills and external Pi extensions a session receives, and therefore
what they add to context, through one **Skills & extensions** view with groups,
native packages, individual resources and Global → Project → Session overrides.

**Status:** the visual direction and compact enabled-status row are accepted.
The user explicitly accepts incomplete intermediate code/UI in **one shared feature
worktree**. This is a planning revision, not authorization to implement, migrate live
settings, deploy or publish. No production source or live service has changed.

## Current handoff

- **Completed:** interactive prototype, compact-status revision and prototype checks.
- **When implementation is authorized:** W02 can remove the old external Plugins
  UI first; it does not depend on finishing the new backend/view. W00 decisions and
  W01 lifecycle research can proceed independently, with only one repository writer.
- **Blockers for dependent work:** group/identity interchange agreement with the
  configuration effort; approved missing/moved/legacy-state semantics; supported
  extension lifecycle. These do not block unrelated source-only teardown/layout work.
- **Implementation:** W00–W14 are not started. Planning/research is not implementation.
- **Git:** keep the existing receiving feature branch/worktree. A planning commit
  does not authorize implementation or establish integration. Native Git policy and
  stronger repository rules own commits, rebases, exact-state approval and the final
  local non-FF merge.

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
- Apply selection before the next safely admitted turn without interrupting current
  work. Already-consumed instructions cannot be erased from conversation history.
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

The draft keeps Git Workflow, Session Launch and Acceptance under **Built-in features**;
confirm that boundary in W00 without relaxing their existing scope/permissions.

Out of scope: a universal permission/sandbox system; replacing MCP/native-tool or
built-in tool selection, accounts/models/trust/AGENTS instructions; nested Pi packages;
implicit dependency auto-enablement; live activation, publication or cleanup.

## Plan Relationship and architecture

The companion configuration effort owns Home Manager package construction, installation
and Pi declarations. This plan owns Brabbler's catalog, selection, lifecycle and UI.
Agree interchange and live cutover ordering; do not guess the other effort's schema.
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
- `extensionsOverride` runs **after imports/factories**. Active-tool filtering also
  leaves commands/events and some deferred paths. Neither proves Disabled.
- SDK reload is nontransactional; native-enabled wrappers already use idle replacement.
  Shutdown failures and arbitrary unowned extension effects need explicit treatment.
- Input hooks/skill expansion can happen before queueing. `agent_end`, `agent_settled`
  or `isStreaming === false` alone is not an admission fence. Preserve accepted input.
- Factory-free resource reload can still install missing packages; inventory needs
  an explicit no-install path. Preserve Pi package/source normalization, physical
  deduplication and skill-name collision diagnostics instead of creating copies.

## Decisions for W00

The user previously paused questions. This revision sends none; the next authorized
conversation must resolve material decisions when questions resume. Unknowns block
only the work that depends on them, not all independent edits.

| Decision | Recommendation / unresolved boundary |
| --- | --- |
| Groups and metadata | Flat single-parent logical groups; inert versioned interchange separate from native Pi resources; confirm with configuration ownership |
| Identity | Stable explicit IDs where supplied, documented source-scoped fallback; never infer continuity from display name/content alone |
| Project/inspection scope | Canonical shared-worktree identity; explicitly choose non-Git/subdirectory and excluded-resource inspection behavior |
| Missing/moved/replaced resources | Retain choices; same identity/placement restores them; changed placement requires review before activation; ambiguous replacement is not continuity |
| Legacy/authored state | Distinguish Pi filters, previous user choices and authored manual-only frontmatter; decide transfer rather than duplicate hidden off gates |
| Built-ins/package operations | Confirm built-in home, mixed-package actions and safe source update/remove timing |
| Admission/dependencies | Define fresh/reopen/fork/BTW/child/move semantics, actual admission event and required-resource constraints; child construction alone is not admission |

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

- [ ] Agree versioned groups/IDs/placement, origin versus setting scope, conflicts,
  supported projects and configuration ordering; capture synthetic examples in an ADR.
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

- [ ] Remove external Pi package/standalone-extension rows and their old availability
  controls from Plugins; retain built-in permission/settings behavior. Record package
  actions to rehome in W13 instead of maintaining a temporary duplicate view.
- [ ] Leave an honest gap in navigation if the new view is not ready. No requirement
  to add a placeholder replacement or keep obsolete UI tests passing in this unit.

**Verify:** inspect the source/diff and run the narrow relevant checks; document old
UI tests now expected to fail and their replacement owners. This source-only teardown
must not uninstall resources, edit user settings, activate migration or change Git
permissions. Dead imports/routes can be removed as their later owners are settled;
no backend compatibility layer is required solely for the gap.

### W03 — Pure selection model and resolver

- [ ] Add immutable identities/choices, scope provenance and effective parent gates.
- [ ] Cover inheritance/explicit values, session override of global-off groups,
  project-local scope limits, standalone items, conflicts/cycles and missing parents.

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

- [ ] Implement approved disappearance/return/move/replacement behavior while retaining
  own choices and placement review; no guessed identity or automatic expiry.
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

### W08 — Extension selection on creation/reopen

- [ ] Apply selection before optional extension import/factory execution; preserve
  required host factories, profile/trust ceilings and saved child restrictions.
- [ ] Exclude tool descriptions, snippets/guidelines, commands, handlers and dynamic
  resources through the real supported loader boundary proved in W01.

**Verify:** native startup/reopen sentinel fixtures prove excluded factories never
start and enabled ones work. This unit does not yet claim live-wrapper switching.

### W09 — Admission/settlement boundary

- [ ] Add a host-owned serialized barrier across HTTP, direct SDK and extension
  ingress before input hooks/skill expansion; reuse existing runtime coordination.
- [ ] Preserve accepted queued text/images and apply W00's definition of child admission,
  including construction → preference change → enqueue/start as a distinct case.

**Verify:** held work/async input, steering/follow-up, child scheduling and Stop/Pause
cannot bypass or deadlock the barrier. No streaming/event flag alone counts as proof.
W10 supplies actual replacement; an unwired barrier is not a working live switch.

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
  never disable editing of child preferences. Add W06's missing/moved review.
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
