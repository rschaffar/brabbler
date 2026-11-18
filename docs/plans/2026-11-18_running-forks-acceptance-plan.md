# Running-forks acceptance blocker

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
- [ ] Complete core/static/plugin, browser/terminal and genuine deployment acceptance after rebasing onto current local main.
- [ ] Commit the settled candidate and obtain exact-state approval for required unsigned non-FF integration into local main.

## Non-Goals

No host-service use, remote Git operations, Settings-branch changes, automatic retry, error filtering or increased deadlines. The separately observed backend child-closure timeout is not resolved by unchanged passes. Read-only investigation found that its ten-second case budget includes dynamic fixture loading and child construction; retained TAP identifies no pending phase or assertion defect. Do not attribute it to contention or claim a timeout fix.

## Completion Checklist

- [ ] Regression red and green exercise the real creation boundary; unknown/expired-root refusal remains covered by the resolver owner.
- [ ] Complete acceptance and review are recorded against exact inputs, with timing and evidence retained privately.
- [ ] Local integration uses native exact-state approval; publication and cleanup retain their separate policy gates.
