/** Only elapsed policies owned by the session client, never React/browser time. */
export type AgentSessionIntervalPolicy = "agent-state" | "speed-recovery" | "session-lease";
export interface AgentSessionPolicyClock {
  interval(policy: AgentSessionIntervalPolicy, milliseconds: number, callback: () => void): () => void;
  modelRetryDelay(milliseconds: number): Promise<void>;
  modelSpeedDeadline(milliseconds: number): AbortSignal;
  questionSetAcknowledgementDeadline(milliseconds: number): AbortSignal;
}

/** Inert default capabilities: same native clocks, delays and signals as before. */
export const agentSessionPolicyClock: AgentSessionPolicyClock = {
  interval(_policy, milliseconds, callback) {
    const timer = setInterval(callback, milliseconds);
    return () => clearInterval(timer);
  },
  modelRetryDelay: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  modelSpeedDeadline: milliseconds => AbortSignal.timeout(milliseconds),
  questionSetAcknowledgementDeadline: milliseconds => AbortSignal.timeout(milliseconds),
};
