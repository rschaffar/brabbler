# ADR 0022: Explicit browser resource discard and loss acknowledgment

- Status: Accepted direction through the user-approved worktree-manager-discard plan
- Revises ADR 0021's manager integration gate and detached diagnostic-only treatment
- Preserves ADRs 0014–0019 and ADR 0021's generic hosting, durability and no-replay boundaries

## Decision

The no-chat project manager may deliberately remove clean local branches/worktrees
in any containment state, including Unknown or no comparison target. Valid clean
detached-HEAD worktrees are worktree-only subjects with a commit-retention warning;
locked, missing, prunable or invalid registrations remain read-only.

A separate default-Ask browser permission, `discardResources`, owns this operation.
There is no agent discard tool, and the public agent executor refuses its action.
Legacy project `cleanup` and agent `git_cleanup` retain integrated-only validation
and completed-feature Keep choices. A separately confirmed manual discard does not
inherit those lifecycle choices, but Deny, plugin disablement and artifact authority
still apply. Ask and Allow both require live explicit confirmation; preparation
cannot dispatch effects.

The plugin alone computes loss evidence from the captured exact subject and optional
comparison. Deleting a branch not proven integrated requires a loss acknowledgment.
Keeping its branch does not; detached-only removal warns without fabricating branch
loss. Both the configured and temporary comparison targets remain protected. Missing
configured targets are allowed; existing symbolic targets are refused. A temporary
comparison is evidence, not policy replacement or authority to discard its target.

## Generic consent boundary

Cards may declare bounded `requiredAcknowledgment` text. The project host clones the
whole card and binds its SHA-256 digest to the operation and a fresh live-only nonce.
Status exposes the descriptor; approval must include the exact digest and boolean
`accepted: true`. Replacement cards get fresh identities even with identical content.
The decision and accepted evidence are durably saved together before authority is
released. Duplicate approvals must repeat the same envelope; old cards remain compatible
without one. Unsupported requirement-bearing session cards fail closed.

The manager renders the full title, subtitle, body and approval scope. Its checkbox
is scoped to context, operation and digest, never saved as browser authority. Historical
acknowledgment is read-only evidence. Stop/reject revoke authority despite storage
failure; approved pending operations retain Stop. Restart never recreates cards,
nonces or effects from saved intent.

## Preserved safety and limitations

Literal full branch-tip or detached-HEAD identity, physical checkout/admin identities,
registration, tracked/source state, ignored-artifact inventory and allowed-root access
remain bound. Main, invocation, selected, configured/comparison-target and observed
active resources are protected. Unignored untracked files block browser removal;
artifact discovery is not consent and cannot select tracked parents. Managed-directory
reservations span validation/effects, not external writers or other server processes.

Originally proven deletion cannot silently become acknowledged disposal: proof/ref
binding loss refuses. Git 2.34+ prepared native ref transactions verify the fresh direct
comparison tip and delete only the exact subject. Direct/symbolic refs, designation,
graph proof, registrations and policy are checked again while comparison/subject ref
locks are held. Other external filesystem/checkout/ref writers can still race checks;
this is not an atomic repository snapshot or a lock on every protected ref.

Native effects settle without forced cancellation. Partial effects and failed final
persistence remain explicit; Stop prevents only remaining steps. No backup, rollback,
force worktree removal, hidden retry, remote operation or retention guarantee is added.
All destructive acceptance uses disposable repositories, never accumulated user resources.
