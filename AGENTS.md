# Pi Web - Development Notes

<!-- project-workflow-align: baseline-v3 -->
## Project Git Profile

The global `git-worktrees` skill owns feature history, rebasing, verification,
exact-state approval, remote boundaries, and cleanup. This repository makes
worktree isolation, the local integration target, and method mandatory below;
all other lifecycle safeguards remain in force.

- **Canonical instruction owner:** `AGENTS.md`; there are no harness-specific instruction files that need delegation.
- **Worktree isolation (required):** Make every repository change on a dedicated feature branch in a linked worktree, starting from the current local `rst-main`. The primary checkout is for approved integration only, never direct feature edits. If an existing linked worktree already fits the task, work there; do not create another just for this rule.
- **Local integration target (required):** Integrate completed work into local `rst-main`. Rebase on its current local tip, verify the exact candidate, and obtain exact-state approval before integration. If blocked, retain the feature resources and resolve the blocker rather than bypassing safeguards.
- **Local integration method (required):** Use an ordinary unsigned **non-fast-forward merge**. Do not fast-forward or squash into `rst-main`. Remote publication and feature-worktree cleanup remain separate approvals.
- **Commit signing and authorship:** No project-specific signing or identity requirement; the global lifecycle applies.
- **Required verification:** Use the common checks in this file and `README.md`: `npm test`, `node_modules/.bin/tsc --noEmit`, and `npm run lint`, narrowed or extended for the affected area. Run `npm run test:e2e` for affected browser flows and `npm run test:terminal` for terminal integration changes. Never run `next build` or `npm run build` during normal development; production builds are release-only.
- **Publication constraints:** `docs/release.md` owns the release process. GitHub pushes/releases and npm publication require separate, explicit authorization for the exact remote operation.
- **Planning workflow:** `.agents/skills/writing-plans/SKILL.md` owns plans under `docs/plans/`; durable decisions belong in `docs/adr/`, and current operational or contributor behavior belongs in the focused guide under `docs/` or `README.md`/`AGENTS.md`.
- **Intentional deviations or incompatible rules:** The required linked worktree, `rst-main` target, and non-fast-forward merge replace the global lifecycle's optional direct-checkout, alternative/no-target, and fast-forward/squash choices for this repository. Keep its inspection, clean-state, verification, exact-state approval, remote boundary, and separate cleanup safeguards. Preserve the stronger no-build-during-development rule above.

Do not copy the global lifecycle into this section. If another applicable rule
conflicts with these project requirements, stop before mutation and ask which
rule applies to the bounded task. A task-specific answer does not rewrite this
profile.

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

### Dev server troubleshooting

- Before starting a server, run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse the existing Pi Web process when it is healthy. A second `next dev` for the same checkout cannot use a different port as a workaround because both processes contend for `.next/dev/lock`.
- A browser-only `Module ... factory is not available` overlay usually means that tab has a stale Turbopack/HMR graph; it does not prove the server or source is broken. First call the browser's explicit reload action, then compare the current server log and a direct HTTP/API request.
- Restart only after the failure reproduces from a fresh page and the server-side checks also fail. Stop the exact dev process gracefully, move `.next` into a `mktemp -d` backup, and restart with the standard `npm run dev` command.
- Do not use `next dev --webpack` as a fallback. This repository's development graph can fail on `undici` imports such as `node:console`; development is expected to use Turbopack.
- Next.js may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md` when `next dev` starts. Treat that as generated tooling output, verify it with `git status`, and do not include it in an unrelated feature commit.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/move/route.ts     POST relocate an idle session family to another cwd
  starred-sessions/route.ts        GET list | POST set/import stars
  activity/review/route.ts         POST acknowledge/import settled completions
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  auth/api-key/[provider]/route.ts POST/DELETE provider API key storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth and API-key provider lists
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models/enabled/route.ts         GET/PUT enabledModels switches for the Models panel
  models/refresh/route.ts         POST fetch provider catalogs from pi.dev on demand
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  subagents/settings/route.ts     GET/PUT built-in subagent feature setting
  worktrees/route.ts              GET/POST/DELETE git worktrees (explicit local base/tip on creation)
  git/workflow/route.ts           legacy project/session policy compatibility
  git/workflow/settings/route.ts  GET scoped settings/task | PUT revision-checked defaults, session overrides, pause or settings capture
  git/workflow/task/route.ts      GET private binding status | POST exact source preview/adopt/cancel/release (metadata only)
  git/explorer/route.ts           GET worktree-scoped read-only history/commit/file patch
  git/commit/route.ts             POST human preview/confirm selected local whole-file commit
  git/review/route.ts             GET local branch review | POST capture read-only bounded comparison
  git/actions/[actionId]/route.ts GET anchor-authorized durable metadata / lazy captured artifact
  git/integration/route.ts        GET check receipts | POST explicit verify/plan/confirm local merge
  git/workspace-transition/route.ts GET server-owned post-run worktree transition status
  web-auth/route.ts               GET status | POST login | DELETE logout (browser password)
  plugins/check/route.ts          POST check plugin package updates
  project-trust/route.ts          GET/POST project trust for package installs
  sessions/search/route.ts        GET session search
  sessions/[id]/state/route.ts    GET live wrapper state when the session is running
  sessions/[id]/auto-name/route.ts POST generate a session title
  sessions/title-model/route.ts      GET/PUT server-wide title model preference
  terminal/route.ts               POST create a terminal session
  terminal/[id]/route.ts          GET stream | POST input/resize | DELETE kill
  cwd/browse/route.ts             GET browse allowed cwd directories
  app-update/route.ts             GET current vs latest published pi-web version
  file-index/route.ts             GET file list for @-mentions
  git/status/route.ts             GET changed files for a cwd
  git/diff/route.ts               GET diff for one changed file
  provider-usage/query/route.ts   POST provider usage quotas
  push/config/route.ts            GET VAPID public key for push subscriptions
  push/subscribe/route.ts         POST register a push subscription
  tools/settings/route.ts         GET/PUT shell tool settings (PowerShell on Windows)

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  enabled-models.ts    pure minimal-edit engine for the `enabledModels` pattern list
  enabled-models-runtime.ts  SDK adapter: per-pattern resolution, provider kinds, settings IO
  markdown.ts          shared markdown helpers
  node-cli.ts          locate bundled npm-cli.js / npx-cli.js so npm/npx spawn without a shell (Windows npm.cmd)
  npx.ts               npx runner used by skill install
  plugin-updates.ts    npm view update checks for /api/plugins/check
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  session-move.ts     staged JSONL relocation + fork/subagent path repair
  starred-sessions-server.ts  server-owned star list + serialized atomic edits
  activity-review-server.ts  durable bounded completion and review ledger
  subagent-settings.ts  read/write ~/.pi/agent/agents/settings.json
  tool-presets.ts     PRESET_NONE/READ_ONLY/DEFAULT/FULL + getPresetFromTools()
  tool-preset-preference.ts  browser-persisted default for fresh sessions
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations
  git-workflow-policy.ts  validated policy, session snapshot/opt-out and fork inheritance
  git-workflow-store.ts   private canonical-project defaults for new sessions only
  git-workflow-extension.ts / git-workflow-context.ts  conditional instruction-layer Git guidance plus exact-type legacy reminder filtering; not an operation grant
  agent-git-workflow-extension.ts  early chat choices, policy-independent candidate comparison and exact approvals
  agent-git-preferences.ts  validated session-scoped early choices (not execution approval)
  git-commit.ts / git-commit-extension.ts  guarded preview/confirm engine and session-bound agent tool
  git-action-journal.ts / git-action-controller.ts  private evidence/artifacts and plain custom anchors (never replay authority)
  git-action-human.ts  expiring process-only browser candidates, independent of history
  git-review.ts         read-only local first-parent merge/commit/range comparisons
  git-explorer.ts       session-independent bounded selected-worktree history/commit/patch reads
  git-graph-layout.ts   adapted MIT active-lane graph layout (see git-graph-layout.LICENSE)
  git-verification.ts   explicitly selected saved checks + short-lived state-bound receipts
  git-integration.ts    exact-state, unsigned non-FF local merge with partial-state recovery
  git-checkout-gate.ts  in-process agent command gate during checkout transactions
  git-workspace-start-extension.ts  explicit agent worktree creation and durable session intent
  git-workspace-transition.ts  private one-shot post-run transition receipts

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  GitWorkflowHome.tsx      single Global/Project/Session editor, captured task status and focused action views
  GitWorkflowSettings.tsx  legacy editor compatibility and explicit worktree continuation/fork detail
  GitCommitPanel.tsx  human whole-file preview/confirm; working diffs are not the candidate
  GitMergeReviewPanel.tsx  on-demand read-only comparisons plus separately approved local verification/merge
  GitActionDialog.tsx  live comparison/approval controls, coalesced into matching history when mounted
  GitActionCard.tsx / MultiFileGitDiff.tsx  durable read-only outcomes and lazy captured split diffs
  GitExplorer.tsx    local-branch visual history for sidebar-selected worktree
  GitExplorerPanel.tsx  wide graph/detail sidecar beside chat
  GitCommitViewer.tsx  committed-file patches and copy controls inside Git panel, no checkout reads
  CommittedPatchDiff.tsx  split/unified/raw Git patch renderer using @pierre/diffs
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  EnabledModelsSection.tsx  model switches inside ModelsConfig, backed by enabledModels
  AgentsConfig.tsx    built-in subagent toggle + agent profile editor
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes by default (`PI_WEB_IDLE_TIMEOUT_MS`, `0` disables). Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** ("New session" on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** ("Edit from here" / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `handleAgentEvent` in `hooks/useAgentSession.ts` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` -> `toolNames[]`) and persisted in versioned `pi-web:tool-selection` custom entries. No entry means a legacy session and keeps Pi's default behavior; an empty array means Chat only. Chat only resolves before services are created, loads no extensions/skills/prompts/themes, and replaces Pi's base prompt with the ordered contents of Pi's discovered context files. Crossing the Chat-only boundary rebuilds the wrapper; changing between nonempty presets updates it in place.

**Exact system prompts go through `before_agent_start`.** Since pi 0.86 the prompt lives in the transcript: `agent.state.systemPrompt` is a getter replayed from persisted system messages (assigning it throws), and the agent loop's request context has no `systemPrompt` field, so neither mutating the state nor patching `prepareNextTurnWithContext` reaches the model. Chat-only sessions and subagent profiles in replace mode register `lib/exact-system-prompt.ts` as an inline extension factory on the resource loader; its `before_agent_start` handler returns `{ systemPrompt }`, which the SDK projects as the provider's leading system prompt for the whole run while the transcript keeps recording Pi's structured sections. `get_state.systemPrompt` reports the exact prompt for those wrappers because the SDK state only shows the structured sections. Subagents persist their active tools plus profile-level skill and extension loading switches in `resourceSnapshot`; loaded extensions cannot expose the reserved `Agent`, `get_subagent_result`, or `steer_subagent` tools to a subagent. See `docs/adr/0002-chat-only-tool-selection.md`.

The last preset explicitly selected by the user is stored in browser `localStorage` and initializes fresh-session composers only. Existing sessions never trust that preference; they use their live `get_tools` state or pi's default when no wrapper exists.

### Generated session titles
General Settings stores a server-wide optional title model beside the title language in `~/.pi/agent/pi-web/title-settings.json`. The default is the session model. A selected provider/model ID resolves through the active session's `ModelRuntime` so it uses that session's provider account, without switching the chat model; if it disappears, title generation errors rather than silently charging the chat model. The picker lists models visible for the selected session via `/api/models`.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

### Remote provider catalogs
pi's built-in model lists are generated when the SDK is built and pi-web pins one SDK version, so a model a provider ships after that release is invisible until pi-web publishes a new version (#914). The SDK carries the other half: each built-in provider is wrapped in a pi.dev catalog overlay that `ModelRuntime.refresh()` fetches and persists to `~/.pi/agent/models-store.json`, and restoring that overlay needs no network. Both of pi-web's refresh paths ask for the offline half only (`createAgentSessionServices()` and `lib/provider-usage.ts` pass `allowNetwork: false`), which is why running the pi CLI once used to be the fix — the CLI refreshed with the network on and pi-web read what it left behind.

`lib/model-catalog-refresh.ts` runs that network pass, and **only when the user asks for it**: the "Refresh catalog" button in `EnabledModelsSection` posts to `/api/models/refresh`. Nothing refreshes catalogs on a timer or on another request's path — a pass fetches a catalog per authenticated provider, and a save must not wait on a slow one, the same reason `/api/auth/api-key/[provider]` stores the credential itself instead of calling `ModelRuntime.login()`. `refresh()` is called with `force: true`, since pressing the button is exactly a request to skip the SDK's four-hour freshness window, but *without* `allowNetwork`, so the runtime keeps applying its own `PI_OFFLINE` rule instead of pi-web overriding it; the module reports `reason: "offline"` rather than pretending a pass ran. `shareModelCatalogRefresh()` joins concurrent presses for the same providers so two tabs cannot race over the store file.

Change detection compares the model ids and names the runtime exposes, never the stored bytes: a successful revalidation rewrites `checkedAt` and `etag` on every pass. It only decides whether `invalidateModelsCache()` runs and whether the panel reloads — the overlay itself reaches the UI through the ordinary `/api/models` and `/api/models/enabled` loads, which build a fresh runtime that restores the store, so the refresh route never returns a model list of its own.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-web and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

Editing that setting from the Models panel goes through `/api/models/enabled`, never through pattern strings composed in the browser. Each toggle is a **minimal edit** of the stored list (`lib/enabled-models.ts`): a pattern that matches no available model is preserved verbatim, only the pattern covering the switched-off model is expanded in place (keeping its `:level` suffix), and every provider that ends up fully enabled with two or more entries collapses back into one glob — pi refreshes provider catalogs from the network into `models-store.json`, so an enumerated list rots when a model is renamed (deepseek's `deepseek-v4-flash` became `deepseek-flash`), while a glob heals itself. A lone exact reference is a deliberate pick and is left alone. **Never assume `provider/*` covers a provider**: pi matches with minimatch, whose `*` stops at `/`, so that glob silently misses every nested model id (`commandcode/sakana/fugu-ultra`, most OpenRouter ids) — writing it turned "enable all" into 15 of 71 models. `resolveProviderGlobs()` resolves `provider/*` then `provider/**` and keeps one only when its match set is exactly the provider's models; a provider that neither covers is written model by model. Also never rewrite the whole list from `getAvailable()` the way the TUI's `/scoped-models` does — it only sees providers that currently pass `checkAuth()`, so that would delete every entry for a provider whose credential is missing right now, and flatten globs and pins.

Disabling the last enabled model is refused with `409 { reason: "last-model" }`: pi falls back to every model when a scope resolves to nothing, so an empty list silently means the opposite. Writes always target the global settings file; a project `.pi/settings.json` replaces the global array instead of merging, so the route reports `scope: "project"`, renders the switches read-only, and returns that file's path as `settingsPath` — the banner names the file it just wrote (`~/.pi/agent/settings.json · enabledModels 20/104`) instead of describing the effect in prose. Built-in *and* extension-registered providers get per-model switches; models.json providers are switched as a whole by `EnabledModelsProviderSwitch` in their detail header, next to Delete, because a custom model can simply be deleted and both bulk buttons only ever sent the same provider-wide write. That switch is on only when every model of the provider is on, so a partial selection reads as off beside the sidebar's `1/2` badge and one click completes it; reading it as "any enabled" would leave partial unreachable in both directions once the last-model guard blocks the way down. Why it cannot move is its tooltip, not body text. `op: "prune"` is the only operation that drops unmatched entries, for cleaning up after such a rename; everything else preserves them. Saving models.json re-reads the switches through `op: "resync"`, which repairs the stored patterns against the new catalog: it rewrites renamed **models** and then renamed **providers**, **cuts back entries whose provider prefix no longer scopes them**, and re-asserts the providers that were fully enabled before the save. (Model references first: they still spell the old provider id, which the provider rewrite would otherwise have replaced already.) All three are needed because a pattern's meaning depends on the catalog. pi matches a pattern against the bare `modelId` as well as `provider/modelId`, so `stepfun/*` also matches another provider's model whose id *is* `stepfun/Step-5-Preview` — renaming a provider to `stepfun` silently enabled three `commandcode` models, and switching stepfun off then wrote them into the file. In the other direction, renaming a model to an id with a slash drops it out of `provider/*` (minimatch `*` stops at `/`), so a fully enabled provider silently loses it. A model renamed in the panel is a known move, not the kind of mismatch worth preserving: leaving `stepfun/ddd` behind after it became `stepfun/ddd1` loses the selection, and when it was the only entry the scope resolves to nothing, which pi reads as "no scope" and quietly enables every model. `ModelsConfig` mirrors every array move of the draft in `savedModelIdsRef` so `collectModelRenames()` can tell a rename from an add or a delete without guessing. Only `resync` repairs entries; ordinary toggles stay minimal edits and never rewrite what the user did not touch. A models.json provider missing from the runtime (unsaved edits, no models, a key that does not work) must not be reported as a sign-in problem, which is why it has its own control: the switch renders disabled with that reason as its tooltip, while `EnabledModelsSection` — now built-in only — keeps the sign-in empty state. See `docs/adr/0004-enabled-models-toggles.md`.

### Context-file change notice
A live ordinary session retains the context files (`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`) loaded at startup or last session reload. `get_state` compares that snapshot to the SDK's read-only `loadProjectContextFiles()` discovery, so new, edited, removed, and newly overriding files offer a **Reload session** button in the selected chat. The browser polls while visible and checks on visibility return; it does not reload resources automatically or create a wrapper just to check. Chat-only sessions also load context files; subagents with context loading disabled do not show the notice. Other resources (skills, extensions, prompts, themes) are not monitored by this notice.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Transcript system messages, usage entries and context edits (pi >= 0.86)
- Every new session's first request persists a `message` entry with `role: "system"` holding the prompt sections and tool declarations; later prompt or tool changes append more. The agent loop announces them with `message_start` / `message_end` like any message. They are provider input, never conversation: `toClientAgentEvent()` drops them before the SSE stream (they carry every tool schema), `handleAgentEvent` skips any that slip through, `entryToUiMessage()` returns null for them, and `BranchNavigator` / `lib/project-tree.ts` never label or preview a branch with one. They still count toward `messageCount` and `totalMessages`, exactly as the SDK counts them.
- `usage` entries (`kind: "cache_warm"`) record prompt-cache warming that is billed but never enters model context. `computeSessionStats()` adds them like compaction usage so the token/cost counters match `/session` in the TUI.
- `context_edit` entries omit or replace an earlier entry's model context without changing raw history; the UI ignores them. A retain-none compaction stores its own id in `firstKeptEntryId`.
- `SessionManager.listAll()` now reads files newest-mtime first (then reverse filename) so `--resume` can render progressively; its stable sort keeps that order for sessions with equal activity time, and `listSessionsIncremental()` reproduces it from the stat fingerprints it already keeps.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `invalidateSessionListCache()` bumps the generation but **keeps** the previous scan, and the cache is fresh only while its recorded generation matches. Ordinary agent activity invalidates it constantly, and rebuilding costs hundreds of milliseconds because `loadAllSessions()` re-reads every forked and subagent session. Callers that only need metadata — mapping search hits to sidebar rows — pass `listAllSessions({ allowStale: true })` to read the previous scan and let the rebuild happen in the background. A stale scan is a complete catalogue apart from sessions created seconds ago, so those callers accept a brief window where a brand-new session is not yet listed.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.
- Every SSE (re)connection in `useAgentSession` is gated on `sessionHookMountedRef`. React Strict Mode (on by default in `next dev`) re-runs effects in declaration order after a simulated unmount: the mount-only effect's cleanup sets that ref to `false`, and it is only restored when that effect re-runs, *after* the warm-session effect. The warm-session effect therefore re-asserts the ref before `maintainEventsConnected()`. Without it a dev-server tab never opened the event stream on mount or when switching back to a running session, so streamed output and new messages stayed invisible until the 15-second reconcile poll or a page refresh (`next start` was unaffected).

### Moving sessions between projects
- The row's **Move to project…** action selects an existing directory; the route refuses a same-project destination or a running family. A move changes the header cwd and the SDK session-file directory for the selected session and its nested subagents; forks stay in place, but any stored parent path pointing at a moved file is repaired (including subagent metadata).
- `lib/session-move.ts` stages all rewrites, backs up originals for rollback, installs destination files without overwriting an existing file, evicts idle wrappers, and refreshes both session-path and list caches. Never only change the header or only rename the JSONL: Pi's session discovery and parent references must stay consistent. Other Pi processes writing concurrently are not coordinated with this operation.

### Starred sessions
- Stars live in `~/.pi/agent/pi-web/starred-sessions.json`, not in session files or the browser's long-term storage. `POST /api/starred-sessions` applies idempotent per-ID set/unset changes under a file lock; legacy localStorage lists are imported as a union then removed only after success. A browser with an old, not-yet-imported list may reintroduce a previously removed star on its first visit.
- `useStarredSessions` shares one browser-tab snapshot across the sidebar and Starred view, and reloads when the tab regains focus/visibility so other clients' changes become visible.

### Activity overview
- The Activity button triages **Pi Web-managed** sessions/subagents only. `/api/agent/running` adds registry-only `attention` (actual pending blocking extension UI) and the newest 1,000 distinct settled completions plus review receipts from `~/.pi/agent/pi-web/activity-review.json`. Never create wrappers or subscribe to every session to populate the overview; disk-only Pi CLI/Herdr activity cannot be classified as working or blocked.
- `SessionSidebar` owns the existing visible-tab poll and passes attention, running, and server-derived review markers to `AppShell`. Needs you overrides working; a current run overrides an older unread marker. Every settled Pi Web run is recorded even when subagent push/sound notifications are suppressed, so short runs still enter Ready to review. Only the explicit **Read** action on a Ready to review row acknowledges it; opening or selecting a chat leaves the item ready. Acknowledgement POSTs merge per-session timestamps under the same lock as completion recording; the client keeps pending receipts until the server confirms them, and a stale poll cannot resurrect an acknowledged item. Legacy browser timestamps are imported only where a retained completion corroborates them; ID-only unread flags are dropped. A newly observed historical completion must not play a sound; only an observed eligible root running-to-idle transition does.
- `lib/activity.ts` filters archived families, uses `workspaceKeyOf` for project identity, and nests a subagent when its parent shares the same section. The optional Queued section uses only live subagent queue IDs; an on-disk `queued` status after a server restart is not proof of a live queue. `ActivityOverview` only lists/navigates: the single selected `ChatWindow` still owns SSE, question replay, and answer submission. Mobile hides the list while viewing a chat but keeps it mounted so Back preserves its filter and scroll position.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>` only after selecting a local base branch and its full expected tip. Explicit `create` refuses an existing branch; explicit `attach` requires an existing local branch and its full expected tip. Neither silently uses remote-tracking refs or an implicit checkout HEAD. Source and any checked-out base must be clean (including untracked files). Ref tips are rechecked, but external Git writers may still race.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.
- `GitWorkflowSettings` uses the persisted session cwd, not the sidebar's selected checkout. An idle persisted session at a registered checkout root may be moved to another registered root, or cloned from an assistant leaf then moved there; neither manual action is triggered by sidebar creation/policy save, and neither moves source checkout files. Separately, an explicit agent `git_workspace_start` can schedule a one-shot idle post-run continuation/fork into its own newly created worktree. A failed fork/move is retained for manual inspection, never automatically retried. See `docs/git-workflow.md`.
- git prints POSIX-style absolute paths even on Windows, so every path read out of git goes through `toNativePath()` (`lib/paths.ts`) before it is compared or returned. Compare paths with `samePath()`, never `===` — raw equality made `isTopLevel` permanently false on Windows and hid the worktree switcher entirely. Branch names are not paths and must keep their forward slashes. Browser code cannot apply Node path rules, so `/api/worktrees` resolves `currentWorktreePath` server-side; the sidebar must use that identity for highlighting and removal fallback.

### Git Explorer versus session Git workflow
- The top-bar **Git Explorer** icon opens a wide graph/detail panel beside chat; it follows the sidebar's effective checkout (`AppShell.activeCwd`), even when an open chat keeps its own saved `cwd`. `GitExplorerPanel` is keyed by that checkout; branch changes, refreshes and checkout changes clear detail and abort stale reads. The branch picker defaults to the checked-out branch and browses other **local branches only**, without checking out. Local tags decorate their commit rows separately from branches; they are display metadata, never history-root authority or checkout actions. Its GET-only `/api/git/explorer` authorizes the physical checkout root against allowed file roots, captures an exact local branch tip for bounded `--topo-order` history pages, rechecks that branch for pagination/detail/patch reads and limits commits to that tip's reachable objects. Legacy checkout-HEAD-only requests remain bound to HEAD. It never uses session integration policy, uncommitted files, or a remote. `GitCommitViewer` has separate copy controls for full commit ID and message; `CommittedPatchDiff` parses the bounded Git patch with `@pierre/diffs` and defaults to a side-by-side first-parent display (unified/raw toggles). On mobile graph and details are successive views and diff columns scroll inside the panel. The active-lane algorithm adapts binaryplease/git-graph with attribution in `lib/git-graph-layout.LICENSE`; do not bring over its Bun server or checkout actions. See `docs/worktrees.md`.

### Session Git workflow boundaries
- `git-workflow-permissions.ts` is the shared settings/actor matrix behind live route/tool gates, `git_workflow status` and the Workflow home's **Permissions & blockers**. Summaries are not approvals or native Git preflight. Effective tools override saved selections; unknown tools fail closed for agents. Human review remains available in read-only/Chat-only chats, but subagent mutation surfaces are blocked. Legacy worktree-start consent is labelled separately from fresh approval. Automatic remains unsupported: private binding/source evidence is not authority. Saved Global/Project/Chat×Project Allow is consumed only by bounded selected-project commits; Deny restricts supported managed actions. Other selected operations and fully reviewed rule interpretation remain incomplete. Failed/cancelled check recovery requires durable original-cgroup empty/terminal evidence and equal original pre/post Git snapshots. The normal path also requires the current snapshot to match exactly. A separate, explicitly reviewed later-movement path may release quarantine only with the same physical worktrees, branches, policy and check, clean current checkouts, an exact current-state review and a fresh stopped-unit query; it creates no passing receipt or merge approval. Uncertain states remain quarantined.
- Agent and browser commits reserve the checkout gate for capture/apply, never for the human wait. Another active chat or in-flight generic tool is not a Git-transaction blocker; the reservation coordinates concurrent Pi Web Git operations and newly starting tools, while durable admission and native exact-state checks reject uncertain intents and stale candidates. Already-running tools and terminal/subdirectory/external writers can still race native preflight. Native commit checks refuse worktree-local merge/rebase/am/sequencer/bisect markers before preview and immediately before ref CAS; resolve the Git directory and lstat markers, because absolute `--git-path` can follow a marker symlink. Never remove operation state. `GitCommitOperationError` is a definite pre-CAS refusal, including after intent recording; keep it blocked rather than inventing an uncertain result. Arbitrary post-boundary failures remain recovery-required. Preserve an actual approval even when apply-gate acquisition fails.
- Agent Git questions (`gitAction` and `gitPreferences`) have no automatic response timeout. Keep the original pending request across browser reconnects until answered, Stop or teardown; never infer decline from elapsed time. No restart replay. This does not extend native merge-plan/check-receipt freshness, manual browser-preview expiry, or command execution timeouts; late approval still revalidates and fails closed when stale. The explicit approval button is sufficient; do not add a separate “I reviewed” checkbox/button gate. File/check selectors and separate check/merge permissions remain.
- Durable commit/review/check/integration history uses `git-action-journal.ts` and immutable bounded candidate artifacts under private `pi-web/git-actions/v1/`. Plain SDK `custom` entries (`pi-web:git-action`, `{version:1, actionId}`) anchor UI cards without entering provider context; never use `custom_message` or embed patches in transcript/tool results. `session-reader` projects raw branch ancestry, and minimal `git_action_update` events plus GET refresh reconcile cards without starting wrappers. Forks inherit read-only references, not capabilities; artifacts survive session/worktree deletion. Standard SDK HTML export does not include them.
- Decisions, prepared identity and actual outcomes are separate. Commit intent is journalled before ref CAS; integration intent before checkout apply. A failed final record must report known OIDs or uncertain recovery, never invite a blind retry. An integration `partial-state` merge OID is not proof of a ref update. Restarted pending records are expired, executing records require recovery; no jobs/tokens are restored. Only the current live request can render active approval controls. Browser previews bind exact message/candidate to single-use expiring process state; historical action IDs alone are never authority. Worktree/preference UI and check-log/artifact-retention/export controls remain outside this slice.
- The integrated first slice adds `git-workflow-settings.ts` (shared field resolver/provenance), `git-workflow-settings-store.ts` (private revisioned Global/Project overrides), `git-workflow-session.ts` (v2 overrides plus captured task), and `git-workflow-access.ts` (live dispatch/execution gates). Saving future settings does not retarget a task; the explicit idle Apply action captures them. New managed chats support Off/Manual/Ask commits; `git_commit operation: commit` and the workflow alias share one human-approved candidate path. Old session grants remain pinned; a v1 opt-out tombstone prevents downgrade resurrection after v2 adoption. Pause and disablement cover loaded tools/manual mutation routes; cancellable checks observe revocation. No new standing grants, automatic integration/cleanup, or changed repository/global lifecycle authority is introduced. See `docs/git-workflow.md` and ADR 0010.
- Legacy compatibility: `lib/git-workflow-store.ts` keys defaults by canonical project root and writes private Pi Web state; `lib/rpc-manager.ts` snapshots a new session into `pi-web:git-workflow`, with explicit `null` for opt-out. Existing sessions never fall back to changed defaults. Fork/clone inherits the effective snapshot. The current UI refuses a policy override on an initialized but not persisted chat. Session edits require an idle persisted chat and reject subagents; `before_agent_start` reads the latest entry on every new run without a browser reload. Chat-only does not load the workflow or commit extension. This is guidance, not a sandbox for shell access.
- **Workflow** is the single top-bar home for scoped settings and current-task commit/integration/workspace details. Global/Project remain usable without a chat. `GitWorkflowHome` retains identity-bound drafts across closure/scope navigation; inherited displays use saved ancestors, never another scope's unsaved draft. Pending Git requests must not close the editor or steal its typing focus. The session-bound panel content stays owned by `ChatWindow` and is portaled into the `AppShell` sidecar. Workspace continuation/fork uses one registered-destination dropdown and retains separate action confirmations. `git_workflow` first offers a validated early per-chat preference card (not execution approval), policy-independent agent-triggered whole/range comparisons and an exact-candidate commit approval card in the chat; its integration operation asks permission to run ordered checks and separately approves an exact non-FF local merge without saved policy; cleanup is not yet agent-driven. Browser `POST /api/git/commit` derives cwd from the saved session header; the legacy agent `git_commit` tool requires `commits: agent` in the saved session snapshot (project default alone is not consent). Both use `lib/git-commit.ts`: select whole status paths, refuse dirty index/conflicts and unsupported hook/signing/filter policy, preview exact branch/HEAD/index/paths/tree, then confirm a fresh authenticated candidate. No hooks, signing, or configured filters are run. A post-ref-update index failure reports `partial-success` with the created commit ID; inspect the checkout before retrying. This is not atomic against arbitrary external Git writers.
- `git-workflow-binding.ts` and `/api/git/workflow/task` own explicit private task/source evidence in the same Workflow home. This does **not** repurpose `scope:task` settings capture into authority. Preview names a selected user request/goal, captured settings and physical registered checkout; linked Markdown destinations require explicit selection before reading. The SDK-0.87.1-pinned collector fails closed on unreadable/invalid/oversized sources and records missing overrides and readable shadow-selection probes. Linux `/proc/self/fd` parent descriptors plus pre-read identity checks prevent parent-symlink retargeting; other platforms cannot adopt sources yet. Only explicit adoption publishes private immutable snapshots and a generation head; no wrappers, transcript entries, grants, task start, tool retargeting or Git actions are created. Copies/forks do not inherit bindings, moves/settings recapture invalidate them before writes, failed moves never restore them, and restart requires renewed review. Source evidence is not a complete policy interpretation or loaded-prompt snapshot. All supported settings writes, including the compatibility route, share the common settings lock and durable write epoch; equal-value writes still fence pending reviews. Namespace publication re-establishes parent-directory sync barriers even after failed attempts. See `docs/git-workflow.md` for bounds and non-authority limitations.
- The three agent Git tools accept optional `workspaceBranch` for a physical, registered, allowed-root checkout in the calling chat's repository; omitted means the chat checkout. `git_workflow` also accepts canonical `repositoryPath` plus physical `checkoutPath` for selected-project status/read-only review and **bounded whole-file commits** on Linux. A selected commit defaults to exact Ask; explicitly requested `confirmation: none` requires a fresh effective saved Allow and selected-project confirmation:none, and remains subject to stricter repository/user instructions. Other selected-project mutations remain refused. Selection never changes shell/file cwd, session storage or loaded instructions. `git-project-resources.ts` captures canonical repository/checkout/Git-directory instances; Linux-only explicit comparisons pin directories through `/proc/<parent>/fd` and pass explicit Git/common directories to `git-review.ts`, never rediscovering through a mutable `.git` file or HEAD branch. No weaker comparison fallback. The calling chat's existing consent still governs legacy mutations. See ADRs 0009 and 0011 plus `docs/git-workflow.md`.
- `git-project-session.ts` stores plain `pi-web:git-project-settings` preferences, not grants. `git-project-settings.ts` resolves Global → selected canonical Project → Chat×Project without importing unqualified session overrides/tasks. Workflow's project picker works with an open chat; drafts/revisions are project-keyed and optional legacy action/source details remain chat-bound. Off/Manual/disabled project-qualified preferences conservatively clamp old mutation gates, never relax old restrictions. Resolve that clamp through the actual Git repository, not `resolveProject()`'s UI grouping: it deliberately preserves subdirectory cwds as separate display projects. Unknown canonical identity blocks rather than skipping restrictions. No standing permission, live migration, mandatory adoption or new lifecycle authority is introduced.
- `git_workspace_start` is available only to ordinary non-Chat-only agents with a captured managed worktree task or saved legacy worktree-mode policy. For a **missing captured managed base only**, `baseBranch` plus full `expectedBaseOid` proposes a one-off, exact-approved **create-only** operation: do not Save/Apply defaults during a pending question, invent a transition, or silently override a configured base. The chat stays put; the start and completion are recorded but no move receipt is scheduled. With a configured base, a successful explicit invocation writes a namespaced start entry and, if continuation/fork was selected, a private receipt; only that run's idle settlement claims it, gates both checkouts, then attempts a same-chat move or clone+move once. Reconnect/restart cannot replay it; an incomplete claimed or abandoned receipt needs manual inspection. One automatic **transition** per session, no file copying. The browser only follows the server's status, it never triggers movement.
- Workflow guidance does not manufacture Git work: conditional prompt-section constraints apply when the current user request needs Git, while `git_workflow status` is optional discovery, never a required chat-start call. Do not inject a hidden custom **user** message with full settings on each run. Exact-type filtering excludes old `pi-web:git-workflow-context` reminders from future model requests without deleting raw history, user quotations or actual mutation gates. Loaded sessions may need resource reload; this cannot clean an old summary that already flattened a reminder.
- `lib/git-review.ts` and `/api/git/review` require a saved local integration target on the feature's **first-parent** chain. Diffs use committed trees only: target → proposed merge-result tree, one first-parent commit, or an ordered contiguous cumulative range. Recheck refs and fail stale/oversized patches.
- `/api/git/integration` derives both registered worktrees from the persisted session/policy and requires explicit trust and one user-selected run of every saved verification check. `lib/git-verification.ts` stores bounded private logs and 15-minute, process-local successful receipts. `lib/git-integration.ts` prepares an exact plan with the whole candidate diff, target/feature OIDs, merge OID and receipts, then confirms only that approved plan by an ordinary unsigned local non-fast-forward merge. Dirty/index-flag/sparse, configured hooks/signing/filters/attributes, missing checkout, nontrivial merge, changed policy/ref/checkout, and unsupported `ff`/`squash` fail closed. Pi Web gates in-process commands during apply; external Git writers still race. A failure after checkout begins is a partial state with a private recovery record; do not auto-retry/reset. Worktree cleanup remains a separate approval, never part of integration. No remote operations. Saved target/method are preferences, not approval. Windows portability is unverified. Rationale: `docs/adr/0007-session-git-workflow.md`.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.
- Allowed roots are stored slash-normalized, but that is a Set-key convention, not a correctness requirement: `isPathWithinRoots()` (`lib/path-security.ts`, the single implementation behind `isFilePathAllowed()`) re-resolves and case-folds both sides, so either path form authorizes correctly. Keep that one implementation — it is the security boundary.
- A UNC cwd (`\\host\share\dir`) must survive the `/api/files/[...path]` round-trip. `encodeFilePathForApi()` folds the `//` root into the first segment (`%2F%2Fhost`) because a literal `//` URL prefix is 308-normalized away before routing; `filePathFromApiSegments()` decodes it back. Never split UNC paths into segments and rejoin them — that silently turns `\\host\share` into the relative-looking `host/share` and every allow-check fails with 403.

### Editing open files
- The Files panel offers Edit/Save only for existing, writable UTF-8 text files up to 1 MB in the writable file-root allow-list. `GET ?type=edit` returns a complete bounded snapshot and SHA-256 revision; `PUT ?type=save` checks that revision before a same-directory replacement. Session-referenced paths outside the allow-list remain read-only, even though ordinary GET can show them. Reject symlink targets, escapes, binary/media files and read-only directories; do not use the chunked text preview as a save baseline.
- `AppShell` owns unsaved drafts per file tab because only the active `FileViewer` mounts. Watch events refresh clean content but never overwrite a dirty draft; external edits cause a conflict requiring discard/reload rather than silent overwrite. Saves preserve file mode but replace the inode (including hardlink identity), and external filesystem writers can race the final compare/rename. Browser reload does not persist drafts.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Built-in subagents
- The global `builtInEnabled` switch is persisted in `~/.pi/agent/agents/settings.json` and defaults to `false` when the file or field is absent. Malformed settings fail closed; atomic updates preserve unknown fields.
- The inline built-in extension factory is always present so reloading an existing wrapper can apply setting changes, but it registers no tools while disabled. After changing the switch, the user must explicitly reload the current session.
- When enabled, only a recognized legacy `pi-subagents` extension that registers any reserved tool (`Agent`, `get_subagent_result`, or `steer_subagent`) is removed. Unrelated extensions remain loaded, and resolved conflict diagnostics are discarded.
- Runtime `Agent` dispatch checks the setting again so a stale tool call cannot start a subagent after the feature is switched off.
- See `docs/adr/0003-built-in-subagent-toggle.md` for the precedence and persistence rationale.
- Individual built-in profiles (`general-purpose`, `explore`, `plan`) are switched off by name in the same file's `disabledBuiltIns` array, never by copying them out to a `.md` file: a copy freezes the built-in prompt at the version it was copied from and is visible to the other runtimes reading those directories. `builtInProfiles()` stamps `enabled` onto the constants so the panel, the `Agent` tool description, and `resolveSubagentProfile` agree; each write is a minimal edit that preserves names it did not touch, including ones no built-in claims (a newer build's). Reading the list fails *open* — the feature switch beside it has already failed closed — while `PATCH /api/subagents/profiles` with `scope: "builtin"` performs the write and `PUT`/`DELETE` still refuse that scope. A same-name file replaces the built-in outright and is switched off through its own frontmatter. Only the switch is live for a built-in; the rest of the form stays read-only. See `docs/adr/0005-built-in-subagent-disable.md`.
- A background run's completion notification (`notifyParent`) is skipped when the parent already collected the same result with `get_subagent_result`: the tool marks a finished background run consumed and the notification takes that mark. The check cannot happen only when the completion promise resolves — the parent is usually still inside its `get_subagent_result` poll at that moment (500ms interval) and `deliverAs: "followUp"` would just queue the duplicate until that turn ends. So `notifyParent` holds the message while the parent `isRunning()` and re-checks the mark before sending; an idle parent is still notified immediately.
- Agent profile files (`~/.pi/agent/agents/*.md`, project `.pi/agents/*.md`) are shared with other runtimes, so a save round-trips the frontmatter keys this app does not own (`name`, `allowed_subagents`, `exclude_extensions`, `disallowed_tools`, …) and carries foreign `ext:` tool selectors through. Managed keys are exactly `description`, `display_name`, `tools`, `load_skills`, `load_extensions`, `enabled`, `inherit_context`, `run_in_background`, `model`, `thinking`, `max_turns`.
- A background run's completion reaches the parent through `sendCustomMessage`, and pi's `convertToLlm` replays every `custom` message to the model as a plain `user` turn. `subagentNotificationText()` therefore prefixes the report with `SUBAGENT_NOTIFICATION_PREFIX` so a compaction pass — whose prompt asks what *the user* wants — does not file the subagent's output under Goal / Constraints (#875). Foreground `Agent` and `get_subagent_result` results keep the bare `subagentFinalText()`: they are already `toolResult` messages and need no marker. Keep the prefix in code, not in a profile prompt, so the model cannot drop it.
- The `skills` / `extensions` spellings pi-subagents reads are seeded on first save and kept in step while they are booleans; a hand-authored whitelist such as `extensions: pi-advisor-flow` is never rewritten, and the two flags fall back to those aliases when `load_skills` / `load_extensions` are absent.

### Browser-native `ask_user`
- `lib/ask-user.ts` and `lib/ask-user-extension.ts` adapt the web-relevant contract from pi-ask-user 0.15.0; the upstream MIT license ships as `lib/ask-user.LICENSE`. The terminal package remains separate. Only a recognized `pi-ask-user` extension is suppressed in ordinary Pi Web sessions and extension-enabled subagents so the tool is not registered twice; do not hide unrelated collisions or load the tool in Chat-only mode.
- `AgentSessionWrapper.createExtensionUiContext().askUser()` uses the same pending request/response maps as ordinary extension dialogs. Questions and choices are replayed to reconnecting SSE clients; server-side answer validation, timeout, Stop, and teardown own settlement. `AskUserDialog` in the browser handles the native form, not ANSI custom-UI keystrokes. All blocking extension requests (`ask_user`, select, confirm, input, editor) render as transient cards at the live tail of the chat scroller, not modal overlays or persisted transcript entries. The existing request ID, response and close events still own expiry, replay and cancellation; the non-question custom UI panel remains an overlay. Keep response details, redacted events, and tool schema compatible with the installed extension.

### Web password throttling
- `lib/auth-throttle.ts` is deliberately global, not per-IP: Next 16 route handlers have no socket address and `x-forwarded-for` is spoofable, while the server binds `127.0.0.1` for a single operator. Failures double the delay (1s → 60s cap) for everyone; a success or 5 idle minutes resets it. The reset window must stay longer than the max delay or waiting out one block restarts the burst.
- State lives on `globalThis` under `Symbol.for("pi-web:auth-throttle")` so it survives hot reload and is shared by every module instance. Tests reset it with `recordAuthSuccess()`.
- `POST /api/web-auth` and every `Authorization: Basic` header on `/api/*` share the counter; `proxy.ts` checks Basic before its `/api/web-auth` exemption, so `GET /api/web-auth` is not an unthrottled password oracle. A valid session cookie is checked first and is never blocked. While blocked, Basic gets `429` even with the right password (otherwise the answer leaks), and a Basic success does not reset the counter: Basic clients authenticate on every request, so a reset would restart an interleaved guesser at the base delay. The proxy and route handlers share the `globalThis` state under both `next dev` and `next start` (checked by failing one and observing `429` on the other).

### Provider account selection
- Pi's `auth.json` remains the single-credential-per-provider **Pi default** shared with the CLI. Additional identities are stored only in permission-restricted `pi-web-accounts.json` by `lib/provider-accounts.ts`; never return credential values from account routes.
- `lib/session-accounts.ts` persists a complete provider-to-account snapshot in `pi-web:provider-accounts` custom entries. Legacy sessions with no entry use Pi default; project defaults (keyed by `resolveProject(cwd).projectRoot`) apply only to new sessions. Forks and subagents copy the snapshot even when their branch history omits its earlier entry.
- `startRpcSession()` injects a session-bound `ModelRuntime` before loading resources. OAuth refresh updates only its selected account under the file lock; a missing/deleted binding must fail closed instead of falling back to ambient or Pi-default credentials. `setRpcSessionAccount()` serializes idle switches and rebuilds wrappers; `/api/agent/[id]` waits for an in-progress switch before sending a command. No mutable process-global active account.
- `GET /api/models` bypasses the cwd-only cache for a selected account snapshot; otherwise models for the Pi default or another project's account would leak across selectors. Extra-account OAuth uses `GET /api/auth/login/[provider]?accountId=...` and API keys use `/api/auth/accounts/[id]/api-key`; provider-wide auth routes still change Pi default.
- `ProviderAccounts` sits beside the model selector as a compact current-provider indicator; its popover retains session/project selectors and account management. Both this popover and Models settings allow only HTTPS or loopback HTTP OAuth/device URLs before linking or opening them and offer a Copy button for device codes. The provider selector is locked during an in-flight login, and manual responses use that login's provider. Closing the popover retains an in-flight login; Cancel or unmount closes its EventSource.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```



