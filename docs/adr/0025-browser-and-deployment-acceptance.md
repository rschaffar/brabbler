# Separate browser integration from deployment acceptance

## Decision

Separate the complete browser/terminal inventory from the operating-system deployment proof. This supersedes ADRs 0023/0024 only where they placed every browser group in the Home Manager VM. Preserve their substantive scenario/input coverage, unchanged browser deadlines, pinned production artifact/toolchain, verified source export, credential/network isolation, observed ownership and failure evidence.

Use three mandatory native-Linux levels:

1. **Core/static/plugins:** the existing ordinary Nix sandbox.
2. **Browser/terminal integration:** one ordinary Nix build sandbox per whole group, sharing the immutable production package and dependencies. Run the installed launcher through a process-backed owner, not `next dev`, a copied application, a checkout build, the installed host service or a Home Manager substitute.
3. **Deployment:** a small restricted-network, closure-only KVM guest running the real pinned Home Manager module and production user service. Prove activation-generated default-target startup, ordinary-user environment/permissions, durable session writes across explicit service restart, genuine PTY operation and final service/cgroup/TCP closure. It does not repeat the full browser inventory.

Most browser assertions require a real browser and production application, not a separate kernel. Keeping deployment proof independent avoids requiring namespace-root, nspawn, automatic UID allocation or experimental Nix cgroups merely to run browser tests. Production package construction remains inside isolated Nix builders.

## Ownership and evidence

Each complete browser group retains its within-group state chain, distinct viewports/locales/preferences, fresh physical fixtures and pinned Chromium. Independent group sandboxes may use the same loopback port because their network namespaces differ. The explicit process backend binds the exact installed package/launcher and observes its registered ChildProcess generation, errors, pipes and original POSIX process group. It never adopts a listener, searches for an application PID or invokes host/user systemd.

Process receipts deliberately **do not certify escaped descendants**. Nix owns final builder containment; an environment flag or inner passing receipt is not proof of sandbox completion. Fresh execution records host network/PID/mount namespace identities, refuses equality before launching, requires a non-root builder and loopback-only interfaces, and only accepts completed Nix realization with exact source/package/nonce/selection/coverage evidence. No new group reuses a previous group's namespace.

A diagnostic capsule may publish synthetic traces, original logs and failed-fixture evidence even when assertions fail. Its successful construction means evidence publication, not acceptance. Independent verdict checks reject failed, incomplete, wrong-source/package/nonce/group and partial-coverage capsules. Unsafe evidence or uncertain inner settlement fails the builder and retains original logs/`--keep-failed` state without widening nixbld access.

The deployment VM retains real systemd InvocationID/restart/cgroup ownership, symlink-before-host-copy validation, the synthetic host-only sentinel and TCP-refusal closure proof. Do not substitute the browser process receipt for this stronger service-specific evidence.

## Scheduling and freshness

Fresh browser admission uses deterministic duration-weighted queues and 1..4 concurrent group sandboxes. Failure closes new admission and drains already-started groups. CPU/RAM figures are conservative estimates, not reservations or manually sized guest partitions. Cacheable checks use the same group definitions under Nix's configured job budget; cached outputs are not fresh benchmarks.

The complete fresh entry point exports/verifies source once. With sufficient headroom it overlaps core with the browser level followed by the deployment VM; otherwise the three levels run serially. The browser and deployment phases do not run concurrently, and prerequisite-build peaks remain in admission. Peer failure preserves the primary error, aborts the independently owned invocation and awaits it.

## Alternatives rejected

- Moving the entire suite to nspawn: requires daemon-wide experimental UID/cgroup prerequisites for OS-style containers, while most tests do not need an OS boot.
- Replacing browser scenarios with unit tests: would lose real browser/runtime coverage.
- Keeping only process-backed service tests: would lose genuine Home Manager/systemd deployment proof.
- Host/development-server execution, relaxed sandboxing, retries, error suppression or longer browser deadlines: not equivalent acceptance.

## Verification boundary

Require complete core/static/plugin, every browser/terminal group/scenario and the genuine deployment VM, plus independent ownership/evidence review. Focused Chromium/PTY proofs and mocked contracts do not replace complete acceptance. Report measured commands, immutable inputs, prerequisite reuse, timing and retained diagnostics separately from historical VM-heavy results. Native ARM, CI and cold-cache timing remain unverified unless actually exercised.

Current operation belongs in [testing](../testing.md) and [browser/terminal acceptance](../../e2e/README.md).
