# Brabbler 0.1.0 — public release preparation

**Status: proposed; awaiting owner review before implementation.** Investigation,
local remote configuration and this plan are authorized. This document does not
approve implementation, history filtering, Git remote operations, publication or
activation.

## Goal

Prepare an independently versioned **Brabbler 0.1.0**: public source and a production
npm-installable tarball usable without Nix on Linux and macOS. Keep Nix as the
isolated production builder and existing acceptance authority. Preserve upstream
MIT attribution and the approved robot/synthetic screenshot. Make web authentication
on by default, portable, and explicitly bypassable at startup.

## Context and decisions

- Initial investigation: local main `0c239e29d96753e81a82ba9ad0f87ea8fa14a042`.
  Receiving branch `plan/public-release`, linked worktree `public-release`, is now
  rebased onto local main `dee459bb1909ef7808407e6bf15d0cad9af68cdd`.
- Completed local-only remote change: upstream is `pi-web-origin`; `origin` is
  `https://github.com/rschaffar/brabbler.git`. No Git remote has been contacted.
  New-origin tracking, repository creation/settings and publication are not done.
- Owner selected source plus tarball, **not npm registry publication**. Retain
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
  evidence-path location to the privacy inventory. Current main has **1,480**
  reachable commits. Tags/unmerged refs are not cleared for publication.
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
  No fresh full acceptance, portable installation or native macOS test was run
  for this plan. Installed checkout dependencies were not used as lock evidence.

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
Nix wrapper or dependency symlink. Consumers install the built app with Node/npm;
consumer-side Next builds are not part of installation. Retain the guarded launcher,
SDK postinstall policy, first-party source and required notices. Inspect build-root
and Nix-store references; distinguish inert metadata from required runtime paths.

An npm install does not inherit the checkout's package-lock. Test actual resolved
production dependencies and review whether tighter pins or an npm shrinkwrap is
needed. Native node-pty and other platform assets must resolve for the consumer,
not come from the builder's platform. Packaging success is not portability proof.

## Plan

### P0 — approve the bounded design and privacy inventory

- [x] Record owner choices, local remote configuration, investigation identities,
  findings and non-goals in this draft; verify remote URLs locally, no network.
- [ ] Obtain owner approval for this plan's implementation scope, authentication
  proposal and warning/precedence behavior. Resolve any requested changes first.
- [ ] Present the exact private publication-omission/replacement inventory, including
  former paths for omitted documents and any commit-message substitutions. Obtain
  specific approval; no blanket history rewriting or deletion of original evidence.
- [ ] Select native macOS architecture/test access. Expected initial platforms are
  Linux x86_64 and a specifically tested Mac architecture; no Intel/ARM support
  claim follows from another architecture's test. A short runnable smoke check,
  not a duplicate full Linux VM inventory, is sufficient for the Mac platform gate.

### P1 — portable, default-on authentication

- [ ] Record the revised threat/default/bypass contract in `docs/adr/` and update
  maintained authentication owners; confirm the scope excludes generic path security.
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

- [ ] Update `docs/dependencies.md` with all eight current SDK/Undici advisory IDs,
  exact scopes, the two withdrawals and bounded embedded-path observations.
- [ ] Review the smallest fixed-Undici remediation, including SDK prebundled copies;
  prefer a coordinated fixed SDK when available. If evaluating a parent-scoped
  override, verify modular/bundled coverage, patch fingerprints, proxy/fetch/SDK
  behavior and lock/Nix-cache changes. No downgrade or forced audit fix.
- [ ] Bring unresolved advisory exposure back for owner disposition before release:
  validated fix, wait, or explicit scoped risk acceptance. An override/audit result
  alone must not be called whole-artifact remediation.
- [ ] Resolve `pi-usage` adaptation provenance/full-notice requirements; inspect
  actual shipped font notices, including Noto and the patched terminal font.
- [ ] Inventory actual redistributed code/assets and required license/NOTICE/source
  material, including relevant MPL/EPL/LGPL obligations. Retain original MIT,
  bundled algorithm/icon notices and upstream credit. Ship notices in the actual
  tarball, not only in a development guide.

### P3 — isolated portable-tarball spike, then packaging

- [ ] Extend `nix/package.nix`/flake outputs with an inspectable `.tgz` output;
  inspect its inventory for built assets, launcher, source and notices, and absence
  of credentials/state, test support, writable dependencies and checkout artifacts.
- [ ] Install that exact tarball into a clean non-Nix Linux Node 24 environment,
  with only documented tools. Prove no runtime dependency on the builder's
  `/nix/store`, checkout, development dependencies or ambient agent data.
- [ ] Prove production install/postinstall, SDK guard, startup/static assets,
  password setup/login/rotation/restart, no-auth warning and a genuine terminal.
  Use synthetic state/providers, not personal credentials or paid turns.
- [ ] Run the same concise artifact smoke contract on real macOS: install/start,
  hidden TTY setup/replace, permissions, login/restart/revocation and native PTY.
  Record artifact checksum, resolved dependency versions and Node/OS/architecture.
  Select the runner/handoff before execution; remote workflow runs need approval.
- [ ] Stop after the first coherent portable spike if paths/native resolution or
  dependency installation require a material redesign; present evidence/options
  before adding a container/release-runner platform. Preserve the isolated-build
  boundary and existing full Nix acceptance; these are additional artifact tests.

### P4 — release identity, public docs and no demo deployment

- [ ] Reset root/demo manifests and their matching lock metadata to **0.1.0**;
  update only current-facing mock version/toolchain claims, not historical records
  or unrelated package versions. Maintain the Nix dependency hash deliberately.
- [ ] Add owned repository/homepage/issue metadata; retain `private: true` and
  manual update behavior. Do not add automatic update queries or registry release
  scripts as incidental polish.
- [ ] Remove `.github/workflows/demo-pages.yml`; inspect remaining workflows for
  implicit publication and inherited targets. Verify no remaining demo deploy job
  or push-triggered deployment path. Do not delete the demo merely to remove deploy.
- [ ] Apply focused README/guide cleanup: self-contained contribution rules,
  prerequisites/platform support, a user/contributor/history docs index, accurate
  terminal repair/install guidance and concise authentication instructions. Keep
  Nix examples declarative and preserve the owner's specific onboarding exclusions.
- [ ] Apply the approved current-tree privacy cleanup, including the proposed
  archived-plan omission and updated index/link references. Do not relabel old
  acceptance or create replacement evidence for omitted records.
- [ ] Add `SECURITY.md` describing private GitHub reporting; explain that public
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
- Native macOS access/architecture remains unselected. File-based Node code is
  not evidence for native PTY/TTY/filesystem behavior; keep the smoke check small.
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
