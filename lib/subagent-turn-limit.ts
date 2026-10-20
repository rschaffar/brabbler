import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "./pi-types";

const WRAP_UP = "You have reached your turn limit. Wrap up immediately and provide your final answer now.";

/** Public SDK boundary adapter. The host's structural session view deliberately omits queue APIs. */
export function installSubagentTurnLimit(inner: AgentSessionLike, limit: number | undefined, reached: () => void) {
  if (!limit) return { error: (): string | undefined => undefined, dispose() {} };
  const session = inner as unknown as AgentSession;
  const agent = session.agent;
  const previousFinishTurn = agent.finishTurn;
  const previousSteeringMode = agent.steeringMode;
  const terminatingTools = new Set<string>();
  let turns = 0;
  let exhausted = false;
  let undelivered: string[] = [];
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_end" && event.result?.terminate === true) terminatingTools.add(event.toolCallId);
  });
  const finishTurn: NonNullable<typeof agent.finishTurn> = async (turn, signal) => {
    // This includes AgentSession's extension boundary hook; never bypass it.
    const decision = (await previousFinishTurn?.(turn, signal)) ?? undefined;
    const toolsContinue = turn.toolResults.some((message) => !terminatingTools.has(message.toolCallId));
    terminatingTools.clear();
    turns += 1;
    if (signal?.aborted || decision?.action === "end" || turn.message.stopReason === "error" || turn.message.stopReason === "aborted") return decision;
    const continues = toolsContinue || decision?.action === "continue" || agent.hasQueuedMessages();
    if (!continues || turns < limit) return decision;
    if (turns >= limit + 1) {
      exhausted = true;
      reached();
      const { steering, followUp } = session.clearQueue();
      undelivered = [...steering, ...followUp];
      return { action: "end" };
    }
    agent.steeringMode = "all";
    await session.steer(WRAP_UP);
    return decision;
  };
  agent.finishTurn = finishTurn;
  return {
    error(): string | undefined {
      if (!exhausted) return undefined;
      return `Subagent reached its turn limit (${limit}) without completing the task.`
        + (undelivered.length ? ` These queued messages were not delivered:\n${undelivered.map((text) => `- ${text}`).join("\n")}` : "");
    },
    dispose() {
      // Only remove our own hook; do not overwrite a subsequent owner's replacement.
      if (agent.finishTurn === finishTurn) agent.finishTurn = previousFinishTurn;
      agent.steeringMode = previousSteeringMode;
      unsubscribe();
    },
  };
}
