# Configuration-effort handoff for scoped resources W00

Owner decisions from the companion Nix/Home Manager requirements discussion,
2026-11-16. This is an input to
[W00](2026-11-16_skills-extensions-plan.md). The owner subsequently authorized
producer implementation on its existing branch and approved the exact small producer
contract below. This does not authorize Brabbler readers/runtime changes or prove
lifecycle support. No configuration activation is authorized.

**Status update:** the companion effort has implemented the producer and is verifying
it. Only this handoff file is supplied in this worktree; existing feature source files
and its coordinator plan are not edited by the companion session.

## Decisions established with the owner

- Start with a **CodeGraph mixed-package pilot** and separate inert purpose metadata.
  The existing locally maintained Pi adapter and input-owned skill travel together.
  Keep the CLI and skill provenance with their existing input; no upstream adapter
  move or MCP redesign is requested.
- Export descriptive metadata for the **current managed catalog**, without moving
  everything into new packages. The approved producer format/location is below;
  W00 still owns consumer admission/error behavior. Do not invent native Pi manifest
  fields or require nested Pi packages.
- Choose future package boundaries by ownership and resources that belong together,
  not by purpose alone. Preserve existing unrelated bundles/extensions and deliberate
  standalone exceptions. Do not change other harnesses' installations.
- CodeGraph becomes an **ungrouped package** in logical metadata. Keep its existing
  native package root and skill-member path stable, even if the root directory's
  historical name mentions groups. This is not a request to restore a Core group.
- Logical groups are flat, with **at most one controlling group** for a package or
  standalone resource. A package's skill and extension remain independently selectable
  beneath its package gate. Distribution implies no automatic dependency enablement.
- **Nix owns managed contents and registration; runtime controls availability.**
  Brabbler must not update/delete Nix-owned contents or imply that runtime Remove edits
  the declaration. Unmanaged packages retain their normal management boundary.
- Pi and Brabbler share installed files but have **independent availability state**.
  Plain Pi retains native settings. No ongoing bidirectional synchronization is
  requested. Brabbler preferences belong to the native settings context (`agentDir`):
  accounts sharing that context share preferences; distinct contexts stay independent.
  Preserve profile boundaries, without cross-context copying.
- For the new Brabbler store, **import proven existing choices once, error on ambiguity**.
  Restrict continuity to unchanged paths/scopes; do not guess mappings. Prove old native
  filters are not left as a competing hidden gate. The owner may reconsider import UX
  later if it becomes burdensome; no alternative has yet been approved.
- Native packaging can be piloted **before the new Brabbler feature is ready**, under
  documented existing filter/reload limitations and separate activation approval.
  Metadata can initially be unused by a consumer.

## Important simplification: identity and reconciliation

The owner explicitly prefers manual repair and actionable errors over a complex
continuity/alias system. These decisions replace the draft recommendations for
permanent explicit IDs and changed-placement review:

| Case | Accepted behavior |
| --- | --- |
| Identity | Stable installed source paths, resource-relative paths and group keys. No additional permanent-ID registry or identity inferred from display names/content. |
| In-place update | Same installed path keeps preferences across changing Nix-store targets. Reuse native normalization/deduplication where appropriate; verify exact helper behavior. |
| Move or rename | New path is a new object. No automatic preference transfer, alias registry or guessed continuity. Manual reset/reselection is acceptable. |
| Group-membership change | Apply the newly declared parent gates directly. Preserve own choice if the resource path is unchanged; no historical-placement acknowledgement workflow. |
| Disappearance | Leave unused preferences alone; no automatic expiry or tombstone lifecycle. |
| Same-path return | Existing preferences apply again. A still-declared broken source is an error, not intentional removal. |
| Duplicate sources | Preserve ordinary native deduplication of the same physical source. Remaining conflicting copies/names/tool registrations produce actionable errors, not guessed winners. |
| Unmanaged copies | Do not delete them automatically. Remove only proven managed legacy discovery links during the authorized producer migration. |

Synthetic continuity example: package source `/example/agent/packages/tooling` and
member `skills/query-guide` stay unchanged while their store targets update: choices
remain. Renaming that member to `skills/query-help` creates a new object. Moving the
unchanged package from group `research` to `development` applies the new parent gate
without a separate placement-review state. If conflicting independent copies remain,
stop with a diagnostic identifying what the user must fix.

This does **not** waive the real one-time legacy-state import, locked writes,
interruption recovery, rollback/re-upgrade or source/trust requirements. Keep those
bounded to the approved simple model rather than building general rename resolution.

## Producer/consumer boundary and unresolved work

The producer preserves CodeGraph's native package path, member path and existing
package-entry objects/filters. It adds the explicit extension resource and removes
only the old managed automatic-extension link. It does not reinterpret old package
switches or write Brabbler's new preferences.

The owner explicitly referred the question of a formerly disabled skill-only
package gaining an extension to **Brabbler's package-gate/import policy**, rather
than asking Nix to invent a preference migration. Native Pi continues using its
native semantics. Resolve ambiguous legacy combinations in the consumer as agreed
above; do not treat this handoff as a particular off-state conversion rule.

The producer contract is now approved and documented in the companion repository's
`docs/guides/pi-resource-catalog.md`. W00 must review its reader behavior against it,
not invent a conflicting producer schema. Reading catalog metadata must not import
extensions, execute factories, install/fetch packages or create sessions. Plain Pi
remains valid without reading it.

## Approved producer contract: catalog version 1

Nix authoring uses `profiles.agentResources` for packages, groups and standalone
extension references; `profiles.agentSkills` retains skill sources/targets/ownership.
The default read-only file is `<agent-dir>/resource-catalog.json`; account profiles
link to the canonical descriptive file without sharing mutable selections.

Top-level `version` is integer `1`; `groups`, `packages`, `resources` are arrays:

- Group: `key` (lowercase hyphenated name), `description` (string).
- Package: `source` (absolute logical local source), `name` (native manifest name,
  display only), `group` (known key or null), `managedBy` (literal `nix`).
- Packaged resource: `kind` (`skill` or `extension`), `package` (known package source),
  `path` (normalized relative entry file), `managedBy` (`nix`). No `group` field:
  the package supplies its parent gate.
- Standalone resource: same `kind`/`managedBy`, `package: null`, `path` (absolute
  entry file), `group` (known key or null).

Skill entries identify `SKILL.md`; extension entries identify an explicit `.ts` or
`.js` file, not the containing tree. Version 1 adds no prompt/theme resources or
availability/auth fields. Relative paths have no empty, dot or parent components.
A resource identity is the path/kind tuple, not a new ID field. Nix validates declared
relationships/destinations and checks actual extension entry files at build time,
without importing them, including standalone entries below directory links.

Synthetic example:

```json
{
  "version": 1,
  "groups": [{ "key": "development", "description": "Development workflows" }],
  "packages": [{
    "source": "/example/agent/skill-groups/codegraph",
    "name": "agent-skills-codegraph",
    "group": null,
    "managedBy": "nix"
  }],
  "resources": [
    { "kind": "skill", "package": "/example/agent/skill-groups/codegraph", "path": "skills/codegraph/SKILL.md", "managedBy": "nix" },
    { "kind": "extension", "package": "/example/agent/skill-groups/codegraph", "path": "extensions/codegraph/index.ts", "managedBy": "nix" },
    { "kind": "skill", "package": null, "path": "/example/agent/skills/review-guide/SKILL.md", "group": "development", "managedBy": "nix" }
  ]
}
```

Reject unsupported versions, malformed/duplicate references, unknown parents and
unresolved conflicts before using affected metadata. Do not infer enablement from
presence or turn unreadable managed metadata into broader availability. Absence does
not establish that all native/project resources are managed. W00/W04 still own the
exact fallback presentation and fresh source/trust/physical-path admission.

## Verified compatibility evidence and limits

The producer's actual Home Manager fixture migrates the old automatic CodeGraph link
into its unchanged package and reverses that transition. Registration is gated by a
post-link check that refuses any remaining legacy automatic-discovery path without
deleting it; dry runs defer that check because native cleanup is not performed.
Occupied-new-destination, leftover-directory and dangling-link refusal are fixture-tested.
Tests cover native mixed
filters, profiles, trusted project replacement/deltas, excluded factory sentinels,
physical aliases, source revisions and unchanged native settings. The adapter executes
against a fake CLI, including failure, cancellation and its actual 120-second timeout.
The compiled plain Pi 1.5.2 executable passes separate enabled/skill-off/extension-off/
all-off RPC registration checks using disposable in-memory sessions with no model calls.

Native local-package identity is lexical, while resource dedup uses physical realpaths.
**Lifecycle finding:** the current SDK can retain old extension code after retargeting
a package-root symlink, even with a new loader in the same process. A fresh process
loads the new code. W01 must not assume new-loader construction alone refreshes code.
Native skill collisions are diagnostic warnings/first-wins; the proposed stricter
consumer error policy is not supplied by Nix or a patched SDK.

The consumer owns actual selection and runtime application; packaging does not
prove safe unloading or remove instructions already consumed. Subsequent accepted
decisions use practical whole-record SDK suppression and explicit selected-session
Apply, not automatic next-turn switching. Saving neither blocks input nor applies
live; Apply succeeds now at a safe boundary or refuses busy, without waiting/retry
or sibling changes. Pi/Nix owns package contents and registration; Brabbler's obsolete
package mutation controls are retired, not rehomed. See [ADR 0045](../adr/0045-explicit-resource-application.md)
and [ADR 0046](../adr/0046-agent-resource-availability-only.md).

**Consumer handoff:** inventory, separate first-use import, runtime composition,
independent disabled-skill inspection and explicit Apply are now connected in the
consumer. Current mechanisms/limits belong to the [feature guide](../feature-internals.md#resource-api-and-skill-inspection)
and [session guide](../session-internals.md#explicit-resource-application), not this
producer evidence record. Full composed acceptance remains separately coordinated.
Producer preparation/tests/builds are not activation. No Brabbler feature source,
user settings, deployed resources, publication or cleanup was changed by this handoff.
