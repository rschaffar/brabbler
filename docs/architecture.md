# Architecture and source map

Implementation reference moved from `AGENTS.md`; repository-relative code paths remain unchanged. Read the relevant section before modifying that area. Focused user guides and ADRs linked below retain their existing scopes.

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
  skills/content/route.ts         GET bounded loaded-skill instructions/contained Markdown references
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  subagents/settings/route.ts     GET/PUT built-in subagent feature setting
  worktrees/route.ts              GET/POST/DELETE git worktrees (explicit local base/tip on creation)
  git/explorer/route.ts           GET worktree-scoped read-only history/commit/file patch
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
  model-context.ts     managed-model budget draft normalization, clearing and provider routing
  session-usage-reader.ts  non-writing disk usage snapshots; SDK legacy normalization only in memory
  agent-usage.ts       bounded single-flight family usage polling and qualified aggregation
  file-tab.ts          file/view domain types, independent of tab presentation
  file-workspace.ts    pure split geometry, group/view navigation, previews and history
  file-edit-sessions.ts browser-local single-editor ownership; never authorization
  enabled-models.ts    pure minimal-edit engine for the `enabledModels` pattern list
  enabled-models-runtime.ts  SDK adapter: per-pattern resolution, provider kinds, settings IO
  markdown.ts          shared Markdown pipelines/source-preserving normalization
  markdown-compat.ts   currency/CJK parsing and document-scoped fragment/heading helpers
  message-signatures.ts  copy-on-write browser projection, never provider/durable mutation
  subagent-extension-selectors.ts  alias ownership/longest-match grants and conservative denials
  delimited-table.ts   client-safe CSV/TSV parsing and virtual table layout
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
  git-explorer.ts       session-independent bounded selected-worktree history/commit/patch reads
  git-graph-layout.ts   adapted MIT active-lane graph layout (see git-graph-layout.LICENSE)

components/
  AppShell.tsx        outer layout + URL/session state + retained terminal tabs
  FileWorkspace.tsx   scoped file groups, stable view hosts, routing and responsive projection
  LocalFileLink.tsx   resolved-local-link actions shared by chat and file Markdown
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  GitExplorer.tsx    local-branch visual history for sidebar-selected worktree
  GitExplorerPanel.tsx  wide graph/detail sidecar beside chat
  GitCommitViewer.tsx  committed-file patches and copy controls inside Git panel, no checkout reads
  CommittedPatchDiff.tsx  split/unified/raw single-file Git renderer using @pierre/diffs
  GitPatchStack.tsx   collapsible file diffs and shared view controls for Explorer/approvals
  BlockingCard.tsx   shared compact bounded shell for live blocking requests
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  EnabledModelsSection.tsx  model switches inside ModelsConfig, backed by enabledModels
  ModelContextWindow.tsx  compact managed-model context-budget draft field
  AgentsConfig.tsx    built-in subagent toggle + agent profile editor
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  SkillInstructions.tsx  bounded read-only document reader inside the selected skill
  DelimitedTable.tsx  row-virtualized CSV/TSV preview in the existing file scroll pane
  TerminalPanel.tsx   retained PTY/xterm with live appearance and touch-key toolbar
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          presentational tab strip for file groups and outer Files/terminals

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useStreamingSelector.ts  batched subscriptions without parent per-chunk renders
  useTerminalTheme.ts best-effort shared browser terminal palette
  useFileEditSession.tsx per-view binding to shared draft/save ownership
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state and shared light/dark palette classification
  useFontPreferences.ts browser-local live interface/mono families and base weights
```

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-ui --font-mono --font-ui-default --font-mono-default
--font-ui-weight --font-mono-weight
```
