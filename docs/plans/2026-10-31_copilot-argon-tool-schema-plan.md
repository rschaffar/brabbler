# Copilot-compatible Git worktree tool schema

## Goal

Allow an ordinary coding session with the optional Git Workflow plugin enabled to
send a request to `github-copilot/gemini-4-argon` without its `git_worktree` tool
declaration causing HTTP 400. Preserve the tool's public name, argument names,
three actions, selected-repository authority and existing Git safeguards.

**Status / authority:** Implementation authorized after the independent plan
reviews and local-main rebase. The plugin-local schema, validation and regression
tests passed focused verification, independent implementation review and complete
Nix acceptance. The receiving candidate is ready for exact-state local integration
approval; no installed-service activation or remote publication has occurred. Keep the same feature branch and
linked worktree for implementation and integration preparation; local `main`
remains the eventual non-fast-forward merge target, with exact-state approval and
cleanup separately gated. Live-provider probes, activation and publication are
not authorized by this plan.

## Context

The preceding investigation isolated the declaration, not model access or the
user's prompt. Controlled SDK requests used synthetic text, high thinking, a
32-token output cap and no tool execution. Reported outcomes (historical probe
evidence, **not acceptance of this candidate**):

| Declared tools | Result |
| --- | --- |
| None | HTTP 200, `OK` |
| Original 17-tool set | HTTP 400 |
| Only `git_worktree` | HTTP 400 |
| Other 16 tools | HTTP 200, `OK` |
| `git_worktree` with only a root `type: object` added | HTTP 400 |
| All 17, with a flat object schema for `git_worktree` | HTTP 200, `OK` |

`plugins/git-workflow/index.ts` currently defines worktree parameters as a
`Type.Union` of create/attach and removal objects, producing a root `anyOf`.
The pinned SDK's OpenAI-completions adapter forwards ordinary JSON schemas
without normalizing that union. Merely adding a root type was insufficient.
The successful flat-schema probe establishes a bounded compatible shape; it does
not prove all Gemini endpoints or all possible tool schemas are compatible.

The actual registered-tool lifecycle and native create/remove/attach operations
already have coverage in `plugins/git-workflow/runtime.test.mjs`. Its faux
provider accepts schema shapes that the real Copilot endpoint rejects, so
successful native invocation alone does not protect declaration compatibility.

## Plan Relationship

The active plans indexed in `docs/plans/README.md` do not own this tool schema.
Provider-account completion and public-release work retain their own scopes; this
plan does not refresh catalogs, change authentication or authorize publication.
[ADR 0015](../adr/0015-cross-repository-git-plugin-tools.md) and
[Git plugin contracts](../git-workflow-plugin.md#tools-and-correctness) continue to
own cross-repository authority. No new policy decision or ADR is proposed.

## Architecture

Keep the correction inside `plugins/git-workflow/`; do not teach generic chat
or the SDK adapter about Git actions.

- Advertise one `Type.Object` with `action`, `checkout` and `path` required.
  `action` is the existing three string values. `branch` and `baseBranch` are
  optional in the advertised object, with descriptions saying both are required
  for create/attach. Do not use a root `anyOf`, `oneOf` or `allOf`, or reintroduce
  provider-unsupported conditionals to express action-dependent requirements.
- Restore those action-dependent requirements at the plugin execution boundary,
  before `executeGitOperation`: create/attach require string `branch` and
  `baseBranch`; remove requires neither. Construct the existing discriminated
  `GitOperation` explicitly, with real narrowing rather than a type assertion.
  Keep the tool description explicit about these requirements.
- Retain SDK validation for the common required fields, action membership and
  field types, including its existing conversion and optional-null normalization.
  Do not add fallback values for missing fields, choose a default branch/base or
  silently convert an invalid action to another action.
- Keep native branch/ref/path checks, selected-checkout policy, approval,
  cancellation, receipts and exact-state revalidation unchanged. The object
  declaration broadens only the advertised conditional shape, not permission.
  Removal accepts and ignores string `branch`/`baseBranch` extras; they must not
  become an implicit second action or grant new authority. One deliberate input
  tightening is proposed: unlike the old removal union alternative's unchecked
  extras, the common object schema type-checks those fields when present. Preserve
  SDK optional-null normalization; document rejection of non-coercible malformed
  extras rather than claiming identical acceptance of arbitrary removal payloads.

## Non-Goals

- SDK upgrades/patches, provider-wide schema rewriting or capability discovery.
- Changes to model catalogs, account bindings, reasoning settings or defaults.
- New tools, force removal, remote Git operations or policy/settings migrations.
- A new test runner, browser group or live-provider CI requirement.
- Installed-service restart, activation, release or publication.

## Plan

### P1 — Preserve the execution contract while changing the declaration

- [x] In `plugins/git-workflow/index.ts`, replace the root union with the object
  declaration above and add action-dependent validation/narrowing before Git
  dispatch. Confirm TypeScript accepts the real `GitOperation` without a broad
  cast and `git_worktree` keeps the same name, arguments and three actions.
- [x] Extend `plugins/git-workflow/runtime.test.mjs` using the real registered
  tool and SDK lifecycle. For each of create and attach, separately assert that
  missing `branch`, missing `baseBranch` and optional-null conditional fields
  produce the specific plugin-owned conditional-validation error, not a generic
  downstream Git error. Also require unchanged refs, worktree registrations and
  destination state, and zero approval or operation-receipt admission. Exercise
  invalid action and non-coercible object/array field values through SDK validation;
  do not assert that convertible numbers/booleans are universally rejected.
  Keep successful create, remove without branch/base, and attach under the existing
  native cross-repository owner; preserve its caller/selected-repository and
  permission assertions. Add removal with string branch/base extras: it ignores
  them, retains the branch and never creates/attaches another worktree. Cover and
  document the proposed malformed-extra rejection without widening authority.

### P2 — Protect the provider-facing schema and document its boundary

- [x] In the same runtime test owner, capture actual registered Git tool
  declarations and pass them through the pinned SDK OpenAI-completions payload
  path using a synthetic key. Stop in `onPayload` before HTTP and deny unexpected
  transport. Assert that the emitted `git_worktree` parameters are an object
  with the required common fields, all three action values, the two conditional
  fields, and no root union/composition keywords. Assert all six Git plugin
  tools remain present. This proves serialization shape, not remote acceptance.
- [x] Prove the regression meaningfully: the old root union must fail the named
  declaration assertion; removing each action-specific requirement must fail
  its named plugin-boundary error assertion even when native preflight still
  refuses the operation. Preserve failing/restored evidence outside tracked public
  content; compile/setup failures do not count.
- [x] Update `docs/git-workflow-plugin.md` at the tool contract to explain the
  object-root compatibility choice, execution-time conditional validation and
  the deliberate malformed-removal-extra tightening. Keep empirical compatibility
  claims limited to the observed endpoint; do not grow `AGENTS.md` or add a
  provider-special case to generic runtime code.

### P3 — Verify the settled implementation and prepare local integration

- [x] Run focused static/native checks from the feature root and record tested
  input identities, results, end-to-end command time and artifact locations:
  `nix run .#test -- core --file plugins/git-workflow/runtime.test.mjs` and
  `nix run .#test -- core --file plugins/git-workflow/server.test.mjs`.
  These entry points include the required static checks; focused passes are not
  full acceptance. Reuse existing native cases instead of duplicating their
  full operation matrices.
- [x] Obtain an independent implementation safety review of declaration shape,
  action narrowing, preserved policy/effect boundaries and changed native-test
  isolation. Keep cases serial in the existing N-lane owner. On success and failure,
  await admitted prompt/stream settlement and session shutdown before restoring
  globals or removing roots; retain independent unexpected transport/UI/receipt
  failure collectors. An SDK-caught fixture exception must not count as the
  expected malformed-argument error. Resolve material findings before exporting
  the settled source for complete acceptance.
- [x] Run complete acceptance per [Testing](../testing.md): normally
  `nix run .#test -- all --workers 4 --jobs 12` after coordinating resource
  admission. If insufficient headroom would serialize that profile, use the
  documented four/four profile and record the concrete reason and requested /
  effective widths. Require core/static/plugin checks, the full browser/terminal
  inventory and genuine Home Manager deployment VM; never use the host service
  or an in-checkout production build. Report preparation and execution intervals
  separately where available, apart from review/coordination time.
- [ ] After implementation is authorized and verified, commit coherent changes
  on this feature branch, rebase onto current local `main`, reassess relevant
  verification for the resulting inputs, and present exact IDs/diff/evidence
  for the required non-fast-forward integration gate. Retain this worktree
  through that preparation; no separate receiving feature worktree is needed.

## Risks and stop conditions

- Flattening the schema removes structural conditional requirements. Stop if
  invalid create/attach arguments can reach approval or effects, or if type
  narrowing requires an unsafe cast; resolve the execution boundary first.
- A captured SDK payload is not proof of current live-provider acceptance. The
  prior successful flat-schema control is supporting evidence, not a new-tip
  live test. Any additional paid/authenticated probe requires a separately
  authorized bounded scope and must never enter ordinary sandboxed acceptance.
- Stop for a scope decision if fixing this requires a generic schema converter,
  SDK dependency update, policy change or broader tool audit. Do not turn one
  rejected declaration into an unbounded compatibility program.
- No persistent format or credential change is planned. Rollback is a normal
  source revert with verification; retain feature resources on a blocked gate.
  Reverting restores the known Argon incompatibility, not a repaired service.

## Plan review disposition

Two independent read-only reviews completed on 2026-10-31: one focused on schema
and execution safety, the other on verification and test ownership. Both found
the plugin-local object declaration and explicit action narrowing feasible.
Their material verification refinements are incorporated in P1–P3: distinguish
the plugin guard from downstream rejection, preserve SDK conversion behavior,
exercise removal extras and review native-test settlement/isolation. No blocking
design finding remains. These are plan reviews, not implementation review,
TypeScript/test execution, provider acceptance or implementation authorization.

## Implementation checkpoint

On 2026-11-02, the retained feature was rebased onto local `main` at
`34f1b39b2acf5da8f90d6d1c8c5d5721b2b3a966`; the sole conflict was additive plan
index entries, all preserved. Focused command on the implementation:

```sh
nix run .#test -- core --file plugins/git-workflow/runtime.test.mjs --file plugins/git-workflow/server.test.mjs --jobs 2
```

Native x86_64 Linux Nix sandboxes on a host exposing 32 CPUs and approximately
94 GiB RAM passed **94/94 tests** in two files, with static checks; end-to-end
command time **133 seconds**, including in-run realization.
The owned inner execution envelope was **128.769 seconds**, not a separate test-only
interval. Existing unrelated lint warnings remain nonfatal; no new runtime-file
warning was reported. This is not complete application acceptance.

The initial unchanged-production control failed the named object-root assertion.
Two private exported-source counterexamples defaulted a missing branch or base
instead of rejecting it. Each failed all four named create/attach omitted/null
plugin-boundary assertions (commands returned failure in **75/71 seconds**, each
including realization). The real feature was never mutated for these controls;
its successful focused run is the unchanged receiving implementation. The serial
N-lane ownership and full runtime/server matrix remain intact. Independent
implementation review found no actionable safety findings. Exact reports, input
manifests and first-failure logs are retained in private task evidence; no live
provider request or installed-service interaction was used.

### Complete acceptance

Candidate `2f3b73427597d4d5a94ffeea0e12b4d922331844` passed
`nix run .#test -- all --workers 4 --jobs 12` on 2026-11-02. The verified outer
source content/mode digest was
`84a5db2469c866ad8685720689a3d8b3ac9e42cbf0b8191aab13da2763e19e16`.
Admission observed 32 CPUs and about 45.9 GiB available memory; requested/effective
widths were 12 core workers and four browser sandboxes, with overlap admitted.

- **523 core files / 4,409 tests / 14 suites**, static checks included, passed.
- All **26 browser/terminal groups** passed in ordinary Nix sandboxes.
- The genuine Home Manager deployment VM passed, including durable restart, PTY
  and service/cgroup shutdown; the installed host service was not used.
- End-to-end command: **484 seconds**, including in-run realization. Earlier
  focused/counterexample prerequisites were warm; no separate application build
  was prewarmed. Browser support realization was **130.734 seconds**, definition
  publication **5.457 seconds**, and the group client envelope **250.386 seconds**
  (including group realization). The core inner envelope was **369.602 seconds**
  including realization/checks. The deployment inner envelope was **90.526 seconds**;
  its VM test script took **21.32 seconds**. These overlapping/mixed phase envelopes
  are not additive, CPU-only timings, or a cold-versus-warm benchmark.

Exact runner reports, source/admission manifests and the command log are retained
in private task evidence. Subsequent plan/index status edits are documentation
only: reuse this tested application state, run proportional documentation checks,
and do not relabel the full run as execution on a later evidence-only commit.
Local integration remains owned by the exact-state Git gate and its execution
receipt; publication, activation and backup-resource deletion remain separate.

## Completion Checklist

- [x] Two independent plan reviews are complete; material findings are resolved
  in this plan; integration remains separately gated.
- [x] Implementation authorization obtained before runtime/test edits.
- [x] The emitted tool schema has the compatible object root and all three
  actions; action-specific requirements remain fail closed with negative tests.
- [x] Focused regression controls, independent implementation review and complete
  Nix acceptance pass for the receiving candidate; evidence scope is explicit.
- [x] Maintained Git plugin guidance contains the durable compatibility contract;
  no private sessions, hosts, credentials or personal paths enter tracked files.
- [ ] Local-main integration passes its exact-state approval and verification;
  retain or clean feature resources only through the separate authorized gate.
  Remote publication and service activation remain outside this plan.
