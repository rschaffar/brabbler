# Lighter resource listings

## Goal

Reduce repeated extension execution for settings/provider and skill listings without changing session/account/catalog ownership or loaded-skill content authorization.

## Context and Plan Relationship

User authorized implementation after a read-only assessment and chose to retain explicit session Reload for extension-code updates. Start: `rst-main` `1fe0a04c2d6d11e0c301457e379289d3a61f1508`; branch `perf/resource-listings`, linked worktree `/home/robert/projects/3rdparty/pi-web-worktrees/resource-listings`. Parent is sole writer/export/test coordinator; independent reviewers are read-only. CodeGraph initialized successfully.

Adapt cached upstream `feb40f6354704cf987739247ace0b872b7300c83`, with corrected test timeout ownership from `74e6722a`. Prior 2026-10-20 ports remain intact. Idle ModelRuntime refresh and MCP UI have separate assessments and are excluded. No remote operations, live providers/credentials/session data, installed-service probes or host activation. Preserve SDK 1.3.0, Node 24.21.0, Next 16.4.2 and immutable dependency inputs.

## Architecture and Risks

- Fresh skill loaders skip extensions; no skill-result cache. Keep trust resolution, annotations and exact current membership for content authorization.
- A separate Pi-default, explicitly project-excluded settings runtime shares construction for ten minutes and serializes each offline refresh plus detached projection. Session/account/auth/network-refresh builders remain private. `/api/models` caching and account bypass remain unchanged.
- Enabled-model edits operate once on detached catalog data with fresh request-specific settings; never replay mutations on cache invalidation.
- Structural invalidation owns only the agent-directory listing scope. Existing model-response invalidation remains separate. Plugin attempts invalidate before/after effects; ambiguous failed parallel SDK updates disable retention for that scope until process restart, without claiming sibling settlement.
- Invalidation is not cancellation or SDK factory-cache flushing. Extension code updates retain explicit Reload; offline refresh can still execute extension-provider hooks. Resource resolution retains existing package behavior.
- No persistent migration. Reverting feature commits restores previous listing behavior. Retain failures and feature resources; integration/cleanup/publication/activation are separate lifecycle operations.

## Plan

- [x] Implement extension-free fresh skill discovery; prove parity and content revocation with synthetic SDK fixtures.
- [x] Implement isolated settings listing cache and deterministic ownership/queue/expiry/failure/invalidation regressions.
- [x] Migrate provider and enabled-model listings; retain fresh settings and one-shot writes, account isolation and existing scope semantics.
- [x] Wire plugin and both session reload invalidators; test failure paths and unchanged auth/runtime boundaries.
- [x] Update owning guides and packaged browser fixtures; independently review and resolve findings.
- [ ] Run focused Nix checks, then complete fresh `nix run .#test -- all --workers 4 --jobs 4` if admitted; record exact inputs, commands/results, artifacts and timing.
- [ ] Commit coherent reviewed work and hand the verified candidate to the Git lifecycle for completion choice/exact-state non-FF integration into local rst-main and separate cleanup.

## Verification and blocker investigation

Implementation commit `8791858b9ef093757dda9b60fc7d1d644e310b50`. Focused native/static checks passed 38 tests/6 files in 101 seconds (`/tmp/pi-resource-listings-focused.Qm2Jtc.log`, `/tmp/pi-web-test-core.Krb0ar/run.json`), then 64 tests/9 files in 125 seconds (`/tmp/pi-resource-listings-focused2.hpiXmZ.log`, `/tmp/pi-web-test-core.gc7Vr4/run.json`). Packaged desktop/mobile Markdown/settings passed in 328 seconds including isolated package realization, with 130.059 seconds browser execution (`/tmp/pi-resource-listings-markdown.FPP2kZ.log`, `/tmp/pi-web-test-browser.TWEuz1/run.json`). These precede final review fixes, not complete acceptance.

Independent review identified resolved-promise refresh failures and extension-loader errors missing from retention eligibility. Both are fixed, with mock and native unchanged-factory retry regressions; follow-up found no remaining blocker. Package-disable content revocation also has a native regression. SDK registration starts background refreshes, so the listing-only runtime now serializes and observes its public refresh method before resources load; private/session runtimes are untouched.

Two complete acceptance attempts stopped at the existing Git Workflow server test's ten-second native-commit-start marker assertion. Four/four failed after 387 seconds (`/tmp/pi-resource-listings-all.hgwe7g.log`, core `/tmp/pi-web-test-core.WUB769/run.json`, browser `/tmp/pi-web-test-browser.YbkUbe/run.json`); two/two, chosen because other browser/Nix workloads remained active, failed after 408 seconds (`/tmp/pi-resource-listings-all2.XrIxNT.log`, core `/tmp/pi-web-test-core.4HavI4/run.json`, browser `/tmp/pi-web-test-browser.hFHCY6/run.json`). Neither is complete coverage/deployment evidence. Both used outer digest `75a54b5f15776a55d598e3ba933636b9f004226d215be95bc7efd022734ec6a0`. An unchanged isolated diagnostic passed all 40 server cases in 89 seconds (`/tmp/pi-resource-listings-git-diagnostic.fPOZBH.log`, `/tmp/pi-web-test-core.XDzYFS/run.json`); this alone was not treated as a fix.

User explicitly chose to investigate the Git test before proceeding. Its fixture launched Node for every preflight Git command, although only native commit needed the marker/delay. A test-only shell forwarder now execs real Git for noncommit calls and retains the original Node marker, 250ms wait, ten-second deadline, Stop/disable assertions and native-write settlement. The test also aborts/awaits pending work before restoring PATH. Regressions prove preflight forwarding works without Node, preserves stdin/arguments/status and shell-quoted paths, and retains native commit marker/success/failure behavior. No production Git or resource runtime changed in this correction.

Focused four-worker contention selection ran the original server test alongside the same cleanup/discard/project-management peers, plus final listing/skill tests and gate regressions: **328 tests/8 files passed**, 163 seconds including static preparation/realization (`/tmp/pi-resource-listings-git-fix.ruIEac.log`, `/tmp/pi-web-test-core.xt2CTU/run.json`). Independent source review found no blocker; a final assertion independently checks the failed commit writes its marker. Full settled-candidate acceptance remains required. No deadline, inventory, isolation, console-error rule or runtime/dependency pin was weakened. All timings are end-to-end command time unless separately stated, not cold-cache benchmarks or model/coordination time.

## Completion Checklist

- [ ] Listing optimization verified without weakening account/trust/content authorization.
- [ ] Independent review and complete core/static/plugin/browser/terminal/deployment acceptance pass.
- [ ] Maintained guides own behavior; evidence and unexecuted lifecycle/deployment boundaries are explicit.
