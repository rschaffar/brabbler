# Local CLI web authentication

## Goal
Provide installed `brabbler auth setup` with private salted scrypt credentials and fail-closed required authentication, without browser enrollment or Nix-store secrets.

## Plan Relationship
This plan owns application/CLI, Home Manager module, focused tests and current auth documentation. Parent owns all Git operations, full acceptance/export coordination, integration and consumer NixOS configuration. Existing core optimization work is unrelated. No Git operations, live-state inspection or consumer edits were performed by this writer.

## Architecture
One shipped CommonJS `bin/web-auth-store.js` owns credential validation, persistence and bounded asynchronous scrypt. Server adapters use it directly. Stored credentials include an independent random signing key; rotation revokes cookies. Explicit environment password mode remains supported; coexistence with stored credentials locks rather than silently choosing. Required mode locks until local setup succeeds. No browser enrollment.

Interface: `brabbler auth setup [--replace]`; `$PI_CODING_AGENT_DIR/brabbler/auth/credentials.json` (default `~/.pi/agent/brabbler/auth/credentials.json`); `BRABBLER_REQUIRE_AUTH=1`; Home Manager `services.brabbler.requireAuth = true`.

## Plan
- [x] Implement shared store, hidden TTY CLI and explicit replacement; native filesystem/CLI owners pass the current focused core selection.
- [x] Integrate required/configured/locked states into proxy, login and SSH gates; preserve shared throttle and cookie security; actual route owners pass the current selection.
- [x] Add installed-package browser and genuine Home Manager VM bridges, classification and inventory inputs; both bridges passed at the earlier package identified below, not at the current review-fix candidate.
- [x] Update owning README/auth/Home Manager documentation and add the nested credential-export negative; the current run passes all 29 exporter contracts, including the signing-secret filename exclusion.
- [x] Correct both blockers from independent security review `01a17f17-11ed-75a1-aa7c-21de37a08e47` and add targeted runtime regressions.

## Review corrections
1. **Absent auth vs insecure configured auth:** legacy `brabbler/0755` with no `auth/` now remains compatible with both unauthenticated local mode and explicit `BRABBLER_PASSWORD`. Directory permission checks remain strict once `auth/` exists. Setup refuses insecure existing directories with an actionable `0700` message and never chmods them. New title-settings shared directories are created with mode `0700`, including under umask `022`.
2. **Honest listener warning:** the launcher treats missing/empty/`0` required flags as optional, `1` without credentials as required-and-locked, and invalid values as locked, matching real server admission. Whole-launcher VM tests execute the real complete program/store/argument parser with child-launch and build-artifact capabilities replaced; they do not claim a running-service bridge.

Only these review-related files changed in this correction slice: `bin/web-auth-store.js`, `bin/brabbler.js`, `lib/title-language.ts`, `lib/web-auth-store.test.mjs`, `nix/test-lanes.json`, and this plan.

## Focused evidence
Current immutable test source: `/nix/store/k9jvfdqjpjl1z4xx8mgyx90l8c4npz72-source`. Source was paused during export and execution. Ordinary synthetic Nix builders, x86_64 Linux, Node 24.21.0; requested/effective core width **2/2** for focused iteration, not full acceptance.

```sh
nix run .#test -- core --jobs 2 \
  --file lib/web-auth-store.test.mjs \
  --file lib/web-auth.test.mjs \
  --file lib/web-auth-proxy.test.mjs \
  --file app/api/web-auth/route.test.mjs \
  --file lib/browser-ssh-route.test.mjs \
  --file lib/browser-ssh-route-actions.test.mjs \
  --file lib/e2e-coverage.test.mjs \
  --file lib/nix-service.test.mjs \
  --file lib/brabbler-options.test.mjs \
  --file lib/session-title.test.mjs
```

Passed once after the correction source settled: **10 files / 91 tests**, zero skipped/cancelled/failed; **29 exporter contracts**; genuine Next typegen, TypeScript and lint (zero errors, seven existing unrelated warnings). Report: `/tmp/brabbler-test-core.joONkx/run.json`; detailed outcomes: `/tmp/brabbler-test-core.joONkx/artifacts/run-RvRI6O/summary.json`; command log: `/tmp/brabbler-cli-auth-review-core.log`. Complete command wall time **50.146s**; runner invocation **44.904s**; its pre-lifecycle setup/static/realization envelope **38.309s**; lifecycle **6.485s**, including **5.514s** test-file execution window. These nested intervals are not additive. No production build or dev server ran in the checkout.

Earlier evidence, retained without relabelling it as current-candidate acceptance:
- Initial focused core: 8 files / 64 tests, `/tmp/brabbler-test-core.VdJqqi/run.json`.
- `nix run .#test -- e2e --group ssh-agent`: passed actual installed CLI setup/mismatch/refusal/rotation, missing/corrupt API state, browser login and original desktop/mobile SSH flows; `/tmp/brabbler-test-browser.RnL6dw/run.json`.
- `nix run .#test -- service`: passed genuine HM activation, required missing-state denial, native CLI setup, stored credential/cookie persistence across a real user-unit restart, original durable writes/Pause/PTY and shutdown; `/tmp/pwv-JvgfGJ/run.json`.
- Those browser/VM runs used package `/nix/store/ard9qjppjdh1h13yj84spr1mbbncd5hz-brabbler-0.9.3`, before the two application review corrections. Current installed-package acceptance remains parent-owned.
- Earlier development failures were not hidden: `/tmp/brabbler-cli-auth-core.log` exposed the inventory count update; `/tmp/brabbler-cli-auth-core-2.log` exposed schema key-order validation. Both were corrected before the initial focused green.

## Rollback / Recovery
Credentials contain a session-signing secret as well as a verifier: retain them only as private mutable state, never source/Nix values. The existing exporter denies `credentials.json` at every admitted depth without opening it; the synthetic nested `brabbler/auth/credentials.json` negative now exercises the exact layout. Setup refuses existing state; `--replace` requires valid secure state and generates a new salt/key atomically. Corrupt/insecure state requires deliberate local repair, never automatic unauthenticated recovery. Remove conflicting environment password configuration before stored mode. Back up private state with ordinary agent backups. A legacy shared directory may require an operator's deliberate ownership/permission repair before local setup; this writer never repairs arbitrary existing directories silently.

## Completion Checklist
- [x] Current focused core/static/exporter evidence recorded, including both review regressions and the previously unrerun additive assertions/PTY leak collector.
- [x] Source stable for parent export; exact correction files and remaining risks handed off.
- [x] Parent's independent reviewer approved both corrections; no remaining auth-security blocker was identified in the scoped review.
- [x] Parent completed current-candidate core/browser/terminal/genuine-deployment acceptance; the user selected local-main integration through the separate exact-state Git gate. This implementation writer did not run full acceptance or touch consumer configuration.

## Parent complete acceptance

Command: `nix run --no-write-lock-file .#test -- all --workers 4 --jobs 4`.
Source was paused throughout export; ordinary Nix sandboxes and the genuine
Home Manager deployment guest used only synthetic state. Node 24.21.0,
x86_64 Linux, 32 available CPUs and about 30.9 GiB available RAM at admission.
The documented four/four fallback was chosen because the 43 GiB twelve/four
profile could not overlap. Requested/effective widths were **4/4**; core overlapped
browser and deployment. Prior focused checks warmed prerequisites, but the changed
production artifact was realized within this command. No host service was used.

- **Passed: 526 files / 4,316 tests / 14 suites**, zero failures/skips/cancellations.
- **Passed: 26 browser/terminal groups / 60 exact scenarios**. Every completed
  scenario set/order matched its expectation; all capsule ports were closed.
- **Passed: genuine Home Manager activation, required-state denial, real installed
  CLI setup, auth/cookie persistence across restart, durable writes/Pause, HTTP
  PTY and shutdown/closure proof**. Guest proof: 19.552s.
- Complete command: **506.373s** (8m26s), including realization. Core invocation:
  448.993s; browser invocation: 423.632s, including support realization 106.706s
  and definition preparation 5.920s; deployment invocation: 76.248s. These overlap
  and are not additive. Model/review/coordination time is excluded.
- Frozen source: `/nix/store/f5m18yx6fhiimvzp8d8v972kzzm62ia4-source`.
- Content/mode digest: `48535180a69f0596b7092a18b7797543ae485243c2fb3111f39a2fe73e1ca196`.
- Tested package: `/nix/store/iy9kal01mz7s0w10d2zlj04gmvbrbsn5-brabbler-0.9.3`.
- Core: `/tmp/brabbler-test-core.Q4Oidm/run.json` and
  `/tmp/brabbler-test-core.Q4Oidm/artifacts/run-yj7NUC/summary.json`.
- Browser: `/tmp/brabbler-test-browser.FJB8Bo/run.json`.
- Deployment: `/tmp/pwv-8vSTCt/run.json`.
- Command log/timing: `/tmp/brabbler-cli-auth-all-2.log`,
  `/tmp/brabbler-cli-auth-all-2-timing.json`.

The first full command failed honestly after 129.749s in the core inventory owner:
`lib/nix-browser.test.mjs` still expected 59 scenarios after adding the CLI-auth
scenario. Parent corrected it to 60 and added the exact SSH/auth scenario list;
no coverage guard was relaxed. A focused inventory run passed before the final
complete run. Retained failure: `/tmp/brabbler-cli-auth-all.log` and
`/tmp/brabbler-test-core.0dYpgc/run.json`; focused correction log:
`/tmp/brabbler-cli-auth-inventory-core.log`. No browser/VM success is claimed for
the failed run. Final evidence-only archival/index changes do not relabel the
full run as reexecuted; the production input identity is checked separately.

Implementation and acceptance are complete. Git integration/cleanup remain
separate gated operations, and live setup, credential handling, consumer activation
and data migration have not happened. Linux is required for the local credential
store's descriptor-relative filesystem boundary.

