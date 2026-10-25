# Test ownership cleanup ledger

This is the **baseline census and obligation index**, not live implementation
status. The [active cleanup plan](plans/2026-10-23_complete-test-ownership-plan.md)
solely owns current blockers, verified/private/source-only states and next work.
Reuse its linked input reviews and maps; do not launch another68-file census from
the historical Pending labels below. This file is not a runner, coverage percentage
or scheduling registry. Original paths refer to census revision
`90b9dce1affaae161057e0b9292795ba35246a9e`; the continuation starts at
`29be95e872e6c070f4e198456603ac1c79b6c501`. Current executable policy remains
[Testing](testing.md); authoring rules remain [Writing tests](test-writing.md).

In the baseline, **Pending** meant an open obligation; **Partial** meant a prior
batch added proof but deficient portions remained. **Prior migrated** covers only
its reviewed obligation, not every consumer/native/browser lifetime. These labels
are not new claims that later private work never happened. Final closure requires
reconciling exact owner/bridge/proof-limit evidence, not relabelling this table.
All original native/SSR inputs remain unless separately reviewed. The user's
expanded scope now REQUIRES browser reduction before completion, not a later
follow-up. Each retired browser obligation must have an exact demonstrated real
lower owner and retained default/native/browser bridge; every retained browser
case must state a concrete failure only that boundary can catch.

## Original 68-file inventory

Paths abbreviated in the Family column still name exact original files.

| # | Original path | Family | Baseline disposition / obligation |
| ---: | --- | --- | --- |
| 1 | components/AppShell.auto-name.test.mjs | Navigation | Pending: real adoption/current naming callback |
| 2 | components/AppShell.tab-session.test.mjs | Navigation | Pending: tab/session foreground/background transitions |
| 3 | components/AppShell.workspace-memory.test.mjs | Navigation | Pending: real workspace/navigation ownership, retain actual draft-store matrices |
| 4 | components/ArchivedSessionNotice.test.mjs | Navigation | Partial: actual restore leaf migrated; shell/family/catalogue/no-clear bridge retained pending exact review |
| 5 | components/SessionSidebar.test.mjs | Navigation | Pending: actual controls/catalogue/bulk/rename/actions; useful imported rules retained |
| 6 | components/SessionSidebar.project-identity.test.mjs | Navigation | Pending: project/cwd/worktree identity and default wiring |
| 7 | components/SessionSidebar.worktree.test.mjs | Navigation | Pending: actual worktree interactions; native authority retained |
| 8 | components/SessionWorktreeTools.test.mjs | Navigation | Pending: actual worktree controls/current callbacks |
| 9 | components/SessionSidebar.file-search.test.mjs | Navigation | Pending: actual search controls/current publication |
| 10 | components/FileExplorer.reveal.test.mjs | Navigation | Pending: actual reveal effect, retain real helper/native scroll bridge |
| 11 | components/FileExplorer.uploads.test.mjs | Navigation | Pending: actual upload event/lifetime, native upload/path retained |
| 12 | components/AppShell.mobile-toolbar.test.mjs | Composer | Pending: toolbar behavior versus genuine presentation/composition |
| 13 | components/ChatInput.test.mjs | Composer | Pending: real keyboard/model events; retain real rule/SSR matrices |
| 14 | components/ChatInput.mobile-thinking-menu.test.mjs | Composer | Pending: actual thinking-menu events, browser keyboard geometry retained |
| 15 | components/ChatInput.streaming-thinking.test.mjs | Composer | Pending: actual streaming/thinking current events |
| 16 | components/ChatWindow.notices.test.mjs | Composer | Pending: actual notices/actions/effects |
| 17 | components/ChatWindow.process-details.test.mjs | Composer | Pending: actual detail interaction/current process identity |
| 18 | components/ChatWindow.quoted-branch.test.mjs | Composer | Pending: actual quoted branch actions, native fork/selection retained |
| 19 | components/ChatWindow.scroll-to-latest.test.mjs | Composer | Pending: real hook/event owner, physical browser scroll retained |
| 20 | components/ComposerFocus.test.mjs | Composer | Pending: actual focus/request revision/current callback |
| 21 | components/ChatWindow.extension-request.test.mjs | Cards/Git | Pending: actual request/current responder/follow/collapse identity |
| 22 | components/BlockingCard.test.mjs | Cards/Git | Pending mixed review: actual expand/fallback; retain genuine safe historical SSR |
| 23 | components/AgentSessionPanel.test.mjs | Prior controls | Prior migrated: actual main/order/select/search/status; real usage SSR/glyph/height retained for exact final review |
| 24 | components/SkillsConfig.dormancy.test.mjs | Prior controls | Prior migrated: initially direct dormant rows/instructions; imported ordering retained |
| 25 | components/ToolDefinitionsPanel.test.mjs | Prior controls | Prior migrated: actual schema/current selection; toolbar/CSS/narrow declarations retained for final review |
| 26 | components/GitExplorer.test.mjs | Cards/Git | Pending mixed review: actual immutable callback/graph; real SSR retained |
| 27 | components/GitExplorerPanel.test.mjs | Cards/Git | Pending: replace fake React with actual focus/Tab/Escape/selection |
| 28 | components/CommittedPatchDiff.test.mjs | Cards/Git | Pending: real binding/anchor effects; actual raw/binary/large SSR retained |
| 29 | components/TerminalPanel.test.mjs | Terminal/SSH | Pending: actual React terminal lifetime; real writer/native/browser/service retained |
| 30 | lib/ssh-agent-notifications.test.mjs | Terminal/SSH | Pending: actual local notification/preference/lifecycle, no signing authority change |
| 31 | hooks/useAudio.test.mjs | Composer | Pending: actual hook subscriptions/effects/cleanup |
| 32 | hooks/useFontPreferences.test.mjs | Composer | Pending: actual consumers/subscriptions, real store matrices retained |
| 33 | hooks/useViewportHeight.test.mjs | Composer | Pending mixed review: actual lifecycle, pure rules/native phone distinction retained |
| 34 | hooks/useStreamingSelector.test.mjs | Prior controls | Prior migrated/retired: actual layout subscriptions/current store/every commit/Unicode1000+1001/no-op publication |
| 35 | components/MobilePwaLayout.test.mjs | Composer | Pending mixed review: actual lifecycle versus genuine metadata/CSS/browser geometry |
| 36 | components/AppShell.file-viewer-state.test.mjs | Files | Partial: actual Workspace identity/watch; parked/queued/context/default composition still open |
| 37 | components/FileViewer.probes.test.mjs | Files | Partial: actual Save admission/body migrated; current supported Git/revision/private-probe gap remains |
| 38 | components/FileViewer.state.test.mjs | Files | Partial: all-five watcher behavior migrated; state/mode/restoration gap, real SSR/CSS retained |
| 39 | components/FileViewer.test.mjs | Files | Partial: stable link/page/range migrated; mode/dirty/grammar/menu/performance/style distinction remains |
| 40 | components/ImagePreview.test.mjs | Files | Pending: actual preview lifetime versus genuine native resource/browser proof |
| 41 | components/MarkdownMedia.test.mjs | Prior Files | Prior migrated/retired: actual audio/video/visibility/identity/Strict cleanup; native playback retained |
| 42 | hooks/highlighting.test.mjs | Files | Pending: actual highlighting lifecycle/demand; loader/native selection/chunk bridges retained |
| 43 | components/AgentsConfig.test.mjs | Settings | Pending mixed review: real config/events versus legitimate SSR/import |
| 44 | components/ChatAppearance.test.mjs | Settings | Pending mixed review: real settings/store behavior versus genuine style |
| 45 | components/EnabledModelsSection.test.mjs | Settings | Pending: actual model scope/currentness/mutation, native policy retained |
| 46 | components/FontSettings.test.mjs | Settings | Pending: actual control/store events, native font/layout retained |
| 47 | components/ModelsConfig.test.mjs | Settings | Pending mixed review: actual model/provider forms/helpers, native account/security retained |
| 48 | components/SettingsPanel.test.mjs | Settings | Pending: actual selection/persistence/events, default/browser bridges retained |
| 49 | components/SettingsUi.test.mjs | Settings | Pending mixed review: actual controls and genuine primitive SSR/CSS |
| 50 | hooks/compaction.test.mjs | Models | Pending: actual compaction/lifetime, native settlement retained |
| 51 | hooks/interaction-receipts.test.mjs | Models | Pending: actual receipt/current ancestry/publication, native authority retained |
| 52 | hooks/model-loading.test.mjs | Models | Pending: real metadata/currentness/retry/abort, no shortened policy |
| 53 | hooks/model-scope-startup.test.mjs | Models | Pending: real atomic startup/pins/defaults, native constructor retained |
| 54 | hooks/model-speed.test.mjs | Models | Pending: actual speed intent/reconciliation, native SDK/default bridge retained |
| 55 | hooks/new-session-persistence.test.mjs | Models | Pending mixed review: preserve actual mounts, replace extracted gaps with honest effect/work joins |
| 56 | hooks/useAgentSession.model-selection.test.mjs | Models | Pending: actual pending/rollback/canonical/A-B-A selection; prior callback strengthening retained until replacement |
| 57 | hooks/useAgentSession.test.mjs | Models | Pending: exact source-behavior/default boundaries and actual hook lifetimes |
| 58 | app/api/agent/events-route.test.mjs | Backend | Pending: actual startup/abort/header route behavior; allocation guard separately justified |
| 59 | app/api/files/watch-route.test.mjs | Prior backend | Prior migrated: actual GET/SSE replacement/missing/ordering plus five original runtime cases |
| 60 | app/api/files/stream-route.test.mjs | Backend | Pending: imported/full handler stream/header behavior; real descriptor/ranges retained |
| 61 | app/api/sessions/context-route.test.mjs | Backend | Pending: actual URL/branch/pagination wiring, native reader/ancestry retained |
| 62 | app/api/sessions/runtime-route.test.mjs | Backend | Pending mixed review: actual default JSONL/API plus deficient wiring appendix |
| 63 | lib/provider-api-key-route.test.mjs | Backend | Pending: actual no-network/write/signal/store/error behavior; credentials never exposed |
| 64 | lib/project-trust.test.mjs | Backend | Pending mixed review: actual reload/revocation, native trust safety retained |
| 65 | lib/rpc-manager.test.mjs | Backend | Pending mixed review: actual startup/resource/shutdown ordering; native SDK retained |
| 66 | lib/subagent-runtime.test.mjs | Backend | Pending mixed review: actual inheritance/runtime behavior; real native identities retained |
| 67 | lib/session-reader-external-write.test.mjs | Backend | Pending mixed review: real replacement registration/settlement; native external writes retained |
| 68 | plugins/git-workflow/operation-paths.test.mjs | Backend | Pending: imported actual idle-path checks, native checkpoint revalidation retained |

## Additional named gaps — baseline obligations

- Privacy: add real `useHiddenProjects`/Settings control owner for conceal-before-
  write, failed reveal, current bodies/busy refresh and cleanup. Existing real
  privacy SSR/native/browser proof stays; it was not counted in the68 replacements.
- Four new broad-import holds: FileViewer text/media, Workspace and Skills require
  actual dependency/effect/lifetime classification. E scheduling is not a join or
  a reason to claim safe native closure; no automatic promotion from focused green.
- Shared mount exception handoff: failure cleanup must allow owned work joins
  before realm/global disposal where a fixture claims that ordering. Do not hide
  the previous failed model prototype's act/work diagnostics or invent idle.
- Preserve all prior lower owners/default/native bridges and immutable audit
  evidence. Existing independent native-resource E concerns are not erased by
  this ownership migration or confused with the count of candidate files.

## Mandatory browser retirement and speed

The latest guidance in requested session
`01a16ad7-c3a7-73ef-85b0-1fb4edfc2831` restores the original optimization goal:
exhaustive state/interaction/race matrices belong in actual controllers/mounted
React; browser coverage is the last necessary layer. The final consolidated map
remains open, but substantial source-bound maps/reviews already exist in the active
plan's evidence. Reconcile those; do not infer closure from68-file or test counts.

Retain thin installed-app controls/API/SSE/reload/restoration journeys; materially
different responsive geometry/overflow/visibility/scroll; genuine focus/selection/
keyboard/dialog/clipboard/paste/upload/download/pointer semantics; thin browser
networking and real native rendering/xterm/PTY bridges. Native filesystem/Git/SDK/
authorization/service-lifecycle proofs remain real at their sufficient native or
VM owner rather than being duplicated as browser permutations.

Before retirement, record original group/case/viewport/input/receipt, exact lower
case and evidence, retained integration witness, incremental browser-only failure
(or why none remains), source-fault sensitivity and independent review. Update
fresh definitions/inventory/receipt expectations explicitly; no required-input
skip, fixture weakening or hidden reduction. Fewer journeys must carry more
integration value, not less proof.

Completion additionally requires measured NET end-to-end feedback improvement at
4 browser workers/4 core jobs against a matched settled unreduced reference, while
retaining the original timing ceilings. Record browser, core, preparation and
focused feedback separately; transferred cost or wider concurrency is not a gain.
The historical342s baseline is not current or matched-candidate evidence.

## Evidence and final closure

The initial accepted baseline is449files/3470tests/12suites,26browser/terminal
 groups/59receipts plus genuine deployment,342s at4/4; this is not new execution.
Parent preserves source/hash-bound packet maps, original assertions/tuples, runtime
fault witnesses, failed variants, focused outcomes and final acceptance. Complete
status and exact retained boundaries belong in the active plan and its final
consolidated mapping; the baseline table is not a second current-status document.
No merge until original obligations, added gaps, actual browser retirements and
matched performance gates close.
