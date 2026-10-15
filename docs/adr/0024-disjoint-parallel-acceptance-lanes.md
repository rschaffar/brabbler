# Disjoint coverage and bounded parallel acceptance lanes

## Decision

Replace ADR 0023's sequential single-user scheduling with explicit disjoint
scenario ownership and bounded isolated lanes **inside the same NixOS guest**.
Retain its production package, Nix sandbox, genuine Home Manager integration,
closure-only store, credential/network, immutable-input and settlement boundaries.
The user requested this after the measured complete VM command took 45m44s.

The former General aggregate repeated entire named helpers. Most focused selectors
also fell through into unrelated API/account setup and account/OAuth footers.
Remove demonstrated duplication, not substantive assertions: explicit state,
history, extension-dialog and mobile-sidebar owners preserve the unique chains;
named owners retain all distinct locale, viewport-height, preference and ordering
variants. A separately enumerated baseline coverage contract and success-only
runtime scenario receipts guard omissions, duplicates and invalid selection.

Generate each lane's ordinary user, private HOME/state, fixed loopback port,
environment file, literal-UID controller and real Home Manager `pi-web.service`
from one immutable registry. Validate that binding before fixture side effects.
Concurrent suites use separate Node processes and never share an application unit,
user manager, bus or mutable service environment. The application still runs through
the installed production launcher, not a transient replacement or development server.

Partition the complete inventory deterministically by reviewed duration weights.
Run each lane's queue serially and overlap independent queues. Keep Nix driver
machine calls serial; unique transient system units supervise the unprivileged
suite/Chromium cgroups. One failure closes admission; already-started work drains
within unchanged deadlines. Final runner settlement precedes final application
stops, preventing late service acquisition. Reobserve a previously settled transient
unit's exact cgroup after systemd unloads the unit; an unknown numeric PID is never
signalled or treated as an owner.

Every configured lane proves genuine first Home Manager activation and generated
default-target startup. Every used lane proves real restart/session persistence.
Versioned evidence binds the pre-boot package/selection/partition, group coverage,
per-lane collection and both runner/application settlement. Collect each lane
independently into root-owned staging, retaining failed fixture archives. Reject
symlinks/special entries before the pinned driver's host-side copytree dereferences
them; prove rejection with a synthetic host-only sentinel. TCP closure requires a
bounded refused connection, not an HTTP error. One
incomplete or unsafe lane vetoes bulk cleanup; failed assertions alone do not.
A saved receipt remains evidence, never new operation authority.

Profiles declare 1..4 lanes, two vCPUs/4 GiB each and a 16 GiB sparse state disk.
Fresh execution admits a profile from effective CPU/memory plus host headroom;
explicit profiles refuse insufficient budget. The cacheable check declares two
lanes. All profiles use the same definition, package, inventory and deadlines.
Linux admission counts MemAvailable rather than only unused pages, but respects
ancestor cgroup headroom and CPU quota. Estimates are not reservations.

Core and VM checks remain independent. Fresh `test -- all` exports/verifies once
and overlaps them only with additional core/realization headroom (including each
internal client's two-build/four-core preparation peaks); otherwise it keeps the VM
profile and executes serially. CI overlaps the levels on separate runner machines.
Cached checks are never reported as fresh execution. Operational commands and
measured results belong in [testing](../testing.md), the
[browser guide](../../e2e/README.md) and the
[implementation plan](../plans/2026-10-15_parallel-nix-acceptance-plan.md).

## Alternatives rejected

- Parallelizing the existing shared-user/service loop: races ownership, ports,
  process-global fixture environment and cleanup.
- Dropping General or retaining only named helpers: loses unique history,
  mobile/archive/restore, merge, extension and input-variant assertions.
- Multiple guests/package copies: unnecessary boot/store overhead for this change.
- Deadline inflation, retries, cached-result timing or a dev/non-Nix fallback:
  does not establish faster truthful complete production acceptance.

## Verification boundary

Require complete native core and packaged-service VM acceptance, independent
coverage/safety review and measured fresh wall time. Focused proofs and theoretical
weight balance are not the complete result. Native ARM, GitHub and cold-cache or
other-host timings remain unverified unless actually exercised.
