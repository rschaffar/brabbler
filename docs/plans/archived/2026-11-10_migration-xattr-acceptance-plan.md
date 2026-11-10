# Migration metadata capability acceptance

## Goal

Keep offline conversion fail-closed when file attributes cannot be inspected, make
that refusal diagnostic, and preserve real successful migration coverage as Nix
builder policies tighten. Do not pin an older daemon or disable syscall filtering.

## Context and plan relationship

Nix 2.34.9 permits attribute listing in builders; 2.35.4 additionally returns
ENOTSUP for listxattr/llistxattr/flistxattr. The Python descriptor probe currently
maps that failure and genuinely nonempty attributes to the same reason. A
source-identical local control adding only those denials reproduces all 18 CI
migration failures; the ordinary 34-case file passes. This is deterministic
capability dependence, not timing flakiness.

The active [Git-backed reviews plan](../2026-10-31_git-backed-operation-reviews-plan.md)
still owns live conversion, activation, old-state disposition and tool retirement.
This bounded follow-up owns only metadata diagnostics and acceptance placement.
The [test guide](../../test-writing.md) owns assertion disposition; [Testing](../../testing.md)
owns the three acceptance levels. No operational state is selected or authorized.

## Architecture and invariants

- Only a successful real descriptor-bound query proving an empty name list may
  admit replacement. Nonempty attributes, unavailable syscalls, child launch
  failure and other errors all refuse. Report fixed bounded reasons, never raw
  attribute names/values, paths or child stderr.
- Core always tests explicit blocked-capability behavior, independent of the
  host daemon's version. A test-only restrictive child filter may add the three
  denials; it cannot remove restrictions or change host/daemon policy.
- Keep the codec/import boundary in core. Move the original complete converter
  matrix, without retiring its assertions/input variants, into an ordinary user
  process in the existing isolated service VM. Add genuine empty/nonempty metadata
  checks there. Never run that positive matrix inside another guest Nix builder.
- Preserve the genuine Home Manager service proofs, network/store isolation,
  package identity, evidence integrity and native shutdown. Temporary migration
  source/modules are test-only inputs, not runtime package contents.
- Complete local acceptance includes the positive guest matrix. Hosted CI retains
  core/browser checks; its lack of the service VM is explicit, not a green claim
  of successful migration coverage.

## Plan

- [x] P1: Improve the actual metadata probe's fixed diagnostics; verify unavailable,
  nonempty and failed inspection remain refusals, with no raw child error leakage.
- [x] P2: Split core and guest owners with an exact original-case disposition;
  verify real blocked dry-run/apply refusal leaves selected bytes/modes unchanged
  under the additive filter, on both old and new daemon policies.
- [x] P3: Add the unchanged converter matrix and real metadata checks to the
  existing service VM, with declared source/modules and validated retained
  evidence. Verify all former converter cases execute, not skip.
- [x] P4: Run focused source/runner/metadata/VM checks and meaningful private
  negative controls; independently review fail-closed behavior and coverage.
- [x] P5: Once source settles, run complete core, all browser/terminal groups and
  genuine service/metadata VM acceptance with admitted resource widths. Record
  source identities, command wall time and separate available preparation/execution
  intervals; focused checks are not complete acceptance.
- [x] P6: Finalize owning guides/evidence and prepare the verified feature for
  native non-FF main integration approval. Git receipts own the ensuing commit,
  rebase, exact-state approval/effect and separately gated cleanup; this record
  does not grant those operations or publication.

## Assertion disposition

At base `8bcb749139145566ca8e2d33681688df4cc38a2e`, the classified migration
bridge registers four legacy codec cases, 29 converter cases and one application
import-boundary case. Retain the codec/import cases in core; the entire converter
file's case bodies/input matrices move to the guest owner. No case is converted
to a skip or silently dropped. S3's owned source-copy setup adds owner-write on
copied helpers because immutable store modes otherwise prevent its deliberate
mutation; all original assertions/input bytes remain. Guest Node identity compares
the canonical target of the unchanged declared launcher. New core refusal and
guest metadata cases are additional obligations. Record exact final owner/command/results before closure.

## Risks and stop conditions

Do not manufacture absence from ENOTSUP, change live settings, disable security
filters, broaden source admission, publish test helpers in the runtime, or use a
host-service/non-Nix acceptance fallback. Stop if a guest source/modules closure
would expose host data or if original converter obligations cannot be retained.
Preserve failed checks before a justified correction. Keep one source writer and
pause edits for source export. No remote Git or workflow operation is authorized.

## Recovery

Only synthetic private fixtures may be modified by tests. Existing live manifests
are bound to their original tool/helper identity; diagnostics changes do not
permit bypassing that binding. Replan explicitly with the chosen tool revision;
never mutate an old plan to force compatibility. No live migration or rollback is
part of this task.

## Focused verification and review checkpoint

The composed four-file core selection passed 57 cases with current static checks
(40s). The bridge now owns 13 cases; the guest owns all 29 original converter cases
plus three genuine metadata cases. Real service/guest acceptance passed all 32
migration cases and original service proofs (133s command wall; unchanged small VM
profile). The preceding failed run retained two setup errors before correction:
read-only copied helper mode and wrapper-versus-canonical Node path. No assertion,
sandbox permission or deadline was weakened to correct them.

Private source faults fail the intended runtime assertions: accepting unavailable
metadata fails two guard/CLI cases; accepting another Python query error fails the
real EPERM case (44s); accepting incomplete TAP fails the transferred-evidence
contract (38s). Receiving source never contained those faults. Core safety review
findings about real-error and signaled-child coverage are resolved. Independent VM
and bounded setup-fix reviews found no remaining blocker.

A restart removed temporary receipts and an unrooted snapshot from the earlier
focused runs. Their private logs remain historical evidence, not newly recreated
receipts. Complete acceptance below will retain new receipts privately. Hosted CI
still omits the service VM; local positive coverage is not a hosted green claim.

## Complete verification

`nix run --no-write-lock-file .#test -- all --workers 4 --jobs 12` passed in
**430s** with overlap: **534 core files / 4,620 tests / 14 suites**, all **26
browser/terminal groups**, all original Home Manager proofs and **32/32 ordinary
guest migration cases**. Requested/effective core width was 12/12; browser width
was four. The host admitted 32 CPUs and sufficient memory; estimates are not
machine-wide reservations. Earlier focused runs had warmed prerequisites.

Core invocation was 348.274s, its before-first-file envelope 43.964s and file
window 303.886s. Browser invocation was 291.291s, including support/manifest
preparation 4.026s/5.189s. Service invocation was 132.403s; its guest receipt interval
was 76.96s. These intervals overlap and are not additive/cold-cache benchmarks;
model, review and coordination time is excluded.

A separate full core check with only the three additional listing denials passed
all **534 files / 4,620 tests** in **264s**, at 12 requested/effective workers.
It emulates the identified Nix 2.35 policy difference, not a locally installed
2.35 daemon. Both core runs use identical inner content/mode digest
`8fccd0aebaedb4099c8b34af182e52f1deeb8e500af3fc7f230e74c39a36f214`;
the complete run's outer digest is
`f26f00322afa7e07aebcc505e34ed5d56dd397db540d20322386de7751ed4949`.
The application package remains `mcz1mdi4pgx92xmwakbdvylncpixzlqm-brabbler-0.1.0`.
New receipts, original guest artifacts, summaries and source snapshot are retained
privately, unlike the earlier removed temporary receipts. Final Markdown-only
status/archival changes reuse unchanged executable-input evidence; they are not
relabeled as fresh execution at a newer Git tip. Hosted CI has not been rerun.

## Completion checklist

- [x] Distinct bounded diagnostics, fail-closed defaults and mutation safety proven.
- [x] Original case/input coverage retained with core and actual guest owners.
- [x] Complete acceptance and independent review pass on the receiving candidate.
- [x] Current guides state daemon/capability limits and exact evidence ownership.
- [x] Verified feature ready for native exact-state local-main integration approval.
