# Model settings: contextual account selection and thinking defaults

## Goal

Put catalog account selection inside the provider detail it controls, and expose shared per-model thinking defaults beside the available-model rows. Make account-specific catalogs versus shared preferences visible without changing conversation account bindings or explicit conversation choices.

**Status:** Implementation and independent review complete. Rebased cleanly onto local main `298a89cc`; composed candidate `3bda1517` passed complete Nix acceptance. Current behavior is maintained in [Model/account contracts](../../model-internals.md). Local integration remains exact-state gated; no deployment, remote publication or SDK changes are implied.

## Plan Relationship

The [account-aware catalog plan](../2026-10-31_account-catalog-refresh-plan.md) owns catalog isolation, shared-state ownership and its separate consuming-input follow-up. This bounded UI follow-up preserves those contracts; it does not restart account authentication qualification, alter companion configuration or change the catalog backend. [Model/account contracts](../../model-internals.md), [ADR 0004](../../adr/0004-enabled-models-toggles.md) and [ADR 0006](../../adr/0006-provider-account-binding.md) remain authoritative.

## Architecture

- Keep `ProviderAccounts` as the account-selection/management owner. Its catalog mode renders a direct account selector in Models Settings' detail area; the conversation popover remains unchanged. Resolve complete account selections before reads, including the no-provider/no-chat entry state.
- Keep credentials, catalogs and bindings account-specific. Catalog selection never writes session/project bindings, changes draft ownership or requests provider catalogs/usage automatically.
- Use native shared `modelThinkingLevels["provider/modelId"]` and the existing defaults endpoint for targeted set/remove intents. `Inherit` removes only that model's global preference. Preserve other keys and existing native persistence/error handling; do not create a new store or transaction framework.
- Derive supported thinking levels from the inspected catalog's actual model metadata. Keep saved unsupported values visible without silently rewriting them on account navigation.
- Preserve native priority: explicit initial conversation choice, effective pattern pin, per-model preference, global/project fallback, then capability clamping. Keep pattern pins read-only; disclose project/pin overrides instead of editing patterns.
- Reuse the enabled-model controller's existing mutation serialization/readback for row saves. Shared global saves must reread the current inspected catalog, not a retired account view.
- Project untouched new-composer model suggestions from the target model's effective default. Do not change existing-conversation selection/reselection semantics or make thinking sticky across later model switches.

## Non-Goals

- Account-specific preferences, replacement auth/catalog controls, a general settings framework or an advanced editor.
- Pattern-pin editing, changed precedence, automatic hot reload or provider entitlement checks.
- Pi/SDK modifications, credential inspection/transfer, live cache migration, installation or activation.

## Plan

### 1. Extend existing shared preference owners

- [x] Add validated per-model set/remove intents to `lib/startup-preferences.ts` and `/api/models/defaults`; verify native persistence, untouched siblings, clear/inherit, invalid inputs and storage errors.
- [x] Extend enabled-row metadata with native supported levels, global preference and effective inheritance/override information; verify project versus global ownership independently of enabled-pattern scope.
- [x] Project correct per-model suggestions into the existing model response/hook path; verify explicit choices, pins and capability clamping remain authoritative.

### 2. Put controls at their visible context

- [x] Move the catalog-only `ProviderAccounts` control into the provider detail and expose its account dropdown without opening a popover; retain account management, unavailable-account feedback and complete-selection guards.
- [x] Add labelled context/thinking/enabled columns and per-model thinking dropdowns with `Inherit`, persistence/failure feedback and visible shared-scope text. Retain narrow-screen reachability.
- [x] Verify mounted real-owner behavior across account/provider navigation, pending reads/writes, pins/project overrides and the shared configuration draft; keep chat/project mutation routes uncalled.

### 3. Review and accept the settled candidate

- [x] Update the focused model guide and English messages with the delivered controls and scope.
- [x] Add or extend a thin installed desktop/mobile bridge for physical selector/row reachability and durable default readback; preserve existing scenario assertions and version changed input bodies honestly.
- [x] Obtain independent review and resolve actionable findings without substantial new machinery. Stop for a design decision if the public owners cannot support a bounded implementation.
- [x] Run focused Nix checks, then complete core/static/plugin, all browser/terminal groups and the genuine deployment VM from [Testing](../../testing.md). Record immutable inputs, widths, results, command runtime and preparation/execution intervals privately.

## Verification

- Focused receiving selection passed **16 files / 289 tests**, plus static checks. Independent review closed queued-readback, list-retention, refreshed-catalog reconciliation and persistent read-only recovery cases with causal mounted regressions. Existing F/N/E classifications and import-audit holds were retained.
- Original-base complete acceptance passed **523 files / 4,414 tests**, all **26 browser/terminal groups / 58 inputs** and the genuine Home Manager VM in **463 seconds**.
- After the independent local-main Copilot tool-schema integration, replay preserved the UX source and both plan-index entries. Composed candidate `3bda1517e33b7191080be31d1ba82ed26e6e9335` passed `nix run --offline --no-write-lock-file .#test -- all --workers 4 --jobs 4`: **523 files / 4,429 tests**, all **26 groups / 58 inputs**, and the genuine VM, with no skipped/cancelled cases.
- Composed command runtime was **517 seconds**, including realization. Core invocation/lifecycle were **511.942 / 475.694 seconds**. Browser invocation was **370.647 seconds**, including **86.113 seconds** support realization, **4.905 seconds** definition publication and a **279.626-second** group window. Service invocation was **67.535 seconds** including realization; guest evidence took **19.716 seconds**. Overlapping intervals are not additive, and these are not cold-cache or implementation-time measurements.
- Requested/effective widths were **four core workers / four browser sandboxes**. At the admission decision the host exposed 32 CPUs and approximately 42.65 GiB available RAM, below the 43 GiB estimate for twelve/four overlap; the selected sixteen-CPU/27-GiB overlap was admitted. Immutable source content/mode digest: `36307c90753f9fdd131ff375f6db4d14d39c09f3703a75e9f723726ac713cf3e`.
- Installed desktop/mobile checks used synthetic catalog/account inputs but real native preference save, file readback, cross-catalog display and reopen, retaining the saved-600000 budget geometry. This is not live-provider/OAuth/entitlement, actual-phone or deployed-service evidence.

## Rollback / Recovery

Edits are isolated from local main. There is no migration or new file format. Native preference edits use existing setters/removal, and `Inherit` removes the selected model's global entry only. No live user settings are read or rewritten for verification. Native same-field persistence semantics are retained, not promoted to a cross-process per-key transaction guarantee. Integration, remote operations, deployment and resource cleanup retain their separate Git/operation gates.

## Completion Checklist

- [x] The visible provider detail owns account selection, with no implicit chat/project rebinding or catalog/usage network calls.
- [x] Model rows edit one shared native default per model; inheritance, supported levels, pins and project overrides are represented accurately.
- [x] New-composer suggestions agree with native defaults without replacing explicit conversation intent or modifying running sessions.
- [x] Existing shared drafts, credentials, enabled-pattern behavior and failure/currentness guards are preserved.
- [x] Independent review and complete required Nix acceptance are verified for the candidate; local integration remains exact-state gated and is not deployment/publication authority.
