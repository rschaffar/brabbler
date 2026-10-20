import { encodeFilePathForApi } from "./file-paths";

export type UploadConflictStrategy = "error" | "overwrite" | "skip";
export interface UploadError { name: string; error: string }
export interface UploadResponse {
  uploaded?: string[]; skipped?: string[]; errors?: UploadError[];
  conflicts?: string[]; nonReplaceable?: string[]; error?: string;
}
export interface UploadSummary { directory: string; uploaded: string[]; skipped: string[]; errors: UploadError[] }
export interface UploadConflict { conflicts: string[]; nonReplaceable: string[] }
export interface ExplorerUploadState {
  phase: "idle" | "checking" | "uploading";
  directory: string | null;
  progress: number;
  conflict: UploadConflict | null;
  summary: UploadSummary | null;
  error: string | null;
}
export const idleUploadState = (): ExplorerUploadState => ({
  phase: "idle", directory: null, progress: 0, conflict: null, summary: null, error: null,
});

export interface UploadTransport {
  check(directory: string, files: File[], signal: AbortSignal): Promise<UploadResponse>;
  upload(directory: string, files: File[], strategy: UploadConflictStrategy, signal: AbortSignal,
    progress: (value: number) => void): Promise<{ status: number; data: UploadResponse }>;
}

export const browserUploadTransport: UploadTransport = {
  async check(directory, files, signal) {
    const response = await fetch(`/api/files/${encodeFilePathForApi(directory)}?type=upload-check`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileNames: files.map((file) => file.name) }), signal,
    });
    const data = await response.json() as UploadResponse;
    if (!response.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${response.status})`);
    return data;
  },
  upload(directory, files, strategy, signal, progress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const settle = () => signal.removeEventListener("abort", abort);
      xhr.open("POST", `/api/files/${encodeFilePathForApi(directory)}?type=upload&conflict=${strategy}`);
      xhr.upload.onprogress = (event) => {
        if (!signal.aborted && event.lengthComputable && event.total > 0) progress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => { settle(); reject(new Error("Upload connection lost; some files may have been saved. Inspect the destination before retrying.")); };
      xhr.onabort = () => { settle(); reject(new Error("Upload cancelled; files already saved are not rolled back.")); };
      xhr.onload = () => {
        settle();
        try { resolve({ status: xhr.status, data: JSON.parse(xhr.responseText) as UploadResponse }); }
        catch { reject(new Error("Invalid upload response; inspect the destination before retrying.")); }
      };
      const form = new FormData();
      files.forEach((file) => form.append("files", file, file.name));
      if (signal.aborted) { reject(new Error("Upload cancelled")); return; }
      signal.addEventListener("abort", abort, { once: true });
      try { xhr.send(form); } catch (error) { settle(); reject(error); }
    });
  },
};

interface Batch { directory: string; files: File[]; controller: AbortController }

/** One owner across preflight, conflict and upload. dispose invalidates callbacks
 * before aborting transport; cancellation never implies rollback of server writes. */
export class ExplorerUpload {
  private batch: Batch | null = null;
  private disposed = false;
  private state = idleUploadState();
  constructor(private changed: (state: ExplorerUploadState) => void,
    private completed: (summary: UploadSummary) => void,
    private transport: UploadTransport = browserUploadTransport) {}
  private current(batch: Batch) { return !this.disposed && this.batch === batch; }
  private publish(update: Partial<ExplorerUploadState>) {
    this.state = { ...this.state, ...update };
    if (!this.disposed) this.changed(this.state);
  }
  get locked() { return this.disposed || this.batch !== null; }
  async start(directory: string, files: File[]) {
    if (this.locked || !files.length) return;
    const batch = { directory, files: [...files], controller: new AbortController() };
    this.batch = batch;
    this.publish({ ...idleUploadState(), directory, phase: "checking" });
    try {
      const data = await this.transport.check(directory, files, batch.controller.signal);
      if (!this.current(batch)) return;
      if (data.conflicts?.length) {
        this.publish({ phase: "idle", conflict: { conflicts: data.conflicts, nonReplaceable: data.nonReplaceable ?? [] } });
      } else await this.send(batch, "error");
    } catch (error) { this.fail(batch, error); }
  }
  async resolve(strategy: "overwrite" | "skip") {
    const batch = this.batch;
    if (!batch || !this.state.conflict || this.disposed) return;
    await this.send(batch, strategy);
  }
  cancelConflict() {
    if (!this.state.conflict) return;
    this.batch?.controller.abort();
    this.batch = null;
    this.publish({ conflict: null, directory: null });
  }
  private fail(batch: Batch, error: unknown) {
    if (!this.current(batch)) return;
    this.batch = null;
    this.publish({ phase: "idle", conflict: null, error: error instanceof Error ? error.message : String(error) });
  }
  private async send(batch: Batch, strategy: UploadConflictStrategy) {
    if (!this.current(batch)) return;
    this.publish({ phase: "uploading", conflict: null, progress: 0, error: null });
    try {
      const { status, data } = await this.transport.upload(batch.directory, batch.files, strategy, batch.controller.signal,
        (progress) => { if (this.current(batch)) this.publish({ progress }); });
      if (!this.current(batch)) return;
      if (status === 409 && data.conflicts?.length) {
        this.publish({ phase: "idle", conflict: { conflicts: data.conflicts, nonReplaceable: data.nonReplaceable ?? [] } });
        return;
      }
      if (status < 200 || status >= 300) throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      const summary = { directory: batch.directory, uploaded: data.uploaded ?? [], skipped: data.skipped ?? [], errors: data.errors ?? [] };
      this.batch = null;
      this.publish({ phase: "idle", summary, progress: 100 });
      this.completed(summary);
    } catch (error) { this.fail(batch, error); }
  }
  dismiss() { if (!this.locked) this.publish(idleUploadState()); }
  dispose() {
    this.disposed = true;
    const batch = this.batch;
    this.batch = null;
    batch?.controller.abort();
  }
}
