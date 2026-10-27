import type { SessionInfo } from "./types";

export type CatalogueMode = "summary" | "detail" | "force";
export interface CatalogueReply {
  sessions: SessionInfo[];
  sessionListVersion: number;
  runningSessionIds?: string[];
  completionNotificationSuppressedSessionIds?: string[];
}
interface Ports {
  read(mode: CatalogueMode): Promise<CatalogueReply>;
  publish(data: CatalogueReply): void;
  loading(value: boolean): void;
  error(value: string | null): void;
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  observe(work: Promise<unknown>): void;
}
type Waiter = { kind: "version" | "detail" | "force"; after: number; resolve(value: boolean): void };

export function sessionListUrl(summary: boolean, force: boolean): string {
  return summary ? "/api/sessions?summary=1&compact=1" : force ? "/api/sessions?force=1&compact=1" : "/api/sessions?compact=1";
}

/** One Sidebar lifetime; metadata transport coordination, never mutation authority. */
export class SessionCatalogueLoader {
  private live = false;
  private closed = false;
  private started = false;
  private epoch = 0;
  private issued = 0;
  private active: Promise<void> | undefined;
  private waiters: Waiter[] = [];
  private version: number | null = null;
  private observedVersion: number | null = null;
  private hydrationClaimed = false;
  private summaryFinished = false;
  private complete = false;
  private timer: unknown;
  private hasTimer = false;

  constructor(private ports: Ports) {}

  retain(): () => void {
    if (this.closed) return () => {};
    this.live = true;
    if (!this.started) { this.started = true; this.ports.loading(true); this.launch("summary"); }
    else { this.drain(); this.hydrateLater(); }
    return () => {
      this.live = false;
      this.cancelHydration();
      // Strict Effects setup runs synchronously before this terminal check.
      const disposal = Promise.resolve().then(async () => {
        if (!this.live) await this.dispose();
      });
      this.ports.observe(disposal);
    };
  }

  invalidate(): void {
    this.epoch++;
    this.claimHydration();
  }

  refresh(force: boolean, showLoading = false): Promise<boolean> {
    if (!this.live || this.closed) return Promise.resolve(false);
    this.invalidate();
    if (showLoading) this.ports.loading(true);
    return this.enqueue(force ? "force" : "detail");
  }

  notify(): Promise<boolean> {
    if (!this.live || this.closed) return Promise.resolve(false);
    this.claimHydration();
    return this.enqueue("force");
  }

  observeVersion(version: number): Promise<boolean> {
    if (!this.live || this.closed) return Promise.resolve(false);
    this.observedVersion = version;
    if (version === this.version) return Promise.resolve(true);
    // An active summary can cover this observation without a second request.
    // Unmatched observations get one post-observation attempt, never an equality loop.
    return this.enqueue("version");
  }

  private enqueue(kind: Waiter["kind"]): Promise<boolean> {
    const result = new Promise<boolean>(resolve => {
      this.waiters.push({ kind, after: this.issued, resolve });
    });
    this.drain();
    return result;
  }

  private drain(): void {
    if (!this.live || this.closed || this.active || !this.waiters.length) return;
    this.claimHydration();
    this.launch(this.waiters.some(row => row.kind === "force") ? "force" : "detail");
  }

  private launch(mode: CatalogueMode): void {
    const id = ++this.issued, epoch = this.epoch;
    // Defer transport until active ownership is installed, including sync throws.
    const task = Promise.resolve().then(async () => {
      try {
        if (!this.live || this.closed) return;
        const data = await this.ports.read(mode);
        if (!this.live || this.closed || epoch !== this.epoch) return;
        this.version = data.sessionListVersion;
        this.complete = data.sessions.length > 0 && data.sessions.every(row => row.detailsPending !== true);
        this.ports.publish(data);
        if (!this.live || this.closed || epoch !== this.epoch) return;
        this.ports.error(null);
        if (!this.live || this.closed || epoch !== this.epoch) return;
        this.settle(id, mode, true);
      } catch (error) {
        if (this.live && !this.closed && epoch === this.epoch) {
          this.ports.error(String(error));
          if (this.live && !this.closed && epoch === this.epoch) this.settle(id, mode, false);
        }
      } finally {
        if (mode === "summary") this.summaryFinished = true;
        if (this.live && !this.closed && epoch === this.epoch) this.ports.loading(false);
      }
    }).finally(() => {
      if (this.active === task) this.active = undefined;
      if (this.closed) { for (const row of this.waiters.splice(0)) row.resolve(false); }
      else { this.drain(); this.hydrateLater(); }
    });
    this.active = task;
    this.ports.observe(task);
  }

  private settle(id: number, mode: CatalogueMode, success: boolean): void {
    this.waiters = this.waiters.filter(row => {
      const afterObservation = id > row.after;
      const covered = row.kind === "version"
        ? (success && this.version === this.observedVersion) || (mode !== "summary" && afterObservation)
        : mode !== "summary" && afterObservation && (row.kind !== "force" || mode === "force");
      if (covered) row.resolve(success);
      return !covered;
    });
  }

  private claimHydration(): void { this.hydrationClaimed = true; this.cancelHydration(); }
  private cancelHydration(): void {
    if (this.hasTimer) this.ports.cancel(this.timer);
    this.hasTimer = false;
  }
  private hydrateLater(): void {
    if (!this.live || this.closed || !this.summaryFinished || this.complete || this.hydrationClaimed || this.hasTimer) return;
    this.hasTimer = true;
    this.timer = this.ports.schedule(() => {
      this.hasTimer = false;
      if (this.live && !this.closed) {
        const hydration = this.notify();
        this.ports.observe(hydration);
      }
    }, 750);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.live = false;
    this.cancelHydration();
    if (this.active) await this.active;
    for (const row of this.waiters.splice(0)) row.resolve(false);
  }
}
