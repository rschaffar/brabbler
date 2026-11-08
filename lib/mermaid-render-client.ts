export interface MermaidRenderInput {
  code: string;
  dark: boolean;
  allowImages: boolean;
  isAllowed(): boolean;
}
interface RenderHandle { promise: Promise<string>; cancel(): void }
export type MermaidFrameStart = (input: MermaidRenderInput) => RenderHandle;
const cancelled = () => new DOMException("Diagram render cancelled", "AbortError");

/** One live library realm per page, with a bounded, cancellable waiting list.
 * No SVG cache or realm reuse: each completed/cancelled job drops its runtime. */
export function createMermaidRenderer(start: MermaidFrameStart = startMermaidFrame) {
  type Job = { input: MermaidRenderInput; signal: AbortSignal; done: boolean; bytes: number;
    handle?: RenderHandle; abort(): void; resolve(svg: string): void; reject(error: unknown): void };
  const queue: Job[] = [];
  let active: Job | undefined;
  let retainedBytes = 0;
  const pump = () => {
    if (active || !queue.length) return;
    const job = active = queue.shift()!;
    if (job.signal.aborted || !job.input.isAllowed()) { finish(job, undefined, cancelled()); return; }
    try {
      job.handle = start(job.input);
      void job.handle.promise.then(svg => finish(job, svg), error => finish(job, undefined, error));
    } catch (error) { finish(job, undefined, error); }
  };
  const finish = (job: Job, svg?: string, error?: unknown) => {
    if (job.done) return;
    job.done = true;
    job.signal.removeEventListener("abort", job.abort);
    job.handle?.cancel();
    job.handle = undefined;
    job.input.code = "";
    retainedBytes -= job.bytes;
    if (active === job) active = undefined;
    else { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); }
    if (svg !== undefined) job.resolve(svg); else job.reject(error);
    pump();
  };
  return {
    render(input: MermaidRenderInput, signal: AbortSignal): Promise<string> {
      if (signal.aborted) return Promise.reject(cancelled());
      const bytes = input.code.length * 2;
      if (bytes > 1024 * 1024 || retainedBytes + bytes > 8 * 1024 * 1024 || queue.length >= 64) {
        return Promise.reject(new Error("Diagram render budget exceeded"));
      }
      return new Promise((resolve, reject) => {
        const job: Job = { input: { ...input }, signal, bytes, done: false, resolve, reject,
          abort: () => finish(job, undefined, cancelled()) };
        signal.addEventListener("abort", job.abort, { once: true });
        retainedBytes += bytes;
        queue.push(job);
        pump();
      });
    },
  };
}

/** Trusted same-origin renderer code, not an untrusted HTML preview. Keeping the
 * original origin preserves authorized local images without a new proxy/grant.
 * Diagram text travels as data over a port, never interpolated into srcdoc.
 * Mermaid's strict sanitization remains the SVG boundary, as in the old parent
 * renderer. The frame is for lifetime isolation, not a security/process sandbox. */
export function startMermaidFrame(input: MermaidRenderInput): RenderHandle {
  let frame: HTMLIFrameElement | null = document.createElement("iframe");
  let channel: MessageChannel | null = new MessageChannel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let resolve!: (svg: string) => void, reject!: (error: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const dispose = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (channel) { channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); }
    channel = null;
    if (frame) { frame.onload = null; frame.onerror = null; frame.remove(); }
    frame = null;
    input.code = "";
  };
  const complete = (svg?: string, error?: unknown) => {
    if (finished) return;
    finished = true;
    dispose(); // Release the entire evaluated library realm BEFORE publication.
    if (svg !== undefined) resolve(svg); else reject(error);
  };
  try {
    // getRandomValues also works on explicitly supported non-HTTPS LAN origins.
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    frame.dataset.mermaidRenderer = nonce;
    frame.title = "Diagram renderer";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.referrerPolicy = "no-referrer";
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;height:900px;visibility:hidden;pointer-events:none;border:0";
    // No user-controlled markup enters this document. Same-origin script/style
    // assets are generated from the locked dependency graph in the Nix builder.
    const images = input.allowImages ? "'self' http: https: data: blob:" : "'none'";
    frame.srcdoc = `<!doctype html><html><head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; font-src data:; img-src ${images}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="/mermaid-renderer/v1/render.css"><script nonce="${nonce}" src="/mermaid-renderer/v1/render.js"></script></head><body></body></html>`;
    channel.port1.onmessage = event => {
      const data = event.data;
      if (!data || typeof data !== "object" || finished) return;
      if (data.type === "parsed") {
        if (!input.isAllowed()) { complete(undefined, cancelled()); return; }
        channel?.port1.postMessage({ type: "render" });
      } else if (data.type === "result" && typeof data.svg === "string" && data.svg.length <= 4 * 1024 * 1024) {
        if (input.isAllowed()) complete(data.svg); else complete(undefined, cancelled());
      } else complete(undefined, new Error("Diagram renderer failed"));
    };
    frame.onload = () => {
      if (finished) return;
      if (!input.isAllowed()) { complete(undefined, cancelled()); return; }
      frame?.contentWindow?.postMessage({ type: "brabbler-mermaid-render-v1", code: input.code, dark: input.dark }, window.location.origin, [channel!.port2]);
    };
    frame.onerror = () => complete(undefined, new Error("Diagram renderer unavailable"));
    timer = setTimeout(() => complete(undefined, new Error("Diagram renderer timed out")), 30_000);
    document.body.append(frame);
  } catch (error) { complete(undefined, error); }
  return { promise, cancel: () => complete(undefined, cancelled()) };
}

const renderer = createMermaidRenderer();
export const renderMermaid = renderer.render;
