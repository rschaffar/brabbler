# Top-level completion review

## Goal

Keep completed subagents and BTW conversations out of Ready to review and completion-based Later, including previously deferred results. Preserve their live activity, pending questions (including deferred questions), queue, interruption and pause states. Remove the bulk subagent Read action and obsolete client tracking.

## Plan

- [x] Restrict completion review to ordinary sessions and forks; unify client review IDs and remove redundant notification classification. Verify focused projection/controller/mounted tests, including old deferred child results and stale actions.
- [x] Remove the bulk action, unused styling/messages and obsolete test flows. Preserve live child nesting, worktree metadata, privacy and family-usage coverage; update changed browser receipt identities and the owning feature/testing guides.
- [x] Review the settled diff and run complete sandboxed core, browser/terminal and deployment acceptance. Prepare the verified candidate for the separate required local non-fast-forward integration approval.

## Non-Goals

No deletion or migration of saved completions, receipts or conversations. No change to subagent execution, BTW capabilities, push delivery, live-state precedence or pending-question deferral. No remote publication or installed-service activation.

## Evidence

- Verified source content/mode SHA-256: `99f1f63a20e77093ecc1957c701b11fff764d964c8a3f48f9f88c79810fae679`. All changed application/test/guide files matched that snapshot byte-for-byte; only this plan's completion status and archival location changed afterward.
- `nix run .#test -- all --workers 4 --jobs 12`: passed on Linux; requested/effective widths were 12 core workers and 4 browser sandboxes with admitted overlap. All 531 core files / 4,591 tests, 25 browser groups plus terminal, and genuine Home Manager deployment VM passed.
- End-to-end command: 405 seconds, including realization. Browser support/definition preparation: 122.4 seconds; browser execution window: 210.3 seconds. Core level: 324.3 seconds including preparation/execution; deployment level: 65.7 seconds, with 18.8 seconds of guest test execution. Overlapping intervals are not additive. Earlier focused runs warmed static prerequisites; these are not cold-cache benchmark claims.
- Six focused owner files passed 96 tests before final review changes; full acceptance covers the settled candidate and the added peer-receipt regression. An initial missing-button assertion misused a fixture lookup and was corrected. A private eligibility fault caused the intended projection/child-absence/sound failures after unsafe DOM diagnostics were changed to bounded boolean assertions. A separate cached-eligibility fault failed the new stale-peer-receipt assertion. These expected-red variants never entered the delivered candidate or full-acceptance inputs.
- Independent static review identified current-receipt validation and reload-readiness issues; both were corrected, regression-covered and re-reviewed without remaining findings. Full browser coverage proves the natural post-reload poll and rendered empty state, not absence from an initially empty view.
- Durable behavior belongs to `docs/feature-internals.md`; changed browser ownership and retired bulk assertions belong to `docs/activity-testing.md`. Raw run receipts/logs are private external task evidence, not repository content. No remote publication or installed-service activation occurred.

## Completion Checklist

- [x] Focused tests confirm child completion exclusion without losing actionable child states or ordinary/fork completion review.
- [x] Complete acceptance passes for the settled candidate; command runtimes and artifact locations are reported.
- [x] Durable behavior is documented in the feature guide and the reviewed candidate is ready for the Git lifecycle handoff before this implementation plan is archived. Integration itself still requires exact-state approval.
