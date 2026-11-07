# Runtime and dependency maintenance

## Goal

Apply the user-authorized dependency security/maintenance and Nix input updates, excluding the explicitly deferred Node update, starting from local main `43387aeb2f590ea0dce53d05a6097335104a9faa`. Keep the installed service and Git remotes untouched.

## Scope and plan relationship

- Refresh nixpkgs and Home Manager on their existing tracks, retaining the follows relationship.
- Update Next/eslint-config-next to 16.4.5 and both application/modular-SDK Undici resolutions to 8.12.4.
- Retain the refreshed Nixpkgs Node 24.21.0 runtime. The maintainer explicitly deferred the reviewed Node 24.22.2/shared-Brotli source update; [Dependency maintenance](../../dependencies.md) owns that follow-up. The partial build was stopped and supplies no finished-runtime evidence.
- Update Tailwind/adapter 4.3.5, PostCSS 8.5.32, KaTeX 0.19.1, remark-cjk-friendly 2.3.4, semver 7.8.6 and ESLint 10.14.0 with compatible lint transitives, including the independent demo lock where applicable.
- Preserve Pi 1.5, its exact-byte environment patch and standalone-bundle exclusion. TypeBox, native PTY, TypeScript/Node-typing majors, Pierre, Mermaid/ELK, Playwright, jsdom and web-push remain unchanged.

The public-release plan retains its distinct native-macOS, archive publication and deployment obligations. This plan does not expand renderer/source-license work, model/account behavior or existing feature plans. [Dependency maintenance](../../dependencies.md), [SDK policy](../../sdk-command-environment.md) and [Testing](../../testing.md) own current contracts.

## Plan

- [x] Refresh the two Nix inputs while retaining ordinary Node 24.21.0 with no custom runtime overlay. `nix flake check --all-systems --no-build --no-write-lock-file` passes for every declared system; selected runtime evaluates to 24.21.0 and its dry run requires no realization. The deferred Node security gap is recorded in its maintained owner.
- [x] Update root/demo manifests and selective locks, the exact SDK Undici policy/tests and npm-cache hash. Reviewed 68 root / 64 demo changed package records, preserved held packages and realized the owned SDK installation; fresh audits classify the remaining minimatch lint-chain matches without forced majors or suppressions.
- [x] Complete the maintainer-approved compression compatibility adapter with exact Next 16.4.5/source guards and pre-serving installation. Catalogue/detail gzip assertions now cross the actual Next/HTTP boundary; quality, threshold, MIME, framing, options and cleanup obligations remain. Seven focused files passed 51 tests; the revised receipt/Next dev-worker contracts passed 34 tests after correcting two stale receipt markers. The installed state group passed with explicit catalogue/detail gzip and decoding checks (131s command; 9.626s group). Independent review covers the adapter, lifecycle and migrated assertions. Earlier unchanged SDK/HTTP/auth/launcher/math/lint/toolchain and demo evidence retains its recorded scope.
- [x] Run complete core/static/plugin, all browser/terminal groups and the genuine Home Manager deployment VM on settled candidate `41584e25377a84438f6e9d564a71ae7e8e52e826`: 529 files / 4,495 tests / 14 suites, all 26 groups / 60 receipts, and every deployment proof passed in 404 seconds. Exact identities and phase envelopes are recorded below; prior failures are retained.
- [x] Transfer compatibility/runtime/advisory facts and the mandatory next-Next-upgrade check to maintained guides; archive this verified record for exact-state native local-main non-fast-forward integration. Integration, cleanup, activation and publication remain distinct gates; acceptance itself performs none of them.

Stop for unexpected patch bytes, unrelated state, unsatisfied SDK policy, unexplained lock changes or unresolved acceptance failures. No development-server/in-place build fallback, live provider call, host activation, remote publication or broad cleanup is included.

## Focused verification and retained failure

- Verified before the compatibility correction: 18 focused Nix core files / 102 tests, independent demo typegen/typecheck/lint and 10 regressions, all-system Nix evaluation, and reviewed locks. Fresh root/demo audits each retain ten moderate minimatch lint-chain matches and zero `--omit=dev` matches; neither clears the deferred Node gap or the shipped lint dependencies.
- The first complete candidate `f776ebc857d5784e9bbfcb0c6516e929e062e458` failed in 100 seconds: four admitted browser groups received gzip JSON without `Content-Encoding`, core was peer-cancelled and deployment did not start. Raw HTTP and both fetch implementations confirmed the server-side encoding mismatch; this is not evidence that Node must be rebuilt.
- The decoded-helper candidate `d17ef8ce7f6c29188612487a18acd6630abe5981` passed its five focused core cases and installed state group, but complete acceptance failed in 226 seconds on two existing catalogue/detail gzip assertions. The earlier assumption that Next automatically compresses these API replies was wrong: its adapter stores singleton Content-Type arrays and its compressor's default predicate rejects non-strings. The maintainer did not accept losing API compression.
- Private installed-package controls demonstrated a narrower solution: adapt only the existing compressor filter's view of singleton JSON Content-Type, retaining decoded Web Responses, actual headers and Next security filtering. A synthetic 14,368-byte catalogue became 578 wire bytes with valid gzip; identity, gzip refusal, below-threshold and unrelated JSON controls remained plain. This is bounded fixture evidence, not a deployed performance estimate. The maintainer authorized the guarded adapter and explicitly requires reassessment on the next Next update. The guarded adapter and production startup wiring now pass focused/native/installed checks. A real installed unadapted control fails the named wire-gzip assertion; the corrected installed chain uses fresh `api-append-accounts-gzip-v2` coverage with all previous state steps retained and old-ID pre-callback rejection. The dependency guide and startup refusal explicitly require reassessment on every Next upgrade. Complete acceptance now passes on the recorded candidate; no Node rebuild or live activation is authorized.

## Complete acceptance evidence

Command: `nix run --no-write-lock-file .#test -- all --workers 4 --jobs 4` on native
x86_64 Linux, **32 logical CPUs**, with about **34.46 GiB available** at admission.
Requested/effective widths were **four core workers / four browser sandboxes**;
core overlapped browser then deployment. The twelve/four estimate requires 43 GiB,
so the four/four 27-GiB estimate admitted overlap without changed deadlines.

| Interval | Seconds | Scope |
| --- | ---: | --- |
| Complete command | **404** | Includes in-run realization; excludes model/review/coordination |
| Core invocation | 399.482 | 529 files / 4,495 tests / 14 suites; zero failed/cancelled/skipped |
| Core before first file / file-execution window | 2.578 / 396.478 | Preparation/static envelope and effectful execution separately |
| Browser invocation | 251.451 | All 26 groups / 60 exact receipts |
| Browser support / manifest preparation | 3.899 / 4.838 | Separate declared prerequisite/dispatch realization |
| Browser group-client window | 242.710 | Includes per-group realization/validation, not just assertions |
| Deployment invocation | 89.162 | Realization, genuine Home Manager guest and collection |
| VM test script | 19.40 | Separate guest proof interval; the remaining envelope is not pure realization time |

These intervals overlap and are not additive. Focused runs prepared matching
modules/static outputs and the application/browser support beforehand; the final
installed-state command took 131s including its 9.626s group execution. This is
fresh complete execution with warm prerequisites, not a cold-cache or matched
performance benchmark. The deployment guest used 1 vCPU / 1536 MiB RAM / 2 GiB disk.

- Verified source: `/nix/store/awdngx9a3s7km0z1pdknnql06973672m-source`.
- Content/mode digest: `cc4165084fcded4bbf956ef3d22ba70a10280755f90a9195515d2ad146ce165a`.
- Shared installed package: `/nix/store/bv6qdcljr3vx91mhb77s1v3rydcij8z4-brabbler-0.1.0`.
- Core output: `/nix/store/gj2m1fv2nkxq24wgnlzwlbdsvvnilw59-brabbler-core-checks`;
  execution UUID `1e2b656c-7d73-4983-be9b-47f217fd9e99`.
- Browser UUID: `9b543d85-9b36-4a56-9022-86f01c8f3b87`; state uses the new gzip-v2 receipt.
- All five guest checks passed: activation, environment/permissions, durable HTTP
  write, restart persistence and production PTY, including final service settlement.

Detailed logs, original failures and review reports are retained in private task
evidence. All declared systems also passed evaluation-only flake checks; native
execution here covers only x86_64 Linux. Native macOS/portable archive release smoke,
live-provider access, host activation and publication are not claimed. The Node
security update and remaining minimatch lint advisory retain their explicit owners.
A later archive/status-only commit does not relabel this as execution at a new tip.

## Rollback / recovery

Before integration, retain the feature resources if blocked. Revert a coherent set of Nix inputs, npm manifests/locks/cache hash and SDK Undici policy together; restoring one version alone is not a valid rollback. No session/storage migration is intended. Live deployment or rollback needs separate authorization and ordinary private backups.

## Completion checklist

- [x] The selected runtime remains Nixpkgs Node 24.21.0; both dependency graphs match reviewed maintenance versions, held packages remain held and the deferred Node security update has an explicit owner.
- [x] Narrow verification and independent review pass with installation/request/account/tool boundaries preserved.
- [x] All three complete Nix acceptance levels pass with exact evidence and honest proof limits.
- [x] Current guides own the delivered facts; remaining integration, cleanup, deployment and publication retain their separate gates.
