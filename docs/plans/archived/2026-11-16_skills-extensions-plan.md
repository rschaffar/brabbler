# Scoped skills and extensions — completed implementation record

## Goal

Control installed skills and external Pi extensions through one **Skills & extensions**
hierarchy with Global → Project → Session choices, independently admitted skill inspection
and explicit **Apply saved changes** for an existing conversation.

**Implementation status: complete and verified within the documented installed-local pilot.**
This record hands mandatory exact-state local integration to the native Git lifecycle;
archival is not integration approval, a merge receipt, deployment or publication.

## Accepted scope and current owners

- [ADR 0044](../../adr/0044-scoped-agent-resources.md) owns selection, lexical installed-path
  identities, direct parent gates, independent trust/profile/file-access limits, one-time
  native import and practical whole-record SDK suppression.
- [ADR 0045](../../adr/0045-explicit-resource-application.md) supersedes automatic idle
  application. Save leaves live runtime/input unchanged. Explicit Apply reconstructs
  only the selected runtime now, or refuses immediately if busy/unsafe. No waiting,
  queued application, automatic retry or sibling restart. The abandoned idle controller,
  notifications and save-triggered fences were removed.
- [ADR 0046](../../adr/0046-agent-resource-availability-only.md) supersedes package-action
  rehoming. Pi/Nix owns installing/searching/updating/removing contents and registration.
  Brabbler shows ownership guidance and retires obsolete management endpoints.
- The [catalog contract](../../agent-resource-catalog.md) owns the single flat producer v1;
  the [configuration handoff](../2026-11-16_pi-resource-configuration-handoff.md) retains
  companion decisions. No companion configuration or live activation was performed here.
- [Feature contracts](../../feature-internals.md), [session contracts](../../session-internals.md)
  and [architecture](../../architecture.md) own current implementation behavior. Earlier
  detailed editing-unit plans and superseded requirements remain in Git history.

Supported installed local POSIX arrangements use the existing inert native/catalog admission.
Unsupported transports, ambiguous ownership and broken generations refuse actionably rather
than adding a discovery framework, alternate catalog, alias registry or SDK patch.

## Plan — delivered

- [x] Preserve the original shared dirty handoff on the same feature branch/worktree;
  introduce progress commits without resetting, stashing or discarding source.
- [x] Implement/review scoped own-choice resolution followed by current parent gates;
  keep children editable under Off parents, retain unused preferences and same-path return.
- [x] Connect inert producer/native inventory, canonical registered-root Project/own Session
  context, guarded atomic store and real first-use proven Global/Project native import.
  Close enabled-alias and omitted-selector fidelity findings by conservative no-receipt refusal.
- [x] Connect actual startup/reopen suppression and native-Off restoration in memory;
  preserve required factories/native prompt/theme handling and hard trust/profile/tool ceilings.
  Disabled skills disappear from advertising and explicit invocation. Initialization-held
  SDK effects remain the accepted practical-suppression limitation, not a sandbox claim.
- [x] Replace automatic switching with explicit safe Apply, same-ID history/native intent,
  authoritative disposal/readiness receipts and immediate busy/error refusal. Accepted
  text/images/queues/effects/cards/children are not cancelled; public deferred nextTurn works.
- [x] Connect responsive hierarchy/details, search/disclosure, all supported scope controls,
  mobile Back/focus and honest saved-versus-actual status. Actual public-loader membership,
  not matching revisions alone, is required for an inclusion promise.
- [x] Verify installed browser Save → saved-but-unapplied request → explicit Apply → actual
  SDK tool/instruction/skill exclusion and literal disabled-skill invocation.
- [x] Admit canonical Project trust with approved standard SDK read-lock metadata only;
  retain explicit denial/revocation and native data preservation.
- [x] Copy source CURRENT OWN Session choices atomically once, including empty, on fork,
  BTW and child creation before factories. No historical/effective values or permissions
  copied; no reopen/Resume/dequeue recopy. Retain failed files with incomplete child setup
  fail-closed and failed BTW attachments unpublished.
- [x] Connect native-excluded/Off skill inspection through independent source/trust/path/
  saved-profile/tool admission and bounded contained Markdown reads, binding the opened
  descriptor before reading. Preserve nested navigation and general-file-root refusal.
- [x] Retire obsolete package/skill mutation endpoints before native effects, preserve
  meaningful native/security/refusal assertions, show Pi/Nix guidance and Built-in features.
- [x] Update maintained guides/catalog/handoff/source map and partial static-demo notices.
- [x] Complete independent Standards and Spec review; all material findings closed.
- [x] Complete all three maintained acceptance levels on the same frozen candidate/input.
- [x] Hand off mandatory local integration to the receiving native Git lifecycle and its
  exact-state approval/outcome receipts, preserving separate publication/cleanup gates.

## Complete acceptance

Verified candidate: `7833e31f9d379f8fdfefdc656af0fc6c1a24efeb`, rebased onto local
`main` `98e1fc02ee8a171a4eb2cb5d4d36abe5c239b1e0`.
All three physical-checkout exports verified the SAME content/mode SHA256:
`9882510e75109a351e2b2eb16f768c98b2b1a6fdfc475d752ace8c4859f17e3f`.

| Maintained command | Result | Whole command, including in-run realization |
| --- | --- | --- |
| `nix run .#test -- service` | Genuine Home Manager activation/environment/HTTP write/restart/PTY proofs; 32/32 offline converter cases | 137.262s |
| `nix run .#test -- e2e --workers 2` | 26/26 browser/terminal groups, 61/61 complete current scenario chains | 407.945s |
| `nix run .#test -- core --jobs 4` | 543/543 core/bundled-plugin files; 4,911/4,911 tests; required static evidence and 34 exporter contracts | 400.538s |

Summed command wall: **945.744s**. Attempt elapsed **1023.037s**, including **77.293s**
inter-command verification/coordination, not model work. Levels ran serially, each once;
no prerequisite prewarming or cold-cache benchmark is claimed. Initial available RAM was
16.116 GiB on 32 effective CPUs, below four-browser/normal-overlap admission; authorized
browser width 2 and core width 4 were retained as memory recovered. Requested/effective
widths were 2/2 and 4/4, with no deadlines or resource guards overridden.

Service and all browser capsules used the EXACT same installed production package.
Service restart changed its real invocation while preserving durable state; real PTY
and final stopped-service/cgroup/port ownership were observed. Converter includes all
29 original cases plus real empty-query, user-xattr refusal and POSIX-ACL refusal.

Browser preparation: support 2.733s, manifest 5.462s, group-client execution 396.259s.
Core file execution window: 395.094s. VM guest proofs: 54.877s; separate prerequisite
interval unavailable. These are nested/mixed envelopes, not additive assertion costs.
All clients, original browser process groups and guest owners settled without observed
survivors or uncertainty; containment remains Nix-owned, not escaped-descendant proof.

No test/group was skipped or converted into a pass. Existing conservative exclusive
core holds remained explicit and every file executed. Static declared-input evidence
was accepted for exact inputs, not represented as a fresh rebuild.

## Review and retained evidence

Standards: no material composed findings. Spec: one actual-membership status finding,
corrected and independently closed. Earlier import/loader/inspection/mobile-focus and
retained-creation findings are also closed within their source-qualified scopes.

Private evidence labels in the resumed task root: `final-standards/`, `final-spec/`,
`final-spec-fix-review/`, `creation-guards-review/`, `inspection-fix-review/`,
`browser-final-fix-review/`, and **`full-acceptance-11/`** for complete acceptance.
Original task-root labels retain foundations/import observations; roots are distinct.
Raw reports/logs are deliberately outside public source.

Earlier full failures remain retained, not relabelled by later greens. Corrections
preserved semantic assertions, worker/shutdown joins and original diagnostic causes:
canonical native fixture admission, complete-settlement timing, composed-option source
guards, actual persistence versus observer callbacks, Built-in navigation, two-caller
faux response reservation, explicit workspace admission and virtualized-list navigation.
No general console/HTTP suppression, force click, longer deadline or hidden retry was used.
The exact historical 409 TTL subguard was not independently captured; the confirmed
fixture admission defect was corrected without claiming that later success isolates it.

## Native integration handoff and boundaries

The receiving native Git workflow owns the remaining mandatory **effect**: current-ref/
clean-checkout validation, exact-state user approval and ordinary unsigned **non-FF**
merge into local `main`, followed by verified outcome. This archive records verified
implementation and the explicit handoff; only that workflow's receipt proves integration.
Documentation-only closure may follow the tested candidate without relabelling its run;
application/test inputs must remain unchanged or be reassessed.

No remote fetch/pull/push/publication, host deployment, live configuration activation/import
or resource cleanup is authorized. Retain feature resources until separately approved.

## Rollback / recovery

Pi/Nix native data is not migrated or rewritten. Retain Brabbler preferences/receipts across
rollback/re-upgrade; unsupported/corrupt/ambiguous state refuses rather than guessing or
clearing it. Atomic staging/rename is not a power-loss durability claim or a fence against
arbitrary older binaries. Failed Apply never invents an applied revision, automatically
retries, replays effects or bypasses a native disposal barrier. Retained incomplete child
files remain inspection material, not ordinary unrestricted sessions or repair jobs.

## Completion Checklist

- [x] Accepted feature, scoped simplifications and independent safety reviews complete.
- [x] All core/static/plugin, browser/terminal and genuine deployment VM acceptance passed.
- [x] Durable contracts handed to guides/ADRs; implementation record archived.
- [x] Mandatory integration effect explicitly transferred to native Git approval/receipts;
  deployment, publication and cleanup remain separate and unclaimed.
