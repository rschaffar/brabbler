import type { AgentSessionLike } from "./pi-types";

/** Public SDK entry points, including extension core actions. Already-submitted
 * inputs remain owned; background reports cannot start a run while paused. */
export function installSessionPauseIngress(inner: AgentSessionLike, options: {
  blocked: () => boolean;
  assertFresh?: () => void;
  assertDeferredAdmission?: () => void;
  deferredCustomAccepted?: () => void;
  capturePromptStart?: () => () => void;
  takeResumePermit: (text: string) => boolean;
  begin: (queued: boolean) => { release: (acceptedQueue?: boolean) => void; setQueued: (queued: boolean) => void };
  settle: () => Promise<void>;
}) {
  const originalPrompt = inner.prompt;
  const prompt: typeof inner.prompt = async (text, args) => {
    options.assertFresh?.();
    const consumeDeferred = options.capturePromptStart?.();
    if (options.blocked() && !options.takeResumePermit(text)) throw new Error("Session is paused or pausing; use Resume on the main session");
    const admission = options.begin(Boolean(inner.isStreaming && args?.streamingBehavior));
    let acceptedQueue = false;
    try {
      return await originalPrompt.call(inner, text, { ...args, preflightResult: (disposition) => {
        acceptedQueue = disposition === "queued";
        if (disposition === "started") consumeDeferred?.();
        // The SDK decides AFTER asynchronous input hooks, not at invocation.
        if (disposition === "started" || disposition === "queued") admission.setQueued(acceptedQueue);
        args?.preflightResult?.(disposition);
      } });
    } finally { try { await options.settle(); } finally { admission.release(acceptedQueue); } }
  };
  const originalSteer = inner.steer, originalFollowUp = inner.followUp;
  const steer: typeof inner.steer = async (...args) => {
    options.assertFresh?.();
    if (options.blocked()) throw new Error("Session is paused or pausing");
    const admission = options.begin(true);
    let result;
    try { result = await originalSteer.apply(inner, args); return result; }
    finally { try { await options.settle(); } finally { admission.release(result === "queued"); } }
  };
  const followUp: typeof inner.followUp = async (...args) => {
    options.assertFresh?.();
    if (options.blocked()) throw new Error("Session is paused or pausing");
    const admission = options.begin(true);
    let result;
    try { result = await originalFollowUp.apply(inner, args); return result; }
    finally { try { await options.settle(); } finally { admission.release(result === "queued"); } }
  };
  const originalCustom = inner.sendCustomMessage;
  const custom: typeof inner.sendCustomMessage = async (message, args) => {
    if (args?.deliverAs === "nextTurn") options.assertDeferredAdmission?.();
    if (args?.triggerTurn === true || inner.isStreaming && args?.triggerTurn !== false && args?.deliverAs !== "nextTurn") options.assertFresh?.();
    const blocked = options.blocked();
    const queued = !blocked && inner.isStreaming && args?.triggerTurn !== false && args?.deliverAs !== "nextTurn";
    const triggering = !blocked && !inner.isStreaming && args?.triggerTurn === true && args?.deliverAs !== "nextTurn";
    const admission = queued || triggering ? options.begin(queued) : undefined;
    try {
      const result = await originalCustom.call(inner, message, blocked ? { triggerTurn: false } : args);
      if (!blocked && args?.deliverAs === "nextTurn") options.deferredCustomAccepted?.();
      return result;
    }
    finally { if (admission) { try { await options.settle(); } finally { admission.release(queued); } } }
  };
  inner.prompt = prompt;
  inner.steer = steer;
  inner.followUp = followUp;
  inner.sendCustomMessage = custom;
  return () => {
    if (inner.prompt === prompt) inner.prompt = originalPrompt;
    if (inner.steer === steer) inner.steer = originalSteer;
    if (inner.followUp === followUp) inner.followUp = originalFollowUp;
    if (inner.sendCustomMessage === custom) inner.sendCustomMessage = originalCustom;
  };
}
