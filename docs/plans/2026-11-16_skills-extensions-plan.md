# Scoped skills and extensions — implementation plan

## Goal

Control installed skills and external Pi extensions through one **Skills & extensions**
hierarchy with Global → Project → Session choices, independently admitted skill
inspection and explicit **Apply saved changes** for an existing conversation.

**Status:** implementation and focused review are complete within the supported installed-local
pilot. The installed browser Save → explicit Apply → actual SDK exclusion milestone is
verified. Composed review, complete acceptance and required local integration remain open.
This is not a deployment, live migration, publication or cleanup authorization.

## Current handoff

Use the existing `design/skills-extensions-mockup` branch and shared linked worktree.
Do not create implementation worktrees/branches, reset, stash or discard unfinished work.
One repository writer at a time; join it before plan edits or another writer. All preceding
writers and focused commands are joined; no known owned test client remains unsettled.

Progress checkpoints: `08eada71` foundations/import correction; `20e45e03` scoped HTTP;
`f0df20b8` actual startup/reopen filtering; `f6b91f64` hierarchy/explicit Apply/Project trust;
`bbc479b5` installed-browser bridge and the availability-only scope decision.
Finishing source/docs are the next checkpoint. These are not independently shippable releases.

### Execution resets and durable owners

The owner first required one connected flow rather than detached foundations. That flow
now works in the installed browser. The owner then explicitly simplified two requirements:

- [ADR 0045](../adr/0045-explicit-resource-application.md) **supersedes automatic idle
  application**: Save does not block input or change a live runtime. Apply reconstructs
  only the selected runtime now, or refuses immediately if busy/unsafe. No automatic
  waiting, queued application, retry or sibling restart. The unused idle controller,
  notifications and save-triggered input fences were removed.
- [ADR 0046](../adr/0046-agent-resource-availability-only.md) **supersedes package-action
  rehoming**: Pi/Nix owns package installation/search/update/removal and registration.
  Brabbler shows ownership guidance and retires its obsolete management endpoints.
  No source-mutation coordinator or additional remote-source discovery is required.

Other accepted contracts remain in [ADR 0044](../adr/0044-scoped-agent-resources.md),
[producer catalog](../agent-resource-catalog.md) and the
[configuration handoff](2026-11-16_pi-resource-configuration-handoff.md).
Current implementation behavior belongs to [feature contracts](../feature-internals.md),
[session contracts](../session-internals.md) and [architecture](../architecture.md).
Earlier detailed editing-unit plans and superseded timing requirements remain in Git
history; they are not additional current work. Private original/resumed reports retain
reds, interruptions, source identities and bounded review evidence.

### Accepted behavior

- Resolve each object's own Global → Project → Session choice, then current parent
  group/package gates. Enabled is the eligible baseline. Parent Off never rewrites
  descendants or blocks their editors. Project-origin objects have no Global choice.
- Project choices require registered checkout roots and share canonical repository
  binding across linked worktrees. Other admitted contexts retain applicable Global
  and own Session choices. Preferences belong to native `agentDir`, not accounts.
- Identity is lexical installed resource paths/kinds and group keys, not store targets,
  labels or permanent IDs. Moves are new objects; unused choices remain; same-path
  return reuses choices. No alias/placement registry or acknowledgement machinery.
- One approved producer v1 at `agentDir/resource-catalog.json`; no alternate format.
  Inventory is inert. Unsupported/ambiguous native arrangements refuse actionably
  rather than installing, guessing ownership or copying SDK discovery.
- First-use import transfers only proven same-path/scope native choices, atomically
  with completion/provenance into Brabbler preferences. Native settings/contents stay
  unchanged; canonical trust reads may use their approved ordinary SDK lock metadata.
  No historical Session import or ongoing native/Brabbler synchronization.
- Skills Off excludes advertising and explicit invocation. Extension Off suppresses
  whole ordinary optional contribution records; initialization and retained SDK
  sends/bus/provider effects may remain. This is not a sandbox/unload guarantee.
  No SDK patch or monkeypatch. Trust, profile, tools and file access remain hard limits.
- Saved choices do not imply application. Explicit Apply preserves same-ID conversation
  history/native intent, uses existing lifecycle ownership, refuses busy immediately
  and reports actual readiness/failure. Accepted queues/images/effects/children/cleanup
  are not cancelled to make Apply possible. Public deferred `nextTurn` is retained;
  unproven buffered input makes Apply refuse while normal input can drain it.
- New forks/BTW/children copy the source's current OWN Session choices once, including
  initialized-empty, not historical/effective defaults or permissions. First child
  factories see that copy. Reopen/Resume/dequeue/refresh never recopy. Retained incomplete
  child setup refuses cold startup; failed BTW copies are not successful attachments.
- Disabled/native-excluded skill inspection is separately admitted, bounded contained
  Markdown reading, including saved profile/tool defaults and descriptor identity.
  Catalog metadata is not content authority; no arbitrary file/root grant.
- Keep desktop hierarchy/details, mobile list/Back/focus, search/disclosure, named parent
  reasons and honest saved-versus-actual states. Only actual inclusion may promise the
  next turn. Built-in features retain Git Workflow/Session Launch/Acceptance permissions.
  Skill/extension gates do not alter native prompt/theme handling.

## Plan

- [x] Preserve the shared unfinished handoff and accepted visual/selection contracts.
- [x] Implement/review pure selection, aligned catalog, canonical context, guarded store,
  atomic import receipt and native derivation; close enabled-alias/omitted-selector
  import findings with conservative refusal and real no-receipt regressions.
- [x] Connect actual HTTP inventory/scoped save and one-time import; retire competing
  legacy availability writers before native mutator admission.
- [x] Connect actual host startup/reopen filtering and native-Off restoration in memory;
  preserve required factories, ordinary controls and profile ceilings. Close unbound
  optional-record and obsolete collision-diagnostic findings.
- [x] Replace the abandoned automatic idle candidate with explicit safe Apply; remove
  its unused controller, save fences, wait/retry/coalescing and cross-session switching.
- [x] Connect the hierarchy UI, scope editors and actual Save/Apply status; close mobile
  Back focus and stale-readiness findings within recorded source/mounted scopes.
- [x] Verify the installed-browser UI → real choice save → saved-but-unapplied request →
  explicit Apply → actual SDK tool/instruction/skill exclusion and literal Off invocation.
- [x] Connect canonical Project trust, allowing only approved standard read-lock metadata;
  verify explicit denial and staged revocation without native data mutation.
- [x] Copy current own Session choices atomically once on fork/BTW/child creation before
  first factories. Close lock-yield, failed-BTW rediscovery and incomplete-child cold
  reopen findings. Preserve profile ceilings, failed files and creation independence.
- [x] Connect independently admitted native-excluded/Off skill inspection and contained
  documents; close ordinary-default-profile and opened-descriptor identity findings.
- [x] Retire obsolete package/skill management endpoints with actionable 410 before native
  effects; preserve meaningful security/refusal/native-helper assertions. Show Pi/Nix
  guidance and Built-in features naming without changing permissions.
- [x] Update owning guides/catalog/handoff/source map and align the partial static demo.
  Demo notices do not simulate a second inventory/application/permission implementation.
- [ ] Complete independent composed Standards and Spec review of the settled feature.
- [ ] Run complete core/static/plugin, all browser/terminal groups and genuine Home
  Manager deployment VM acceptance under [Testing](../testing.md).
- [ ] Rebase/reassess against current local `main`, verify the exact candidate and obtain
  required exact-state approval for ordinary unsigned non-FF local integration.
- [ ] Verify native integration outcome; keep publication and cleanup separately gated.

## Evidence summary

Results below are focused, input-bound evidence, not a claim that one final candidate
has passed full acceptance. Original and resumed private task roots keep distinct labels.
No historical run has been relabelled as a later-input run.

| Connection / reviewed scope | Evidence labels and bounded result |
| --- | --- |
| Original foundations | W03 19/19; aligned reader/catalog 36/36; store 26/26; receipt 38/38; context/publication guards 83/83; prior review findings closed. Original `w03/`, `w04b-*`, `w05a-*`, `w06a-*`, `w05b-*`. |
| Import fidelity correction | Resumed `import-fix/`, `import-review/`: three intended reds, then 48/48 + static, 44.232s; actionable no-receipt refusals. |
| HTTP and loader | `scoped-api*`, `runtime-loader*`: actual route 8/8; initial receiving/regression 48/48; loader corrections 10/10 + static, 45.178s; scoped reviews closed. |
| Explicit Apply | `explicit-apply*`: 122/122 affected-owner pass; final actual-host 5/5 + static, 48.186s. No material independent findings. Superseded `live-idle*` evidence stays historical only. |
| UI and installed bridge | `hierarchy-ui*`: 92/92, mobile fix 22/22 + static, reviews closed. `browser-flow*`: extension-dialogs + Markdown passed; 100/100 contracts/static. Final extension group 31.077s; separate Markdown run 182.599s; independent bridge review accepted. |
| Project trust and inspection | `project-trust-fix/` 23/23 + static, 51.879s, reviewed. `inspection-fix*` 15/15 API + 13/13 retained content/native-reader; both correction findings independently closed. |
| Creation copy and failure guards | `session-copy-final/`: receiving 5/5, prefs+BTW 68/68, child 30/30. `creation-guards*`: 38/38 + static, 60.740s; both retained-failure findings independently closed. |
| Retirement / RPC fixture | `availability-finish-final/`: focused 59/59; RPC 88/88 after missing fixture-capability/entered-wait repair. Historical interrupted clients were precisely stopped; their results remain unproven. |
| Documentation/demo | `final-docs/`: whitespace, 58 local Markdown links/headings and focused demo parse/source checks passed; not a full demo browser/typecheck claim. |

Raw reports retain original compiler/fixture/EACCES/invocation failures and diagnostics.
The RPC interruption is resolved, not erased: its fixture returned an early error while
waiting only for Send entry. Corrected fixture capabilities and complete-result racing
now produce a terminal 88/88 verdict. No deadline inflation, process-wide cleanup or
unrelated daemon/process interruption is acceptance evidence.

## Verification and integration boundaries

Pause writers during source export. Reuse unchanged scoped evidence proportionally;
new source requires reassessing affected inputs, not ceremonial restore/rerun cycles.
Use the maintained entry point from the physical checkout, never host service/dev-server
acceptance or checkout production builds. Normal full acceptance is:

```sh
nix run .#test -- all --workers 4 --jobs 12
```

Admit real CPU/memory/concurrent work first. If unavailable, record the concrete reason
and requested/effective reduced widths; do not hide contention with longer deadlines.
Report whole-command, preparation and execution intervals separately where available.
Full acceptance includes all three levels; focused bridge passes do not replace it.

No remote fetch/pull/push/publication, live configuration activation/import or cleanup is
authorized by this plan. Retain feature resources until separately approved cleanup.
Use native Git policy/tools for commit/rebase/merge and the required non-FF `main` target.

## Rollback / recovery

Pi/Nix settings and resource contents are not migrated or rewritten. A source rollback
therefore resumes their native choices; retain Brabbler preferences/receipts so re-upgrade
does not guess/reimport history. Ambiguous/corrupt/unsupported state refuses rather than
repairing or clearing it. Atomic preference publication is not a power-loss durability claim.

Failed explicit Apply reports preparation versus actual retirement/loading uncertainty;
no fake applied revision, automatic retry, silent rollback or effect replay. Public native
disposal barriers remain authoritative. Retain failed child/BTW files for inspection,
with incomplete child setup fail-closed and incomplete attachments unpublished. No automatic
repair/deletion of retained native state or unused choices.

## Completion Checklist

- [x] Supported feature flow and accepted scope changes implemented with focused reviews.
- [x] Installed browser milestone and independent content/profile/path/copy safety checks.
- [x] Current maintained docs and partial demo align with actual feature boundaries.
- [ ] Composed review findings closed and complete acceptance recorded for settled inputs.
- [ ] Required local integration approved/verified; no deployment/publication/cleanup implied.
