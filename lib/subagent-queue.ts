export type SubagentQueueState = "queued" | "running";

interface QueueItem<T> {
  run: () => Promise<T>;
  onState: (state: SubagentQueueState) => void;
  onCancel?: () => void | Promise<void>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  state: SubagentQueueState;
  cancelled: boolean;
  observationReady: Promise<void>;
  notifyObservationReady: () => void;
  work?: Promise<void>;
  bookkeepingErrors: unknown[];
}

type ParentQueue<T> = {
  limit: number;
  active: number;
  items: QueueItem<T>[];
};

export interface EnqueuedSubagent<T> {
  promise: Promise<T>;
  /** Observation only: complete run/cancel bookkeeping, not result publication. */
  readonly settled: Promise<void>;
  cancel(): boolean;
}

/** FIFO per parent session; separate parents do not block one another. */
export class SubagentQueue<T> {
  private readonly parents = new Map<string, ParentQueue<T>>();

  enqueue(
    parentId: string,
    limit: number,
    run: () => Promise<T>,
    onState: (state: SubagentQueueState) => void,
    onCancel?: () => void,
  ): EnqueuedSubagent<T> {
    const parent = this.parents.get(parentId) ?? { limit: 1, active: 0, items: [] };
    parent.limit = Math.max(1, Math.floor(limit) || 1);
    let item!: QueueItem<T>;
    let notifyObservationReady!: () => void;
    const observationReady = new Promise<void>(resolve => { notifyObservationReady = resolve; });
    const promise = new Promise<T>((resolve, reject) => {
      item = { run, onState, onCancel, resolve, reject, state: "queued", cancelled: false,
        observationReady, notifyObservationReady, bookkeepingErrors: [] };
    });
    parent.items.push(item);
    this.parents.set(parentId, parent);
    try { onState("queued"); }
    catch (error) { this.observeFailure(item, error); throw error; }
    this.pump(parentId, parent);
    return {
      promise,
      get settled() {
        // Do not install a default rejection handler on the original work tail.
        // Only an explicit observer consumes its full error/cleanup result.
        return item.observationReady.then(async () => {
          const errors = [...item.bookkeepingErrors];
          try { await item.work; } catch (error) { errors.push(error); }
          // Synchronous cancel/pump errors can be recorded after work admission.
          errors.push(...item.bookkeepingErrors);
          const distinct = [...new Set(errors)];
          if (distinct.length === 1) throw distinct[0];
          if (distinct.length) throw new AggregateError(distinct, "Subagent queue bookkeeping failed");
        });
      },
      cancel: () => {
        if (item.state !== "queued" || item.cancelled) return false;
        item.cancelled = true;
        try {
          item.work = Promise.resolve(item.onCancel?.()).then(
            () => item.resolve(undefined as T),
            (error) => item.reject(error),
          );
          item.notifyObservationReady();
          this.pump(parentId, parent);
        } catch (error) { this.observeFailure(item, error); throw error; }
        return true;
      },
    };
  }

  private observeFailure(item: QueueItem<T>, error: unknown): void {
    item.bookkeepingErrors.push(error);
    item.notifyObservationReady();
  }

  private pump(parentId: string, parent: ParentQueue<T>): void {
    while (parent.active < parent.limit && parent.items.length > 0) {
      const item = parent.items.shift()!;
      if (item.cancelled) continue;
      item.state = "running";
      try { item.onState("running"); }
      catch (error) { this.observeFailure(item, error); throw error; }
      parent.active += 1;
      try {
        item.work = item.run().then(item.resolve, item.reject).finally(() => {
          parent.active -= 1;
          this.pump(parentId, parent);
          if (parent.active === 0 && parent.items.length === 0) this.parents.delete(parentId);
        });
        item.notifyObservationReady();
      } catch (error) { this.observeFailure(item, error); throw error; }
    }
  }
}
