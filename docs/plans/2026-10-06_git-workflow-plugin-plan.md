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

- [ ] Add registry/schema, explicit overrides/reset/origins and private persistence; verify focused core tests.
- [ ] Add generic text/Markdown/supplied-patch/action cards to existing pending request transport; test validation, reconnect, cancellation and restart non-replay.
- [ ] Add Git tools and Settings → Plugins control, exact previews, required checks and revalidation; test deny/ask/allow, resources, stale state, conflicts and staging preservation separately.
- [ ] Document commands and CI selection; run required common checks and affected browser acceptance, review feature commits and report exact unintegrated candidate.

## Risks / Recovery

External Git/filesystem writers can race final validation; native Git locks own
writes, never the approval wait. Checks are user-configured executable shell
commands and may have side effects; failures report that fact without retry or
rollback. Conflicted rebase/merge state remains visible for explicit resolution;
no reset or hidden recovery. Disable prevents new execution but does not kill a
native write already in progress. Settings live outside Git, with no legacy-data
migration. Terminal integrations are not changed.

## Completion Checklist

- [ ] All-disabled Pi Web and ordinary tools remain usable without Git guidance.
- [ ] Required tests/typecheck/lint and browser acceptance results are reported honestly.
- [ ] Reviewable commits, exact candidate and known gaps are presented; feature resources retained pending separate approvals.
