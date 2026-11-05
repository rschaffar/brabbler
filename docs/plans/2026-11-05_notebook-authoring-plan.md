# Guided reading and native notebook authoring

**Status:** Ready for exact-state local integration approval. P0–P3 checkpoint
reviews, P4 overall review and complete Nix acceptance are finished. Reader
simplification, native inspect/update and explicit reference maintenance are
implemented. Local merge remains pending; no deployment or publication is implied.
**Workspace:** `feat/notebook-authoring`, originally based on local `main` at
`14d60757535e0ed78ff3753fda1372b0e4c47bbb`, subsequently rebased onto
`b5696cd4cfb935b9bdc3f8d7918bbd41da419286` with approved conflict resolutions.
One receiving worktree and one repository
writer; independent reviewers do not edit it. Nothing here authorizes deployment,
publication, Git history rewriting or deleting saved user data.

## Goal

Make notebooks agent-editable walkthroughs, not review-management systems. Retain
step-by-step explanation and exact Git evidence; remove the questionnaire,
reviewer recording, findings tray, frozen batches and JSON-reply workflow. A reader
can discuss a step in ordinary chat, ask for a targeted revision, and reload the
guide without unnecessarily losing their place. Native Brabbler tools give agents
a compact overview, safe step edits and conservative Git-reference maintenance.

## Plan relationship

- This plan owns notebook authoring, reader simplification and retirement of the
  interactive reviewer record. It does not own Git-operation cards or their
  distinct storage/converter in the Git-backed operation-reviews plan.
- Add an ADR explicitly superseding ADR 0036's recording/form/handoff decisions.
  Preserve ADR 0029's immutable read-only evidence and authorization boundaries.
- The existing parked authoring-guidance packaging work is not merged or rebased
  into this branch. This plan owns the new tool instructions and current notebook
  guide; packaging a separately installed skill remains outside scope.
- Existing Git/plugin/session contracts remain authoritative. Reuse the extension
  registration infrastructure, not the optional Git mutation plugin or a new host.
- `docs/testing.md`, `docs/test-writing.md` and `e2e/README.md` own acceptance.
  Documentation-only planning checks are not application verification.

## Grounded baseline at the starting revision

- `GuidedReviewReader` owns free Back/Next, outline, pane layout and immutable
  evidence; `NotebookReviewPanel` is mounted separately below it.
- `lib/guided-review.ts` parses Markdown manifests, stable steps and evidence.
  Git evidence stores checkout/branch/full OIDs/path/ranges, not source copies.
- Recording uses `lib/notebook-review*`, `/api/review-data`, browser recovery keys
  and `review-data/` sidecars. It is not required for reading.
- AppShell/FileWorkspace/FileViewer already carry an explicit selected-chat draft
  callback. `prepareReviewDraft` checks the current destination and preserves the
  existing composer. Reuse that mechanism without frozen batches or auto-send.
- `lib/file-edit.ts` supplies bounded, no-follow, revision-checked file saves.
  Reuse its semantics rather than inventing a second replacement protocol. It is
  atomic per file for cooperating in-process saves, not external-writer exclusion.
- Existing inline extensions/bundled plugins expose structured agent tools. Read
  the installed SDK extension documentation before implementing registration.

## Product and compatibility decisions

### Reader and ordinary conversation

Keep explanation/evidence/outline controls, pinned source and diff modes, comparison,
keyboard/touch behavior and current reader-state caching. Remove recording controls,
anchor-capture buttons, required-answer gates and reviewer forms. Legacy authored
question fences remain parseable and their question/context/explanation and option
text is shown as optional author guidance, without answers or completion state.
Required flags and selection rules have no interactive effect. New
notebooks should express reading prompts directly in Markdown.

A single **Ask about this step** action appends a bounded context block to the
currently selected existing chat draft: index/chapter path, notebook/step identity,
title, a displayed-step content identity and the relevant pinned reference definitions.
The identity is stale-context information, not a write capability or a saved batch.
It sends nothing and never
creates a session. A switched/missing/unmounted destination retains the reader and
shows a useful message. Normal user text and images stay intact. A fresh session
can use the same explicit file/step identities without the original chat or an
open browser pane. No concerns queue, classifications or reply import is added.

Provide explicit **Reload guide** while reading. Keep the selected stable step and
layout where possible; clearly report removal of the selected step. Changed target
identities get fresh reader state; unchanged targets may retain compatible state.
Late reads cannot replace a newer notebook. Do not introduce background Git repair,
automatic session execution or polling solely for this feature. Cross-activation
resume is deferred; preserve position during explicit in-reader reload without
creating another persistence owner.

### Retire recording without deleting history

Stop mounting or writing the old reviewer state. Retire recording-only runtime
modules and tests once replacement assertions are assigned. `/api/review-data`
returns an explicit retired response without opening, creating or rewriting saved
history. Existing `review-data/` files and browser recovery keys are left untouched;
explain their retained locations and manual export/recovery in the maintained guide.
Do not migrate private feedback into prompts or new notebook files. No automatic
cleanup, conversion, current-answer preservation or legacy-record management UI.

### Native agent tools, one reusable implementation

Use a focused notebook-authoring library and thin Brabbler tool adapters, with no
CLI, MCP server, new service or alternate notebook format in the first delivery.
The exact exported names can follow existing conventions, but expose three bounded
capabilities rather than a general document-management framework:

1. **Inspect:** explicit index path, optional step ID; return compact outline,
   chapter/step/target identities and validation diagnostics. A selected step also
   returns its source and revision precondition. Git inspection is explicit and
   bounded; opening an outline does not load every asset or sidecar.
2. **Update step:** explicit index and stable step ID plus inspected preconditions
   and replacement step content/title. Inspection binds notebook identity, manifest
   revision, resolved chapter path, step ID and whole-chapter revision; revalidate
   that binding and package membership before effects. Preserve unrelated byte
   ranges, IDs and original newline/formatting outside the requested replacement.
   Parse and validate the resulting package and unchanged other-step boundaries
   before writing; reject fence escapes that swallow another step. No unrelated
   file edits, guessed step matching, silent last-write-wins or automatic Git operations.
3. **Refresh references:** analyze an explicit full-OID mapping and return proposed
   metadata-only edits plus unresolved cases. Agent-led Git research can supply the
   mapping; automatic range-based correspondence discovery is deferred. Applying
   accepted edits is a separate explicit tool operation bound to inspected file
   revisions and reference identities. This is an agent operation, not a new user
   questionnaire or blanket Git approval.

Read-only sessions/profiles must not gain writes through an extension. Registration
and invocation must respect active read/edit capabilities and the existing child
extension allowlist. Define inspect/analyze as read capabilities and update/apply as
write capabilities; recheck live grants before effects after asynchronous work.
Capability removal after registration, deny-only/fully-denied and resumed child
profiles must not gain tools through fallback. Chat-only remains tool-free. Author paths and Git checkouts
must independently pass the existing lexical/physical path boundary; authored paths
and transcript references cannot add roots. Do not inspect credential files, scan
unrelated repositories or expose browser recovery/private reviewer data.

The library reuses strict parser limits, physical containment and existing file-save
preconditions. Post-write results name actual changed files/revisions. Multi-file
refresh is explicitly per-file, not an invented transaction: preflight all inputs,
stop on the first changed/failed file, report completed and untouched files, and do
not roll back over newer writes or retry successful effects.

### Conservative Git-reference refresh

- Readers continue resolving exact pinned commits. No automatic HEAD substitution,
  branch-name rebinding, hidden Git retention refs, network fetch or repository writes.
- Require explicit old-to-new full-OID maps scoped to an admitted physical checkout
  and named targets. Subjects, patch IDs and `git range-diff` similarity can inform
  the agent's proposals, not prove equivalent source or behavior. Ambiguous/missing/
  split/squashed cases remain unresolved; independent valid edits stay available.
  A mapping never infers a checkout or branch change.
- Old commits may be unreachable after rebase. The authoring inspector can read
  explicit local objects in an independently admitted repository; it must not weaken
  the reader's branch/reachability checks or silently adopt a different repository.
  Apply revalidates physical repository identity and normal destination reader
  admission: literal branch, reachable new commits, valid paths/types/ranges and
  comparison ancestry/order. Missing objects are different from unreachable objects.
- Check actual referenced path/type/range and relevant immutable bytes; for diffs
  check the old/new endpoint file versions and first-parent semantics. Distinguish
  unchanged bytes, moved unchanged excerpts, changed material and unavailable data.
  Source equality is only excerpt equality; surrounding file/first-parent changes
  stay separately visible. Whole-commit equality requires its complete bounded
  changed-file inventory, otherwise report unresolved/incomplete. A uniquely
  relocated excerpt may be proposed, never guessed from one line match.
- Apply only explicit validated metadata edits. Changed evidence requires agent
  inspection of the prose; semantic correctness is not inferred from equal patches.
  Old test-result claims do not become new-candidate execution evidence.
- Bound object/process output, target count and total work; sanitize local Git reads,
  disable optional helpers/network behavior, and join cancellation/failure paths.

## Non-goals

Review approvals, completion tracking, persistent concern lists, auto-remediation,
automatic rebases/commits, full semantic history alignment, notebook version databases,
remote publication, a new renderer, ordinary live `ask_user` changes, or a standalone
CLI. Do not broaden this into general Markdown editing or cross-project management.

## Plan

### P0 — Independent plan review

- [x] Independent UX/scope and safety/verification reviewers assessed this plan.
  Both permit P1 after these bounded corrections: move retirement documentation,
  recovery and assertion dispositions into P1; retain legacy option text; bind edit
  preconditions to manifest/chapter/step and preserve parsed neighbor boundaries;
  enforce live tool grants; separate unreachable-old-object inspection from normal
  destination authorization; define target-kind equivalence and partial failure.
  All are incorporated above and below. Automatic range discovery and cross-activation
  resume are deferred to avoid expanding the first delivery. No new questionnaire.
- [x] Added ADR 0041, marked ADR 0036 superseded and registered this plan in the
  active index. Local Markdown link existence, personal-path scan and `git diff
  --check` passed. Adjacent Git-operation and parked packaging work stay distinct.
  Both independent reviewers re-read the revised plan/ADR and closed their findings;
  this is planning review, not implementation or application verification.

### P1 — Reader-first experience and retirement

- [x] Replace the mounted reviewer panel and anchor controls with simple step-to-chat
  context and explicit guide reload; cover actual mounted navigation, stale reads,
  destination changes and draft preservation using the production owners. Cover
  A→B→A/ignored-abort delivery, same target ID with changed references, removed
  steps and fresh mutable snapshots. Retain exact browser no-agent-execution tuples.
- [x] Retire recording APIs/modules and recording-specific fixtures; retain legacy
  question readability (including choices) and byte-unchanged synthetic saved
  sidecars/browser recovery, including malformed records. Test retired GET/POST
  with no storage access. Preserve ordinary live-question required validation.
  Document each removed assertion/input at the base revision as retired behavior
  or name its actual surviving owner; do not retire mixed suites wholesale.
- [x] Update current notebook instructions, historical manual recovery guidance,
  feature/test contracts, classification and changed browser receipt identities in
  P1 alongside the behavior change, not deferred to P4. Old records do not retain
  Git objects or reconstruct changed prose; no current-answer negotiation remains.
- [x] Update the installed Markdown desktop/touch chain to prove the simpler flow,
  including no recording writes/no agent turn before Send, while retaining its
  original pinned-reader, asset, layout and navigation assertions. Run focused
  `nix run .#test -- core --file ...` and `e2e --group markdown` selections.

P1 evidence (2026-11-05, x86_64-linux ordinary Nix sandboxes):

- Tested source export SHA-256:
  `b751e32411b21bb7cb6acbbf04b455f19ec349bb821a277e0cef10248acb2cda`,
  based on planning commit `af162360de6bbaba5f74431fb9bd47cbce09b817` plus P1.
  Subsequent plan/status edits are not relabelled as new application execution.
- `nix run --offline --no-write-lock-file .#test -- core --jobs 4` with explicit
  `--file` selections for `lib/notebook-step-context.test.mjs`,
  `components/GuidedReviewReader.behavior.test.mjs`,
  `components/ChatInput.review-handoff.test.mjs`, `lib/guided-review.test.mjs`,
  `app/api/review-data/route.test.mjs`, `lib/e2e-coverage.test.mjs`, and
  `lib/guided-review-browser-contract.test.mjs`: **59/59 tests, 7/7 files pass**.
  Static checks pass with eight pre-existing warnings; type evidence is input-bound.
  Requested/effective file workers: **4/4** (E owners remain exclusive).
  Whole command approximately **43 s**, including approximately **37.6 s** before
  file execution; file-execution window **5.357 s**. Artifact:
  `/nix/store/1b0bcmjbmqghd45l8js5v0q9hn2hsj0r-brabbler-core-checks`.
- `nix run --offline --no-write-lock-file .#test -- e2e --group markdown`:
  both complete installed desktop/touch chains pass, with current v7/v6 receipts.
  One selected group uses **one sandbox**; no reduced full-acceptance budget.
  Whole command approximately **229 s**, support/manifest preparation **91.603 s**,
  browser diagnostic capsule **133.011 s** (browser harness **132.667 s**).
  Artifact:
  `/nix/store/2vyzriy566wfi8bzy5a302i11k4bqzz1-brabbler-browser-markdown-diagnostics`.
- Independent runtime review found passive-index teardown and destination round-trip
  handoff races; both were fixed and reread as closed. Coverage review required
  authentic v1/valid recovery inputs and retained rich-context image/card suppression
  and code readability; replacement assertions now pass. One intermediate test
  failure incorrectly forbade ordinary code-copy buttons as question forms; the
  assertion now distinguishes them. Failed evidence remains retained privately.
- [Retirement dispositions and recovery](../notebook-recording-retirement.md), live
  test classification and current guides are updated. Local Markdown-document link
  existence and `git diff --check` pass. Raw logs/reviewer reports remain in the
  private task evidence directory, not tracked. Full core/plugin, other browser/
  terminal groups and the deployment VM are still P4 work; no merge/deploy occurred.

### P2 — Shared authoring and native tool adapters

- [x] Add outline/selected-step inspection and minimally scoped revision-checked
  edits using the existing parser/file-access/save owners. Native private fixtures
  prove exact outside-step byte preservation, malformed packages, path/symlink
  denial, manifest retargeting, moved/deleted steps, fence escapes, CRLF/Unicode,
  stale chapter revisions, two cooperating same-revision saves, failure reporting
  and preserved unrelated data.
- [x] Register thin tools in the existing extension mechanism, including read-only,
  chat-only, explicit disable/selection and child capability tests. Prove an actual
  synthetic SDK session can inspect/edit a notebook without browser state and cannot
  use the tool to widen its grants. No live model/provider is required.

P2 checkpoint evidence (2026-11-05):

- Shared library and direct native adapters implement bounded inspect and exact
  stable-step replacement. Repeated BOM offsets, same-ID chapter moves, peer
  identity conflicts, first/sole/last boundaries and native save-error propagation
  have explicit regressions. Existing saved reviewer data is not read or changed.
- Actual offline Pi SDK/faux-provider sessions exercise native notebook reads/writes,
  defaults, explicit selections, selectors, saved allowlists, ordinary reopen,
  live read/edit/own-name revocation, abort and shutdown. Separate controlled
  RPC/fresh-child owners prove host composition; these are not an end-to-end
  persisted-child browser claim. Malformed child metadata cannot acquire new
  notebook tools through ordinary fallback.
- Independent library/parser and SDK/capability reviewers closed their scoped
  findings after corrections. SDK fixture admission closes before abort/join;
  complete operation failures remain observable through shutdown/disposal. New
  suites retain conservative E holds; no isolation/pool promotion is claimed.
- Focused `nix run --offline --no-write-lock-file .#test -- core --jobs 4` selected
  `lib/notebook-authoring.test.mjs`, `lib/notebook-authoring-sdk.test.mjs`,
  `lib/guided-review.test.mjs`, `lib/file-edit.test.mjs`, `lib/rpc-manager.test.mjs`
  and `lib/subagent-prompt.test.mjs`: **164/164 tests, 6/6 files pass**, static checks
  pass with eight pre-existing warnings. Source export:
  `631e68627ebdfb7757787fd8d7dcc4990a81cf7a795e5cc4dc097fd62b14140e`.
  Artifact: `/nix/store/2cpi5v87ar8diqs5srrgrwv9z6hcdgwb-brabbler-core-checks`.
  Requested/effective file workers **4/4**, E owners exclusive. Whole command about
  **64 s**, about **37 s** preparation before the **27.135 s** file-execution window.
  Subsequent plan/index status edits are not relabelled as a new application run.
- Earlier failures and reviewer reports remain in private task evidence. These are
  pre-rebase P2 results, not reference-maintenance or complete-acceptance evidence.
  The later approved rebase onto `b5696cd4` preserved main's rename/BTW coverage and
  retired only the new recording-specific saved-answer assertion, with an explicit
  disposition. Independent range-diff review closed at `a73be89b`. Eleven affected
  files then passed **232/232** focused tests; export
  `5aafa22b6ad99859db6bf66ebf08f5043d4f40baa78932a68c742c9240ae8e72`, artifact
  `/nix/store/p33i74gbg3mf470pv1p50674gbsd38yq-brabbler-core-checks`.

### P3 — Git-reference maintenance

- [x] Implement bounded analysis and explicit application of full-OID mappings.
  Native fixtures cover same-content rebases, changed base/lines, repeated patches,
  missing versus unreachable objects, changed first-parent diffs, comparisons,
  mixed resolvable/unresolved mappings and cancellation. Include same OIDs in
  different checkouts, repository replacement and branch movement before apply.
- [x] Exercise complete inspect → targeted edit → refresh workflows on synthetic
  multi-chapter notebooks; prove no repository/ref writes and precise per-file
  partial-failure reports (first save succeeds, second conflicts, later files stay
  untouched). Missing acknowledgement requires rereading before retry, never replay
  or invented rollback. Keep unsupported history transformations explicit.

P3 checkpoint evidence (2026-11-05, x86_64-linux ordinary Nix sandboxes):

- Thin native analyze/apply adapter, bounded immutable Git readers and per-file
  metadata saves are implemented. Independent Git-owner/evidence and orchestrator/
  adapter reviewers closed their scoped findings. Corrected order-file helper
  suppression, checkout-wide mapping ambiguity, combined-package preflight and
  native SIGTERM readiness. SDK partial-error results retain structured completed/
  unknown/unattempted outcomes without replay or rollback.
- Focused `nix run --no-write-lock-file .#test -- core --jobs 4` selected
  `lib/git-read-scope.test.mjs`, `lib/notebook-reference-refresh.test.mjs`,
  `lib/notebook-authoring-sdk.test.mjs`, `lib/git-explorer.test.mjs`,
  `lib/git-file-context.test.mjs` and `lib/git-file-context-lifecycle.test.mjs`:
  **113/113 tests, 6/6 files pass**; static checks pass with eight existing warnings.
  Source export:
  `8fba83cd20a8f88a51d64e88a00b5a07e933f46c91d8cc392b01e0df5d24d075`.
  Artifact: `/nix/store/lizdk5bzg5a0mg38h62nmfma22dar2ch-brabbler-core-checks`.
  Requested/effective core workers **4/4**; conservative E holds remain exclusive.
  Whole command approximately **97 s**, approximately **39.4 s** before execution,
  **57.642 s** test-file window. Subsequent documentation/status corrections are
  not relabelled as new application execution.
- The first broader run exposed the order-file defect; later one opaque blob-read
  failure was retained but its cause was not captured. Subsequent diagnostic,
  lifecycle and full focused selections passed; this does not prove that earlier
  failure's cause. A later offline frontend cache miss failed before tests; normal
  pinned Nix realization succeeded without changed inputs or acceptance fallback.
- Actual native fixtures cover cumulative size refusal with zero writes, explicit
  local rebase correspondence, ambiguous and independent mappings, complete merge
  inventory bounds, second-save lost acknowledgement, late branch/repository/grant
  changes, and multi-chapter fence/prose preservation. SDK grant/selection and
  partial-error results are actual session effects, not source-text assertions.
  Full inventory, installed browser/terminal and genuine deployment remain P4.

### P4 — Delivery and acceptance

- [x] Update `docs/review-notebooks.md`, feature/session contracts and authoring tool
  descriptions; keep ADRs durable and remove obsolete current-behavior instructions.
- [x] Obtain independent implementation review of the settled candidate, address
  concrete findings, and register every added/removed test in live classification
  with its isolation rationale. Review package/source inputs and public-safe diff.
- [x] Run complete Nix acceptance on the settled candidate: core/static/plugin,
  every browser/terminal group and genuine Home Manager VM. Normally use
  `nix run .#test -- all --workers 4 --jobs 12` after resource admission; record
  actual command/input identities, requested/effective widths, results and timing
  intervals. Focused checks never count as full acceptance.
- [ ] Rebase onto current local main, reassess verification, obtain exact-state
  integration approval and use the required non-FF merge. Resource cleanup remains
  independently gated; never publish or delete saved notebook data implicitly.

P4 delivery evidence (2026-11-05):

- Independent overall runtime/integration and delivery/coverage reviewers closed
  their scopes at `df50af1d`. Complete acceptance then exposed one transitive
  dependency omission: the offline Git-review converter's frozen helper identity
  did not include the new shared Git read scope. The minimal addition was reviewed
  independently and committed as `20bb6982e67024714a386a13504d6abd39bce82a`.
  Original AST closure/private-copy assertions were unchanged; the focused bridge
  passed **34/34**. Earlier migration rehearsal identities remain historical, not
  upgraded by this correction. The failed full run and interrupted peers remain
  retained; they are not acceptance evidence.
- On `20bb6982`, `nix run --no-write-lock-file .#test -- all --workers 4 --jobs 12`
  passed complete **530-file / 4,573-test / 14-suite** core/static/plugin coverage,
  all **26 browser/terminal groups / 60 complete input chains**, and genuine
  Home Manager deployment/HTTP persistence/restart/PTY/shutdown checks. No skipped
  or cancelled core cases. Static evidence is input-bound, with eight existing
  warnings. Source export:
  `76533299bf211646203be161628373ff04578b65063c4bd78b76435465690ef0`.
  Core artifact: `/nix/store/gacinaqzj2z5s6c0w2bi7x1b4ikb8bl1-brabbler-core-checks`.
  Browser and deployment used the same installed package:
  `/nix/store/ijx27g32xbza2nqcj663msryv9az3rsj-brabbler-0.1.0`.
- Requested/effective widths were **12/12 core workers and 4/4 browser sandboxes**,
  with admitted overlap on 32 available CPUs and approximately 48 GiB available
  memory. Conservative E holds stayed exclusive. Whole command approximately
  **450 s**, including realization. Core file window **443.888 s**, approximately
  **6.3 s** before file execution. Browser support/manifest preparation
  **4.278/6.115 s**, group-client window **321.894 s**. Deployment invocation
  **67.685 s**, including realization, with **19.104 s** guest evidence execution.
  Overlapping intervals are not additive. Dependencies/static/application outputs
  were warmed by earlier recorded runs; this is not a cold-cache speed claim.
- Realized package inspection confirms all seven new runtime owners are present,
  all five new test files and migration tools are absent, and retired recording
  owners are absent. Maintained-document destinations and public-safe diff checks
  pass; filesystem link checks are not browser link verification. Exact manifests,
  logs and failure evidence remain in private task storage.
- Later evidence/status-only edits do not change application/test bytes or relabel
  this run as newer execution. Local `main` remains the verified base `b5696cd4`;
  final integration still needs exact-state approval and the ordinary unsigned
  non-fast-forward merge. Feature resources and evidence are retained.

## Stop conditions and recovery

Stop the affected write set on ambiguous write capability, conflicting source edits
or unsafe path identity; keep untouched guide bytes and old records intact.
Missing old objects or nonunique mappings leave those references unresolved and
unchanged; they do not block reading, conversation or independent valid step edits. Do not solve those failures through broader access, a different
checkout or guessed Git identities. Stop before browser/SDK integration if tests
show permission broadening, auto-send or lost drafts. The reader-first package can
be committed independently, but is not completion of the authoring feature.

Saved records are intentionally not migrated. A source rollback can restore the old
recording code against untouched data; it must not reinterpret newer notebook content
as the material covered by historical answers. Authoring writes use current per-file
revision guards and normal Git review/recovery, not a second backup store. Private
logs and raw reviewer/test evidence stay outside tracked files.

## Completion checklist

- [x] Independent plan reviews resolved; remaining implementation/verification work
  is explicitly unchecked.
- [x] Reader usable without recording/forms; simple chat handoff and stable reload work.
- [x] Saved reviewer files/browser drafts remain untouched; recovery is documented.
- [x] Native inspect/update/refresh tools work without browser state or widened grants.
- [x] Reference updates are scoped, validated and explicit; ambiguity remains visible.
- [x] Required independent review and complete Nix acceptance pass at the candidate.
- [x] Maintained guides/ADR updated and public-safe.
- [ ] Exact local integration approved and completed; no publication or cleanup implied.
