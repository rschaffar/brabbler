# Own acceptance runs independently of sessions

## Decision

Provide a project acceptance coordinator with named, privately user-configured argv/input/resource profiles. Sessions request jobs through host tools; the server captures explicit verified source before queueing and owns execution, status and retained evidence independently of the requesting conversation. A browser project dialog owns configuration and explicit recovery. This is not a general arbitrary-command tool, Git operation, session launcher or automatic test detector.

Use one cooperative heavy-run slot across projects in the same Pi Web agent directory. Share only eligible identical in-flight operations bound to physical project identity, exact source digest, frozen profile, platform and versioned environment recipe. Never substitute historical passes or same-HEAD/different-worktree results for new requests. Profiles define coverage; the configured runner remains responsible for authoritative coverage/toolchain/sandbox evidence.

Session Stop/Pause, browser disconnect and status-wait cancellation do not cancel independently admitted work. Cancellation is explicit; the initiating SDK session controls its own job, while authenticated browser control is project-scoped. Observers gain no control merely by joining or copying history.

Persist admission and results before releasing ownership. Module reload preserves live ownership; process restart never restores authority or replays jobs from saved intent. Unknown settlement blocks further admission until explicit browser reconciliation of quiescent resources. Saved PID, timeout, stale heartbeat and a Stop acknowledgement are not settlement proof. Completed-but-unpersisted results may retry only their durable write. Recovery's controller/ledger mutations execute inside the kernel-flock-owning process, never in an unlocked surviving parent callback; interrupted helpers cannot continue mutations after losing exclusion. Reconciliation is not test success.

## Optional exposure and admission (2026-10-22)

Package the agent surface as a thin bundled Acceptance plugin using the existing static registry/settings/runtime, with a single global-only Enabled field defaulting to false. Per-project/session overrides cannot enable it; per-profile Ask/Allow/Deny remains independent. This does not move accepted job ownership into an extension or add a new framework.

Disabling hides tool declarations/callability, aborts pending approval/admission and durably cancels not-started queued jobs across the coordinator. A latched transition prevents rapid enable from reviving old admissions; server-side capture/verification/executor gates do not rely on tool hiding alone. Started supervisors continue, and the browser retains status/log/cancel/recovery/profile access while disabled. No state/artifact migration, deletion or job replay follows enablement. Hidden startup definitions preserve only already-permitted child SDK loadout identity, never broaden a child's selector grants.

## Alternatives

- Advisory session-held leases: smaller, but stale claim/Stop/restart semantics cannot establish command ownership or results.
- One queue per project without a server-wide slot: still permits independent projects to overload the same server.
- Automatically using every core, widening browser profiles, dynamic repartitioning or historical-result reuse: needs separate measurements and richer runner integration; not initial coordination scope.
- Intercepting all Bash or extension subprocesses: incompatible with existing project-command/third-party execution boundaries. Coordination applies only to managed jobs.

## Boundaries

Initial execution is Linux-only and single-agent-directory. Source copies are descriptor-verified/read-only, not a new OS sandbox or secret scanner. Trusted programs retain their OS user's rights; the Nix profile preserves existing isolated-builder requirements. Process sampling does not certify escaped descendants. Profiles/settings permissions do not override user/repository safeguards or authorize Git integration, deployment or publication. Retained snapshots/logs have explicit bounds but no implicit garbage-collection authority.

Current controls, limits, recovery and verification belong in [Shared project acceptance](../acceptance.md).
