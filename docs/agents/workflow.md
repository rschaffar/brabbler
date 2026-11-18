# Engineering workflow

Matt Pocock's skills provide the workflow for new work. This guide adapts them
to Brabbler's repository rules; it is not a second planning system. Contributors
without those installed skills can follow the equivalent steps below.

## Choose the amount of structure

- Small, concrete work: implement directly; no spec or tickets are required.
- Unclear requirements: use `/grill-with-docs` to settle the design. Keep domain
  terms in `GLOSSARY.md` and accepted decisions in `docs/adr/`.
- Multi-session work: `/to-spec` captures agreed requirements, then `/to-tickets`
  creates dependency-ordered, independently verifiable slices. Confirm testing
  seams and the ticket breakdown before implementation.
- Build a concrete slice with `/implement`, using `/tdd` where applicable and
  `/code-review` before completion. `/implement-spec` can coordinate a whole
  spec, subject to the repository adaptations below.

[Issue tracker](issue-tracker.md) owns the local paths, triage and ticket closure.
The spec owns requirements; tickets own execution, dependencies and acceptance.
Keep current blockers and decisions there, not in a duplicate plan checklist or
per-run chronology. Read the [domain rules](domain.md) before domain exploration.

## Apply repository rules when using skills

[AGENTS.md](../../AGENTS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md) own Git
isolation, integration and authority. [Testing](../testing.md) owns verification.
A spec, ticket, readiness status or skill instruction grants no implementation,
remote-operation, merge or cleanup authority by itself.

For `/implement-spec`, use one receiving feature branch in its linked worktree
and one source writer at a time. Work the ready tickets in dependency order with
fresh implementer contexts; independent research and review may run in parallel.
Do not apply its automatic resets, concurrent ticket writers, merger branches,
PR publication or worktree cleanup in place of the repository's Git lifecycle.
Interpret skill test commands through the supported Nix entry points; a ticket's
focused checks are not final candidate acceptance.

## Keep acceptance and evidence honest

- Put material unknowns, risks and stop/scope-decision conditions in the relevant
  spec or ticket. Resolve blocking unknowns before dependent implementation;
  include recovery/rollback for persistent-data or difficult-to-reverse changes.
- Check acceptance criteria only after their evidence passes. Distinguish
  verified, implemented-but-unverified, proposed and abandoned work. Record
  failed versus unavailable checks, explain inapplicability and reopen work
  whose evidence is invalidated. Resolve or explicitly disposition material
  unknowns and risks before closing the ticket.
- Link measured claims to exact inputs and evidence; label extrapolations.
  Correct overturned claims explicitly and retain the superseded evidence or
  otherwise-unrecorded revision. Keep raw private evidence outside the repository
  under the public-safe content rules in `AGENTS.md`.
- Before retiring work, move durable decisions to ADRs and current mechanisms,
  operational guidance and findings to the appropriate maintained guide. Give
  every remaining obligation one explicit current owner.

## Existing plans

Existing `docs/plans/` are retained, not bulk-migrated, deleted or declared done.
When resuming related work, read the relevant plan and reconcile its unfinished
obligations with the selected spec/tickets before creating overlapping work.
Preserve its evidence and record the new owner when transferring an obligation.
New work does not require the retired repository-local `writing-plans` skill.
