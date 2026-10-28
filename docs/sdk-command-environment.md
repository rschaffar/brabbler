# Pinned SDK command environment patch

Brabbler's downstream SDK patch owns twelve modular SDK distribution targets, not a
sandbox for extensions or a repair of Pi's standalone CLI/RPC bundles. It keeps
normal `SSH_AUTH_SOCK`, explicit isolation, provider/account configuration and Pi
session metadata, while removing `BRABBLER_PASSWORD` and `BRABBLER_SSH_RUNTIME` only
from final child-process environment copies. The trusted supervised Next worker
continues to receive its login password and private SSH runtime locator.

## Installation and verification

`bin/sdk-command-env-payload.js` pins the public `@earendil-works/pi-coding-agent`
**1.4.0** manifest and all twelve target modules by SHA-256, with original and
patched hashes and exact replacement recipes. It contains only patch snippets,
not vendored SDK modules. Its self-contained ESM helper is installed at
`dist/utils/brabbler-command-env.js` inside the SDK and imports no application code.
The manifest fingerprint and package version must match exactly. Unexpected local
modifications or an SDK upgrade refuse instead of attempting a best-effort patch.

`bin/patch-sdk-command-env.js --apply` is installation-only. It resolves the SDK
from this application's installed package root, never a selected project's cwd.
Before writing, it preflights the manifest, every target and the optional helper.
Unknown bytes, unexpected file types/symlinks, missing targets and an unknown
helper refuse categorically without dumping source text, file errors or values.
Each recognized original target is transformed and its resulting hash checked
before writing. Fully patched targets are left untouched.

The owned dependency installation must be exclusive while applying. Writes stage
same-directory files, preserve target permission bits, fsync their contents, then
rename atomically per file. There is no multi-file transaction: interruption can
leave a mixture of recognized whole-file states. Reapplying repairs those known
states; a half-edited/unknown module is not a repairable state. The helper is
published before any module that imports it. Reapplying a complete patch performs
no writes.

`--check` and `checkSdkCommandEnvironment()` only read. They require the v2
policy, exactly twelve target recipes, all twelve patched hashes and the exact
helper; originals, missing helpers and known mixtures refuse. A former nine-target
installation cannot pass this check. The launcher checks before router allocation
or worker spawning. It never patches installed packages or changes the server process environment. npm installs
that deliberately omit lifecycle scripts will refuse startup until an authorized
installation step applies the patch; they do not silently run an unpatched SDK.

Nix invokes the applicator on its own writable modules tree before copying the
immutable shared modules output. The manifest fileset includes both bin helpers,
so a recipe change invalidates that dependency output. Runtime/core and the
application builder consume the same output. Patching only the application's
private build copy is insufficient. Normal npm postinstall invokes the same
applicator before retaining `prepare-terminal.js`. `bin/` is already shipped in
the npm allowlist. No new dependency, version bump, fork or lock change is part
of this patch.

Both flags accept an optional explicit `--sdk-root /absolute/install/root` for
owned-installation tooling and private tests. Startup does not accept a
project-supplied target or environment override for SDK resolution.

## Standalone runtime exclusion

Brabbler's [archive decision](adr/0038-prebuilt-application-archive.md) deliberately
excludes the SDK's standalone `dist/bundle/` and own CLI link from its exclusively
owned dependency installation. This is separate from the twelve-target modular
environment patch: neither its target fingerprints nor the upstream manifest are
weakened. `bin/sdk-runtime-policy.js` applies the exact-inventory exclusion at
installation; supported launchers check both policies read-only before allocation.

The standalone Pi CLI/bundled RPC entry points (including helpers that launch them)
are not provided by this Brabbler-owned tree. A separate Pi installation remains
separate. The archive must be extracted and installed as its own application root,
so npm honors the fixed modular-Undici override; sharing or hoisting its SDK into
another application's dependency tree is unsupported and refuses.

## Covered modular paths

- SDK `spawnProcess` / `spawnProcessSync`: package manager capture/inherit/sync
  paths and other existing SDK wrapper users (`config.js`, path attributes,
  modular package-manager CLI helpers).
- Extension `pi.exec()`; cached and uncached configuration `!command` helpers,
  including configured-shell/default-shell fallback.
- Shared local Bash/PowerShell executor, after tool session metadata and any
  supplied environment have been resolved.
- Native ripgrep/fd searches, their tool version probes and extraction fallback
  commands; shell `which`/`where` discovery and Windows cleanup `taskkill`.
- Footer Git's synchronous and asynchronous fallback.
- Clipboard command readers/writers (including the exported `copyToClipboard`
  command route), browser/default-handler opening, and the exported modular
  `RpcClient` child launch.

The filter never merges ambient env into an explicitly supplied env. In package
management and `RpcClient`, existing SDK override merging remains before filtering.
The resolver's `env` argument continues to mean interpolation/provider context, not a replacement
process environment. No provider credential-store or account/catalog binding is
replaced or altered. Native MCP's existing isolated transports remain separate.

## Scope limits and further audit

Interactive-UI-only direct-spawn modules remain outside this twelve-target
policy: external editor/session sharing, tmux probing and session-selector trash.
The embedded Brabbler paths do not use those interactive workflows. Standalone
CLI/RPC bundled copies are also not modified: filtering the modular `RpcClient`
launch does not patch the CLI/RPC server executable it might start. Native clipboard
APIs are not subprocesses and are not changed. Arbitrary trusted extensions may
still read the server's environment or invoke Node APIs themselves. This patch is
hygiene, not isolation; a successful check is not a whole-SDK sandbox certificate.

The patch adds import lines to distributed JavaScript; existing upstream source
maps are not regenerated and can show pre-patch coordinates. Reassess this bounded
patch on every SDK change rather than widening accepted fingerprints casually.
The 1.4 rebase retains all twelve targets and replacement recipes: eight originals
are unchanged; grep, shell, tools-manager and clipboard-command have new exact
fingerprints. Upstream `rg --no-config`, Windows resolution and detached POSIX
clipboard behavior remain intact. No new environment hook replaces this policy.

## Regression ownership

`lib/sdk-command-env.test.mjs` copies only the twelve targets and the manifest to
private fixtures. It reconstructs originals through known recipe reversal when
the Nix dependencies are already patched. Tests must never apply to the installed
SDK or copy live credentials. It covers apply/check/idempotence, recognized
mixtures, interrupted states, unknown bytes/helper/manifest, symlinks, categorical
errors, read-only behavior, root-bound resolution and helper env semantics. It
also refuses the former nine-target state and unknown bytes in each newly covered
exported helper.

`lib/sdk-command-env-runtime.test.mjs` requires already-patched dependencies. A
private worker exercises actual modular `pi.exec`, config helpers, native Bash,
shared local shell execution, package command wrappers, ripgrep/fd and footer Git
against synthetic processes and files. It additionally exercises the actual
clipboard command helper and exported `copyToClipboard` through a private
`wl-copy` recorder, browser opening through a private opener recorder, and the
exported `RpcClient.start/stop` through a private `node` recorder. These recorders
do not access a clipboard, open a browser or start an RPC server. The unreferenced
browser recorder is observed to exit, and the fake RPC child is explicitly stopped
and joined. Tests cover account/socket overrides, empty environments, session
metadata and retention of the synthetic parent server env.
PowerShell's unchanged factory uses a private resolver substitution and the real
shared executor with Node standing in for the shell, proving UTF-8 prefix and env
transport without native Windows/PowerShell. Windows shell/extraction branches
also receive source/fingerprint regressions; this is not native Windows evidence.

`lib/sdk-command-env-launch.test.mjs` verifies refusal before allocation and
unchanged trusted-worker environment publication. Existing launcher tests remain
applicable. Complete integration acceptance belongs to the Nix acceptance owner;
focused tests are not full acceptance, publication or deployment authorization.
