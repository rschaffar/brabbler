// Bundled only into the disposable renderer asset, never imported by the app.
import mermaid from "mermaid";
import "katex/dist/katex.min.css";

async function accept(event: MessageEvent) {
  if (event.source !== window.parent || event.data?.type !== "brabbler-mermaid-render-v1" || !event.ports[0]) return;
  const { code, dark } = event.data;
  if (typeof code !== "string" || code.length > 512 * 1024 || typeof dark !== "boolean") return;
  window.removeEventListener("message", accept);
  const port = event.ports[0];
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark ? "dark" : "default" });
    const parsed = await mermaid.parse(code, { suppressErrors: true });
    if (!parsed) throw new Error("Invalid diagram");
    // The parent rechecks current image consent after parsing, before render.
    const permission = new Promise<void>(resolve => {
      port.onmessage = next => { if (next.data?.type === "render") { port.onmessage = null; resolve(); } };
    });
    port.postMessage({ type: "parsed" });
    await permission;
    const id = `mermaid-${[...crypto.getRandomValues(new Uint32Array(4))].join("-")}`;
    const result = await mermaid.render(id, code);
    if (result.svg.length > 4 * 1024 * 1024) throw new Error("Diagram too large");
    port.postMessage({ type: "result", svg: result.svg });
  } catch {
    port.postMessage({ type: "error" });
  } finally { port.close(); }
}
window.addEventListener("message", accept);
