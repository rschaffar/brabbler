# Running-forks acceptance blocker

**Disposition:** Implementation, independent review and complete acceptance are finished. Exact-state local integration is handed to the native Git approval/outcome receipts; this record does not claim deployment or publication.

## Goal

Diagnose and repair the acceptance failure independently of the retained Settings layout branch. Preserve fail-closed resource admission, source-session ownership and existing deadlines.

## Context

Baseline local main is `f9f570a52cb5167c8f2bd6bc3313aa106bc179b2`. The retained fork failure returned resource-initialization failure, not a shutdown error. Two focused baseline runs passed that fork but failed BTW creation with a forbidden resource context (25s / 24s command wall time). This proves a baseline running-forks blocker, not yet the identical fork cause.

The leading testable cause is expiry of the shared five-second allowed-root cache before creation-time own-choice copying. Native tests currently admit their directories permanently and therefore miss that boundary. Exact raw evidence remains private outside the repository.

## Plan Relationship

This is a bounded correctness follow-up to scoped resources, not a resource-management redesign or test-performance project. The core optimization plan retains its deferred optimization scope. The separate Settings fix stays committed and unmerged.

## Plan

- [x] Inspect retained response/trace and run the supported focused browser selection on baseline main.
- [x] Reproduce expiry at real native creation owners without weakening the read-only resolver. Native controls reproduce both fork commands, BTW and delegated creation. The retained browser fork body hides its underlying cause; expiry explains the reproduced failure class, not conclusively that historical occurrence.
- [x] Repair creation-owned admission preparation for forks, BTW and delegated children. Preserve copying, failure retention and independent source state; fix fixture admission isolation and join catalogue persistence.
- [x] Run focused native/browser checks and independent review: 113 core tests and installed running-forks passed; after the adjacent child/fixture follow-up, 111 affected core tests passed. Static safety review is clear.
- [x] Complete core/static/plugin, browser/terminal and genuine deployment acceptance after rebasing onto local main `d60e619073d0fc40cc67bb8368c5f89a13f630de`; see evidence below.
- [x] Prepare the committed candidate, unchanged-input evidence and exact-state handoff for required unsigned non-FF integration into local main. Native approval/outcome receipts own the integration and subsequent separately governed cleanup.

## Non-Goals

No host-service use, remote Git operations, Settings-branch changes, automatic retry, error filtering or increased deadlines. The separately observed backend child-closure timeout is not resolved by unchanged passes. Read-only investigation found that its ten-second case budget includes dynamic fixture loading and child construction; retained TAP identifies no pending phase or assertion defect. Do not attribute it to contention or claim a timeout fix.

## Completion Checklist

- [x] Regression red and green exercise the real creation boundary; unknown/expired-root refusal remains covered by the resolver owner. Corrected-fixture controls independently omit the first-fork and response-fork refreshes; both fail at resource initialization. BTW and delegated-child controls fail with forbidden resource contexts.
- [x] Complete acceptance and independent review are recorded against exact inputs, with timing and evidence retained privately.
- [x] Native exact-state integration handoff is ready; publication and cleanup retain their separate policy gates.

## Acceptance evidence

`30999aa0c1706c5440fb8b4f25773dde714d1883` passed `nix run .#test -- all --workers 4 --jobs 12` on x86_64 Linux in **452 seconds**, including in-run realization. All **545 core files / 4,921 tests / 14 suites**, **26 browser/terminal groups** and genuine Home Manager deployment passed, with no skipped/cancelled core cases. Requested/effective core width was twelve; browser width was four. Admission observed 32 CPUs and about 58 GiB available memory. The rebased application was rebuilt during the command; earlier focused checks had prepared other prerequisites.

Immutable source: `/nix/store/2qib2w65rf5j7hp3qv4q66kz4kc5d65f-source`; outer digest `e9a87589f2bec07bb6327c5f3f462345e6f89741ea5bfe615f5b0d50201dff6b`. Core, browser and deployment reports agree on that source. Typegen/typecheck/lint use their declared-input Nix evidence, not a claim that every prerequisite executed afresh.

| Measured interval | Seconds |
| --- | ---: |
| Core invocation / before core lifecycle / test-file window | 353.608 / 38.219 / 314.077 |
| Browser invocation / support preparation / definition preparation / group-client window | 352.521 / 85.230 / 7.471 / 259.816 |
| Deployment invocation / guest evidence | 92.087 / 52.071 |

Overlapping intervals are not additive. These are command/phase envelopes, not a matched performance benchmark. Exact driver reports, static identities, native reds, source variants and running-forks traces are retained in the private task evidence reported in the session.

The backend closure file passed with its unchanged deadline at twelve effective workers. That supplies current acceptance, not a root-cause explanation or a fix for the historical timeout. The historical generic fork response likewise does not expose its underlying cause; native expiry controls and two baseline BTW refusals establish the repaired failure class.

This record's subsequent documentation-only completion/archive does not change the accepted application, test or Nix inputs. Source-change and rebased-catalogue interaction reviews found no remaining must-fix findings.
