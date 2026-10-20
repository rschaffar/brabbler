# Appearance, managed-model budgets and agent metrics

## Goal

Implement the user-approved first batch from the chat assessment against cached upstream `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`, selectively preserving this fork's stronger contracts. User authorized implementation after assessment and selected: all swatches/palettes; font families and weights; managed-model context budgets with existing runtime application behavior; individual agent metrics plus family summary and running badge.

## Context

- Base local `rst-main`: `1fe0a04c2d6d11e0c301457e379289d3a61f1508`.
- Feature: `feat/appearance-agent-metrics`; checkout `/home/robert/projects/3rdparty/pi-web-worktrees/appearance-agent-metrics`.
- CodeGraph initialized successfully in the feature worktree. One repository writer at a time; parent coordinates source export, checks and Git lifecycle.
- Existing October 20 easy-wins/security/follow-up and session-worktree/filter/bulk-move batches remain baseline. MCP/Code mode, sidebar redesign/placement, archive redesign, process cleanup and agent viewer tabs are excluded.
- Keep SDK 1.3.0, Node 24.21.0, Next 16.4.2 and immutable Nix packaging. No remote operations, host deployment, live-provider or credential/session-data inspection.

## Plan Relationship

Maintained architecture/feature/model/session/terminal/testing guides own ongoing contracts; existing account, Activity, Git/plugin, session-launch and Nix plans retain their scopes. This plan owns only the approved UI/metrics batch. Integration and separate cleanup require the global Git lifecycle and exact operation gates; implementation approval is not merge/deployment/publication approval.

## Architecture and decisions

- Retain `pi-theme`, existing palette IDs/default and pre-paint behavior; add upstream palettes and native-radio swatches.
- Browser-device font names only; quote as data, preserve fallback stacks, use independent family/weight resets and best-effort storage/cross-tab updates. Keep full-width/reading preference and size keys.
- Retain terminal Nerd/System selector. Nerd keeps its glyph family; System follows shared mono family. Both follow mono base weight live. Never recreate PTY/SSE for appearance changes.
- Managed-model fields edit the existing global models.json draft; switches remain separately immediate. Validate whole-token text and preserve other overrides/unknown fields. Explain global/Pi-default metadata and accounting-only limits. Existing sessions still require wrapper recreation; no model-refresh/reselection behavior is ported.
- Agent usage uses bounded ID-only read endpoints and existing stats/timing computation without starting/renewing wrappers or contacting providers. Chunk large families, cancel stale reads and pause polling while hidden. Clearly label partial/unavailable/stale data; family time is summed estimated active time, not elapsed time or an invoice. Accessible breakdown, not tooltip-only; toolbar remains selected-session-only. Running badge reuses existing running IDs. Viewing never acknowledges Activity review.

## Plan

- [x] Adapt theme swatches/palettes and font-family/weight preferences, including retained terminal behavior; add pure/component/browser regressions and update focused owning guides.
- [x] Add managed-model context-budget draft fields and client/server validation without changing account/model scopes or runtime application lifecycle; cover save/clear/invalid/duplicate-provider and pinned-SDK resolution.
- [x] Add bounded agent usage reads, accessible switcher metrics/family summary and running badge; cover zero startup, request bounds, stale responses, visibility, partial/unavailable state and ordinary navigation.
- [x] Review all changes independently for reliability/security and interface/accessibility; resolve findings before source settlement.
- [x] Run focused Nix core/browser checks while iterating, then complete fresh `nix run .#test -- all --workers 4 --jobs 4` after resource admission and paused source export. Record exact inputs, widths, results, end-to-end runtime, available preparation/execution intervals and artifact paths; retain failures without weakening checks.
- [x] Commit coherent feature history, reassess current local rst-main and rebase/verify the resulting candidate; resolve completion intent and hand the verified candidate to the Git lifecycle for exact-state non-FF integration approval. Actual integration and cleanup remain separate gated operations.
- [x] Hand maintained behavior to owning guides and archive completed implementation evidence at the verified handoff boundary.

## Risks and recovery

Upstream patches are adaptation material, not semantic acceptance. Do not replace Settings/AppShell/TerminalPanel/ModelsConfig wholesale. Preserve Activity/review, privacy, worktree filtering/recovery, bulk/move/archive ownership, optional-plugin sidecars, immutable Git review, account-bound catalogs, mobile/focus and saved preferences. No preference migration deletes old keys; model saves preserve sibling fields. Feature history can be reviewed/reverted before integration; no live data or service migration is planned.

## Evidence

All source writers are settled. Three independent read-only reviews covered appearance/terminal, model scopes/save/routing and agent metrics/read lifecycle. Corrections: defer hidden terminal metric options and remeasure via public xterm size changes; preserve delayed-font instance ownership; prefer active auth for dual providers; hide overrides-only custom forms on failed discovery with Retry; refresh rather than mutate project-shadowed enabled-model views; replace persistent SessionManager disk reads with in-memory SDK parsing/migration; omit missing/empty/mismatched files; reject nonregular targeted header candidates nonblockingly; include idle agent count accessibly. No SDK/runtime/Next/Nix dependency or live-provider change.

Focused evidence (not full acceptance):

- First `core --jobs 4` selection: 16 files / 112 tests plus typegen/typecheck/lint passed in 43s command wall time; `/tmp/pi-web-appearance-core.2OQ604.log`, `/tmp/pi-web-test-core.aVn41M/run.json`, source digest `47233b002aa426f84ad6800edacdac762a0b821d6f2c9e9ac6153c624b36673c`.
- Corrected read-only metrics selection: 7 files / 72 tests passed in 51s, `/tmp/pi-web-appearance-core2.HnVnNo.log`, `/tmp/pi-web-test-core.BFfBw5/run.json`. Final FIFO/missing/header regressions and existing reader tests: 2 files / 35 tests passed in 45s, `/tmp/pi-web-appearance-core3.S0H4Uu.log`, `/tmp/pi-web-test-core.OndkJV/run.json`.
- Activity browser desktop/tablet/mobile passed in 211s command time (113.314s capsule), `/tmp/pi-web-appearance-activity.0l1Z8c.log`, `/tmp/pi-web-test-browser.n07HhR/run.json`. Its snapshot digest is `4c02cca3672dfed76595bbc6ebee5d4249b224461c678a9acca6ed7a9226168e`; later read-only discovery hardening is covered separately, not relabeled as this run.
- Final terminal desktop DOM-fallback real-grid and normal-capability mobile chain passed in 117s command time (31.600s capsule): `/tmp/pi-web-appearance-terminal2.4L7Azg.log`, `/tmp/pi-web-test-browser.CR7Hpl/run.json`. Managed-model/settings/Markdown desktop/mobile passed in 163s command time (76.750s capsule): `/tmp/pi-web-appearance-model-browser2.sk1QyU.log`, `/tmp/pi-web-test-browser.J4HCH1/run.json`. Both used digest `8c77acac7c461d42fd3079f559d93f043240eb2e0588af26ea4612a16f8895f3`.
- Appearance palettes/contrast/native keyboard, font persistence/cross-tab/independent resets/draft metrics and constrained Settings passed in 54s command time (44.951s capsule): `/tmp/pi-web-appearance-browser4.XGXJZC.log`, `/tmp/pi-web-test-browser.Lt0hv4/run.json`, digest `c36bfb4c0fdc89363a24495e1d238e91204148dcb9c29bb5f94087fa43078b5e`.

The first four groups ran as coordinated one-sandbox focused invocations alongside four core workers, not reduced-width full acceptance. Their shared package realization is included in each command's wall time and is not a separate cold-cache benchmark; parallel intervals must not be summed. Existing unrelated ReviewFileBrowser ref-cleanup lint warnings remained warnings.

Retained failures and identified corrections:

- Appearance `/tmp/pi-web-appearance-browser.aWozLu.log`: selecting already-default System intentionally does not persist; seed a distinct preference before testing changes. `/tmp/pi-web-appearance-browser2.ssr7pb.log`: contrast helper omitted three-digit hex expansion; correct color parsing without lowering thresholds. `/tmp/pi-web-appearance-browser3.znpncG.log`: trace proved the numeric-preference init script touched storage on a new opaque about:blank page; restrict fixture seeding to HTTP(S) documents, keeping error capture intact.
- Terminal `/tmp/pi-web-appearance-terminal.OYCdP9.log`: DOM fallback has multiple measurement elements; target its specific aria-hidden glyph-measurement element, not an ambiguous locator.
- Markdown `/tmp/pi-web-appearance-model-browser.lPVexy.log`: API-key Save and global Models Save share a label; target the actual footer and join click/response promises. The original unjoined wait caused uncertain inner settlement; failed builder `/nix/var/nix/builds/nix-666352-4078435611/build` remains retained, without permission changes or cleanup.

No unchanged retries, general error suppression, deadline increases or scenario removals. Every retry followed the identified correction. Complete stable-candidate acceptance remains pending below.

## Complete acceptance and integration handoff

Implementation commit `2b24f58120f40c82b784e094b57ed952def95a1f` rebased onto current local `rst-main` `ef90c809970aebf4c412d340a67d9918a10eb1dc` (Activity Later and owned-PTY fixture teardown), producing accepted candidate **`3d213b56ccf434e330605668d106770bbebb847d`**. Range-diff shows only contextual documentation/Activity-fixture changes; Later and every original scenario remain. The first rebase request refused a stale snapshot before effects; refs/policy/cleanliness were revalidated, and the user explicitly authorized one fresh request, which succeeded. No conflict cleanup or fallback was used.

`nix run --offline --no-write-lock-file .#test -- all --offline --workers 4 --jobs 4` **passed in 636 seconds (10m36s) end-to-end command wall time**, including in-command realization. Requested/effective widths were four browser sandboxes and four core workers. Source: `/tmp/pi-web-test-source-ks95NX`, outer digest **`2673b2f8633d4e2016765aa21de7789f0c0fc0bcc23e3319b1ccffd7bc873ea8`**, selection `/tmp/pi-web-test-source-ks95NX/selection.json`; immutable common source `/nix/store/h9w2irkd1w78jzvhr2pid10n779vms0l-source`. Full log `/tmp/pi-web-appearance-all.BpTpDC.log`.

- Core/static/bundled plugins: **351 files / 2,644 tests / 12 suites**, all passed, zero failed/skipped/cancelled/not-started; `/tmp/pi-web-test-core.5IT0BE/run.json`, output `/nix/store/qfv42k6h09v4r9s5j53vqwrzx2jmjswz-pi-web-core-checks`. Inclusive level 467.684s; realization/static preparation before first file 52.304s; file-execution window 414.882s. Requested/effective core width 4/4. No observed surviving owned processes or uncertain settlement.
- Browser/terminal: **24 groups / 53 exact receipts**, every expected/completed chain and capsule verdict passed with artifact collection and settlement; `/tmp/pi-web-test-browser.kjZoVg/run.json`. Inclusive driver interval 542.309s, pre-first-capsule preparation/realization interval 111.997s and capsule span 430.166s. These are overlapping intervals, not sums of per-group times.
- Genuine Home Manager deployment: `/tmp/pwv-GLxGTd/run.json`, acceptance `/tmp/pwv-GLxGTd/artifacts/acceptance.json`; activation/default-target, private environment/permissions, durable HTTP writes/restart and real HTTP PTY passed. Driver interval 86.852s; guest evidence 21.805s. Clients settled, artifacts collected, no errors; final service inactive/dead, MainPID zero, authenticated cgroup absent and port refused.
- Browser and guest used the same production package `/nix/store/7l32f665vcx0nr6m9bsy7ri97kkj33ca-pi-web-0.9.3`. Existing baseline lint/export warnings remain nonfatal. No check deadline, inventory, isolation or error capture was weakened.

The native x86_64 host has 32 CPUs. Before launch a competing Nix workload saturated CPUs; the parent waited roughly five minutes (coordination time, excluded from the command), retaining four/four rather than reducing it. Launch samples showed >55% CPU idle and about 52 GiB available; runner admission recorded 32 CPUs/about 50.5 GiB, with overlapping 16-CPU/27-GiB estimates, not reservations. Other work may continue; this is not a machine-exclusive or cold-cache performance claim. Earlier focused runs warmed prerequisites; there was no separate prewarming command for this full run. Preparation, test execution and model/coordination time are not conflated or added as serial intervals.

The user chose **Prepare local integration**. Maintained behavior is in architecture/feature/model/session/terminal guides and e2e README; this plan is archived at the verified handoff boundary. The subsequent change is evidence/status-only: application, tests, package and Nix inputs remain identical to tested `3d213b5`. Proportional verification is diff/whitespace review and exact input equality, not a relabeled new-tip full run. The Git lifecycle's exact-state unsigned non-FF merge and separate cleanup gates own actual execution/results. No remote publication, host activation, live-provider testing or live-data migration is authorized or performed.

## Latest target reconciliation and accepted candidate

Before the merge effect, local `rst-main` advanced again to **`50b33cc9d04b952bd48606254a959b314c4a400e`**, adding independently accepted composer keyboard/focus and append-tail scanning. The merge gate refused the stale target before effects. A clean guarded rebase produced implementation `671527e` and candidate **`546764af40a99fbfc36f031233b3e7c3cf816326`**. Range review shows contextual changes only; the incoming composer, scanner, Activity Later and PTY teardown behavior remain intact. Because composer/font interactions changed, complete acceptance was run again rather than relabeling the earlier run.

`nix run --offline --no-write-lock-file .#test -- all --offline --workers 4 --jobs 4` passed on this combined candidate in **572 seconds (9m32s) end-to-end**, including realization. Source `/tmp/pi-web-test-source-Iruwg0`, outer digest **`0fcbda4e9c71eaf3eb3c674a2dc4d571809a8994cc06957a7269c3cae10e7463`**, common immutable source `/nix/store/6x4xm3xzwygmn2i24mzxzdgpymhykp7x-source`; command log `/tmp/pi-web-appearance-all2.DG9EAQ.log`.

- Core/static/plugins: **355 files / 2,668 tests / 12 suites**, all passed with zero skipped/cancelled/failed; `/tmp/pi-web-test-core.ToF1t4/run.json`, output `/nix/store/hnbfaa6585lf6smr875zxsnbfp7vwz40-pi-web-core-checks`. Requested/effective width 4/4. Inclusive interval 418.270s; preparation before first file 38.381s; file-execution window 379.275s.
- Browser/terminal: **24 groups / 53 exact receipts**, all passed, expected/completed inventories equal and settled/collected; `/tmp/pi-web-test-browser.DEivYA/run.json`. Four sandboxes; driver interval 495.700s, pre-first-capsule preparation/realization 91.005s, capsule span 404.539s.
- Genuine Home Manager deployment: `/tmp/pwv-usjmEV/run.json` and `artifacts/acceptance.json`; every activation, environment/permissions, durable write/restart and PTY proof passed. Inclusive interval 70.550s, guest 21.648s. Clients settled, no errors; final service inactive, MainPID zero, authenticated cgroup absent and port refused. Same production package as browser `/nix/store/p9c89h7fq58jkpaf8s5nixldbazsdmi2-pi-web-0.9.3`.

These intervals overlap and are not summed. Launch samples showed about 90% idle and 54 GiB available; admission recorded 32 CPUs/about 55 GiB with the same 16-CPU/27-GiB overlap estimate. Prerequisites were warmed by prior runs, with no separate prewarming command; this remains neither cold-cache nor machine-exclusive benchmark evidence. Target and feature were clean and unchanged after acceptance. This latest evidence supersedes the earlier candidate for integration; earlier runs/failures remain historical. The follow-up changes only this archived record, with exact application/test/package/Nix input equality and whitespace/diff review instead of another full application run. Exact merge approval and separate cleanup remain pending Git lifecycle operations.

## Completion Checklist

- [x] Approved first-batch behavior is implemented; excluded features remain unchanged.
- [x] Independent reviews and focused regressions are resolved.
- [x] Complete core/static/plugin, browser/terminal and genuine deployment-VM acceptance passes on identified settled inputs.
- [x] Durable guides and coherent feature commits are ready for exact-state Git handoff; results distinguish integration, cleanup and deployment.
