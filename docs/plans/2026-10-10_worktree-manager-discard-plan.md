# Manual branch and worktree discard

## Goal

Allow deliberate removal from the project manager regardless of containment,
including Unknown/no comparison target and valid clean detached worktrees.
Deleting a branch not proven integrated requires an explicit loss-acknowledgment
checkbox in its exact review; detached removal shows a commit-retention warning.

The user requested implementation and answered all three scope questions on
2026-10-10. Preserve source cleanliness, artifact consent, physical/ref identity,
main/designated-target/comparison-target/invocation/selected/active protection,
reservations, partial-effect reporting and durable reviews. No actual accumulated
resources are deletion fixtures. Work in `feat/worktree-manager-discard` at
`/home/robert/projects/3rdparty/pi-web-worktrees/worktree-manager-discard`, based on
local `rst-main` `d558a88e03ce5e89a09a5a41e42d393067ea7b41`; CodeGraph initialized.

## Plan Relationship

- Extends the completed manager documented by ADR 0021 and its archived plan.
- Existing `git_cleanup` remains integrated-only; strict agent worktree removal
  still keeps branches. This is not new unattended/agent disposal authority.
- Do not restore retired managed Workflow, adopt unrelated active plans, modify
  live permission settings, touch backups, publish, build for production or
  activate the installed service.

## Architecture

- Add a separate plugin-owned browser `discardResources` operation/permission,
  default Ask. Both Ask and Allow always need the live exact browser confirmation.
  Register no agent discard tool; the public agent executor rejects this action.
- Share structural inventory/effects with integrated cleanup through trusted
  internal wrappers, never JSON authority switches. Existing integration and
  lifecycle Keep gates remain intact for `cleanupFeature`. Completed-feature
  lifecycle preferences do not veto a separately confirmed manual discard;
  operation Deny and exact artifact authority still apply.
- Bind literal branch/full tip or genuine detached HEAD/full commit, exact
  registration and physical/admin identities. Detached subjects can remove only
  their worktree. Optional captured comparison is warning evidence, not policy
  authority; independently protect the configured target and selected comparison.
- The plugin computes loss evidence and supplies a generic optional card
  acknowledgment label. The generic project host freezes a card/operation digest,
  requires matching affirmative acknowledgment on approval, and durably persists
  it with the decision before releasing authority. No Git semantics in core.
  Existing session cards remain compatible; unsupported acknowledgment-bearing
  session approvals fail closed rather than silently dropping the requirement.
- The manager checkbox is scoped to context/operation/card digest, resets on
  replacement and is read-only in recorded outcomes. Preparation UUID/payload
  recovery, stale-read guards, Stop, historical review and restart no-replay stay.
- Expose eligible detached rows with stable path-based IDs, worktree-only resource
  normalization and HEAD metadata. Locked/missing/prunable/invalid registrations
  remain non-executable; Unknown graph evidence never excuses unknown source state.

## Plan

- [x] Implement browser-only permission/operation and shared structural capture/
  effects; prove legacy integrated cleanup and agent-tool exposure are unchanged.
- [x] Add generic exact-card acknowledgment transport/claim/persistence and
  validation; test omitted/false/stale/foreign acknowledgment, idempotence, write
  failures, Stop/reject and historical/restart behavior.
- [x] Update inventory, normalization, manager review/checkbox and English copy;
  test detached HEAD movement/reattachment and target/source/activity refusals.
- [x] Extend disposable manager desktop/mobile acceptance for unintegrated,
  Unknown/no-target and detached removal, rejection, acknowledgement/reset/API
  enforcement and durable history; retain existing manager recovery regressions.
- [x] Record independent safety review and complete applicable core, plugin and
  browser acceptance at stable source; preserve exact identities/logs/failures.
- [x] Update maintained worktree/plugin/feature guides and ADR 0022.
- [ ] Create reviewable commits and resolve completion intent plus separate exact
  non-FF integration (or explicit retention).

## Verification

Parent coordinates dependency preparation, source export and checks; one writer
at a time. No concurrent browser/SDK acceptance or application-deadline changes.
Use `nix develop --offline --no-write-lock-file .#test -c` with:

- Focused `node nix/test-offline.mjs --file ...` while editing.
- Complete `node nix/test-offline.mjs` (core, typegen, typecheck, lint).
- Sanitized `node --experimental-strip-types --test "plugins/**/*.test.mjs"`.
- `env E2E_WORKTREE_MANAGER_ONLY=1 npm run test:e2e`.
- General `npm run test:e2e` and
  `env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` for shared executor/card
  validation changes. Terminal acceptance if terminal integration/harness changes.

## Acceptance evidence — 2026-10-10

All final application/browser runs used the unchanged current source, exported at
`58de8d3b0c2e4d7c996bd52f741b27ec3b32c00d26d29ed48e29733ba48f0ed5`.
Core's normalized inner export was
`440ce81b6fa779b7162c4101d1d6f37916f154a9bd3a3c7d11f190dd5a3a169d`.
Only this plan's evidence/status changes followed acceptance; these are not new-tip
application runs. Wall times below cover commands, not earlier dependency preparation,
model work, review or coordination. From the selected prepared Linux worktree:

| Command after the common Nix prefix | Result | Command wall / inner time | Retained evidence |
| --- | --- | --- | --- |
| `node nix/test-offline.mjs` | 280 files, 1,814 tests; full typegen/typecheck/lint; complete coverage, no observed survivors | 151 s | `/tmp/pi-discard-core-1.log`; `/tmp/pi-web-test-offline.nSgzPlF9/lifecycle.json` |
| `sh -c 'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test "plugins/**/*.test.mjs"'` | 335 tests, no failures/skips | 98 s / 97.0 s | `/tmp/pi-discard-plugin-2.log` |
| `env E2E_WORKTREE_MANAGER_ONLY=1 npm run test:e2e` | 1280px / 390px pass | 478 s / 471.0 s | `/tmp/pi-discard-manager-browser-2.log`; `test-results/e2e/browser-jYVe5b/run.json` |
| `npm run test:e2e` | full general suite, including manager/session-launch/shared questions at desktop/mobile | 1,183 s / 1,177.0 s | `/tmp/pi-discard-general-browser-1.log`; `test-results/e2e/browser-4mcKQo/run.json` |
| `env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` | 1280px / 390px pass; integrated agent cleanup/cards/receipts/Stop retained | 409 s / 399.8 s | `/tmp/pi-discard-plugin-browser-1.log`; `test-results/e2e/browser-1PvNyn/run.json` |

Successful browser manifests have empty errors and settled resources; corresponding
outer lifecycles passed with owned bulk cleaned. Reports, traces and fixture state remain.
No terminal integration/shared-harness file changed, so terminal rerun was not applicable.
Focused iteration passed 9 files/65 tests plus static preparation in 46 s:
`/tmp/pi-discard-focused-1.log`, `/tmp/pi-web-test-offline.4hPJzUNC/lifecycle.json`.
The earlier plugin checkpoint passed 330 tests in 92 s, before the final designated-target
regressions: `/tmp/pi-discard-plugin-1.log` (not relabeled as final coverage).

### Retained failure and diagnostic limitation

First manager run failed after a real successful `mismatch-safe` deletion, on an
independent APIRequestContext status GET with `ECONNRESET` (235 s command wall).
Retained `/tmp/pi-discard-manager-browser-1.log` and
`test-results/e2e/browser-ALQK5Q/{run.json,context-1.zip,server.log,events.jsonl,lifecycle.json}`.
Browser trace recorded successful deletion/status first; server shutdown followed the
run error, so later console connection failures are teardown consequences. A Node
pooled-socket idle reuse race is plausible, not proven: APIRequestContext connection
activity was absent from that trace. Status verification now uses real browser `fetch`,
retaining HTTP/body assertions and recording those reads in browser traces. No production
patch, retry, console exemption or deadline increase was justified. Passing changed
runs do not prove the original socket reset's root cause.

### Independent review and corrections

Static reviews are not separate runtime acceptance:

- Backend review `01a12704-89a4-70e6-9b9d-3eb6c6aca262`: corrected dispatch-time loss
  of originally proven comparison binding with prepared native ref verification and
  lock-held direct/symbolic/graph/registration/policy checks; added fault injections.
- Transaction review `01a1271c-6cf9-70e6-9b9d-3ec82684aa4b`: corrected dispatch-time
  designated-target symbolic alias protection, including acknowledged disposal;
  disposable tests verify retained refs, partial effects and released locks.
- Generic/UI review `01a1270c-92cf-70e6-9b9d-3eb9d372143d`: corrected missing Stop
  during approved/cardless pending review and omitted title/subtitle/scope. Follow-up
  found no remaining blocker. Browser checks verify full scope visibility; the precise
  post-approval pending interval is covered by gated host and view tests, not a separately
  gated real-browser case.
- Failure investigation `01a12722-f021-70e6-9b9d-3ed0d8171c8b` preserved the transport
  uncertainty and confirmed that teardown followed the original verification failure.

Native Windows/UNC and privileged-mount acceptance were not run. External writers and
other servers remain outside managed reservations; no historical integration-time or
permanent detached-commit retention claim is made.

## Risks and Recovery

Commit/ref deletion and ignored-content removal are irreversible here; no force,
automatic backup, rollback, retry, prune or reflog-retention guarantee. Exact
checks/reservations do not exclude external writers or other servers. Stop only
prevents undispatched steps. Failed receipt persistence must not imply settlement.
Rollback disables the manual surface/permission while retaining saved reviews;
it never replays records or restores deleted resources automatically.

## Completion Checklist

- [x] Any integration state/no target works only when structural safety passes.
- [x] Unproven branch deletion needs current server-bound loss acknowledgment;
  detached worktree removal carries a warning and cannot delete a branch.
- [x] Agent cleanup integration/Keep gates and strict removal remain unchanged.
- [x] Source/target/activity/artifact protections and honest partial/no-replay
  behavior pass disposable tests and independent safety review.
- [x] Required acceptance and maintained documentation are recorded honestly.
- [ ] Final local integration is separately approved/verified or resources are
  retained; cleanup, publication and activation remain separately authorized.
