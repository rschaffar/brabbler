# Brabbler release status

Brabbler is an independently maintained application derived from
[Pi Web](https://github.com/agegr/pi-web). Preserve original licenses and credit;
this is not an upstream release.

## Distribution identity

- Repository selected by the owner: `https://github.com/rschaffar/brabbler`.
  Selection/local remote configuration does not create or remotely verify it.
- Initial Brabbler version: **0.1.0**; Pi SDK compatibility is recorded separately
  as **1.5.1**, including the guarded downstream policies below.
- The root manifest remains `private: true`. No npm registry publication or
  package-name ownership is assumed. There is no automatic update query,
  release-upload job or demo deployment.
- Two supported distribution definitions: declarative Nix/Home Manager and a
  standalone **prebuilt application archive**. The archive is extracted into an
  owned directory, then `npm ci --omit=dev` installs locked runtime dependencies.
  See [portable installation](portable-installation.md). It is not installed as
  a dependency of another npm project.

## Local public-history boundary

The existing checkout's `main` is the cleaned public lineage. The isolated
`brabbler-public` copy was staging, not a permanent publication mirror. The old
main is retained locally as `backup/private-main-before-public-release`; it and
older worktree branches remain private.

Start public features from the current cleaned `main`. Do not merge or blindly
rebase old private branches into it; replay only the reviewed feature changes.
Publish only the exact approved main/tag refs, never all branches, all tags or a
mirror. Do not publish the backup, old worktrees or private rewrite/evidence maps.
The one-time owner-approved history cutover does not change the normal feature
worktree/non-fast-forward integration policy.

Historical documents/examples can retain original commit IDs and local file
references that a public-only clone cannot resolve. They are historical records,
not new proof or authority. Never substitute current files for an unavailable
immutable snapshot; review any repair under the [notebook guide](review-notebooks.md).

## Build and verify

Production application builds run only inside isolated Nix builders. From the
selected source candidate:

```sh
nix build --no-write-lock-file --no-link --print-out-paths .#brabbler-tarball .#brabbler-sources
```

This produces an application output containing `brabbler-0.1.0.tgz` and a separate
source output containing `brabbler-0.1.0-third-party-sources.tar.gz`, its checksum
and `SOURCE-AVAILABILITY.json`. Publish the source asset alongside the application,
with the exact name/URL/checksum recorded inside the application. The main download
does not embed the large source archive. Nix recipients also have offline access
under the installed package's `share/brabbler/third-party-sources/`.

The Nix package extracts that same archive and adds its immutable module tree and
launcher wrapper; do not distribute those store paths as a portable installation.

The archive includes compiled assets, first-party source, the font input/notices
and a generated `npm-shrinkwrap.json` derived from the reviewed lock. It must not
contain credentials, agent/session state, tests, checkout dependencies or arbitrary
build output; cache/dev directories, build traces and diagnostics are excluded.
The archive contains `/third-party/NOTICE.md`, full legal texts, original legal
text collected from pinned build dependencies and a generated source locator/hash.
The application advertises the notice via `rel="license"`.

ELK remains enabled for normal Mermaid 12.3 layouts. Its source asset follows
upstream elkjs 0.12.1's declared ELK 0.12.1 release: immutable source trees,
editable Java/JS/Xtend/GWT, runtime source JARs and source-bearing adapters,
original build configuration/notices and input/tree hashes. No PR955 patches
apply. All twelve npm files match the elkjs release commit; publishing provenance
does not identify the worker's external compilation checkout or mutable Gradle
snapshot inputs. No legal certification, signature verification, independent
upstream compilation or bit-identical regeneration is claimed.
See [source access](../public/third-party/SOURCE-AVAILABILITY.md).

Inspect the **actual** archive and generated browser/server chunks,
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
The application pins modular Undici **8.12.4**. A parent/version-scoped override
also updates SDK 1.5.1's declared 8.12.3 dependency for the newer security fixes.
The 1.5.1 manifest, twelve child-environment targets/helper and complete 85-entry
standalone inventory are fingerprinted from actual upstream bytes. The
owner-approved exclusion of the standalone `dist/bundle/` tree and its own `pi` CLI link remains the support
boundary for Brabbler-owned installations, with a refreshed exact inventory. It is
not a claim that the new bundle retains the old vulnerabilities. The modular embedded
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

The November 10 dependency refresh (Node 24.22.2/shared Brotli 1.2.1, Pi 1.5.1,
Next 16.4.6 and Mermaid 12.3/ELK 0.12.1) passed complete Linux acceptance:
**534 core files / 4,638 tests / 14 suites**, **26 browser/terminal groups /
61 receipts**, and the genuine Home Manager VM. Separate fresh command times
were 304s / 350s / 99s, with preparation/execution envelopes recorded in the
[maintenance record](plans/archived/2026-11-10_dependency-refresh-plan.md).
A later narrow test-only ownership fix passed its complete changed-file/support
selection and current static checks; unchanged evidence is reused by input identity,
not relabelled as a fresh run. The exact archive also passed ordinary Linux
Node 24.22.2 installation, SDK policy, auth/restart/HTTP PTY and source/notice smoke.

Application SHA-256:
`444626e00d656a7c55856fd44cba887f0337e8e41bb2a441ac8850b585729ec1`.
Accompanying source SHA-256:
`d7213b6a8a2be8c8ca196180c4e50067c8472b035276d4a13e5ac48ee56a381d`.
The owner explicitly allowed this update's local integration without a new native
macOS archive smoke; that check remains mandatory **before publication**. No
publication, remote CI dispatch or installed-service activation occurred.

The November 7 dependency/Nix maintenance candidate, keeping Node **24.21.0**, passed
complete fresh Linux Nix acceptance: **529 core files / 4,495 tests / 14 suites**,
all **26 browser/terminal groups / 60 receipts**, and genuine Home Manager
deployment in **404 seconds**, including in-run realization. JSON API gzip
was supported there through the exact-version/source-guarded Next compressor
filter. The current Next 16.4.6 update retires that adapter in favour of native
compression; [dependency maintenance](dependencies.md) records the owner's
small-response behaviour decision and current verification status.
The [verified maintenance record](plans/archived/2026-11-07_runtime-maintenance-plan.md)
binds inputs, phase timings, failures and limits. This is not a new native-macOS
archive smoke, host activation, publication or resolution of the deferred Node
security update.

The earlier SDK-only 1.5.0 candidate passed complete Linux Nix acceptance: **528 core files /
4,483 tests**, all **26 browser/terminal groups / 60 receipts**, and the genuine
Home Manager deployment VM in **488 seconds**, including realization. The
[upgrade record](plans/archived/2026-11-07_pi-sdk-1.5-upgrade-plan.md) binds its exact
inputs and limits. It does not refresh the ordinary-runtime archive smoke below
or provide native macOS release evidence.

The earlier 0.1.0 application/source checkpoint builds in isolated Nix and passed an ordinary
Linux x86_64 / Node 24.21.0 smoke: runtime installation, native HTTP PTY, hidden
password setup, login/restart/rotation, header/no-auth boundaries, preserved notice
bytes, matching source checksum/version and actual HTTP notice/locator discovery.
Complete Linux Nix acceptance also passed for the recorded source candidate:
4,390 tests in 530 files, all 26 browser/terminal groups, and the genuine
Home Manager deployment VM. The owning plan records input identities and scope;
a status-only follow-up is not a new application-suite run. This is not evidence
for untested architectures or native macOS. No public release or hosted macOS
result is claimed.

Before publication:

1. Settle/review source and obtain full candidate acceptance plus final archive
   inventory/checksum, ordinary Linux smoke and native hosted macOS evidence.
2. Resolve applicable bundled-license/covered-source obligations and update exact
   advisory evidence; a clean npm lock audit is not a bundled-code clearance.
   Verify both application/source checksums, included notice bodies and the real
   published source URL. A proposed locator is not proof of remote availability.
3. Preserve the approved history cleanup: the early October 21 notebook plan is
   omitted at both historical filenames, and the internal hostname is replaced.
   Names, personal paths, other plans, messages and attribution were deliberately
   retained. The verified isolated candidate was installed as local `main` only
   after backing up the original; current-tree deletion alone would not suffice.
4. Preserve the local public-history boundary above. Any newly discovered private
   material needs its own review, not a broader automatic filter.
5. Separately approve repository creation/settings (including GitHub private
   vulnerability reporting), CI dispatch and each exact push/tag/release upload.
   [SECURITY.md](../SECURITY.md) describes reporting, not verified remote settings.

No package build, test pass, local merge or saved plan authorizes publication,
service activation, migration, remote access or cleanup. Existing installations
have a separate [rename/cutover boundary](brabbler-rename.md); this release work
does not perform their live migration.
