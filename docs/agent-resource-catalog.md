# Agent resource catalog: global managed pilot v1

This is the approved producer v1 interchange for the global pilot. The inert
consumer parser/reader is unconnected; native binding and runtime application are
not established by parsing. See
[ADR 0044](adr/0044-scoped-agent-resources.md) and the
[implementation plan](plans/2026-11-16_skills-extensions-plan.md).

## Location and ownership

The producer supplies inert JSON by default at `<agentDir>/resource-catalog.json`.
It is separate from native Pi settings/manifests and Brabbler's preference store.
Plain Pi need not read it. The initial producer is Nix/Home Manager; this agreement
does not authorize configuration changes or activation. Project metadata production
is not part of this pilot.

The consumer binds references to independently admitted native declarations,
including excluded resources. Metadata neither registers code nor grants trust,
file access or operation permission. Its ownership declaration is not authority
from arbitrary untrusted JSON. Reading inventory must not import extensions,
execute factories, install/fetch packages or create live sessions.

## Wire shape

```json
{
  "version": 1,
  "groups": [
    { "key": "development", "description": "Development workflows" }
  ],
  "packages": [
    {
      "source": "/example/agent/skill-groups/codegraph",
      "name": "agent-skills-codegraph",
      "group": null,
      "managedBy": "nix"
    }
  ],
  "resources": [
    {
      "kind": "extension",
      "package": "/example/agent/skill-groups/codegraph",
      "path": "extensions/codegraph/index.ts",
      "managedBy": "nix"
    },
    {
      "kind": "skill",
      "package": "/example/agent/skill-groups/codegraph",
      "path": "skills/codegraph/SKILL.md",
      "managedBy": "nix"
    },
    {
      "kind": "skill",
      "package": null,
      "path": "/example/agent/skills/style-notes/SKILL.md",
      "group": "development",
      "managedBy": "nix"
    }
  ]
}
```

Paths are synthetic; the CodeGraph producer must preserve its existing installed
package/member paths, regardless of their historical directory names. CodeGraph
is ungrouped, not implicitly assigned to a Core group.

- All objects are closed: reject unknown fields/versions and malformed types.
- Root fields and arrays shown above are required. Empty arrays have no availability
  meaning. There are no IDs, aliases, selections, enabled defaults or dependencies.
- Groups require a unique lowercase hyphenated `key` (`[a-z0-9]+(-[a-z0-9]+)*`)
  and string `description`; groups cannot contain other groups.
- Packages require an absolute lexical installed local directory `source`, string
  `name` (native manifest name, display only), `group` key or `null`, and literal
  `managedBy: "nix"`. No nested packages.
- Every resource requires `kind` (`skill` or `extension`), `package` (known package
  source or `null`), `path`, and literal `managedBy: "nix"`.
- Packaged resources require exact normalized package-relative entry-file paths,
  with no empty, dot or parent components, globs or directories. They must have
  **no** `group` field; the package supplies the parent gate.
- Standalone resources require `package: null`, an absolute installed entry-file
  `path`, and a `group` key or `null`.
- Skill entries identify `SKILL.md`; extension entries identify explicit `.ts` or
  `.js` files. Bundled files are not additional resources.
- There is no root `scope`/`managedBy`, nested `members`, `standalone` array, or
  optional `label`/`purpose` wire field. Global origin comes only from the already
  admitted consumer context. Description/name are presentation, not authority.
- Version 1 catalogs no prompts/themes. Their normal native inventory, handling
  and filters remain another adapter's responsibility; no new gates are added.
- Non-null group references must exist. Reject traversal, ambiguous/duplicate
  normalized references, conflicting owners and still-declared broken sources.
  Do not use labels/content to infer a repair.

The pilot describes managed local installed sources, not npm/git transport syntax.
Unmanaged native sources keep their provenance and normal management boundary;
omission does not claim them Nix-owned or silently disable them. No second native
registration or enumeration language is introduced.

The consumer accepts only this producer v1 wire format, not the former draft
shape. It normalizes flat resources into its immutable internal package/member and
standalone hierarchy, `description` into `purpose`, and `name` into `label`. Those
internal names and global/Nix annotations are not an additional accepted schema
or source/trust/content/availability admission.

## Identity, deduplication and generation handling

Persist normalized lexical installed-path identity within the native settings
context and admitted origin. Do not persist physical store targets as preference
keys. Use native physical deduplication for an observed generation while retaining
declaration provenance, so an automatic-discovery alias cannot bypass a package
gate or execute twice. Ambiguous logical ownership remains an error.

Native manifests and declarations remain separate source-admission boundaries.
Support admitted read-only/symlinked sources without treating metadata as arbitrary
filesystem authority. A configured catalog/native generation must bind coherently;
missing, malformed or inconsistent inputs are errors, not an empty successful
selection or permission to activate an unvalidated new generation. Retain preferences.
Implement bounded reads and diagnostics without silently ignoring unknown fields.
The inert reader bounds bytes, JSON depth/nodes, declarations, text and paths,
rejects decoded duplicate keys, and fences the admitted metadata file's generation.
It supports admitted read-only Nix-like symlinks separately from the no-follow
mutable preference-store policy. Native-source generation coherence and binding
remain separate obligations; the reader does not resolve or read resource sources.

## Producer/consumer ordering

The producer preserves existing package-entry objects/filters and stable paths,
adds the explicit pilot extension and removes only its proven managed legacy
automatic-extension link during a separately authorized migration. It never writes
Brabbler preferences or guesses package-off conversion. Unmanaged copies are not
automatically deleted. Metadata may initially be unused by a consumer.

The consumer owns its separate scoped store, one-time proven legacy import,
ambiguity refusal and recovery. It must prove that imported native availability
filters no longer act as a second hidden Brabbler gate while plain Pi retains its
native on-disk state. No in-memory loader adaptation is claimed supported until
executed fixtures prove it. Durable-writer cutover and live use remain blocked on
the approved migration protocol and runtime lifecycle evidence.
