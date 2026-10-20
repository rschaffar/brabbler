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
- [ ] Run focused Nix core/browser checks while iterating, then complete fresh `nix run .#test -- all --workers 4 --jobs 4` after resource admission and paused source export. Record exact inputs, widths, results, end-to-end runtime, available preparation/execution intervals and artifact paths; retain failures without weakening checks.
- [ ] Commit coherent feature history, reassess current local rst-main and rebase/verify resulting candidate; ask completion intent and use exact-state non-FF integration approval if selected. Cleanup remains separate.
- [ ] Hand maintained behavior to owning guides and archive completed implementation evidence at the verified handoff boundary.

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

## Completion Checklist

- [ ] Approved first-batch behavior is implemented; excluded features remain unchanged.
- [ ] Independent reviews and focused regressions are resolved.
- [ ] Complete core/static/plugin, browser/terminal and genuine deployment-VM acceptance passes on identified settled inputs.
- [ ] Durable guides and coherent feature commits are ready for exact-state Git handoff; results distinguish integration, cleanup and deployment.
