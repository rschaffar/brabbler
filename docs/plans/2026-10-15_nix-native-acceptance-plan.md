# Nix-native package and VM acceptance

## Goal

Replace the split npm/offline-dev-server verification paths with two Nix-owned test levels: fast sandboxed core checks and complete end-to-end acceptance of the actual installed production package in one NixOS VM. Nix realizes prerequisites automatically. There is no preparation requirement, non-Nix fallback, development-server acceptance, or host-service contact.

## Context and authority

The user approved the final design and implementation in this conversation (not an operation receipt). On 2026-10-15 they explicitly approved replacing the release-only production-build rule with isolated Nix builder package builds, while prohibiting working-checkout builds. Worktree: `feat/nix-native-acceptance`, based on local `rst-main` at `7317427e07662c08d3efb753a012f3bea8f7e514`. No deployment, remote publication, integration, or resource cleanup is authorized by this plan.

## Plan Relationship

Supersedes the testing/dependency mechanisms in ADR 0020, the completed Nix development/service plan and development-verification plan; preserve safe source export, exact-input reporting, credential isolation, substantive assertions, and diagnostic honesty. Current operational behavior belongs in `docs/testing.md`, `e2e/README.md`, `README.md` and focused plugin guides. Record the new decision in an ADR rather than extending AGENTS.md with implementation details.

## Architecture

- One manifest/toolchain/platform-keyed built dependency output, shared by core checks, the production package and test tooling.
- Separate filtered application and test inputs so documentation/test-only changes do not rebuild the package.
- Core/static checks in Nix sandboxes; all required plugin/SDK selections accounted for.
- One native-architecture NixOS guest, real pinned Home Manager module, ordinary user, systemd user service, real package and pinned headless Chromium. Explicit complete E2E group inventory, with sequential isolated fixture roots per group and one guest boot per acceptance invocation.
- Guest has no external network and no host credentials/state. Deterministic fixture providers use normal runtime interfaces.
- `nix flake check -L` for cacheable complete acceptance. A thin `nix run .#test` entry point exports/verifies current source (including untracked helpers), realizes the same definitions, and executes fresh focused core or VM runs with retained diagnostics.

## Non-Goals

Deployment or installed-service changes, remote Git/publication, host permission-gate authority, multi-node VM topology, browser/viewport-specific VMs, new generic orchestration framework, unrelated application behavior changes, and historical artifact cleanup.

Bounded exception: after production acceptance exposed a Git Explorer collapse/reopen reader-position bug, the user explicitly approved fixing it here, adding regression coverage, and continuing full acceptance without weakening assertions or deadlines.

## Plan

- [x] Inspect production/package, VM driver and fixture contracts; package/native/browser proofs and the final closure-only real-HM/native-PTY/restart proof passed.
- [x] Factor dependency and source inputs; verified controlled Nix graph mutations for docs, tests, application, manifests and synthetic `.env` exclusions; evidence below.
- [x] Make the production package consume the built dependency output and build only in Nix; isolated package builds and packaged Markdown/native-PTY VM proofs passed (not full acceptance).
- [x] Add real Home Manager/NixOS VM acceptance, non-root service control, no-external-network fixtures, and artifact collection.
- [x] Migrate existing browser/terminal assertions to the packaged systemd service; all 21 required groups, including SDK/plugin integration and real terminal coverage, passed.
- [x] Add the fresh Nix test entry point and parser/contracts; full sandbox core acceptance passed, including exporter/parser/service/lifecycle contracts. Legacy entrypoints and fallbacks removed.
- [x] Replace CI recipes with the same Nix checks; update owned docs and ADR, preserving Git and credential boundaries. GitHub execution remains unverified.
- [x] Fix the separately approved production reader-position lifecycle/offset defect, preserving the existing browser assertion and adding controlled callback regressions; original-code red and fixed-code focused core/VM evidence below.
- [x] Run focused regressions and source/input identity checks, then complete core and full VM acceptance on the rebased stable candidate; exact evidence below.
- [x] Obtain independent safety review, address findings and commit reviewable history. Completion intent is local integration; exact-state merge and resource cleanup remain separate tool approvals.

## Unknowns and risks

- Complete native x86_64-linux/KVM acceptance passed with the closure-only guest store and full group inventory. Native aarch64-linux execution and GitHub CI execution remain unverified; no fallback environment is claimed.
- Migrated fixtures consume the installed package/service, not development servers or checkout runtime imports. Production-only lifecycle failures must be diagnosed from retained evidence, not hidden by retries, deadline changes or weaker assertions.
- Real Home Manager is pinned against the existing nixpkgs input. VM execution requires native Linux virtualisation; fail explicitly rather than silently falling back to host acceptance.
- Keep failure logs/traces accessible through owned driver runs without widening nixbld/private directories. Test artifacts contain synthetic data only.

## Historical implementation evidence

- Production package built only in Nix: `/tmp/pi-web-nix-acceptance-package-GQq5Ls.log` (earlier manifest). Pre-reader-fix application output `/nix/store/3y9r3h54dh3gvm5ja3724mrpw6dr0i7n-pi-web-0.9.3` was exercised by packaged Markdown and native terminal proofs.
- Initial real Home Manager/user-service smoke passed (`/tmp/pi-web-nix-acceptance-vm-proof-XYaa6B.log`, 11.7s test script). Markdown passed with restart/persistence (`/tmp/pi-web-nix-acceptance-markdown-BzBxnt.log`, 268s including realization, 170s VM script); native terminal passed (`/tmp/pi-web-nix-acceptance-terminal-EW0aZc.log`, 61s command, 55s VM script). These used the earlier 8GiB/four-vCPU guest, before closure-only store isolation.
- Review corrected fresh-core host execution to a per-run-nonce Nix sandbox check; focused exporter/typegen/typecheck/lint plus 63 core contracts passed in 44s (`/tmp/pi-web-nix-acceptance-sandbox-core-ki8AUS.log`, outer source digest `4d39e8226f2fd2b949bd4de464ba4c43681a6559b0a43073e99248d23a935f6b`).
- Input graph evaluation passed without building variants: `/tmp/pi-web-nix-inputs-bg2_6kqq/result.json` and `/tmp/pi-web-nix-input-separation-hyfMRG.log`; verified export digest `935819621c916a2e48c29daf9961b8e33794f8a7ba1679eab855313cce07508f`. Docs/tests preserve package and dependency derivations; app edits preserve dependencies; manifest edits change both; synthetic `.env` input is excluded from application/test filesets. The first experiment had a JSON-v4 parser error, not an application/build failure (`/tmp/pi-web-nix-input-separation.log`).
- Preserved failures: Markdown initially exposed launcher SIGTERM exit 143 and a cleanup identity-array bug; fixed in the real module/wrapper. Closure-image proof exposed Home Manager's writable-store metadata requirement (`/tmp/pi-web-nix-acceptance-closure-vm-A6jm0B.log`, root `/tmp/pwv-klbA9A`, retained bulk). Add a guest-only tmpfs store overlay and full closure registration, not a host-store mount. Full core attempt `/tmp/pi-web-nix-acceptance-full-core-nGzqHE.log` failed the stale removed `--keep-workspace` CLI assertion (284 files passed, 16 not started; 153s); low-level retention assertions remain, public CLI assertion corrected. Neither failure is superseded by an unchanged retry.
- Full sandbox core passed **301/301 files, 2,284/2,284 tests**, no skips/cancellations/unstarted files/uncertain settlement/survivors, exporter/typegen/typecheck/lint passed. Command: `nix run --no-write-lock-file --max-jobs 2 --cores 4 path:/tmp/pi-web-nix-candidate-vBxP4q/source#test-core`; 364s command. Source digest `a7683dc754889ce343d0328f8106bec200d8318c8ef1457aaf0f45246e380a02`; `/tmp/pi-web-nix-acceptance-core-final-zn0l0S.log`, `/tmp/pi-web-test-core.rZB6ux/run.json` and linked store artifacts. Before the separately approved reader fix, subsequent executable deltas were confined to VM disk capacity and a Python EOF whitespace correction. This pass is historical evidence, not final-candidate acceptance.
- Closure-only guest proof passed real Home Manager activation, `%h` session discovery, UMask 0077, all terminal assertions and pinned-generation restart/persistence. Same immutable snapshot, `#test-e2e -- --group terminal`; 116s command / 70.3s VM script, 4GiB/two vCPUs. `/tmp/pi-web-nix-acceptance-vm-register-Jpm016.log`, `/tmp/pwv-9HZueL/run.json` (evidence collected, owned VM bulk removed). Store metadata uses a guest-only overlay and full closure registration via a literal boot filename; no host store is mounted.
- Independent read-only reviews identified/fixed service-acquisition shutdown races, restart-generation checks, hardware-acceleration fallback and host-store exposure. Follow-up review found no remaining service-owner issues. Final full VM acceptance remains open below.
- First complete actual VM check failed in `general` at the unchanged `e2e/git-diff-context.mjs:56` collapse/reopen assertion; subsequent groups did not run. Command: `nix build --no-write-lock-file --max-jobs 1 --cores 4 -L --keep-failed path:/tmp/pi-web-nix-full-vm-lXv4Bn/source#checks.x86_64-linux.e2e -o /tmp/pi-web-nix-full-vm-lXv4Bn/result`; source digest `4c55cede17d2443cec66c80a5eca29614d3854030ea968cc993a79f60f238799`, log `/tmp/pi-web-nix-full-vm-lXv4Bn/driver.log`. Builder evidence remains private; no permission changes or private-tree inspection.
- Unchanged focused reproduction (diagnostics, not a fix or acceptance): `nix run --no-write-lock-file --max-jobs 1 --cores 4 path:/tmp/pi-web-nix-full-vm-lXv4Bn/source#test-e2e -- --group diff-context`; failed in 74s, `/tmp/pi-web-nix-diff-context-diagnostic-bJSGjX.log`, `/tmp/pwv-qaaWq6/run.json` and user-owned `artifacts/guest/evidence/diff-context/{context-2.zip,context-2-failure-0.png}`. Screenshot shows retained After mode but viewport reset to line 1. Independent code review found initial binding can precede the passive mount effect without a guaranteed retry; initial scroll notifications can overwrite retained anchors, and the restoration offset sign was reversed. Fix uses the live viewer ref for binding, rejects pre-binding anchor capture and preserves Pierre's start-alignment offset sign. Controlled callback regressions exercise both mount orderings, nonzero-offset round trip, one-time binding and stale-unmount frames; the existing browser assertion is unchanged.
- Reader regressions proved red against the unmodified application: sandboxed `#test-core -- --file components/CommittedPatchDiff.test.mjs`, source digest `f4ee666d2fda1bd09b4dd2d7b79c9a3ca31c12f5b8319d958a27dffa5633cc4c`, `/tmp/pi-web-reader-red-cNUtEP/driver.log`, `/tmp/pi-web-test-core.M8R2yA/run.json`; 39s command. All three new tests failed for the expected defects (line-1 overwrite, missed pre-effect restoration, reversed offset); the five existing tests and static pipeline passed. This expected red run is not acceptance.
- Fixed reader focused checks passed from source digest `290b3ba1ea8c83d80454a6f7d7307b3053cf724efe2f2676f8ea519841a75fc1`: `nix run --no-write-lock-file --max-jobs 2 --cores 4 path:/tmp/pi-web-reader-fix-nItZEY/source#test-core -- --file components/CommittedPatchDiff.test.mjs` (8/8 tests plus static pipeline, 38s, `/tmp/pi-web-test-core.CIO4yh/run.json`); then `nix run --no-write-lock-file --max-jobs 1 --cores 4 path:/tmp/pi-web-reader-fix-nItZEY/source#test-e2e -- --group diff-context` (290s including isolated package realization, 160.85s VM script, `/tmp/pwv-waztZw/run.json`). Combined log `/tmp/pi-web-reader-fix-nItZEY/driver.log`; production output `/nix/store/5l4x13ks03y12nk7d2ahyv6b2z32qyav-pi-web-0.9.3`. All existing group assertions, service restart and persistence passed; this is selected-only coverage, not complete VM acceptance. Independent follow-up review found no concrete issues in the bounded callback/test deltas.
- Local `rst-main` advanced independently to `3128bb9c11aa152eff981989de244e63c848abef` (ESLint 10 upgrade). The user selected preparation for local integration. Guarded rebase completed cleanly; range-diff confirmed both feature patches unchanged, preserving incoming manifests, cache hash and lint compatibility coverage. Independent scoped rebase review found no blockers.

## Complete rebased-candidate acceptance

Tested commit: `64e1b1a1247f71316b54e9d30aa4038a92acfe7b`, based on local `rst-main` `3128bb9c11aa152eff981989de244e63c848abef`. Feature history contains the bounded reader fix (`30578fa58b36defea913c400f1a2078e4c834b0f`) and the Nix migration. The checkout was clean and source writers were paused for verified export.

- Source/export manifest: `/tmp/pi-web-nix-acceptance-rebased-WkVdPA/{source,source.json}`; content/mode SHA256 `fdcc72a0600ddd96b0db016609c2f4ce00e99c6bc924a4b4c17b1c68bfe33bee`. Both public-entry-point exports independently verified that same identity. Combined log: `/tmp/pi-web-nix-acceptance-rebased-WkVdPA/driver.log`.
- Complete sandboxed core: `nix run --no-write-lock-file --max-jobs 2 --cores 4 path:/tmp/pi-web-nix-acceptance-rebased-WkVdPA/source#test -- core`. **302/302 files, 2,295/2,295 tests passed**; zero failures, cancellations, skips, unstarted files, observed survivors or uncertain settlement. Exporter contracts, genuine type generation, typecheck and lint passed. Command runtime **387s**, including Nix realization; pre-command export/model/coordination time is not included. Receipt: `/tmp/pi-web-test-core.VJrkl5/run.json`; output `/nix/store/0jqc995pzmyzsnamhvd6a38bvp0s7vfm-pi-web-core-checks`.
- Complete packaged-service VM: `nix run --no-write-lock-file --max-jobs 1 --cores 4 path:/tmp/pi-web-nix-acceptance-rebased-WkVdPA/source#test -- e2e --group all`. **All 21 groups passed in one guest boot**, including real terminal, plugin/SDK/browser coverage, Home Manager activation and generation-checked restart/persistence. Package: `/nix/store/n2x1l737dwz4qy9ld1ca849j39nny5w6-pi-web-0.9.3`. KVM, 4GiB RAM, two vCPUs, 8GiB sparse state disk. Command runtime **2,744s** including package/guest realization; VM script **2,627.03s**. Receipt: `/tmp/pwv-TY2arB/run.json`; full selection/package/collection/stop receipt `/tmp/pwv-TY2arB/artifacts/acceptance.json`. Diagnostics and manifests retained; only this invocation's settled, receipt-validated runtime/tmp/cache bulk was removed.
- Native graph evaluation: `nix flake check --no-write-lock-file --no-build path:/tmp/pi-web-nix-acceptance-rebased-WkVdPA/source`, passed in **7s**; `/tmp/pi-web-nix-acceptance-rebased-WkVdPA/flake-check.log`. This was evaluation, not execution of cached checks. Other architectures were omitted, not tested.
- Final documentation-only follow-up records these results and corrects inherited root-suite terminology. It does not change application, test implementation or build definitions. Review its documentation diff and unchanged executable inputs separately; do not relabel the above runs as execution on a later commit.

Known gaps: native aarch64-linux and GitHub CI execution were not exercised. No installed host service was contacted, deployed or activated; no remote publication or historical artifact cleanup occurred.

## Completion Checklist

- [x] Full native x86_64-linux/KVM realization works without manual dependency preparation or package installations.
- [x] Core checks and full packaged-service VM acceptance pass; no required suite is silently omitted.
- [x] Focused runs use the same package/fixture definitions and clearly report selected-only coverage and fresh versus cached execution.
- [x] Application builds, dependency copies, browser state and test data never mutate the working checkout or installed service.
- [x] Nix checks, CI and documentation describe one target design, not a transitional dev-server path.
- [x] Review/verification evidence is recorded and outstanding execution gaps remain explicitly open.
