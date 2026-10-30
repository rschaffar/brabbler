# Git operation postflight reports

## Goal

Reduce unnecessary agent verification round-trips by returning fresh, scoped Git
observations in the tool result and existing durable outcome receipt. Preserve
all approval, revalidation, conflict, cleanup and remote-operation boundaries.

Status: implemented and focused-verified. Independent safety and contract/test
reviews have approved the corrected candidate with no material blockers. Complete
acceptance and exact integration handoff remain pending.

## Context

`plugins/git-workflow/server.ts` currently reports native output and the invocation
checkout's observed HEAD on success. Its structured details omit the selected
refs, post-effect cleanliness, commit identity and integration relationships.
Browser operation receipts are outside model context. Updating only the card
cannot help the agent. Native-success reporting failures already warn against
repeating the mutation; preserve and strengthen that distinction.

The maintained owners are `docs/git-workflow-plugin.md`, the Git operations section
of `docs/feature-internals.md`, and ADR 0016 with its cleanup/review successors.
No active plan owns this behavior. The core optimization and release plans retain
their existing scope; this work neither changes scheduling nor publishes/deploys.
Private session research motivates the feature but is not public plan/test data.

## Architecture

Keep a typed postflight observation/report module inside `plugins/git-workflow/`.
Capture the exact operation inputs in the existing preview, then read fresh state
after the native effect settles. Capture typed baselines separately from patch
`comparison` (which starts at the merge base). One report feeds model-visible text, structured
tool details and the existing receipt summary. Keep generic core/cards Git-agnostic
and preserve old receipt rendering; do not introduce settings or a new protocol.

Report native completion separately from observation validity. Include observation
time/scope, before/after full IDs, selected registrations, checkout status counts,
operation-specific relationships and required-check outcomes/location. Unknown,
changed or unreadable observations are not verified success and never authorize a
retry. Preserve native settlement, index reconciliation/finalization, observation
validity and terminal persistence as separate facts, including successful native
writes followed by finalizer failure. Keep `completed`/receipt-phase semantics
backward compatible, retain already collected facts if final persistence fails,
and put no-repeat/saved-outcome warnings ahead of bounded error/log excerpts.
External writers are not locked out; recheck the selected identities/refs
around collection and describe this as optimistic observation, not atomic proof.

Use bounded summaries/counts and small samples, not entire repository listings or
unbounded native logs. Verification precedes any log excerpt so truncation cannot
hide critical outcome information. No new report is execution authority.

## Plan

### 1. Reviewed plan and merge vertical slice

- [x] Obtain two independent plan reviews (correctness/safety and scope/test
  ownership), resolve material findings, and record the agreed finite scope.
- [x] Add a plugin-local typed report and fresh observation collector, keeping the
  original native outcome and receipt-persistence behavior explicit.
- [x] Extend merge preview with captured feature/target IDs and selected registered
  paths; report target before/after, feature stability, clean selected checkouts,
  actual no-op/FF/non-FF outcome, commit identity/parents/tree and ancestry checks.
  For captured target T, feature F and result R, no-op requires R=T and F ancestor
  of T; FF requires R=F and T ancestor of F, consistent with the method; a new
  non-FF merge requires exactly ordered parents [T,F]. Tree equality with the
  feature is information, not a universal merge invariant. Commit also requires
  the captured parent and candidate tree. Bind direct-ref representation, not
  just OIDs, and read metadata by full sampled OIDs.
- [x] Return exact feature/integration IDs suitable for cleanup only when merge
  verification succeeds. The cleanup tool still validates current state and
  authority independently.
- [x] Add real private-Git regressions for FF/non-FF/no-op outcomes, changed state,
  dirty/unknown observations and successful-native/reporting-failure separation.
  Exercise meaningful missing-report failure before implementation and record red
  and green focused evidence. Review the vertical slice before extension.

### 2. Commit, rebase and cleanup

- [x] Extend commit reporting with actual commit/tree/parents/author, captured
  candidate-tree match and remaining staged/unstaged/untracked counts. Legitimate
  unrelated changes do not turn partial-file commits into failed operations.
- [x] Extend rebase reporting with old/new feature IDs, captured/observed target,
  target stability, current registration/status/operation state and target ancestry.
  Do not infer semantic equivalence or reusable application-test evidence from IDs.
- [x] Expose cleanup's existing dispatched/completed steps separately from freshly
  observed selected branch/worktree/artifact presence/absence/unknown, using the
  frozen inventory without reinventorying dependency contents. A failed deletion
  does not imply intact retention. Shallow path observation must not follow ancestor
  symlinks. Preserve cleanup's permitted target advancement while integration
  remains reachable. Include pre-effect refusals; never automatically delete links.
- [x] Add native and pure-report tests for relevant success, no-op, partial failure,
  incomplete observations and receipt-persistence paths. Keep tests with existing
  owners when practical; classify any new test file with a reviewed live rationale.

### 3. Guidance, review and acceptance

- [x] Update tool descriptions and the owning Git guide to explain that current
  verified report facts satisfy routine result verification; repeat reads for
  missing facts, later changes, task-specific requirements or stronger instructions.
  The next operation's own preflight/revalidation and approvals remain mandatory.
- [x] Prove report visibility in actual tool content/details and existing durable
  receipt summaries. Extend the existing runtime provider's next-context callback
  to assert actual tool-result content (not merely `session.messages` or details).
  Extend the existing generic receipt owner with serialized old/new/unverified/
  partial summary rendering and read-only assertions. Retain existing installed
  Git-plugin approval/receipt bridges; extend only
  the smallest necessary bridge if model/receipt wiring lacks a sufficient owner.
- [x] Obtain independent implementation safety and test/contract reviews. Resolve
  material findings and re-review changed boundaries until no blocking findings
  remain. Reviewers are read-only; one writer owns the receiving candidate.
- [ ] Run focused Nix checks while editing, then complete fresh acceptance using
  `nix run .#test -- all --workers 4 --jobs 12` when resource admission supports
  overlap; use the documented four/four fallback with a concrete headroom reason.
  All core/static/plugin, browser/terminal and genuine deployment levels must pass.
  Record source/candidate identity, exact selection, result, artifact paths,
  preparation/execution intervals and complete command wall time.
- [ ] Reassess any rebase on current local `main`, commit reviewable history and
  hand exact-state ordinary unsigned non-FF integration and separate cleanup to
  the applicable Git lifecycle/approval gates. No publication or host deployment.
- [ ] Move current behavior into the owning guide, finish the completion checklist
  and archive the plan only when its implementation/review/acceptance obligations
  are satisfied; actual Git execution receipts own later integration/cleanup.

## Focused evidence

The original missing-report assertion failed meaningfully (59 passed / 1 failed),
then passed in the merge slice (60/60). Final focused Nix runs, each including
required static checks, passed `server.test.mjs` 69/69, `cleanup.test.mjs` 141/141,
`runtime.test.mjs` 4/4 and `BlockingCard.test.mjs` 13/13. All commands used
`nix run .#test -- core --file <owning-file>`; no skipped/cancelled tests. Command
wall times were 108.96s, 93.92s, 17.55s and 6.55s respectively. These are focused
correctness runs, not full acceptance or matched performance measurements.
Private logs retain the meaningful red, intermediate fixture failures and corrected
runs. Early fixture corrections addressed a bound fs export, a native shim's
subcommand ambiguity, explicit symlink selection and omitted JSON properties;
no unchanged retry or deadline increase is claimed as a product fix.

Safety review additionally drove regressions for configured signature verifiers,
grafts/sparse/hidden/filter states, direct and dangling symbolic refs, late ref/
physical identity/registration changes, bounded escaped metadata, negative
no-follow presence, dirty cleanup invocation, index reconciliation and cleanup
finalizer failure, partial removal and terminal persistence. Both independent
reviewers approved the corrected source; neither approval is execution authority.

## Independent review disposition

Both plan reviewers requested bounded revisions, now incorporated: physical/direct
ref baselines and safe failure observation; exact merge/commit predicates; native,
finalizer and persistence separation; cleanup ledger versus presence; actual next
provider-context visibility; and old/new receipt rendering. These revisions need
implementation evidence, not further framework or permission changes. Reviewers
will inspect the merge slice and final implementation at their existing owners.

## Non-Goals

- No policy/settings/permission changes, global-skill edits, automatic integration,
  retries, rollback, cleanup fallback or remote actions.
- No generic workflow framework, telemetry service or receipt-schema migration.
- No claims about unrelated refs, saved user data, backups or all external writers.
- No broad test migration, dependency/Nix scheduler changes, deadline increases or
  development-server/host-service acceptance.
- No measured agent-round-trip reduction claim before subsequent ordinary use.

## Risks and stop conditions

- Preserve source/filter safety before status reads, direct-ref and physical path
  identity captured before effects, and literal Git arguments. Success and failure
  share the safe observation path: no unchecked fallback HEAD/status reads after
  an unsafe collector refuses. Keep fresh filter/hidden-index checks; observe
  conflict markers as data rather than reusing idle preflight eligibility.
  Postflight must not follow a substituted checkout into another repository.
- A native effect can complete even when observation or terminal persistence fails.
  Report that state explicitly, retain resources and never suggest replay.
- If a requirement needs new authority, an incompatible lifecycle change or an
  unbounded persistent-data migration, stop for a user decision instead of expanding
  the task. Preserve any failed acceptance evidence before a justified correction.

## Rollback / Recovery

The change is additive tool reporting and guidance. Revert the feature to restore
previous output; keep existing receipts/review bundles and actual Git mutations.
Do not erase historical data or undo completed Git effects to make reporting look
successful. A missing final receipt remains an uncertain saved outcome.

## Completion Checklist

- [x] Independent plan and implementation reviews have no unresolved material issue.
- [x] Merge, commit, rebase and cleanup have truthful, scoped model-visible reports
  shared with durable outcome summaries; success/unknown/partial are distinct.
- [ ] Relevant native/pure/wiring tests and complete required acceptance pass at
  identified inputs; failures and proof limits are accurately recorded.
- [x] Owning documentation and tool guidance agree without weakening safeguards.
- [ ] Public-safe reviewable feature history and exact integration handoff are ready;
  publication, deployment and cleanup remain separately gated.
