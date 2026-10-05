# Optional bundled Git Workflow plugin

## Goal

Implement the requested optional browser-only Git plugin on local `rst-main`
6a0678d12da2b40cbdd6f2f2560add8215aa4e8b in `feat/git-workflow-plugin`.
Implementation, tests and unsigned feature commits are authorized. Integration
into current local rst-main by unsigned non-FF merge, publication, deployment
and cleanup remain separate approvals.

## Plan Relationship

The removed managed Workflow is not restored. Its historical plans and private
data are untouched; this plan owns only the new optional bundled plugin.

## Architecture

Static typed bundled registry composes Pi inline extensions. Core owns private
schema-validated overrides and generic transient cards on the existing session
UI transport. Git owns its tools and settings manifest. No task, reservation,
quarantine, evidence receipts, reconciliation or arbitrary code loading.

Settings resolve built-in → global → canonical-repository project overrides.
Enablement is a global kill switch; no chat overrides. Tools read current settings
per invocation and again after approval/checks. Approval data stays out of model
summaries and cannot be restored from transcript history. Native effects settle
without cancellation; pending questions cancel on disable/Stop/teardown.

## Plan

- [x] Add registry/schema, explicit overrides/reset/origins and private persistence; verify focused core tests.
- [x] Add generic text/Markdown/supplied-patch/action cards to existing pending request transport; test validation, reconnect, cancellation and restart non-replay.
- [x] Add Git tools and Settings → Plugins control, exact previews, required checks and revalidation; test deny/ask/allow, resources, stale state, conflicts and staging preservation separately.
- [x] Document commands and CI selection; run required common checks and affected browser acceptance, review feature commits and prepare the unintegrated candidate.

## Risks / Recovery

External Git/filesystem writers can race final validation; native Git locks own
writes, never the approval wait. Checks are user-configured executable shell
commands and may have side effects; failures report that fact without retry or
rollback. Conflicted rebase/merge state remains visible for explicit resolution;
no reset or hidden recovery. Disable prevents new execution but does not kill a
native write already in progress. Settings live outside Git, with no legacy-data
migration. Terminal integrations are not changed.

## Verification checkpoint

- Foundation/card checks passed (17 cases); separate Git + real Pi lifecycle
  selection passed (15 cases). Typecheck and lint passed in the offline Nix shell.
- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`:
  231/231 files, 1,499/1,499 cases, exporter/typegen/typecheck/lint passed.
  First attempt failed the new route fixture's absent Host header (1,053 passes,
  one failure, 54 unstarted); corrected the fixture, not API protection.
- Credential-free, eight-CPU-affinity `npm test` passed; final count and exact
  candidate verification will be reported at handoff.
- Plugin-only `npm run test:e2e` passed desktop/mobile (`/tmp/pi-plugin-browser8.log`).
  Earlier attempts exposed delayed checkbox state (fixed with optimistic UI plus
  error rollback) and fixture issues: incorrect Stop label, mobile navigation,
  repeated content across viewports and hidden mobile Stop controls. Fixed
  fixtures use real controls/composer Escape and actual server settlement checks;
  no force clicks, reduced assertions or increased deadlines.
- Full core browser acceptance failed its existing reading-position restoration
  assertion at e2e/run.mjs:860 (`/tmp/pi-plugin-core-browser.log`). A pristine
  local-base copy passed (`/tmp/pi-plugin-base-browser.log`); that alone cannot
  attribute the failure. Read-only investigation found concrete stale observer
  and incomplete prepend-anchoring races. A bounded shared-UI regression repair
  and deterministic tests were added in separate commit `66337e8`; the original
  assertion/deadline remain. Both subsequent full core browser runs passed;
  no runner redesign.
- No production build, integration, publication, deployment or feature cleanup.

## Completion Checklist

- [x] All-disabled Pi Web and ordinary tools remain usable without Git guidance.
- [x] Required tests/typecheck/lint and browser acceptance results are reported honestly.
- [x] Reviewable commits and exact code candidate are verified; final plan-only
  handoff gets a narrow unchanged-input/documentation check. Feature resources
  remain for separate integration, publication, deployment and cleanup approvals.

## Final acceptance / handoff

Code candidate **66337e8fe69b62fb3b453d4f863f6b7aafb3cd6d** is prepared on
unchanged local rst-main **6a0678d12da2b40cbdd6f2f2560add8215aa4e8b** (no rebase
needed). Current behavior, commands and limitations live in
`docs/git-workflow-plugin.md`, README/AGENTS and the testing guides.

Exact-code lifecycle verification passed:

| Command/selection | Result | Receipt prefix |
| --- | --- | --- |
| `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs` | 231 files / 1,500 cases; exporter/typegen/typecheck/lint passed; no unstarted/uncertain/surviving files | `a36a9101` |
| Credential-free eight-CPU `npm test`, separate `plugins/**/*.test.mjs`, `tsc --noEmit`, `npm run lint` | 1,501 core and 15 plugin cases; all passed | `8fe6c0f6` |
| Credential-free `npm run test:e2e` | Full desktop/mobile core acceptance passed | `2fadf1df` |
| Same command with `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1` | Desktop/mobile plugin acceptance passed | `05aff7bc` |

Logs/receipts are retained under the common Git directory's external lifecycle
`git-workflow/`, not application plugin authority. No terminal integration changed;
terminal-specific browser acceptance is not applicable to this delta. No build,
integration, publication, deployment or feature-resource cleanup occurred.
The archived handoff is the only later documentation delta; application acceptance
belongs to the code candidate above, not a claim that full suites ran on that later tip.

Known limitations: unborn repositories, sparse/hidden-index and clean-filter states
are refused; checks run in disclosed checkout locations rather than exported
candidate/merged trees; external writers can race final validation. These are
explicit in the maintained guide, not deferred orchestration obligations.
