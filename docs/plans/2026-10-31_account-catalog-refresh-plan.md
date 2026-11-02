# Account-aware catalogs with shared model settings

## Goal

Make Models Settings display and refresh the catalog belonging to the account being inspected, while keeping enabled models, defaults and provider/model configuration shared across accounts. Shared model settings are mutable application state and survive restarts and system rebuilds.

**Status:** Application implementation independently reviewed and complete Nix acceptance passed. Companion field-ownership source is verified; its consuming input update and local integrations remain pending. Deployment and remote publication are separate operations.

## Architecture

Retain the existing state owners:

| State | Owner and scope |
| --- | --- |
| Credentials and additional account identities | Existing Pi-default and Brabbler account stores; account-specific. |
| Session/project account bindings | Existing complete provider-to-account snapshots. |
| Provider model catalogs | Pi's native runtime and existing catalog stores, isolated by the complete account snapshot. |
| Enabled models, defaults and thinking preferences | Shared native settings, with existing global/project precedence. |
| Custom provider/model definitions and overrides | Shared `models.json`. |
| Installation, services, skills and unrelated configuration | Existing declarative configuration. |

Use the existing account/runtime binding, catalog refresh, enabled-model editing and cache owners. Do not introduce another settings store, catalog backend, configuration projection or SDK lifecycle framework. [Model/account contracts](../model-internals.md), [ADR 0004](../adr/0004-enabled-models-toggles.md) and [ADR 0006](../adr/0006-provider-account-binding.md) retain their scopes except for the explicit new-chat default behavior below.

## User-visible behavior

- Models Settings names the provider and account whose catalog is displayed. A short label makes clear that model settings are shared across accounts.
- Selecting an account for catalog inspection does not change the current chat's account or the project's account defaults.
- Existing model/provider forms remain shared. Switching the inspected account reloads catalog/status data without discarding or retargeting the shared configuration draft.
- Shared model controls work using an authorized additional account without requiring Pi default to be signed in. Reuse existing account management and login controls; they must remain reachable without an open chat.
- Model enable/disable edits retain the existing minimal server-side pattern semantics, including pins, unmatched references and project-shadowed read-only settings. A different catalog view does not create a different preference record.
- Shared new-chat model/thinking defaults are changed explicitly in Settings. Choosing a model or thinking level in a chat changes that conversation only, including an explicit initial choice for a new chat.
- Preserve existing conversation choices, account bindings and native capability clamping. Defaults, account navigation and refresh must not replace an explicit chat choice.
- Preserve existing explicit idle model reselection for applying shared definition edits. Saving does not automatically reconfigure running chats; no new live-application mechanism is added.
- Reuse existing configuration fields and credential-safe account routes. Catalog/status responses must not expose API keys or header values. No additional advanced configuration editor is introduced.

## Catalog and refresh rules

1. Capture the authoritative complete account selection before each request. Where a chat/project context exists, preserve its other provider bindings; inspecting a different account overrides only the inspected provider in the catalog context.
2. Pass that same captured context to catalog reads, enabled-model catalog resolution and explicit refresh. Keep the existing catalog destination calculation; do not copy between identities or substitute Pi default after an unavailable selection.
3. Keep Settings' existing global-provider resource boundary. Do not add project-local provider network refresh.
4. Catalog HTTP remains explicit through the existing Refresh action. Opening Settings, selecting an account and ordinary readback do not initiate catalog fetching or entitlement probes.
5. Reload appropriate server/browser data after completed or partially successful refresh, including unchanged-result cases. Use conservative native result wording; a finished pass is not proof of entitlement or an actual fetch.
6. Existing queues, request generations and mounted identity guards must prevent stale results from replacing another account's view. Do not replay writes during invalidation or retry.
7. Refresh never edits shared enabled patterns, defaults or provider configuration.

## Declarative ownership

Stop reseeding the shared model file and model-related settings during activation, including native CLI profiles. Remove model-state export/back-propagation from maintenance helpers. Preserve existing writable files, credentials and session data; do not initialize another preference database or reset existing shared preferences.

Continue converging unrelated declared settings and resources without replacing mutable model fields or unknown siblings. Verify field ownership, concurrent native writes and repeated activation with synthetic files. Source verification and a consuming input update do not authorize live activation.

## Non-Goals

- Account-specific enabled models, defaults, thinking preferences or provider/model configuration.
- Pi SDK modifications, public-catalog sharing/delegation, a new catalog format or fetcher.
- New session/subagent ownership machinery, generated per-family model configuration or general callback/retirement tracking.
- Automatic catalog fetching, entitlement checks, automatic model switching or live definition hot reload.
- Credential transfer, export/import, synchronization, live data migration or installed-service operation.

## Plan

### 1. Deliver account-aware catalog views using existing owners

- [x] Connect the existing Models/account controls to a catalog-only account context, without changing chat/project bindings or shared draft ownership.
- [x] Thread the complete captured selection through existing catalog reads, enabled-model resolution and explicit refresh; retain native storage/isolation and existing validation.
- [x] Verify two synthetic accounts, Pi default signed out, account navigation during pending reads/refresh and unavailable-account errors without fallback.
- [x] Verify edits target one shared pattern list, reflect common-model changes across account views and preserve existing minimal/unmatched semantics; bulk actions use their displayed catalog.

### 2. Make shared defaults and readback explicit

- [x] Provide shared new-chat model/thinking default controls in the existing Settings UI using native settings persistence.
- [x] Remove automatic default persistence from chat startup/selection; use the SDK's existing session-only mutation semantics, not a settings interception adapter.
- [x] Verify default saves, existing/new conversation choices, native thinking clamping and failure feedback without account-specific records.
- [x] Fix refresh/cache/UI currentness, including unchanged/partial results, stale responses, navigation/unmount and explicit-choice preservation.

### 3. Complete persistence and acceptance

- [x] Verify the companion declarative source preserves shared model settings across repeated synthetic activation while unrelated declared fields still converge.
- [ ] Update the consuming application input after approved application integration; live activation remains separate.
- [x] Update the focused model/account guide and user-facing shared-scope messages. Keep documentation about the delivered behavior and operation.
- [x] Obtain independent implementation/UX review of the coherent end-to-end change and resolve actionable findings.
- [x] Run focused Nix-native catalog/account/enabled-model/cache/startup and mounted Settings checks, then complete the required core/static/plugin/browser/terminal/Home Manager VM acceptance from [Testing](../testing.md).
- [ ] Prepare the verified candidate for the repository's local integration workflow. No remote operation, activation or cleanup is implied.

## Verification and Stop Conditions

Complete application acceptance passed with `nix run .#test -- all --workers 2 --jobs 4`: **516 core files / 4,272 tests**, all **26 browser/terminal groups / 58 inputs**, and the genuine Home Manager deployment VM. Command wall time was **500 seconds**, including realization. Two browser workers/four core jobs admitted overlap within approximately 24 GiB available RAM. Core preparation before its lifecycle was 35.417 seconds and the lifecycle 367.197 seconds; browser preparation was 8.415 seconds and its overlapping group window 404.689 seconds. The VM command took 79.486 seconds including realization. These overlapping intervals are not additive. Application prerequisites were already realized; this is not a cold-cache benchmark.

Use existing test owners and [test-writing guidance](../test-writing.md), synthetic accounts and isolated native files. Do not add a parallel test harness or use browser interception as proof of native persistence. Record each tested input, command/selection, outcome and artifact; distinguish focused checks from complete acceptance.

Complete acceptance after source/review settlement:

```sh
nix run .#test -- all --workers 4 --jobs 12
```

Follow the testing guide for resource admission and preparation/execution timing. If the existing public account/catalog interfaces cannot satisfy a concrete receiving case, stop for a bounded design decision rather than adding a settings/runtime framework or changing Pi.

## Completion Checklist

- [x] The displayed account's catalog is the one read and refreshed, without changing the chat/project binding.
- [x] Shared settings remain shared and usable with an additional account when Pi default is signed out.
- [x] Explicit Settings defaults affect future chats; chat choices and refresh do not overwrite defaults.
- [x] Catalog navigation, cache invalidation and late responses preserve correct identity and explicit choices.
- [x] Application restart and companion synthetic activation preserve shared model state while unrelated declared fields remain managed.
- [ ] Independent review, complete acceptance and exact-state local integration safeguards are satisfied; deployment and publication remain separate.
