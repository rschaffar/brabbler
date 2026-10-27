# Session model speed

For ChatGPT subscription models (`openai-codex`), the composer offers **Standard**
and **Fast** beside Thinking. On mobile, open **More controls**. Speed and reasoning
depth are independent: changing speed does not change Thinking or the model.
Fresh and legacy sessions start at Standard. There is no Ultrafast option.

Fast uses more subscription quota; availability depends on the model and plan.
The visible Fast note explains this before a prompt is sent. A selection requests
a tier, not a guaranteed response time or proof of the tier actually delivered.
Provider errors remain visible; Pi Web does not silently retry Fast as Standard.

## Session ownership

Speed is stored on the server in the session's append-only custom entries, not in
browser preferences or global/project settings. Reloading or another browser
restores the saved choice. Forks, clones and new subagents inherit the parent's
current choice, even when their copied history predates it; subsequent changes
are independent. Wrapper recreation for account/tool changes retains it.

The choice is session-wide, not branch-local. The latest valid version-1
`pi-web:model-speed` entry wins across the whole session file:

```json
{"version":1,"modelSpeed":"fast"}
```

The entry is metadata outside model context. Missing/invalid entries mean
Standard. The disk session response exposes `modelSpeed` at the top level, and
live `get_state` exposes the same value. `set_model_speed` accepts only `standard`
or `fast` and rejects busy or shutting-down sessions. Creation accepts a separate
`modelSpeed` option, independent of model/thinking overrides. If a save response
is lost, the composer reconciles server state instead of assuming rejection.
Send stays blocked while the saved speed is unconfirmed; visible-tab polling and
network/visibility return retry that confirmation. Speed writes and state reads
have ten-second request deadlines; reconnect supersedes a stalled read, and stale
reads begun during a save cannot overwrite its confirmed result.

The picker is hidden for other providers, including the separate OpenAI API-key
provider, and unavailable while running, compacting or switching settings.
Switching to an unsupported model retains the stored preference without adding a
tier to that provider's requests; returning to ChatGPT restores the choice.
Pi CLI does not implement this Pi Web metadata.

## SDK compatibility and accounting

`lib/session-model-speed-runtime.ts` adapts the pinned Pi SDK **1.4.0**. Only
matching session chat streams on the native `openai-codex` /
`openai-codex-responses` path use Standard → `default` or Fast → `priority`.
The request must carry both the owning agent's current run signal and payload
callback, not just its session ID. Cache warming substitutes its own signal;
bug-report/compaction summaries omit that callback. Their `streamSimple` calls,
other session IDs/providers and auxiliary `completeSimple` calls keep their
existing behavior. A proxy view binds untouched methods to the original
session/account runtime; never overwrite the shared runtime's `streamSimple`,
because subagents reuse it.

The SDK's simple adapter drops `serviceTier`. Forward through the same runtime's
full `stream` method using its exported simple-option/token-clamping and reasoning
helpers, preserving authentication, header transforms and existing callbacks.
Payload-only injection is insufficient: native tier cost resolution also needs
the full option. A payload hook that changes/deletes the tier fails before sending
instead of silently mismatching request intent and accounting.

Native SDK priority accounting includes its Codex `default`-echo handling. Its
legacy Codex adapter does not price a response explicitly reporting `fast`, so the
adapter corrects only that observed spelling: recompute base catalog costs, then
apply the SDK's priority multiplier (2.5 for exact `gpt-5.5`, otherwise 2).
Iterator completion and `result()` share an idempotent correction. Do not apply a
blanket multiplier to already-priced costs. Dollar counters are catalog-derived
estimates, **not ChatGPT subscription charges or remaining quota**.

Review these boundaries when upgrading the SDK, particularly native subscription
provider identity, simple/full options, response-tier pricing and stream hooks.
See `lib/session-model-speed-runtime.test.mjs`, the real-SDK auxiliary-call test
`lib/session-model-speed-sdk.test.mjs`, the lifecycle/persistence/RPC tests, and
[browser acceptance](../e2e/README.md). Tests use synthetic credentials and mocked
responses; they do not prove live account entitlement or delivered
speed and make no paid model calls.
