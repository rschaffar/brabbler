# Native session tools

The reduced feature composes SDK 1.5.1 MCP, tools-only Code-mode and Tool search for ordinary sessions. Complete Nix acceptance and desktop/mobile browser evidence are recorded in the [archived implementation record](plans/archived/2026-10-21_native-session-tools-plan.md). It does not introduce a configuration-management system.

## Configuration and selection

Configure servers in native `~/.pi/agent/mcp.json` or trusted project `.pi/mcp.json`, including Nix-provided leaf symlinks. Project replacement and restricted `enabled`/`exposure`/`toolExposure` overrides retain native semantics. The browser does not edit those files or grant project trust. Configured does not mean connected.

Session intent is a version-1 `brabbler:native-resources` custom entry:

```json
{"version":1,"codeMode":true,"mcpServers":[{"scope":"global","name":"example"}]}
```

Legacy intent defaults off. New ordinary sessions may snapshot a user-owned project or global default as described below. A malformed latest marker revokes rather than reviving an older selection. Scopes are exact: a missing/replaced global declaration does not silently become a project grant. Chat-only suppresses effective resources while retaining intent. Profile-controlled subagents and agent-created launch defaults do not inherit resources. BTW side conversations copy the source's explicit native intent once at creation; ordinary Chat-only suppression, trust, declaration and account checks still apply.

`POST /api/agent/new` accepts `nativeResources`; existing ordinary sessions use `set_native_resources`. Explicit Apply replaces only the selected idle wrapper. Setup-only intent is persisted without a fabricated message, retaining its SDK ID for acknowledgement recovery. Fork/clone copy intent; account/tool recreation and reopen retain it. Other running sessions are neither stopped nor waited on.

Each wrapper captures its declarations, environment and native stdio path expansion. Editing files/environment does not mutate live connections, including reconnects. Explicit session Reload through the agent route reapplies native resources by replacing that idle wrapper. Native-enabled wrappers refuse SDK/extension in-place reload. The browser keeps text/history/navigation and reconciles an unconfirmed response rather than replaying Apply.

## Global and project defaults

In **Session tools**, select the desired servers/Code-mode and choose **Save selection as global default** for future ordinary chats across projects, or **Save selection as project default** for one repository and its worktrees. This saves intent, not an Apply to the current session. Global selections may include only globally declared servers, never project declarations; they are validated against global configuration without project overrides. Global defaults also work in non-Git directories.

Precedence is **explicit session selection → project default → global default → off**. An explicitly saved all-off selection is a real override, not inheritance. **Clear project default** returns future creation to the global default, which can enable tools; save an all-off project selection instead to opt that project out. **Clear global default** returns future sessions without a project default to off. These actions leave existing wrappers and saved sessions unchanged; ambiguous acknowledgements require **Refresh status**, never an automatic write retry.

Defaults are private, versioned Brabbler settings in `agentDir/brabbler/project-native-resources.json`, not edits to native `mcp.json` or repository-controlled files. The version-1 document retains its project entries and adds an optional `globalSelection`; legacy documents have no global default. Global and project writes share a lock, preserve each other and compare independent scope revisions. Project defaults cover registered Git checkout roots and their linked/future worktrees. Repository subdirectories and non-Git directories do not inherit a repository default. Fresh physical membership and a separate shared `brabbler-native-resources-id` marker prevent a replacement repository at the same path from inheriting it. An explicit save may initialize that native-default identity marker; it neither creates the trust marker nor grants project trust. Acceptance profiles/jobs keep their identity when defaults are saved, and a later explicit trust grant does not rename native defaults. No identity is created by metadata reads or session startup.

Only ordinary browser/API creation through `POST /api/agent/new` reads defaults. The chosen selection is snapshotted and persisted even for a setup-only session, without fabricating a message. Existing/legacy sessions, reopen, account/tool recreation, fork/clone and session moves keep their existing intent rather than consulting current defaults. Profile-controlled subagents and agent-launched sessions remain off by default. BTW copies its source's native intent rather than consulting project defaults. Changing or clearing defaults is not a revocation mechanism for sessions that already captured them; change those sessions explicitly.

A supplied new-session selection, including explicit off, wins over defaults. The new-composer **Apply** sends this override into creation before any default transport can start and refuses adoption of an already-in-flight creation. Chat-only and project trust still suppress effective resources without erasing saved intent. Exact global/project declarations, supported configuration, native definition ownership and backend authorization still govern execution. A missing or project-replaced selected global declaration can refuse creation; it never substitutes a same-named server from another scope or falls back to a lower-priority default.

Default writes use the existing file-access/request-security boundary, revision checks, a private atomic store and a bounded lock/write lease. Malformed or unavailable settings cannot enable resources; an explicit per-session override can bypass a broken default lookup. Metadata/save/reset do not connect servers, initialize/reopen sessions, read MCP credentials or grant filesystem roots. There is no bulk retrofit of existing sessions.

## Supported authentication and authority

Stdio and public/static-header HTTP are supported. `${NAME}`/`$NAME` references resolve against the admitted environment; ambient provider/service secrets are not inherited by stdio. Explicit variables still require declaration. `!command` helpers, OAuth settings and provider-token forwarding refuse. Code-mode always receives `models:false`.

No MCP credential file is read or written. The native store receives an empty, write-refusing memory backend; native transports never receive OAuth/provider auth handlers. Native sign-in, browser opening and config mutation commands are not exposed. Raw native server logs are discarded and status/attention notices are categorical, not transport-error dumps.

Direct/deferred/hidden exposure remains native. Indirect tools use Tool search when Code-mode is off. Deferred tools are not automatically activated by preset changes; hidden tools remain unreachable. Effective SDK definition identity, not name/registration alone, owns execution. Host subagent/session-launch controls remain direct-model-only.

Captured project authority checks explicit persisted trust even after its defining file disappears. Retirement closes dispatch and aborts a fixed owner signal immediately, including executions already queued for SDK worker capacity. Caller cancellation is combined with that signal. Binding and native extension shutdown are followed by a drain of admitted execution results before public disposal and same-SDK-ID barrier release. This drain is not a worker-exit receipt: the SDK retains capacity until actual worker exit, which can follow result completion. Synthetic native tests separately observe and join real worker exits. Failed disposal leaves that identity unavailable rather than permitting overlap. Already-created HTTP sessions may send native cleanup DELETE during close, not further work/auth/reconnect requests. Cancellation cannot undo dispatched external actions.

The bounded pre-acceptance launch-refusal path cannot acquire native tools; the user may enable them after the independent launch has been accepted.

## Status and display

`GET /api/native-tools?cwd=…&sessionId=…` validates the existing file-access boundary, reads configured metadata and optionally projects an already-alive wrapper. It never creates/reopens/renews a session or tests a connection. Responses contain no executable arguments, environment/header values, URLs, credential state or private revisions.

Code-mode's `details.calls` are complete display snapshots. Temporary IDs may be duplicated, so rows keep snapshot order rather than merging by ID. Arguments are explicitly labelled previews; parent output/raw-copy data is unchanged, and a caught child error does not turn parent success into failure. Nested tool execution events do not enter flat top-level progress bookkeeping. Approval/cards/receipts keep their independent paths. Display metadata and remote resources grant no filesystem roots.

## Maintenance boundary

`native-mcp-sdk.ts` isolates the small unavoidable SDK 1.5.1 private surface (Pi-specific validator, native credential-store constructor and transport helpers). The namespace helper now comes from pi-mcp's public entry. Parsing evaluates that module but constructs no transports, credential stores or sessions. Both parsing and execution resolve the application's installed packages with Node 24 metadata and verify exact SDK/transport versions; neither reimplements engines. SDK upgrades require reassessing this bridge and running installed-package acceptance.

Code-mode defaults to two process-wide workers. SDK 1.4 queues excess calls for up to 60 seconds (bounded by a shorter script deadline); retirement/caller abort must remove queued work without late worker admission. `PI_CODEMODE_MAX_WORKERS` remains an explicit operator SDK setting, not an automatic capacity increase by this host.

OAuth, browser config editing, profile-controlled subagent grants, whole-configuration layering and Nix promotion remain deliberately outside this release. Normal immutable Nix packaging is unchanged. No host deployment is implied by implementation or local integration.
