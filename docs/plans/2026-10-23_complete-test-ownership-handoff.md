# Complete test ownership — fresh-session handoff

The block below is the **historical handoff used for the resumed session**.
The [active plan](2026-10-23_complete-test-ownership-plan.md) now owns the adopted
receiving commit, early whole-feedback result and required bounded next decision.
Do not treat the block's old HEAD, source-only status or absence of current full
acceptance as current state. For a later restart, validate the exact HEAD supplied
by that user's resume request. Current-session implementation authority does not
carry into a new session; rebase/merge/cleanup/publication remain unauthorized.

Retain the block below as historical restart context. **Do not launch it automatically.**
The recommendation is recorded, not new implementation authority. To explicitly
resume in the new session, replace the block's opening pause instruction with:
“Resume implementation under the revised plan after read-only state validation;
this authorizes no rebase, merge, cleanup, publication or session launch.”

```text
Continue the complete-test-ownership task using its documented material replan.
Start PAUSED/read-only. Unless I explicitly authorize resumption in this new
session, do not implement, test, benchmark or launch/restart subagents. A plan or
this handoff does not grant that authorization. Never infer permission from the
older “continue until done; only then merge.”

Goals, all required:
1. Better test architecture through real lower-cost production owners.
2. Actual removal of redundant Chromium execution/setup/transactions/reloads/waits.
3. Faster complete feedback, not merely focused speed or extra coverage.

Selected checkout:
F=/home/robert/projects/3rdparty/pi-desk-worktrees/complete-test-ownership
Branch=refactor/complete-test-ownership
Implementation base HEAD=ac9a205fe8d5e973fe57897785cfa2ba2b2ba539
Common Git dir=/home/robert/projects/3rdparty/pi-desk/.git
R=/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo

The documentation-only commit containing this handoff follows that base. Resolve
its exact ID with git log -1 --format=%H -- docs/plans/2026-10-23_complete-test-ownership-handoff.md,
and compare git rev-parse HEAD; do not mistake the implementation base for the
new documentation tip. At assessment start the index was empty; 56 dirty/untracked
non-documentation files were preserved. R/documentation-replan/INITIAL-STATE.json
binds their original bytes and the four already-dirty documents. Do not stash,
reset, clean, discard or overwrite that work. No implementation adoption, rebase,
merge, resource cleanup, remote or host-service action occurred in the replan.

Read, in this order:
- F/AGENTS.md and applicable git-worktrees/writing-plans guidance.
- F/docs/plans/2026-10-23_complete-test-ownership-reflection.md
- F/docs/plans/2026-10-23_complete-test-ownership-plan.md (sole next-work status)
- R/PAUSE-HANDOFF.md only for exact historical lineage/delivered packets.
Use existing evidence/maps first, with targeted reads. The old 674-line plan is
preserved under R/documentation-replan/before/docs/plans/. docs/test-ownership.md
is the baseline 68 census, NOT a current list of 68 pending implementations.
CURRENT-STATUS, RESTART-HANDOFF and LATEST-ROUND reports are older checkpoints,
not instructions to resume. CodeGraph returned a worktree/indexed-document
mismatch; use exact plaintext/hash bindings, not its unrelated discovery output.

Recommendation: materially replan execution, not abandon the architecture.
One repository writer, one coherent working candidate and one implementation slice
at a time. Reuse reviews/control evidence for unchanged relevant inputs. Add proof
only for named uncovered changed contracts; no snapshot/report/control quotas.
Do not restart stopped delegates or create more private roots by default.

What is actually verified:
- Historical complete correctness exists, but last matched full4/4 NET FAILED:
  reference421.959333907s -> candidate430.231565s, +8.272231s and79.181565s over351.05.
  Both roots already include the lower layer; not an original-versus-whole-overhaul
  comparison. Core415.258->422.398s dominates, browser348.749->347.310s. A single pair
  does not establish a stable statistical regression. No newer full pair exists.
- R/browser-retirement-v2-coherent-sixth-source:42files571tests85s and11 affected
  installed receipts, finite focused evidence, not whole acceptance.
- R/browser-retirement-v2-thinking-tool-common-second-source:24combined normal,
  six meaningful producer faults; restored60files806tests104s. This PRECEDES the
  navigation optional fixture port; it does not qualify that port.
- Latest lower root is R/browser-retirement-v2-navigation-default-common-fourth-source:
  26green44s; three producer faults and new receiving-pool run remain open. It
  inherits the experimental version LM cut, so is NOT a fully admitted baseline.
- Native version body/dialog port is already finite-qualified. LM cut normal
  both52s/protocol118green39s is conditional on lower exceptional cleanup.
- Source-only/partial/absent deliverables are explicitly separated in the plan
  and PAUSE-HANDOFF. Never call source-admitted, assembled or reviewed “executed.”

Next, ONLY AFTER explicit resumption:
1. Revalidate checkout/branch/HEAD/index/status, live Git policy and changed inputs.
2. WP1: consolidate qualified work by sparse receiving edits, preserving both
   Thinking/Copy seams and Settings appends. Resolve Files terminal-release versus
   intentional Save200/409 observer-unmount, and eight Navigation REALM descriptors
   restoring after close. Use the concrete Files REMEDY-REVIEW; don't redo discovery.
3. WP2: close finite B3-B7. Start coupled Reading/Thinking/Tool/version/navigation,
   then caller-preserving Files, exact Git and Activity gaps. Ready Thinking and
   composer controls are source-only. Web controls are partial; new Tool exceptional
   and Git policy/large packets DO NOT EXIST. Scope missing proof to actual risk.
   Pair verified lower owners with real browser deletion and fresh metadata; no
   whole-postimage overwrites from older roots.
4. At the first coherent candidate, take an early whole-feedback checkpoint before
   optional expansion. After source/review settle, complete current acceptance and
   matched sequential all --workers4 --jobs4 comparison (normal CLI spacing below).
   If core still prevents the ceiling, stop and report/request a bounded decision;
   do not automatically revive RPC/cache proposals or substitute core for retirement.

Acceptance gates (commands are future instructions, NOT authorized now):
- Existing public nix run .#test -- core|e2e|service|all remains stable.
- Fresh complete comparison: nix run .#test -- all --workers 4 --jobs 4;
  sequential reference/candidate, no competing resource checks, same common inputs,
  prerequisites and widths. Real static/core/plugins, all installed browser/terminal
  and genuine Home Manager VM. No routine duplicate cacheable+fresh full acceptance.
- Complete command<=351.05s AND actual matched NET improvement; Panel median<=20.5s
  using nix run .#test -- core --jobs 4 --file lib/panel-layout.test.mjs.
  Report preparation, execution, browser work/critical path and whole feedback
  separately. Focused/warm/preparing gains are not complete-feedback evidence.
- Each browser step/input needs a concrete incremental rendering/native/thin
  installed-wiring failure; historical26groups/59receipts are not quotas.
- Preserve P1 same-document History and all six M16 same-node/native Save-watcher
  checks, original physical/locale/storage/session/cwd/source/incarnation inputs,
  real native authority and independent admitted Acceptance work.
- Full original work/body/descendants != external ACK != native settlement. Keep
  SAME original errors and independent releases/joins/removal. Restore REALM before
  destruction, HOST after; don't release deliberate held-work inputs prematurely.
- Activity 2500ms/privacy-recovery 15000ms and original policy remain. Only the three
  previously authorized Terminal/SSH/role-prefixed-key policy corrections are in scope.

Do NOT repeat:
- A new 68 census, fixture discovery, unchanged reviews or already-qualified native
  version controls without a relevant input change.
- Broad source-only delegation, automatic controls for every observer, repeated
  packet/mirror/addendum publication, or progress percentages based on coverage.
- Whole-journey KEEP because one step is native; assertion-only “browser savings.”
- Selector/catalog/gutter/StrictMode/fixture-policy guesses before costly runs.
- Unsafe timestamp4->2 or speed4->3, copied-error acceptance, universal idle/escaped-
  descendant claims, E-first/group mixing, wider workers/deadlines, sleeps as joins,
  suppressed warnings/errors, replayed native authority or weaker exporter guards.
- Full acceptance solely because a commit ID or evidence Markdown changed.

No merge before whole-task completion. Rebase, exact-state unsigned non-FF local
main integration, cleanup and publication require their applicable separate
lifecycle/authorization; this handoff requests none. No new session launch is
requested. If a next step changes product policy, task scope or acceptance, ask.
```

**Known gaps:** The plan's B1–B8 remain open; no current whole acceptance or passing
NET result is established. The replan itself ran no tests, benchmarks or subagents.
