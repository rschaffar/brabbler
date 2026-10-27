# Nix-native development and Pi Web service

## Closure — completed historical milestone (2026-10-27)

Integrated lineage `cb1ce1e` is on audited main. Later isolated Nix production and
genuine Home Manager deployment acceptance resolve the original package-execution
deferral; old managed-check machinery was subsequently removed. Current behavior
and commands belong to README, `docs/testing.md` and `e2e/README.md`.
See the [closure index](../README.md#closure-evidence). Original no-build, environment,
integration and resource observations below are historical, not current recipes.

## Goal

Make the Pi Web flake the primary source for a reproducible development environment and runnable application; export a reusable Home Manager user-service module. Prevent Pi Web's managed Git verification environment from causing spurious test failures or inheriting server secrets. These changes are one feature worktree; deployment, NixOS activation, remote publication and integration still require separate authority.

## Plan Relationship

The active policy-driven Git tools roadmap owns generic check authorization, containment and recovery. This plan only addresses the environment in which its existing explicitly approved checks execute. Do not loosen the containment, recovery, clean-checkout or exact-candidate gates, and do not generalize the check runner into a sandbox.

## Architecture

`package.json` and `package-lock.json` remain the dependency source of truth; the flake pins nixpkgs/Node/Chromium. The Nix shell gets per-system, lockfile-derived modules, while the production package builds with the same pinned Node and lock-derived dependency source. `apps.default` runs the installed `/bin/pi-web`; the service module consumes that same package. Browser auth, Pi sessions and credentials remain mutable data outside the Nix store. The consumer owns the secret environment file and reverse proxy.

## Plan

- [x] Pin a shared `fetchNpmDeps` cache and native `node-pty` build; copy modules into each worktree rather than linking outside Turbopack's workspace, refuse an unmanaged `node_modules`, and evaluate the flake without a production build.
- [x] Converge the Nix package on the same Node and lockfile cache and expose an explicit runnable flake app; retain offline font preparation and evaluate source/package without running `next build` during normal development.
- [x] Add `homeManagerModules.default` with localhost systemd-user defaults, package override, typed host/port/host allow-list and secret-file option; evaluate the module and document the minimal `~/nix/my_nix_os` consumer. Do not edit or activate that separate repository.
- [x] Isolate managed check commands from inherited Pi Web server environment, fix non-root fixture permissions and bound the large-file search test below the contained log limit. Confirm the full suite inside the real supervised check unit without changing recovery admission.
- [x] Update `README.md`/browser guide for `nix develop`, `nix run`, Home Manager and safe dependency updates; distinguish lockfile isolation from Git admission.
- [x] Run `npm test` in the real contained check (1,985 pass, 0 fail, 5 skipped), TypeScript, lint, Nix evaluations, Git browser E2E and terminal E2E. Production package execution remains deferred under the no-build-during-development rule.

## Rollback / Recovery

The module is opt-in. The existing consumer module and npm-only development remain unchanged until deliberately migrated. Never replace a pre-existing `node_modules` silently; failed managed Git checks retain their quarantine until separately reviewed. No live Pi Web or NixOS configuration is edited or activated by this work.

## Completion Checklist

- [x] The linked checkout entered a lockfile-correct Nix shell with its own materialized modules; a foreign `node_modules` was refused before commands ran.
- [x] The flake evaluates a runnable Pi Web app and the Home Manager service module while preserving the existing package override used by the NixOS consumer.
- [x] Managed-check environment tests isolate server secrets and the full contained unit suite passes; the old SDK branch's failed-check recovery remains separately quarantined.
- [x] Required development verification is recorded; a Nix production build was intentionally not run, and local integration/deployment remain separate exact-state decisions.
