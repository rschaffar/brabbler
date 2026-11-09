# Notebook-wide reference refresh

**Status:** Initial implementation slice completed, independently reviewed and fully verified. This is the implementation/acceptance record; required local integration and cleanup remain owned by the native Git lifecycle and its exact-state approval/receipts. No deployment or publication implied.

## Goal

Make refreshing a large guided notebook after verified history rewriting a native workflow, without custom metadata-migration scripts. Preserve exact evidence, explicit acceptance, current authorization, revision-checked per-file saves and historical test provenance.

## Plan relationship

This extends the delivered inspect/update/reference-maintenance behavior described in the notebook-authoring plan and ADR 0041. It does not reopen reader recording retirement or parked authoring-guidance packaging. The maintained contract belongs in `docs/review-notebooks.md`; existing Git, file-security and testing guides remain authoritative.

## Scope and architecture

- Extend the existing native tools and shared libraries; no service, database, CLI, notebook format or browser interface.
- Add a compact target inventory to explicit notebook inspection.
- Allow each independently admitted checkout mapping to select named targets or discover only Git targets whose old OIDs occur in that explicit mapping. Discovery reads the declared notebook, never scans repositories or infers correspondence.
- Analyze the complete selected notebook under the existing Git work budgets. Reuse verified immutable object data only within that invocation. Capture each repository/branch once and revalidate all captured identities/tips before returning; apply independently reanalyzes current inputs and revalidates before each file save. Never cache current grants or mutable repository/ref probes.
- Return whole-selection counts and bounded, filterable result pages. Bind the full input/package/results, not a presentation page. Page retrieval can require the prior binding so changed inputs refuse rather than silently changing the report.
- Add explicit per-target source destination path/range overrides. Validate them through the existing path, type, UTF-8, size, range and reachability rules; never guess renames or proportionally interpolate changed code. Preserve the current exact multiline relocation behavior for destinations without an explicit range.
- Report evidence scope and concrete prose-review reasons, with bounded before/after source previews. Metadata application remains separate and accepts explicit stable target IDs, not implicit acceptance of a whole page or status class.
- Retain combined-package preflight, exact outside-fence preservation, current grant/cancellation checks and truthful completed/unknown/unattempted per-file outcomes. No automatic replay or rollback.

## Non-goals

Derived evidence-asset generation, automatic commit correspondence, many-to-many history interpretation, full-file span semantics, semantic prose validation, test-claim migration, executing tests through notebook tools, Git mutations, publication and deployment. These remain proposals, not implemented acceptance claims.

## Plan

- [x] Add target inventory, mapping-scoped discovery, whole-selection bindings and bounded report pages; verify named-target compatibility, complete selection and stale-page refusal with production/native fixtures.
- [x] Add explicit source destinations and operation-local immutable-read reuse; verify rename/range changes, exact relocation, ambiguous/missing evidence, unchanged authority/limits and large multi-chapter refresh without repository writes.
- [x] Extend native SDK tests for bulk discovery/report/apply and live capability revocation; preserve existing partial-save, cancellation and historical-evidence assertions.
- [x] Update the maintained notebook/feature contracts; independent runtime/safety and fixture/API reviews closed. Session composition and saved child allowlists are unchanged and retain native SDK coverage.
- [x] Run focused Nix checks during iteration, then complete acceptance on settled inputs using `nix run .#test -- all --workers 4 --jobs 12`. Exact evidence and timing are recorded below.
- [x] Prepare the coherent requested diff, settled verification evidence and independent review for handoff to the native Git lifecycle. That separate owner still requires current-main revalidation/rebase, exact-state approval and unsigned non-fast-forward local integration, with retained resources if blocked and no remote authorization.

## Verification evidence

On native x86_64 Linux, complete fresh acceptance passed on the implementation
based on local main `f34a0c531b561233054ea17f16bd3934db990949`:

- Command: `nix run --no-write-lock-file .#test -- all --workers 4 --jobs 12`.
- Outer source-export SHA-256:
  `93ca39bdd904c56a8719b1f02cd4cbf70a7d7b243a7e0b155cc41e8ee1dfdd24`.
- Core/static/plugin: **534/534 files, 4,637/4,637 tests, 14 suites**, with no
  failures, skips or cancellations. Required typing/lint evidence passed with
  seven existing warnings. Core output:
  `/nix/store/cf2pq6kjqwd7lpc8ngkqr3chs6fvibbb-brabbler-core-checks`.
- All **26 browser/terminal groups / 61 complete input chains** passed. Browser
  and genuine deployment used the same isolated production package:
  `/nix/store/7wv5z5g5vxlixbfcdcgw92l0rgbxsrmr-brabbler-0.1.0`.
  The deployment VM passed activation, permissions, durable HTTP writes/restart,
  real PTY and final shutdown/port/cgroup checks. No installed host service used.
- Requested/effective widths: **12/12 core workers and 4/4 browser sandboxes**,
  admitted overlap on 32 available CPUs and approximately 59 GiB available RAM.
  Existing E holds remain exclusive; no scheduling promotion or browser retirement.
- Whole command: **475 s**, including in-run realization, excluding model/review
  work. Core invocation **396.892 s**, pre-file envelope **43.383 s**, file window
  **352.971 s**. Browser support/manifest preparation **109.194/7.802 s**, group-client
  window **284.628 s**. Deployment invocation **65.776 s**, guest test script
  approximately **20.13 s**. Overlapping intervals are not additive. Focused runs
  warmed static/dependency outputs; production realization occurred in this run.
  These are correctness timings, not a cold-cache or matched performance claim.

Native regressions include a synthetic 236-card/167-path/10-chapter workflow,
whole-selection report/filter bindings, explicit rename/range destinations,
UTF-8 preview and complete-response byte bounds, warmed-cache grants/cancellation,
head-specific reachability, late mutation of an unresolved earlier checkout,
sticky budget refusal before capture completes and original partial/unknown saves.
Actual offline SDK sessions cover inventory/report/apply, source destinations,
strict schemas, read/edit separation and retained child/selector/revocation behavior.

A private source-only negative control disabled explicit-range handling: the
renamed-source runtime assertion failed (`moved` instead of `changed`), while the
other 38 cases passed. No production package was built from the control. Earlier
focused failures were fixture errors (an unseparated Markdown fence and expecting
Node's timer cancellation reason directly rather than through `AbortError.cause`);
the final complete run includes their corrected cases. Raw controls, failures,
review sessions and execution reports are retained privately, not tracked here.

Subsequent plan/index evidence-only edits do not alter tested runtime/test/Nix
inputs and are not relabelled as a new application run. This record is archived
at implementation handoff, not as proof of Git integration. Current operation
receipts own actual commit/rebase/merge/cleanup outcomes; all required local gates
remain in force.

## Stop conditions and recovery

Stop on unexpected repository changes, changed grants, conflicting source writers or stale package/repository bindings. Budget exhaustion is unavailable evidence, never partial equality. Missing/ambiguous targets remain explicit and cannot be accepted. Stop after partial or uncertain writes and reread before new analysis; do not replay effects or overwrite newer edits. Feature-worktree removal and branch/artifact cleanup use their separate native gates.

## Completion checklist

- [x] Large notebooks can be inventoried, analyzed, reviewed in bounded pages and explicitly refreshed without shell migration scripts.
- [x] Explicit renamed/changed source destinations work without weakening reader admission or implying semantic/test equivalence.
- [x] Existing authorization, cancellation, stale-state, byte-preservation and partial-save obligations remain covered; changed tests retain explicit live E holds.
- [x] Independent review and complete core/static/plugin, browser/terminal and genuine deployment acceptance pass on the receiving candidate.
- [x] Maintained documentation and public-safe implementation diff are reviewed.
- [x] Implementation evidence is handed off without claiming Git integration, deployment, publication or cleanup; those remain subject to their required native gates.

**Known gaps:** No host deployment. Derived assets, automatic correspondence and semantic prose/test-claim validation remain outside this initial slice.
