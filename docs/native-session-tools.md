# Native session tools

The reduced feature composes SDK 1.3.0 MCP, tools-only Code-mode and Tool search for ordinary sessions. Focused desktop/mobile browser verification passes; complete acceptance is pending in the [active plan](plans/2026-10-21_native-session-tools-plan.md). It does not introduce a configuration-management system.

## Configuration and selection

Configure servers in native `~/.pi/agent/mcp.json` or trusted project `.pi/mcp.json`, including Nix-provided leaf symlinks. Project replacement and restricted `enabled`/`exposure`/`toolExposure` overrides retain native semantics. The browser does not edit those files or grant project trust. Configured does not mean connected.

Session intent is a version-1 `pi-web:native-resources` custom entry:

```json
{"version":1,"codeMode":true,"mcpServers":[{"scope":"global","name":"example"}]}
```

Legacy intent defaults off. A malformed latest marker revokes rather than reviving an older selection. Scopes are exact: a missing/replaced global declaration does not silently become a project grant. Chat-only suppresses effective resources while retaining intent. Child profiles and agent-created launch defaults do not inherit resources in this release.

`POST /api/agent/new` accepts `nativeResources`; existing ordinary sessions use `set_native_resources`. Explicit Apply replaces only the selected idle wrapper. Setup-only intent is persisted without a fabricated message, retaining its SDK ID for acknowledgement recovery. Fork/clone copy intent; account/tool recreation and reopen retain it. Other running sessions are neither stopped nor waited on.

Each wrapper captures its declarations, environment and native stdio path expansion. Editing files/environment does not mutate live connections, including reconnects. Explicit session Reload through the agent route reapplies native resources by replacing that idle wrapper. Native-enabled wrappers refuse SDK/extension in-place reload. The browser keeps text/history/navigation and reconciles an unconfirmed response rather than replaying Apply.

## Supported authentication and authority

Stdio and public/static-header HTTP are supported. `${NAME}`/`$NAME` references resolve against the admitted environment; ambient provider/service secrets are not inherited by stdio. Explicit variables still require declaration. `!command` helpers, OAuth settings and provider-token forwarding refuse. Code-mode always receives `models:false`.

No MCP credential file is read or written. The native store receives an empty, write-refusing memory backend; native transports never receive OAuth/provider auth handlers. Native sign-in, browser opening and config mutation commands are not exposed. Raw native server logs are discarded and status/attention notices are categorical, not transport-error dumps.

Direct/deferred/hidden exposure remains native. Indirect tools use Tool search when Code-mode is off. Deferred tools are not automatically activated by preset changes; hidden tools remain unreachable. Effective SDK definition identity, not name/registration alone, owns execution. Host subagent/session-launch controls remain direct-model-only.

Captured project authority checks explicit persisted trust even after its defining file disappears. Retirement closes dispatch immediately; binding, native shutdown and public disposal then settle in order behind a same-SDK-ID barrier. Failed disposal leaves that identity unavailable rather than permitting overlap. Already-created HTTP sessions may send native cleanup DELETE during close, not further work/auth/reconnect requests. Cancellation cannot undo dispatched external actions.

The bounded pre-acceptance launch-refusal path cannot acquire native tools; the user may enable them after the independent launch has been accepted.

## Status and display

`GET /api/native-tools?cwd=…&sessionId=…` validates the existing file-access boundary, reads configured metadata and optionally projects an already-alive wrapper. It never creates/reopens/renews a session or tests a connection. Responses contain no executable arguments, environment/header values, URLs, credential state or private revisions.

Code-mode's `details.calls` are complete display snapshots. Temporary IDs may be duplicated, so rows keep snapshot order rather than merging by ID. Arguments are explicitly labelled previews; parent output/raw-copy data is unchanged, and a caught child error does not turn parent success into failure. Nested tool execution events do not enter flat top-level progress bookkeeping. Approval/cards/receipts keep their independent paths. Display metadata and remote resources grant no filesystem roots.

## Maintenance boundary

`native-mcp-sdk.ts` isolates the small unavoidable SDK 1.3 private surface (pure validator/namespace, native credential-store constructor and transport helpers). It resolves the application's installed package with Node 24 metadata, verifies exact SDK/transport versions, and does not reimplement engines. SDK upgrades require reassessing this bridge and running installed-package acceptance.

OAuth, browser config editing, child grants, whole-configuration layering and Nix promotion remain deliberately outside this release. Normal immutable Nix packaging is unchanged. No host deployment is implied by implementation or local integration.
