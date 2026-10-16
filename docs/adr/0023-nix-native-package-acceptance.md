# Nix-native package and service acceptance

The sequential single-user scheduling below is superseded by
[ADR 0024](0024-disjoint-parallel-acceptance-lanes.md). Its package, sandbox,
Home Manager, input, credential and settlement boundaries remain in force.
[ADR 0025](0025-browser-and-deployment-acceptance.md) subsequently separates full
browser/terminal integration from the smaller genuine deployment VM; the historical
placement and two-level arrangement below no longer describe current operation.

## Decision

Use two Nix-owned testing levels on native Linux: sandboxed core/static/bundled-plugin
checks and complete browser/terminal acceptance of the actual production package in
one NixOS VM. Pin Home Manager alongside nixpkgs and use its real activation and
systemd-user integration, not stubbed option evaluation or a second handwritten
application unit. Require KVM; do not silently substitute emulation.

All browser selectors, the general browser branch and the real terminal suite are
an explicit shared inventory. Full acceptance runs every group in one guest boot,
sequentially, with fresh fixture roots and browser contexts. The ordinary guest user
runs the installed launcher. Service generations, automatic restart counters and
cgroup descendant settlement are evidence distinct from control-command exit codes.
A separate restart/persistence check exercises real deployment behavior.

The guest receives a cached read-only image of its declared store closure, pinned
Chromium and deterministic synthetic provider/session/repository fixtures. Do not
expose the complete host store, host credentials, user buses, installed service or
working-checkout `.next`. Guest networking is restricted; provider traffic uses the
normal runtime interfaces with fixture implementations on guest loopback.

Share manifest/toolchain/platform-keyed dependencies, including rebuilt native
`node-pty`, between package and checks. Filter application and test sources separately.
Only the isolated production builder needs a private physical dependency copy;
core checks and installed runtime use immutable dependencies. Documentation/test-only
edits do not rebuild the application; application-only edits do not reinstall modules.

`nix flake check -L` is cacheable declared-input acceptance. The thin fresh entry
point safely exports/verifies current source, including admitted untracked helpers,
and realizes the same definitions. Fresh core uses a per-invocation nonce on only
the check derivation, executing once in the Nix sandbox; it is not an unsandboxed
host runner or a second rebuild of an existing result. Fresh VM runs use the regular
check driver and the same cached package/guest image. Focus is a runtime selection,
not a different application build. CI evaluates the check graph and freshly executes
those same core/VM definitions once each. Cached results are never called fresh.

Nix realizes declared prerequisites normally, including substitutes/downloads when
needed. Test execution remains offline. Explicit offline realization may fail for
uncached inputs; do not add prerequisite-cache scanners, manual preparation,
unmanaged dependencies, npm-based CI, in-place or development-server acceptance.
Production builds are allowed in isolated Nix builders for acceptance, never in a
working checkout. Testing does not install/activate the host service or authorize
integration/publication/deployment.

## Retained safety guarantees and supersession

This supersedes ADR 0020's development-server dependency copies, test shell and
non-Linux legacy acceptance. Preserve its verified allowlisted snapshots, paused
writers during export, isolated generated state, immutable shared dependencies,
credential scrubbing, per-invocation resource budgets and exact-input reporting.
Manual development is separate and remains free to use its existing dev server.

Nix owns builder containment/cleanup. Successful core diagnostics are retained in
the check output; fresh user-owned logs contain original bounded failure diagnostics.
Failed builder trees may be retained without widening nixbld permissions. Fresh
core result links deliberately retain their check output until the owner removes
the reported run root; ordinary temporary roots are not cleaned by Nix GC.

Fresh VM owners retain driver/JUnit/journal/trace evidence and archive failed synthetic
fixture state. Remove only that invocation's pinned runtime/tmp/cache bulk after
observed host driver/descendant settlement **and** successful guest evidence export
and service stop. Interruption, identity replacement, mountpoints, uncertain
observations or missing collection receipts retain bulk. A receipt is evidence, not
new operation authority. No wildcard/age-based reapers or authority over historical
runs, user checkouts, backups or feature resources is granted.

Operational commands, supported selections, budgets and retention belong in
[testing](../testing.md) and the [browser guide](../../e2e/README.md).
