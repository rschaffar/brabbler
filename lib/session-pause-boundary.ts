import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "./pi-types";

/** End only after finalized tool results. Abort's synchronous prefix also stops
 * AgentSession's outer retries/before-settle loop. Never await it inside its own
 * awaited finishTurn callback. Accepted queues drain first (including images).
 */
export function installSessionPauseBoundary(inner: AgentSessionLike, requested: () => boolean, onError: (error: unknown) => void,
  waitForInputAdmissions: () => Promise<void> = () => Promise.resolve()) {
  const session = inner as unknown as AgentSession;
  const agent = session.agent;
  const previous = agent.finishTurn;
  let stopping = false;
  const finish: NonNullable<typeof agent.finishTurn> = async (turn, signal) => {
    const decision = (await previous?.(turn, signal)) ?? undefined;
    if (!requested()) return decision;
    let onAbort!: () => void;
    const aborted = new Promise<void>((done) => { onAbort = done; signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) done(); });
    try { await Promise.race([waitForInputAdmissions(), aborted]); }
    finally { signal?.removeEventListener("abort", onAbort); }
    if (!requested() || (!signal?.aborted && agent.hasQueuedMessages?.())) return decision;
    stopping = true;
    return { action: "end" };
  };
  agent.finishTurn = finish;
  const unsubscribe = agent.subscribe?.((event) => {
    if (event.type !== "turn_end" || !stopping) return;
    stopping = false;
    // AgentSession's earlier listener has now flushed finalized results/context.
    void session.abort().catch(onError);
  });
  return () => {
    if (agent.finishTurn === finish) agent.finishTurn = previous;
    unsubscribe?.();
  };
}
