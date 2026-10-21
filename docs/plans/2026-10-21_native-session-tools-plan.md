# Native session tools — reduced first release

## Goal

Deliver SDK-native, browser-controlled MCP selection and tools-only Code-mode for ordinary sessions. User approved this reduced scope on 2026-10-21 after reviewing the maintenance cost of the broader configuration/OAuth project.

## Context and plan relationship

Start from local `rst-main` `be8251c23eb53d91aba038e475ceead29538870f` in `feat/native-session-tools`, checkout `/home/robert/projects/3rdparty/pi-web-worktrees/native-session-tools`. Preserve `feat/mcp-codemode-nix`, its dirty worktree and companion Nix work unchanged. The earlier broad plan is parked, not completed or silently integrated. Its tests/findings are reusable evidence about contracts, not acceptance of this implementation.

Parent is sole writer/Git/test coordinator; delegates are read-only. No live credential/session inspection, provider calls, host-service operations, deployment, remote publication or cleanup. Integration remains a separate exact-state approval.

## Architecture

- SDK 1.3.0 owns Code-mode, tool search, MCP protocol, transports and shutdown. Keep Node 24.21.0, Next 16.4.2 and Nix packaging.
- A versioned session marker records explicit Code-mode and exact scoped MCP selection. Legacy and child sessions default off; Chat-only suppresses effective resources.
- Read only native global/project MCP declarations. Discovery is inert and exposes categorical metadata, never secret values. Trusted project replacement/partial override semantics remain native-compatible.
- Capture a fixed configuration for each wrapper. Configuration saves do not mutate running wrappers. Explicit apply/reload replaces only the selected idle wrapper using existing retirement/startup barriers; no in-place native reload, preparation epochs or global wait.
- Tools-only Code-mode (`models:false`), native deferred/tool-search semantics, hidden-tool denials and direct-model-only host controls. Native tool ownership must match the effective SDK definition, not merely its name.
- Stdio receives a small environment plus explicit runtime references. HTTP supports static/runtime-reference headers and public endpoints. No command helpers, OAuth or provider-token forwarding. No persistent MCP credential store, refresh coordinator or browser login flow. Suppress native configuration/auth commands and private raw diagnostics.
- Preserve trust revocation, cancellation, awaited SDK shutdown and existing browser file-authorization boundaries. Native server metadata/results do not grant filesystem roots.

## Non-goals

Whole-configuration baselines/overrides/export/activation, Nix promotion/Git plugin and companion tooling; browser MCP editing; OAuth/provider-token forwarding; child-profile grants; live configuration reconciliation. Existing normal Nix packaging/acceptance remains required.

## Plan

- [x] Preserve the old feature and create/index a clean linked worktree from current local `rst-main`.
- [x] Implement minimal persisted session selection and inert native MCP capture; scoped Nix tests cover legacy/Chat-only defaults, exact scopes/overrides and non-reflecting diagnostics. Child grants remain unavailable.
- [x] Compose SDK-native tools with fixed per-wrapper ownership and no credential persistence; actual SDK QuickJS/stdio/HTTP fixtures verify exposure, no model/Node bridge, environment/reconnect isolation, private credential non-adoption and shutdown.
- [x] Integrate selected-session idle replacement, fork/clone/reopen/account/tool preservation and explicit reload; tests cover unpublished startup, direct/concurrent destruction, unchanged SDK identity, unrelated busy wrappers and in-place reload refusal.
- [x] Add a small composer resource selector/status UI and bounded parent-native result/progress display; focused installed-package Chromium scenarios pass desktop/mobile, including draft/history, denied built-in write and lost-ack reconciliation.
- [x] Obtain independent core and UI safety reviews, resolve concrete findings and update the maintained native/session/testing guides. Full acceptance remains separate.
- [ ] Run complete Nix core/static/plugin, all browser/terminal groups and genuine deployment VM acceptance on the settled source; record exact input identities, commands, scope, timing and artifacts.

## Risks and recovery

SDK 1.3 does not export all MCP configuration/credential types at its package root. Any unavoidable version-scoped bridge must remain small, isolated and tested in the installed package; do not recreate its engines. SDK lifecycle handler errors are caught internally, so host construction/replacement must not infer successful admission from an emitted event. Existing wrappers keep immutable captured declarations until explicit replacement; security trust revocation still closes new effects. Cancellation cannot undo already-dispatched remote actions. Preserve old work and diagnostics; do not delete configuration or credentials to recover.

## Focused implementation evidence

- New worktree/index from local `rst-main` `be8251c23eb53d91aba038e475ceead29538870f`; the requested rebase check found feature/base identical. Old broad feature and companion work are preserved, including dirty files. No integration, deployment, remotes or cleanup.
- Core reviewer `01a15e92-d870-72e8-9af1-d7e6ba57316b` found/followed up startup adoption, explicit trust after config disappearance, reconnect environment drift and direct/concurrent shutdown overlap. Fixed with existing startup/SDK-ID barriers, frozen owner input and one shared SDK shutdown completion, not hot-reload generations. Final follow-up found no remaining concrete core flaw.
- UI reviewer `01a15ede-c9c2-72e8-9af1-d7f39c73c65a` found post-import selection publication and stale lost-ack tool/system projections. Rechecks and captured-live-wrapper read-only reconciliation close these; final source follow-up found no remaining concrete issue. Native-call display never grants roots or rewrites parent errors.
- Focused static/exporter/core evidence: 29 exporter contracts plus **13 files / 218 tests**, **71s end-to-end**, `/tmp/pi-web-native-tools-core.o7ftxf.log`. Follow-up display/API/coverage/native-lifecycle selection passed **5 files / 54 tests** in **54s**, `/tmp/pi-web-native-ui-core.w2E3A2.log`, `/tmp/pi-web-test-core.N2TjFa/run.json`. Commands use `nix run --offline --no-write-lock-file .#test -- core --offline --jobs 2` with exact selections retained in reports. Focused jobs two; the new native/API/display suites use exclusive fallback. Separate static/preparation/execution intervals are not recorded here. Two pre-existing ReviewFileBrowser lint warnings only. Earlier display selection: 44s, `/tmp/pi-web-native-display-core.QT8gpg.log`.
- Focused browser command `nix run --offline --no-write-lock-file .#test -- e2e --offline --group native-tools` passed both scenarios in **19s end-to-end**, with already-realized production package; sandbox interval **9.887s**. `/tmp/pi-web-native-tools-browser.K07QdE.log`, `/tmp/pi-web-test-browser.Il1d3u/run.json`; source `/tmp/pi-web-test-source-lYMEaf`, digest `e11c8cc7bcddabce76c33072a86ac801de8dd8de98193684ffed57c6b0879bff`. One ordinary Nix sandbox; actual installed SDK, stdio process and QuickJS. No host service/provider use.
- Retained browser failures: `.PxrDtj.log` (116s including production realization; fixture forgot the existing process group's automatic completion collapse), `.d9ZlzH.log` (44s; genuine UI bug cleared unknown-ack errors on incidental selection-prop refresh), `.JKZN1L.log` (92s including changed package; mobile inherited the deliberately submitted desktop busy-session user turn). Fixed the UI reconciliation, reopened the normal process disclosure and compared actual pre-Apply message counts. Exact failure capsules remain retained; no errors hidden, unchanged retry or deadline inflation.
- Native interaction follow-up `01a15efb-c3aa-72e8-9af1-d7fdeb3375ee` traced installed nested execution through normal pipeline authorization; browser questions/receipts stay independent and optional Git tools are model-only. No concrete bypass/misattribution found. Fixture audit `01a15f02-f83c-72e8-9af1-d7fe47342e6a` found no further stale bindings beyond the two failures below; source-only, not execution evidence.
- Candidate `07b6a6717696cfb326c5013e505b834865121c3a` committed and successfully rebased (already up to date) on `be8251c23eb53d91aba038e475ceead29538870f`. Full `all --offline --workers 4 --jobs 4` admission had 32 CPUs/44 GiB available; `/tmp/pi-web-native-tools-all.ftvWAD.log` failed after **166s** at the old directory-reservation source-extraction fixture's missing native bindings. Core `/tmp/pi-web-test-core.Xe15o4/run.json`: 13/398 files passed, 1 failed, rest not started; browser `/tmp/pi-web-test-browser.cUTkDB/run.json` was coordinator-interrupted after core failed. No full pass claimed.
- Full-core follow-ups retained `/tmp/pi-web-native-tools-full-core.IX5O2D.log` (**131s**, `/tmp/pi-web-test-core.2Sc1PG/run.json`) and `.0DWRC5.log` (**133s**, `/tmp/pi-web-test-core.tzJf8G/run.json`). Bind the actual pure selection exports and real SDK in-memory manager into the extracted startup harness, rather than suppressing its existing admission assertions. The next failure was the strict new-session route VM fixture's missing selection-module binding. Both fixtures now use the actual pure module. Added API forwarding/negative coverage then caught invalid native input returning 500; changed that boundary to categorical 400 before startup, retaining prompt-rejection semantics. `/tmp/pi-web-native-fixture-core.a3uK3o.log` (**44s**, `/tmp/pi-web-test-core.aMyXxW/run.json`) retains that failure. No test deadlines or checks weakened.
- These are focused/failed results, NOT whole acceptance or new-tip evidence after later changes. Complete core/plugin/browser/terminal/deployment checks remain open.

## Completion Checklist

- [ ] Browser feature works through actual SDK engines with focused regressions and resolved independent review.
- [ ] No deferred configuration/OAuth/profile/Nix machinery has entered the first-release path.
- [ ] Complete acceptance and maintained documentation match the exact candidate.
- [ ] Clean feature history is ready for separately approved local non-FF integration; no deployment/publication/cleanup implied.
