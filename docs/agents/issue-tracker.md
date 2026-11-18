# Issue tracker: Local Markdown

Issues and specs live in `.scratch/<feature-slug>/`.

- Spec: `spec.md` within the feature directory.
- Tickets: `issues/<NN>-<slug>.md`, numbered from `01`, one per ticket.
- Triage: a `Status:` line near the top, using `triage-labels.md`.
- Discussion: append under `## Comments`.

When a skill says “publish to the issue tracker”, create the appropriate
local file. When it says “fetch a ticket”, read its referenced file;
resolve a bare number within the selected feature directory.

New work uses the spec for requirements and tickets for execution,
dependencies and completion. Do not maintain a parallel plan checklist.
See [Engineering workflow](workflow.md) for skill adaptations and existing plans.
ADRs belong in `docs/adr/`.

Resolve a ticket by checking its verified acceptance criteria, recording
concise evidence under `## Comments`, and setting `Status: done`.
`done` is a completion state, not a sixth triage role. Reopen invalidated
work with the appropriate triage status and explain what remains.

The repository's public-safe content rules apply to `.scratch/` too;
it is not a private evidence directory.
