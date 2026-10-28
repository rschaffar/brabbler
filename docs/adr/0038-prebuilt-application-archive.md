# 0038 — Prebuilt application archive and owned SDK runtime

## Status

Accepted by the release owner; exact-candidate verification and publication are
separate gates in [the release plan](../plans/2026-10-28_public-release-plan.md).

## Decision

Ship Brabbler 0.1.0 as a standalone prebuilt application archive, alongside its
source/declarative Nix definitions. Build the production UI/server only in an
isolated Nix builder. The user extracts a new owned directory and runs
`npm ci --omit=dev` there; no consumer-side Next build or Nix is required.
Generate the archive's `npm-shrinkwrap.json` from the reviewed root lock inside the
builder, rather than maintaining two independently editable checkout locks.

Do not support installing this archive as a dependency of another npm project.
The clean Linux spike proved npm ignores that dependency's own overrides, resolving
the SDK's old nested Undici; the runtime policy correctly refused it. The owner
selected root installation over an additional downstream SDK-repackaging scheme.

Pin SDK 1.4.0's modular Undici resolution through an exact parent/version-scoped
override to the already fixed direct Undici 8.12.2. Preserve the upstream manifest
and twelve-target child-environment guard; do not downgrade the SDK or patch
minified security internals to manufacture an audit pass.

The SDK's standalone bundle embeds affected implementation code independently of
modular resolution. The owner approved excluding the complete known
`dist/bundle/` tree and its own `pi` CLI link from Brabbler-owned installations.
The modular embedded runtime remains supported; standalone bundled SDK CLI/RPC
entry points from this tree do not. A separately installed Pi CLI is untouched.

Apply exclusion only to a physical, exclusively owned app dependency subtree.
Pin the upstream SDK manifest and full bundle inventory/content digest. Accept
only the three known Node shebang substitutions resolving to the current Node
executable, as required by the Nix npm hook; retain all other bytes in the digest.
Refuse unknown bytes, shared/aliased installs or interrupted partial removal.
Stage the verified tree by same-directory rename before removal. Recovery is a
fresh owned installation, not wildcard cleanup or repair at startup.

Startup verifies fixed modular resolution and exclusion read-only, in addition to
the environment-patch guard. These checks do not certify Node's own bundled network
libraries, arbitrary extensions, another Pi installation or all undiscovered flaws.

## Verification and consequences

Keep full Nix core/static/plugin, browser/terminal and genuine Home Manager VM
acceptance. Add an exact-checksum archive smoke on ordinary Linux and a named native
macOS runner. Test installation, actual stored-password TTY input, HTTP terminal,
restart/rotation, request guard and warned no-auth boundaries with synthetic state.
No source/build snapshot, CI job, local integration or passing smoke authorizes
publication. Separate notices/source obligations apply to actual redistributed
chunks/assets; consumer-downloaded dependencies and Nix aggregate artifacts are
distinct inventories. Preserve private original history and sanitize only a
separately reviewed publication candidate.
