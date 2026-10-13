# Dependency refresh

## Goal

Refresh the Nix development toolchain first, then address the dependency review's security, maintenance and compatibility recommendations in reviewable stages. User authorization covers implementation in a linked worktree, not production builds, deployment, publication, integration or cleanup.

## Context

Worktree: `pi-web-worktrees/dependency-refresh`, branch `chore/dependency-refresh`, starting local `rst-main` commit `4ea801a76804b4d87a50bce4512031ed5855764d`. The user explicitly chose to track `nixos-unstable` instead of maintaining a revision literal in `flake.nix`. `flake.lock` still pins evaluated inputs.

## Plan Relationship

The Nix-native development/service plan owns the existing environment and service design. The development-verification plan owns isolated test infrastructure. This plan changes dependency inputs and compatibility adapters only, not those lifecycles or live services.

## Plan

- [x] Change the nixpkgs input to `nixos-unstable`, refresh `flake.lock`, and document the update/Chromium acceptance policy. Nix-only evaluation, shell preparation, complete offline core/static pipeline, browser and terminal acceptance passed before npm changes; evidence below.
- [ ] Refresh root/demo patch/minor application dependencies and fixable security-related transitive dependencies, preserving Pi SDK pins and the node-pty beta unless new evidence warrants changes. Verify regenerated npm cache hash and focused contracts.
- [ ] Resolve KaTeX renderer compatibility across direct, rehype and Mermaid dependency paths; prove every resolved copy is fixed or record a concrete blocker rather than hiding audit findings with an unsafe override.
- [ ] Upgrade unsupported ESLint to a supported release, aligning Next lint configuration and validating configuration/plugin compatibility.
- [ ] Evaluate TypeScript 7 and Mermaid 12 as separate migrations, recording tested compatibility or concrete blockers.
- [ ] Remove redundant YAML typings, align Node typings with the supported runtime, and review bundled-runtime dependency classifications plus proper-lockfile maintenance without introducing an unjustified locking rewrite.
- [ ] Refresh both lockfile advisory inventories and document remaining advisory exposure and license/notice considerations in a maintained dependency guide.
- [ ] Run complete acceptance on the settled candidate, independently review the diff, and record exact source identities, commands, results, runtimes and retained artifact paths.

## Nix-only checkpoint evidence

Nixpkgs advanced to `7fd4004d0511991fff3a0524856a9be09e28c5f0` on `nixos-unstable`. Prepared tools: Node 22.23.3, npm 10.9.9, Git 2.55.0, Python 3.14.7, Chromium 155.0.8059.39. Root/demo npm manifests and lockfiles remained unchanged throughout this checkpoint.

- `nix flake check --no-build`: passed x86_64-linux evaluation, including Home Manager evaluation; 2.59 s. Other declared systems not checked in this invocation.
- `nix develop .#test -c bash -c '<tool versions>'`: dependency/shell preparation passed; 41.67 s, separate from application checks.
- `nix develop .#test -c node nix/test-offline.mjs --jobs 4`: exporter contracts, type generation, typecheck, lint and all 280 test files / 1,814 cases passed; 151.75 s command wall time. Executed-source digest `c5ef868fccc916611bb828bd1678d7def18bbaa6705194df8da47799637b127f`; artifacts `/tmp/pi-web-test-offline.CyvENHxV/artifacts/run-9h6mc2`, lifecycle `/tmp/pi-web-test-offline.CyvENHxV/lifecycle.json`.
- `nix develop .#test -c npm run test:e2e`: full desktop/mobile browser acceptance passed; 1,135.94 s command wall time. Artifacts `test-results/e2e/browser-sCL4u7`; fixture/source root `/tmp/pwe-eTR3go`.
- `nix develop .#test -c npm run test:terminal`: real PTY shell desktop/mobile acceptance passed; 49.10 s command wall time. Artifacts `test-results/e2e/terminal-Qo4R8I`; fixture/source root `/tmp/pwe-9pFsc8`.

Browser/terminal exported-source digest: `04e5f3bd22e223e509d524d3a47478fcefc11693cee3fbaebea9dbbf5de59f4f`. Their owned regenerable bulk was cleaned after observed settlement; reports and source/fixtures were retained. Outer command logs: `test-results/dependency-refresh/nix-{evaluation,preparation,only-core,only-browser,only-terminal}.log`. No production build or installed-service access occurred. This evidence predates the status-only plan edits recording it; it is not relabelled as a later-tip run.

## Non-Goals

No application production builds, releases, pushes, system activation, live configuration/credential changes, test deadline inflation or weakening of security assertions. No dependency replacement solely because a small mature package has infrequent releases.

## Risks

An unstable toolchain update changes native PTY and browser inputs. New compiler/lint releases can change contracts. Updating direct KaTeX alone can leave old nested renderers because upstream adapters constrain 0.16.x. Root runtime libraries currently classed as dev dependencies may be intentionally bundled; classification changes need packaging evidence.

## Rollback / Recovery

Keep coherent feature commits and failed verification artifacts. Do not overwrite existing dependencies or modify the primary checkout. Retain feature resources on a blocker; integration and cleanup use separate exact-state decisions.

## Completion Checklist

- [x] Nix-only checkpoint passes required evaluation, core/static, browser and terminal checks before npm changes.
- [ ] Dependency updates and any retracted recommendations have explicit evidence and risk dispositions.
- [ ] Final acceptance and independent review cover the exact candidate without a production build.
- [ ] Remaining security/compatibility limits have a maintained owner and are reported honestly.
- [ ] Completion intent is resolved; any local integration/cleanup receives the applicable tool approval.
