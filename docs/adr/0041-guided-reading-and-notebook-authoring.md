# Guided reading and native notebook authoring

## Decision

Keep notebooks as Markdown walkthroughs with exact source/diff evidence. Remove
interactive reviewer recording, required-answer outcomes, findings/resolution
management, frozen feedback batches and JSON reply import. This supersedes
[ADR 0036](0036-guided-review-recording.md)'s product and recording/handoff decisions;
it does not change ordinary live questions, Git-operation approvals or their history.
Implementation and verification are tracked in the
[authoring plan](../plans/2026-11-05_notebook-authoring-plan.md).

The valuable workflow is reading, discussing a step in ordinary chat, asking an
agent to revise it, and continuing. Administrative review state adds friction that
is not justified by that purpose. Legacy authored questions remain passive readable
guidance, including their options and explanations, without recording or grading.

## Reader and chat

Preserve the existing guided reader, pane layout, free navigation and immutable
Git readers from [ADR 0029](0029-markdown-review-notebooks.md). A simple step action
appends bounded explicit document/step/reference context to the selected existing
chat draft. It neither creates a session nor sends a prompt. Current destination
checks and preservation of unrelated draft text/images remain necessary. The
context is untrusted authored material, not instructions or execution authority.
Explicit guide reload retains the current stable step where possible; changed
references are never silently rebound to old displayed material.

## Agent authoring

Use thin native agent tools backed by a shared notebook-authoring library. The
initial capabilities are compact inspection, revision-checked single-step edits,
and explicit analysis/application of full-OID reference mappings. No separate CLI,
MCP server, database or new notebook format is required. Ordinary read/edit tools
remain usable; the special tools exist for structural work and validation.

Existing parser/file-root/physical containment and file-save owners remain the
boundaries. Transient edit preconditions bind manifest revision, resolved chapter,
step identity and chapter revision. Preserving surrounding bytes must also preserve
neighboring parsed step boundaries. Tools cannot widen read-only, chat-only or
child grants. Recheck live capabilities before effects after awaited work.

Reference maintenance is not a Git mutation. Inspect only independently admitted
local repositories, never fetch/rebase/commit or create retention refs. Existing
unreachable old objects may inform analysis; proposed destinations still satisfy
normal reader authorization. OID maps do not infer checkout/branch moves. Compare
actual target-kind material and report changed, ambiguous, incomplete or unavailable
cases honestly; equal excerpts are not semantic equivalence or test execution.
Automatic correspondence discovery is deferred. Apply changes only with explicit
current preconditions; report per-file partial completion without automatic replay
or rollback over newer writes. The existing save owner does not exclude arbitrary
external editors or provide a multi-file transaction.

## Retained history

Retirement does not authorize deletion. Existing `review-data/` files and browser
recovery entries stay untouched; do not import their private contents into prompts
or rewritten guides. Retired recording endpoints respond without inspecting or
mutating that history. Maintain manual recovery information separately from current
workflow instructions. No legacy-record UI, automatic conversion or cleanup is added.
Preserved records do not preserve missing Git objects or imply that old answers
cover revised prose. Source rollback can restore the old reader against retained
data, subject to its original version/currentness checks.

## Consequences and verification

The user interface becomes smaller, and agents can revise a guide without rewriting
unrelated chapters. Ordinary conversation, rather than a second issue tracker, owns
requests for changes. The tradeoff is intentionally losing structured completion,
unresolved-feedback inventories and automatic association of imported investigations.

Native fixtures own file/Git/capability safety, mounted owners cover reload and
composer currentness, and the installed desktop/touch Markdown chain proves their
connection without automatic agent execution. Retire old assertions explicitly;
retain shared reader/question/composer protections. Complete acceptance remains the
core/static/plugin, browser/terminal and genuine deployment matrix in
[Testing](../testing.md), not a new feature-specific baseline.
