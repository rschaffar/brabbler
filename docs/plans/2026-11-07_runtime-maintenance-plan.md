# Runtime and dependency maintenance

## Goal

Apply the user-authorized dependency security/maintenance and Nix input updates, excluding the explicitly deferred Node update, starting from local main `43387aeb2f590ea0dce53d05a6097335104a9faa`. Keep the installed service and Git remotes untouched.

## Scope and plan relationship

- Refresh nixpkgs and Home Manager on their existing tracks, retaining the follows relationship.
- Update Next/eslint-config-next to 16.4.5 and both application/modular-SDK Undici resolutions to 8.12.4.
- Retain the refreshed Nixpkgs Node 24.21.0 runtime. The maintainer explicitly deferred the reviewed Node 24.22.2/shared-Brotli source update; [Dependency maintenance](../dependencies.md) owns that follow-up. The partial build was stopped and supplies no finished-runtime evidence.
- Update Tailwind/adapter 4.3.5, PostCSS 8.5.32, KaTeX 0.19.1, remark-cjk-friendly 2.3.4, semver 7.8.6 and ESLint 10.14.0 with compatible lint transitives, including the independent demo lock where applicable.
- Preserve Pi 1.5, its exact-byte environment patch and standalone-bundle exclusion. TypeBox, native PTY, TypeScript/Node-typing majors, Pierre, Mermaid/ELK, Playwright, jsdom and web-push remain unchanged.

The public-release plan retains its distinct native-macOS, archive publication and deployment obligations. This plan does not expand renderer/source-license work, model/account behavior or existing feature plans. [Dependency maintenance](../dependencies.md), [SDK policy](../sdk-command-environment.md) and [Testing](../testing.md) own current contracts.

## Plan

- [x] Refresh the two Nix inputs while retaining ordinary Node 24.21.0 with no custom runtime overlay. `nix flake check --all-systems --no-build --no-write-lock-file` passes for every declared system; selected runtime evaluates to 24.21.0 and its dry run requires no realization. The deferred Node security gap is recorded in its maintained owner.
- [x] Update root/demo manifests and selective locks, the exact SDK Undici policy/tests and npm-cache hash. Reviewed 68 root / 64 demo changed package records, preserved held packages and realized the owned SDK installation; fresh audits classify the remaining minimatch lint-chain matches without forced majors or suppressions.
- [x] Realize the candidate in isolated Nix builders and run affected SDK/HTTP/auth/launcher/math/lint/toolchain checks. The 18-file/102-test focused run and independent demo checks passed. The additional JSON compatibility correction passes five core cases and the installed state group after meaningful reds; independent package, deferral and correction reviews found no blockers. No boundaries or deadlines were weakened.
- [ ] Run complete core/static/plugin, all browser/terminal groups and the genuine Home Manager deployment VM on the settled candidate. Record source/package identities, requested/effective resources, preparation, execution and whole-command times, retaining failures.
- [ ] Transfer current compatibility/runtime/advisory facts to maintained guides, archive the verified record and hand exact-state local-main non-fast-forward integration and separate cleanup to the native Git lifecycle.

Stop for unexpected patch bytes, unrelated state, unsatisfied SDK policy, unexplained lock changes or unresolved acceptance failures. No development-server/in-place build fallback, live provider call, host activation, remote publication or broad cleanup is included.

## Focused verification and retained failure

- Verified before the compatibility correction: 18 focused Nix core files / 102 tests, independent demo typegen/typecheck/lint and 10 regressions, all-system Nix evaluation, and reviewed locks. Fresh root/demo audits each retain ten moderate minimatch lint-chain matches and zero `--omit=dev` matches; neither clears the deferred Node gap or the shipped lint dependencies.
- The first complete candidate `f776ebc857d5784e9bbfcb0c6516e929e062e458` failed in 100 seconds: four admitted browser groups received gzip JSON without `Content-Encoding`, core was peer-cancelled and deployment did not start. Raw HTTP and both fetch implementations confirmed the server-side encoding mismatch; this is not evidence that Node must be rebuilt.
- The helper compatibility correction passes all five core cases and the installed state group. Its two additive helper/real-Next-adapter cases first failed against the original helper, while all three original negative cases passed. No assertions or browser receipts are retired; the native lane declares its private loopback server and joined response/forwarding/connection lifecycle. Independent delta review found no blockers. Complete corrected-candidate acceptance remains required.

## Rollback / recovery

Before integration, retain the feature resources if blocked. Revert a coherent set of Nix inputs, npm manifests/locks/cache hash and SDK Undici policy together; restoring one version alone is not a valid rollback. No session/storage migration is intended. Live deployment or rollback needs separate authorization and ordinary private backups.

## Completion checklist

- [ ] The selected runtime remains Nixpkgs Node 24.21.0; both dependency graphs match reviewed maintenance versions, held packages remain held and the deferred Node security update has an explicit owner.
- [ ] Narrow verification and independent review pass with installation/request/account/tool boundaries preserved.
- [ ] All three complete Nix acceptance levels pass with exact evidence and honest proof limits.
- [ ] Current guides own the delivered facts; remaining integration, cleanup, deployment and publication retain their separate gates.
