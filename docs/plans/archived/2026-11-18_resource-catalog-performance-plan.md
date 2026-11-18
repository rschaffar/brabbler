# Resource catalogue performance

## Goal

Reduce Skills & extensions inventory, saving, instruction inspection and runtime
resource-preparation latency without weakening source/path/trust/profile admission,
scoped preferences, SDK discovery or publication/currentness checks.

## Context

Investigation precedes implementation. At base `f9f570a5`, a private synthetic
Node 24.22.2 probe on x86_64 Linux uses 64 distinct skill files in one installed
local package, separate HOME/agent roots, offline operation and denied network and
child processes. `node <private-probe>/measure.mjs` measures production functions;
this is profiling, not acceptance. It retains only synthetic data and counters.

| Operation | Baseline wall time | Catalogue builds |
| --- | ---: | ---: |
| Warm inventory, three reads | 1665–1672 ms | 5 |
| Save choice, two writes | 2332–2339 ms | 7 |
| Instruction content, two reads | 2027–2045 ms | 6 |
| Runtime resource preparation | 1997 ms | 6 |
| Subsequent SDK reload | 18 ms | 0 |

A zero-delay timer is delayed by approximately each operation's full wall time.
With 16 skills, increasing admitted roots from 1 to 64 raises warm inventory from
199 to 869 ms and physical-path calls from 5,848 to 35,521. Pairwise member matching
and eager resolution of every root dominate. A selection-only rebuild repeats SDK
discovery, validation and serialization. Successful exact-file skills are validated
twice per build. An independent source review confirms one panel inventory request,
one PATCH per save (no follow-up GET), construction single-flight per saved ID and
captured-selection reuse during Apply. Slash annotation has separate native loading;
its synthetic reload is 11 ms. Full application startup and full Apply are not
measured by these isolated resource-stage numbers. No live settings, credentials,
service lifecycle or deployment are part of the work.

## Plan Relationship

ADR 0044–0046 and the completed scoped-resource implementation own behavior. This
plan changes cost, not discovery precedence, availability policy, package management
or application timing. Existing resource configuration handoff remains unchanged.

## Plan

- [x] Investigate the installed reference and current source, measure shared resource
  stages and root/resource scaling, and present the findings before implementation.
- [x] Add native regressions for linear member identity work, exact-file validation
  reuse, selection-only projection, root scaling and fresh source/publication fences.
  Run focused Nix core owners and retain meaningful baseline failures.
- [x] Implement per-build physical identity indexes, lazy fresh root authorization,
  pure choice projection of captured eligibility, and exact-file validation reuse.
  Keep all fresh discovery guards and descriptor/profile/publication checks.
- [x] Measure the first coherent candidate against the same isolated workloads;
  compare complete inventory/save/content/runtime-preparation work, not only a
  microbenchmark. Reassess optional expansion only if remaining measured cost warrants it.
- [x] Obtain independent safety review and run complete acceptance from the settled
  candidate with `nix run .#test -- all --workers 4 --jobs 12` when admitted.
- [x] Update the maintained feature guide, commit/rebase and prepare the exact-state
  approval handoff for ordinary unsigned non-fast-forward integration into local `main`.
  The native Git workflow owns final approval, integration and separately governed cleanup.

## Verified candidate checkpoint

The first coherent candidate measures warm inventory at 206–214 ms (four builds,
5,189 physical-path calls), save at 317–323 ms, content at 319–322 ms and runtime
resource preparation at 267 ms on the same 64-skill fixture. Sixteen-skill global
inventory is 80–82 ms with either 1 or 64 admitted roots (1,685 physical-path calls).
An independent read-only safety review found no actionable issue. No optional scope
expansion is justified at this checkpoint; synchronous guard work remains.

Focused Nix acceptance: the two baseline regressions fail their intended runtime
assertions (36 tests, 34 pass / 2 fail; 49-second command). The five catalogue/API/
import/runtime/collision owners then pass 93 tests (58-second command); the later
root-alias publication regression passes its API owner, 18 tests (50-second command).
Type generation, typing and lint pass; lint retains seven pre-existing warnings.
Private raw logs/artifacts remain outside the public repository.

Complete acceptance at implementation commit `e4092b87f71ce405d5e285f8eb6e75bb1d0da1ce`:
`nix run .#test -- all --workers 4 --jobs 12` passes in **472 seconds**, including
in-run realization. All **545 core files / 4,921 tests / 14 suites**, **26 browser/
terminal groups** and the genuine Home Manager deployment VM pass; no core tests
skip or cancel. Requested/effective widths are twelve core workers and four browser
sandboxes, admitted with overlap on 32 logical CPUs and about 56 GiB available RAM.
Independent safety review found no actionable issue. Immutable source is
`fqgya20l4h9znqdixv8jyf4ix75dz6v5-source`; outer content/mode digest is
`a58790ad7553a289d38bd1f239dd0b16c7f155d1063d2b35711100d03b034731`.

Core invocation is 313.423 s, with a 310.260 s runner window and exact static outputs
reused from focused checks. Browser invocation is 355.579 s: support preparation
109.444 s, definition publication 5.154 s and group-client execution window 240.978 s.
Deployment invocation is 109.272 s, including 58.623 s guest evidence. Overlapping
intervals are not additive. No deliberate package prewarming occurred; this is not
a warm-prerequisite performance comparison. Private records retain the command log,
per-level run reports, static identities, native TAP/events and settlement evidence.

The maintained feature guide owns the mechanism and bounded performance result.
This archived implementation record ends at integration-ready handoff: the native
Git workflow owns exact final-state approval and the integration receipt. Archiving
is not approval or a claim that integration, publication or deployment occurred.
The evidence-only follow-up does not change application or test code.

## Architecture and non-goals

Identity indexes live within a single discovery build, with fresh generation checks
for indexed paths. They are not authorization caches. A pure choice projection must
use the original captured eligibility/context, never derive permission from enabled
state or accept arbitrary serialized rows. Its lifetime follows that observation;
callers retain independent fresh membership/admission guards before publication/use.
Root checks resolve the target once and short-circuit admitted physical containment
or the existing immutable-store exception; no path admission survives a call.

Do not add cross-request catalogue caches, skip discovery guards, replace public SDK
discovery/validation, parallelize runtime effects, skip Apply on matching revision,
change UI semantics, deploy/restart services or publish. If indexed identities fail
generation/ownership regressions, stop and revise rather than relax those checks.

## Completion Checklist

- [x] Regression tests and independent review preserve aliases, collisions, ownership,
  currentness, scoped choices, disabled-skill inspection and runtime ceilings.
- [x] Matched isolated measurements demonstrate whole-operation improvement; live and
  synthetic evidence and unmeasured full-startup/Apply limits remain distinct.
- [x] Complete core/static/plugin, browser/terminal and deployment acceptance passes;
  record input identity, result, artifacts, wall/preparation/execution intervals.
- [x] Maintained documentation owns current mechanisms/results; the exact-state
  integration handoff is prepared for the native Git workflow. Publication and live
  activation remain unauthorized.
