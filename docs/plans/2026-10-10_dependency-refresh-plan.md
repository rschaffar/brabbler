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
- [x] Remove redundant YAML typings, align Node typings with Node 22, move the 12 shipped renderers into runtime dependencies, and retain proper-lockfile for proven SDK locking interoperability. Classification comparison, realized cache and focused/static checks passed.
- [x] Refresh both advisory inventories and document remaining exposure, compatibility debt and license/notice obligations in the maintained owner `docs/dependencies.md`.
- [x] Separately authorized demo repair: fix pre-existing archived/search-result type contracts, add two regressions, and adapt remaining demo hook captures to the enabled compiler rules. Independent demo static checks passed.
- [x] Repair the separately authorized same-branch receipt reconciliation race and fixture settings transport; commits `10925c2` and `dfc10a8`, evidence below.
- [x] Diagnose cleanup subprocess scheduling and commit fresh marker-path batching with fail-closed status handling in `37e7df6`; preserve all validation checkpoints and unchanged deadlines.
- [x] Confirm and prepare the newly user-requested Pi SDK 1.2.0 release, replacing the earlier decision to retain 1.1.0. Registry metadata and matching Nix cache are retained; compatibility acceptance passed on the recorded source snapshot.
- [x] Adapt user/custom `before_agent_start` handlers; complete core/static and real-SDK plugin acceptance verifies user references, custom notifications, exact prompts and launch observers on SDK 1.2.0.
- [x] Recover failed exclusively launch-owned admission with unchanged final guards, public bounded disposal and canonical-ID retirement barriers; 78 focused lifecycle/real-SDK cases and complete plugin/browser acceptance passed.
- [x] Isolate personalized catalogs by immutable account snapshot, retaining Pi-default CLI storage; 29 focused catalog/boundary cases and complete core/browser acceptance passed.
- [x] Complete settled-candidate application acceptance and independent review; exact source identities, commands, results, runtimes and retained paths are recorded below.

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

## Rebase, review and demo evidence

The user requested rebasing after new file-line-link work merged. Local `rst-main`
advanced to `ed89fd5a0f3cb69ae66f0c9742d0303280932f2a`. The first rebase stopped at
one mechanical E2E teardown conflict. Aborted it and verified clean restoration
of `34e5057a6c33112ee43601e322705bc0f794f94f`, created
`backup/dependency-refresh-pre-rebase-20261013-121334`, then retried with the reviewed
`isVisible()` guard and expanded status message. Range-diff confirms the other
five feature patches are unchanged; the newly merged file-link behavior remains.
Rebased feature checkpoint: `49fb564f520ba98d637ca657659e55c6fed61f57`.
Recovery/conflict/range-diff evidence is retained under `test-results/dependency-refresh/rebase-*`.

Independent review found no application defect. Its two low coverage gaps were
addressed: positive inline-math output and actual Mermaid node-fill changes are
now asserted; `nix/check-math-dependencies.mjs` guards both independent locks.
Rebased Markdown/browser acceptance including the new file-line-link flows passed
at 1280/390 px in 139.46 s, `test-results/e2e/browser-s1SnTj`, source
`/tmp/pwe-uMNiRv`, digest `6969cf01382a7b1d1daf58c191889acf47391e4fe204a4c282061913e49b5720`.

Demo verification uses an independent disposable copy and its own lock/dependencies,
not root modules or a production build. The refreshed and original-base copies
both produced the same seven type errors; the user authorized bounded repairs.
Fixed snapshot `/tmp/pi-web-demo-final.v6SZ2Em4`, 265 source inputs, digest
`be2ffcf374188aa5991f9f2b28e037d8991eb00cfe1607a97fdb7e3d1eb69e99`:
preparation 9.90 s; route type generation, TypeScript, lint and two search cases
passed in 24.92 s. Lint retains one existing unused-locale warning. Earlier
failures are retained separately: npm rejected identical user/global config paths;
initial type generation needed the public parent manifest; then existing type and
compiler-memoization issues were diagnosed rather than suppressed. This evidence
predates the demo README-only verification guidance update in `d02beb3`.

## Receipt, fixture transport and cleanup checkpoints

The receipt race was same-branch advancement: retry paired a newer ancestor with
an older captured receipt leaf. `10925c2` rereads the current canonical branch on
movement and merges only returned durable cards, retaining navigation/live-view
and revision guards. Core/static passed 1,838 cases; focused Session Launch and
real-PTY acceptance passed. Subsequent failures remain retained, not erased by
later passes.

`dfc10a8` extends the existing one-shot `Connection: close` fixture discipline to
settings PATCH calls. The precise preceding ECONNRESET cause was not established.
Core/static passed 284 files / 1,841 cases; complete desktop/mobile browser passed
(`browser-GbXtqz`); plugin integration passed 335 cases in 98.59 s.

Cleanup profiling (`browser-28XfIk`, diagnostic only) measured 81 Git calls and
4–5 seconds per artifact stage; receipt callbacks were at most 1.4 ms. Scalar
summary: `test-results/dependency-refresh/cleanup-profile-summary.txt`.
Temporary instrumentation was removed. Batching checkpoint export
`5220feab5b55789a0f4e023542cba6ea0b7c6dc0032c7a1f8e63dae0f8b97086`
passed core/static 284 files / 1,841 cases (156.01 s), plugin integration 358 cases
(79.42 s), and plugin-only desktop/mobile browser under unchanged 30-second
completion waits (369.52 s, `browser-TF9CRK`, `/tmp/pwe-v06bvm`). Inner and outer
lifecycle both settled. Independent review then found the pre-existing broad
status-1 catch: two production-boundary regressions failed before narrowing it
to the optional config read, and all 17 focused cases passed afterward.
`37e7df6128393b5391a951c7e6765abe185f747e` commits both changes; the earlier broad
passes are not relabelled as runs on that final error-handling delta.

## Newly authorized SDK 1.2.0 compatibility work

The user requested the release published approximately 13 hours earlier and then
explicitly chose to retain 1.2.0 with bounded compatibility fixes. All four direct
Pi packages are exact 1.2.0; MCP/codemode/telemetry transitives also resolve 1.2.0.
Native PTY and proper-lockfile pins remain unchanged. Demo does not depend on Pi.
Registry evidence: `test-results/dependency-refresh/pi-mono-latest.json`; all
researched public tarballs were SHA512-verified before extraction. New npm cache:
`sha256-N6uwL/EZ2XG+8ZC8HYMrLz10/5fciB/hP+jr0uzbeoA=`. Dependency derivation
preparation took 44.35 s; after explicit user approval, only the outdated managed
feature-worktree `node_modules` was removed and regenerated (7.51 s), without a
backup, source deletion or installed-service changes.

Static verification reproduced two new `BeforeAgentStartEvent.prompt` type errors
(`/tmp/pi-web-test-offline.jPPpEfn3`); prompt-only handlers now narrow to user events,
while exact-system-prompt handling must continue to apply to custom-triggered runs.
Complete core/static, real-SDK plugin and browser acceptance now cover those edits;
source identities and retained evidence are recorded below.

Real SDK diagnostic, not acceptance:
`/tmp/pi-upgrade-readonly-cw7vf2qr/preflight-throw-run/evidence.json`. A final
admission callback rejection after an awaited hook leaves SDK 1.2.0 busy despite
zero faux provider calls, prevents an ordinary next prompt and leaves abort
unsettled within the observed bound. The host now owns a fresh launch destination
exclusively before publishing its wrapper. Failed final admission permanently
refuses that wrapper, rejects acknowledgement promptly and runs bounded exactly-once
public disposal; successful admission releases ownership. Direct pending-owned
destroy/shutdown also refuse. A canonical persisted SDK-ID barrier prevents alias
or HMR reopen until disposal succeeds; failure blocks same-ID reuse. Final guards
still throw, no SDK fields are repaired and no prompt is replayed. Failed launch
identity/history and honest receipts remain.

OpenRouter now persists authenticated `/models/user` results with account-specific
limits/prices. The initial upgrade exposed a provider-keyed shared store;
`lib/account-model-runtime.ts` now binds credentials and storage to one branded,
immutable complete account snapshot. Additional scopes use a canonical-selection
hash beneath `pi-web/model-stores/v1`, never credential-derived paths or copied
unknown-owner caches. Empty/Pi-default scope keeps CLI-compatible storage. Refresh
joining/serialization is scope/provider-aware and metadata changes invalidate
caches. Independent review found malformed supplied bindings could select default
storage and invalid present provider filters could widen refresh; both now fail
closed. Synthetic A/B/default disk-backed catalogs, offline reopening and route
boundary regressions passed without live provider calls.

Final acceptance must cover the resulting SDK/runtime candidate: complete common
baseline, separate plugin/real-SDK cases, complete browser and real-PTY coverage.
Retain older failures and identify actual input digests; do not reuse earlier
passes as new-input evidence. `docs/dependencies.md`, `docs/model-internals.md` and
session guides remain the maintained contract owners. Integration, publication
and historical-resource cleanup are still separate decisions.

## SDK 1.2.0 final acceptance evidence

The stable application snapshot exported as
`0e3b4185ae2b0e194a58fae1850fe2fa461d671fac906ca3acdedff1eefbb55c`.
Commands used `nix develop --offline --no-write-lock-file`; core/browser/terminal
used `.#test`. Times below are command wall times, separate from dependency
preparation, reviews and coordination. These passes precede the status-only plan
update recording them, not relabelled runs on a later documentation revision.

- `node nix/test-offline.mjs`: complete exporter contracts, route type generation,
  typecheck, lint and **285 files / 1,877 cases** passed in **149.90 s**.
  Executed inner source digest
  `8863a53180a29de634dddb97c8e282d631880de738d802034e2e31c2ffea482a`;
  artifacts `/tmp/pi-web-test-offline.wUbFN8bf/artifacts/run-xb4E0I`.
- Default-shell `env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node
  --experimental-strip-types --test "plugins/**/*.test.mjs"`: **374 cases** passed
  in **72.16 s**, including real-SDK Session Launch acceptance.
- `npm run test:e2e`: complete desktop/mobile acceptance passed in **1,132.18 s**;
  `test-results/e2e/browser-vv96u5`, source/fixtures `/tmp/pwe-JpGbik`.
- `env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e`: both viewports passed,
  including cleanup under unchanged completion deadlines, in **345.36 s**;
  `test-results/e2e/browser-osjWUE`, source/fixtures `/tmp/pwe-vE457H`.
- `npm run test:terminal`: real PTY desktop/mobile acceptance passed in **46.61 s**;
  `test-results/e2e/terminal-tCV22f`, source/fixtures `/tmp/pwe-E6487P`.
- `nix flake check --offline --no-write-lock-file --no-build`: x86_64-linux
  evaluation passed in **2.22 s**; other systems were not checked.

All three passing browser/terminal manifests report no errors, resources settled
and successful settled outer suite phases. Owned regenerable bulk was removed;
source, reports and fixtures remain. Logs are
`test-results/dependency-refresh/pi-mono-final-{core,plugin-core,browser,plugin-browser,terminal,evaluation}.log`.
Independent account/lifecycle reviews found no further concrete defect after the
fail-closed binding/filter and retirement-race repairs. Focused follow-ups passed
56 cases for catalog/auth/reference coverage and 22 extension-UI cases, including
live expired-response idempotence and post-teardown refusal without new receipts.

Earlier failures remain visible: `pi-mono-core-before-const.log` (lint),
`pi-mono-core-before-oauth-fixture.log` (strict fixture missing its new import),
`pi-mono-core-before-ui-teardown.log` (fixture expected a disposed wrapper to
accept a response). Assertions were repaired/strengthened, not disabled.
`browser-l1lVeX` is incomplete, not acceptance: the 700-second tool wait expired
before the documented full-suite runtime; launcher settlement was absent and its
orphaned exact dev server was subsequently stopped with SIGTERM after identity
checks. Its process group was observed absent; bulk remains. Logs and bounded
observation are `pi-mono-browser-tool-timeout.{log,json}`. The fresh full run used
an adequate tool wait only; application deadlines and assertions were unchanged.

The new root lock advisory query still matches only braces and sprintf-js;
registry license metadata for all seven resolved Pi packages is MIT. Remaining
advisory and artifact-wide licensing obligations stay with `docs/dependencies.md`.
Public disposal does not certify arbitrary extension/process settlement;
pre-wrapper startup cancellation is outside owned-wrapper retirement. No
production build, service activation, integration or publication occurred.

## Non-Goals

No application production builds, releases, pushes, system activation, live configuration/credential changes, test deadline inflation or weakening of security assertions. No dependency replacement solely because a small mature package has infrequent releases.

## Risks

An unstable toolchain update changes native PTY and browser inputs. New compiler/lint releases can change contracts. Updating direct KaTeX alone can leave old nested renderers because upstream adapters constrain 0.16.x. Runtime classification changes downstream npm installs; distributed artifacts still require release-time license/notice review. SDK catalog and admission behavior require account-isolation and real-SDK lifecycle acceptance, not just type compatibility.

## Rollback / Recovery

Keep coherent feature commits and failed verification artifacts. Do not overwrite existing dependencies or modify the primary checkout. Retain feature resources on a blocker; integration and cleanup use separate exact-state decisions.

## Completion Checklist

- [x] Nix-only checkpoint passes required evaluation, core/static, browser and terminal checks before npm changes.
- [x] Dependency updates and retracted recommendations have explicit evidence and risk dispositions.
- [x] Final application acceptance and independent review cover the recorded source snapshot without a production build; the evidence/status-only follow-up retains separately identified checks.
- [x] Remaining security/compatibility limits have maintained owners and are reported honestly.
- [ ] Completion intent is resolved; any local integration/cleanup receives the applicable tool approval.
