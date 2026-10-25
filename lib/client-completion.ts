/** Per-client observation of accepted work, including catch/finally continuations.
 * No admission, cancellation or retry policy lives here. Construction is inert.
 * Operational catches stay with their owner; unexpected failures are reported
 * as well as retained for joins, including when an app never calls settle.
 * Stop the client's admission (e.g. unmount) before the final settle. A running
 * client's settle observes current work, not future timers or native closure.
 */
export function createClientCompletion(onUnexpected: (failure: unknown) => void | Promise<void> = failure => console.error("Unexpected client work failure", failure)) {
  const pending = new Map<Promise<void>, string>();
  const failures: { failure: unknown; group: string }[] = [];
  function track<T>(work: Promise<T>, group = "client"): Promise<T> {
    const observed: Promise<void> = work.then(
      () => { pending.delete(observed); },
      async failure => {
        failures.push({ failure, group });
        try {
          // Report immediately, even without a join. Await a supported async
          // reporter as owned work; neither kind of reporter failure may make
          // this observer reject early or abandon independently accepted peers.
          await onUnexpected(failure);
        } catch (cause) {
          failures.push({ failure: new Error("Client diagnostic reporter failed", { cause }), group });
        } finally {
          pending.delete(observed);
        }
      },
    );
    pending.set(observed, group);
    return work;
  }
  return {
    track,
    wrap<A extends unknown[], T>(run: (...args: A) => Promise<T>) {
      return (...args: A): Promise<T> => track(run(...args));
    },
    async settle(group?: string): Promise<void> {
      // A named group joins that operation's full continuations, not unrelated
      // pending work (e.g. best-effort fonts versus an explicit close).
      const selected = () => [...pending].filter(([, kind]) => group === undefined || kind === group).map(([work]) => work);
      while (selected().length) await Promise.all(selected());
      const errors = failures.filter(item => group === undefined || item.group === group).map(item => item.failure);
      if (errors.length) throw new AggregateError(errors, "Client work failed");
    },
  };
}
export type ClientCompletion = ReturnType<typeof createClientCompletion>;

// Additive composer API: preserve the Terminal/SSH observation contract.
export function createComposerWork(onUnexpected?: (failure: unknown) => void | Promise<void>) {
  const completion = createClientCompletion(onUnexpected);
  return {
    run<T>(start: () => Promise<T>): Promise<T> { return completion.track(start()); },
    whenSettled: completion.settle,
  };
}
export type ComposerWork = ReturnType<typeof createComposerWork>;
