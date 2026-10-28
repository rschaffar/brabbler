# Brabbler release status

Brabbler is an independently maintained application derived from
[Pi Web](https://github.com/agegr/pi-web). Preserve original licenses and credit;
this is not an upstream release.

## Distribution identity

- Repository selected by the owner: `https://github.com/rschaffar/brabbler`.
  Selection/local remote configuration does not create or remotely verify it.
- Initial Brabbler version: **0.1.0**; Pi SDK compatibility is recorded separately
  as **1.4.0**, including the guarded downstream policies below.
- The root manifest remains `private: true`. No npm registry publication or
  package-name ownership is assumed. There is no automatic update query,
  release-upload job or demo deployment.
- Two supported distribution definitions: declarative Nix/Home Manager and a
  standalone **prebuilt application archive**. The archive is extracted into an
  owned directory, then `npm ci --omit=dev` installs locked runtime dependencies.
  See [portable installation](portable-installation.md). It is not installed as
  a dependency of another npm project.

## Build and verify

Production application builds run only inside isolated Nix builders. From the
selected source candidate:

```sh
nix build --no-write-lock-file --no-link --print-out-paths .#brabbler-tarball
```

This produces an output directory containing `brabbler-0.1.0.tgz`.
The Nix package extracts that same archive and adds its immutable module tree and
launcher wrapper; do not distribute those store paths as a portable installation.

The archive includes compiled assets, first-party source, the font input/notices
and a generated `npm-shrinkwrap.json` derived from the reviewed lock. It must not
contain credentials, agent/session state, tests, checkout dependencies or arbitrary
build output. Inspect the **actual** archive and generated browser/server chunks,
not just the source allowlist. Dependency source/notice obligations follow what is
redistributed, separately from dependencies fetched by the consumer or a Nix build.

Complete candidate acceptance comprises the core/static/plugin checks, every
browser/terminal group and the genuine Home Manager deployment VM described in
[Testing](testing.md). Archive changes additionally require the exact-checksum
ordinary Linux/macOS smoke in `nix/portable-smoke.mjs`. The manual-only hosted
workflow builds once in Nix and tests that artifact on ordinary runners; it neither
deploys nor publishes. Runner availability/architecture/cost and execution still
need separate review/authorization.

## Guarded SDK installation

The modular SDK retains the existing exact-byte child-environment patch.
A version-scoped override fixes modular Undici resolution to **8.12.2**. The
owner approved excluding SDK 1.4.0's affected standalone `dist/bundle/` tree and
its own `pi` CLI link from Brabbler-owned installations. The modular embedded
runtime remains; this installation does not provide the standalone Pi CLI/bundled
RPC entry points. A separately installed upstream Pi CLI is unaffected.

`bin/sdk-runtime-policy.js` verifies the SDK manifest, fixed Undici resolution and
the complete known bundle inventory before exclusion. Only the known Node shebang
rewrites resolving to the same interpreter are canonicalized for Nix. Applying
requires a physical owned dependency subtree, not a hoisted/shared/symlinked SDK.
Unknown bytes or partial removal refuse and require a fresh owned installation.
Startup checks the policy read-only; it never removes or repairs dependencies.
See [dependency dispositions](dependencies.md) for scope and remaining obligations.

## Current evidence and release gates

Local source implementation is in progress. A preliminary archive passed a clean
non-Nix Linux x86_64 / Node 24.21.0 smoke, including native HTTP PTY, hidden password
setup, login, restart, rotation, header guard and warned no-auth boundaries. This
spike is not final-candidate, all-architecture, macOS or complete Nix acceptance.
No public release or hosted macOS result is claimed.

Before publication:

1. Settle/review source and obtain full candidate acceptance plus final archive
   inventory/checksum, ordinary Linux smoke and native hosted macOS evidence.
2. Resolve applicable bundled-license/covered-source obligations and update exact
   advisory evidence; a clean npm lock audit is not a bundled-code clearance.
3. Approve exact privacy filters and prepare/verify a separate sanitized public
   history copy. Preserve private originals; never push all branches, tags or a
   mirror. Current-tree cleanup alone does not remove historical disclosures.
4. Agree the future canonical development/cutover path so unsanitized ancestry
   cannot be merged back into public history.
5. Separately approve repository creation/settings (including GitHub private
   vulnerability reporting), CI dispatch and each exact push/tag/release upload.
   [SECURITY.md](../SECURITY.md) describes reporting, not verified remote settings.

No package build, test pass, local merge or saved plan authorizes publication,
service activation, migration, remote access or cleanup. Existing installations
have a separate [rename/cutover boundary](brabbler-rename.md); this release work
does not perform their live migration.
