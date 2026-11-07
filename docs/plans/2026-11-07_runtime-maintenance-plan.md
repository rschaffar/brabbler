# Runtime and dependency maintenance

## Goal

Apply the user-authorized security/runtime updates and the smaller compatible maintenance updates, starting from local main `43387aeb2f590ea0dce53d05a6097335104a9faa`. Keep the installed service and Git remotes untouched.

## Scope and plan relationship

- Refresh nixpkgs and Home Manager on their existing tracks, retaining the follows relationship.
- Update Next/eslint-config-next to 16.4.5 and both application/modular-SDK Undici resolutions to 8.12.4.
- Review the Nix Node 24 backports and select the security-fixed 24.22.2 runtime consistently across packages, development, core/browser runners and deployment fixtures.
- Update Tailwind/adapter 4.3.5, PostCSS 8.5.32, KaTeX 0.19.1, remark-cjk-friendly 2.3.4, semver 7.8.6 and ESLint 10.14.0 with compatible lint transitives, including the independent demo lock where applicable.
- Preserve Pi 1.5, its exact-byte environment patch and standalone-bundle exclusion. TypeBox, native PTY, TypeScript/Node-typing majors, Pierre, Mermaid/ELK, Playwright, jsdom and web-push remain unchanged.

The public-release plan retains its distinct native-macOS, archive publication and deployment obligations. This plan does not expand renderer/source-license work, model/account behavior or existing feature plans. [Dependency maintenance](../dependencies.md), [SDK policy](../sdk-command-environment.md) and [Testing](../testing.md) own current contracts.

## Plan

- [ ] Refresh the two Nix inputs and resolve Node 24 packaging/backport compatibility. Preserve platform patches and ensure every selected execution path uses the same reviewed runtime; record a bounded retirement condition for any temporary override.
- [ ] Update root/demo manifests and selective locks, the exact SDK Undici policy/tests and npm-cache hash. Review every resolution delta; preserve held packages and classify remaining advisories without forcing unrelated majors or suppressing audit results.
- [ ] Realize the candidate in isolated Nix builders and run affected SDK/HTTP/auth/launcher/math/lint/toolchain checks. Obtain independent review and resolve demonstrated failures without weakening safety boundaries or deadlines.
- [ ] Run complete core/static/plugin, all browser/terminal groups and the genuine Home Manager deployment VM on the settled candidate. Record source/package identities, requested/effective resources, preparation, execution and whole-command times, retaining failures.
- [ ] Transfer current compatibility/runtime/advisory facts to maintained guides, archive the verified record and hand exact-state local-main non-fast-forward integration and separate cleanup to the native Git lifecycle.

Stop for unexpected patch bytes, unrelated state, unsatisfied SDK policy, unexplained lock changes or unresolved acceptance failures. No development-server/in-place build fallback, live provider call, host activation, remote publication or broad cleanup is included.

## Rollback / recovery

Before integration, retain the feature resources if blocked. Revert a coherent set of Nix inputs/runtime recipe, npm manifests/locks/cache hash and SDK Undici policy together; restoring one version alone is not a valid rollback. No session/storage migration is intended. Live deployment or rollback needs separate authorization and ordinary private backups.

## Completion checklist

- [ ] Selected runtime and both dependency graphs match the reviewed security/maintenance versions; held packages remain held.
- [ ] Narrow verification and independent review pass with installation/request/account/tool boundaries preserved.
- [ ] All three complete Nix acceptance levels pass with exact evidence and honest proof limits.
- [ ] Current guides own the delivered facts; remaining integration, cleanup, deployment and publication retain their separate gates.
