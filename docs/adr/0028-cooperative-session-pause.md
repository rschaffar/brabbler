# ADR 0028: Cooperative pause with explicit main-session continuation

- Status: Accepted user direction, 2026-10-21; verification tracked in the [plan](../plans/2026-10-21_durable-session-pause-plan.md)
- Scope: Pi Web-managed sessions and built-in subsessions, not external Pi processes

## Decision

Pause finishes the current assistant response and its whole tool batch. Previously submitted input admissions/queues normally drain before stopping; new inputs are refused. Late steering that reaches an already-idle run is saved with full envelopes as undelivered context for explicit continuation, not silently discarded or automatically dispatched. Save and cancel waiting cards on explicit Pause so they cannot indefinitely hold the batch. Do not abort unrelated in-flight tools. Pair the public SDK finish-turn end decision with non-awaited session abort after persisted `turn_end`, suppressing outer retry/before-settle continuation. Keep execution/settlement ownership until results and cleanup observations are recorded.

Persist versioned private pause intent/context outside copied transcript history. Only settled, successfully saved state is Paused. Restart during Pausing/Resume remains visibly unconfirmed. Startup never dispatches a continuation. This is process-restart preparation, not arbitrary JavaScript/process suspension or an atomic power-loss checkpoint.

Resume sends one literal, model-visible continuation prompt to the main session. It includes saved cancelled-card context and paused-child IDs/tasks/available partial output. It is not replay of a tool, answer, approval or original task prompt. Require current branch ancestry, exact pause generation, single-winner live submission and a persisted literal continuation marker before removing pause records. Interception, transformation, persistence failure or superseding Pause retains recovery information. A waiting Resume must not block Pause on another session.

Subsessions have Pause but no browser Resume. Pause settles their current execution as incomplete, saves partial output and skips worktree cleanup unless cleanup already started; recorded observations disclose that race honestly. Foreground parents receive the partial tool result. Background paused-child reports become saved context without triggering a main-session turn. If only a child was paused, its main session need not be paused: the saved report is available on its next explicit message. The agent may deliberately choose new delegated work or the existing explicit `Agent.resume` tool; that remains a new run/budget, not automatic restoration.

Pause all / Resume all are explicitly global, including concealed projects, independent of Activity filters. Resume all addresses main sessions only. Pause never acknowledges Activity review, fabricates successful completion or grants operation permissions. Pending questions/cards are cancelled, not restored as live forms after restart; ask again and freshly validate any proposed operation.

## Consequences

No SDK fork or checkpoint schema is needed. Public SDK ingress adapters keep extension-triggered background messages from waking paused sessions, and preserve existing exact-prompt/extension/turn-budget hooks. These adapters are not a sandbox against arbitrary extension JavaScript or other processes. Long-running tools/hooks can keep Pausing indefinitely; Stop remains distinct cancellation. Already-lost cards and unknown interrupted effects cannot be recovered or retried automatically. Downgrades leave private pause records intact; unknown versions refuse instead of silently discarding intent.
