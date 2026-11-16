# ADR 0044: Scoped skill and extension selection

- Status: Accepted decisions; implementation and runtime feasibility remain incomplete
- Plan: [Scoped skills and extensions](../plans/2026-11-16_skills-extensions-plan.md)
- Configuration input: [Owner handoff](../plans/2026-11-16_pi-resource-configuration-handoff.md)

## Context

Brabbler needs independent availability choices for skills and external Pi
extensions, with flat logical groups and native package gates. Native Pi must
continue to understand its packages without reading Brabbler metadata. Availability
is not operation permission, source trust, a profile ceiling or a code sandbox.

## Decision

Resolve each object's Global → Project → Session choice first, then apply its
current group/package gates. Parent disablement never rewrites descendant choices
or prevents editing them. A session choice can enable a globally disabled group;
a resource cannot bypass its effectively disabled parent. Project-local resources
have no Global choice. Absent editing scopes are unavailable, not fabricated.

The baseline for an eligible object without a choice is Enabled. New members of
an Off group/package remain excluded. Source/trust/profile limits and authored
manual-only skill metadata remain independent. Disabled skills must be excluded
from both the advertised catalog and explicit invocation.

Preferences and one-time native import evidence belong to the native Pi settings
context (`agentDir`). Separate contexts stay independent. Provider accounts sharing
one context share these preferences; choosing a model account does not switch the
resource selection. Project and own-session overrides remain distinct. For the first implementation,
Project overrides exist only at registered Git checkout roots, sharing the existing
repository binding across linked worktrees. Non-Git folders and checkout
subdirectories have no Project override; Global and own-Session choices remain
available where applicable. Do not repurpose trust or native-default identity markers.

Identity uses normalized lexical installed source/member paths and group keys,
not display names, content, permanent IDs or resolved store targets. Same installed
paths retain choices across in-place updates. Moves/renames create new objects;
there is no alias or automatic preference-transfer registry. Changed group/package
membership applies current parent gates directly, preserving the object's own
choice where its installed path and origin remain unchanged. Unused preferences
remain indefinitely; same-path return reuses them. A still-declared broken source
is an error, not intentional removal. Preserve native physical deduplication with
provenance; remaining ownership/name conflicts require actionable errors, not
inferred winners. No historical-placement acknowledgement workflow is required.

The global managed-catalog pilot uses separate inert version-1 JSON at
`<agentDir>/resource-catalog.json` by default; see the
[catalog contract](../agent-resource-catalog.md). Producer v1 has `version`, `groups`,
`packages` and flat `resources`; group descriptions and package names are display
metadata. Each package/resource declares `managedBy: "nix"`; global origin comes
from admitted consumer context, not a root JSON scope/ownership claim. Resources
are skills/extensions only, with relative packaged entry files and absolute
standalone entry files. Only standalone resources carry a `group` field (key or
null); packaged resources inherit their package parent. CodeGraph is an ungrouped mixed
package, with its existing package root and skill-member paths preserved. Groups
are flat, with at most one controlling parent for a package or standalone object.
Package members remain independently selectable; distribution implies no automatic
dependency enablement. No new native Pi manifest fields or nested packages.

Nix owns managed contents and registration. Brabbler controls availability and
must not update/delete those contents or imply that Remove changes the producer's
declaration. Unmanaged packages retain their normal management boundary. Native
Pi availability and Brabbler availability are independent, with no ongoing
bidirectional synchronization or cross-context copying.

Automatically import proven legacy choices on first use of each supported native
settings context/scope, at unchanged paths/scopes. Commit imported choices and their
completion/provenance record atomically in `<agentDir>/brabbler/resource-preferences.json`;
no separate native-data transaction or multi-phase journal is needed because Pi/Nix
state is never rewritten. Unambiguous whole-package disablement imports as an Off
package gate, including newly added members. Narrower evidence imports only proven choices. Ambiguity is an actionable
error, not a complex inference/repair system. Exact evidence, transaction phases,
legacy-writer handling, interruption recovery and rollback/re-upgrade still require
implementation and verification. Imported native availability filters must not
remain a competing hidden Brabbler gate; this does not authorize changing native
Pi's on-disk state or authored invocation metadata.

## Consequences and open boundaries

Management inventory must not import/execute extensions, install/fetch packages or
create sessions. Inventory does not grant instruction/file-read authority. Disabled
skill instructions may be inspected after independent source/trust/path/profile and
file-access admission, limited to the skill's Markdown and contained Markdown
references. Inspection neither enables the skill nor opens arbitrary browsing. Desired
selection must remain distinct from genuinely applied selection. The accepted
compact enabled row is “✓ Included in next-turn selection”, without a permission
warning subtitle. Git Workflow, Session Launch and Acceptance retain their existing
scoped operation permissions/settings under “Built-in features”, separate from
Skills & extensions. Supported settings links do not create a generic third-party
settings framework. New group/package gates control skills/extensions only; prompt
templates and themes retain existing native handling and filters.

Save choices immediately, but apply them by idle replacement after existing
admitted work and accepted queues settle. Do not require closing the conversation,
interrupt active effects, switch between model turns within a run, re-expand accepted
text/images or replay work. Already consumed instructions cannot be erased. Refuse
fresh HTTP/direct-SDK/extension input visibly before transformation while application
is pending; do not add a hidden retry queue. Desired/applied state remains distinct,
including blocked or indefinitely delayed application.

Implement this as a small reusable idle-change coordinator over existing lifecycle
ownership. Keep waiting/coalescing and desired/applied/error reporting separate from
feature-specific application actions: future settings might use a setter instead of
runtime replacement. Connect only skills/extensions in this feature; do not wire
thinking depth or other settings, create parallel locks, or build a general task queue.

For new forks, BTW conversations and children, copy the source's current own Session
availability choices once at creation, not effective inherited values, historical
fork-point choices, permissions or approvals. Thereafter the new session's choices
are independent. Keep existing child construction/snapshot scheduling where safe:
resource construction counts as admission only when its selected snapshot is fixed
before imports/factories. A child so admitted may still queue/start under that old
snapshot after a preference change; that is pending application, not proof of a new
selection. Queued children and held preflight count as owned work even if not
streaming. Scheduler-time factory deferral/recopy is not required. This simple idle
policy supersedes the earlier proposed fine-grained child/next-turn timing rules. SDK `extensionsOverride` runs after imports/factories. The owner accepts that
initialization may occur: extension availability is practical suppression of normal
session contributions, not a non-circumventable guard. Filter whole optional extension
records to remove advertised tools, commands, snippets/guidelines, ordinary session
handlers and their dynamic resource contributions. Do not describe this as unloading
code or complete execution isolation. Captured SDK sends, shared-bus subscriptions,
provider registrations and other initialization-held effects may remain. Source,
trust, file-access and profile ceilings remain hard independent boundaries. Skills
still require exclusion from both advertising and explicit invocation. SDK reload resolution alone does not establish
successful cleanup/loading. Use existing public SDK filtering/composition and preserve required inline factories
and existing trust/profile boundaries. This practical suppression decision supersedes
the earlier pre-import exclusion and non-bypassable availability requirements. Do not
maintain a heavyweight SDK provenance/loader patch solely to enforce them. No SDK
patch or monkeypatch is approved. Normal logical parent gates and native diagnostics
remain required; unsupported/ambiguous catalog bindings need honest diagnostics,
not guessed ownership, arbitrary file access or a copied discovery framework. Production admission,
native-enabled replacement and failure recovery still require executed proof;
approving this bounded implementation does not certify runtime support.

The detailed migration protocol and executable admission/settlement ownership remain
open implementation/proof obligations, not additional timing-policy decisions. The global metadata agreement does not approve a project metadata producer.
No live migration, configuration activation, publication or resource cleanup is
implied by these decisions.
