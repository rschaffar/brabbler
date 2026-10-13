# Dependency refresh

## Goal

Refresh the Nix development toolchain first, then address the dependency review's security, maintenance and compatibility recommendations in reviewable stages. User authorization covers implementation in a linked worktree, not production builds, deployment, publication, integration or cleanup.

## Context

Worktree: `pi-web-worktrees/dependency-refresh`, branch `chore/dependency-refresh`, starting local `rst-main` commit `4ea801a76804b4d87a50bce4512031ed5855764d`. The user explicitly chose to track `nixos-unstable` instead of maintaining a revision literal in `flake.nix`. `flake.lock` still pins evaluated inputs.

## Plan Relationship

The Nix-native development/service plan owns the existing environment and service design. The development-verification plan owns isolated test infrastructure. This plan changes dependency inputs and compatibility adapters only, not those lifecycles or live services.

## Plan

- [x] Change the nixpkgs input to `nixos-unstable`, refresh `flake.lock`, and document the update/Chromium acceptance policy. Nix-only evaluation, shell preparation, complete offline core/static pipeline, browser and terminal acceptance passed before npm changes; evidence below.
- [x] Refresh root/demo patch/minor application dependencies and fixable security-related transitive dependencies, preserving Pi SDK/native PTY pins. Prepared regenerated caches; stream preservation and hook regressions passed focused/static checks.
- [x] Resolve KaTeX renderer compatibility across all dependency paths with the user-approved, exact 0.19.0 override. Both locks contain only that version; focused/static and desktop/mobile math/security/SVG acceptance passed. The override remains outside upstream adapter ranges.
- [x] Evaluate a supported ESLint migration. **Immediate-upgrade recommendation retracted:** Next 16.4's import/React/a11y plugin peers exclude 10. Retain 9.39.5 as documented compatibility debt rather than forcing peers or disabling rules; `docs/dependencies.md` owns follow-up.
- [x] Evaluate TypeScript 7 and Mermaid 12 separately. TypeScript 7 is blocked by typescript-eslint 8.71.2's `<6.1.0` peer ceiling. Mermaid 12.2.0 passed static/focused and desktop/mobile migration acceptance.
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

## npm migration checkpoints

- `660ec10`: refreshed root/demo packages and caches, removed redundant YAML typings, aligned Node types to 22, and fixed the resulting binary/UTF-8 stream callback typing with regression coverage.
- `18ec640`: user chose Next 16.4 with React Hooks refactors over reverting to 16.3.8. Static preparation and 48 focused cases passed; no lint suppression. Hook artifacts `/tmp/pi-web-test-offline.8fpHa0Na`.
- `6117935`: user approved testing a constrained KaTeX 0.19.0 override. The old 0.16.47 control accepted inherited `trust`; the fixed regression rejects it. Final static preparation and 36 focused cases passed (39.97 s), artifacts `/tmp/pi-web-test-offline.Z5kKnKsk/artifacts/run-4wQVGt`, executed-source digest `ac5579c3dcceb3cb15486e6243b7f65b62b34843f947b9235b2b0ab5cd69ed15`. Markdown-only browser acceptance passed at 1280/390 px (89.32 s), artifacts `test-results/e2e/browser-k6B5Ug`, source `/tmp/pwe-GgRHL3`, digest `7ed85b930ae2f3e884b3f17c0016a20e2756112d83e6c1ea997b21ddf9702630`.
- KaTeX browser failures retained: `browser-LO7z0W` exposed a test-only old `.base` selector (0.19 emits `.katex-base`); `browser-suqSgw` and `browser-jJw76v` exposed real Prism shorthand/longhand background conflicts, fixed in root/demo without hiding console errors; `browser-WP1pTa` reached mobile rendering but its teardown waited for a panel already hidden after the last tab closed, corroborated by screenshot. The corrected teardown checks visibility, not weaker rendering assertions.
- `a9d53f0`: Mermaid range migration resolved 12.2.0 in both locks. Preparation 62.38 s; static/focused run 41.32 s, 30 cases, artifacts `/tmp/pi-web-test-offline.NAxy5Lug/artifacts/run-ne6hO3`, executed-source digest `3c3ba1adc62088b9dac4d5765e2871b5881d60b83a9478a807ff1f6834286f45`. Markdown-only browser acceptance 90.77 s, `test-results/e2e/browser-dKmOh1`, source `/tmp/pwe-NtiHFL`, digest `601db16104e36a8c0cc26ea16b5941be21fe18129a10b7ff4e96d166c21fe6b4`.
- Fresh advisory inventory (2026-10-13): root two records/two packages (braces, sprintf-js), demo one (braces). Latest releases remain affected. Raw inventory and corrected name/path summary are under `test-results/dependency-refresh/{root,demo}-advisory*.json` and `advisory-summary-fixed.log`. Initial inventory diagnostic used a missing advisory `name` field and assumed plugins were hoisted; corrected summaries use the response's package keys and actual lock paths.
- Read-only packaging/locking/license review confirmed 12 shipped runtime devDependencies, proper-lockfile/SDK locking interoperability, and mixed-license obligations. Runtime classification changes preserve every resolved version/package path; `runtime-classification-review.log` records the comparison. Mermaid 12 additionally introduces EPL-2.0 elkjs; final artifact notices remain release review, not development-build work.

These are staged/focused checks, not final npm candidate acceptance. Dependency guidance and remaining debt have the maintained owner `docs/dependencies.md`.

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
