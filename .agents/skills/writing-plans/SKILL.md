---
name: writing-plans
description: Draft, execute, or track lean, verifiable implementation plans for non-trivial repository work with sequencing, tradeoffs, unknowns, risks, or multi-session execution. Use for features, migrations, refactors, or investigations; skip small obvious tasks.
metadata:
  project-workflow-align-baseline: v3
---

# Writing Plans

This repository is long-running work executed by agents and people across many
sessions. Plans are shared memory, so an accurate plan is worth more than a fast
one.

A plan request authorizes creating or revising the plan artifact, not
implementation. A plan never grants its own authority: execute only when the user
requests it. An active plan may record and scope authority the user already
granted.

## Ground the Plan

Inspect repository evidence before asking questions.

Read active plans in `docs/plans/` first when that directory exists, and check
whether the work is already owned by one of them. If two plans would own the same
behavior, resolve the overlap explicitly rather than writing a competing plan.

Read relevant maintained architecture, runbooks, specifications, override or
exception registries, and other owning documentation before proposing changes to
behavior they govern. Read accepted decision records before contradicting a
settled decision; contradicting one requires a new decision record, not a plan
footnote.

Ask at most one focused question when proceeding would require a risky guess;
otherwise state assumptions and unknowns that affect execution or validation.

Save the plan to `docs/plans/YYYY-MM-DD_<topic>-plan.md` with a lowercase
kebab-case topic unless the user asks for chat-only output. Create `docs/plans/`
when saving the repository's first plan.

## Keep Plans Public-Safe

Assume plans, their history, commit messages and linked assets will be public.
Record technical contracts and outcomes without private operational identifiers,
customer/employer context, real transcripts, internal URLs, credentials or personal
checkout/cache paths. Use synthetic examples and portable placeholders instead.
Keep exact sensitive findings and raw reports in an owned private persistent
location outside the repository, never in a tracked appendix or linked screenshot.
A plan can state the scope and result without reproducing the private value.

Public upstream attribution, commit IDs and intentionally public maintainer
contact details may be retained. Do not confuse an author's own public identity
with secret data. If a required detail cannot be safely generalized, ask before
recording it. Inspect the diff and asset metadata before staging; deleting it later
does not remove it from history. Report lost/unavailable private evidence honestly
rather than recreating a raw-evidence claim from a summary.

## Structure the Plan

Always include `Goal`, `Plan`, and `Completion Checklist`.

Add only optional sections that carry weight:

```markdown
## Context
## Plan Relationship
## Architecture
## Tech Stack
## Non-Goals
## Assumptions
## Unknowns
## Risks
## Rollback / Recovery
```

Use `Plan Relationship` when another plan owns adjacent work, and name what this
plan does not own.

Use `Architecture` for module boundaries, ownership, data flow, interfaces,
state, storage, activation, or deployment.

Use `Tech Stack` for tool, runtime, dependency, and package choices, with a
rationale column.

Use `Non-Goals` aggressively; an unstated non-goal becomes scope creep later.

Include `Rollback / Recovery` for anything touching persistent data, secrets,
boot, networking, remote access, migrations, configuration activation,
deployment, or another difficult-to-reverse boundary.

## Record Evidence, Including Retractions

Put measured numbers in the plan rather than adjectives, and state the command,
environment, hardware, and dataset that produced them. Label every extrapolation
as an extrapolation.

When investigation overturns an earlier recommendation, record the retraction
visibly instead of deleting the original claim. Keep the current decision visible;
link the superseded claim/evidence instead of appending its chronology to the plan.
Preserve an uncommitted superseded revision before replacing it; that is historical
evidence, not a declaration that the unfinished plan is completed or archived.

## Keep the Execution Control Small

Separate user requirements and repository contracts from agent-chosen mechanics.
Do not turn a packet format, control count, private snapshot or review convention
into a completion requirement without a concrete contract it protects.

Use one active plan as the next-work authority: a finite blocker list, a few
dependency-ordered packages, decisive acceptance gates and stop conditions. Label
verified (with exact scope), implemented-but-unverified, proposed and abandoned
work separately. Put raw results and historical chronology behind evidence links;
update the plan at meaningful decision/package boundaries, not after every run.

Keep work in flight small: one receiving candidate and one implementation slice
per repository writer. Delegate only a bounded independent deliverable that the
profile can produce, and compose/review it in that candidate before accumulating
more variants.
Reuse existing discovery and unchanged review findings. A failed precondition needs
targeted diagnosis, not another broad investigation or automatic task restart.

For performance work, distinguish architectural improvement, actual work removed
and whole-feedback improvement. Take a whole-feedback checkpoint at the first
coherent candidate before optional expansion. State what would make the approach
unviable or require a scope decision. Reuse input-bound checks proportionally;
new commit IDs and evidence-only edits do not alone require another full suite.
Preserve required safety, meaningful faults and complete acceptance; do not invent
universal proofs, duplicate reports or new execution infrastructure by default.

## Write Executable Tasks

Use Markdown checkboxes that each name one action, its object, the expected
result, and the acceptance evidence.

```markdown
- [ ] Add the validation rule in `path/to/owner`; verify it with `<focused command>` and record the expected result.
```

Order tasks by dependency, and turn material unknowns into early discovery tasks
so they resolve before invalidating later work. Prefer a spike that closes an
unknown over a task that assumes it away.

Avoid vague, combined, or open-ended tasks such as "improve quality", "handle
edge cases", or "monitor forever".

End with finite completion checks tied to files, commands, tests, builds, review
state, deployment/activation evidence, or explicit user acceptance.

## Execute and Track

Check a task only after its acceptance method passes. Paste concise evidence when
completion is not obvious from repository state.

Leave failed or unavailable checks open, and say which of the two occurred. Mark
an inapplicable task as `- [x] Not applicable: <reason>`. Reopen a task when later
work invalidates its evidence.

Track only the current plan, and do not inspect or alter unrelated plans. Show
updated checkboxes and evidence in chat when the plan is chat-only.

Never infer completion from implementation alone; written but unverified work is
not done.

Declare completion only when every task and completion check is checked, material
unknowns are resolved or explicitly accepted, risks have a clear disposition,
and required handoff work is done.

## Curate and Archive

Move a fully executed plan to `docs/plans/archived/`, then report its path and
what moved where.

Do not archive a chat-only plan, a plan with missing evidence, or a plan whose
archived filename already exists. Delete a plan outright instead of archiving it
only when the user asks.

Before archiving or deleting, move durable content to its maintained owner:

- accepted decisions and tradeoffs to decision records under `docs/adr/`;
- current mechanisms and empirical findings to `AGENTS.md`, `README.md`, or the
  maintained architecture documentation;
- operational behavior to the focused guide under `docs/`;
- dependency, override, exception, or compatibility lifecycle facts to their
  owning registry; and
- remaining future direction to a roadmap or another explicit current owner.

That handoff makes archiving safe and deletion possible: measurements,
retractions, and accepted gaps in a plan are often its most valuable content. The
archive is a workflow handoff, not permanent documentation; Git remains the
historical record.

Retire a plan with an unmet obligation only after that obligation has one
explicit current owner, and state where it moved. Unchecked boxes from a deleted
plan must never be treated as active work.
