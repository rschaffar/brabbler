# Brabbler 0.1.0 — public release preparation

**Status: implementation authorized; in progress.** The owner approved local
implementation on this release worktree and requested durable public-safe planning
rules. Exact history filters, Git remote operations, publication, activation and
resource cleanup retain their separate approval gates. Selected implementation
checks have passed; full settled-candidate acceptance and native macOS verification
remain pending. No release or platform-support claim follows from this status.

## Goal

Prepare an independently versioned **Brabbler 0.1.0**: public source and a production
prebuilt application archive usable without Nix on Linux and macOS. Keep Nix as the
isolated production builder and existing acceptance authority. Preserve upstream
MIT attribution and the approved robot/synthetic screenshot. Make web authentication
on by default, portable, and explicitly bypassable at startup.

## Context and decisions

- Initial investigation: local main `0c239e29d96753e81a82ba9ad0f87ea8fa14a042`.
  Receiving branch `plan/public-release`, linked worktree `public-release`, is now
  rebased onto local main `3b73cbfd871ce42302444450a1ee742e390b109a`, including
  the remote-Markdown-image opt-in merge. Recheck the target before integration.
- Completed local-only remote change: upstream is `pi-web-origin`; `origin` is
  `https://github.com/rschaffar/brabbler.git`. No Git remote has been contacted.
  New-origin tracking, repository creation/settings and publication are not done.
- Owner selected source plus tarball, **not npm registry publication**. After the
  first consumer-install spike exposed npm's root-only override behavior, the
  owner selected extraction plus root `npm ci --omit=dev`, not installation as
  another project's dependency. No consumer-side application build is required. Retain
  `private: true`. Version Brabbler independently; document Pi SDK **1.4.0**
  separately rather than embedding its version into Brabbler's SemVer.
- Remove automatic demo deployment entirely; retain demo source unless a reviewed
  privacy or licensing disposition says otherwise.
- Keep the approved robot and current synthetic README screenshot. No redesign or
  new capture is required. Nix installation examples remain declarative.
- Keep the owner's long-term email and normal Git attribution. An email address
  is not a credential. Do not change authorship merely to anonymize provenance.
- Prepare a **separate sanitized publication-history copy**, preserving the
  original local history, worktrees and diagnostic evidence privately. Show exact
  omissions/replacements to the owner before filtering. Omission of the archived
  rename plan and its former paths is proposed; the current guide also needs a
  neutral deployment example. Do not reproduce private identifiers in this plan.
- Authentication defaults on. An explicit **`--no-auth`** flag may allow any bind
  address and must print a prominent warning. Default bind remains loopback.
- Stored-password setup must work on Linux and macOS. The owner does not require
  auth-store directory pinning against a hostile same-user process; this changes
  that specific threat model, not generic file/path or web-request authorization.
- The owner has no Mac. Propose GitHub-hosted macOS CI for the artifact smoke
  check, not an owner-machine handoff. Runner availability/architecture, permissions
  and any cost must be checked before a separately approved run.
- Use GitHub private vulnerability reporting, with a short `SECURITY.md` and a
  separately authorized enablement/verification gate. An additional public email
  address is not required. No automatic public advisory/release is implied.

## Plan Relationship

[Release](../release.md), [Dependencies](../dependencies.md),
[Testing](../testing.md), [Feature contracts](../feature-internals.md),
[Browser SSH](../browser-ssh-agent.md), and [Branding](../branding.md) own maintained
behavior. This plan proposes deliberate updates, not exceptions hidden in a plan.
The CLI-auth and branding archives remain historical evidence. Active account,
CLI-backend, fullscreen and performance plans retain their existing scope; this
release does not reopen their backlogs or certify live-provider behavior.

## Evidence already gathered

- Privacy review at the initial candidate inventoried **1,471 reachable commits**,
  **2,298 historical paths** and **8,883 reachable blob identities**. Targeted
  privacy-pattern checks covered **1,343 historical docs/demo text blobs**.
  Findings concern operational identifiers, private-work context and local evidence
  paths; no underlying private-project source payload was established. Exact
  locations/values are summarized privately outside the tracked repository.
- Gitleaks **8.30.1**, explicit built-in defaults, no repository ignore file and
  ignored inline allow comments: the merge-inclusive main scan processed **1,467
  commits / 48.89 MB**. Its two findings are the same documentation-prose false
  positive in the introducing commit and merge. Scanner exit 1 reflects findings;
  no confirmed credential was identified. This is not clearance of every binary
  object or every possible secret format.
- Main then advanced by nine commits. The feature was rebased onto `dee459bb`;
  a merge-inclusive scan of that exact incremental range processed all **nine**,
  **376.62 KB**, exit 0, zero findings. Targeted changed-doc checks add one local
  evidence-path location to the privacy inventory. That main tip had **1,480**
  reachable commits; the later Markdown-image change/merge adds two. The final
  delta still needs scanning. Tags/unmerged refs are not cleared for publication.
- Fresh public lock-only npm audits on **2026-10-28** completed for root/demo,
  each full and `--omit=dev`: root reports **two affected package records**,
  representing **eight Undici advisories**, highest severity high; demo reports
  none. No lifecycle scripts or installs ran. Public requests used isolated
  environment/config/cache, not operator credentials.
- Root SDK 1.4.0 pins nested Undici **8.10.2**; direct Undici **8.12.2** is fixed
  for the eight reported ranges. Five advisory IDs are additional to the current
  guide. Earlier braces/sprintf-js advisories were withdrawn, not fixed by upgrades.
  Current latest SDK was still 1.4.0 at the query. Fixed Undici 8.12.2/8.12.3 are
  available; npm's proposed SDK downgrade is not an acceptable automatic fix.
- Exact SHA-256 lock identities (unchanged by the nine-commit main advance):
  - root: `a51d7cb3e4cd6052c9ace4fb8801a5c22a6781a0468849fc11e265377e9658b8`
  - demo: `c9ebe26c066d8440c33c2a911ecf69947ec20105b40984cb7c7bd3bc66cf9ab3`
- The original raw scanner/audit reports were temporary and did not survive a
  restart. Recorded tool results survive in the saved sessions; a private persistent
  summary was reconstructed from them, explicitly not as original raw evidence.
  Refresh final-candidate scans/audits and retain their raw output durably before
  publication. The counts above describe observed prior runs, not reruns.
- Earlier application acceptance remains evidence for its recorded inputs only.
  Later selected checks and the Linux installation spike are recorded below;
  neither supplies full settled-candidate or native macOS evidence. Installed
  checkout dependencies were not used as lock evidence.

## Current implementation checkpoint

Portable/default-on authentication, explicit warned bypass, its fixtures and
public-safe content instructions are implemented. Focused Nix core/static checks
passed **71 tests across eight files**, 29 exporter contracts, genuine typegen/tsc
and lint (seven existing warnings), with four requested core workers. Command wall
was **43 seconds**, including realization; preparation/test-only intervals are not
separately recorded here. Immutable source digest:
`9c8c96c549ee5771bf42fefa185287ac671259957e00572499059704d0d62ac4`.
The receiving session retains the exact command/log and run identity privately.
This is selected-file evidence, not full application, deployment or macOS proof.
Independent source review found a Home Manager environment-precedence issue; the
implementation now enforces mandatory policy after runtime-file processing, with
an adversarial runtime-file value included for the later genuine VM check.

The owner separately selected exclusion of SDK standalone bundles from Brabbler's
owned installation, alongside fixed modular Undici resolution. Exact-byte exclusion,
fixed modular resolution, ownership preflight before either SDK writer, and the
read-only startup checks are now implemented. Focused Nix/static verification
passed **39 tests in six files**, including all existing command-environment guard
owners, new runtime-policy refusals and archive/lifecycle checks, in **82 seconds
command wall** including realization. Source digest:
`61d431e64aa582063c3d55001d42638c3c6951e1f1ba147aae6f0c28e177ec73`.
This is not full composed acceptance. A clean lock audit alone is not artifact
remediation proof.

**Visible correction:** earlier discussion treated ELK as an unused optional
layout in Brabbler. Exact Mermaid **12.2.0** source and official v12 documentation
show `layout: elk` is the default; the wrapper inherits it. The low-impact-removal
recommendation is retracted. The owner explicitly selected keeping ELK and finishing
notices/corresponding-source access. No engine removal was implemented.

The source set now follows authoritative elkjs **0.9.3** release metadata:
**ELK 0.9.1 + seven PR955 content patches**, all exactly applied. It includes
editable Java/JS/GWT, runtime source JARs, build configuration and original legal
material. Upstream's external build checkout is unrecorded; no positive mismatch
or additional change was found. An earlier reviewer requirement for an explicitly
exhaustive upstream certificate was a stronger agent-selected standard and is
retracted, not imposed as a new release gate. The traceability limitation remains
visible; no independent engine compilation or legal certification is claimed.

A separate Nix `brabbler-sources` output and the application's embedded source
locator/SHA-256 are implemented, with offline Nix access. Original build-dependency
legal text is collected without executing it; source/notice access is exercised by
the exact-artifact smoke. Focused Nix/static checks passed **12 tests in two files**
and **32 exporter contracts**, **40 seconds command wall**, source digest
`e30777bb0179082db8a81ed4207582aa0f69911456be431748ac43e1497ddf0a`.
Independent review found no remaining SDK/lifecycle or new packaging/exporter
blockers. A test-private Nix counterexample that ignored a nonempty source-version
mismatch reached the named missing-exception runtime assertion; the normal owner
passed. Fault material never replaced application source. Full composed Nix and
native macOS acceptance remain pending.

The first notice/source archive inventory passed all notice-byte/source-checksum
checks: **923 package locations / 420 legal bodies**, with no tests, state or
checkout modules. It also found build-only Next traces; those are now explicitly
excluded along with diagnostics. The rebuilt application/source pair passed the
ordinary Linux x86_64 / Node 24.21.0 smoke, including all notice bytes, matching
source archive and installed ELK version, actual HTTP notice/locator access,
`rel=license`, and absence of those build-only artifacts. Application SHA-256:
`298870166049cee3df6eda3bcec0ac28e8c8b819cbdb4ecf8718b9a34c53d9d8`;
source SHA-256:
`273c8741aa391629884ccaaa8e95e8a159c7537ffa04e0d211ba4030f57e98bc`.
The command took **186 seconds** including container setup/teardown; the smoke's
reported interval was **14.214 seconds**. Container preparation and cleanup were
not individually timed. This is not full Nix or native macOS acceptance.

The recorded root/demo full/runtime lock audits all returned exit 0, **zero
findings**. Their lock identities still match the unchanged dependency graphs:
root `9ce2e04f8d75aac6f999b2ea04b9f6da97d1691c14a9d9699b6f773ab05d60cf`;
demo `d5cba47655563f060e0caa4fd7dc16e8ee675dac3695cbc6ca48cd21822a2dcd`.
Raw results are retained privately. This does not alone clear embedded code.

## Architecture

### Authentication proposal

Use existing Node filesystem/crypto APIs, without a new native addon. Retain the
versioned salted scrypt record, independent random cookie-signing key, private
owned directories/files, bounded reads/KDF work, generic errors, hidden confirmed
TTY input, cooperating-writer lock and exclusive staging/atomic publication.
Preserve initial-setup refusal to overwrite, explicit replacement, cookie
revocation, and Linux record-format compatibility.

Replace only the auth-store `/proc/self/fd` dependency with portable path-based
operations and ownership/type/mode/no-follow checks. Document the changed
same-user ancestor-substitution threat assumption and distinguish atomic visibility
from crash durability. Do not silently repair permissions or turn failed reads
into absent credentials. Check macOS temporary-path aliases in real execution.
Record this changed contract and defaults in an ADR before implementation.

Proposed policy matrix, to be reviewed with the implementation:

| Launch policy | Expected admission |
| --- | --- |
| Default; no credentials | Locked/setup-needed, no first-visitor browser enrollment |
| Default; valid stored credentials | Password login; record persists across restart |
| Default; explicit environment password only | Existing environment mode, with documented restart revocation |
| Default; corrupt/unsafe/conflicting credentials or invalid flags | Locked/error, never implicit no-auth |
| Explicit `--no-auth` | No password check; prominent warning on any bind; credentials remain untouched |
| Explicit mandatory-auth policy plus `--no-auth` | Configuration error, not silent precedence |

An explicit bypass must not require deleting valid credentials. Its exact handling
of already-invalid stored state and propagation through maintained dev/start/service
entry points is a design check, not an excuse for accidental fail-open behavior.
Home Manager should default to required authentication; an explicit declarative
opt-out must be distinguishable from an absent setting. Existing `requireAuth=false`
and `BRABBLER_REQUIRE_AUTH=0` behavior needs an explicit compatibility disposition.

No-auth does **not** disable Host/Origin/CSRF or the pre-Next request-header guard,
file/project authorization, Git policy, or plugin approvals. Do not mint an
artificial authenticated cookie: browser SSH key management still needs genuine
signed login authority and remains unavailable without it. No generic path-security
or descriptor-pinned Git cleanup change belongs in this task.

### Portable artifact proposal

Expose a clean production `.tgz` from an isolated Nix build, rather than copying a
Nix wrapper or dependency symlink. Consumers extract an owned application directory
and run root `npm ci --omit=dev`; consumer-side Next builds are not part of installation. Retain the guarded launcher,
SDK postinstall policy, first-party source and required notices. Inspect build-root
and Nix-store references; distinguish inert metadata from required runtime paths.

Generate the archive's npm shrinkwrap from the reviewed lock in the builder, then
test actual production resolution. npm ignores a dependency package's overrides,
so do not install this archive as another project's dependency. Native node-pty and other platform assets must resolve for the consumer,
not come from the builder's platform. Packaging success is not portability proof.

## Plan

### P0 — approve the bounded design and privacy inventory

- [x] Record owner choices, local remote configuration, investigation identities,
  findings and non-goals in this draft; verify remote URLs locally, no network.
- [x] Owner approved local implementation, portable default-on authentication and
  the warned any-bind bypass. Record public-safe content rules in `AGENTS.md` and
  the planning skill; verify their wording/diff before committing. Exact privacy
  filters and release-risk decisions are not implicitly approved.
- [ ] Present the exact private publication-omission/replacement inventory, including
  former paths for omitted documents and any commit-message substitutions. Obtain
  specific approval; no blanket history rewriting or deletion of original evidence.
- [ ] Select an available GitHub-hosted macOS runner and its explicit architecture;
  verify access, permissions and any cost. Expected initial platforms are Linux
  x86_64 and that tested Mac architecture; no Intel/ARM support claim follows from
  another architecture's test. The owner need not supply hardware. A short artifact
  smoke check, not a duplicate full Linux VM inventory, is the Mac platform gate.

### P1 — portable, default-on authentication

- [x] Record the revised threat/default/bypass contract in ADR 0037 and update
  maintained authentication owners; focused checks and source review confirm no
  generic path-security change.
- [ ] Implement portable credential storage in `bin/web-auth-store.js`, preserving
  existing credential format, private modes, bounded errors, exclusive setup,
  rotation and failure semantics. Exercise real writes, concurrency/publication
  faults, unsafe files, cancellation and post-KDF rotation races.
- [ ] Add `--no-auth` and consistent policy in the launcher/auth state and maintained
  npm entry points. Verify protected default, setup-needed state, any-bind warning,
  credential preservation, invalid/conflicting settings and stronger required mode.
- [ ] Update Home Manager's default and explicit opt-out mapping; adapt synthetic
  fixtures to select their intended mode explicitly, not restore unsafe defaults.
- [ ] Verify focused owners: `lib/brabbler-options.test.mjs`,
  `lib/web-auth-store.test.mjs`, `lib/web-auth-proxy.test.mjs`,
  `app/api/web-auth/route.test.mjs`, request-security/header-guard tests,
  browser-SSH route tests and the installed auth/PTY fixtures. Preserve genuine
  browser-SSH cookie requirements, rate limits and existing revocation tests.

### P2 — current advisories and redistribution obligations

- [x] Update `docs/dependencies.md` with all eight current SDK/Undici advisory IDs,
  exact scopes, the two withdrawals and bounded embedded-path observations.
- [x] Review the smallest fixed-Undici remediation, including SDK prebundled copies;
  prefer a coordinated fixed SDK when available. If evaluating a parent-scoped
  override, verify modular/bundled coverage, patch fingerprints, proxy/fetch/SDK
  behavior and lock/Nix-cache changes. No downgrade or forced audit fix.
- [x] Bring unresolved advisory exposure back for owner disposition before release:
  validated fix, wait, or explicit scoped risk acceptance. An override/audit result
  alone must not be called whole-artifact remediation.
- [x] Resolve `pi-usage` adaptation provenance/full-notice requirements; inspect
  actual shipped font notices, including Noto and the patched terminal font.
- [x] Inventory actual redistributed code/assets and required license/NOTICE/source
  material, including relevant MPL/EPL/LGPL obligations. Retain original MIT,
  bundled algorithm/icon notices and upstream credit. Ship notices in the actual
  tarball, not only in a development guide.

### P3 — isolated portable-tarball spike, then packaging

- [x] Extend `nix/package.nix`/flake outputs with an inspectable `.tgz` output;
  inspect its inventory for built assets, launcher, source and notices, and absence
  of credentials/state, test support, writable dependencies and checkout artifacts.
- [x] Prove the coherent extraction/root-install spike in a clean non-Nix Linux
  x86_64 container with Node 24.21.0: archive checksum
  `045d2fa92e999cc737a6e9bb12b5a8d3e6d8d383cfceefc3b3cd2cfd5e4ace38`,
  image digest `sha256:9af606de2e947cfb3f276633b7c5130c4cd22365aa10f5a647b7675d5cfce0c0`.
  Passed installation, SDK policies, hidden setup/login, HTTP PTY, restart,
  rotation/revocation, header guard and warned no-auth/SSH/origin boundaries in
  **14 seconds command wall / 13.545 seconds smoke interval**. The original
  dependency-install refusal and a fixture cwd-authorization error were retained
  before fixes; neither was an unchanged retry. This preliminary archive predates
  final notices/source changes and is not final-candidate acceptance.
- [x] Repeat ordinary Linux smoke against the final settled archive/checksum and
  retain its exact script/source identity and dependency resolution.
- [x] Prove production install/postinstall, SDK guard, startup/static assets,
  password setup/login/rotation/restart, no-auth warning and a genuine terminal.
  Use synthetic state/providers, not personal credentials or paid turns.
- [ ] Run the same concise artifact smoke contract on real macOS: install/start,
  hidden TTY setup/replace, permissions, login/restart/revocation and native PTY.
  Record artifact checksum, resolved dependency versions and Node/OS/architecture.
  Use the selected GitHub-hosted macOS runner; transfer the exact isolated-build
  tarball and verify its checksum before installation. Keep this job test-only,
  with no deployment/publication authority. Do not upload unsanitized history just
  to enable CI; coordinate the approved public-candidate preparation and obtain
  approval for the exact remote workflow run.
- [ ] Stop after the first coherent portable spike if paths/native resolution or
  dependency installation require a material redesign; present evidence/options
  before adding a container/release-runner platform. Preserve the isolated-build
  boundary and existing full Nix acceptance; these are additional artifact tests.

### P4 — release identity, public docs and no demo deployment

- [x] Reset root/demo manifests and their matching lock metadata to **0.1.0**;
  update only current-facing mock version/toolchain claims, not historical records
  or unrelated package versions. Maintain the Nix dependency hash deliberately.
- [x] Add owned repository/homepage/issue metadata; retain `private: true` and
  manual update behavior. Do not add automatic update queries or registry release
  scripts as incidental polish.
- [x] Remove `.github/workflows/demo-pages.yml`; inspect remaining workflows for
  implicit publication and inherited targets. Verify no remaining demo deploy job
  or push-triggered deployment path. Do not delete the demo merely to remove deploy.
- [x] Apply focused README/guide cleanup: self-contained contribution rules,
  prerequisites/platform support, a user/contributor/history docs index, accurate
  terminal repair/install guidance and concise authentication instructions. Keep
  Nix examples declarative and preserve the owner's specific onboarding exclusions.
- [ ] Apply the approved current-tree privacy cleanup, including the proposed
  archived-plan omission and updated index/link references. Do not relabel old
  acceptance or create replacement evidence for omitted records.
- [x] Add `SECURITY.md` describing private GitHub reporting; explain that public
  issues are not the place for credentials or exploit details. Keep enablement as
  a separately authorized repository-settings gate until verified.

### P5 — settled candidate acceptance and local integration

- [ ] Review the composed diff independently. Rebase onto current **local main**,
  reassess changed inputs and record exact candidate/locks/artifact identities.
- [ ] Run focused checks while editing, then complete acceptance using
  `nix run .#test -- all --workers 4 --jobs 12` when admitted, or documented 4/4
  when resources/concurrent work require it. Preserve all core/static/plugin,
  browser/terminal and genuine Home Manager VM coverage and failure diagnostics.
- [ ] Record command/preparation/test intervals separately, requested/effective
  widths, source identity and retained artifacts. Reuse unchanged input-bound
  evidence honestly; do not claim an old run tested a new input.
- [ ] Refresh the secret/privacy review and advisories for the final candidate
  and artifact. Include new commits/merge resolutions and changed images/notices.
- [ ] Obtain exact-state approval for unsigned **non-fast-forward** integration
  into local main; verify resulting parents/tree. Cleanup remains separately gated.

### P6 — separately approved sanitized publication candidate

- [ ] From the accepted source candidate, propose an exact standalone publication
  repository, starting ref, omission/replacement filters and metadata treatment.
  Preserve the private original and use no destructive operation on its refs.
- [ ] After specific approval, sanitize only that isolated public-history copy;
  retain the commit mapping privately. Do not publish archive tags, backups,
  unmerged branches, diagnostic refs or private audit reports.
- [ ] Verify both current files and reachable public history against the approved
  inventory, scan merge-inclusive history, inspect retained images/metadata and
  confirm notices/credit. A cleanup commit alone is insufficient.
- [ ] Verify the public candidate's application inputs against the accepted build.
  If filters change application inputs, reassess/rerun the affected acceptance.
  Bind release evidence to the sanitized source/artifact, not only private IDs.
- [ ] Agree future canonical-development/cutover handling before publication: never
  merge unsanitized private ancestry back into public main. Do not silently start
  a permanent publication-mirror maintenance scheme.
- [ ] Present exact repository settings/actions, public commit, tag **v0.1.0**,
  artifact/checksum and release text for separate approval. No repository creation,
  settings change, workflow dispatch, push, tag publication, release upload or npm
  publication is authorized by this plan. Never push all refs/tags or use a mirror.

## Unknowns and stop conditions

- The owner has reviewed categories, but the exact privacy-filter inventory is
  not approved. Omission alone must not leave historical copies or broken links.
- The proposed hosted macOS runner/architecture is not yet verified; the owner
  has no Mac. File-based Node code is not evidence for native PTY/TTY/filesystem
  behavior. Keep the hosted check small and do not claim untested architectures.
- Final no-auth transport/conflicts and declarative service opt-out require review;
  bypassing web login must not grant browser-SSH authentication authority.
- Fixed modular Undici does not prove SDK bundle remediation. Escalate unresolved
  release risk instead of hiding warnings or broadening overrides.
- Actual artifact licensing and dependency resolution remain unverified. Stop for
  an incompatible license/source obligation or a failed portability spike.
- The public repository and its private-reporting setting are not remotely verified.

## Non-Goals

Npm registry publication/name acquisition, upstream fetch/rebase, paid/live-provider
certification, Windows support, all-Mac/all-Linux-architecture claims, demo hosting,
installed-service migration/activation, unrelated feature/performance work, branding
redesign, deleting private historical evidence, or publishing old tags/branches.

## Rollback / Recovery

Keep the existing credential format and private backups; never delete credentials
as an auth opt-out or recovery mechanism. Switching back from no-auth re-enables
normal credential checks. A default-policy change needs explicit operator guidance;
no deployment/restart is implicit. Retain failed artifacts/logs under existing
bounded cleanup policy. Sanitization runs only in a separate approved copy; abandon
that candidate rather than rewrite or reset the original to recover. Remote
publication, once approved, may be difficult to retract; never treat later deletion
as proof that disclosed history or downloaded artifacts have disappeared.

## Completion Checklist

- [ ] Owner approves the plan and exact privacy omissions/replacements; outstanding
  platform, threat/default and advisory decisions have explicit dispositions.
- [ ] Portable default-on authentication and intentional any-bind bypass are
  implemented and verified without weakening unrelated authorization boundaries.
- [ ] 0.1.0 identity/docs/notices are coherent; automatic demo deployment is absent;
  approved branding remains; Nix guidance is declarative.
- [ ] Exact tarball passes non-Nix Linux and real-macOS smoke checks; actual platform
  scope, dependency inventory, notices and checksum are recorded.
- [ ] Full settled-candidate Nix acceptance passes; exact-state local integration
  has its own approval/receipt. No old evidence is represented as a new run.
- [ ] Sanitized public history/artifact pass review, and future-development handling
  is agreed. Repository/private-reporting enablement and each remote release action
  remain explicitly approved handoff gates until executed and verified.
- [ ] Durable decisions and current operational instructions live in their maintained
  owners; archive this plan only when its obligations are complete or reassigned.
