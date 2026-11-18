# Issue tracker: Local Markdown

Issues and specs live in `.scratch/<feature-slug>/`.

- Spec: `spec.md` within the feature directory.
- Tickets: `issues/<NN>-<slug>.md`, numbered from `01`, one per ticket.
- Triage: a `Status:` line near the top, using `triage-labels.md`.
- Discussion: append under `## Comments`.

When a skill says “publish to the issue tracker”, create the appropriate
local file. When it says “fetch a ticket”, read its referenced file;
resolve a bare number within the selected feature directory.

Durable implementation plans still belong in `docs/plans/` under the
repository's writing-plans skill. ADRs belong in `docs/adr/`.
The repository's public-safe content rules apply to `.scratch/` too;
it is not a private evidence directory.
