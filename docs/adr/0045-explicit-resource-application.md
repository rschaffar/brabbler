# Explicit application of saved agent resource choices

Status: Accepted; supersedes ADR 0044's automatic idle-application and pending-input policy, not its selection, identity, import or security contracts.

Save resource choices immediately, but leave an existing runtime on its current selection until the user explicitly selects **Apply saved changes** for that conversation. Apply either acquires the existing safe lifecycle boundary and reconstructs that runtime now, preserving its conversation/history, or refuses immediately with an actionable busy/error result; it never waits for future idle, queues application or retries automatically. Newly constructed runtimes use the current saved choices.

## Consequences

- Saved-but-not-applied choices do not block ordinary conversation input. The UI distinguishes saved selection from the selected runtime's actual selection.
- Only an admitted explicit application briefly fences fresh input during shutdown/reconstruction. Accepted work, queued messages, images, effects, children and cleanup must not be dropped to make application possible. Uncertain ownership refuses Apply rather than scheduling it.
- Saving a Global or Project choice does not restart other live conversations. Each keeps its selection until its own explicit application or normal reconstruction.
- Keep native public message delivery behavior, including `deliverAs: "nextTurn"`. If deferred input cannot be proved consumed safely, refuse Apply while leaving the old runtime available; do not reject that capability merely because managed preferences exist, silently convert messages or inspect/patch private SDK state.
- Preserve authoritative disposal barriers, independent trust/profile/file-access limits, same-ID history and honest application failures. No SDK patch, parallel lifecycle lock, automatic idle scheduler or generalized recovery framework is introduced.

This replaces automatic idle switching because its cross-ingress waiting, notification and accepted-work coordination dominated implementation complexity. The tradeoff is deliberate: users explicitly apply changes to an existing conversation rather than receiving automatic next-turn activation. The entry point is an Apply button, not a change to the existing `/reload` command or browser refresh behavior.
