// SSE must reach the client promptly, even while application work is idle.
// Connection is deliberately omitted: it is hop-by-hop and invalid in HTTP/2.
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export interface SseWriter {
  readonly closed: boolean;
  send(data: unknown, eventName?: string): void;
  close(): void;
}

/** Keep the transport alive during asynchronous startup and quiet periods. */
export function createSseStream(
  req: Pick<Request, "signal">,
  start: (writer: SseWriter) => void | Promise<void>,
  onClose: () => void,
): ReadableStream<Uint8Array> {
  let finish: (closeController: boolean, error?: unknown) => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const abort = () => finish(true);
      finish = (closeController, error) => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        req.signal.removeEventListener("abort", abort);
        try {
          onClose();
        } finally {
          if (error !== undefined) controller.error(error);
          else if (closeController) controller.close();
        }
      };
      const enqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          finish(false);
        }
      };
      const writer: SseWriter = {
        get closed() { return closed; },
        send(data, eventName) {
          if (closed) return;
          enqueue(`${eventName ? `event: ${eventName}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
        },
        close() { finish(true); },
      };

      if (req.signal.aborted) {
        finish(true);
        return;
      }
      req.signal.addEventListener("abort", abort, { once: true });
      enqueue(":\n\n");
      heartbeat = setInterval(() => {
        // Do not accumulate idle comments for a client that stopped reading.
        if ((controller.desiredSize ?? 0) > 0) enqueue(":\n\n");
      }, SSE_HEARTBEAT_INTERVAL_MS);

      // An async ReadableStream.start would delay cancellation until startup
      // settles (OAuth can wait for human input). Keep that work detached.
      try {
        void Promise.resolve(start(writer)).catch((error) => finish(true, error));
      } catch (error) {
        finish(true, error);
      }
    },
    cancel() { finish(false); },
  });
}
